///////////////////////////////////////////////////////////
// UNIFIED SCHEDULE ROUTES
//
// Mounted inside salon.routes.js's ownerRouter, so `protect` +
// requireRole("OWNER") are already applied by the parent router —
// matching exactly how weeklyScheduleTemplate.routes.js and
// professionalChairAssignment.routes.js are wired.
///////////////////////////////////////////////////////////

import express from "express";
import asyncHandler from "express-async-handler";

import {
  getResolvedScheduleHandler,
  editScheduleForDateHandler,
  restoreDateToMasterHandler,
} from "../controllers/schedule.controller.js";

import { validate } from "../middlewares/validate.middleware.js";
import { scheduleSchemas } from "../validators/schedule.validator.js";

const router = express.Router();

router.get(
  "/resolved",
  validate(scheduleSchemas.resolved, "query"),
  asyncHandler(getResolvedScheduleHandler)
);

router.patch(
  "/date/:date",
  validate(scheduleSchemas.dateParam, "params"),
  validate(scheduleSchemas.editDate, "body"),
  asyncHandler(editScheduleForDateHandler)
);

router.post(
  "/date/:date/restore",
  validate(scheduleSchemas.dateParam, "params"),
  validate(scheduleSchemas.restoreDate, "body"),
  asyncHandler(restoreDateToMasterHandler)
);

export default router;
