/**
 * BARBER ENGINE V1
 * backend/modules/support/routes/agentSupport.routes.js
 *
 * Phase F.3.7 — AGENT-facing Support API. Same mount convention as
 * supportCustomer.routes.js — protect/onboardingBypass applied at the
 * app.js mount level, requireRole applied here.
 *
 * idempotency reused unchanged from the existing middleware/booking's
 * own usage — same {userId}:{Idempotency-Key header} keying, same
 * 2-minute TTL, applied to every mutation route.
 */

import express from "express";
import { idempotency } from "../../../middlewares/idempotency.middleware.js";
import { requireRole } from "../../../middlewares/role.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  getMyPresenceHandler,
  setMyPresenceHandler,
  listMyAssignedTicketsHandler,
  getMyAssignedTicketHandler,
  getMyTicketVerificationHandler,
  startMyTicketHandler,
  waitForUserMyTicketHandler,
  resolveMyTicketHandler,
  unassignMyTicketHandler,
  addMyTicketReplyHandler,
  addMyTicketInternalNoteHandler,
  getMyTicketAssignmentHistoryHandler,
  getMyTicketEmailHistoryHandler,
  logMyTicketCallHandler,
  updateMyTicketCallOutcomeHandler,
  getMyTicketCallHistoryHandler,
  getMyTicketBotActivityHandler,
} from "../controllers/agentSupport.controller.js";
import { supportInternalSchemas } from "../validators/supportInternal.validator.js";

const router = express.Router();

router.use(requireRole("AGENT"));

// Phase F.4 — self-service live presence (the missing half of the
// Redis-backed presence layer assignmentResolution.service.js's
// ranking engine has always read from). No idempotency needed — a
// presence set is a pure state overwrite, safe to repeat.
router.get("/presence", getMyPresenceHandler);
router.patch("/presence", validate(supportInternalSchemas.presence), setMyPresenceHandler);

router.get("/tickets", listMyAssignedTicketsHandler);
router.get("/tickets/:id", getMyAssignedTicketHandler);
// Phase H Step 6 (H.3) — read-only, no idempotency/validate needed.
router.get("/tickets/:id/verification", getMyTicketVerificationHandler);
router.post("/tickets/:id/start", idempotency, validate(supportInternalSchemas.start), startMyTicketHandler);
router.post("/tickets/:id/wait-for-user", idempotency, validate(supportInternalSchemas.waitForUser), waitForUserMyTicketHandler);
router.post("/tickets/:id/resolve", idempotency, validate(supportInternalSchemas.resolve), resolveMyTicketHandler);
router.post("/tickets/:id/unassign", idempotency, validate(supportInternalSchemas.unassign), unassignMyTicketHandler);
router.post("/tickets/:id/messages", idempotency, validate(supportInternalSchemas.agentReply), addMyTicketReplyHandler);
router.post("/tickets/:id/internal-notes", idempotency, validate(supportInternalSchemas.internalNote), addMyTicketInternalNoteHandler);
// Phase H Step 8 (follow-up) — read-only, no idempotency/validate
// needed, same convention as /verification above.
router.get("/tickets/:id/assignment-history", getMyTicketAssignmentHistoryHandler);
// Phase H Step 9 (follow-up) — read-only, same convention as
// assignment-history above.
router.get("/tickets/:id/email-history", getMyTicketEmailHistoryHandler);
// Phase H — Call Support. Minimal agent actions: log a call, record
// its outcome. Same idempotency-middleware convention as every other
// mutating route above.
router.post("/tickets/:id/calls", idempotency, validate(supportInternalSchemas.logCall), logMyTicketCallHandler);
router.patch("/tickets/:id/calls/:callId/outcome", idempotency, validate(supportInternalSchemas.callOutcome), updateMyTicketCallOutcomeHandler);
router.get("/tickets/:id/call-history", getMyTicketCallHistoryHandler);
router.get("/tickets/:id/bot-activity", getMyTicketBotActivityHandler);

export default router;
