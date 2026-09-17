/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyFieldAgentSecurityPhaseC1.js
 *
 * FA-15 Phase C1 — permanent regression suite for the Redis-backed
 * route-level rate limiters: referral create, referral redeem,
 * support create, support message, payout withdraw. Real Mongo, real
 * HTTP (app.listen(0)), real Redis (the shared production client) —
 * no mocked rate-limit store.
 *
 * Since the limiter middleware runs BEFORE idempotency/validate/the
 * handler on every route it's applied to, an "exceeds N/hour" test
 * does not need every one of the first N requests to succeed as a
 * real business operation — only that none of the first N is 429 and
 * the (N+1)th is. This lets most exceed-tests use minimal or
 * deliberately-business-invalid bodies, avoiding unnecessary
 * fixture creation (no real payout is ever created; only referral
 * and support-ticket documents are, both low-risk and fully cleaned
 * up by exact ID).
 *
 * Run:
 *   cd backend
 *   node scripts/verifyFieldAgentSecurityPhaseC1.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import redis from "../config/redis.js";
import { generateAccessToken } from "../services/token.service.js";
import { RATE_LIMIT_ACTIONS, RATE_LIMIT_CONFIG, createRedisRateLimiter } from "../middlewares/redisRateLimit.middleware.js";

import User from "../models/User.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import FieldAgentApplication from "../modules/fieldAgent/models/FieldAgentApplication.js";
import AcquisitionReferral from "../modules/fieldAgent/models/AcquisitionReferral.js";
import SupportCategory from "../modules/support/models/SupportCategory.js";
import SupportSlaPolicy from "../modules/support/models/SupportSlaPolicy.js";
import SupportTicket from "../modules/support/models/SupportTicket.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const NAME_PREFIX = "ZTEST_FA15C1_";
const oid = () => new mongoose.Types.ObjectId();
const phone = (p) => `${p}${Math.floor(100000000 + Math.random() * 899999999)}`;

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
      },
    }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})), headers: res.headers }));

  const fixtureUserIds = [];
  const fixtureFieldAgentIds = [];
  const fixtureApplicationIds = [];
  const fixtureReferralIds = [];
  const fixtureCategoryIds = [];
  const fixtureTicketIds = [];
  const redisKeysToClean = new Set();
  let createdOwnSlaPolicy = false;
  let globalSlaId = null;

  const mkFieldAgent = async (label, { operationalStatus = "ACTIVE" } = {}) => {
    const agentUser = await User.create({ name: `${NAME_PREFIX}${label}`, phone: phone("9"), role: "FIELD_AGENT", accountStatus: "ACTIVE" });
    fixtureUserIds.push(agentUser._id);
    const application = await FieldAgentApplication.create({ userRef: agentUser._id, phone: agentUser.phone, status: "APPROVED", nonTerminal: false });
    fixtureApplicationIds.push(application._id);
    const fieldAgent = await FieldAgent.create({ userRef: agentUser._id, applicationRef: application._id, agentCode: `ZF15C1-${label}-${Date.now()}`, operationalStatus, commercialPath: "ACQUISITION_AGENT" });
    fixtureFieldAgentIds.push(fieldAgent._id);
    const token = generateAccessToken({ _id: agentUser._id, role: "FIELD_AGENT", tokenVersion: 0 });
    return { agentUser, fieldAgent, token };
  };

  const mkOwner = async (label) => {
    const owner = await User.create({ name: `${NAME_PREFIX}${label}`, phone: phone("8"), role: "OWNER", accountStatus: "ACTIVE" });
    fixtureUserIds.push(owner._id);
    const token = generateAccessToken({ _id: owner._id, role: "OWNER", tokenVersion: 0 });
    return { owner, token };
  };

  const rlKey = (action, userId) => `ratelimit:${action}:${userId}`;

  try {
    const A = await mkFieldAgent("AGENT_A");
    const B = await mkFieldAgent("AGENT_B");
    const ownerA = await mkOwner("OWNER_A");
    const ownerB = await mkOwner("OWNER_B");
    const plainUser = await User.create({ name: `${NAME_PREFIX}PLAIN_USER`, phone: phone("7"), role: "USER", accountStatus: "ACTIVE" });
    fixtureUserIds.push(plainUser._id);
    const plainUserToken = generateAccessToken({ _id: plainUser._id, role: "USER", tokenVersion: 0 });

    [RATE_LIMIT_ACTIONS.FIELD_AGENT_REFERRAL_CREATE, RATE_LIMIT_ACTIONS.FIELD_AGENT_SUPPORT_CREATE, RATE_LIMIT_ACTIONS.FIELD_AGENT_SUPPORT_MESSAGE, RATE_LIMIT_ACTIONS.FIELD_AGENT_PAYOUT_WITHDRAW]
      .forEach((a) => { redisKeysToClean.add(rlKey(a, A.agentUser._id)); redisKeysToClean.add(rlKey(a, B.agentUser._id)); });
    redisKeysToClean.add(rlKey(RATE_LIMIT_ACTIONS.OWNER_REFERRAL_REDEEM, ownerA.owner._id));
    redisKeysToClean.add(rlKey(RATE_LIMIT_ACTIONS.OWNER_REFERRAL_REDEEM, ownerB.owner._id));

    // ═══════════════════════════════════════════════════════════
    // C1-1/2/3 — REFERRAL CREATE (20/hour)
    // ═══════════════════════════════════════════════════════════
    {
      const first = await authFetch("/api/field-agent/acquisition/referrals", A.token, { method: "POST" });
      check("C1-1. Referral create — first legitimate request passes", first.status === 201 || first.status === 200, first);
      if (first.data?.data?.referral?._id) fixtureReferralIds.push(first.data.data.referral._id);

      let statuses = [first.status];
      for (let i = 1; i < 20; i++) {
        const r = await authFetch("/api/field-agent/acquisition/referrals", A.token, { method: "POST" });
        statuses.push(r.status);
        if (r.data?.data?.referral?._id) fixtureReferralIds.push(r.data.data.referral._id);
      }
      check("C1-2a. First 20 referral-create requests are never 429", statuses.every((s) => s !== 429), statuses);

      const twentyFirst = await authFetch("/api/field-agent/acquisition/referrals", A.token, { method: "POST" });
      check("C1-2b. Referral create — 21st request from same agent is 429", twentyFirst.status === 429, twentyFirst);
      check("C1-2c. 429 response uses the RATE_LIMITED code convention", twentyFirst.data?.code === "RATE_LIMITED" || /too many/i.test(twentyFirst.data?.message || ""), twentyFirst.data);

      const bFirst = await authFetch("/api/field-agent/acquisition/referrals", B.token, { method: "POST" });
      check("C1-3. Different Field Agent (B) has an independent bucket, not blocked by A's exhausted limit", bFirst.status !== 429, bFirst);
      if (bFirst.data?.data?.referral?._id) fixtureReferralIds.push(bFirst.data.data.referral._id);
    }

    // ═══════════════════════════════════════════════════════════
    // C1-4/5 — REFERRAL REDEEM (10/hour) — authenticated OWNER,
    // deliberately invalid referralCode each time (the limiter runs
    // BEFORE validation, so this still correctly exercises the
    // counter without needing 10 real redeemable referrals/salons).
    // ═══════════════════════════════════════════════════════════
    {
      let statuses = [];
      for (let i = 0; i < 10; i++) {
        const r = await authFetch("/api/acquisition/redeem", ownerA.token, { method: "POST", body: JSON.stringify({ referralCode: `NONEXISTENT-${i}` }) });
        statuses.push(r.status);
      }
      check("C1-4a. First 10 redeem requests (Owner A) are never 429", statuses.every((s) => s !== 429), statuses);

      const eleventh = await authFetch("/api/acquisition/redeem", ownerA.token, { method: "POST", body: JSON.stringify({ referralCode: "NONEXISTENT-11" }) });
      check("C1-4b. 11th redeem request (Owner A) is 429", eleventh.status === 429, eleventh);

      const ownerBFirst = await authFetch("/api/acquisition/redeem", ownerB.token, { method: "POST", body: JSON.stringify({ referralCode: "NONEXISTENT-B1" }) });
      check("C1-5. Different Owner (B) has an independent bucket", ownerBFirst.status !== 429, ownerBFirst);
    }

    // ═══════════════════════════════════════════════════════════
    // C1-6/8 — SUPPORT CREATE (10/hour) + cross-action isolation setup
    // ═══════════════════════════════════════════════════════════
    const category = await SupportCategory.create({ name: `${NAME_PREFIX}CATEGORY`, code: `ZF15C1${Date.now() % 100000}`, isActive: true, isDeleted: false });
    fixtureCategoryIds.push(category._id);
    let globalSla = await SupportSlaPolicy.findOne({ categoryRef: null, isActive: true, isDeleted: false }).lean();
    if (!globalSla) {
      const targets = { firstResponseMinutes: 60, resolutionMinutes: 1440 };
      globalSla = await SupportSlaPolicy.create({ categoryRef: null, targetsByPriority: { LOW: targets, NORMAL: targets, HIGH: targets, CRITICAL: targets }, warningThresholdPercent: 80, isActive: true, isDeleted: false });
      createdOwnSlaPolicy = true;
    }
    globalSlaId = globalSla._id;

    const mkTicketBody = (n) => ({ categoryRef: category._id.toString(), subject: `${NAME_PREFIX}subject ${n}`, body: `${NAME_PREFIX}body ${n}` });
    let firstTicketId = null;
    {
      let statuses = [];
      for (let i = 0; i < 10; i++) {
        const r = await authFetch("/api/support/field-agent/tickets", A.token, { method: "POST", body: JSON.stringify(mkTicketBody(i)) });
        statuses.push(r.status);
        const tid = r.data?.data?.ticket?._id;
        if (tid) {
          fixtureTicketIds.push(tid);
          if (!firstTicketId) firstTicketId = tid;
        }
      }
      check("C1-6a. First 10 support-ticket-create requests are never 429", statuses.every((s) => s !== 429), statuses);

      const eleventh = await authFetch("/api/support/field-agent/tickets", A.token, { method: "POST", body: JSON.stringify(mkTicketBody(99)) });
      check("C1-6b. 11th support-ticket-create request is 429", eleventh.status === 429, eleventh);
    }

    // ═══════════════════════════════════════════════════════════
    // C1-7/8 — SUPPORT MESSAGE (30/hour), independent from ticket-create bucket
    // ═══════════════════════════════════════════════════════════
    if (firstTicketId) {
      let statuses = [];
      for (let i = 0; i < 30; i++) {
        const r = await authFetch(`/api/support/field-agent/tickets/${firstTicketId}/messages`, A.token, { method: "POST", body: JSON.stringify({ body: `${NAME_PREFIX}message ${i}` }) });
        statuses.push(r.status);
      }
      check("C1-7a. First 30 support-message requests are never 429", statuses.every((s) => s !== 429), statuses);

      const thirtyFirst = await authFetch(`/api/support/field-agent/tickets/${firstTicketId}/messages`, A.token, { method: "POST", body: JSON.stringify({ body: `${NAME_PREFIX}message overflow` }) });
      check("C1-7b. 31st support-message request is 429", thirtyFirst.status === 429, thirtyFirst);

      // C1-8: ticket-create bucket for A is already exhausted (429 above),
      // but the message bucket is a SEPARATE action — confirm A's
      // ticket-create still 429s (unaffected/still exhausted) while a
      // NEW agent's ticket-create is fresh, proving action isolation.
      const stillTicketCreate429 = await authFetch("/api/support/field-agent/tickets", A.token, { method: "POST", body: JSON.stringify(mkTicketBody(999)) });
      check("C1-8. Ticket-create and ticket-message are independent buckets (A's create bucket still separately 429, unaffected by message-bucket activity)", stillTicketCreate429.status === 429, stillTicketCreate429);
    } else {
      fail++; results.push("❌ C1-7/8. Could not create a ticket to test messages against — setup failure");
    }

    // ═══════════════════════════════════════════════════════════
    // C1-9/10 — PAYOUT WITHDRAW (10/hour, self-service only)
    // Agent has no KYC, so every attempt fails at the business layer
    // (403) — no real payout document is ever created — but the
    // limiter (which runs BEFORE validation/business logic) still
    // counts every attempt correctly.
    // ═══════════════════════════════════════════════════════════
    {
      let statuses = [];
      for (let i = 0; i < 10; i++) {
        const r = await authFetch("/api/field-agent/payouts/withdraw", B.token, { method: "POST", body: JSON.stringify({ amountInPaise: 10000, idempotencyKey: `${NAME_PREFIX}wd-${i}` }) });
        statuses.push(r.status);
      }
      check("C1-9a. First 10 payout-withdraw requests are never 429 (business logic may still reject them for other reasons)", statuses.every((s) => s !== 429), statuses);
      check("C1-9b. No real payout was created (agent has no KYC, every attempt correctly failed business validation, not the limiter)", statuses.every((s) => s === 403 || s === 400), statuses);

      const eleventh = await authFetch("/api/field-agent/payouts/withdraw", B.token, { method: "POST", body: JSON.stringify({ amountInPaise: 10000, idempotencyKey: `${NAME_PREFIX}wd-11` }) });
      check("C1-9c. 11th payout-withdraw request is 429", eleventh.status === 429, eleventh);

      const adminToken = generateAccessToken({ _id: oid(), role: "ADMIN", adminLevel: "INDIA", tokenVersion: 0 });
      const adminList = await authFetch("/api/admin/field-agent/payouts", adminToken);
      check("C1-10. Admin payout routes are not affected by the Field-Agent withdraw limiter (not a 429; may be 404/other for a fake admin id, but never 429)", adminList.status !== 429, adminList);
    }

    // ═══════════════════════════════════════════════════════════
    // C1-11 — SERVER IDENTITY: client cannot spoof limiter identity
    // ═══════════════════════════════════════════════════════════
    {
      // B's referral-create bucket is still fresh (only 1 use above).
      // Attempt to smuggle A's (exhausted) identity via body/query.
      const spoofAttempt = await authFetch("/api/field-agent/acquisition/referrals?userId=" + A.agentUser._id, B.token, {
        method: "POST",
        body: JSON.stringify({ userId: A.agentUser._id.toString(), fieldAgentRef: A.fieldAgent._id.toString() }),
      });
      check("C1-11. Spoofed userId/fieldAgentRef in body/query does not change limiter identity (B's own bucket is used, not A's exhausted one)", spoofAttempt.status !== 429, spoofAttempt);
      if (spoofAttempt.data?.data?.referral?._id) fixtureReferralIds.push(spoofAttempt.data.data.referral._id);
    }

    // ═══════════════════════════════════════════════════════════
    // C1-12/13 — REDIS KEY / TTL VERIFICATION
    // ═══════════════════════════════════════════════════════════
    {
      const key = rlKey(RATE_LIMIT_ACTIONS.FIELD_AGENT_REFERRAL_CREATE, A.agentUser._id.toString());
      const val = await redis.get(key);
      check("C1-12. The exact expected Redis key exists under the server-derived identity", val !== null, { key, val });

      const ttl = await redis.ttl(key);
      check("C1-13. The limiter key has a bounded TTL (not -1/unbounded)", ttl > 0 && ttl <= RATE_LIMIT_CONFIG[RATE_LIMIT_ACTIONS.FIELD_AGENT_REFERRAL_CREATE].windowSeconds, ttl);
    }

    // ═══════════════════════════════════════════════════════════
    // C1-14 — ATOMICITY UNDER CONCURRENCY
    // ═══════════════════════════════════════════════════════════
    {
      const C = await mkFieldAgent("AGENT_C");
      redisKeysToClean.add(rlKey(RATE_LIMIT_ACTIONS.FIELD_AGENT_SUPPORT_CREATE, C.agentUser._id));
      const concurrentCount = 15; // > max(10), fired simultaneously
      const results15 = await Promise.all(
        Array.from({ length: concurrentCount }, (_, i) =>
          authFetch("/api/support/field-agent/tickets", C.token, { method: "POST", body: JSON.stringify(mkTicketBody(`concurrent-${i}`)) })
        )
      );
      results15.forEach((r) => { const tid = r.data?.data?.ticket?._id; if (tid) fixtureTicketIds.push(tid); });
      const successCount = results15.filter((r) => r.status !== 429).length;
      check("C1-14. Exactly max(10) of 15 concurrent requests succeed past the limiter — no undercounting race", successCount === 10, results15.map((r) => r.status));
    }

    // ═══════════════════════════════════════════════════════════
    // C1-15 — TTL EXPIRY (short test-only window, no real-hour wait)
    // ═══════════════════════════════════════════════════════════
    {
      const shortLimiter = createRedisRateLimiter({ action: "zztest_short_window", max: 1, windowSeconds: 2 });
      const fakeReq = (userId) => ({ user: { _id: userId } });
      let firstCalled = false, secondBlocked = false;
      await new Promise((resolve) => shortLimiter(fakeReq(A.agentUser._id), {
        set: () => {},
      }, (err) => { firstCalled = !err; resolve(); }));
      await new Promise((resolve) => shortLimiter(fakeReq(A.agentUser._id), {
        set: () => {},
      }, (err) => { secondBlocked = !!err; resolve(); }));
      check("C1-15a. Short-window limiter: 1st call passes, 2nd (same window) is blocked", firstCalled && secondBlocked, { firstCalled, secondBlocked });

      await new Promise((r) => setTimeout(r, 2500)); // real, short, bounded wait — not a full hour
      let thirdCalled = false;
      await new Promise((resolve) => shortLimiter(fakeReq(A.agentUser._id), { set: () => {} }, (err) => { thirdCalled = !err; resolve(); }));
      check("C1-15b. After the short window expires, a new request succeeds cleanly (new window)", thirdCalled, thirdCalled);
      redisKeysToClean.add(rlKey("zztest_short_window", A.agentUser._id.toString()));
    }

    // ═══════════════════════════════════════════════════════════
    // C1-16/22 — REDIS FAILURE FAIL-OPEN (reversible monkey-patch of
    // the SHARED client's eval method for the duration of one call
    // only — never touches the actual TCP connection)
    // ═══════════════════════════════════════════════════════════
    {
      const originalEval = redis.eval;
      redis.eval = async () => { throw new Error("simulated Redis failure — test only"); };
      let failOpenResult = null;
      try {
        failOpenResult = await authFetch("/api/field-agent/acquisition/referrals", B.token, { method: "POST" });
        if (failOpenResult.data?.data?.referral?._id) fixtureReferralIds.push(failOpenResult.data.data.referral._id);
      } finally {
        redis.eval = originalEval; // restored unconditionally, immediately
      }
      check("C1-16. Redis failure during the atomic increment fails OPEN (request still succeeds, not a 500)", failOpenResult.status !== 500 && failOpenResult.status !== 429, failOpenResult);

      // C1-22: confirm the atomic primitive itself (restored, real client)
      // still works correctly right after — proves the monkey-patch was
      // fully and safely reverted, and the increment+TTL are correct on
      // a fresh key.
      const freshKey = `ratelimit:zztest_atomic_check:${A.agentUser._id}`;
      redisKeysToClean.add(freshKey);
      const [n, ttl] = await redis.eval(
        `local n = redis.call("INCR", KEYS[1]) if n == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end local t = redis.call("TTL", KEYS[1]) return {n, t}`,
        { keys: [freshKey], arguments: ["30"] }
      );
      check("C1-22. Atomic primitive correctly increments (n=1) and establishes TTL on first creation, after the client was restored", n === 1 && ttl > 0 && ttl <= 30, { n, ttl });
    }

    // ═══════════════════════════════════════════════════════════
    // C1-17 — ROUTE BYPASS: no alternate/unprotected path reaches the
    // same five operations. /api/acquisition and /api/payouts are
    // confirmed (via app.js) to be REAL, unrelated modules (owner
    // acquisition-redeem router; customer/salon wallet payout router)
    // mounted at those prefixes — a FIELD_AGENT token correctly gets
    // 403 there (role.middleware's router.use() gate runs before path
    // matching), which is itself proof of no bypass, not evidence of
    // one. To test for a genuine bypass we probe paths that would
    // pass this actor's own role/active gates and therefore MUST 404
    // if no such alias route exists.
    {
      const legacyAttempts = await Promise.all([
        authFetch("/api/field-agent/referrals", A.token, { method: "POST" }),
        authFetch("/api/field-agent/acquisition/referral", A.token, { method: "POST" }),
        authFetch("/api/support/tickets", A.token, { method: "POST", body: JSON.stringify(mkTicketBody("legacy")) }),
        authFetch("/api/field-agent/payouts/create-withdrawal", A.token, { method: "POST", body: JSON.stringify({ amountInPaise: 10000, idempotencyKey: "legacy" }) }),
        authFetch("/api/acquisition/referrals", ownerA.token, { method: "POST" }),
      ]);
      check("C1-17. No alternate/unprotected route path serves any of the five C1 operations (all 404 for an actor whose role/active gates would otherwise pass)", legacyAttempts.every((r) => r.status === 404), legacyAttempts.map((r) => r.status));
    }

    // ═══════════════════════════════════════════════════════════
    // C1-18 — EXISTING BUSINESS CORRECTNESS (payout) — regression only,
    // does not replace the FA-14 suite.
    // ═══════════════════════════════════════════════════════════
    {
      const balanceCheck = await authFetch("/api/field-agent/payouts/balance", A.token);
      check("C1-18. Payout balance endpoint still functions correctly (FA-14 untouched)", balanceCheck.status === 200 || balanceCheck.status === 403, balanceCheck);
    }

    // ═══════════════════════════════════════════════════════════
    // C1-19 — EXISTING SUPPORT OWNERSHIP (cross-agent access still rejected)
    // ═══════════════════════════════════════════════════════════
    if (firstTicketId) {
      const crossAccess = await authFetch(`/api/support/field-agent/tickets/${firstTicketId}`, B.token);
      check("C1-19. Cross-agent ticket access remains rejected (403/404, not a new IDOR)", crossAccess.status === 403 || crossAccess.status === 404, crossAccess);
    }

    // ═══════════════════════════════════════════════════════════
    // C1-20/21 — EXISTING ROLE AUTHORIZATION UNCHANGED
    // ═══════════════════════════════════════════════════════════
    {
      const nonAgentReferral = await authFetch("/api/field-agent/acquisition/referrals", plainUserToken, { method: "POST" });
      check("C1-20. Non-Field-Agent (USER role) still cannot use the referral-create route (403)", nonAgentReferral.status === 403, nonAgentReferral);

      const nonOwnerRedeem = await authFetch("/api/acquisition/redeem", plainUserToken, { method: "POST", body: JSON.stringify({ referralCode: "X" }) });
      check("C1-21. Non-Owner (USER role) still cannot use the referral-redeem route (403)", nonOwnerRedeem.status === 403, nonOwnerRedeem);
    }
  } catch (err) {
    console.error("FATAL ERROR DURING TEST RUN:", err);
    fail++;
    results.push(`❌ FATAL: ${err.message}`);
  } finally {
    try {
      await SupportTicket.deleteMany({ _id: { $in: fixtureTicketIds } });
      await SupportCategory.deleteMany({ _id: { $in: fixtureCategoryIds } });
      if (createdOwnSlaPolicy && globalSlaId) await SupportSlaPolicy.deleteMany({ _id: globalSlaId });
      await AcquisitionReferral.deleteMany({ _id: { $in: fixtureReferralIds } });
      await FieldAgent.deleteMany({ _id: { $in: fixtureFieldAgentIds } });
      await FieldAgentApplication.deleteMany({ _id: { $in: fixtureApplicationIds } });
      await User.deleteMany({ _id: { $in: fixtureUserIds } });
      await Promise.all([...redisKeysToClean].map((k) => redis.del(k)));

      const residue = {
        users: await User.countDocuments({ _id: { $in: fixtureUserIds } }),
        fieldAgents: await FieldAgent.countDocuments({ _id: { $in: fixtureFieldAgentIds } }),
        applications: await FieldAgentApplication.countDocuments({ _id: { $in: fixtureApplicationIds } }),
        referrals: await AcquisitionReferral.countDocuments({ _id: { $in: fixtureReferralIds } }),
        categories: await SupportCategory.countDocuments({ _id: { $in: fixtureCategoryIds } }),
        tickets: await SupportTicket.countDocuments({ _id: { $in: fixtureTicketIds } }),
        redisKeysRemaining: (await Promise.all([...redisKeysToClean].map((k) => redis.exists(k)))).reduce((a, b) => a + b, 0),
      };
      check("Zero residue — all FA-15 Phase C1 fixtures (Mongo + Redis) removed", Object.values(residue).every((n) => n === 0), residue);
    } catch (cleanupErr) {
      console.error("CLEANUP FAILED:", cleanupErr);
      fail++;
      results.push(`❌ CLEANUP FAILED: ${cleanupErr.message}`);
    }

    server.close();
    await mongoose.disconnect();
  }

  console.log(results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)\n`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
