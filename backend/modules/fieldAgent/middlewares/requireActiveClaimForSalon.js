/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/middlewares/requireActiveClaimForSalon.js
 *
 * PHASE 2B — the claim-ownership authorization boundary the Phase 2
 * audit found did not exist anywhere yet. Modeled directly on this
 * module's own sibling, requireActiveFieldAgent.js (same
 * getFieldAgentByUserId-from-req.user._id identity derivation, same
 * next(Errors...) error-propagation style), and on
 * acquisitionClaim.service.js#withdrawMyClaim's own "404, not leak"
 * ownership-mismatch convention — not a new authorization pattern.
 *
 * Authorization rule (exactly the audit's own spec, no more, no less):
 *   AcquisitionClaim.findOne({
 *     salonRef: req.params.salonId,
 *     fieldAgentRef: fieldAgent._id,
 *     status: { $in: CLAIM_NON_TERMINAL_STATUSES },
 *   })
 *
 * Field Agent identity is taken EXCLUSIVELY from req.user._id (set by
 * `protect` from the caller's own verified JWT) — never from any
 * request body/query/param field. salonId is taken from the route
 * param (already shape-validated by fieldAgentOnboardingSchemas.
 * salonIdParam before this middleware runs). ownerId is NEVER read
 * here and never used to establish ownership — only the
 * fieldAgentRef+salonRef+non-terminal-status triple decides access.
 *
 * On a mismatch (no claim, wrong agent, terminal/ended claim, or a
 * salonId that doesn't exist at all) this returns 404 — never 403 —
 * matching the existing withdrawMyClaim/cancelMyReferral "don't leak
 * whether the resource exists for someone else" idiom exactly. A
 * malicious or mistaken Field Agent B probing Field Agent A's salonId
 * sees the identical "not found" response a genuinely nonexistent
 * salonId would produce.
 *
 * On success, the resolved `claim` (lean) and `fieldAgent` (lean) are
 * attached to the request as req.fieldAgentClaim / req.fieldAgentProfile
 * so every downstream controller/service in this phase can reuse them
 * without a second round-trip — never re-derived from a client-
 * supplied value.
 */

import { Errors } from "../../../utils/response.js";
import AcquisitionClaim from "../models/AcquisitionClaim.js";
import { getFieldAgentByUserId } from "../services/fieldAgentProfile.service.js";
import { CLAIM_NON_TERMINAL_STATUSES } from "../constants/acquisitionClaim.constants.js";

export const requireActiveClaimForSalon = async (req, res, next) => {
  try {
    const fieldAgent = await getFieldAgentByUserId(req.user._id);
    if (!fieldAgent) {
      return next(Errors.notFound("Field Agent profile not found"));
    }

    const { salonId } = req.params;

    const claim = await AcquisitionClaim.findOne({
      salonRef: salonId,
      fieldAgentRef: fieldAgent._id,
      status: { $in: CLAIM_NON_TERMINAL_STATUSES },
    }).lean();

    if (!claim) {
      // Same "404, never 403" idiom as withdrawMyClaim/cancelMyReferral
      // — a foreign salonId and a nonexistent one are indistinguishable
      // to the caller.
      return next(Errors.notFound("Salon not found"));
    }

    req.fieldAgentClaim = claim;
    req.fieldAgentProfile = fieldAgent;
    return next();
  } catch (err) {
    return next(err);
  }
};
