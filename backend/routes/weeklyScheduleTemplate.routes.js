///////////////////////////////////////////////////////////
// WEEKLY SCHEDULE TEMPLATE ROUTES — C4 PHASE 1
//
// Mounted inside salon.routes.js's ownerRouter, so `protect` +
// requireRole("OWNER") are already applied by the parent router —
// matching exactly how professionalChairAssignment.routes.js and
// chairAvailability.routes.js are wired.
///////////////////////////////////////////////////////////

import express from "express";
import asyncHandler from "express-async-handler";

import {
  createTemplateHandler,
  listTemplatesHandler,
  getTemplateHandler,
  updateTemplateHandler,
  cancelTemplateHandler,
} from "../controllers/weeklyScheduleTemplate.controller.js";

import { validate } from "../middlewares/validate.middleware.js";
import { weeklyScheduleTemplateSchemas } from "../validators/weeklyScheduleTemplate.validator.js";

const router = express.Router();

router.post(
  "/",
  validate(weeklyScheduleTemplateSchemas.create, "body"),
  asyncHandler(createTemplateHandler)
);

router.get(
  "/",
  validate(weeklyScheduleTemplateSchemas.list, "query"),
  asyncHandler(listTemplatesHandler)
);

router.get(
  "/:id",
  validate(weeklyScheduleTemplateSchemas.templateId, "params"),
  asyncHandler(getTemplateHandler)
);

router.patch(
  "/:id",
  validate(weeklyScheduleTemplateSchemas.templateId, "params"),
  validate(weeklyScheduleTemplateSchemas.update, "body"),
  asyncHandler(updateTemplateHandler)
);

router.patch(
  "/:id/status",
  validate(weeklyScheduleTemplateSchemas.templateId, "params"),
  asyncHandler(cancelTemplateHandler)
);

export default router;
