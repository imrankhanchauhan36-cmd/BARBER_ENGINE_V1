///////////////////////////////////////////////////////////
// PROFESSIONAL ENGINE ROUTES — PHASE 1 (BACKEND FOUNDATION ONLY)
//
// Mounted inside salon.routes.js's ownerRouter, so `protect` +
// requireRole("OWNER") are already applied by the parent router —
// this file does not reapply them, matching exactly how
// chairAvailability.routes.js is wired.
///////////////////////////////////////////////////////////

import express from "express";
import asyncHandler from "express-async-handler";

import {
  createProfessionalHandler,
  listProfessionalsHandler,
  getProfessionalHandler,
  updateProfessionalHandler,
  setProfessionalStatusHandler,
} from "../controllers/professional.controller.js";

import { validate } from "../middlewares/validate.middleware.js";
import { professionalSchemas } from "../validators/professional.validator.js";

const router = express.Router();

router.post(
  "/",
  validate(professionalSchemas.create, "body"),
  asyncHandler(createProfessionalHandler)
);

router.get(
  "/",
  validate(professionalSchemas.list, "query"),
  asyncHandler(listProfessionalsHandler)
);

router.get(
  "/:id",
  validate(professionalSchemas.professionalId, "params"),
  asyncHandler(getProfessionalHandler)
);

router.patch(
  "/:id",
  validate(professionalSchemas.professionalId, "params"),
  validate(professionalSchemas.update, "body"),
  asyncHandler(updateProfessionalHandler)
);

router.patch(
  "/:id/status",
  validate(professionalSchemas.professionalId, "params"),
  validate(professionalSchemas.setStatus, "body"),
  asyncHandler(setProfessionalStatusHandler)
);

export default router;
