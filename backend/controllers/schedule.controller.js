//////////////////////////////////////////////////////////////
// UNIFIED SCHEDULE — CONTROLLER
//
// Thin HTTP layer only — all business rules live in
// services/schedule.service.js. Mirrors
// controllers/weeklyScheduleTemplate.controller.js's exact pattern.
// salonId is NEVER read from the request — every service function is
// handed only the authenticated ownerId and resolves its own salon
// from that, exactly like every other owner-scoped controller in this
// codebase, so an owner can never manipulate another salon's schedule
// by supplying a salonId of their choosing.
//////////////////////////////////////////////////////////////

import {
  getResolvedScheduleForDates,
  editScheduleForDate,
  restoreDateToMaster,
} from "../services/schedule.service.js";

import { toResolvedScheduleListDTO, toScheduleAssignmentDTO } from "../dto/schedule.dto.js";
import { successResponse, Errors } from "../utils/response.js";

///////////////////////////////////////////////////////////
// GET /api/salon/owner/schedule/resolved?dates=YYYY-MM-DD,...
///////////////////////////////////////////////////////////

export const getResolvedScheduleHandler = async (req, res) => {
  const ownerId = req.user?._id;
  if (!ownerId) throw Errors.unauthorized("Authentication required");

  const { dates } = req.query;
  const resolved = await getResolvedScheduleForDates({ ownerId, dates });

  return successResponse(res, {
    message: "Resolved schedule fetched",
    data:    toResolvedScheduleListDTO(resolved),
  });
};

///////////////////////////////////////////////////////////
// PATCH /api/salon/owner/schedule/date/:date
///////////////////////////////////////////////////////////

export const editScheduleForDateHandler = async (req, res) => {
  const ownerId = req.user?._id;
  if (!ownerId) throw Errors.unauthorized("Authentication required");

  const { date } = req.params;
  const { professionalId, chairId, startTime, endTime } = req.body;

  const assignment = await editScheduleForDate({ ownerId, professionalId, chairId, date, startTime, endTime });

  return successResponse(res, {
    message: "Schedule updated for this date",
    data:    toScheduleAssignmentDTO(assignment),
  });
};

///////////////////////////////////////////////////////////
// POST /api/salon/owner/schedule/date/:date/restore
///////////////////////////////////////////////////////////

export const restoreDateToMasterHandler = async (req, res) => {
  const ownerId = req.user?._id;
  if (!ownerId) throw Errors.unauthorized("Authentication required");

  const { date } = req.params;
  const { professionalId } = req.body;

  const assignment = await restoreDateToMaster({ ownerId, professionalId, date });

  return successResponse(res, {
    message: assignment ? "Date restored to the master schedule" : "Override removed — the master schedule has no entry for this professional on this date",
    data:    toScheduleAssignmentDTO(assignment),
  });
};
