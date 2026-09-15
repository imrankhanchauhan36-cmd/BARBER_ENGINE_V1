/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/complianceAuthorization.service.js
 *
 * FA-12.2 — authorization/scope resolution for the compliance domain.
 * Reuses the exact FA-11.3 scope rule verbatim (see
 * fieldAgentPerformance.service.js#canAdminViewFieldAgentPerformance /
 * #resolveStateAdminAuthorizedFieldAgentIds), per this phase's own
 * explicit instruction not to invent a parallel scope mechanism:
 *
 *   - INDIA_ADMIN: full authority, unconditional.
 *   - STATE_ADMIN: ONLY for a fieldAgent whose commercialPath is
 *     TERRITORY_PARTNER, with a CURRENT (status ACTIVE) TerritoryAssignment
 *     to a CURRENT (status ACTIVE) CommercialTerritory whose stateRef
 *     matches the admin's own req.user.stateRef. Zero decision
 *     authority regardless (enforced separately by
 *     assertAdminHasDecisionAuthority, and at the route level by never
 *     granting STATE a WRITE_LEVELS slot on transition/reopen routes).
 *   - DISTRICT_ADMIN and any other level: no FA-12 authority at all.
 *   - Acquisition Agent (commercialPath !== TERRITORY_PARTNER):
 *     INDIA_ADMIN only, unconditionally — no heuristic geography is
 *     ever consulted, mirroring FA-11.3's own locked rationale (no
 *     authoritative permanent state membership exists for that path).
 *
 * Every read here is fresh against the live database — never a
 * client-supplied state/district/territory value, never a cached or
 * stale assignment.
 */

import FieldAgent from "../models/FieldAgent.js";
import TerritoryAssignment from "../models/TerritoryAssignment.js";
import CommercialTerritory from "../models/CommercialTerritory.js";
import { ASSIGNMENT_STATUS, TERRITORY_STATUS } from "../constants/commercialTerritory.constants.js";
import { COMMERCIAL_PATH } from "../constants/fieldAgent.constants.js";

// Pure authorization check for a single, already-resolved fieldAgent
// document (lean or hydrated — only .commercialPath/._id are read).
export const canAdminActOnFieldAgent = async ({ admin, fieldAgent }) => {
  if (admin.adminLevel === "INDIA") return true;
  if (admin.adminLevel !== "STATE") return false; // DISTRICT/others — no FA-12 permission in V1

  if (fieldAgent.commercialPath !== COMMERCIAL_PATH.TERRITORY_PARTNER) return false; // Acquisition Agent — INDIA-only

  const currentAssignment = await TerritoryAssignment.findOne({ fieldAgentRef: fieldAgent._id, status: ASSIGNMENT_STATUS.ACTIVE })
    .select("territoryRef")
    .lean();
  if (!currentAssignment) return false;

  const territory = await CommercialTerritory.findOne({ _id: currentAssignment.territoryRef, status: TERRITORY_STATUS.ACTIVE })
    .select("stateRef")
    .lean();
  if (!territory) return false;

  return String(territory.stateRef) === String(admin.stateRef);
};

// Convenience wrapper — resolves the FieldAgent fresh by id, then
// authorizes. Throws Errors.notFound/Errors.forbidden directly so
// every call site gets identical, correct error semantics.
export const resolveAndAuthorizeFieldAgent = async ({ admin, fieldAgentId, Errors }) => {
  const fieldAgent = await FieldAgent.findById(fieldAgentId).lean();
  if (!fieldAgent) throw Errors.notFound("Field Agent not found");
  const authorized = await canAdminActOnFieldAgent({ admin, fieldAgent });
  if (!authorized) throw Errors.forbidden("Not authorized for this Field Agent's compliance data");
  return fieldAgent;
};

// For LIST: the bounded set of fieldAgentRef values a STATE_ADMIN may
// see — exclusively TERRITORY_PARTNER agents with a CURRENT ACTIVE
// assignment to a CommercialTerritory in the admin's own state. Same
// index reuse as FA-11.3 (no new index required).
export const resolveStateAdminAuthorizedFieldAgentIds = async (stateRef) => {
  const territoriesInState = await CommercialTerritory.find({ stateRef, status: TERRITORY_STATUS.ACTIVE }).select("_id").lean();
  if (!territoriesInState.length) return [];
  const territoryIds = territoriesInState.map((t) => t._id);

  const activeAssignments = await TerritoryAssignment.find({ territoryRef: { $in: territoryIds }, status: ASSIGNMENT_STATUS.ACTIVE })
    .select("fieldAgentRef")
    .lean();
  return activeAssignments.map((a) => a.fieldAgentRef);
};

// Case/evidence DECISION authority (transition/reopen) is INDIA-only,
// per the FA-12 lock — STATE_ADMIN has zero decision authority even
// within its own authorized geography. This is enforced at the route
// level (STATE never appears in a decision route's WRITE_LEVELS) AND
// here, defense-in-depth, mirroring the double-check discipline this
// codebase already applies (e.g. rejectApplication's own adminId
// check even though route middleware already guarantees an admin).
export const assertAdminHasDecisionAuthority = (admin, Errors) => {
  if (admin.adminLevel !== "INDIA") {
    throw Errors.forbidden("Only an INDIA admin may transition or reopen a compliance case");
  }
};
