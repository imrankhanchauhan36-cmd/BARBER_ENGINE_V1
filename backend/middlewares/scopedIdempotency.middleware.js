/**
 * BARBER ENGINE V1
 * backend/middlewares/scopedIdempotency.middleware.js
 * Phase 3b — Global Verification Engine security hardening (approved 2026-10-10)
 *
 * WHY THIS FILE EXISTS, INSTEAD OF JUST REUSING idempotency.middleware.js DIRECTLY:
 *
 * The existing idempotency middleware's Redis key is
 * `idempotency:<userId>:<Idempotency-Key header value>` — it does NOT
 * incorporate the route, HTTP method, or request body. Two real risks
 * follow directly from that, both confirmed by reading the file (see
 * its own buildKey()):
 *
 *   1. CROSS-ROUTE COLLISION — if the same client reuses the same
 *      literal Idempotency-Key header value on two different KYC
 *      routes (e.g. accidentally sending the same key to both
 *      /identity and /bank), the second call would silently receive
 *      the FIRST route's cached response.
 *   2. SAME-ROUTE, DIFFERENT-PAYLOAD — if the same key is reused on
 *      the same route with a genuinely different request body, the
 *      existing middleware has no way to detect that and would
 *      silently return the stale first response, never processing the
 *      new payload.
 *
 * Both are unacceptable for the routes this phase protects. The fix
 * below is deliberately ADDITIVE — it does not change one line of
 * idempotency.middleware.js, and nothing calls this new wrapper from
 * fieldAgentKyc.routes.js, so Field Agent's existing behavior (which
 * calls the shared `idempotency` export directly, unwrapped) is
 * provably unaffected — confirmed by this file never being imported
 * there.
 *
 * HOW IT WORKS:
 *
 *   (a) ROUTE/METHOD SCOPING — each call site passes its own fixed
 *       `scopeName` string (e.g. "ownerKyc.identity"), unique to that
 *       one route+method pairing. Before delegating, this wrapper
 *       rewrites the in-memory `req.headers["idempotency-key"]` to
 *       `${scopeName}:${originalValue}`, so the shared middleware's
 *       own key becomes `idempotency:<userId>:<scopeName>:<original>`
 *       — structurally incapable of colliding with a different route's
 *       scope, even if a client reuses the same literal header value
 *       everywhere. This mutates only the current request's in-memory
 *       header object, nothing persisted, nothing shared-middleware-side.
 *
 *   (b) PAYLOAD-MISMATCH DETECTION — a SEPARATE Redis key (a
 *       different key namespace, `idempotency-payload:*`, never
 *       touching the shared middleware's own `idempotency:*` keys)
 *       stores a SHA-256 hash of the first request body seen for a
 *       given {user, scope, key}. A later request with the SAME key
 *       but a DIFFERENT body hash is rejected with 409 *before* the
 *       shared middleware is ever consulted — it never returns a
 *       stale cached response for a changed payload. A later request
 *       with the SAME body hash falls through normally to (a).
 *
 *   TTL SYNCHRONIZATION FIX (added after security review, 2026-10-10):
 *   the fingerprint marker's TTL used to be set ONCE, at request
 *   arrival (`EX: PAYLOAD_HASH_TTL_SEC` starting at t=0). The shared
 *   middleware's own cached-response TTL (idempotency.middleware.js:91)
 *   is set LATER — only once the handler actually finishes and
 *   res.json() is called (t = handler processing time, always >= 0).
 *   Since both used the SAME duration but DIFFERENT start times, the
 *   fingerprint marker always expired strictly BEFORE the shared
 *   cache — for exactly the handler's processing duration. A request
 *   with a genuinely DIFFERENT payload arriving inside that gap (after
 *   the fingerprint expired, but before the shared cache did) would
 *   skip the mismatch check entirely (treated as fresh) and then
 *   silently receive the ORIGINAL payload's stale cached response from
 *   the shared middleware — exactly the outcome this file exists to
 *   prevent, reappearing through a timing gap instead of a true race.
 *
 *   FIX: this wrapper also wraps res.json (same technique the shared
 *   middleware already uses on itself), installed BEFORE delegating to
 *   the shared middleware so the two wraps compose (shared middleware's
 *   own wrap ends up calling this one). Every time a response is
 *   actually sent — whether freshly computed or replayed from the
 *   shared cache — this refreshes the fingerprint marker's TTL to start
 *   counting from THAT moment, the same moment the shared middleware
 *   (re)writes its own cache entry.
 *
 *   v2 (2026-10-10, second review round) — the refresh write is now
 *   AWAITED before releasing the response (originalJson is only called
 *   after the refresh settles, success or failure), not fire-and-forget.
 *   Rationale, traced precisely rather than assumed: config/redis.js
 *   creates exactly ONE client (`createClient(...)`, no pool/cluster),
 *   and node-redis sends commands over that single connection in the
 *   order they were called — the shared middleware's own write
 *   (idempotency.middleware.js:91) is issued earlier in the composed
 *   call chain than this one, so it is necessarily applied by the
 *   Redis server no later than this one regardless of awaiting.
 *   Awaiting THIS write adds the one guarantee that was still missing:
 *   by the time the HTTP response is released to the client, the
 *   fingerprint refresh is CONFIRMED durable — removing reliance on
 *   "Redis is fast enough" as an assumption for this specific write.
 *   This still depends on node-redis's documented single-connection,
 *   in-order command processing holding true for this client's actual
 *   configuration (verified directly above, not assumed) — it is not a
 *   guarantee that is independently provable from this file alone, and
 *   is not claimed to be a zero-risk, implementation-independent proof.
 *   A fully implementation-independent guarantee would require a
 *   single atomic multi-key transaction (e.g. a Lua script) spanning
 *   both this file's key and idempotency.middleware.js's key, which is
 *   not possible without modifying that file — explicitly out of scope.
 *
 *   FAIL OPEN, including for the now-awaited refresh: a Redis error on
 *   ANY of the three Redis calls in this file (claim, get, refresh) is
 *   caught and logged; the response is still released immediately
 *   after — an infrastructure failure can delay the response by at
 *   most one Redis round-trip attempt, and can never block, suppress,
 *   or hang it. No Idempotency-Key header at all → immediate,
 *   unaffected pass-through, identical to the shared middleware's own
 *   contract (no wrap is installed in that case at all).
 *
 *   v3 (2026-10-10, boundary test follow-up) — COMPENSATING DELETE ON
 *   REFRESH FAILURE. The decisive boundary test
 *   (scripts/e2e/verifyFingerprintExpiryBoundary.mjs) proved that even
 *   with v2's awaited refresh, if the refresh write specifically fails
 *   while the shared middleware's own, earlier-issued cache write
 *   (idempotency.middleware.js:91) succeeds, the two markers fall out
 *   of sync and the original stale-response bug reopens — v2's
 *   ordering guarantee only holds when BOTH writes succeed, not when
 *   one specifically fails.
 *
 *   FIX: when the refresh write's catch block fires, this file now
 *   also attempts to DELETE the shared middleware's own cache key for
 *   this same {user, scope, key} — computed locally from the EXACT
 *   format verified directly from idempotency.middleware.js:49
 *   (`buildKey = (userId, key) => \`idempotency:${userId}:${key}\``,
 *   where `key` is the already-scoped header value) — never by calling
 *   into or modifying that file. This is a SEPARATE try/catch; a
 *   failure here is logged and swallowed exactly like every other
 *   Redis failure in this file — it can never throw through the
 *   response path or prevent originalJson(body) from being called.
 *
 *   CONCURRENCY SAFETY (considered explicitly, not assumed): by the
 *   time this delete can run, THIS request already won the shared
 *   middleware's own NX claim on finalKey (that is how its handler got
 *   to run at all) — the NX semantics mean no other request could have
 *   been "the one processing" for this exact key concurrently, so this
 *   delete can only ever remove a value THIS SAME request itself just
 *   wrote moments earlier, never a value written by a genuinely
 *   unrelated, freshly-claimed request — UNDER ORDINARY TIMING. The
 *   realistic side effect is narrow and already-accepted by this
 *   codebase's own design: a SAME-payload retry landing in the brief
 *   window after this delete loses its cache hit and is reprocessed by
 *   the real handler instead of served from cache — not dangerous,
 *   since every handler this wrapper protects (identity/bank
 *   submission, KYC submit, admin verify-pan/aadhaar/bank) is safe to
 *   reprocess on its own merits.
 *
 *   v4 (2026-10-10, concurrency review follow-up) — ATOMIC
 *   COMPARE-AND-DELETE. The prior v3 design used a blind, unconditional
 *   `redis.del(sharedCacheKey)`. A further concurrency review
 *   identified one remaining, narrow exception: if that delete command
 *   were itself abnormally, pathologically delayed (not ordinary
 *   jitter — a stall on the order of the remaining ~118s TTL window),
 *   the original entry could have already naturally expired and a
 *   completely unrelated LATER request could have legitimately written
 *   a fresh generation of the same key before the stale delete finally
 *   landed — a blind DEL would destroy that unrelated, legitimate
 *   entry, since DEL has no way to check what it is removing.
 *
 *   FIX: replaced the blind DEL with a Lua EVAL compare-and-delete —
 *   `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call
 *   ('del', KEYS[1]) else return 0 end` — which deletes the key ONLY
 *   if its current value still equals the exact value THIS request
 *   itself expects to find there. The expected value is computed as
 *   `JSON.stringify(body)` inside this same res.json wrapper — verified
 *   directly (not assumed) to be byte-identical to what
 *   idempotency.middleware.js:91 itself writes, because `body` is the
 *   SAME object reference flowing through both wrappers in the same
 *   composed, synchronous call chain, unmutated in between — re-
 *   serializing it independently here reproduces the identical string.
 *   If the stored value has since changed for ANY reason (a legitimate
 *   newer write, or anything else), the comparison fails, the script
 *   returns 0, and NOTHING is deleted — the narrow exception above is
 *   closed. The Redis client in this codebase (the `redis` npm package,
 *   v5.12.1 per package.json) exposes `redis.eval(script, { keys,
 *   arguments })`; this call shape was verified directly against the
 *   real, connected client before being used here, not assumed from
 *   documentation or a different major version's API.
 *
 *   This still never throws through the response path (same try/catch
 *   discipline as v3) and it can NEVER cause a DIFFERENT payload to
 *   receive another payload's data, which remains the one outcome this
 *   file exists to prevent.
 */

