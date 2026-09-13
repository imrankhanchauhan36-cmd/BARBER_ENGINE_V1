/**
 * BARBER ENGINE V1
 * backend/controllers/areaServiceability.controller.js
 *
 * AREA-2.4.1 — hardened admin CRUD for Area-level serviceability.
 *
 * Deliberately mirrors location.controller.js's createArea/getAreaById
 * conventions exactly (Errors/successResponse, inline try/catch,
 * scope checks) rather than inventing a parallel framework. Reuses
 * the existing audit convention (logAdminAction/AUDIT_ACTIONS) and the
 * existing global E11000 -> 409 translation in errorHandler.js.
 *
 * Write access (configure/transition) is INDIA-admin-only for V1 —
 * the safest currently-approved boundary, since whether STATE/DISTRICT
 * admins should ever get write access remains an explicitly open
 * business decision (AREA-2.4 audit §V.1), not invented here. Read
 * access follows the existing INDIA/STATE/DISTRICT + geography-scope
 * pattern already proven in getAreaById.
 *
 * This file does not create, modify, or reference any Territory,
 * AcquisitionClaim, SalonAttribution, or ServiceZone code — those
 * remain completely untouched, per AREA-2.4.1's explicit scope
 * boundary.
 */

import mongoose from "mongoose";
import Area from "../models/Area.js";
import AreaServiceability, {
  AREA_SERVICEABILITY_STATUS,
  VALID_SERVICEABILITY_TRANSITIONS,
} from "../models/AreaServiceability.js";
import { Errors, successResponse } from "../utils/response.js";
import { logAdminAction } from "../utils/auditLog.js";
import { AUDIT_ACTIONS } from "../utils/auditActions.js";

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// Fail-closed computed flag (AREA-2.4 audit "FAIL-CLOSED BEHAVIOR"
// section) — informational only on this admin read endpoint. Not
// wired into booking/discovery/search in this phase.
const computeIsCurrentlyServiceable = (doc) => {
  if (!doc || doc.status !== AREA_SERVICEABILITY_STATUS.ACTIVE) return false;
  const now = new Date();
  if (doc.effectiveFrom && now < doc.effectiveFrom) return false;
  if (doc.effectiveUntil && now > doc.effectiveUntil) return false;
  return true;
};

const loadAreaOrFail = async (areaId) => {
  const area = await Area.findById(areaId).lean();
  if (!area || area.isDeleted) return null;
  return area;
};

/**
 * POST /api/admin/areas/:areaId/serviceability
 * Configure (create) — the NOT_CONFIGURED -> PENDING transition.
 * INDIA admin only.
 */
export const configureAreaServiceability = async (req, res, next) => {
  try {
    const { areaId } = req.params;
    if (!isValidId(areaId)) return next(Errors.badRequest("Invalid area ID"));

    const area = await loadAreaOrFail(areaId);
    if (!area) return next(Errors.notFound("Area not found or deleted"));
    if (!area.isActive) return next(Errors.conflict("Area is inactive — cannot configure serviceability"));

    const { effectiveFrom, effectiveUntil, reason } = req.body;

    if (effectiveFrom && effectiveUntil && new Date(effectiveUntil) <= new Date(effectiveFrom)) {
      return next(Errors.badRequest("effectiveUntil must be after effectiveFrom"));
    }

    // Friendly pre-check only — the unique index on areaRef is the
    // real concurrency authority (see the race test in the
    // verification script; a race here surfaces as the existing
    // global E11000 -> 409 translation, not a duplicate document).
    const existing = await AreaServiceability.findOne({ areaRef: areaId }).lean();
    if (existing) {
      return next(Errors.conflict(`Serviceability is already configured for this Area (status: ${existing.status})`));
    }

    const doc = await AreaServiceability.create({
      areaRef:        areaId,
      status:         AREA_SERVICEABILITY_STATUS.PENDING,
      effectiveFrom:  effectiveFrom ?? null,
      effectiveUntil: effectiveUntil ?? null,
      updatedBy:      req.user.id,
      reason:         reason ?? null,
    });

    logAdminAction({
      adminId:    req.user.id,
      action:     AUDIT_ACTIONS.AREA_SERVICEABILITY_STATUS_CHANGED,
      targetType: "AREA_SERVICEABILITY",
      targetId:   doc._id,
      meta: {
        areaId,
        oldStatus: null,
        newStatus: AREA_SERVICEABILITY_STATUS.PENDING,
        reason:    doc.reason,
        effectiveFrom: doc.effectiveFrom,
        effectiveUntil: doc.effectiveUntil,
      },
      req,
    });

    return successResponse(res, {
      message: "Area serviceability configured",
      data: {
        id: doc._id,
        areaId,
        status: doc.status,
        effectiveFrom: doc.effectiveFrom,
        effectiveUntil: doc.effectiveUntil,
        reason: doc.reason,
        isCurrentlyServiceable: computeIsCurrentlyServiceable(doc),
      },
    });
  } catch (err) { next(err) }
};

/**
 * PATCH /api/admin/areas/:areaId/serviceability
 * Transition an existing serviceability document. INDIA admin only.
 *
 * Uses a single atomic conditional findOneAndUpdate (matching on the
 * expected current status), not findOne-then-save — the same
 * concurrency-safety primitive already proven elsewhere in this
 * codebase (e.g. SupportAgentWorkload's reserveAgentCapacity).
 */
