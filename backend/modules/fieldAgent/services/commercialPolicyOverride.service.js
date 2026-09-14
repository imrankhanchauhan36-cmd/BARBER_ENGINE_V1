/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/commercialPolicyOverride.service.js
 *
 * FA-9 — CommercialPolicyOverride authoring/versioning/publish. Mirrors
 * commercialPolicy.service.js's own DRAFT/PUBLISHED/RETIRED discipline
 * (bounded-retry versionNumber generation, bounded-retry publish with
 * real TransientTransactionError/WriteConflict retry) plus
 * commercialTerritory.service.js's own geography-validation and
 * district-scoped activation-lock idioms — combined, not invented.
 *
 * Publish-time overlap handling has two distinct cases (FA-9 corrected
 * plan, area-wise design):
 *   1. SAME scopeKey already PUBLISHED → auto-retire it (mirrors
 *      commercialPolicy.service.js#publishPolicyVersion's own
 *      auto-supersession — this is a new version of the same policy line).
 *   2. DIFFERENT scopeKey, but geographically overlapping, already
 *      PUBLISHED in the same district → BLOCK (mirrors
 *      commercialTerritory.service.js#activateTerritory's own
 *      ACTIVE-vs-ACTIVE overlap prevention — these are two different
 *      policy lines and must never both apply to one salon).
 * Both checks run inside the SAME district-scoped serialized
 * transaction, anchored by PolicyOverrideActivationLock (a NEW,
 * separate collection — FA-5.2's own TerritoryActivationLock is never
 * touched).
 *
 * FINANCIAL BOUNDARY (locked, non-negotiable): this file never reads
 * Booking, never computes a commission amount, never creates a ledger
 * entry — see fieldAgentEarning.service.js for that.
 */

import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import { logAdminAction } from "../../../utils/auditLog.js";
import { AUDIT_ACTIONS } from "../../../utils/auditActions.js";
import District from "../../../models/District.js";
import City from "../../../models/City.js";
import Area from "../../../models/Area.js";
import CommercialPolicyOverride from "../models/CommercialPolicyOverride.js";
import PolicyOverrideActivationLock from "../models/PolicyOverrideActivationLock.js";
import { POLICY_OVERRIDE_SCOPE_TYPE, POLICY_OVERRIDE_STATUS, MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT, MAX_VERSION_NUMBER_ATTEMPTS, MAX_PUBLISH_ATTEMPTS } from "../constants/commercialPolicyOverride.constants.js";

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const isTransientConflict = (err) =>
  err.hasErrorLabel?.("TransientTransactionError") || err.code === 112 || err.codeName === "WriteConflict";

const getOverrideOrThrow = async (overrideId) => {
  const override = await CommercialPolicyOverride.findById(overrideId);
  if (!override) throw Errors.notFound("Commercial policy override not found");
  return override;
};

const assertDraft = (override) => {
  if (override.status !== POLICY_OVERRIDE_STATUS.DRAFT) {
    throw Errors.conflict(`Policy override v${override.versionNumber} is ${override.status}, not DRAFT — it is immutable`);
  }
};

// ─── SCOPE KEY (canonical, deterministic) — mirrors
// commercialTerritory.service.js#computeScopeKey exactly. ────────────
export const computeOverrideScopeKey = ({ scopeType, districtRef, cityRef, areaRefs }) => {
  if (scopeType === POLICY_OVERRIDE_SCOPE_TYPE.DISTRICT) {
    return `DISTRICT:${districtRef}`;
  }
  if (scopeType === POLICY_OVERRIDE_SCOPE_TYPE.CITY) {
    return `CITY:${cityRef}`;
  }
  const sorted = [...new Set((areaRefs || []).map(String))].sort();
  return `AREA_SET:${cityRef}:${sorted.join(",")}`;
};

// ─── FRESH GEOGRAPHY VALIDATION — mirrors
// commercialTerritory.service.js#validateGeographyFresh exactly (never
// trusts client-supplied ancestor chains). ────────────────────────────
const validateGeographyFresh = async ({ scopeType, districtRef, cityRef, areaRefs }) => {
  const district = await District.findById(districtRef).lean();
  if (!district || district.isDeleted || district.isActive === false) {
    throw Errors.badRequest("districtRef does not reference an active District");
  }
  const stateRef = district.stateRef;

  if (scopeType === POLICY_OVERRIDE_SCOPE_TYPE.DISTRICT) {
    return { stateRef, cityRef: null, areaRefs: [] };
  }

  const city = await City.findById(cityRef).lean();
  if (!city || city.isDeleted || city.isActive === false) {
    throw Errors.badRequest("cityRef does not reference an active City");
  }
  if (String(city.districtRef) !== String(districtRef)) {
    throw Errors.badRequest("cityRef does not belong to the given districtRef");
  }

  if (scopeType === POLICY_OVERRIDE_SCOPE_TYPE.CITY) {
    return { stateRef, cityRef: city._id, areaRefs: [] };
  }

  const uniqueAreaRefs = [...new Set((areaRefs || []).map(String))];
  const areas = await Area.find({ _id: { $in: uniqueAreaRefs } }).lean();
  if (areas.length !== uniqueAreaRefs.length) {
    throw Errors.badRequest("One or more areaRefs do not exist");
  }
  for (const area of areas) {
    if (area.isDeleted || area.isActive === false) {
      throw Errors.badRequest(`Area ${area._id} is not active`);
    }
    if (String(area.cityRef) !== String(cityRef) || String(area.districtRef) !== String(districtRef)) {
      throw Errors.badRequest(`Area ${area._id} does not belong to the given city/district`);
    }
  }
  return { stateRef, cityRef: city._id, areaRefs: areas.map((a) => a._id) };
};

