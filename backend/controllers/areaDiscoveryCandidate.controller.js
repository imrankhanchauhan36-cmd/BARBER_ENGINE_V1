/**
 * BARBER ENGINE V1
 * backend/controllers/areaDiscoveryCandidate.controller.js
 *
 * AREA-2.5.1 — foundation only: schema-backed observation recording +
 * hardened admin review/read surface. NO normalization engine, NO
 * fuzzy/GPS matching, NO automatic Area creation. Approving a
 * candidate here only marks it "approved for eventual canonical
 * handling" — it never calls Area.create() and never bypasses the
 * existing, frozen createArea/AREA-2.2 governance.
 *
 * Authorization split (documented, not invented from nothing):
 * - "observe" mirrors createArea's own INDIA/STATE/DISTRICT write
 *   scope exactly (recording an observation is a lower-stakes action
 *   than creating canonical geography, so at most as permissive as
 *   Area creation, never more).
 * - "review" (approve/reject/merge) is INDIA-only, mirroring
 *   AreaServiceability's stricter governance-action precedent — no
 *   existing policy clearly supports delegating candidate approval
 *   authority, so the safest existing boundary is used rather than
 *   inventing delegation.
 */

import mongoose from "mongoose";
import City from "../models/City.js";
import District from "../models/District.js";
import State from "../models/State.js";
import Area from "../models/Area.js";
import AreaDiscoveryCandidate, {
  CANDIDATE_STATUS,
  VALID_CANDIDATE_TRANSITIONS,
  MAX_RAW_OBSERVED_NAMES,
  MAX_SOURCE_REFERENCES,
  MAX_SAMPLE_COORDINATES,
} from "../models/AreaDiscoveryCandidate.js";
import { Errors, successResponse } from "../utils/response.js";
import { logAdminAction } from "../utils/auditLog.js";
import { AUDIT_ACTIONS } from "../utils/auditActions.js";

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// Reused verbatim from Area.js's own pre("save") hook — no second
// normalization algorithm (AREA-2.5 audit §7/§9 explicitly forbids one).
const normalize = (name) => name.toLowerCase().trim().replace(/\s+/g, " ");

const resolveActiveCityChain = async (cityId) => {
  const city = await City.findById(cityId).lean();
  if (!city || !city.isActive || city.isDeleted) return null;

  const district = await District.findById(city.districtRef).lean();
  if (!district || !district.isActive || district.isDeleted) return null;

  const state = await State.findById(district.stateRef).lean();
  if (!state || !state.isActive || state.isDeleted) return null;

  return { city, district, state };
};

/**
 * POST /api/admin/area-discovery-candidates
 * Record/aggregate a single observation. INDIA/STATE/DISTRICT, scoped
 * exactly like createArea. Atomic upsert — the unique
 * {cityRef,normalizedCandidateName} index is the concurrency
 * authority, never a findOne-then-create pre-check.
 */
