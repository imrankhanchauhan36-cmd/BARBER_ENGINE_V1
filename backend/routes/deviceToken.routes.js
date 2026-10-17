import express from "express";

import { protect }
  from "../middlewares/auth.middleware.js";

import { requireRole }
  from "../middlewares/role.middleware.js";

import { validate }
  from "../middlewares/validate.middleware.js";

import { deviceTokenSchemas }
  from "../modules/notifications/validators/deviceToken.validator.js";

import {
  registerDeviceTokenHandler,
  deactivateDeviceTokenHandler,
} from "../controllers/deviceToken.controller.js";

const router = express.Router();

//////////////////////////////////////////////////////
// PROTECTED ROUTES
//////////////////////////////////////////////////////

router.use(protect);

//////////////////////////////////////////////////////
// OWNER + FIELD AGENT + USER ACCESS
// FA-P2-A — widened from OWNER-only (see
// controllers/deviceToken.controller.js's role branch).
// USER (customer) widened here as part of the centralized push
// architecture work — DeviceToken.recipientType and Notification
// .recipientType both already supported "USER" (pre-existing enum
// value, never wired to this registration endpoint until now); the
// matching branch is in deviceToken.controller.js#resolveRecipient.
//////////////////////////////////////////////////////

router.use(
  requireRole("OWNER", "FIELD_AGENT", "USER")
);

//////////////////////////////////////////////////////
// REGISTER DEVICE TOKEN
//////////////////////////////////////////////////////

router.post(
  "/",
  validate(deviceTokenSchemas.register, "body"),
  registerDeviceTokenHandler
);

//////////////////////////////////////////////////////
// DEACTIVATE DEVICE TOKEN (logout)
//////////////////////////////////////////////////////

router.patch(
  "/deactivate",
  validate(deviceTokenSchemas.deactivate, "body"),
  deactivateDeviceTokenHandler
);

//////////////////////////////////////////////////////
// EXPORT
//////////////////////////////////////////////////////

export default router;
