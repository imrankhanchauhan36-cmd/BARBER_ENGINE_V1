/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/routes/adminFieldAgentCompliance.routes.js
 *
 * FA-12.2 — admin compliance case/evidence surface, mounted under
 * /api/admin/field-agent-compliance with `protect` applied at the
 * app.js mount level (same convention as every other admin route in
 * this module).
 *
 * READ_LEVELS (INDIA/STATE) covers list/detail/file-evidence/open-case
 * — a STATE_ADMIN may file evidence and open a case, but ONLY within
 * their own FA-11.3-scoped Territory Partner set (enforced inside the
 * service layer, never by this route split alone).
 *
 * DECISION_LEVELS (INDIA only) covers transition/reopen — STATE_ADMIN
 * has ZERO decision authority per the FA-12 lock, enforced BOTH here
 * (STATE never gets a WRITE_LEVELS slot on these two routes) AND
 * inside transitionCase/reopenCase via assertAdminHasDecisionAuthority
 * (defense-in-depth, same double-check discipline as every other
 * admin write path in this module).
 */

import express from "express";
import { requireAdminLevel } from "../../../middlewares/requireAdminLevel.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import { idempotency } from "../../../middlewares/idempotency.middleware.js";
import {
  listComplianceCasesHandler,
  getComplianceCaseDetailHandler,
  listComplianceEvidenceHandler,
  fileStandaloneEvidenceHandler,
  openCaseHandler,
  fileEvidenceForCaseHandler,
  transitionCaseHandler,
  reopenCaseHandler,
} from "../controllers/adminFieldAgentCompliance.controller.js";
import { adminFieldAgentComplianceSchemas } from "../validators/adminFieldAgentCompliance.validator.js";

const router = express.Router();

const READ_LEVELS = ["INDIA", "STATE"];
const DECISION_LEVELS = ["INDIA"];

// ─── Cases ────────────────────────────────────────────────────────
router.get(
  "/cases",
  requireAdminLevel(...READ_LEVELS),
  validate(adminFieldAgentComplianceSchemas.casesListQuery, "query"),
  listComplianceCasesHandler
);
router.get(
  "/cases/:caseId",
  requireAdminLevel(...READ_LEVELS),
  validate(adminFieldAgentComplianceSchemas.caseIdParam, "params"),
  getComplianceCaseDetailHandler
);
router.post(
  "/cases",
  requireAdminLevel(...READ_LEVELS),
  idempotency,
  validate(adminFieldAgentComplianceSchemas.openCaseBody),
  openCaseHandler
);
router.post(
  "/cases/:caseId/evidence",
  requireAdminLevel(...READ_LEVELS),
  idempotency,
  validate(adminFieldAgentComplianceSchemas.caseIdParam, "params"),
  validate(adminFieldAgentComplianceSchemas.fileEvidenceForCaseBody),
  fileEvidenceForCaseHandler
);
router.post(
  "/cases/:caseId/transition",
  requireAdminLevel(...DECISION_LEVELS),
  idempotency,
  validate(adminFieldAgentComplianceSchemas.caseIdParam, "params"),
  validate(adminFieldAgentComplianceSchemas.transitionCaseBody),
  transitionCaseHandler
);
router.post(
  "/cases/:caseId/reopen",
  requireAdminLevel(...DECISION_LEVELS),
  idempotency,
  validate(adminFieldAgentComplianceSchemas.caseIdParam, "params"),
  validate(adminFieldAgentComplianceSchemas.reopenCaseBody),
  reopenCaseHandler
);

// ─── Evidence ─────────────────────────────────────────────────────
router.get(
  "/evidence",
  requireAdminLevel(...READ_LEVELS),
  validate(adminFieldAgentComplianceSchemas.evidenceListQuery, "query"),
  listComplianceEvidenceHandler
);
router.post(
  "/evidence",
  requireAdminLevel(...READ_LEVELS),
  idempotency,
  validate(adminFieldAgentComplianceSchemas.fileStandaloneEvidenceBody),
  fileStandaloneEvidenceHandler
);

export default router;
