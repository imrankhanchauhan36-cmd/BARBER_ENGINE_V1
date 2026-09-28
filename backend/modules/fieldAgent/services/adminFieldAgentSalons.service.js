/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/adminFieldAgentSalons.service.js
 *
 * STEP 2.2 — Admin Field Agent Acquired Salons API. Read-only join
 * only — reuses AcquisitionClaim, Salon, User exactly as they are, no
 * schema/business-logic change, no write anywhere in this file.
 *
 * "Acquired salons" = every AcquisitionClaim ever recorded for this
 * Field Agent (any status — PENDING_APPROVAL/ACTIVE_RECOVERY/
 * COMPLETED/ENDED), one row per claim, joined to that claim's Salon
 * (and the Salon's owner) via a single populate chain — no aggregation
 * pipeline, no $merge/$out, no write stage of any kind, matching the
 * ticket's "Use joins only / No aggregation that mutates data / No
 * write query" requirement.
 *
 * Salon's OWN territory refs (location.territory.stateRef/districtRef/
 * areaRef) are read here, not AcquisitionClaim's own denormalized
 * stateRef/districtRef snapshot — AcquisitionClaim.js's own header
 * comment is explicit that its snapshot is "never treated as a second
 * source of truth for Salon geography", so Salon.location.territory
 * remains the one source of truth this file reads from.
 *
 * "Status" in the response is the Salon's own onboarding/approval
 * status (approval.status: DRAFT/PENDING/APPROVED/REJECTED), paired
 * with "Onboarding Date" (Salon.createdAt) — both describe the same
 * Salon-onboarding lifecycle the ticket's field list is naming. The
 * claim's own lifecycle (PENDING_APPROVAL/ACTIVE_RECOVERY/COMPLETED/
 * ENDED) is a separate concept (see STEP 2.1's adminFieldAgentSummary
 * service, which already surfaces that dimension via activeSalons) and
 * is intentionally left out here to match the ticket's exact field
 * list rather than guessing at an unrequested field.
 */

import FieldAgent from "../models/FieldAgent.js";
import AcquisitionClaim from "../models/AcquisitionClaim.js";
import { Errors } from "../../../utils/response.js";

export const getAdminFieldAgentSalons = async ({ fieldAgentId }) => {
  const fieldAgent = await FieldAgent.findById(fieldAgentId).select("_id").lean();
  if (!fieldAgent) throw Errors.notFound("Field Agent not found");

  const claims = await AcquisitionClaim.find({ fieldAgentRef: fieldAgent._id })
    .select("salonRef")
    .sort({ createdAt: -1 })
    .populate({
      path: "salonRef",
      select: "basicInfo.shopName basicInfo.category ownerId location.territory approval.status createdAt",
      populate: [
        { path: "ownerId", select: "name", model: "User" },
        { path: "location.territory.stateRef", select: "name", model: "State" },
        { path: "location.territory.districtRef", select: "name", model: "District" },
        { path: "location.territory.areaRef", select: "name", model: "Area" },
      ],
    })
    .lean();

  // A claim's salonRef can no longer resolve only if the Salon document
  // itself was hard-deleted out of the collection (soft-deleted Salons
  // still resolve fine, deliberately not filtered here — this endpoint
  // is a historical "every acquired salon" list, not a live-active
  // list, matching the ticket's own wording).
  return claims
    .filter((c) => c.salonRef)
    .map((c) => {
      const salon = c.salonRef;
      return {
        salonId: salon._id,
        salonName: salon.basicInfo?.shopName ?? null,
        ownerName: salon.ownerId?.name ?? null,
        category: salon.basicInfo?.category ?? null,
        state: salon.location?.territory?.stateRef?.name ?? null,
        district: salon.location?.territory?.districtRef?.name ?? null,
        area: salon.location?.territory?.areaRef?.name ?? null,
        onboardingDate: salon.createdAt ?? null,
        status: salon.approval?.status ?? null,
      };
    });
};
