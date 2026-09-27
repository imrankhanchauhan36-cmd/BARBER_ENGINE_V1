/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/revenueConfig.service.js
 *
 * FA-P3-A — Revenue Configuration Engine, Phase 1 (Backend + Admin
 * Panel only; Field Agent App untouched).
 *
 * This is a THIN ORCHESTRATION layer, not a new financial model. Per
 * explicit instruction, /admin/revenue/settings and
 * /admin/revenue/territory/:id read and write the EXISTING, already-
 * live commercial policy engine (CommercialPolicyVersion +
 * CommercialPolicyOverride, both FA-5.1/FA-9) — the same rows
 * fieldAgentEarning.service.js already resolves for every booking.
 * Nothing here duplicates that engine's storage, versioning, or
 * publish/overlap logic; every write is a plain create-draft-then-
 * publish call into the existing, unmodified
 * commercialPolicy.service.js / commercialPolicyOverride.service.js
 * functions, so this phase inherits their audit trail, immutability,
 * and concurrency-safety for free.
 *
 * "Settings" here is presented to the admin as one flat, editable row
 * (matching the ticket's GET/PATCH /settings shape) — underneath, a
 * PATCH is really "create a new DRAFT version seeded from the current
 * PUBLISHED one, with only the changed fields applied, then publish
 * it immediately." This preserves the existing engine's booking-safety
 * property (a version is a versionined, immutable-once-published
 * snapshot) while giving the admin the simple single-document editing
 * experience this ticket asks for.
 *
 * FINANCIAL BOUNDARY (unchanged from the engine this wraps): this file
 * never reads Booking, never computes a commission amount, never
 * creates a ledger entry or a payout. Configuration only.
 */

import { Errors } from "../../../utils/response.js";
import Area from "../../../models/Area.js";
import CommercialPolicyVersion from "../models/CommercialPolicyVersion.js";
import CommercialPolicyOverride from "../models/CommercialPolicyOverride.js";
import { COMMERCIAL_POLICY_STATUS, LICENSE_TERM_MONTHS_MIN, CLAIM_EXPIRY_DAYS_MIN } from "../constants/commercialPolicy.constants.js";
import { POLICY_OVERRIDE_SCOPE_TYPE, POLICY_OVERRIDE_STATUS, MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT } from "../constants/commercialPolicyOverride.constants.js";
import { createDraftPolicyVersion, publishPolicyVersion } from "./commercialPolicy.service.js";
import { createDraftPolicyOverride, updateDraftPolicyOverride, publishPolicyOverride } from "./commercialPolicyOverride.service.js";

// Phase-1 placeholder defaults for the three CommercialPolicyVersion
// fields this phase does NOT expose an editable field for
// (territoryPartnerCommissionPercent is edited per-area via the
// territory table, not nationally, in this phase; licenseTermMonths/
// claimExpiryDays have no UI yet at all). Used ONLY the very first time
// a settings PATCH is made and no CommercialPolicyVersion has ever
// existed — every subsequent PATCH carries these values forward
// unchanged from the current version, exactly like every other
// untouched field. An admin can still change these three later via the
// existing, unmodified /api/admin/commercial-policies API.
const FIRST_RUN_DEFAULTS = Object.freeze({
  territoryPartnerCommissionPercent: 20,
  licenseTermMonths: 36,
  claimExpiryDays: Math.max(CLAIM_EXPIRY_DAYS_MIN, 30),
});
// (LICENSE_TERM_MONTHS_MIN imported for documentation/consistency even
// though 36 already satisfies it — kept explicit rather than silently
// relying on the model's own `min` validator to catch a future typo.)
void LICENSE_TERM_MONTHS_MIN;

const getCurrentPolicyVersion = async () => {
  const published = await CommercialPolicyVersion.findOne({ status: COMMERCIAL_POLICY_STATUS.PUBLISHED }).lean();
  if (published) return published;
  // No PUBLISHED version exists — fall back to the most recent version
  // of any status (covers the narrow window between creating and
  // publishing a draft), or null on a genuinely empty collection.
  return CommercialPolicyVersion.findOne().sort({ versionNumber: -1 }).lean();
};

// ─── GLOBAL REVENUE SETTINGS ───────────────────────────────────────

export const getRevenueSettings = async () => {
  return getCurrentPolicyVersion(); // may be null — DTO layer handles that
};

export const updateRevenueSettings = async ({
  adminId,
  acquisitionRewardInPaise,
  recoveryPercentage,
  minimumPayoutInPaise,
  autoPayoutEnabled,
}) => {
  const current = await getCurrentPolicyVersion();

  const merged = {
    acquisitionAgentCommissionPercent: recoveryPercentage ?? current?.acquisitionAgentCommissionPercent,
    acquisitionEarningTargetInPaise: acquisitionRewardInPaise ?? current?.acquisitionEarningTargetInPaise,
    territoryPartnerCommissionPercent: current?.territoryPartnerCommissionPercent ?? FIRST_RUN_DEFAULTS.territoryPartnerCommissionPercent,
    licenseTermMonths: current?.licenseTermMonths ?? FIRST_RUN_DEFAULTS.licenseTermMonths,
    claimExpiryDays: current?.claimExpiryDays ?? FIRST_RUN_DEFAULTS.claimExpiryDays,
    minimumPayoutInPaise: minimumPayoutInPaise ?? current?.minimumPayoutInPaise,
    autoPayoutEnabled: autoPayoutEnabled ?? current?.autoPayoutEnabled ?? false,
    obligations: current?.obligations ?? [],
    performanceFactors: current?.performanceFactors ?? [],
    coverageRules: current?.coverageRules ?? [],
  };

  if (merged.acquisitionAgentCommissionPercent == null || merged.acquisitionEarningTargetInPaise == null) {
    throw Errors.badRequest(
      "No revenue settings exist yet — the first PATCH must include both recoveryPercentage and acquisitionReward"
    );
  }

  const draft = await createDraftPolicyVersion({ adminId, ...merged });
  return publishPolicyVersion({ versionId: draft._id, adminId });
};

// ─── TERRITORY COMMISSION (per-Area) ───────────────────────────────
// Reuses the existing Area model directly (per explicit instruction),
// and CommercialPolicyOverride (scopeType AREA_SET, exactly one area
// per override) for the actual rate storage — never a new collection.

const getEffectiveOverrideForArea = async (area) => {
  return CommercialPolicyOverride.findOne({
    status: POLICY_OVERRIDE_STATUS.PUBLISHED,
    scopeType: POLICY_OVERRIDE_SCOPE_TYPE.AREA_SET,
    areaRefs: area._id,
  }).lean();
};

export const listRevenueTerritories = async ({ page = 1, limit = DEFAULT_LIST_LIMIT } = {}) => {
  const safeLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT));
  const safePage = Math.max(1, Number(page) || 1);

  const [areas, total, currentNational] = await Promise.all([
    Area.find({ isDeleted: { $ne: true } })
      .select("name districtRef cityRef stateRef")
      .sort({ name: 1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    Area.countDocuments({ isDeleted: { $ne: true } }),
    getCurrentPolicyVersion(),
  ]);

  const items = await Promise.all(
    areas.map(async (area) => {
      const override = await getEffectiveOverrideForArea(area);
      return {
        area,
        territoryPartnerCommissionPercent:
          override?.territoryPartnerCommissionPercent ?? currentNational?.territoryPartnerCommissionPercent ?? null,
        isOverridden: !!override,
        overrideId: override?._id ?? null,
      };
    })
  );

  return { items, total, page: safePage, limit: safeLimit };
};

export const updateRevenueTerritory = async ({ areaId, adminId, territoryPartnerCommissionPercent }) => {
  const area = await Area.findOne({ _id: areaId, isDeleted: { $ne: true } }).lean();
  if (!area) throw Errors.notFound("Area not found");

  const currentNational = await getCurrentPolicyVersion();
  if (!currentNational) {
    throw Errors.badRequest("Global revenue settings must be configured before setting a territory override");
  }

  const existingDraft = await CommercialPolicyOverride.findOne({
    scopeType: POLICY_OVERRIDE_SCOPE_TYPE.AREA_SET,
    districtRef: area.districtRef,
    cityRef: area.cityRef,
    areaRefs: [area._id],
    status: POLICY_OVERRIDE_STATUS.DRAFT,
  });

  const overridePayload = {
    acquisitionAgentCommissionPercent: currentNational.acquisitionAgentCommissionPercent,
    acquisitionEarningTargetInPaise: currentNational.acquisitionEarningTargetInPaise,
    territoryPartnerCommissionPercent,
  };

  const draft = existingDraft
    ? await updateDraftPolicyOverride({ overrideId: existingDraft._id, adminId, ...overridePayload })
    : await createDraftPolicyOverride({
        adminId,
        scopeType: POLICY_OVERRIDE_SCOPE_TYPE.AREA_SET,
        districtRef: area.districtRef,
        cityRef: area.cityRef,
        areaRefs: [area._id],
        ...overridePayload,
      });

  const published = await publishPolicyOverride({ overrideId: draft._id, adminId });

  // Shaped identically to listRevenueTerritories' own item shape, so
  // the controller can run it through the same toTerritoryRowDTO
  // without a second round-trip to resolve "what's now effective".
  return {
    area,
    territoryPartnerCommissionPercent: published.territoryPartnerCommissionPercent,
    isOverridden: true,
    overrideId: published._id,
  };
};
