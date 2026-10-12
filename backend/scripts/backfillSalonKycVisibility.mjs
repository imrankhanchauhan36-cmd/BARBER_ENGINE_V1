/**
 * BARBER ENGINE V1
 * backend/scripts/backfillSalonKycVisibility.mjs
 *
 * ZEMISH Option B, Phase 1 — one-time backfill for the new
 * Salon.business.isKycVerifiedForDiscovery field. Computes the real
 * value for every currently APPROVED salon using the exact same,
 * unchanged isMandatoryOwnerKycVerified() predicate already used to
 * gate submission/approval — never assumes a salon is KYC-verified
 * just because approval.status is "APPROVED".
 *
 * ⚠ NOT EXECUTED AS PART OF THIS PHASE. This file is written and
 * reviewed, never run, per the explicit instruction for this phase.
 * It connects to whatever MONGODB_URI is set when it IS eventually
 * run — that is a real, production-capable connection string, by
 * design (this backfill has to run against the real data it's
 * correcting) — there is no sandboxed/test variant of this script.
 *
 * ── MODES ──────────────────────────────────────────────────────────
 * Dry run (default, SAFE — zero writes):
 *   node scripts/backfillSalonKycVisibility.mjs
 *
 * Write mode (explicit opt-in, REQUIRED flag, applies the computed
 * values):
 *   node scripts/backfillSalonKycVisibility.mjs --write
 *
 * ── IDEMPOTENCY ────────────────────────────────────────────────────
 * Always recomputes from scratch via the same predicate on every run
 * — running write mode twice in a row produces the identical result
 * the second time (the "already correct, no change needed" counter
 * will simply equal the full scanned count). No run depends on any
 * prior run's output.
 *
 * ── SCOPE ──────────────────────────────────────────────────────────
 * Reads and (in write mode) writes ONLY Salon documents with
 * approval.status === "APPROVED". DRAFT/PENDING/REJECTED salons are
 * never touched — their visibility field is irrelevant until they
 * reach APPROVED, which the existing submit/approval gates already
 * control, unchanged by this script.
 */

import mongoose from "mongoose";
import Salon from "../models/Salon.js";
import KYC from "../modules/kyc/models/KYC.js";
import { APPLICANT_TYPE, KYC_STATUS } from "../modules/kyc/constants/kyc.constants.js";
import { isMandatoryOwnerKycVerified } from "../utils/onboardingKycGate.js";

const WRITE_MODE = process.argv.includes("--write");

const DISQUALIFYING_STATUSES = [KYC_STATUS.REJECTED, KYC_STATUS.EXPIRED, KYC_STATUS.REVERIFY_REQUIRED];

// Purely for the report's breakdown — does not duplicate or alter the
// real predicate's own logic, only categorizes AFTER calling it, for
// human-readable counts. Exported so scripts/unit/verifyBackfillSalon
// KycVisibility.mjs can test this exact decision logic offline,
// without ever executing the DB-connecting run() function below.
export const classify = (kyc) => {
  if (!kyc) return "NO_KYC_RECORD";
  const panBank = !!(kyc.verification?.pan?.verified && kyc.verification?.bank?.verified);
  const disqualified = DISQUALIFYING_STATUSES.includes(kyc.status);
  if (panBank && disqualified) return "STALE_FLAGS_DISQUALIFYING_STATUS";
  if (panBank && !disqualified) return "FULLY_VERIFIED";
  return "PAN_OR_BANK_NOT_VERIFIED";
};

// Exported, pure (no I/O) — the exact per-salon decision the dry-run
// report and write-mode both rely on. Extracted specifically so this
// can be unit-tested without a database connection.
export const computeBackfillDecision = (salon, kyc) => {
  const verified = isMandatoryOwnerKycVerified(kyc);
  const current = salon.business?.isKycVerifiedForDiscovery ?? false;
  return { verified, current, wouldChange: current !== verified, classification: classify(kyc) };
};

const run = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set. Refusing to run without an explicit connection string.");
    process.exit(1);
  }

  console.log(`Mode: ${WRITE_MODE ? "WRITE (will modify data)" : "DRY-RUN (no writes will be made)"}`);

  await mongoose.connect(uri);

  try {
    const approvedSalons = await Salon.find({ "approval.status": "APPROVED", isDeleted: { $ne: true } })
      .select("_id ownerId business.isKycVerifiedForDiscovery")
      .lean();

    const counts = {
      totalScanned: 0,
      resolvedTrue: 0,
      resolvedFalse: 0,
      alreadyCorrect: 0,
      wouldChange: 0,
      byClass: { NO_KYC_RECORD: 0, STALE_FLAGS_DISQUALIFYING_STATUS: 0, FULLY_VERIFIED: 0, PAN_OR_BANK_NOT_VERIFIED: 0 },
    };
    const pendingWrites = [];

    for (const salon of approvedSalons) {
      counts.totalScanned++;

      const kyc = await KYC.findOne({ ownerId: salon.ownerId, applicantType: APPLICANT_TYPE.OWNER, isDeleted: { $ne: true } })
        .select("status verification.pan.verified verification.bank.verified")
        .lean();

      const { verified, current, wouldChange, classification } = computeBackfillDecision(salon, kyc);
      counts.byClass[classification]++;
      if (verified) counts.resolvedTrue++; else counts.resolvedFalse++;

      if (!wouldChange) {
        counts.alreadyCorrect++;
      } else {
        counts.wouldChange++;
        pendingWrites.push({ salonId: salon._id, from: current, to: verified });
      }
    }

    console.log("\n=== BACKFILL REPORT ===");
    console.log("Total APPROVED salons scanned:", counts.totalScanned);
    console.log("Would resolve to visible=true:", counts.resolvedTrue);
    console.log("Would resolve to visible=false:", counts.resolvedFalse);
    console.log("Already correct (no change needed):", counts.alreadyCorrect);
    console.log("Would change:", counts.wouldChange);
    console.log("\nBreakdown by reason:");
    console.log("  No KYC record found at all:", counts.byClass.NO_KYC_RECORD);
    console.log("  Fully verified (PAN+Bank, qualifying status):", counts.byClass.FULLY_VERIFIED);
    console.log("  PAN or Bank not verified:", counts.byClass.PAN_OR_BANK_NOT_VERIFIED);
    console.log("  Stale verified flags but disqualifying status (REJECTED/EXPIRED/REVERIFY_REQUIRED):", counts.byClass.STALE_FLAGS_DISQUALIFYING_STATUS);

    if (!WRITE_MODE) {
      console.log("\nDRY RUN — no writes were made. Re-run with --write to apply these changes.");
      return;
    }

    console.log(`\nWRITE MODE — applying ${pendingWrites.length} update(s)...`);
    for (const w of pendingWrites) {
      await Salon.updateOne({ _id: w.salonId }, { $set: { "business.isKycVerifiedForDiscovery": w.to } });
    }
    console.log(`Done. ${pendingWrites.length} salon(s) updated.`);
  } finally {
    await mongoose.disconnect();
  }
};

// Guarded so importing this file's pure exports (classify,
// computeBackfillDecision) for an offline test never triggers a real
// DB connection attempt as an import side effect — run() only
// executes when this file is invoked directly as the main script.
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  run().catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
}
