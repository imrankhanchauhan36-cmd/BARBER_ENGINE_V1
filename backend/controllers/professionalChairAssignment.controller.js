//////////////////////////////////////////////////////////////
// PROFESSIONAL ↔ CHAIR ASSIGNMENT ENGINE — CONTROLLER (PHASE 3)
//
// Thin HTTP layer only — all business rules live in
// services/professionalChairAssignment.service.js. Mirrors
// controllers/chairAvailability.controller.js's exact pattern.
//////////////////////////////////////////////////////////////

import {
  createAssignment,
  listAssignments,
  getAssignmentById,
  updateAssignment,
  cancelAssignment,
} from "../services/professionalChairAssignment.service.js";

import { toAssignmentDTO, toAssignmentListDTO } from "../dto/professionalChairAssignment.dto.js";
import { successResponse, Errors } from "../utils/response.js";

///////////////////////////////////////////////////////////
// POST /api/salon/owner/professional-chair-assignments
///////////////////////////////////////////////////////////

export const createAssignmentHandler = async (req, res) => {
  const ownerId = req.user?._id;
  if (!ownerId) throw Errors.unauthorized("Authentication required");

  const created = await createAssignment({ ownerId, ...req.body });

  return successResponse(res, {
    statusCode: 201,
    message:    `${created.length} assignment${created.length > 1 ? "s" : ""} created`,
    data:       toAssignmentListDTO(created),
  });
};

///////////////////////////////////////////////////////////
// GET /api/salon/owner/professional-chair-assignments
///////////////////////////////////////////////////////////

export const listAssignmentsHandler = async (req, res) => {
  const ownerId = req.user?._id;
  if (!ownerId) throw Errors.unauthorized("Authentication required");

  const { date, chairId, professionalId, status, page, limit } = req.query;
  const { items, pagination } = await listAssignments({ ownerId, date, chairId, professionalId, status, page, limit });

  return successResponse(res, {
    message:    "Assignments fetched",
    data:       toAssignmentListDTO(items),
    pagination,
  });
};

///////////////////////////////////////////////////////////
// GET /api/salon/owner/professional-chair-assignments/:id
///////////////////////////////////////////////////////////

export const getAssignmentHandler = async (req, res) => {
  const ownerId = req.user?._id;
  if (!ownerId) throw Errors.unauthorized("Authentication required");

  const assignment = await getAssignmentById({ ownerId, assignmentId: req.params.id });

  return successResponse(res, {
    message: "Assignment fetched",
    data:    toAssignmentDTO(assignment),
  });
};

///////////////////////////////////////////////////////////
// PATCH /api/salon/owner/professional-chair-assignments/:id
///////////////////////////////////////////////////////////

export const updateAssignmentHandler = async (req, res) => {
  const ownerId = req.user?._id;
  if (!ownerId) throw Errors.unauthorized("Authentication required");

  const assignment = await updateAssignment({ ownerId, assignmentId: req.params.id, payload: req.body });

  return successResponse(res, {
    message: "Assignment updated",
    data:    toAssignmentDTO(assignment),
  });
};

///////////////////////////////////////////////////////////
// PATCH /api/salon/owner/professional-chair-assignments/:id/status
// (cancel — one-directional, idempotent; matches
// chairAvailability.controller.js::cancelBlock exactly)
///////////////////////////////////////////////////////////

export const cancelAssignmentHandler = async (req, res) => {
  const ownerId = req.user?._id;
  if (!ownerId) throw Errors.unauthorized("Authentication required");

  const assignment = await cancelAssignment({ ownerId, assignmentId: req.params.id });

  return successResponse(res, {
    message: "Assignment cancelled",
    data:    toAssignmentDTO(assignment),
  });
};
