///////////////////////////////////////////////////////////
// CHAIR AVAILABILITY ROUTES — PHASE 1 (BACKEND ONLY)
//
// Mounted inside salon.routes.js's ownerRouter, so `protect` +
// requireRole("OWNER") are already applied by the parent router —
// this file does not reapply them, matching how the Holiday
// Override routes are wired (see salon.routes.js).
///////////////////////////////////////////////////////////

import express from "express";
import asyncHandler from "express-async-handler";

import {
  createBlock,
  listBlocks,
  getBlock,
  cancelBlock,
} from "../controllers/chairAvailability.controller.js";

import { validate } from "../middlewares/validate.middleware.js";
import { chairAvailabilitySchemas } from "../validators/chairAvailability.validator.js";

const router = express.Router();

router.post(
  "/",
  validate(chairAvailabilitySchemas.create, "body"),
  asyncHandler(createBlock)
);

router.get(
  "/",
  validate(chairAvailabilitySchemas.list, "query"),
  asyncHandler(listBlocks)
);

router.get(
  "/:id",
  validate(chairAvailabilitySchemas.blockId, "params"),
  asyncHandler(getBlock)
);

router.patch(
  "/:id/cancel",
  validate(chairAvailabilitySchemas.blockId, "params"),
  asyncHandler(cancelBlock)
);

export default router;
