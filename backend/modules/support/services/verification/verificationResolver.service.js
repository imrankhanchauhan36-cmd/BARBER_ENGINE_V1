/**
 * BARBER ENGINE V1
 * backend/modules/support/services/verification/verificationResolver.service.js
 *
 * Phase H Step 5 (H.2b) — the top-level, Support-owned, read-only
 * Verification Resolver approved in the Phase H Step 2 design.
 *
 * resolveTicketVerification({ ticket, actor }) answers exactly one
 * question: "given this ticket and this authenticated Support actor,
 * what can the system currently verify, and (in a later phase) what
 * would be allowed?" It NEVER mutates anything, NEVER accepts a
 * client-supplied domain/entity/verification result, and NEVER
 * fabricates a fact it cannot actually read from an authoritative
 * source.
 *
 * Named resolveTicketVerification (not verifyTicketContext) to match
 * this module's own established convention — every other "read the
 * world, return a decision" function in modules/support/services/ is
 * named resolveX: resolveRelatedReferences, resolveRouting,
 * resolveAssignment, resolveAdminScope, resolveEffectiveSlaPolicy.
 *
 * Domain dispatch is a plain object literal keyed by
 * SupportCategory.businessDomain (Phase H Step 1) — not a plugin
 * system, exactly as approved in the Step 2 design and reaffirmed by
 * the Step 5 instructions.
 */

import SupportCategory from "../../models/SupportCategory.js";
import { resolvePaymentVerification } from "./paymentVerification.service.js";
import { resolveBookingVerification } from "./bookingVerification.service.js";

// Legitimate Support actor roles under the EXISTING authorization
// architecture (matches every Support route's own requireRole(...)
// list — agentSupport.routes.js, adminSupport.routes.js). This is a
// shape/role check, not a new auth system: real authentication and
// role-gating already happened in the protect/requireRole middleware
// chain before any caller would ever reach this resolver.
const VALID_ACTOR_ROLES = ["AGENT", "SUPPORT_ADMIN"];

// Domains actually implemented this phase.
const DOMAIN_RESOLVERS = {
  PAYMENT: resolvePaymentVerification,
  BOOKING: resolveBookingVerification,
};

// Domains that are real, confirmed business domains (Phase H Step 1
// audit, SupportCategory.businessDomain's own enum) but have no
// resolver yet — explicitly unimplemented, never silently routed to
// PAYMENT or BOOKING.
const NOT_YET_SUPPORTED_DOMAINS = ["WALLET", "PAYOUT", "USER", "SALON", "SERVICE"];

function cannotVerify(reason, domain = null) {
  return { state: "CANNOT_VERIFY", domain, reason, entity: null, facts: null, allowedActions: [] };
}

/**
 * @param {object} params
 * @param {object} params.ticket - a SupportTicket document/lean object
 *   (must carry categoryRef, relatedBookingRef, requesterRef,
 *   requesterType — never trusted for anything beyond what's already
 *   stored server-side on the ticket itself)
 * @param {object} params.actor - the authenticated Support caller,
 *   { id, role }, derived exclusively from req.user by the caller —
 *   never from request body/query
 * @returns {Promise<{state, domain, reason, entity, facts, allowedActions, verifiedAt, verifiedBy}>}
 */
export async function resolveTicketVerification({ ticket, actor }) {
  const verifiedAt = new Date();

  if (!actor || !VALID_ACTOR_ROLES.includes(actor.role) || !actor.id) {
    return { ...cannotVerify("INVALID_ACTOR"), verifiedAt, verifiedBy: null };
  }
  const verifiedBy = { id: actor.id, role: actor.role };

  if (!ticket || !ticket.categoryRef) {
    return { ...cannotVerify("TICKET_OR_CATEGORY_MISSING"), verifiedAt, verifiedBy };
  }

  let result;
  try {
    const category = await SupportCategory.findOne({ _id: ticket.categoryRef, isDeleted: false })
      .select("businessDomain")
      .lean();

    if (!category) {
      result = cannotVerify("CATEGORY_NOT_FOUND");
    } else if (!category.businessDomain) {
      result = cannotVerify("DOMAIN_NOT_CLASSIFIED");
    } else if (DOMAIN_RESOLVERS[category.businessDomain]) {
      result = await DOMAIN_RESOLVERS[category.businessDomain]({ ticket, actor });
    } else if (NOT_YET_SUPPORTED_DOMAINS.includes(category.businessDomain)) {
      result = cannotVerify("DOMAIN_NOT_YET_SUPPORTED", category.businessDomain);
    } else {
      // Defensive — should be unreachable given SupportCategory's own
      // schema enum, but never silently treated as PAYMENT/BOOKING.
      result = cannotVerify("DOMAIN_UNKNOWN", category.businessDomain);
    }
  } catch (err) {
    // Any adapter failure is coerced here — never a leaked stack
    // trace or raw exception reaching a future caller/agent UI.
    result = cannotVerify("INTERNAL_ERROR");
  }

  return { ...result, verifiedAt, verifiedBy };
}
