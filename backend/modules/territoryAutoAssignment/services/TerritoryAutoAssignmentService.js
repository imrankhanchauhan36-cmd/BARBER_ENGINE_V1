/**
 * BARBER ENGINE V1
 * backend/modules/territoryAutoAssignment/services/TerritoryAutoAssignmentService.js
 *
 * STEP 5.2 — Territory Auto Assignment Engine.
 *
 * WHAT THIS DOES: at the moment a Salon is approved, resolves which
 * Territory Partner (FieldAgent) currently commercially operates that
 * salon's geography — via the EXISTING, UNMODIFIED FA-5.2 machinery
 * (CommercialTerritory + TerritoryAssignment) — and records that link
 * in this module's own SalonTerritoryAssignment collection. Every
 * salon that gets approved (new or old) goes through this exact same
 * path, so "new salons inherit the territory automatically" is not a
 * separate mechanism — it is this same hook firing on every approval.
 *
 * READ-ONLY dependency on modules/fieldAgent (LOCKED, per the ticket):
 * this file only ever *reads* CommercialTerritory and TerritoryAssignment
 * (via .lean() finds) — it never calls assignPartner/vacatePartner/
 * activateTerritory/retireTerritory/suspendTerritory, never writes to
 * either collection, and never touches AcquisitionClaim, Salon's own
 * schema, Wallet, Razorpay, GST, RevenueSplit or RevenueSettings.
 *
 * RESOLUTION ORDER (most specific to least specific): AREA_SET, then
 * CITY, then DISTRICT. This is a defensive precedence only — FA-5.2's
 * own cross-scope-type overlap prevention (commercialTerritory.service.
 * js#activateTerritory, scopesConflict + TerritoryActivationLock)
 * already guarantees at most one ACTIVE CommercialTerritory can ever
 * cover the same point at the same time, so in practice at most one of
 * these three queries ever matches.
 *
 * SAFE NO-OP, never throws for "nothing to assign": an uncovered
 * geography, a vacant territory (no currentAssignmentRef), or a
 * territory whose assignment somehow isn't ACTIVE all simply resolve to
 * `null` — this is expected and normal (e.g. a brand-new district with
 * no Territory Partner yet), not an error. The caller (salon.controller.
 * js#approveSalon) additionally wraps this in its own try/catch so a
 * resolution failure can NEVER block or fail a salon's approval.
 *
 * BACKFILL (backfillTerritoryAssignmentsForApprovedSalons, below) —
 * "existing salons can be backfilled safely": a one-time pass over
 * every already-APPROVED salon that predates this engine and has no
 * link yet. Reuses the exact same resolve-then-upsert logic as the
 * live approval hook (resolveActiveTerritoryForGeography +
 * upsertLinkForSalon) — no separate/divergent resolution rule. Safe by
 * construction:
 *   - dryRun (default true when run from the CLI script) never writes
 *     anything, only reports what WOULD happen.
 *   - idempotent — only ever queries salons with NO existing link
 *     (a $lookup exclusion, not an overwrite), so re-running after a
 *     successful pass is a safe no-op; it will never re-link, revert,
 *     or reassign an existing link.
 *   - read-only against Salon (never writes to it), CommercialTerritory
 *     and TerritoryAssignment (same as the live hook).
 *   - one salon's failure is caught and counted, never aborts the batch.
 */

import Salon from "../../../models/Salon.js";
import CommercialTerritory from "../../fieldAgent/models/CommercialTerritory.js";
import TerritoryAssignment from "../../fieldAgent/models/TerritoryAssignment.js";
import SalonTerritoryAssignment from "../models/SalonTerritoryAssignment.js";
import { TERRITORY_SCOPE_TYPE, TERRITORY_STATUS, ASSIGNMENT_STATUS } from "../../fieldAgent/constants/commercialTerritory.constants.js";
import { SALON_TERRITORY_ASSIGNMENT_SOURCE } from "../constants/territoryAutoAssignment.constants.js";

/**
 * Resolves the single ACTIVE CommercialTerritory (if any) whose
 * geography covers the given district/city/area. Read-only.
 */
export const resolveActiveTerritoryForGeography = async ({ districtRef, cityRef, areaRef }) => {
  if (!districtRef) return null;

  if (areaRef) {
    const areaTerritory = await CommercialTerritory.findOne({
      status: TERRITORY_STATUS.ACTIVE,
      scopeType: TERRITORY_SCOPE_TYPE.AREA_SET,
      districtRef,
      areaRefs: areaRef,
    }).lean();
    if (areaTerritory) return areaTerritory;
  }

  if (cityRef) {
    const cityTerritory = await CommercialTerritory.findOne({
      status: TERRITORY_STATUS.ACTIVE,
      scopeType: TERRITORY_SCOPE_TYPE.CITY,
      districtRef,
      cityRef,
    }).lean();
    if (cityTerritory) return cityTerritory;
  }

  const districtTerritory = await CommercialTerritory.findOne({
    status: TERRITORY_STATUS.ACTIVE,
    scopeType: TERRITORY_SCOPE_TYPE.DISTRICT,
    districtRef,
  }).lean();
  return districtTerritory || null;
};

/**
 * Shared core: resolves the ACTIVE Territory Partner for a given
 * geography and upserts the link for one salon. Returns the link doc,
 * or a { skipped: reason } marker if there was nothing to assign — used
 * by both the live per-salon hook and the batch backfill below so the
 * two never diverge in behavior.
 */
