/**
 * BARBER ENGINE V1
 * backend/modules/territoryAutoAssignment/constants/territoryAutoAssignment.constants.js
 *
 * STEP 5.2 — Territory Auto Assignment Engine. This module's own
 * vocabulary. Deliberately a NEW, standalone bounded context — not an
 * extension of modules/fieldAgent's commercialTerritory.constants.js
 * (that module — CommercialTerritory + TerritoryAssignment — is read
 * ONLY by this engine, never written to; see the service's own header)
 * and not of AcquisitionClaim (a different, LOCKED "who acquired this
 * salon" concept this engine never reads or writes).
 */

// Two sources: automatic linking at the moment a Salon is approved
// (the live hook, salon.controller.js#approveSalon), and BACKFILL — a
// one-time, safely re-runnable pass over pre-existing APPROVED salons
// that predate this engine (see backfillTerritoryAssignmentsForApprovedSalons
// in TerritoryAutoAssignmentService.js). Kept as an enum (not a
// hardcoded string) for the same forward-compatibility discipline this
// codebase applies everywhere else (e.g. ASSIGNMENT_END_REASON).
export const SALON_TERRITORY_ASSIGNMENT_SOURCE = Object.freeze({
  AUTO_ON_APPROVAL: "AUTO_ON_APPROVAL",
  BACKFILL: "BACKFILL",
});
