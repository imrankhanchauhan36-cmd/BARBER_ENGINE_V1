/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTraining/routes/fieldAgentHelp.routes.js
 *
 * FA-3.3 — Field Agent Help. Same protect/onboardingBypass-at-mount +
 * requireRole-here pattern as fieldAgentTraining.routes.js.
 */

import express from "express";
import { requireRole } from "../../../middlewares/role.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { getHelpContentHandler } from "../controllers/fieldAgentHelp.controller.js";
import { fieldAgentTrainingSchemas } from "../validators/fieldAgentTraining.validator.js";

const router = express.Router();

router.use(requireRole("FIELD_AGENT"));

router.get("/", validate(fieldAgentTrainingSchemas.languageQuery, "query"), getHelpContentHandler);

export default router;
