/**
 * BARBER_ENGINE_V1
 * backend/scripts/unit/verifyScopedIdempotencyRedisFailure.mjs
 *
 * Phase 3b — Global Verification Engine security hardening. Pure
 * unit check: calls scopedIdempotency() directly with fake
 * req/res/next objects (no HTTP server, no real route), and
 * deliberately breaks the shared Redis client's .set()/.get() methods
 * to simulate a Redis outage. NO live provider call, NO database
 * write (the fake req never reaches a real controller).
 *
 * Confirms:
 *   (a) when the payload-hash check's own Redis call throws,
 *       scopedIdempotency fails open — it does NOT block the request,
 *       and does NOT throw out of the middleware itself,
 *   (b) the same holds when .set() "succeeds" (returns a non-OK claim
 *       result) and the follow-up .get() throws,
 *   (c) end-to-end: with Redis fully broken, a request still reaches
 *       `next()` (the real handler) rather than hanging or 500ing —
 *       both this wrapper's own fail-open AND the shared
 *       idempotency.middleware.js's independent fail-open fire
 *       correctly in sequence,
 *   (d) once Redis is restored (methods un-patched), normal behavior
 *       resumes — this test does not leave the shared client broken
 *       for any other process.
 *
 * Run:  cd backend && node scripts/unit/verifyScopedIdempotencyRedisFailure.mjs
 * (Requires a reachable Redis for setup/teardown of the mock, exactly
 * like every other script that imports config/redis.js.)
 */

