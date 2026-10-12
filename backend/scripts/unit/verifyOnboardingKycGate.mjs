/**
 * BARBER_ENGINE_V1
 * backend/scripts/unit/verifyOnboardingKycGate.mjs
 *
 * ZEMISH onboarding-gate pass — REVISED. Pure unit check: NO database,
 * NO HTTP server, NO provider call. Tests the exported, pure
 * `isMandatoryOwnerKycVerified` predicate directly.
 *
 * UPDATE — ZEMISH Partner Registration restore pass: saveBasicInfo()
 * (controllers/salon.onboarding.controller.js) no longer calls this
 * predicate — that creation-time gate was removed so an owner can save
 * basic info and continue onboarding before PAN+Bank is verified.
 *
 * UPDATE — ZEMISH expected-flow correction: the Owner's own submitSalon()
 * (same file) ALSO no longer calls this predicate — submission no longer
 * requires KYC first either.
 *
 * UPDATE — ZEMISH "Admin approval blocked by KYC" fix: admin.controller.
 * js's updateSalonStatus() ALSO no longer calls this predicate — Admin
 * can approve a salon while the owner's KYC is still pending. For the
 * self-serve Owner path, this predicate is no longer called at any
 * submit/approval transition; enforcement moved to booking-readiness
 * instead (utils/salonReady.guard.js's isSalonReadyForBooking, which
 * checks the separate, synced business.isKycVerifiedForDiscovery field
 * — see verifySalonReadyKycGuard.mjs). This predicate is still
 * separately enforced by fieldAgentOnboarding.service.js's own
 * submitSalon() port for the Field-Agent-assisted path (unchanged) —
 * see verifyAssistedOnboardingSubmitGate.mjs for those wiring
 * assertions. The predicate's own logic, tested below, is unchanged by
 * any of this.
 *
 * IMPORTANT — imports ONLY from utils/onboardingKycGate.js, never from
 * controllers/salon.onboarding.controller.js directly: that controller
 * file's own import graph was confirmed, while building this test, to
 * open a REAL Redis connection as a module-load side effect — entirely
 * unrelated to this pure function, but enough to make the controller
 * unsafe to import for an "offline" test. That is exactly why the
 * predicate lives in its own small, dependency-free module.
 *
 * This file does NOT test the real HTTP route end-to-end (that would
 * require MongoDB + HTTP, forbidden this phase pending a confirmed
 * isolated test database) — it tests the gate's decision logic in
 * isolation, with synthetic {status, verification} fixtures standing
 * in for a real KYC document's shape.
 *
 * Covers EVERY KYC_STATUS value crossed with every PAN/Bank verified
 * combination (true/true, true/false, false/true, false/false) — in
 * particular, the exact bug this revision was built to catch: a
 * REJECTED/EXPIRED/REVERIFY_REQUIRED record whose individual
 * verification.pan.verified / verification.bank.verified flags are
 * STALE TRUE from a prior cycle (rejectKYC in kyc.service.js never
 * clears them) must still be BLOCKED — field-level "verified" alone is
 * not sufficient without also checking the overall status is not
 * disqualifying.
 *
 * Run:  cd backend && node scripts/unit/verifyOnboardingKycGate.mjs
 */

import { isMandatoryOwnerKycVerified } from "../../utils/onboardingKycGate.js";
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

const DISQUALIFYING = [KYC_STATUS.REJECTED, KYC_STATUS.EXPIRED, KYC_STATUS.REVERIFY_REQUIRED];

const run = () => {
  // ── No KYC record at all ──
  check("No KYC record at all: blocked", isMandatoryOwnerKycVerified(null) === false);
  check("undefined KYC: blocked (fails closed)", isMandatoryOwnerKycVerified(undefined) === false);
  check("Empty object (malformed/partial record): blocked", isMandatoryOwnerKycVerified({}) === false);

  // ── Every KYC_STATUS value, crossed with every PAN/Bank verified combination ──
  const ALL_STATUSES = Object.values(KYC_STATUS);
  check("Test covers every real KYC_STATUS value (no drift if a new status is ever added)", ALL_STATUSES.length === 8, ALL_STATUSES);

  for (const status of ALL_STATUSES) {
    const isDisqualifying = DISQUALIFYING.includes(status);

    // Both verified — the only combination that could ever be allowed.
    const bothVerified = isMandatoryOwnerKycVerified(makeKyc(status, true, true));
    if (isDisqualifying) {
      check(`status=${status}, PAN+Bank BOTH verified=true: STILL BLOCKED (the exact stale-flag bug this revision fixes — rejectKYC never clears field-level verified flags)`, bothVerified === false);
    } else {
      check(`status=${status}, PAN+Bank BOTH verified=true: allowed`, bothVerified === true);
    }

    // Every other combination must always be blocked, disqualifying or not.
    check(`status=${status}, only PAN verified: blocked`, isMandatoryOwnerKycVerified(makeKyc(status, true, false)) === false);
    check(`status=${status}, only Bank verified: blocked`, isMandatoryOwnerKycVerified(makeKyc(status, false, true)) === false);
    check(`status=${status}, neither verified: blocked`, isMandatoryOwnerKycVerified(makeKyc(status, false, false)) === false);
  }

  // ── Explicit, named regression assertions for the three disqualifying statuses ──
  check("REJECTED with stale PAN+Bank verified=true: blocked (explicit regression check)", isMandatoryOwnerKycVerified(makeKyc(KYC_STATUS.REJECTED, true, true)) === false);
  check("EXPIRED with stale PAN+Bank verified=true: blocked (explicit regression check)", isMandatoryOwnerKycVerified(makeKyc(KYC_STATUS.EXPIRED, true, true)) === false);
  check("REVERIFY_REQUIRED with stale PAN+Bank verified=true: blocked (explicit regression check)", isMandatoryOwnerKycVerified(makeKyc(KYC_STATUS.REVERIFY_REQUIRED, true, true)) === false);

  // ── Explicit, named checks for the non-blocking "Manual Review" /
  // in-progress states — PENDING and UNDER_REVIEW must only pass when
  // the fields are genuinely verified, never merely because the
  // overall record reached that status. ──
  check("PENDING alone (fields not yet verified) does NOT satisfy the gate", isMandatoryOwnerKycVerified(makeKyc(KYC_STATUS.PENDING, false, false)) === false);
  check("UNDER_REVIEW alone (fields not yet verified) does NOT satisfy the gate", isMandatoryOwnerKycVerified(makeKyc(KYC_STATUS.UNDER_REVIEW, false, false)) === false);
  check("PARTIALLY_VERIFIED alone (fields not yet verified) does NOT satisfy the gate", isMandatoryOwnerKycVerified(makeKyc(KYC_STATUS.PARTIALLY_VERIFIED, false, false)) === false);
  check("DRAFT (never submitted) does NOT satisfy the gate", isMandatoryOwnerKycVerified(makeKyc(KYC_STATUS.DRAFT, false, false)) === false);

  // ── Missing verification sub-object entirely (defensive — a real
  // .lean() projection should always include it per the controller's
  // own .select(), but the predicate must not throw if it's absent) ──
  check("KYC with status only, no verification sub-object at all: blocked, does not throw", isMandatoryOwnerKycVerified({ status: KYC_STATUS.VERIFIED }) === false);

  console.log(rows.join("\n"));
  console.log(`\nONBOARDING KYC GATE: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
