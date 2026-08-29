/**
 * BARBER ENGINE V1
 * backend/modules/support/routes/supportCustomer.routes.js
 *
 * Phase C — customer/salon-owner-facing Support API only. Agent/Admin
 * routers (which depend on Routing/Queue/Team/Agent — not built until
 * later phases) are explicitly NOT created here.
 *
 * protect/onboardingBypass are applied at the app.js mount level,
 * matching every other consumer-facing route group (booking, payment,
 * salon-media, customers) — requireRole is applied here, same as
 * booking.routes.js's own userRouter.
 */

import express from "express";
import { idempotency } from "../../../middlewares/idempotency.middleware.js";
import { requireRole } from "../../../middlewares/role.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  addMyTicketMessage,
  createMyTicket,
  getMyTicketHandler,
  getMyTicketBookingInfoHandler,
  listCategoriesHandler,
  listMyTicketsHandler,
  reopenMyTicket,
} from "../controllers/supportTicket.controller.js";
import { supportSchemas } from "../validators/supportTicket.validator.js";

const router = express.Router();

router.use(requireRole("USER", "OWNER"));

// Phase S.1 — read-only category list for the Create Ticket UI's
// category picker. No idempotency/validate — GET, no body, no
// mutation, matching /tickets and /tickets/:id below.
router.get("/categories", listCategoriesHandler);

// idempotency reused unchanged from booking.routes.js's own usage —
// same {userId}:{Idempotency-Key header} keying, same 2-minute TTL.
router.post("/tickets", idempotency, validate(supportSchemas.createTicket), createMyTicket);
router.get("/tickets", listMyTicketsHandler);
router.get("/tickets/:id", getMyTicketHandler);
// Real booking/payment context for a ticket — read-only, GET, no body.
router.get("/tickets/:id/booking-info", getMyTicketBookingInfoHandler);
router.post("/tickets/:id/messages", idempotency, validate(supportSchemas.addMessage), addMyTicketMessage);
router.post("/tickets/:id/reopen", idempotency, validate(supportSchemas.reopenTicket), reopenMyTicket);

export default router;
