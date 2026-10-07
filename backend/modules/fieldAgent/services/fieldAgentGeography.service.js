/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/fieldAgentGeography.service.js
 *
 * MUST-DO-NOW #5 — PHASE A — minimal primitives over
 * FieldAgentGeographyAssignment (canonical Field Agent ADMINISTRATIVE
 * geography only — see that model's own header for why this is
 * deliberately separate from TerritoryAssignment/CommercialTerritory).
 *
 * No controller/route is wired to these yet (Phase B/C) and no RBAC
 * filtering is applied here — admin identity (`assignedBy`/`endedBy`)
 * is always supplied by the caller, which is responsible (in a later
 * phase) for sourcing it from req.user, never from client input.
 *
 * Reassignment is deliberately NOT atomic-swap-in-one-call: ending an
 * existing ACTIVE assignment and creating a new one are two separate,
 * explicit service calls (END, then ASSIGN) — this function set never
 * auto-ends a prior assignment on the caller's behalf.
 */

import mongoose from "mongoose";
import FieldAgent from "../models/FieldAgent.js";
import FieldAgentGeographyAssignment from "../models/FieldAgentGeographyAssignment.js";
import State from "../../../models/State.js";
import District from "../../../models/District.js";
import { Errors } from "../../../utils/response.js";

// Same convention as commercialTerritory.service.js — no shared
// validateId util exists in this codebase; each service defines its
// own local check.
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// ─── ASSIGN ─────────────────────────────────────────────────────────
// Create-once. Never overwrites or ends an existing ACTIVE assignment
// — if one exists, this is a conflict the caller must resolve via an
// explicit endFieldAgentGeography() first. The partial unique index on
// {fieldAgentRef,status:"ACTIVE"} is the final, DB-level backstop
// against a concurrent double-assign; the pre-check below is only a
// fast, friendlier failure path, not the real guarantee.
export const assignFieldAgentGeography = async ({ fieldAgentRef, stateRef, districtRef = null, assignedBy }) => {
  if (!isValidId(fieldAgentRef)) throw Errors.badRequest("Invalid fieldAgentRef");
  if (!isValidId(stateRef)) throw Errors.badRequest("Invalid stateRef");
  if (districtRef !== null && districtRef !== undefined && !isValidId(districtRef)) {
    throw Errors.badRequest("Invalid districtRef");
  }
  if (!isValidId(assignedBy)) throw Errors.badRequest("assignedBy is required");

  const fieldAgent = await FieldAgent.findById(fieldAgentRef).select("_id").lean();
  if (!fieldAgent) throw Errors.notFound("Field Agent not found");

  const state = await State.findById(stateRef).select("_id").lean();
  if (!state) throw Errors.notFound("State not found");

  let resolvedDistrictRef = null;
  if (districtRef) {
    const district = await District.findById(districtRef).select("_id stateRef").lean();
    if (!district) throw Errors.notFound("District not found");
    if (String(district.stateRef) !== String(stateRef)) {
      throw Errors.badRequest("districtRef does not belong to the given stateRef");
    }
    resolvedDistrictRef = district._id;
  }

  const existingActive = await FieldAgentGeographyAssignment.findOne({
    fieldAgentRef,
    status: "ACTIVE",
  }).lean();
  if (existingActive) {
    throw Errors.conflict("Field Agent already has an ACTIVE geography assignment — end it before assigning a new one");
  }

  try {
    const created = await FieldAgentGeographyAssignment.create({
      fieldAgentRef,
      stateRef: state._id,
      districtRef: resolvedDistrictRef,
      status: "ACTIVE",
      assignedBy,
      effectiveFrom: new Date(),
      effectiveUntil: null,
    });
    return created;
  } catch (err) {
    if (err.code === 11000) {
      throw Errors.conflict("Field Agent already has an ACTIVE geography assignment — end it before assigning a new one");
    }
    throw err;
  }
};

// ─── END ────────────────────────────────────────────────────────────
// Idempotent on an already-ENDED assignment (returns it unchanged —
// never creates a second history row for the same end event). History
// is otherwise immutable: fieldAgentRef/stateRef/districtRef/
// assignedBy/effectiveFrom are never touched here.
export const endFieldAgentGeography = async ({ assignmentId, endedBy, endReason = null }) => {
  if (!isValidId(assignmentId)) throw Errors.badRequest("Invalid assignmentId");
  if (!isValidId(endedBy)) throw Errors.badRequest("endedBy is required");

  const assignment = await FieldAgentGeographyAssignment.findById(assignmentId);
  if (!assignment) throw Errors.notFound("Field Agent geography assignment not found");

  if (assignment.status === "ENDED") {
    return assignment;
  }

  assignment.status = "ENDED";
  assignment.effectiveUntil = new Date();
  assignment.endReason = endReason;
  assignment.endedBy = endedBy;
  await assignment.save();

  return assignment;
};

// ─── READ ───────────────────────────────────────────────────────────

export const getActiveFieldAgentGeography = async (fieldAgentRef) => {
  if (!isValidId(fieldAgentRef)) throw Errors.badRequest("Invalid fieldAgentRef");
  return FieldAgentGeographyAssignment.findOne({ fieldAgentRef, status: "ACTIVE" }).lean();
};

export const getFieldAgentGeographyHistory = async (fieldAgentRef) => {
  if (!isValidId(fieldAgentRef)) throw Errors.badRequest("Invalid fieldAgentRef");
  return FieldAgentGeographyAssignment.find({ fieldAgentRef })
    .sort({ effectiveFrom: -1 })
    .lean();
};

// Same read as getActiveFieldAgentGeography, named distinctly for
// Phase C's own call sites (RBAC resolution) — kept as a thin,
// explicit alias rather than overloading one function's meaning, so
// a future RBAC change to this function never has to guess whether a
// generic "get active" caller also expected RBAC semantics.
export const resolveFieldAgentGeography = async (fieldAgentRef) => {
  return getActiveFieldAgentGeography(fieldAgentRef);
};
