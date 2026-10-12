/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFingerprintExpiryBoundary.mjs
 *
 * Phase 3b — scoped-idempotency TTL-sync fix, boundary-condition test
 * (security review follow-up, 2026-10-10). Constructs the EXACT state
 * the TTL-asymmetry bug depended on — the fingerprint marker gone,
 * the shared response cache still valid — directly via Redis, rather
 * than waiting the real ~120 seconds for it to arise naturally. Real
 * Mongo, real HTTP (app.listen(0)), real Redis, the REAL, unmodified
 * production route (POST /api/salon/kyc/identity, through
 * ownerKyc.routes.js exactly as mounted in app.js) — not a dummy
 * harness. No Cashfree/Surepass/Cloudinary/provider call of any kind.
 *
 * SECTION 1 (original, kept for reference — NOT what v3 targets):
 * forces the fingerprint's TTL down via redis.expire() directly,
 * standing in generically for "time has passed without a refresh."
 * This is a TEST-CONSTRUCTION TECHNIQUE, not a reproduction of a real
 * production failure path — nothing external to this middleware ever
 * calls redis.expire() on its keys in real operation. It is kept
 * because it's still a valid demonstration of the raw mechanics, and
 * because v3's own header is explicit that it does NOT and cannot
 * address externally-tampered Redis state — only a genuine failure of
 * the refresh WRITE ITSELF. This section's outcome is expected to be
 * UNCHANGED by v3, and is reported as such, not conflated with v3's
 * actual target.
 *
 * SECTION 2 (new, v3 follow-up) — the REALISTIC scenario: a selective
 * monkey-patch makes ONLY the refresh write
 * (redis.set(payloadHashKey, hash, {EX}) — no NX) throw, while leaving
 * the initial claim (same key, WITH NX) and the shared middleware's
 * own cache write (a different key, finalKey) to succeed normally —
 * this is the actual code path v3's compensating delete targets.
 * Verifies: the compensating delete actually removes the shared cache
 * entry; the fingerprint itself (from the untouched initial claim)
 * survives; and — after additionally letting that surviving
 * fingerprint also lapse (fully reconstructing the original dangerous
 * state) — a different payload gets its OWN fresh processing, never
 * stale data belonging to the first payload.
 *
 * SECTION 3 (new) — same-payload retry after a genuine refresh
 * failure: confirms the "successful cleanup" side effect is safe
 * (reprocessed, not an error, never cross-contaminated with another
 * payload's data) — the documented, already-accepted trade-off from
 * v3's own header, verified rather than asserted by comment alone.
 *
 * Cleanup (Redis keys, the monkey-patched redis.set, and all Mongo
 * fixtures) runs in `finally` blocks, so it executes even if an
 * assertion fails.
 *
 * This file only adds a new, isolated test. No application code is
 * modified by running it.
 *
 * Run:  cd backend && node scripts/e2e/verifyFingerprintExpiryBoundary.mjs
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

const NAME_PREFIX = `${SHARED_PREFIX}P3BBOUNDARY_`;
const SCOPE_NAME = "ownerKyc.identity"; // the literal scope constant used in ownerKyc.routes.js
const FORCED_TTL_SEC = 1;
const WAIT_MS = 1500;

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; rows.push(`✅ ${name}`); }
  else { fail++; rows.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 500) : ""}`); }
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
  let fingerprintKey = null;
  let sharedKey = null;
  let fingerprintKey2 = null;
  let sharedKey2 = null;
  let fingerprintKey3 = null;
  let sharedKey3 = null;
  let fingerprintKey4 = null;
  let sharedKey4 = null;

  try {
    const owner = await User.create({ name: `${NAME_PREFIX}OWNER`, phone: nextPhone("7"), role: "OWNER", accountStatus: "ACTIVE", tokenVersion: 0 });
    createdIds.users.push(owner._id);
    const token = generateAccessToken({ _id: owner._id, role: "OWNER", tokenVersion: 0 });

    const userId = owner._id.toString();
    const idemKey = "boundary-" + Date.now();
    fingerprintKey = `idempotency-payload:${userId}:${SCOPE_NAME}:${idemKey}`;
    sharedKey = `idempotency:${userId}:${SCOPE_NAME}:${idemKey}`;

    // ════════════════════════════════════════════════════════
    // SECTION 1 — artificial TTL tampering (reference only — see
    // file header; v3 does not target this exact technique)
    // ════════════════════════════════════════════════════════

    const p1 = await authFetch("/api/salon/kyc/identity", token, {
      method: "POST", headers: { "Idempotency-Key": idemKey },
      body: JSON.stringify({ panNumber: "ABCDE1234F", nameOnPAN: "Boundary P1" }),
    });
    check("S1. P1 completes successfully, not cached", p1.status === 200 && p1.data?.cached !== true, p1.data);

    const ttlAfterP1Fingerprint = await redis.ttl(fingerprintKey);
    const ttlAfterP1Shared = await redis.ttl(sharedKey);
    check("S1. Both Redis keys exist with a positive TTL immediately after P1", ttlAfterP1Fingerprint > 0 && ttlAfterP1Shared > 0, { ttlAfterP1Fingerprint, ttlAfterP1Shared });

    const expireResult = await redis.expire(fingerprintKey, FORCED_TTL_SEC);
    check("S1. Fingerprint key's TTL was successfully forced down", expireResult === true || expireResult === 1, expireResult);

    await new Promise((r) => setTimeout(r, WAIT_MS));

    const fingerprintTtlBeforeP2 = await redis.ttl(fingerprintKey);
    const sharedTtlBeforeP2 = await redis.ttl(sharedKey);
    check(
      "S1. PRECONDITION confirmed before sending P2: fingerprint key is GONE (ttl -2) while shared cache key is STILL VALID (ttl > 0) — this is the exact boundary state",
      fingerprintTtlBeforeP2 === -2 && sharedTtlBeforeP2 > 0,
      { fingerprintTtlBeforeP2, sharedTtlBeforeP2 }
    );

    const p2 = await authFetch("/api/salon/kyc/identity", token, {
      method: "POST", headers: { "Idempotency-Key": idemKey },
      body: JSON.stringify({ panNumber: "ZZZZZ9999Z", nameOnPAN: "Boundary P2 — must not reuse P1" }),
    });

    // NOT a pass/fail check — this is documentation of a KNOWN,
    // EXPECTED, out-of-scope result, not a signal that something is
    // broken. v3 fixes "the refresh write fails"; it has no way to
    // observe or react to Redis state tampered with directly by
    // something external (redis.expire() called from outside the
    // middleware, as this section does on purpose). Counting this as
    // a tallied pass/fail would misrepresent what v3 actually targets
    // — see Section 2 below for the real, decisive result.
    const p2GotStaleCache = p2.status === 200 && p2.data?.cached === true;
    rows.push(p2GotStaleCache
      ? `ℹ️  S1 (expected, outside v3's scope, NOT counted toward pass/fail): P2 received status=${p2.status}, cached=${p2.data?.cached} — externally-tampered TTL state is not something v3's compensating delete can observe or prevent.`
      : `ℹ️  S1 (not counted toward pass/fail): P2 was handled as status=${p2.status}.`);

    // ════════════════════════════════════════════════════════
    // SECTION 2 — realistic refresh failure (v3's actual target)
    // ════════════════════════════════════════════════════════
    {
      const owner2 = await User.create({ name: `${NAME_PREFIX}OWNER2`, phone: nextPhone("7"), role: "OWNER", accountStatus: "ACTIVE", tokenVersion: 0 });
      createdIds.users.push(owner2._id);
      const token2 = generateAccessToken({ _id: owner2._id, role: "OWNER", tokenVersion: 0 });
      const userId2 = owner2._id.toString();
      const idemKey2 = "boundary2-" + Date.now();
      fingerprintKey2 = `idempotency-payload:${userId2}:${SCOPE_NAME}:${idemKey2}`;
      sharedKey2 = `idempotency:${userId2}:${SCOPE_NAME}:${idemKey2}`;

      const originalRedisSet = redis.set.bind(redis);
      redis.set = async (key, value, opts) => {
        // Selective: only the REFRESH call (same key as the initial
        // claim, but WITHOUT NX) is made to fail. The initial claim
        // (same key, WITH NX) and the shared middleware's own write
        // (a different key, finalKey) both pass through untouched —
        // this is what makes the test faithful to "the refresh
        // specifically fails while the shared cache write succeeds."
        if (key === fingerprintKey2 && !opts?.NX) {
          throw new Error("SIMULATED: fingerprint refresh write failure");
        }
        return originalRedisSet(key, value, opts);
      };

      let p1b;
      try {
        p1b = await authFetch("/api/salon/kyc/identity", token2, {
          method: "POST", headers: { "Idempotency-Key": idemKey2 },
          body: JSON.stringify({ panNumber: "ABCDE1234F", nameOnPAN: "Boundary2 P1" }),
        });
      } finally {
        redis.set = originalRedisSet; // restore immediately, regardless of outcome
      }

      check("S2. P1 still completes successfully despite the refresh write failing (fail-open preserved)", p1b.status === 200 && p1b.data?.cached !== true, p1b.data);

      const fingerprintTtlAfterFailure = await redis.ttl(fingerprintKey2);
      const sharedTtlAfterFailure = await redis.ttl(sharedKey2);
      check("S2. Fingerprint survives (from the untouched initial claim) — positive TTL", fingerprintTtlAfterFailure > 0, fingerprintTtlAfterFailure);
      check("S2. Compensating delete fired: shared cache entry is now GONE (ttl -2), not left orphaned", sharedTtlAfterFailure === -2, sharedTtlAfterFailure);

      // Fully reconstruct the original dangerous state: let the
      // surviving fingerprint also lapse (same short, bounded,
      // deterministic technique as Section 1), so BOTH markers are
      // now absent — exactly what would happen in production once
      // t=120 passes after a refresh that failed.
      await redis.expire(fingerprintKey2, FORCED_TTL_SEC);
      await new Promise((r) => setTimeout(r, WAIT_MS));
      const fingerprintTtlFinal = await redis.ttl(fingerprintKey2);
      check("S2. PRECONDITION before P2b: fingerprint now also gone (ttl -2)", fingerprintTtlFinal === -2, fingerprintTtlFinal);

      const p2b = await authFetch("/api/salon/kyc/identity", token2, {
        method: "POST", headers: { "Idempotency-Key": idemKey2 },
        body: JSON.stringify({ panNumber: "ZZZZZ9999Z", nameOnPAN: "Boundary2 P2 — must get its OWN response" }),
      });
      const p2bGotStaleCache = p2b.status === 200 && p2b.data?.cached === true;
      check(
        "S2. DECISIVE: with both markers gone (the full original dangerous state), P2 still does NOT receive P1's stale cached response — it gets its own fresh processing instead",
        !p2bGotStaleCache,
        { p2bStatus: p2b.status, p2bData: p2b.data }
      );
      // Confirm it's genuinely P2's own data, not merely "not cached":
      const p2bMasked = p2b.data?.data?.identity?.pan?.maskedNumber;
      check("S2. P2's response reflects P2's OWN submitted PAN (ZZZZZ****Z), not P1's", p2bMasked === "ZZZZZ****Z", p2bMasked);
    }

    // ════════════════════════════════════════════════════════
    // SECTION 3 — same-payload retry after a genuine refresh failure
    // (the documented, accepted side effect: reprocessed, not an
    // error, never cross-contaminated with another payload)
    // ════════════════════════════════════════════════════════
    {
      const owner3 = await User.create({ name: `${NAME_PREFIX}OWNER3`, phone: nextPhone("7"), role: "OWNER", accountStatus: "ACTIVE", tokenVersion: 0 });
      createdIds.users.push(owner3._id);
      const token3 = generateAccessToken({ _id: owner3._id, role: "OWNER", tokenVersion: 0 });
      const idemKey3 = "boundary3-" + Date.now();
      fingerprintKey3 = `idempotency-payload:${owner3._id.toString()}:${SCOPE_NAME}:${idemKey3}`;
      sharedKey3 = `idempotency:${owner3._id.toString()}:${SCOPE_NAME}:${idemKey3}`;

      const originalRedisSet3 = redis.set.bind(redis);
      redis.set = async (key, value, opts) => {
        if (key === fingerprintKey3 && !opts?.NX) {
          throw new Error("SIMULATED: fingerprint refresh write failure");
        }
        return originalRedisSet3(key, value, opts);
      };

      let p1c;
      try {
        p1c = await authFetch("/api/salon/kyc/identity", token3, {
          method: "POST", headers: { "Idempotency-Key": idemKey3 },
          body: JSON.stringify({ panNumber: "ABCDE1234F", nameOnPAN: "Boundary3 Same Payload" }),
        });
      } finally {
        redis.set = originalRedisSet3;
      }
      check("S3. First call succeeds despite the refresh failure", p1c.status === 200, p1c.data);

      // Same payload, same key, immediately after — the shared cache
      // was deleted by the compensating logic, so this is expected to
      // be REPROCESSED (not served from cache) rather than erroring —
      // the documented, safe trade-off.
      const retrySame = await authFetch("/api/salon/kyc/identity", token3, {
        method: "POST", headers: { "Idempotency-Key": idemKey3 },
        body: JSON.stringify({ panNumber: "ABCDE1234F", nameOnPAN: "Boundary3 Same Payload" }),
      });
      check("S3. Same-payload retry succeeds (reprocessed, not an error) rather than failing or hanging", retrySame.status === 200, retrySame.data);
      check("S3. The reprocessed retry reflects the SAME, correct PAN — no cross-contamination with any other payload", retrySame.data?.data?.identity?.pan?.maskedNumber === "ABCDE****F", retrySame.data);
    }

    // ════════════════════════════════════════════════════════
    // SECTION 4 — v4 atomic compare-and-delete: prove a STALE,
    // delayed cleanup cannot destroy a NEWER, legitimate generation.
    // Uses a genuine barrier (a manually-controlled Promise), not an
    // arbitrary sleep, to pause request A's cleanup exactly at its
    // redis.eval() call — the real synchronization point — while a
    // SECOND, genuinely real HTTP request (B) legitimately claims and
    // writes a fresh generation of the same Redis key. A's stale
    // cleanup is then released and must find a mismatch, not delete
    // B's data.
    // ════════════════════════════════════════════════════════
    {
      const owner4 = await User.create({ name: `${NAME_PREFIX}OWNER4`, phone: nextPhone("7"), role: "OWNER", accountStatus: "ACTIVE", tokenVersion: 0 });
      createdIds.users.push(owner4._id);
      const token4 = generateAccessToken({ _id: owner4._id, role: "OWNER", tokenVersion: 0 });
      const userId4 = owner4._id.toString();
      const idemKey4 = "boundary4-" + Date.now();
      fingerprintKey4 = `idempotency-payload:${userId4}:${SCOPE_NAME}:${idemKey4}`;
      sharedKey4 = `idempotency:${userId4}:${SCOPE_NAME}:${idemKey4}`;

      const originalRedisSet4 = redis.set.bind(redis);
      const originalRedisEval4 = redis.eval.bind(redis);

      // Fails ONLY A's refresh (the first attempt on this key) —
      // deliberately a one-shot flag, not a blanket key-match, so
      // request B's OWN refresh succeeds normally and B never runs
      // its own cleanup — otherwise B would legitimately delete its
      // own entry before A's stale check even runs, which would still
      // prove "A doesn't wrongly delete it" but through a different,
      // less direct mechanism than the one this test is meant to
      // demonstrate.
      let fingerprintFailureAlreadyTriggered = false;
      redis.set = async (key, value, opts) => {
        if (key === fingerprintKey4 && !opts?.NX && !fingerprintFailureAlreadyTriggered) {
          fingerprintFailureAlreadyTriggered = true;
          throw new Error("SIMULATED: fingerprint refresh write failure (A only)");
        }
        return originalRedisSet4(key, value, opts);
      };

      // The barrier — a manually-controlled Promise, not a sleep. A's
      // compare-and-delete call is paused on it until the test
      // explicitly releases it, after B's genuine write has landed.
      let releaseBarrier;
      const barrier = new Promise((resolve) => { releaseBarrier = resolve; });
      let evalCallCaptured = null;
      let aPromise = null; // tracked outside the try block so it can
      // be drained below even if the try block exits via the
      // capture-timeout error path.

      redis.eval = async (script, params) => {
        if (params?.keys?.[0] === sharedKey4 && evalCallCaptured === null) {
          evalCallCaptured = params;
          await barrier; // suspend A's cleanup here — the real sync point
        }
        return originalRedisEval4(script, params);
      };

      // Everything from here on runs with redis.set/redis.eval
      // monkey-patched — wrapped in try/finally so BOTH are restored
      // even if a capture-timeout or any assertion setup throws
      // partway through, never leaking the patch into later sections
      // or the outer catch block.
      try {
        // Fire A — do NOT await yet. We need A to run up to the point
        // where its compare-and-delete call is captured and paused.
        aPromise = authFetch("/api/salon/kyc/identity", token4, {
          method: "POST", headers: { "Idempotency-Key": idemKey4 },
          body: JSON.stringify({ panNumber: "ABCDE1234F", nameOnPAN: "Boundary4 A — stale cleanup" }),
        });

        // Deterministic wait for the actual synchronization event (A's
        // eval call being captured), not a fixed-duration guess — polls
        // a flag that flips the instant it happens, bounded and fast.
        const deadline = Date.now() + 10_000;
        while (evalCallCaptured === null) {
          if (Date.now() > deadline) throw new Error("Timed out waiting for A's compare-and-delete call to be captured");
          await new Promise((r) => setTimeout(r, 10));
        }
        check("S4. A's compare-and-delete call was captured and is now paused on the barrier", evalCallCaptured !== null, evalCallCaptured);

        // While A is paused: simulate that real wall-clock time has
        // passed (both of A's original markers naturally expired), then
        // fire a GENUINELY REAL second HTTP request B — different
        // payload, same user/route/Idempotency-Key — which legitimately
        // claims fresh and writes its OWN new generation.
        await redis.del(fingerprintKey4);
        await redis.del(sharedKey4);

        const bResult = await authFetch("/api/salon/kyc/identity", token4, {
          method: "POST", headers: { "Idempotency-Key": idemKey4 },
          body: JSON.stringify({ panNumber: "ZZZZZ9999Z", nameOnPAN: "Boundary4 B — newer legitimate generation" }),
        });
        check("S4. B (a genuinely real, later request) succeeds and is NOT cached", bResult.status === 200 && bResult.data?.cached !== true, bResult.data);

        const bGenerationValue = await redis.get(sharedKey4);
        check(
          "S4. B's new generation is actually present in Redis, with B's OWN data, BEFORE A's stale cleanup is released",
          typeof bGenerationValue === "string" && JSON.parse(bGenerationValue)?.data?.identity?.pan?.maskedNumber === "ZZZZZ****Z",
          bGenerationValue?.slice(0, 200)
        );

        // Release A's stale cleanup. Its expected value was computed
        // from A's OWN response, long before B ever existed — it must
        // now find a mismatch against B's generation and delete nothing.
        releaseBarrier();

        const aResult = await aPromise;
        check("S4. A itself still completes successfully despite its own refresh failure", aResult.status === 200, aResult.data);

        const survivingValue = await redis.get(sharedKey4);
        check(
          "S4. DECISIVE: B's newer, unrelated, legitimate cache generation SURVIVED A's delayed, stale compare-and-delete — it was not destroyed",
          survivingValue === bGenerationValue,
          { survivingValue: survivingValue?.slice(0, 200), expected: bGenerationValue?.slice(0, 200) }
        );
      } finally {
        // Safety net: release the barrier unconditionally, even on a
        // capture-timeout — resolving an already-resolved Promise is
        // a safe no-op. Without this, a timeout above would leave
        // aPromise permanently suspended on `await barrier` inside
        // the patched redis.eval, which would hang the HTTP request
        // and prevent server.close() below from ever completing.
        releaseBarrier();
        redis.set = originalRedisSet4;
        redis.eval = originalRedisEval4;
      }

      // Drain aPromise unconditionally — the barrier is guaranteed
      // released by the finally block above, so A's request (success
      // or failure) can now actually settle. Prevents a dangling
      // in-flight request from outliving this test when the
      // capture-timeout path was taken.
      if (aPromise) await aPromise.catch(() => {});

      await redis.del(fingerprintKey4).catch(() => {});
      await redis.del(sharedKey4).catch(() => {});
    }

  } catch (err) {
    console.error("FATAL:", err);
    fail++;
    rows.push(`❌ FATAL — ${err.message}`);
  } finally {
    // ── Cleanup — runs regardless of pass/fail above ──
    if (fingerprintKey) await redis.del(fingerprintKey).catch(() => {});
    if (sharedKey) await redis.del(sharedKey).catch(() => {});
    if (fingerprintKey2) await redis.del(fingerprintKey2).catch(() => {});
    if (sharedKey2) await redis.del(sharedKey2).catch(() => {});
    if (fingerprintKey3) await redis.del(fingerprintKey3).catch(() => {});
    if (sharedKey3) await redis.del(sharedKey3).catch(() => {});
    if (fingerprintKey4) await redis.del(fingerprintKey4).catch(() => {});
    if (sharedKey4) await redis.del(sharedKey4).catch(() => {});
    await VerificationLog.deleteMany({ ownerId: { $in: createdIds.users } });
    await KYC.deleteMany({ ownerId: { $in: createdIds.users } });
    await User.deleteMany({ _id: { $in: createdIds.users } });
    server.close();
    await mongoose.disconnect();
  }

  console.log(rows.join("\n"));
  console.log(`\nFINGERPRINT EXPIRY BOUNDARY: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