// ─── OVERLAP MATRIX — mirrors commercialTerritory.service.js's own
// scopesConflict exactly (duplicated, not imported: that function is
// not exported there, and this is a small, self-contained rule this
// module must own independently). ────────────────────────────────────
const scopesConflict = (a, b) => {
  if (a.scopeType === POLICY_OVERRIDE_SCOPE_TYPE.DISTRICT || b.scopeType === POLICY_OVERRIDE_SCOPE_TYPE.DISTRICT) {
    return String(a.districtRef) === String(b.districtRef);
  }
  if (a.scopeType === POLICY_OVERRIDE_SCOPE_TYPE.CITY || b.scopeType === POLICY_OVERRIDE_SCOPE_TYPE.CITY) {
    return String(a.cityRef) === String(b.cityRef);
  }
  if (String(a.cityRef) !== String(b.cityRef)) return false;
  const bSet = new Set((b.areaRefs || []).map(String));
  return (a.areaRefs || []).some((id) => bSet.has(String(id)));
};

// ─── CREATE (bounded retry on per-scopeKey versionNumber collision) ──
export const createDraftPolicyOverride = async ({
  adminId,
  scopeType,
  districtRef,
  cityRef,
  areaRefs,
  acquisitionAgentCommissionPercent,
  acquisitionEarningTargetInPaise,
  territoryPartnerCommissionPercent,
}) => {
  if (!isValidId(districtRef)) throw Errors.badRequest("Invalid districtRef");
  if (scopeType !== POLICY_OVERRIDE_SCOPE_TYPE.DISTRICT && !isValidId(cityRef)) {
    throw Errors.badRequest("Invalid cityRef");
  }

  const resolved = await validateGeographyFresh({ scopeType, districtRef, cityRef, areaRefs: areaRefs ?? [] });
  const scopeKey = computeOverrideScopeKey({
    scopeType,
    districtRef,
    cityRef: resolved.cityRef,
    areaRefs: resolved.areaRefs,
  });

  let lastErr = null;
  for (let attempt = 0; attempt < MAX_VERSION_NUMBER_ATTEMPTS; attempt++) {
    const last = await CommercialPolicyOverride.findOne({ scopeKey })
      .sort({ versionNumber: -1 })
      .select("versionNumber")
      .lean();
    const versionNumber = (last?.versionNumber ?? 0) + 1;
    try {
      const override = await CommercialPolicyOverride.create({
        scopeType,
        scopeKey,
        stateRef: resolved.stateRef,
        districtRef,
        cityRef: resolved.cityRef,
        areaRefs: resolved.areaRefs,
        versionNumber,
        acquisitionAgentCommissionPercent,
        acquisitionEarningTargetInPaise,
        territoryPartnerCommissionPercent,
        createdBy: adminId,
      });

      logAdminAction({
        adminId,
        action: AUDIT_ACTIONS.POLICY_OVERRIDE_CREATED,
        targetType: "COMMERCIAL_POLICY_OVERRIDE",
        targetId: override._id,
        meta: { scopeKey, versionNumber },
      });

      return override;
    } catch (err) {
      lastErr = err;
      const isDuplicateDraft = err.code === 11000 && err.keyPattern?.scopeKey && err.keyPattern?.status;
      if (isDuplicateDraft) {
        throw Errors.conflict("An identical DRAFT policy override already exists for this scope");
      }
      const isDuplicateVersionNumber = err.code === 11000 && err.keyPattern?.versionNumber;
      if (isDuplicateVersionNumber && attempt < MAX_VERSION_NUMBER_ATTEMPTS - 1) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
};

// ─── READ ────────────────────────────────────────────────────────────
export const listPolicyOverrides = async ({ page = 1, limit = DEFAULT_LIST_LIMIT, status, districtRef }) => {
  const safeLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT));
  const safePage = Math.max(1, Number(page) || 1);

  const filter = {};
  if (status) filter.status = status;
  if (districtRef) filter.districtRef = districtRef;

  const [items, total] = await Promise.all([
    CommercialPolicyOverride.find(filter).sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    CommercialPolicyOverride.countDocuments(filter),
  ]);

  return { items, total, page: safePage, limit: safeLimit };
};