export const observeAreaDiscoveryCandidate = async (req, res, next) => {
  try {
    const { name, cityId, sourceType, sourceReference, coordinate } = req.body;

    const chain = await resolveActiveCityChain(cityId);
    if (!chain) return next(Errors.notFound("City not found or inactive"));
    const { city, district, state } = chain;

    // Scope check — identical pattern to createArea.
    if (req.user.adminLevel === "STATE" && String(req.user.stateRef) !== String(state._id)) {
      return next(Errors.forbidden("You can only observe candidates in your own state"));
    }
    if (req.user.adminLevel === "DISTRICT" && String(req.user.districtRef) !== String(district._id)) {
      return next(Errors.forbidden("You can only observe candidates in your own district"));
    }

    const trimmedName = name.trim().replace(/\s+/g, " ");
    const normalizedCandidateName = normalize(trimmedName);

    const pushOps = {
      rawObservedNames: { $each: [trimmedName], $slice: -MAX_RAW_OBSERVED_NAMES },
    };
    if (sourceReference) {
      pushOps.sourceReferences = { $each: [sourceReference], $slice: -MAX_SOURCE_REFERENCES };
    }
    if (coordinate) {
      pushOps.sampleCoordinates = { $each: [coordinate], $slice: -MAX_SAMPLE_COORDINATES };
    }

    // Single atomic upsert: converges concurrent observations of the
    // same {cityRef,normalizedCandidateName} onto one document — the
    // unique index (not this code) is what guarantees that under a
    // real race; this upsert form is what makes the race resolve
    // cleanly instead of throwing.
    const doc = await AreaDiscoveryCandidate.findOneAndUpdate(
      { cityRef: city._id, normalizedCandidateName },
      {
        $setOnInsert: {
          cityRef: city._id,
          districtRef: district._id, // server-derived, never client-supplied
          stateRef: state._id,       // server-derived, never client-supplied
          sourceType,
          status: CANDIDATE_STATUS.OBSERVED,
          firstSeenAt: new Date(),
        },
        $set: { lastSeenAt: new Date() },
        $inc: { observationCount: 1 },
        $push: pushOps,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    logAdminAction({
      adminId:    req.user.id,
      action:     AUDIT_ACTIONS.AREA_DISCOVERY_CANDIDATE_OBSERVED,
      targetType: "AREA_DISCOVERY_CANDIDATE",
      targetId:   doc._id,
      meta: { cityId: String(city._id), normalizedCandidateName, sourceType, observationCount: doc.observationCount },
      req,
    });

    return successResponse(res, {
      message: "Observation recorded",
      data: {
        id: doc._id,
        normalizedCandidateName: doc.normalizedCandidateName,
        cityId: String(doc.cityRef),
        status: doc.status,
        observationCount: doc.observationCount,
        firstSeenAt: doc.firstSeenAt,
        lastSeenAt: doc.lastSeenAt,
      },
    });
  } catch (err) { next(err) }
};

/**
 * GET /api/admin/area-discovery-candidates
 * INDIA/STATE/DISTRICT, scoped like getAreas. Paginated, bounded.
 */
export const listAreaDiscoveryCandidates = async (req, res, next) => {
  try {
    const { cityId, status, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(parseInt(page, 10), 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10), 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const filter = {};
    if (cityId) filter.cityRef = cityId;
    if (status) filter.status = status;
    if (req.user.adminLevel === "STATE") filter.stateRef = req.user.stateRef;
    if (req.user.adminLevel === "DISTRICT") filter.districtRef = req.user.districtRef;

    const [candidates, total] = await Promise.all([
      AreaDiscoveryCandidate.find(filter)
        .populate("cityRef", "name")
        .sort({ lastSeenAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      AreaDiscoveryCandidate.countDocuments(filter),
    ]);

    return successResponse(res, {
      message: "Area discovery candidates fetched",
      data: candidates.map((c) => ({
        id: c._id,
        normalizedCandidateName: c.normalizedCandidateName,
        rawObservedNames: c.rawObservedNames,
        city: { id: c.cityRef?._id, name: c.cityRef?.name },
        sourceType: c.sourceType,
        observationCount: c.observationCount,
        status: c.status,
        firstSeenAt: c.firstSeenAt,
        lastSeenAt: c.lastSeenAt,
      })),
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) || 1 },
    });
  } catch (err) { next(err) }
};

/**
 * GET /api/admin/area-discovery-candidates/:candidateId
 * INDIA/STATE/DISTRICT, scoped like getAreaById.
 */
export const getAreaDiscoveryCandidateById = async (req, res, next) => {
  try {
    const { candidateId } = req.params;
    if (!isValidId(candidateId)) return next(Errors.badRequest("Invalid candidate ID"));

    const candidate = await AreaDiscoveryCandidate.findById(candidateId)
      .populate("cityRef", "name")
      .populate("districtRef", "name")
      .populate("stateRef", "name")
      .populate("matchedAreaRef", "name")
      .lean();
    if (!candidate) return next(Errors.notFound("Candidate not found"));

    if (req.user.adminLevel === "STATE" && String(req.user.stateRef) !== String(candidate.stateRef?._id)) {
      return next(Errors.forbidden("Access denied"));
    }
    if (req.user.adminLevel === "DISTRICT" && String(req.user.districtRef) !== String(candidate.districtRef?._id)) {
      return next(Errors.forbidden("Access denied"));
    }

    return successResponse(res, { message: "Candidate fetched", data: candidate });
  } catch (err) { next(err) }
};

/**
 * PATCH /api/admin/area-discovery-candidates/:candidateId
 * INDIA admin only. Atomic conditional transition — same pattern as
 * AreaServiceability's transitionAreaServiceability.
 */
export const reviewAreaDiscoveryCandidate = async (req, res, next) => {
  try {
    const { candidateId } = req.params;
    if (!isValidId(candidateId)) return next(Errors.badRequest("Invalid candidate ID"));

    const { targetStatus, reviewNotes, matchedAreaId } = req.body;

    const current = await AreaDiscoveryCandidate.findById(candidateId).lean();
    if (!current) return next(Errors.notFound("Candidate not found"));

    const allowedTargets = VALID_CANDIDATE_TRANSITIONS[current.status] || [];
    if (!allowedTargets.includes(targetStatus)) {
      return next(Errors.conflict(
        `Cannot transition from ${current.status} to ${targetStatus}. Allowed: ${allowedTargets.join(", ") || "none (terminal state)"}`
      ));
    }

    let matchedArea = null;
    if (targetStatus === CANDIDATE_STATUS.MERGED) {
      matchedArea = await Area.findById(matchedAreaId).lean();
      if (!matchedArea || matchedArea.isDeleted) return next(Errors.notFound("matchedAreaId does not reference an existing Area"));
      if (String(matchedArea.cityRef) !== String(current.cityRef)) {
        return next(Errors.badRequest("matchedAreaId must belong to the candidate's own City"));
      }
    }

    const update = {
      status:      targetStatus,
      reviewedBy:  req.user.id,
      reviewedAt:  new Date(),
      reviewNotes,
    };
    if (matchedArea) update.matchedAreaRef = matchedArea._id;

    const updated = await AreaDiscoveryCandidate.findOneAndUpdate(
      { _id: candidateId, status: current.status },
      { $set: update },
      { new: true }
    );

    if (!updated) {
      const latest = await AreaDiscoveryCandidate.findById(candidateId).lean();
      return next(Errors.conflict(`Candidate status changed concurrently (now: ${latest?.status ?? "unknown"}). Retry with the current status.`));
    }

    logAdminAction({
      adminId:    req.user.id,
      action:     AUDIT_ACTIONS.AREA_DISCOVERY_CANDIDATE_REVIEWED,
      targetType: "AREA_DISCOVERY_CANDIDATE",
      targetId:   updated._id,
      meta: {
        oldStatus: current.status,
        newStatus: updated.status,
        reviewNotes: updated.reviewNotes,
        matchedAreaId: updated.matchedAreaRef ? String(updated.matchedAreaRef) : null,
      },
      req,
    });

    return successResponse(res, {
      message: "Candidate reviewed",
      data: {
        id: updated._id,
        status: updated.status,
        reviewedBy: updated.reviewedBy,
        reviewedAt: updated.reviewedAt,
        reviewNotes: updated.reviewNotes,
        matchedAreaRef: updated.matchedAreaRef,
      },
    });
  } catch (err) { next(err) }
};