const resolveAndUpsertLink = async ({ salonId, districtRef, cityRef, areaRef, source }) => {
  const territory = await resolveActiveTerritoryForGeography({ districtRef, cityRef, areaRef });
  if (!territory || !territory.currentAssignmentRef) return { skipped: !territory ? "UNCOVERED" : "VACANT" };

  const assignment = await TerritoryAssignment.findOne({
    _id: territory.currentAssignmentRef,
    status: ASSIGNMENT_STATUS.ACTIVE,
  }).lean();
  if (!assignment) return { skipped: "VACANT" }; // denormalized pointer somehow stale — never guessed at

  const link = await SalonTerritoryAssignment.findOneAndUpdate(
    { salonRef: salonId },
    {
      $set: {
        territoryRef: territory._id,
        fieldAgentRef: assignment.fieldAgentRef,
        assignedAt: new Date(),
        source,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return { link };
};

/**
 * The main entry point — called once, right after a Salon transitions
 * to APPROVED. Resolves the active Territory Partner for that salon's
 * own geography and upserts the link. Returns the created/updated
 * SalonTerritoryAssignment document, or null if there was nothing to
 * assign (uncovered geography, vacant territory, or no ACTIVE
 * assignment) — never throws for those expected cases.
 */
export const autoAssignTerritoryPartnerForSalon = async ({ salonId }) => {
  const salon = await Salon.findById(salonId).select("location.territory").lean();
  if (!salon) return null;

  const { districtRef, cityRef, areaRef } = salon.location?.territory || {};
  if (!districtRef) return null;

  const result = await resolveAndUpsertLink({
    salonId,
    districtRef,
    cityRef,
    areaRef,
    source: SALON_TERRITORY_ASSIGNMENT_SOURCE.AUTO_ON_APPROVAL,
  });
  return result.link ?? null;
};

/** Read-only lookup — the Territory Partner currently linked to a salon, or null. */
export const getTerritoryLinkForSalon = (salonId) =>
  SalonTerritoryAssignment.findOne({ salonRef: salonId }).lean();

/**
 * "Existing salons can be backfilled safely" — a one-time, safely
 * re-runnable pass over every already-APPROVED salon that has no
 * SalonTerritoryAssignment link yet (predates this engine, or was
 * approved before a Territory Partner existed for its area). Reuses
 * resolveAndUpsertLink — the exact same resolution rule the live hook
 * uses, never a second/divergent one.
 *
 * dryRun (default true) performs every read and reports exactly what
 * WOULD happen, without writing anything — the explicit safety valve
 * "backfilled safely" asks for. Pass { dryRun: false } to actually
 * write the links.
 *
 * Never touches Salon's own schema, CommercialTerritory,
 * TerritoryAssignment, AcquisitionClaim, or any finance/wallet/GST/
 * Razorpay/Booking collection — reads Salon + CommercialTerritory +
 * TerritoryAssignment, writes only to this module's own
 * SalonTerritoryAssignment collection.
 */
export const backfillTerritoryAssignmentsForApprovedSalons = async ({ batchSize = 200, dryRun = true, salonIds = null } = {}) => {
  // salonIds is an optional scoping filter — used ONLY by the disposable
  // live-verification script, to run this exact production logic
  // against a handful of fixture salons without scanning/touching every
  // real approved salon in the database. Omitted (the default), this
  // runs over the full, real Salon collection exactly as an ops backfill
  // is meant to.
  const scopeMatch = { "approval.status": "APPROVED", ...(salonIds ? { _id: { $in: salonIds } } : {}) };

  const summary = {
    dryRun: !!dryRun,
    totalApprovedSalons: await Salon.countDocuments(scopeMatch),
    candidatesScanned: 0, // already-linked salons are excluded by the $lookup below, never scanned
    linked: 0,
    skippedUncovered: 0,
    skippedVacant: 0,
    skippedNoGeography: 0,
    errors: 0,
  };

  const cursor = Salon.aggregate([
    { $match: scopeMatch },
    {
      $lookup: {
        from: SalonTerritoryAssignment.collection.name,
        localField: "_id",
        foreignField: "salonRef",
        as: "_existingLink",
      },
    },
    { $match: { _existingLink: { $size: 0 } } },
    { $project: { "location.territory": 1 } },
  ]).cursor({ batchSize });

  for await (const salon of cursor) {
    summary.candidatesScanned += 1;
    try {
      const { districtRef, cityRef, areaRef } = salon.location?.territory || {};
      if (!districtRef) { summary.skippedNoGeography += 1; continue; }

      if (dryRun) {
        const territory = await resolveActiveTerritoryForGeography({ districtRef, cityRef, areaRef });
        if (!territory || !territory.currentAssignmentRef) { summary.skippedVacant += territory ? 1 : 0; summary.skippedUncovered += territory ? 0 : 1; continue; }
        const assignment = await TerritoryAssignment.findOne({ _id: territory.currentAssignmentRef, status: ASSIGNMENT_STATUS.ACTIVE }).lean();
        if (!assignment) { summary.skippedVacant += 1; continue; }
        summary.linked += 1; // "would link" — nothing written
        continue;
      }

      const result = await resolveAndUpsertLink({
        salonId: salon._id,
        districtRef,
        cityRef,
        areaRef,
        source: SALON_TERRITORY_ASSIGNMENT_SOURCE.BACKFILL,
      });
      if (result.link) summary.linked += 1;
      else if (result.skipped === "UNCOVERED") summary.skippedUncovered += 1;
      else summary.skippedVacant += 1;
    } catch (err) {
      summary.errors += 1;
    }
  }

  return summary;
};
