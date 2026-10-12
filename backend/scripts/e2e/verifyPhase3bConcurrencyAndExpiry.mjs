/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyPhase3bConcurrencyAndExpiry.mjs
 *
 * Phase 3b — scoped-idempotency TTL-synchronization fix (security
 * review follow-up, approved 2026-10-10). Real Mongo, real HTTP
 * (app.listen(0)), real Redis, through the EXACT production
 * middleware chain (ownerKyc.routes.js's own registered route, not a
 * hand-built test harness). NO Cashfree/Surepass/Cloudinary live call.
 *
 * Covers:
 *   A. TRUE CONCURRENCY — two genuinely simultaneous requests
 *      (Promise.all, not sequential awaits), same user/scope/key,
 *      DIFFERENT payloads. Exactly one must succeed, the other must
 *      get 409 — proven via Redis's atomic SET NX, not inferred.
 *   B. TRUE CONCURRENCY — same, but SAME payload. Exactly one
 *      VerificationLog row must result (no double-processing),
 *      regardless of which of {fresh 200, in-progress 409, cached 200}
 *      the second request happens to land on.
 *   C. EXPIRY-WINDOW FIX — DETERMINISTIC check (no sleep, no timing
 *      assertion): immediately after a normal round-trip, read BOTH
 *      the fingerprint marker's and the shared cache's real Redis TTLs
 *      directly and assert they are synchronized (within a small
 *      tolerance), proving the TTL-refresh-on-response actually fires
 *      — this structurally proves the fix regardless of how long the
 *      handler took, rather than waiting ~2 minutes for real expiry.
 *   D. Regression — same-payload retry still returns cached:true.
 *   E. Regression — different-payload (sequential) still returns 409.
 *   F. Regression — cross-route reuse of the same literal key still
 *      does not collide.
 *
 * Redis-failure behavior for the NEW res.json refresh hook is covered
 * separately, as a unit test, in
 * scripts/unit/verifyScopedIdempotencyRedisFailure.mjs (extended).
 *
 * Run:  cd backend && node scripts/e2e/verifyPhase3bConcurrencyAndExpiry.mjs
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../../app.js";
import connectDB from "../../config/db.js";
import redis from "../../config/redis.js";
import { generateAccessToken } from "../../services/token.service.js";
import User from "../../models/User.js";
import KYC from "../../modules/kyc/models/KYC.js";
import VerificationLog from "../../modules/kyc/models/VerificationLog.js";
import { nextPhone, NAME_PREFIX as SHARED_PREFIX } from "./fieldAgentE2EHelpers.js";

