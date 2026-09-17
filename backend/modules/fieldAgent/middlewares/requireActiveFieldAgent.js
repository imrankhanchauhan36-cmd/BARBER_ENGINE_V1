/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/middlewares/requireActiveFieldAgent.js
 *
 * FA-15 Phase A — request-level re-check of FieldAgent.operationalStatus.
 *
 * The FA-15 audit found that `protect` (middlewares/auth.middleware.js)
 * re-checks User.accountStatus/isActive/isDeleted on every request, but
 * never queries the FieldAgent collection — operationalStatus was only
 * checked at operational login and ad-hoc inside two specific business
 * services (acquisitionClaim.service.js's assertClaimEligible,
 * fieldAgentPayout.service.js's assertFieldAgentEligibleForPayout).
 * This closes that gap uniformly, at the route layer, for every
 * "operational" (post-approval, day-to-day business) Field Agent
 * surface — not the pre-activation onboarding surfaces.
 *
 * Deliberately applied ONLY to acquisition/claims, earnings, and
 * payout routes — the same three areas the audit itself identified as
 * "operational" — and NOT to fieldAgent.routes.js (application CRUD),
 * KYC submission, or training/test routes, since those are exactly
 * the onboarding steps a PENDING_ACTIVATION agent must be able to
 * complete in order to ever reach ACTIVE in the first place; gating
 * them here would make activation impossible. Field Agent Support was
 * also deliberately left ungated, since a not-yet-active agent may
 * still need to file a ticket about a stuck activation — this is a
 * scope judgment call, flagged explicitly for review, not an explicit
 * instruction.
 *
 * Identity is taken exclusively from req.user._id (set by `protect`
 * from the verified JWT + a live DB read) — operationalStatus is never
 * read from the request body/query/params, and this middleware never
 * writes anything.
 *
 * The FieldAgent operationalStatus enum currently has only
 * PENDING_ACTIVATION/ACTIVE (constants/fieldAgent.constants.js) and no
 * admin action exists yet that demotes an agent away from ACTIVE — so
 * this is a forward-looking boundary, not a fix for an active
 * demotion exploit.
 */

import { Errors } from "../../../utils/response.js";
import { getFieldAgentByUserId } from "../services/fieldAgentProfile.service.js";
import { FIELD_AGENT_OPERATIONAL_STATUS } from "../constants/fieldAgent.constants.js";

export const requireActiveFieldAgent = async (req, res, next) => {
  try {
    const fieldAgent = await getFieldAgentByUserId(req.user._id);
    if (!fieldAgent) {
      return next(Errors.notFound("Field Agent profile not found"));
    }
    if (fieldAgent.operationalStatus !== FIELD_AGENT_OPERATIONAL_STATUS.ACTIVE) {
      return next(Errors.forbidden(`Field Agent is not operational (status: ${fieldAgent.operationalStatus})`));
    }
    return next();
  } catch (err) {
    return next(err);
  }
};
