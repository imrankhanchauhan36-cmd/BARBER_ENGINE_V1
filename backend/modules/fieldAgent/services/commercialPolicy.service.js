/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/commercialPolicy.service.js
 *
 * FA-5.1 — CommercialPolicyVersion authoring/versioning. Mirrors
 * testContent.service.js's (FA-3.4.1) DRAFT/PUBLISHED/RETIRED
 * discipline, with two deliberate strengthenings this phase's own
 * instructions explicitly required:
 *
 *   1. versionNumber generation uses a BOUNDED RETRY loop on a
 *      duplicate-key collision, not a bare "read max + 1 + create"
 *      (which is what TestVersion/TrainingVersion's own
 *      createDraftVersion still does, unguarded). This was an
 *      explicit instruction ("Do NOT use an unsafe application-level
 *      find max+1... Use... a transaction-safe mechanism") — the
 *      retry loop is the mechanism, mirroring the exact idiom
 *      fieldAgentProfile.service.js#generateAgentCode already proved.
 *
 *   2. publishPolicyVersion retries on a real MongoDB
 *      TransientTransactionError/WriteConflict, which
 *      testContent.service.js#publishVersion does NOT do. This is a
 *      genuinely stronger guarantee than the frozen TestVersion
 *      precedent — see this phase's own deliverable report for why
 *      TestVersion's own publish was NOT modified to add this (out of
 *      FA-5.1's scope; noted as an observation, not fixed here).
 *
 * FINANCIAL BOUNDARY (locked, non-negotiable): this file never reads
 * Booking, never computes a commission amount, never creates a ledger
 * entry or a payout. It only stores and versions configuration.
 */

import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import CommercialPolicyVersion from "../models/CommercialPolicyVersion.js";
import FieldAgentAuditEvent from "../models/FieldAgentAuditEvent.js";
import { AUDIT_ACTOR_TYPE, AUDIT_ACTION, AUDIT_ENTITY_TYPE } from "../constants/fieldAgent.constants.js";
import { COMMERCIAL_POLICY_STATUS, MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT } from "../constants/commercialPolicy.constants.js";

const clampLimit = (limit) => Math.max(1, Math.min(Number(limit) || DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT));

const getVersionOrThrow = async (versionId) => {
  const version = await CommercialPolicyVersion.findById(versionId);
  if (!version) throw Errors.notFound("Commercial policy version not found");
  return version;
};

const assertDraft = (version) => {
  if (version.status !== COMMERCIAL_POLICY_STATUS.DRAFT) {
    throw Errors.conflict(`Policy version ${version.versionNumber} is ${version.status}, not DRAFT — it is immutable`);
  }
};

const isTransientConflict = (err) =>
  err.hasErrorLabel?.("TransientTransactionError") || err.code === 112 || err.codeName === "WriteConflict";

const CONFIGURABLE_FIELDS = [
  "acquisitionIncentiveAmountInPaise",
  "acquisitionAgentCommissionPercent", // FA-8
  "acquisitionEarningTargetInPaise", // FA-8
  "territoryPartnerCommissionPercent",
  "licenseTermMonths",
  "claimExpiryDays",
  "obligations",
  "performanceFactors",
  "coverageRules",
];

// ─── CREATE (bounded retry on versionNumber collision) ──────────────
const MAX_VERSION_NUMBER_ATTEMPTS = 5;

export const createDraftPolicyVersion = async ({ adminId, ...fields }) => {
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_VERSION_NUMBER_ATTEMPTS; attempt++) {
    const last = await CommercialPolicyVersion.findOne().sort({ versionNumber: -1 }).select("versionNumber").lean();
    const versionNumber = (last?.versionNumber ?? 0) + 1;
    try {
      const version = await CommercialPolicyVersion.create({
        versionNumber,
        createdBy: adminId,
        acquisitionIncentiveAmountInPaise: fields.acquisitionIncentiveAmountInPaise,
        acquisitionAgentCommissionPercent: fields.acquisitionAgentCommissionPercent, // FA-8
        acquisitionEarningTargetInPaise: fields.acquisitionEarningTargetInPaise, // FA-8
        territoryPartnerCommissionPercent: fields.territoryPartnerCommissionPercent,
        licenseTermMonths: fields.licenseTermMonths,
        claimExpiryDays: fields.claimExpiryDays,
        obligations: fields.obligations ?? [],
        performanceFactors: fields.performanceFactors ?? [],
        coverageRules: fields.coverageRules ?? [],
      });

      await FieldAgentAuditEvent.create([
        {
          entityType: AUDIT_ENTITY_TYPE.COMMERCIAL_POLICY_VERSION,
          entityId: version._id,
          actorRef: adminId,
          actorType: AUDIT_ACTOR_TYPE.ADMIN,
          action: AUDIT_ACTION.COMMERCIAL_POLICY_CREATED,
          newValue: { versionNumber },
        },
      ]).catch((err) => {
        console.error("❌ FA-5.1 FieldAgentAuditEvent write failed:", err.message || err);
      });

      return version;
    } catch (err) {
      lastErr = err;
      const isDuplicateVersionNumber = err.code === 11000 && err.keyPattern?.versionNumber;
      if (isDuplicateVersionNumber && attempt < MAX_VERSION_NUMBER_ATTEMPTS - 1) {
        continue; // recompute max and retry, bounded
      }
      throw err;
    }
  }
  throw lastErr;
};

