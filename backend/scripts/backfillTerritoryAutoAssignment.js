/**
 * BARBER_ENGINE_V1
 * backend/scripts/backfillTerritoryAutoAssignment.js
 *
 * STEP 5.2 — Territory Auto Assignment Engine — "existing salons can be
 * backfilled safely."
 *
 * DEFAULT MODE IS DRY-RUN. This script never writes anything unless you
 * pass --apply explicitly. Dry-run reports exactly what a real run
 * would do (how many salons would get linked, and why the rest would
 * be skipped) with zero side effects — safe to run anytime, as often as
 * you like, against the live dev or production DB.
 *
 * Idempotent when applied: only ever considers already-APPROVED salons
 * that have NO SalonTerritoryAssignment link yet. Running it twice in
 * --apply mode is a safe no-op the second time (every salon it already
 * linked is excluded from the next run's candidate set).
 *
 * Touches ONLY this module's own SalonTerritoryAssignment collection.
 * Never writes to Salon, CommercialTerritory, TerritoryAssignment,
 * AcquisitionClaim, or any finance/wallet/GST/Razorpay/Booking
 * collection — see TerritoryAutoAssignmentService.js's own header.
 *
 * Run (safe, read-only preview):
 *   cd backend && node scripts/backfillTerritoryAutoAssignment.js
 *
 * Run (actually writes the links):
 *   cd backend && node scripts/backfillTerritoryAutoAssignment.js --apply
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import { backfillTerritoryAssignmentsForApprovedSalons } from "../modules/territoryAutoAssignment/services/TerritoryAutoAssignmentService.js";

const apply = process.argv.includes("--apply");

const run = async () => {
  await connectDB();

  console.log(apply ? "Running LIVE (writes will happen)..." : "Running DRY-RUN (no writes — pass --apply to write)...");

  const summary = await backfillTerritoryAssignmentsForApprovedSalons({ dryRun: !apply });

  console.log("\n── Territory Auto Assignment — Backfill Summary ──");
  console.log(JSON.stringify(summary, null, 2));
  console.log(apply
    ? `\n${summary.linked} salon(s) linked.`
    : `\n${summary.linked} salon(s) WOULD be linked. Re-run with --apply to write.`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
