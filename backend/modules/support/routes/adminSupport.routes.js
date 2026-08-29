/**
 * BARBER ENGINE V1
 * backend/modules/support/routes/adminSupport.routes.js
 *
 * Phase F.3.7 — SUPPORT_ADMIN / team-lead Support API. Gated at the
 * router level by requireRole("AGENT","SUPPORT_ADMIN") — deliberately
 * broad, because a team lead (an AGENT-role user referenced by some
 * SupportTeam.teamLeadRef) must reach this namespace too; the actual
 * SUPPORT_ADMIN-vs-team-lead scoping and the team-lead-of-zero-teams
 * rejection happen in adminSupport.controller.js's resolveAdminScope(),
 * not at this route-gating layer. This does not broaden AGENT's
 * general permissions — a non-team-lead AGENT hitting any of these
 * routes is rejected with 403 by that same controller-layer check.
 */

import express from "express";
import { idempotency } from "../../../middlewares/idempotency.middleware.js";
import { requireSupportAccess } from "../../../middlewares/supportAccess.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  listAdminTicketsHandler,
  getAdminTicketHandler,
  getTicketVerificationHandler,
  issueRefundHandler,
  assignAdminTicketHandler,
  reassignAdminTicketHandler,
  unassignAdminTicketHandler,
  resolveAdminTicketHandler,
  closeAdminTicketHandler,
  reopenAdminTicketHandler,
  addAdminInternalNoteHandler,
  getAssignmentHistoryHandler,
  getAuditTrailHandler,
  getTicketEmailHistoryHandler,
  getTicketCallHistoryHandler,
  getTicketBotActivityHandler,
} from "../controllers/adminSupport.controller.js";
import { supportInternalSchemas } from "../validators/supportInternal.validator.js";

const router = express.Router();

// requireSupportAccess("AGENT","SUPPORT_ADMIN") preserves the exact
// prior behavior (including the team-lead-scoped AGENT case resolved
// downstream in adminSupport.controller.js), plus additionally allows
// the single India-level main-console Admin (role:"ADMIN",
// adminLevel:"INDIA") — see supportAccess.middleware.js.
router.use(requireSupportAccess("AGENT", "SUPPORT_ADMIN"));

router.get("/tickets", listAdminTicketsHandler);
router.get("/tickets/:id", getAdminTicketHandler);
// Phase H Step 6 (H.3) — read-only, no idempotency/validate needed
// (GET, no body, same convention as the ticket-detail route above).
router.get("/tickets/:id/verification", getTicketVerificationHandler);
// Phase H Step 7 (H.4) — the first real business-mutating action.
// idempotency middleware here is a request-level dedupe guard only
// (Idempotency-Key header, matching every other mutating route below);
// the real, DB-level duplicate-refund guard lives in
// RefundExecutionService.issueRefundForCancelledBooking itself.
router.post("/tickets/:id/refund", idempotency, validate(supportInternalSchemas.issueRefund), issueRefundHandler);
router.post("/tickets/:id/assign", idempotency, validate(supportInternalSchemas.assign), assignAdminTicketHandler);
router.post("/tickets/:id/reassign", idempotency, validate(supportInternalSchemas.reassign), reassignAdminTicketHandler);
router.post("/tickets/:id/unassign", idempotency, validate(supportInternalSchemas.unassign), unassignAdminTicketHandler);
router.post("/tickets/:id/resolve", idempotency, validate(supportInternalSchemas.resolve), resolveAdminTicketHandler);
router.post("/tickets/:id/close", idempotency, validate(supportInternalSchemas.close), closeAdminTicketHandler);
router.post("/tickets/:id/reopen", idempotency, validate(supportInternalSchemas.reopen), reopenAdminTicketHandler);
router.post("/tickets/:id/internal-notes", idempotency, validate(supportInternalSchemas.internalNote), addAdminInternalNoteHandler);
// Phase H Step 8 (follow-up) — read-only, no idempotency/validate
// needed, same convention as /verification above.
router.get("/tickets/:id/assignment-history", getAssignmentHistoryHandler);
router.get("/tickets/:id/audit-trail", getAuditTrailHandler);
// Phase H Step 9 (follow-up) — read-only, same convention as
// assignment-history/audit-trail above.
router.get("/tickets/:id/email-history", getTicketEmailHistoryHandler);
router.get("/tickets/:id/call-history", getTicketCallHistoryHandler);
router.get("/tickets/:id/bot-activity", getTicketBotActivityHandler);

export default router;
