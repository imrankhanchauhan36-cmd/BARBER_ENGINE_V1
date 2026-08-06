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
// OWNER ACCESS
//////////////////////////////////////////////////////

router.use(
  requireRole("OWNER")
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