export const listPolicyVersions = ({ page = 1, limit = DEFAULT_LIST_LIMIT } = {}) => {
  const safeLimit = clampLimit(limit);
  const safePage = Math.max(1, Number(page) || 1);
  return CommercialPolicyVersion.find()
    .sort({ versionNumber: -1 })
    .skip((safePage - 1) * safeLimit)
    .limit(safeLimit)
    .lean();
};

export const getPolicyVersionDetail = (versionId) => getVersionOrThrow(versionId);

// DRAFT-only. Any subset of the configurable fields may be updated.
export const updateDraftPolicyVersion = async ({ versionId, adminId, ...fields }) => {
  const version = await getVersionOrThrow(versionId);
  assertDraft(version);

  for (const field of CONFIGURABLE_FIELDS) {
    if (fields[field] !== undefined) version[field] = fields[field];
  }

  await version.save();
  return version;
};

// ─── PUBLISH / RETIRE ─────────────────────────────────────────────
const MAX_PUBLISH_ATTEMPTS = 5;

export const publishPolicyVersion = async ({ versionId, adminId }) => {
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_PUBLISH_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      // Always re-read live state inside this transaction's own
      // snapshot — never trust a read taken before the loop started
      // (same discipline proven in fieldAgentTest.service.js's
      // startTestAttempt and fieldAgentApproval.service.js's
      // approveApplication, both after real concurrency defects).
      const version = await CommercialPolicyVersion.findById(versionId).session(session);
      if (!version) throw Errors.notFound("Commercial policy version not found");
      if (version.status !== COMMERCIAL_POLICY_STATUS.DRAFT) {
        throw Errors.conflict(`Policy version ${version.versionNumber} is ${version.status}, not DRAFT`);
      }

      const currentlyPublished = await CommercialPolicyVersion.findOne({ status: COMMERCIAL_POLICY_STATUS.PUBLISHED }).session(
        session
      );
      if (currentlyPublished) {
        currentlyPublished.status = COMMERCIAL_POLICY_STATUS.RETIRED;
        currentlyPublished.retiredAt = new Date();
        currentlyPublished.retiredBy = adminId;
        await currentlyPublished.save({ session });

        await FieldAgentAuditEvent.create(
          [
            {
              entityType: AUDIT_ENTITY_TYPE.COMMERCIAL_POLICY_VERSION,
              entityId: currentlyPublished._id,
              actorRef: adminId,
              actorType: AUDIT_ACTOR_TYPE.ADMIN,
              action: AUDIT_ACTION.COMMERCIAL_POLICY_RETIRED,
              reason: `Superseded by version ${version.versionNumber}`,
            },
          ],
          { session }
        );
      }

      version.status = COMMERCIAL_POLICY_STATUS.PUBLISHED;
      version.publishedAt = new Date();
      version.publishedBy = adminId;
      await version.save({ session });

      await FieldAgentAuditEvent.create(
        [
          {
            entityType: AUDIT_ENTITY_TYPE.COMMERCIAL_POLICY_VERSION,
            entityId: version._id,
            actorRef: adminId,
            actorType: AUDIT_ACTOR_TYPE.ADMIN,
            action: AUDIT_ACTION.COMMERCIAL_POLICY_PUBLISHED,
            newValue: { versionNumber: version.versionNumber },
          },
        ],
        { session }
      );

      await session.commitTransaction();
      return version;
    } catch (err) {
      await session.abortTransaction();
      lastErr = err;
      if (isTransientConflict(err) && attempt < MAX_PUBLISH_ATTEMPTS - 1) {
        continue; // retry the WHOLE transaction, re-reading live state
      }
      throw err;
    } finally {
      session.endSession();
    }
  }
  throw lastErr;
};

export const retirePolicyVersion = async ({ versionId, adminId, reason }) => {
  const version = await getVersionOrThrow(versionId);
  if (version.status !== COMMERCIAL_POLICY_STATUS.PUBLISHED) {
    throw Errors.conflict(`Policy version ${version.versionNumber} is ${version.status}, not PUBLISHED`);
  }

  version.status = COMMERCIAL_POLICY_STATUS.RETIRED;
  version.retiredAt = new Date();
  version.retiredBy = adminId;
  await version.save();

  await FieldAgentAuditEvent.create([
    {
      entityType: AUDIT_ENTITY_TYPE.COMMERCIAL_POLICY_VERSION,
      entityId: version._id,
      actorRef: adminId,
      actorType: AUDIT_ACTOR_TYPE.ADMIN,
      action: AUDIT_ACTION.COMMERCIAL_POLICY_RETIRED,
      reason: reason ?? "Manually retired by admin",
    },
  ]).catch((err) => {
    console.error("❌ FA-5.1 FieldAgentAuditEvent write failed:", err.message || err);
  });

  return version;
};