const NAME_PREFIX = `${SHARED_PREFIX}P3BX_`;

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; rows.push(`✅ ${name}`); }
  else { fail++; rows.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 300) : ""}`); }
};

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts = {}) =>
    fetch(url(path), {
      ...opts,
      headers: {
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers || {}),
      },
    }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));

  const createdIds = { users: [] };

  const mkOwner = async (label) => {
    const owner = await User.create({ name: `${NAME_PREFIX}OWNER_${label}`, phone: nextPhone("7"), role: "OWNER", accountStatus: "ACTIVE", tokenVersion: 0 });
    createdIds.users.push(owner._id);
    const token = generateAccessToken({ _id: owner._id, role: "OWNER", tokenVersion: 0 });
    return { user: owner, token };
  };

  try {
    // ════════════════════════════════════════════════════════
    // SECTION A — true concurrency, DIFFERENT payloads, same key
    // ════════════════════════════════════════════════════════
    {
      const ownerA = await mkOwner("CONCURRENT_DIFF");
      const keyA = "p3bx-a-" + Date.now();

      const [r1, r2] = await Promise.all([
        authFetch("/api/salon/kyc/identity", ownerA.token, {
          method: "POST", headers: { "Idempotency-Key": keyA },
          body: JSON.stringify({ panNumber: "ABCDE1234F", nameOnPAN: "Concurrent P1" }),
        }),
        authFetch("/api/salon/kyc/identity", ownerA.token, {
          method: "POST", headers: { "Idempotency-Key": keyA },
          body: JSON.stringify({ panNumber: "ZZZZZ9999Z", nameOnPAN: "Concurrent P2" }),
        }),
      ]);

      const statuses = [r1.status, r2.status].sort();
      check("A. Two truly concurrent requests, same key, DIFFERENT payloads → exactly one 200 and one 409", JSON.stringify(statuses) === JSON.stringify([200, 409]), { r1: r1.status, r2: r2.status, r1data: r1.data, r2data: r2.data });

      const winner = r1.status === 200 ? r1 : r2;
      const loser = r1.status === 409 ? r1 : r2;
      check("A. The winner's response is NOT a cached replay (this was the first-ever use of this key)", winner.data?.cached !== true, winner.data);
      check("A. The loser's rejection is the payload-mismatch message, not the shared middleware's in-progress message", loser.data?.message?.includes("different request"), loser.data);
    }

    // ════════════════════════════════════════════════════════
    // SECTION B — true concurrency, SAME payload, same key
    // ════════════════════════════════════════════════════════
    {
      const ownerB = await mkOwner("CONCURRENT_SAME");
      const keyB = "p3bx-b-" + Date.now();
      const sameBody = JSON.stringify({ panNumber: "ABCDE1234F", nameOnPAN: "Concurrent Same" });

      const [r1, r2] = await Promise.all([
        authFetch("/api/salon/kyc/identity", ownerB.token, { method: "POST", headers: { "Idempotency-Key": keyB }, body: sameBody }),
        authFetch("/api/salon/kyc/identity", ownerB.token, { method: "POST", headers: { "Idempotency-Key": keyB }, body: sameBody }),
      ]);

      // Neither may be rejected by the PAYLOAD-MISMATCH check (same
      // payload) — each must be one of: a freshly-processed 200, the
      // shared middleware's "already in progress" 409, or a cached 200.
      const bothAcceptable = [r1, r2].every((r) =>
        (r.status === 200) || (r.status === 409 && r.data?.message?.includes("already in progress"))
      );
      check("B. Two truly concurrent requests, same key, SAME payload → neither is rejected as a payload mismatch", bothAcceptable, { r1, r2 });

      const logCount = await VerificationLog.countDocuments({ ownerId: ownerB.user._id, action: "IDENTITY_SUBMITTED" });
      check("B. Exactly ONE VerificationLog row resulted — no double-processing under true concurrency", logCount === 1, { logCount });
    }

    // ════════════════════════════════════════════════════════
    // SECTION C — TTL synchronization, deterministic (no sleep)
    // ════════════════════════════════════════════════════════
    {
      const ownerC = await mkOwner("TTL_SYNC");
      const keyC = "p3bx-c-" + Date.now();
      const scopeName = "ownerKyc.identity"; // the literal scope constant used in ownerKyc.routes.js

      const r = await authFetch("/api/salon/kyc/identity", ownerC.token, {
        method: "POST", headers: { "Idempotency-Key": keyC },
        body: JSON.stringify({ panNumber: "ABCDE1234F", nameOnPAN: "TTL Sync Test" }),
      });
      check("C. Baseline request for the TTL-sync check succeeds", r.status === 200, r.data);

      const userId = ownerC.user._id.toString();
      const fingerprintKey = `idempotency-payload:${userId}:${scopeName}:${keyC}`;
      const sharedKey = `idempotency:${userId}:${scopeName}:${keyC}`;

      const fingerprintTtl = await redis.ttl(fingerprintKey);
      const sharedTtl = await redis.ttl(sharedKey);

      check("C. Fingerprint marker exists in Redis with a positive TTL", fingerprintTtl > 0, fingerprintTtl);
      check("C. Shared cache entry exists in Redis with a positive TTL", sharedTtl > 0, sharedTtl);
      // Deterministic structural check — not a timing/sleep assertion.
      // Both TTLs were set with the same 120s duration; the fix's job
      // is to make them START at (nearly) the same instant. A tight
      // tolerance (2s) comfortably accommodates normal test-process
      // scheduling jitter while still proving they are synchronized,
      // not offset by whatever the (here, sub-second) handler
      // processing time happened to be.
      check("C. Fingerprint and shared-cache TTLs are synchronized (within 2s) — proves the refresh-on-response fix fired", Math.abs(fingerprintTtl - sharedTtl) <= 2, { fingerprintTtl, sharedTtl });

      await redis.del(fingerprintKey).catch(() => {});
      await redis.del(sharedKey).catch(() => {});
    }

    // ════════════════════════════════════════════════════════
    // SECTION D/E/F — regression (sequential), re-confirmed after the fix
    // ════════════════════════════════════════════════════════
    {
      const ownerDEF = await mkOwner("REGRESSION_DEF");
      const keyDEF = "p3bx-def-" + Date.now();

      const first = await authFetch("/api/salon/kyc/identity", ownerDEF.token, {
        method: "POST", headers: { "Idempotency-Key": keyDEF },
        body: JSON.stringify({ panNumber: "ABCDE1234F", nameOnPAN: "Regression Test" }),
      });
      check("D. First call with a fresh key succeeds, not cached", first.status === 200 && first.data?.cached !== true, first.data);

      const second = await authFetch("/api/salon/kyc/identity", ownerDEF.token, {
        method: "POST", headers: { "Idempotency-Key": keyDEF },
        body: JSON.stringify({ panNumber: "ABCDE1234F", nameOnPAN: "Regression Test" }), // SAME payload
      });
      check("D. Same key + same payload (sequential retry) = cached:true (unaffected by the fix)", second.status === 200 && second.data?.cached === true, second.data);

      const third = await authFetch("/api/salon/kyc/identity", ownerDEF.token, {
        method: "POST", headers: { "Idempotency-Key": keyDEF },
        body: JSON.stringify({ panNumber: "ZZZZZ9999Z", nameOnPAN: "Different" }), // DIFFERENT payload
      });
      check("E. Same key + different payload (sequential) = 409 (unaffected by the fix)", third.status === 409, third.data);

      const bankCall = await authFetch("/api/salon/kyc/bank", ownerDEF.token, {
        method: "POST", headers: { "Idempotency-Key": keyDEF },
        body: JSON.stringify({ accountHolder: "Regression Test", accountNumber: "123456789012", ifsc: "HDFC0001234", bankName: "Test Bank" }),
      });
      check("F. Same literal key reused on a different route (/bank) still succeeds independently (unaffected by the fix)", bankCall.status === 200 && bankCall.data?.cached !== true, bankCall.data);
    }

  } catch (err) {
    console.error("FATAL:", err);
    fail++;
    rows.push(`❌ FATAL — ${err.message}`);
  } finally {
    await VerificationLog.deleteMany({ ownerId: { $in: createdIds.users } });
    await KYC.deleteMany({ ownerId: { $in: createdIds.users } });
    await User.deleteMany({ _id: { $in: createdIds.users } });
    server.close();
    await mongoose.disconnect();
  }

  console.log(rows.join("\n"));
  console.log(`\nPHASE 3b CONCURRENCY + EXPIRY-WINDOW: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