export const getPolicyOverrideDetail = (overrideId) => getOverrideOrThrow(overrideId);

// ─── UPDATE (DRAFT-only) ─────────────────────────────────────────────
export const updateDraftPolicyOverride = async ({ overrideId, adminId, ...fields }) => {
  const override = await getOverrideOrThrow(overrideId);
  assertDraft(override);

  const CONFIGURABLE_FIELDS = [
    "acquisitionAgentCommissionPercent",
    "acquisitionEarningTargetInPaise",
    "territoryPartnerCommissionPercent",
  ];
  for (const field of CONFIGURABLE_FIELDS) {
    if (fields[field] !== undefined) override[field] = fields[field];
  }

  await override.save();

  logAdminAction({
    adminId,
    action: AUDIT_ACTIONS.POLICY_OVERRIDE_UPDATED,
    targetType: "COMMERCIAL_POLICY_OVERRIDE",
    targetId: override._id,
    meta: { scopeKey: override.scopeKey, versionNumber: override.versionNumber },
  });

  return override;
};

// ─── PUBLISH (district-scoped serialized overlap check, FA-9) ───────
export const publishPolicyOverride = async ({ overrideId, adminId }) => {
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_PUBLISH_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const override = await CommercialPolicyOverride.findById(overrideId).session(session);
      if (!override) throw Errors.notFound("Commercial policy override not found");
      if (override.status !== POLICY_OVERRIDE_STATUS.DRAFT) {
        throw Errors.conflict(`Policy override v${override.versionNumber} is ${override.status}, not DRAFT`);
      }

      // Step 1 — district-scoped serialization anchor. MUST be the
      // first write inside this transaction (see
      // PolicyOverrideActivationLock.js for the full correctness
      // argument, identical to TerritoryActivationLock's own).
      await PolicyOverrideActivationLock.findOneAndUpdate(
        { districtRef: override.districtRef },
        { $set: { updatedAt: new Date() } },
        { upsert: true, session }
      );

      // Step 2 — re-read every PUBLISHED override sharing this
      // district, now inside the serialized section.
      const districtPublished = await CommercialPolicyOverride.find({
        status: POLICY_OVERRIDE_STATUS.PUBLISHED,
        districtRef: override.districtRef,
        _id: { $ne: override._id },
      }).session(session);

      const sameScope = districtPublished.find((c) => c.scopeKey === override.scopeKey);
      const otherConflict = districtPublished.find(
        (c) => c.scopeKey !== override.scopeKey && scopesConflict(override, c)
      );

      if (otherConflict) {
        throw Errors.conflict(
          `Publish blocked — overlaps with a different PUBLISHED override ${otherConflict._id} (${otherConflict.scopeType})`
        );
      }

      // Same-scope auto-supersession — mirrors
      // commercialPolicy.service.js#publishPolicyVersion exactly.
      if (sameScope) {
        sameScope.status = POLICY_OVERRIDE_STATUS.RETIRED;
        sameScope.retiredAt = new Date();
        sameScope.retiredBy = adminId;
        await sameScope.save({ session });
      }

      override.status = POLICY_OVERRIDE_STATUS.PUBLISHED;
      override.publishedAt = new Date();
      override.publishedBy = adminId;
      await override.save({ session });

      await session.commitTransaction();

      logAdminAction({
        adminId,
        action: AUDIT_ACTIONS.POLICY_OVERRIDE_PUBLISHED,
        targetType: "COMMERCIAL_POLICY_OVERRIDE",
        targetId: override._id,
        meta: { scopeKey: override.scopeKey, versionNumber: override.versionNumber, supersededVersionId: sameScope ? String(sameScope._id) : null },
      });

      return override;
    } catch (err) {
      await session.abortTransaction();
      lastErr = err;
      if (isTransientConflict(err) && attempt < MAX_PUBLISH_ATTEMPTS - 1) {
        continue;
      }
      throw err;
    } finally {
      session.endSession();
    }
  }
  throw lastErr;
};

// ─── RETIRE (manual, no supersession) ────────────────────────────────
export const retirePolicyOverride = async ({ overrideId, adminId, reason }) => {
  const override = await getOverrideOrThrow(overrideId);
  if (override.status !== POLICY_OVERRIDE_STATUS.PUBLISHED) {
    throw Errors.conflict(`Policy override v${override.versionNumber} is ${override.status}, not PUBLISHED`);
  }

  override.status = POLICY_OVERRIDE_STATUS.RETIRED;
  override.retiredAt = new Date();
  override.retiredBy = adminId;
  await override.save();

  logAdminAction({
    adminId,
    action: AUDIT_ACTIONS.POLICY_OVERRIDE_RETIRED,
    targetType: "COMMERCIAL_POLICY_OVERRIDE",
    targetId: override._id,
    meta: { scopeKey: override.scopeKey, versionNumber: override.versionNumber, reason: reason ?? "Manually retired by admin" },
  });

  return override;
};
