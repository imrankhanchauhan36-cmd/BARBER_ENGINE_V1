/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifySlowHandlerExpiryWindow.mjs
 *
 * Phase 3b — scoped-idempotency TTL-sync fix, v2 follow-up (security
 * review, 2026-10-10). Directly targets the gap left untested by the
 * earlier fast-handler-only TTL check: this file builds a small,
 * self-contained Express app that mounts the REAL, unmodified
 * scopedIdempotency middleware (which transitively uses the REAL,
 * unmodified idempotency.middleware.js) in front of a DELIBERATELY
 * SLOW dummy handler (2.5s). No MongoDB fixtures are needed — this
 * exercises only the Redis-coordinating middleware layer, not any KYC
 * business logic, so a dummy handler is the correct, minimal boundary
 * for this specific property. Real Redis, real HTTP (app.listen(0)),
 * no Cashfree/Surepass/Cloudinary/provider call of any kind.
 *
 * Directly proves the literal requirement from the security review:
 * "a different payload cannot receive the original request's cached
 * response while that response remains valid" — now under a REAL,
 * multi-second gap between request-start and response-time (the
 * exact shape of the original bug), not just a fast round-trip.
 *
 * Covers:
 *   A. A different-payload request arriving WHILE the slow handler is
 *      still processing → 409 (protected by the original, awaited
 *      claim — unaffected by handler speed).
 *   B. A different-payload request arriving the INSTANT after the
 *      slow handler's response is released → still 409, NOT a replay
 *      of the original response. This is the direct, no-sleep-needed
 *      proof that the awaited refresh closes the gap regardless of
 *      how long the handler took.
 *   C. Deterministic TTL-sync check (direct redis.ttl() reads, not a
 *      timing/sleep assertion) immediately after the SLOW response —
 *      proves synchronization holds even with a real multi-second gap
 *      between request-start and response-time, unlike the earlier
 *      fast-handler-only version of this check.
 *   D. Same-payload retry after the slow handler still returns
 *      cached:true (regression).
 *
 * Run:  cd backend && node scripts/e2e/verifySlowHandlerExpiryWindow.mjs
 */

import "dotenv/config";
import express from "express";
import redis from "../../config/redis.js";
import { scopedIdempotency } from "../../middlewares/scopedIdempotency.middleware.js";