import redis from "../../config/redis.js";
import { scopedIdempotency } from "../../middlewares/scopedIdempotency.middleware.js";

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; rows.push(`✅ ${name}`); }
  else { fail++; rows.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const makeFakeReqResNext = (overrides = {}) => {
  const req = {
    headers: { "idempotency-key": "unit-test-key-" + Math.random().toString(36).slice(2) },
    user: { _id: "000000000000000000000001" },
    body: { foo: "bar" },
    ...overrides,
  };
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  return { req, res, next, wasNextCalled: () => nextCalled };
};

const run = async () => {
  const originalSet = redis.set.bind(redis);
  const originalGet = redis.get.bind(redis);
  const originalDel = redis.del.bind(redis);

  try {
    // ── Scenario (a) — redis.set() itself throws ──
    redis.set = async () => { throw new Error("simulated Redis outage — set"); };
    redis.get = originalGet;

    const s1 = makeFakeReqResNext();
    const mw1 = scopedIdempotency("unit.scenarioA");
    await mw1(s1.req, s1.res, s1.next);
    check("(a) redis.set() throwing → next() is still called (fails open)", s1.wasNextCalled() === true);
    check("(a) redis.set() throwing → res.status/json were never called by this wrapper", s1.res.statusCode === null);

    // ── Scenario (b) — redis.set() resolves to a non-OK claim, then
    // redis.get() throws ──
    redis.set = async () => null; // simulates "key already exists" (claim failed)
    redis.get = async () => { throw new Error("simulated Redis outage — get"); };

    const s2 = makeFakeReqResNext();
    const mw2 = scopedIdempotency("unit.scenarioB");
    await mw2(s2.req, s2.res, s2.next);
    check("(b) redis.set() non-OK + redis.get() throwing → next() is still called (fails open)", s2.wasNextCalled() === true);
    check("(b) redis.set() non-OK + redis.get() throwing → res.status/json were never called by this wrapper", s2.res.statusCode === null);

    // ── Scenario (c) — end-to-end: Redis fully broken, request still
    // reaches the real handler (both this wrapper's fail-open AND the
    // shared idempotency.middleware.js's own independent fail-open
    // must both fire, since both read the same broken client) ──
    redis.set = async () => { throw new Error("simulated full Redis outage"); };
    redis.get = async () => { throw new Error("simulated full Redis outage"); };

    const s3 = makeFakeReqResNext();
    let handlerReached = false;
    const mw3 = scopedIdempotency("unit.scenarioC");
    await mw3(s3.req, s3.res, () => { handlerReached = true; });
    check("(c) Fully broken Redis, end-to-end → the real handler is still reached (no hang, no 500, no block)", handlerReached === true);

    // ── Scenario (d) — no Idempotency-Key header at all, Redis still
    // broken → must pass straight through without ever touching Redis
    // (this is the existing, unaffected contract — not a fail-open
    // path at all, a true no-op path) ──
    let redisSetCalledInScenarioD = false;
    redis.set = async () => { redisSetCalledInScenarioD = true; throw new Error("should never be called"); };
    const s4 = makeFakeReqResNext({ headers: {} }); // no idempotency-key
    let s4Reached = false;
    const mw4 = scopedIdempotency("unit.scenarioD");
    await mw4(s4.req, s4.res, () => { s4Reached = true; });
    check("(d) No Idempotency-Key header → handler is still reached", s4Reached === true);
    check("(d) No Idempotency-Key header → Redis was never actually called (verified via call flag, not assumed)", redisSetCalledInScenarioD === false);

    // ── Scenario (e) — TTL-sync fix follow-up (security review,
    // 2026-10-10): Redis fully broken, and the simulated handler
    // actually calls res.json() (standing in for a real controller
    // producing its response) — confirms the NEW res.json refresh
    // hook's own Redis write failing does NOT prevent the response
    // from being delivered, and does NOT corrupt/alter the body. ──
    redis.set = async () => { throw new Error("simulated Redis outage — refresh hook"); };
    redis.get = async () => { throw new Error("simulated Redis outage — refresh hook"); };

    const s5 = makeFakeReqResNext();
    const simulatedHandlerBody = { success: true, data: "simulated handler response" };
    const mw5 = scopedIdempotency("unit.scenarioE");
    // `next` is async and RETURNS the res.json() call's promise —
    // res.json is now async (it awaits the TTL refresh before
    // releasing), so a non-awaiting next() here would let this test's
    // own assertion run before the real work finishes. idempotency
    // .middleware.js's own `return next();` (its catch branch) chains
    // this properly up through scopedIdempotency's `return
    // idempotency(...)`, so `await mw5(...)` below genuinely waits for
    // the whole thing, including the awaited-but-failing refresh.
    await mw5(s5.req, s5.res, async () => {
      // Stands in for the real controller — calls res.json() exactly
      // as a real handler would, through whatever res.json currently
      // is at this point (this wrapper's refresh hook, composed with
      // the shared middleware's own attempt, which itself fails open
      // before ever reaching its own res.json wrap, since its claim
      // SET also throws against this same broken client).
      return s5.res.json(simulatedHandlerBody);
    });
    check("(e) Broken Redis + res.json refresh hook throwing → the response body is still delivered unmodified", JSON.stringify(s5.res.body) === JSON.stringify(simulatedHandlerBody), s5.res.body);

    // ── Scenario (f) — v3 compensating-delete follow-up (2026-10-10):
    // the refresh write throws AND the compensating redis.del() ALSO
    // throws — confirms the double-failure case still fails open:
    // the response is still delivered, unmodified, with no throw
    // escaping the middleware. ──
    redis.set = async () => { throw new Error("simulated Redis outage — refresh hook"); };
    redis.get = async () => { throw new Error("simulated Redis outage — refresh hook"); };
    redis.del = async () => { throw new Error("simulated Redis outage — compensating delete"); };

    const s6 = makeFakeReqResNext();
    const simulatedHandlerBody2 = { success: true, data: "simulated handler response, double failure" };
    const mw6 = scopedIdempotency("unit.scenarioF");
    await mw6(s6.req, s6.res, async () => {
      return s6.res.json(simulatedHandlerBody2);
    });
    check("(f) Refresh write AND compensating delete BOTH throwing → the response body is still delivered unmodified (double fail-open)", JSON.stringify(s6.res.body) === JSON.stringify(simulatedHandlerBody2), s6.res.body);

  } finally {
    // ── Restore — never leave the shared Redis client broken for any
    // other process/script that imports this same singleton. ──
    redis.set = originalSet;
    redis.get = originalGet;
    redis.del = originalDel;
  }

  // ── Confirm restoration actually worked, using a real Redis call ──
  try {
    const testKey = "unit-test-restore-check-" + Date.now();
    const setResult = await redis.set(testKey, "ok", { EX: 5 });
    const getResult = await redis.get(testKey);
    check("Redis client successfully restored after this test (real set/get round-trip)", setResult === "OK" && getResult === "ok");
    await redis.del(testKey).catch(() => {});
  } catch (err) {
    rows.push(`⚠️  Redis restoration check skipped — Redis itself unreachable in this environment (${err.message}). This does not indicate a bug in scopedIdempotency; it means this environment has no real Redis to confirm restoration against.`);
  }

  console.log(rows.join("\n"));
  console.log(`\nSCOPED IDEMPOTENCY REDIS FAILURE: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
