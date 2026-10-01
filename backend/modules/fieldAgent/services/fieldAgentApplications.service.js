/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/fieldAgentApplications.service.js
 *
 * PHASE 2A — Field Agent "My Applications" list. Strictly READ-ONLY —
 * this file contains no `.create(`, `.save(`, `.update*(`, or `$set`
 * anywhere; it only ever reads AcquisitionClaim + (via populate) Salon.
 *
 * Relationship reused exactly as the Phase 2 audit specified, no new
 * model, no new attribution system:
 *
 *   Field Agent (req.user._id) -> FieldAgent (fieldAgentRef)
 *     -> AcquisitionClaim.find({fieldAgentRef})   [COLLECTION query —
 *        never findOne; a Field Agent legitimately holds many
 *        non-terminal AND terminal claims at once, see
 *        acquisitionClaim.service.js's own {fieldAgentRef,status} index
 *        comment: "one FieldAgent legitimately holds many ACTIVE
 *        claims" — no currentSalon/activeSalon/currentClaim singular
 *        assumption anywhere in this file]
 *     -> populate('salonRef')                     [Salon is the
 *        authoritative application record — see Phase 2 audit §4/§10]
 *
 * Query shape and projection style are copied directly from the two
 * existing, proven precedents named in the ticket:
 *   - adminFieldAgentSalons.service.js (admin's own equivalent join —
 *     same `.find({fieldAgentRef}).populate('salonRef', '<fields>')`
 *     shape, just scoped to the CALLER's own fieldAgentRef here
 *     instead of an admin-supplied path param)
 *   - acquisitionRecovery.service.js#listMyAcquisitionRecovery (the
 *     existing Field-Agent-facing claim-list pagination/sort
 *     convention: {page,limit} query params, clamped via the same
 *     MAX_LIST_LIMIT/DEFAULT_LIST_LIMIT constants, sort by
 *     createdAt:-1, response shape {items,total,page,limit})
 *
 * Deliberately does NOT reuse/modify acquisitionClaim.service.js's own
 * listMyClaims — that function's existing projection (raw .lean() claim
 * documents, no Salon onboarding/approval fields selected) does not
 * carry what this screen needs, and that file is not in the Phase 1/2
 * frozen list but is also not a file this ticket asks to touch "merely
 * to force reuse". A new, small, additive file — same discipline Phase
 * 1 already established for assistedOnboarding.service.js.
 */

import Salon from "../../../models/Salon.js";
import AcquisitionClaim from "../models/AcquisitionClaim.js";
import { Errors } from "../../../utils/response.js";
import { getFieldAgentByUserId } from "./fieldAgentProfile.service.js";
import { MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT, CLAIM_STATUS } from "../constants/acquisitionClaim.constants.js";

const clampLimit = (limit) => Math.max(1, Math.min(Number(limit) || DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT));
const clampPage = (page) => Math.max(1, Number(page) || 1);

// Explicit allow-list projection — never a populated whole document.
// Mirrors adminFieldAgentSalons.service.js's own field list, plus the
// two fields that service didn't need (onboarding.step,
// approval.rejectionReason) that THIS screen's "Step 2 / Step 5 /
// Rejected (reason)" requirement actually needs. No owner auth/session
// field, no OTP field, no internal security field is selected here —
// only "name" is pulled from the populated ownerId User, same as
// adminFieldAgentSalons.service.js's own ownerId populate.
const SALON_PROJECTION =
  "basicInfo.shopName location.address onboarding.step approval.status approval.rejectionReason ownerId createdAt";

const toApplication = (claim) => {
  const salon = claim.salonRef || null;
  return {
    // Salon / application fields — Salon._id is the authoritative
    // application identity (Phase 2 audit §F — "the authoritative
    // application identity is salonId", never deduplicated by ownerId).
    salonId: salon?._id ?? null,
    shopName: salon?.basicInfo?.shopName ?? null,
    ownerId: salon?.ownerId?._id ?? salon?.ownerId ?? null,
    ownerName: salon?.ownerId?.name ?? null,
    onboardingStep: salon?.onboarding?.step ?? null,
    salonApprovalStatus: salon?.approval?.status ?? null,
    rejectionReason: salon?.approval?.rejectionReason ?? null,
    address: salon?.location?.address ?? null,
    salonCreatedAt: salon?.createdAt ?? null,
    // Claim fields — kept separate from the Salon fields above, never
    // merged into a single invented "applicationStatus" (ticket's own
    // explicit instruction). claimId is the AcquisitionClaim identity,
    // distinct from salonId.
    claimId: claim._id,
    claimStatus: claim.status,
    claimCreatedAt: claim.createdAt,
    claimUpdatedAt: claim.updatedAt,
  };
};

/**
 * GET /field-agent/acquisition/applications
 *
 * Identity is ALWAYS derived from the authenticated caller's own
 * userId (req.user._id, passed in by the controller) — never from any
 * client-supplied fieldAgentRef/fieldAgentId/ownerId. A Field Agent can
 * never see another Field Agent's applications: every claim returned
 * is scoped by `fieldAgentRef: fieldAgent._id`, where `fieldAgent` is
 * resolved exclusively from the caller's own token-derived userId.
 *
 * `status` is an OPTIONAL, additive filter against the real
 * AcquisitionClaim.status enum (PENDING_APPROVAL/ACTIVE_RECOVERY/
 * COMPLETED/ENDED) — when omitted, ALL of the caller's claims are
 * returned regardless of status, exactly as the ticket requires ("do
 * NOT automatically filter only ACTIVE_RECOVERY"). This is a pure,
 * additive read — no write of any kind occurs anywhere in this
 * function.
 */
export const listMyApplications = async ({ userId, page, limit, status }) => {
  const fieldAgent = await getFieldAgentByUserId(userId);
  if (!fieldAgent) throw Errors.notFound("Field Agent profile not found");

  const safePage = clampPage(page);
  const safeLimit = clampLimit(limit);

  // COLLECTION query, never findOne — see this file's own header for
  // why a singular current/active-claim assumption would be wrong here.
  const filter = { fieldAgentRef: fieldAgent._id };
  if (status) filter.status = status;

  const [claims, total] = await Promise.all([
    AcquisitionClaim.find(filter)
      .select("salonRef status createdAt updatedAt")
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate({
        path: "salonRef",
        select: SALON_PROJECTION,
        populate: { path: "ownerId", select: "name", model: "User" },
      })
      .lean(),
    AcquisitionClaim.countDocuments(filter),
  ]);

  return {
    items: claims.map(toApplication),
    total,
    page: safePage,
    limit: safeLimit,
  };
};

// Exported for tests/consumers that need the real enum without
// re-declaring it — not a new status system, just a re-export.
export const APPLICATION_CLAIM_STATUS = CLAIM_STATUS;
