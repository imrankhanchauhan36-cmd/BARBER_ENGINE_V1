/**
 * BARBER ENGINE V1
 * backend/controllers/areaDiscoveryMatch.controller.js
 *
 * AREA-2.5.2 — read-only match-preview endpoint. Deliberately a new
 * file, not added into the frozen areaDiscoveryCandidate.controller.js,
 * so that AREA-2.5.1's controller stays byte-for-byte untouched.
 *
 * Zero writes. Never modifies AreaDiscoveryCandidate.matchedAreaRef,
 * never creates/modifies an Area. Geography is read exclusively from
 * the stored candidate — no client-supplied cityRef/districtRef/
 * stateRef is ever accepted or used.
 */

import mongoose from "mongoose";
import AreaDiscoveryCandidate from "../models/AreaDiscoveryCandidate.js";
import { matchCandidateAgainstAreas } from "../services/areaDiscoveryMatching.service.js";
import { Errors, successResponse } from "../utils/response.js";

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

/**
 * GET /api/admin/area-discovery-candidates/:candidateId/match-preview
 * Same authorization/scope pattern as getAreaDiscoveryCandidateById
 * (AREA-2.5.1, unmodified) — INDIA/STATE/DISTRICT, scoped to the
 * candidate's own stateRef/districtRef.
 */
export const previewCandidateMatch = async (req, res, next) => {
  try {
    const { candidateId } = req.params;
    if (!isValidId(candidateId)) return next(Errors.badRequest("Invalid candidate ID"));

    const candidate = await AreaDiscoveryCandidate.findById(candidateId).lean();
    if (!candidate) return next(Errors.notFound("Candidate not found"));

    if (req.user.adminLevel === "STATE" && String(req.user.stateRef) !== String(candidate.stateRef)) {
      return next(Errors.forbidden("Access denied"));
    }
    if (req.user.adminLevel === "DISTRICT" && String(req.user.districtRef) !== String(candidate.districtRef)) {
      return next(Errors.forbidden("Access denied"));
    }

    const result = await matchCandidateAgainstAreas({
      cityRef: candidate.cityRef,
      districtRef: candidate.districtRef,
      stateRef: candidate.stateRef,
      normalizedCandidateName: candidate.normalizedCandidateName,
      rawObservedNames: candidate.rawObservedNames,
    });

    return successResponse(res, {
      message: "Match preview computed",
      data: {
        candidateId: String(candidate._id),
        classification: result.classification,
        matches: result.matches,
        reason: result.reason,
      },
    });
  } catch (err) { next(err) }
};