import crypto from "crypto";
import redis from "../config/redis.js";
import logger from "../utils/logger.js";
import { idempotency } from "./idempotency.middleware.js";

// Matches idempotency.middleware.js's own CACHE_TTL_SEC — the
// payload-hash marker's lifetime is intentionally the same as the
// final cached response it protects.
const PAYLOAD_HASH_TTL_SEC = 2 * 60;

const hashPayload = (body) =>
  crypto.createHash("sha256").update(JSON.stringify(body ?? {})).digest("hex");

// v4 — atomic compare-and-delete. Deletes KEYS[1] only if its current
// value still equals ARGV[1] exactly. Verified directly against the
// real, connected client (redis v5.12.1) before use — see file header.
const COMPARE_AND_DELETE_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/**
 * @param {string} scopeName - a fixed, unique string per route+method
 *   call site (e.g. "ownerKyc.identity"). Never derived dynamically
 *   from req.path — a literal, auditable constant at each call site.
 * @returns {import("express").RequestHandler}
 */
export const scopedIdempotency = (scopeName) => async (req, res, next) => {
  const originalKey = req.headers["idempotency-key"];

  // No header at all — identical, unaffected pass-through to the
  // shared middleware's own contract.
  if (!originalKey) return idempotency(req, res, next);

  const userId = req.user?._id?.toString() || "guest";
  const payloadHashKey = `idempotency-payload:${userId}:${scopeName}:${originalKey}`;
  const currentHash = hashPayload(req.body);

  try {
    const claimed = await redis.set(payloadHashKey, currentHash, { NX: true, EX: PAYLOAD_HASH_TTL_SEC });

    if (claimed !== "OK") {
      const storedHash = await redis.get(payloadHashKey);

      // storedHash === null means the marker expired between the
      // failed claim and this read (same narrow, accepted race the
      // shared middleware's own header already documents) — treat as
      // a fresh request rather than erroring out.
      if (storedHash !== null && storedHash !== currentHash) {
        return res.status(409).json({
          success: false,
          message: "This Idempotency-Key was already used with a different request. Use a new Idempotency-Key for a different request.",
        });
      }
    }
  } catch (err) {
    // FAIL OPEN — see file header. Proceeds without payload-mismatch
    // protection; the shared middleware below still applies its own
    // independent fail-open if Redis is the actual cause.
    logger.warn("scopedIdempotency: Redis unavailable — proceeding without payload-mismatch protection", {
      message: err.message,
      scopeName,
    });
  }

  // ─── TTL SYNCHRONIZATION FIX — see file header, v2 ───────────────
  // Installed BEFORE calling idempotency() below so the shared
  // middleware's own res.json wrap (idempotency.middleware.js:88-95)
  // composes on top of this one: when the real handler eventually
  // calls res.json(), the shared middleware's wrap fires first
  // (caches/refreshes its own finalKey), then calls this function,
  // which now AWAITS the fingerprint refresh before releasing the
  // response. try/catch preserves fail-open exactly: on a Redis
  // error, the refresh is abandoned (logged) and the response is
  // released immediately after — this can delay the response by at
  // most one Redis round-trip attempt, never block or hang it, and
  // never alter the response body (verified by test — see
  // scripts/unit/verifyScopedIdempotencyRedisFailure.mjs scenario (e)).
  // Route/method scoping (see file header, part (a)) — rewritten here,
  // BEFORE the res.json wrap below, so the scoped value is available
  // to compute the exact shared-cache key the compensating delete
  // needs (same construction idempotency.middleware.js:49 uses).
  const scopedKey = `${scopeName}:${originalKey}`;
  const sharedCacheKey = `idempotency:${userId}:${scopedKey}`;

  const originalJson = res.json.bind(res);
  res.json = async (body) => {
    try {
      await redis.set(payloadHashKey, currentHash, { EX: PAYLOAD_HASH_TTL_SEC });
    } catch (err) {
      logger.warn("scopedIdempotency: failed to refresh fingerprint TTL", {
        message: err.message,
        scopeName,
      });

      // ─── v4 ATOMIC COMPARE-AND-DELETE — see file header ─────────
      // Separate try/catch — a failure here is logged and swallowed
      // exactly like the refresh failure above; it can never throw
      // through the response path or prevent originalJson(body) from
      // being called below. Deletes sharedCacheKey ONLY if its
      // current value still equals the exact response this request
      // itself produced — never a newer, unrelated generation.
      try {
        const expectedCachedValue = JSON.stringify(body);
        const deleted = await redis.eval(COMPARE_AND_DELETE_SCRIPT, {
          keys: [sharedCacheKey],
          arguments: [expectedCachedValue],
        });
        if (deleted !== 1) {
          logger.info("scopedIdempotency: shared cache entry had already changed — compare-and-delete skipped it safely", {
            scopeName,
          });
        }
      } catch (delErr) {
        logger.warn("scopedIdempotency: failed to invalidate shared cache entry after a failed fingerprint refresh", {
          message: delErr.message,
          scopeName,
        });
      }
    }
    return originalJson(body);
  };

  req.headers["idempotency-key"] = scopedKey;

  return idempotency(req, res, next);
};
