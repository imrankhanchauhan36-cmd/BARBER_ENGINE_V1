//////////////////////////////////////////////////////////////
// PROFESSIONAL ENGINE — CONTROLLER (PHASE 1, BACKEND FOUNDATION ONLY)
//
// Thin HTTP layer only — all business rules live in
// services/professional.service.js. Every handler is wrapped by
// express-async-handler at the route level, so thrown AppErrors
// (from utils/response.js's Errors.*) are forwarded to the global
// errorHandler automatically — no try/catch needed here. Mirrors
// controllers/chairAvailability.controller.js's exact pattern.
//////////////////////////////////////////////////////////////

import {
  createProfessional,
  listProfessionals,
  getProfessionalById,
  updateProfessional,
  setProfessionalStatus,
} from "../services/professional.service.js";

import { toProfessionalDTO, toProfessionalListDTO } from "../dto/professional.dto.js";
import { successResponse, Errors } from "../utils/response.js";

///////////////////////////////////////////////////////////
// POST /api/salon/owner/professionals
///////////////////////////////////////////////////////////

export const createProfessionalHandler = async (req, res) => {
  const ownerId = req.user?._id;
  if (!ownerId) throw Errors.unauthorized("Authentication required");

  const staff = await createProfessional({ ownerId, payload: req.body });

  return successResponse(res, {
    statusCode: 201,
    message:    "Professional added successfully",
    data:       toProfessionalDTO(staff),
  });
};

///////////////////////////////////////////////////////////
// GET /api/salon/owner/professionals?page=&limit=&status=
///////////////////////////////////////////////////////////

export const listProfessionalsHandler = async (req, res) => {
  const ownerId = req.user?._id;
  if (!ownerId) throw Errors.unauthorized("Authentication required");

  const { page, limit, status, serviceId } = req.query;
  const { items, pagination } = await listProfessionals({ ownerId, page, limit, status, serviceId });

  return successResponse(res, {
    message:    "Professionals fetched",
    data:       toProfessionalListDTO(items),
    pagination,
  });
};

///////////////////////////////////////////////////////////
// GET /api/salon/owner/professionals/:id
///////////////////////////////////////////////////////////

export const getProfessionalHandler = async (req, res) => {
  const ownerId = req.user?._id;
  if (!ownerId) throw Errors.unauthorized("Authentication required");

  const staff = await getProfessionalById({ ownerId, professionalId: req.params.id });

  return successResponse(res, {
    message: "Professional fetched",
    data:    toProfessionalDTO(staff),
  });
};

///////////////////////////////////////////////////////////
// PATCH /api/salon/owner/professionals/:id
///////////////////////////////////////////////////////////

export const updateProfessionalHandler = async (req, res) => {
  const ownerId = req.user?._id;
  if (!ownerId) throw Errors.unauthorized("Authentication required");

  const staff = await updateProfessional({ ownerId, professionalId: req.params.id, payload: req.body });

  return successResponse(res, {
    message: "Professional updated",
    data:    toProfessionalDTO(staff),
  });
};

///////////////////////////////////////////////////////////
// PATCH /api/salon/owner/professionals/:id/status
///////////////////////////////////////////////////////////

export const setProfessionalStatusHandler = async (req, res) => {
  const ownerId = req.user?._id;
  if (!ownerId) throw Errors.unauthorized("Authentication required");

  const { isActive, reason } = req.body;
  const staff = await setProfessionalStatus({ ownerId, professionalId: req.params.id, isActive, reason });

  return successResponse(res, {
    message: isActive ? "Professional activated" : "Professional deactivated",
    data:    toProfessionalDTO(staff),
  });
};
