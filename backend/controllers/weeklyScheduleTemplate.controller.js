//////////////////////////////////////////////////////////////
// WEEKLY SCHEDULE TEMPLATE ENGINE — CONTROLLER (C4 Phase 1)
//
// Thin HTTP layer only — all business rules live in
// services/weeklyScheduleTemplate.service.js. Mirrors
// controllers/professionalChairAssignment.controller.js's exact
// pattern.
//////////////////////////////////////////////////////////////

import {
  createTemplate,
  listTemplates,
  getTemplateById,
  updateTemplate,
  cancelTemplate,
} from "../services/weeklyScheduleTemplate.service.js";

import { toTemplateDTO, toTemplateListDTO } from "../dto/weeklyScheduleTemplate.dto.js";
import { successResponse, Errors } from "../utils/response.js";

///////////////////////////////////////////////////////////
// POST /api/salon/owner/weekly-schedule-templates
///////////////////////////////////////////////////////////

export const createTemplateHandler = async (req, res) => {
  const ownerId = req.user?._id;
  if (!ownerId) throw Errors.unauthorized("Authentication required");

  const template = await createTemplate({ ownerId, ...req.body });

  return successResponse(res, {
    statusCode: 201,
    message:    "Schedule version created",
    data:       toTemplateDTO(template),
  });
};

///////////////////////////////////////////////////////////
// GET /api/salon/owner/weekly-schedule-templates
///////////////////////////////////////////////////////////

export const listTemplatesHandler = async (req, res) => {
  const ownerId = req.user?._id;
  if (!ownerId) throw Errors.unauthorized("Authentication required");

  const { status, page, limit } = req.query;
  const { items, pagination } = await listTemplates({ ownerId, status, page, limit });

  return successResponse(res, {
    message:    "Schedule versions fetched",
    data:       toTemplateListDTO(items),
    pagination,
  });
};

///////////////////////////////////////////////////////////
// GET /api/salon/owner/weekly-schedule-templates/:id
///////////////////////////////////////////////////////////

export const getTemplateHandler = async (req, res) => {
  const ownerId = req.user?._id;
  if (!ownerId) throw Errors.unauthorized("Authentication required");

  const template = await getTemplateById({ ownerId, templateId: req.params.id });

  return successResponse(res, {
    message: "Schedule version fetched",
    data:    toTemplateDTO(template),
  });
};

///////////////////////////////////////////////////////////
// PATCH /api/salon/owner/weekly-schedule-templates/:id
///////////////////////////////////////////////////////////

export const updateTemplateHandler = async (req, res) => {
  const ownerId = req.user?._id;
  if (!ownerId) throw Errors.unauthorized("Authentication required");

  const template = await updateTemplate({ ownerId, templateId: req.params.id, payload: req.body });

  return successResponse(res, {
    message: "Schedule version updated",
    data:    toTemplateDTO(template),
  });
};

///////////////////////////////////////////////////////////
// PATCH /api/salon/owner/weekly-schedule-templates/:id/status
// (cancel — one-directional, idempotent; matches
// professionalChairAssignment.controller.js::cancelAssignmentHandler)
///////////////////////////////////////////////////////////

export const cancelTemplateHandler = async (req, res) => {
  const ownerId = req.user?._id;
  if (!ownerId) throw Errors.unauthorized("Authentication required");

  const template = await cancelTemplate({ ownerId, templateId: req.params.id });

  return successResponse(res, {
    message: "Schedule version cancelled",
    data:    toTemplateDTO(template),
  });
};