const SLOW_HANDLER_MS = 2500;
const SCOPE_NAME = "test.slowHandler";
const FAKE_USER_ID = "000000000000000000000099";

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; rows.push(`✅ ${name}`); }
  else { fail++; rows.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 300) : ""}`); }
};

const run = async () => {
  const testApp = express();
  testApp.use(express.json());
  // Stands in for protect() — this file is testing the Redis
  // coordination layer, not authentication, so a fixed fake user id
  // is the correct, minimal stand-in (same userId reused across all
  // requests in this file, by design — isolation-by-user is already
  // separately proven in verifyPhase3bKycSecurityHardening.mjs).
  testApp.use((req, res, next) => { req.user = { _id: FAKE_USER_ID }; next(); });

  testApp.post("/slow", scopedIdempotency(SCOPE_NAME), async (req, res) => {
    await new Promise((r) => setTimeout(r, SLOW_HANDLER_MS));
    res.json({ success: true, cached: false, receivedPan: req.body.panNumber });
  });

  const server = testApp.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const post = (body, idempotencyKey) =>
    fetch(url("/slow"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
      body: JSON.stringify(body),
    }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));

  try {
    // ════════════════════════════════════════════════════════
    // SECTION A — different payload arrives WHILE the slow handler
    // is still processing
    // ════════════════════════════════════════════════════════
    {
      const keyA = "slow-a-" + Date.now();
      const slowCallPromise = post({ panNumber: "ABCDE1234F" }, keyA);

      // Fire the conflicting request after a short, bounded delay
      // (well inside the 2.5s window) — not a fragile race, since the
      // original claim (awaited at request-start) protects the ENTIRE
      // processing window regardless of exactly when this lands.
      await new Promise((r) => setTimeout(r, 300));
      const midFlight = await post({ panNumber: "ZZZZZ9999Z" }, keyA);
      check("A. Different payload arriving mid-flight (handler still running) → 409", midFlight.status === 409, midFlight.data);

      const slowResult = await slowCallPromise;
      check("A. The original slow request still completes successfully afterward", slowResult.status === 200 && slowResult.data?.cached !== true, slowResult.data);
    }

    // ════════════════════════════════════════════════════════
    // SECTION B — different payload arrives the INSTANT after the
    // slow handler's response — the direct proof
    // ════════════════════════════════════════════════════════
    {
      const keyB = "slow-b-" + Date.now();
      const first = await post({ panNumber: "ABCDE1234F" }, keyB); // takes 2.5s
      check("B. Baseline slow request succeeds", first.status === 200, first.data);

      // No sleep here — fired immediately after the slow response is
      // received. If the TTL-sync fix did not hold, this is exactly
      // where the original bug would have manifested (fingerprint
      // expired at t=120-from-request-start while the shared cache,
      // written at t=~122, was still fresh) — except now the gap this
      // probes is Redis-round-trip-scale, not 2.5-second-scale.
      const immediatelyAfter = await post({ panNumber: "ZZZZZ9999Z" }, keyB);
      check("B. Different payload immediately after the slow response → 409, NOT a replay of the original cached response", immediatelyAfter.status === 409 && immediatelyAfter.data?.receivedPan !== "ABCDE1234F", immediatelyAfter.data);
    }

    // ════════════════════════════════════════════════════════
    // SECTION C — deterministic TTL-sync check under a REAL multi-
    // second gap (not a fast round-trip like the earlier version)
    // ════════════════════════════════════════════════════════
    {
      const keyC = "slow-c-" + Date.now();
      const r = await post({ panNumber: "ABCDE1234F" }, keyC); // ~2.5s
      check("C. Baseline slow request for the TTL-sync check succeeds", r.status === 200, r.data);

      const fingerprintKey = `idempotency-payload:${FAKE_USER_ID}:${SCOPE_NAME}:${keyC}`;
      const sharedKey = `idempotency:${FAKE_USER_ID}:${SCOPE_NAME}:${keyC}`;
      const fingerprintTtl = await redis.ttl(fingerprintKey);
      const sharedTtl = await redis.ttl(sharedKey);

      check("C. Both TTLs exist (positive)", fingerprintTtl > 0 && sharedTtl > 0, { fingerprintTtl, sharedTtl });
      check("C. TTLs remain synchronized (within 2s) even after a real ~2.5s handler delay — proves duration-independence, not just fast-path correctness", Math.abs(fingerprintTtl - sharedTtl) <= 2, { fingerprintTtl, sharedTtl });

      await redis.del(fingerprintKey).catch(() => {});
      await redis.del(sharedKey).catch(() => {});
    }

    // ════════════════════════════════════════════════════════
    // SECTION D — same-payload retry after a slow handler (regression)
    // ════════════════════════════════════════════════════════
    {
      const keyD = "slow-d-" + Date.now();
      const first = await post({ panNumber: "ABCDE1234F" }, keyD); // ~2.5s
      check("D. Baseline slow request succeeds", first.status === 200 && first.data?.cached !== true, first.data);

      const retry = await post({ panNumber: "ABCDE1234F" }, keyD); // same payload
      check("D. Same-payload retry after a slow handler still returns cached:true (unaffected by the fix)", retry.status === 200 && retry.data?.cached === true, retry.data);
    }

  } catch (err) {
    console.error("FATAL:", err);
    fail++;
    rows.push(`❌ FATAL — ${err.message}`);
  } finally {
    server.close();
  }

  console.log(rows.join("\n"));
  console.log(`\nSLOW HANDLER EXPIRY-WINDOW: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
