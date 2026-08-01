//////////////////////////////////////////////////////////////
// CHAIR AVAILABILITY ENGINE — CONTROLLER (PHASE 1, BACKEND ONLY)
//
// Thin HTTP layer only — all business rules (past-date guard,
// booking/block overlap validation, buffer-aware occupancy) live
// in chairAvailability.service.js. Every handler is wrapped by
// express-async-handler at the route level, so thrown AppErrors
// (from utils/response.js's Errors.*) are forwarded to the global
// errorHandler automatically — no try/catch needed here.
//////////////////////////////////////////////////////////////

import {
  createChairBlock,
  cancelChairBlock,
  listChairBlocks,
  getChairBlockById,
} from "../services/chairAvailability.service.js";

import { successResponse, Errors } from "../utils/response.js";

///////////////////////////////////////////////////////////
// POST /api/salon/owner/chairs/availability
// Body: { chairId, date, startTime, endTime, reason?, type? }
///////////////////////////////////////////////////////////

export const createBlock = async (req, res) => {
  const ownerId = req.user?._id;
  if (!ownerId) throw Errors.unauthorized("Authentication required");

  const { chairId, date, startTime, endTime, reason, type } = req.body;

  const block = await createChairBlock({ ownerId, chairId, date, startTime, endTime, reason, type });

  return successResponse(res, {
    statusCode: 201,
    message:    `Chair blocked from ${startTime} to ${endTime} on ${date}`,
    data:       block,
  });
};

///////////////////////////////////////////////////////////
// GET /api/salon/owner/chairs/availability?date=&chairId=&status=
///////////////////////////////////////////////////////////

export const listBlocks = async (req, res) => {
  const ownerId = req.user?._id;
  if (!ownerId) throw Errors.unauthorized("Authentication required");

  const { date, chairId, status } = req.query;

  const blocks = await listChairBlocks({ ownerId, date, chairId, status });

  return successResponse(res, {
    message: "Chair availability blocks fetched",
    data:    blocks,
    meta:    { count: blocks.length },
  });
};

///////////////////////////////////////////////////////////
// GET /api/salon/owner/chairs/availability/:id
///////////////////////////////////////////////////////////

export const getBlock = async (req, res) => {
  const ownerId = req.user?._id;
  if (!ownerId) throw Errors.unauthorized("Authentication required");

  const block = await getChairBlockById({ ownerId, blockId: req.params.id });

  return successResponse(res, {
    message: "Chair availability block fetched",
    data:    block,
  });
};

///////////////////////////////////////////////////////////
// PATCH /api/salon/owner/chairs/availability/:id/cancel
///////////////////////////////////////////////////////////

export const cancelBlock = async (req, res) => {
  const ownerId = req.user?._id;
  if (!ownerId) throw Errors.unauthorized("Authentication required");

  const block = await cancelChairBlock({ ownerId, blockId: req.params.id });

  return successResponse(res, {
    message: "Chair block cancelled",
    data:    block,
  });
};
