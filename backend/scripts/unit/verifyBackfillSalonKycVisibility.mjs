/**
 * BARBER_ENGINE_V1
 * backend/scripts/unit/verifyBackfillSalonKycVisibility.mjs
 *
 * ZEMISH Option B, Phase 1 — focused offline tests for the backfill
 * script's pure decision logic (scripts/backfillSalonKycVisibility.mjs
 * — classify() and computeBackfillDecision()).
 *
 * NO database connection of any kind: importing this file only pulls
 * in the two named, pure exports. The backfill script's own run()
 * function (the part that calls mongoose.connect()) is explicitly
 * guarded to only execute when that file is run directly as the main
 * script — confirmed by this test file's own successful, side-effect-
 * free import. This test NEVER calls run(), NEVER sets MONGODB_URI,
 * and NEVER passes --write — the backfill is not executed, only its
 * decision logic is exercised.
 *
 * Covers:
 *   - The existing isMandatoryOwnerKycVerified() predicate (via
 *     computeBackfillDecision) determines the resolved value.
 *   - Missing KYC records resolve to false, classified distinctly.
 *   - Disqualifying statuses with stale true flags still fail closed.
 *   - "already correct" vs "would change" is computed correctly
 *     against the salon's current stored value — proving dry-run mode
 *     can report accurate counts without ever writing.
 *
 * Run:  cd backend && node scripts/unit/verifyBackfillSalonKycVisibility.mjs
 */

import { classify, computeBackfillDecision } from "../backfillSalonKycVisibility.mjs";
import { KYC_STATUS } from "../../modules/kyc/constants/kyc.constants.js";

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; rows.push(`✅ ${name}`); }
  else { fail++; rows.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const makeKyc = (status, panVerified, bankVerified) => ({
  status,
  verification: { pan: { verified: panVerified }, bank: { verified: bankVerified } },
});

const run = () => {
  // ── classify() ──
  check("classify(null) → NO_KYC_RECORD", classify(null) === "NO_KYC_RECORD");
  check("classify(fully verified) → FULLY_VERIFIED", classify(makeKyc(KYC_STATUS.VERIFIED, true, true)) === "FULLY_VERIFIED");
  check("classify(REJECTED with stale true flags) → STALE_FLAGS_DISQUALIFYING_STATUS", classify(makeKyc(KYC_STATUS.REJECTED, true, true)) === "STALE_FLAGS_DISQUALIFYING_STATUS");
  check("classify(EXPIRED with stale true flags) → STALE_FLAGS_DISQUALIFYING_STATUS", classify(makeKyc(KYC_STATUS.EXPIRED, true, true)) === "STALE_FLAGS_DISQUALIFYING_STATUS");
  check("classify(REVERIFY_REQUIRED with stale true flags) → STALE_FLAGS_DISQUALIFYING_STATUS", classify(makeKyc(KYC_STATUS.REVERIFY_REQUIRED, true, true)) === "STALE_FLAGS_DISQUALIFYING_STATUS");
  check("classify(PAN only) → PAN_OR_BANK_NOT_VERIFIED", classify(makeKyc(KYC_STATUS.PARTIALLY_VERIFIED, true, false)) === "PAN_OR_BANK_NOT_VERIFIED");
  check("classify(neither) → PAN_OR_BANK_NOT_VERIFIED", classify(makeKyc(KYC_STATUS.DRAFT, false, false)) === "PAN_OR_BANK_NOT_VERIFIED");

  // ── computeBackfillDecision() — the exact per-salon logic the dry
  // run's counts and write-mode's pending-writes list both rely on ──

  // A salon currently false, owner now fully verified → would change to true.
  {
    const salon = { _id: "s1", business: { isKycVerifiedForDiscovery: false } };
    const d = computeBackfillDecision(salon, makeKyc(KYC_STATUS.VERIFIED, true, true));
    check("Salon currently false, KYC now fully verified: verified=true", d.verified === true);
    check("Salon currently false, KYC now fully verified: wouldChange=true", d.wouldChange === true);
    check("Salon currently false, KYC now fully verified: classification=FULLY_VERIFIED", d.classification === "FULLY_VERIFIED");
  }

  // A salon currently true, owner's KYC now missing entirely → would change to false (handles missing KYC records).
  {
    const salon = { _id: "s2", business: { isKycVerifiedForDiscovery: true } };
    const d = computeBackfillDecision(salon, null);
    check("Salon currently true, KYC record missing entirely: verified=false (fails closed)", d.verified === false);
    check("Salon currently true, KYC record missing entirely: wouldChange=true (would correct the stale true)", d.wouldChange === true);
    check("Salon currently true, KYC record missing entirely: classification=NO_KYC_RECORD", d.classification === "NO_KYC_RECORD");
  }

  // A salon already correctly false, no KYC → no change needed.
  {
    const salon = { _id: "s3", business: { isKycVerifiedForDiscovery: false } };
    const d = computeBackfillDecision(salon, null);
    check("Salon already false, KYC missing: wouldChange=false (already correct, no write needed)", d.wouldChange === false);
  }

  // A salon with no business sub-document at all on the lean object (defensive — must not throw).
  {
    const salon = { _id: "s4" };
    const d = computeBackfillDecision(salon, makeKyc(KYC_STATUS.VERIFIED, true, true));
    check("Salon with no business sub-document at all: does not throw, treats current as false", d.current === false && d.wouldChange === true);
  }

  // Regression case: salon currently true, owner's KYC rejected after prior approval → would change to false.
  {
    const salon = { _id: "s5", business: { isKycVerifiedForDiscovery: true } };
    const d = computeBackfillDecision(salon, makeKyc(KYC_STATUS.REJECTED, true, true));
    check("Salon currently true, KYC now REJECTED (stale flags): verified=false, wouldChange=true", d.verified === false && d.wouldChange === true);
  }

  console.log(rows.join("\n"));
  console.log(`\nBACKFILL SALON KYC VISIBILITY (decision logic only — run() was never invoked): ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
