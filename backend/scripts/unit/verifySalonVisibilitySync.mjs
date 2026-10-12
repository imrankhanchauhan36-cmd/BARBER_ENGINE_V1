/**
 * BARBER_ENGINE_V1
 * backend/scripts/unit/verifySalonVisibilitySync.mjs
 *
 * ZEMISH Option B, Phase 1 — focused offline tests for
 * syncSalonVisibilityForOwner() (services/salonVisibilitySync.
 * service.js) and the 5 call sites wired into it.
 *
 * NO live database: Salon.updateMany is temporarily replaced with a
 * local stub that records its call arguments and returns a
 * Mongo-shaped result, restored in a finally block. Importing
 * models/Salon.js and modules/kyc/models/KYC.js is safe offline —
 * both import only `mongoose` itself, confirmed by direct read; no
 * connection is attempted until a query actually executes, which
 * never happens here since the stub replaces the only method called.
 *
 * Covers:
 *   1. The existing, unchanged isMandatoryOwnerKycVerified() predicate
 *      determines the written value — not a new or separate rule.
 *   2. Missing KYC / disqualifying statuses fail closed (false).
 *   3. The Salon.updateMany filter is scoped to the given ownerId AND
 *      approval.status:"APPROVED" — never touches DRAFT/PENDING.
 *   4. The caller's session is passed straight through.
 *   5. A failure inside Salon.updateMany is NOT swallowed — it
 *      propagates to the caller, which is what lets the caller's own
 *      transaction abort instead of silently committing.
 *   6. Wiring — all 5 integration points (verifyPAN, verifyBank,
 *      approveKYC, rejectKYC, requestReupload) call
 *      syncSalonVisibilityForOwner BEFORE their own
 *      session.commitTransaction(), inside the same transaction.
 *
 * Run:  cd backend && node scripts/unit/verifySalonVisibilitySync.mjs
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import Salon from "../../models/Salon.js";
import { syncSalonVisibilityForOwner } from "../../services/salonVisibilitySync.service.js";
import { KYC_STATUS } from "../../modules/kyc/constants/kyc.constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(__dirname, "../..", rel), "utf8");

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

const run = async () => {
  const originalUpdateMany = Salon.updateMany;
  const fakeSession = { id: "fixture-session", inTransaction: () => true };

  try {
    // ── 1 & 3 & 4. Fully verified → true; filter scoped correctly; session passed through ──
    {
      let lastCall = null;
      Salon.updateMany = async (filter, update, options) => {
        lastCall = { filter, update, options };
        return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
      };

      const verifiedKyc = makeKyc(KYC_STATUS.VERIFIED, true, true);
      const result = await syncSalonVisibilityForOwner("owner-123", verifiedKyc, { session: fakeSession });

      check("1. Fully verified KYC (PAN+Bank true, VERIFIED status) → returns true", result === true);
      check("3. Filter scoped to the given ownerId", lastCall.filter.ownerId === "owner-123");
      check("3. Filter scoped to approval.status:\"APPROVED\" only (never DRAFT/PENDING)", lastCall.filter["approval.status"] === "APPROVED");
      check("1. Sets business.isKycVerifiedForDiscovery to the predicate's real result (true)", lastCall.update.$set["business.isKycVerifiedForDiscovery"] === true);
      check("4. The caller's session is passed straight through to updateMany's options", lastCall.options.session === fakeSession);
    }

    // ── 2. Missing KYC → false, fails closed ──
    {
      let lastCall = null;
      Salon.updateMany = async (filter, update, options) => { lastCall = { filter, update, options }; return {}; };
      const result = await syncSalonVisibilityForOwner("owner-456", null, { session: fakeSession });
      check("2. Missing KYC record (null) → returns false (fails closed), does not throw", result === false);
      check("2. Missing KYC record still writes false (revokes, never leaves stale true)", lastCall.update.$set["business.isKycVerifiedForDiscovery"] === false);
    }

    // ── 2. Disqualifying status with stale true flags → false (the regression case) ──
    {
      Salon.updateMany = async () => ({});
      const staleKyc = makeKyc(KYC_STATUS.REJECTED, true, true);
      const result = await syncSalonVisibilityForOwner("owner-789", staleKyc, { session: fakeSession });
      check("2. REJECTED status with stale PAN+Bank verified=true → still returns false (same predicate, same stale-flag protection)", result === false);
    }

    // ── 2. PAN or Bank individually unverified → false ──
    {
      Salon.updateMany = async () => ({});
      const partialKyc = makeKyc(KYC_STATUS.PARTIALLY_VERIFIED, true, false);
      const result = await syncSalonVisibilityForOwner("owner-999", partialKyc, { session: fakeSession });
      check("2. PAN verified but Bank not → returns false", result === false);
    }

    // ── 5. Sync failure propagates — does not get swallowed ──
    {
      Salon.updateMany = async () => { throw new Error("Simulated transient write failure"); };
      let threw = false;
      try {
        await syncSalonVisibilityForOwner("owner-111", makeKyc(KYC_STATUS.VERIFIED, true, true), { session: fakeSession });
      } catch (err) {
        threw = err.message === "Simulated transient write failure";
      }
      check("5. A Salon.updateMany failure propagates out of syncSalonVisibilityForOwner, not swallowed", threw === true);
    }
  } finally {
    Salon.updateMany = originalUpdateMany;
  }

  check("Salon.updateMany fully restored to its original implementation after this test", Salon.updateMany === originalUpdateMany);

  // ── 6. Wiring — all 5 call sites, source-text check ──
  const verificationSrc = read("modules/kyc/services/verification.service.js");
  const kycServiceSrc = read("modules/kyc/services/kyc.service.js");

  const checkCallsBeforeCommit = (label, src, fnName) => {
    const anchor = `export const ${fnName} =`;
    const start = src.indexOf(anchor);
    check(`6. ${label}: function found in source`, start !== -1);
    if (start === -1) return;
    // Find this function's own first commitTransaction() after the anchor.
    const commitIdx = src.indexOf("session.commitTransaction()", start);
    const syncIdx = src.indexOf("syncSalonVisibilityForOwner(", start);
    check(
      `6. ${label}: calls syncSalonVisibilityForOwner before its own session.commitTransaction()`,
      syncIdx !== -1 && commitIdx !== -1 && syncIdx < commitIdx
    );
  };

  checkCallsBeforeCommit("verifyPAN", verificationSrc, "verifyPAN");
  checkCallsBeforeCommit("verifyBank", verificationSrc, "verifyBank");
  checkCallsBeforeCommit("approveKYC", kycServiceSrc, "approveKYC");
  checkCallsBeforeCommit("rejectKYC", kycServiceSrc, "rejectKYC");
  checkCallsBeforeCommit("requestReupload", kycServiceSrc, "requestReupload");

  check("6. verification.service.js imports syncSalonVisibilityForOwner from the shared helper", verificationSrc.includes('import { syncSalonVisibilityForOwner } from "../../../services/salonVisibilitySync.service.js"'));
  check("6. kyc.service.js imports syncSalonVisibilityForOwner from the shared helper", kycServiceSrc.includes('import { syncSalonVisibilityForOwner } from "../../../services/salonVisibilitySync.service.js"'));

  console.log(rows.join("\n"));
  console.log(`\nSALON VISIBILITY SYNC: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
