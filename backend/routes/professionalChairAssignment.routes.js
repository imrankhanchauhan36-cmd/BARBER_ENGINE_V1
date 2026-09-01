///////////////////////////////////////////////////////////
// PROFESSIONAL ↔ CHAIR ASSIGNMENT ROUTES — PHASE 3
//
// Mounted inside salon.routes.js's ownerRouter, so `protect` +
// requireRole("OWNER") are already applied by the parent router —
// matching exactly how chairAvailability.routes.js and
// professional.routes.js are wired.
///////////////////////////////////////////////////////////

import express from "express";
import asyncHandler from "express-async-handler";

import {
  createAssignmentHandler,
  listAssignmentsHandler,
  getAssignmentHandler,
  updateAssignmentHandler,
  cancelAssignmentHandler,
} from "../controllers/professionalChairAssignment.controller.js";

import { validate } from "../middlewares/validate.middleware.js";
import { professionalChairAssignmentSchemas } from "../validators/professionalChairAssignment.validator.js";

const router = express.Router();

router.post(
  "/",
  validate(professionalChairAssignmentSchemas.create, "body"),
  asyncHandler(createAssignmentHandler)
);

router.get(
  "/",
  validate(professionalChairAssignmentSchemas.list, "query"),
  asyncHandler(listAssignmentsHandler)
);

router.get(
  "/:id",
  validate(professionalChairAssignmentSchemas.assignmentId, "params"),
  asyncHandler(getAssignmentHandler)
);

router.patch(
  "/:id",
  validate(professionalChairAssignmentSchemas.assignmentId, "params"),
  validate(professionalChairAssignmentSchemas.update, "body"),
  asyncHandler(updateAssignmentHandler)
);

router.patch(
  "/:id/status",
  validate(professionalChairAssignmentSchemas.assignmentId, "params"),
  asyncHandler(cancelAssignmentHandler)
);

export default router;
