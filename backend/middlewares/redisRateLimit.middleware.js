/**
 * BARBER ENGINE V1
 * backend/middlewares/redisRateLimit.middleware.js
 *
 * FA-15 Phase C1 — Redis-backed, identity-keyed, multi-instance-safe
 * rate limiting for authenticated mutation routes.
 *
 * Deliberately separate from middlewares/rateLimit.middleware.js (the
 * existing express-rate-limit-based limiters) — those use an
 * in-process MemoryStore, which does not coordinate across
 * horizontally-scaled backend instances. This file reuses the SAME
 * shared Redis singleton (config/redis.js) already used everywhere
 * else in this codebase (sessions, OTP, geo/slot cache) — no second
 * Redis client, no new npm dependency.
 *
 * ATOMICITY: a single Lua script executed via the existing node-redis
 * v5 client's `eval(script, {keys, arguments})` (verified directly
 * against the installed client before writing this file — signature
 * confirmed, not guessed) performs INCR + conditional EXPIRE + TTL
 * read in one atomic round-trip. This closes the theoretical
 * crash-window gap in a naive "INCR then separately EXPIRE" sequence
 * (the pattern already used, and accepted, by utils/otp.helpers.js's
 * OTP attempt counter) — a newly-created rate-limit key can never be
 * left without a bounded TTL, because the EXPIRE happens inside the
 * same atomic script as the INCR that created the key.
 *
 * IDENTITY: always req.user._id (set by `protect` from a verified JWT
 * + live DB read, upstream of this middleware in every approved
 * route). Never a client-supplied field. If req.user._id is somehow
 * missing here, that indicates `protect` was not applied before this
 * middleware — a real ordering bug, not a Redis-availability
 * condition — so that case is rejected (401), not failed open.
 *
 * FAIL-OPEN: any Redis error (including "not connected") during the
 * atomic increment allows the request through. Justification (see the
 * FA-15 Phase-C audit, §4/§14): every route this middleware is applied
 * to already has its own independent, unmodified MongoDB-level
 * correctness guarantee (unique indexes, state machines, the FA-14
 * one-open-payout constraint) — this limiter is an abuse/cost
 * containment layer only, never a correctness or financial dependency.
 * Failing open here can never corrupt business state; it can only
 * temporarily leave an abuse ceiling unenforced, exactly mirroring
 * this codebase's own established "continue without cache" philosophy
 * (config/redis.js's own boot-time comment).
 *
 * This file does not modify req.user, the request body, or the
 * response shape of any successful request — it only ever calls
 * next() (success or pass-through-on-Redis-failure) or
 * next(Errors.tooMany(...)) (limit exceeded) or
 * next(Errors.unauthorized(...)) (missing identity — ordering bug).
 */

import redis from "../config/redis.js";
import { Errors } from "../utils/response.js";
import logger from "../utils/logger.js";

// ─────────────────────────────────────────────────────────────────
// Centralized action names — server-defined only, never derived from
// any request field. Every createRedisRateLimiter() call below in
// this file's route-facing consumers must use one of these constants,
// never a raw string, so a typo can never silently create a second,
// unintended bucket namespace for the same logical action.
// ─────────────────────────────────────────────────────────────────
export const RATE_LIMIT_ACTIONS = Object.freeze({
  FIELD_AGENT_REFERRAL_CREATE: "field_agent_referral_create",
  OWNER_REFERRAL_REDEEM:       "owner_referral_redeem",
  FIELD_AGENT_SUPPORT_CREATE:  "field_agent_support_create",
  FIELD_AGENT_SUPPORT_MESSAGE: "field_agent_support_message",
  FIELD_AGENT_PAYOUT_WITHDRAW: "field_agent_payout_withdraw",
});

// ─────────────────────────────────────────────────────────────────
// Centralized C1 limit configuration — approved values from the
// FA-15 Phase-C audit. Kept here, not scattered across route files,
// so limits can be tuned without touching any route/controller.
// ─────────────────────────────────────────────────────────────────
export const RATE_LIMIT_CONFIG = Object.freeze({
  [RATE_LIMIT_ACTIONS.FIELD_AGENT_REFERRAL_CREATE]: { max: 20, windowSeconds: 60 * 60 },
  [RATE_LIMIT_ACTIONS.OWNER_REFERRAL_REDEEM]:       { max: 10, windowSeconds: 60 * 60 },
  [RATE_LIMIT_ACTIONS.FIELD_AGENT_SUPPORT_CREATE]:  { max: 10, windowSeconds: 60 * 60 },
  [RATE_LIMIT_ACTIONS.FIELD_AGENT_SUPPORT_MESSAGE]: { max: 30, windowSeconds: 60 * 60 },
  [RATE_LIMIT_ACTIONS.FIELD_AGENT_PAYOUT_WITHDRAW]: { max: 10, windowSeconds: 60 * 60 },
});

// Atomic: INCR the counter; on the very first increment of a window
// (result === 1) set its TTL in the SAME script, then read the TTL
// back — one round-trip, no window where the key exists without a
// bound. Verified directly against the installed node-redis v5
// client's real eval(script, {keys, arguments}) signature before
// writing this file (not assumed from documentation).
const INCR_WITH_TTL_SCRIPT = `
local n = redis.call("INCR", KEYS[1])
if n == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local t = redis.call("TTL", KEYS[1])
return {n, t}
`;

const buildKey = (action, userId) => `ratelimit:${action}:${userId}`;

/**
 * createRedisRateLimiter({ action, max, windowSeconds })
 *
 * `action` must be one of RATE_LIMIT_ACTIONS. `max`/`windowSeconds`
 * are normally taken from RATE_LIMIT_CONFIG[action] by the route file
 * (see the five route-file call sites) rather than repeated inline.
 */
export const createRedisRateLimiter = ({ action, max, windowSeconds }) => {
  if (!action || typeof max !== "number" || typeof windowSeconds !== "number") {
    throw new Error("createRedisRateLimiter requires { action, max, windowSeconds }");
  }

  return async (req, res, next) => {
    const userId = req.user?._id;
    if (!userId) {
      // Real ordering bug (this middleware must always run after
      // `protect`) — not a Redis-availability condition. Fail closed.
      return next(Errors.unauthorized("Authentication required"));
    }

    const key = buildKey(action, userId.toString());

    try {
      const [count, ttl] = await redis.eval(INCR_WITH_TTL_SCRIPT, {
        keys: [key],
        arguments: [String(windowSeconds)],
      });

      if (count > max) {
        const retryAfterSeconds = ttl > 0 ? ttl : windowSeconds;
        res.set("Retry-After", String(retryAfterSeconds));
        return next(Errors.tooMany("Too many requests. Please try again later."));
      }

      return next();
    } catch (err) {
      // FAIL OPEN — see file header. Never expose the Redis error,
      // the key, or the action name to the client; log only what's
      // needed to notice degraded Redis health (action + the
      // authenticated user's own id — not a token, not a phone
      // number, not request body/bank data).
      logger.warn("Redis rate limiter unavailable — failing open", {
        action,
        userId: userId.toString(),
      });
      return next();
    }
  };
};
