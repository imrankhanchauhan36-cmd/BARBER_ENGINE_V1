/**
 * BARBER ENGINE V1
 * backend/modules/support/routes/fieldAgentSupport.routes.js
 *
 * FA-10 — Field Agent-facing Support API. Mirrors
 * supportCustomer.routes.js exactly (same controller handlers, same
 * idempotency/validate middleware conventions) — no ticket lifecycle/
 * business logic duplicated anywhere in this file.
 *
 * protect/onboardingBypass are applied at the app.js mount level,
 * matching every other Support route group. requireRole("FIELD_AGENT")
 * here, matching the exact precedent already set by
 * fieldAgentAcquisitionClaim.routes.js/fieldAgentEarning.routes.js/
 * fieldAgent.routes.js — no additional operationalStatus re-check per
 * request, consistent with those three routers (operationalStatus is
 * enforced once, at login, per fieldAgentOperationalAuth.controller.js).
 *
 * Deliberately does NOT wire GET /tickets/:id/booking-info — Field
 * Agent V1 tickets never carry a booking/salon linkage, so that
 * endpoint would always resolve to "not applicable" for every ticket
 * created through this router.
 */

import express from "express";
import { idempotency } from "../../../middlewares/idempotency.middleware.js";
import { requireRole } from "../../../middlewares/role.middleware.js";
import { validate } from "../../../middlewares/validate.middleware.js";
import {
  addMyTicketMessage,
  createMyTicket,
  getMyTicketHandler,
  listCategoriesHandler,
  listMyTicketsHandler,
  reopenMyTicket,
} from "../controllers/supportTicket.controller.js";
import { supportSchemas } from "../validators/supportTicket.validator.js";

const router = express.Router();

router.use(requireRole("FIELD_AGENT"));

router.get("/categories", listCategoriesHandler);

router.post("/tickets", idempotency, validate(supportSchemas.createFieldAgentTicket), createMyTicket);
router.get("/tickets", listMyTicketsHandler);
router.get("/tickets/:id", getMyTicketHandler);
router.post("/tickets/:id/messages", idempotency, validate(supportSchemas.addMessage), addMyTicketMessage);
router.post("/tickets/:id/reopen", idempotency, validate(supportSchemas.reopenTicket), reopenMyTicket);

export default router;
