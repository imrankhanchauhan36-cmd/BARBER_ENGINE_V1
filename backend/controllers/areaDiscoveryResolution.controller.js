/**
 * BARBER ENGINE V1
 * backend/controllers/areaDiscoveryResolution.controller.js
 *
 * AREA-2.5.3 — Controlled Candidate -> Salon Area Resolution.
 *
 * This is the FIRST and ONLY write path to Salon.location.territory.
 * areaRef anywhere in the codebase (confirmed by repo-wide audit: no
 * other file ever sets it). It only ever attaches a Salon to an Area
 * a human already confirmed via the frozen AreaDiscoveryCandidate
 * MERGED review action — it never creates, modifies, or reassigns an
 * Area, never touches AreaServiceability/Territory/AcquisitionClaim,
 * and never re-writes the candidate itself.
 *
 * The historical MERGED decision establishes intent only. The Area
 * and Salon are both freshly re-validated against the live database
 * at write time — a MERGED status from the past is never trusted as
 * a standing guarantee that the referenced Area is still valid.
 *
 * Concurrency safety comes from the atomic conditional
 * findOneAndUpdate's `areaRef: null` predicate, not from the
 * preceding validation reads.
 */

import mongoose from "mongoose";
import AreaDiscoveryCandidate, { CANDIDATE_STATUS } from "../models/AreaDiscoveryCandidate.js";
import Area from "../models/Area.js";
import Salon from "../models/Salon.js";
import { Errors, successResponse } from "../utils/response.js";
import { logAdminAction } from "../utils/auditLog.js";
import { AUDIT_ACTIONS } from "../utils/auditActions.js";

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const sameId = (a, b) => String(a) === String(b);

/**
 * POST /api/admin/area-discovery-candidates/:candidateId/resolve-salon
 * INDIA admin only.
 */
export const resolveSalonToCandidateArea = async (req, res, next) => {
  try {
    const { candidateId } = req.params;
    const { salonId } = req.body;

    if (!isValidId(candidateId)) return next(Errors.badRequest("Invalid candidate ID"));
    if (!isValidId(salonId)) return next(Errors.badRequest("Invalid salon ID"));

    // ── 1. Load candidate, require MERGED + matchedAreaRef ──────────
    const candidate = await AreaDiscoveryCandidate.findById(candidateId).lean();
    if (!candidate) return next(Errors.notFound("Candidate not found"));
    if (candidate.status !== CANDIDATE_STATUS.MERGED) {
      return next(Errors.conflict(`Candidate is ${candidate.status}, not MERGED — resolution requires a confirmed MERGED decision`));
    }
    if (!candidate.matchedAreaRef) {
      return next(Errors.conflict("Candidate is MERGED but has no matchedAreaRef — cannot resolve"));
    }

    // ── 2. Fresh Area validation — the historical MERGED decision is
    // never trusted as a permanent guarantee; the live Area record
    // must still satisfy current canonical-identity/geography safety
    // requirements at write time. ──────────────────────────────────
    const area = await Area.findById(candidate.matchedAreaRef).lean();
    if (!area) return next(Errors.notFound("The candidate's matched Area no longer exists"));
    if (!area.isActive) return next(Errors.conflict("The candidate's matched Area is inactive"));
    if (area.isDeleted) return next(Errors.conflict("The candidate's matched Area has been deleted"));
    if (!sameId(area.cityRef, candidate.cityRef) || !sameId(area.districtRef, candidate.districtRef) || !sameId(area.stateRef, candidate.stateRef)) {
      return next(Errors.conflict("The candidate's matched Area no longer belongs to the candidate's own geography"));
    }

    // ── 3. Fresh Salon validation ────────────────────────────────────
    const salon = await Salon.findById(salonId).lean();
    if (!salon) return next(Errors.notFound("Salon not found"));
    if (salon.isDeleted) return next(Errors.conflict("Salon has been deleted"));
    const salonTerritory = salon.location?.territory || {};
    if (
      !sameId(salonTerritory.cityRef, candidate.cityRef) ||
      !sameId(salonTerritory.districtRef, candidate.districtRef) ||
      !sameId(salonTerritory.stateRef, candidate.stateRef)
    ) {
      return next(Errors.conflict("Salon geography does not match the candidate's geography"));
    }
    if (salonTerritory.areaRef) {
      return next(Errors.conflict("Salon already has an Area assigned — reassignment is out of scope for this operation"));
    }

    // ── 4. Atomic conditional write — the real concurrency authority,
    // not the pre-check above. ───────────────────────────────────────
    const updated = await Salon.findOneAndUpdate(
      { _id: salonId, "location.territory.areaRef": null },
      { $set: { "location.territory.areaRef": candidate.matchedAreaRef } },
      { new: true }
    ).select("_id location.territory.areaRef").lean();

    if (!updated) {
      return next(Errors.conflict("Salon's Area was assigned concurrently by another request — no change made"));
    }

    // ── 5. Fire-and-forget audit — only after the write succeeded,
    // same convention as every other Area-related admin action.
    logAdminAction({
      adminId:    req.user.id,
      action:     AUDIT_ACTIONS.SALON_AREA_RESOLVED,
      targetType: "SALON",
      targetId:   salon._id,
      meta: {
        salonId:     String(salon._id),
        candidateId: String(candidate._id),
        areaId:      String(candidate.matchedAreaRef),
      },
      req,
    });

    return successResponse(res, {
      message: "Salon resolved to candidate's matched Area",
      data: {
        salonId: String(updated._id),
        candidateId: String(candidate._id),
        areaId: String(candidate.matchedAreaRef),
      },
    });
  } catch (err) { next(err) }
};