export const transitionAreaServiceability = async (req, res, next) => {
  try {
    const { areaId } = req.params;
    if (!isValidId(areaId)) return next(Errors.badRequest("Invalid area ID"));

    const { targetStatus, reason, effectiveFrom, effectiveUntil } = req.body;

    const current = await AreaServiceability.findOne({ areaRef: areaId }).lean();
    if (!current) {
      return next(Errors.notFound("Serviceability is not configured for this Area (NOT_CONFIGURED) — use configure first"));
    }

    const allowedTargets = VALID_SERVICEABILITY_TRANSITIONS[current.status] || [];
    if (!allowedTargets.includes(targetStatus)) {
      return next(Errors.conflict(
        `Cannot transition from ${current.status} to ${targetStatus}. Allowed: ${allowedTargets.join(", ") || "none (terminal state)"}`
      ));
    }

    if (targetStatus === AREA_SERVICEABILITY_STATUS.ACTIVE) {
      const area = await loadAreaOrFail(areaId);
      if (!area) return next(Errors.notFound("Area not found or deleted — cannot activate serviceability"));
      if (!area.isActive) return next(Errors.conflict("Area is inactive — cannot activate serviceability"));
    }

    // Explicit here rather than relying solely on the schema-level
    // cross-field validator: Mongoose update validators run against
    // the query, not a hydrated document, so `this.effectiveFrom`
    // inside the schema validator cannot reliably see a sibling value
    // being set in the same $set — the schema validator still exists
    // as defense-in-depth (e.g. direct document saves), but the real
    // guarantee for this API path is this explicit check.
    const resolvedFrom  = effectiveFrom  !== undefined ? effectiveFrom  : current.effectiveFrom;
    const resolvedUntil = effectiveUntil !== undefined ? effectiveUntil : current.effectiveUntil;
    if (resolvedFrom && resolvedUntil && new Date(resolvedUntil) <= new Date(resolvedFrom)) {
      return next(Errors.badRequest("effectiveUntil must be after effectiveFrom"));
    }

    const update = {
      status:    targetStatus,
      updatedBy: req.user.id,
      reason,
    };
    if (effectiveFrom !== undefined)  update.effectiveFrom  = effectiveFrom;
    if (effectiveUntil !== undefined) update.effectiveUntil = effectiveUntil;

    // Atomic, conditional on the status we just read — if another
    // request changed it in between, this matches zero documents and
    // we report a deterministic conflict rather than clobbering it.
    const updated = await AreaServiceability.findOneAndUpdate(
      { areaRef: areaId, status: current.status },
      { $set: update },
      { new: true, runValidators: true }
    );

    if (!updated) {
      const latest = await AreaServiceability.findOne({ areaRef: areaId }).lean();
      return next(Errors.conflict(
        `Serviceability status changed concurrently (now: ${latest?.status ?? "unknown"}). Retry with the current status.`
      ));
    }

    logAdminAction({
      adminId:    req.user.id,
      action:     AUDIT_ACTIONS.AREA_SERVICEABILITY_STATUS_CHANGED,
      targetType: "AREA_SERVICEABILITY",
      targetId:   updated._id,
      meta: {
        areaId,
        oldStatus: current.status,
        newStatus: updated.status,
        reason:    updated.reason,
        effectiveFrom: updated.effectiveFrom,
        effectiveUntil: updated.effectiveUntil,
      },
      req,
    });

    return successResponse(res, {
      message: "Area serviceability updated",
      data: {
        id: updated._id,
        areaId,
        status: updated.status,
        effectiveFrom: updated.effectiveFrom,
        effectiveUntil: updated.effectiveUntil,
        reason: updated.reason,
        isCurrentlyServiceable: computeIsCurrentlyServiceable(updated),
      },
    });
  } catch (err) { next(err) }
};

/**
 * GET /api/admin/areas/:areaId/serviceability
 * INDIA/STATE/DISTRICT, scoped exactly like getAreaById.
 */
export const getAreaServiceability = async (req, res, next) => {
  try {
    const { areaId } = req.params;
    if (!isValidId(areaId)) return next(Errors.badRequest("Invalid area ID"));

    const area = await Area.findById(areaId).select("stateRef districtRef isDeleted").lean();
    if (!area || area.isDeleted) return next(Errors.notFound("Area not found"));

    if (req.user.adminLevel === "STATE" && String(req.user.stateRef) !== String(area.stateRef)) {
      return next(Errors.forbidden("Access denied"));
    }
    if (req.user.adminLevel === "DISTRICT" && String(req.user.districtRef) !== String(area.districtRef)) {
      return next(Errors.forbidden("Access denied"));
    }

    const doc = await AreaServiceability.findOne({ areaRef: areaId }).lean();

    return successResponse(res, {
      message: "Area serviceability fetched",
      data: {
        areaId,
        status: doc ? doc.status : "NOT_CONFIGURED",
        effectiveFrom: doc?.effectiveFrom ?? null,
        effectiveUntil: doc?.effectiveUntil ?? null,
        reason: doc?.reason ?? null,
        updatedBy: doc?.updatedBy ?? null,
        isCurrentlyServiceable: computeIsCurrentlyServiceable(doc),
      },
    });
  } catch (err) { next(err) }
};
