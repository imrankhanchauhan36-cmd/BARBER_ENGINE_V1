/**
 * BARBER ENGINE V1
 * backend/middlewares/idempotency.middleware.js
 *
 * Phase 7A (Cashfree Secure ID, Part 7) — replaced the original
 * in-process `Map` store with the existing shared Redis singleton
 * (config/redis.js), the same one already used for sessions/OTP/geo
 * cache and by middlewares/redisRateLimit.middleware.js. The in-memory
 * Map never survived a server restart and never coordinated across
 * horizontally-scaled backend instances — at 50-lakh-salon scale this
 * codebase runs on more than one process, so two duplicate requests
 * landing on two different instances would previously have both gone
 * through, defeating the whole point of an idempotency key (most
 * concretely: a retried Cashfree Secure ID call, which is billed per
 * request, being fired twice).
 *
 * External contract is UNCHANGED — same header name
 * ("Idempotency-Key"), same "no header → pass through" behavior, same
 * cached-response envelope shape ({success:true, cached:true, data:
 * <original body>}), same ~2-minute cache window. Every existing route
 * file that imports { idempotency } needs zero changes.
 *
 * ATOMICITY: `SET key "LOCK" NX PX <claimMs>` claims the key in one
 * round-trip (same "atomic claim" idiom already used by
 * redisRateLimit.middleware.js's Lua script, just via a single Redis
 * command here since there's nothing to increment). A concurrent
 * duplicate request arriving while the first is still being processed
 * gets a 409 ("already in progress") instead of silently re-executing
 * the handler — a real improvement over the old Map version, which had
 * no in-flight protection at all (only a "already have a final
 * response" cache).
 *
 * FAIL-OPEN: any Redis error is treated as "not a duplicate" and the
 * request proceeds normally — same philosophy as
 * redisRateLimit.middleware.js and config/redis.js's own "continue
 * without cache" boot-time comment. Idempotency here is a cost/
 * duplicate-prevention layer, not a correctness dependency (every
 * mutation this guards already has its own independent MongoDB-level
 * correctness, e.g. KYC's own status-based editability guards).
 */

import redis from "../config/redis.js";
import logger from "../utils/logger.js";

const CLAIM_TTL_MS  = 30 * 1000;       // generous bound on "still processing"
const CACHE_TTL_SEC = 2 * 60;          // matches the old Map's 2-minute window
const LOCK_MARKER   = "__IDEMPOTENCY_LOCK__";

const buildKey = (userId, key) => `idempotency:${userId}:${key}`;

export const idempotency = async (req, res, next) => {
  const key = req.headers["idempotency-key"];
  const userId = req.user?._id?.toString() || "guest";

  if (!key) return next();

  const finalKey = buildKey(userId, key);

  try {
    const claimed = await redis.set(finalKey, LOCK_MARKER, { NX: true, PX: CLAIM_TTL_MS });

    if (claimed !== "OK") {
      // Key already exists — either a final cached response, or a
      // concurrent request still in flight.
      const existing = await redis.get(finalKey);

      if (existing === null) {
        // Raced past the claim (expired between the failed SET and this
        // GET) — treat as a fresh request rather than erroring out.
        return next();
      }

      if (existing === LOCK_MARKER) {
        return res.status(409).json({
          success: false,
          message: "A request with this Idempotency-Key is already in progress. Please wait.",
        });
      }

      return res.status(200).json({
        success: true,
        cached: true,
        data: JSON.parse(existing),
      });
    }

    // ── Claimed — proceed, then overwrite the lock with the final body ──
    const originalJson = res.json.bind(res);

    res.json = (body) => {
      redis.set(finalKey, JSON.stringify(body), { EX: CACHE_TTL_SEC }).catch((err) => {
        logger.warn("Idempotency: failed to cache final response", { message: err.message });
      });
      return originalJson(body);
    };

    return next();
  } catch (err) {
    // FAIL OPEN — see file header.
    logger.warn("Idempotency: Redis unavailable — proceeding without duplicate protection", {
      message: err.message,
    });
    return next();
  }
};
