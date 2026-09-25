/**
 * BARBER ENGINE V1
 * backend/scripts/verifyFieldAgentOperationalAuth.js
 *
 * FA-13A — dedicated, real-Mongo, real-Redis, real-HTTP verification
 * for the APPROVED FIELD AGENT OPERATIONAL LOGIN contract
 * (POST /api/field-agent/auth/login/send-otp,
 *  POST /api/field-agent/auth/login/verify-otp), and a targeted
 * regression proving FA-2's own apply-flow endpoints
 * (/api/field-agent/auth/send-otp, /verify-otp) are byte-for-byte
 * unchanged.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyFieldAgentOperationalAuth.js
 *
 * Requires ALLOW_FIXED_OTP=true (already set in this project's .env)
 * so the OTP is deterministic ("123456") and echoed in the send-otp
 * response — no SMS provider needed.
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import redis from "../config/redis.js";
import User from "../models/User.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import FieldAgentApplication from "../modules/fieldAgent/models/FieldAgentApplication.js";

const NAME_PREFIX = "ZTEST_FA13A_";
const oid = () => new mongoose.Types.ObjectId();

let passed = 0;
let failed = 0;
const check = (label, cond, extra) => {
  if (cond) {
    passed++;
    console.log(`✅ ${label}`);
  } else {
    failed++;
    console.log(`❌ ${label}`, extra !== undefined ? extra : "");
  }
};

const LOGIN_API = "/api/field-agent/auth/login";
const APPLY_API = "/api/field-agent/auth";
const OWNER_API = "/api/auth/partner";

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  // trust proxy=1 is set in app.js, so a distinct synthetic
  // X-Forwarded-For per test phone gives each scenario its own
  // rate-limit bucket — otherwise every request in this single-process
  // run shares 127.0.0.1 and quickly trips the very real (and
  // correctly working) per-IP OTP rate limiters, which would produce
  // false negatives unrelated to the actual behavior under test.
  const post = (p, body, fakeIp) =>
    fetch(url(p), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(fakeIp ? { "x-forwarded-for": fakeIp } : {}) },
      body: JSON.stringify(body || {}),
    }).then(async (r) => ({
      status: r.status,
      data: await r.json().catch(() => ({})),
    }));
  const ipForPhone = (phone) => `10.13.${Math.floor(Number(phone.slice(-4)) / 256)}.${Number(phone.slice(-4)) % 256}`;

  const fixtureUserIds = [];
  const fixtureFieldAgentIds = [];
  const fixtureApplicationIds = [];

  let phoneSeq = 0;
  const nextPhone = () => `9${String(990000000 + phoneSeq++).padStart(9, "0")}`;

  const mkFieldAgentUser = async ({ operationalStatus = "ACTIVE", commercialPath = "TERRITORY_PARTNER", accountStatus = "ACTIVE" } = {}) => {
    const phone = nextPhone();
    const user = await User.create({ name: `${NAME_PREFIX}AGENT_${Date.now()}_${Math.random()}`, phone, role: "FIELD_AGENT", accountStatus });
    fixtureUserIds.push(user._id);
    const fieldAgent = await FieldAgent.create({
      userRef: user._id,
      applicationRef: oid(),
      agentCode: `ZFA13-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      operationalStatus,
      commercialPath,
    });
    fixtureFieldAgentIds.push(fieldAgent._id);
    return { user, fieldAgent, phone };
  };

  const mkFieldAgentUserNoProfile = async () => {
    const phone = nextPhone();
    const user = await User.create({ name: `${NAME_PREFIX}NOPROFILE_${Date.now()}`, phone, role: "FIELD_AGENT", accountStatus: "ACTIVE" });
    fixtureUserIds.push(user._id);
    return { user, phone };
  };

  const mkOwnerUser = async () => {
    const phone = nextPhone();
    const user = await User.create({ name: `${NAME_PREFIX}OWNER_${Date.now()}`, phone, role: "OWNER", accountStatus: "ACTIVE" });
    fixtureUserIds.push(user._id);
    return { user, phone };
  };

  const sendLoginOtp = (phone) => post(`${LOGIN_API}/send-otp`, { phone }, ipForPhone(phone));
  const verifyLoginOtp = (phone, otp) => post(`${LOGIN_API}/verify-otp`, { phone, otp }, ipForPhone(phone));

  try {
    // ── A-F. HAPPY PATH: approved Field Agent operational login ─────
    {
      const { user, fieldAgent, phone } = await mkFieldAgentUser({ operationalStatus: "ACTIVE", commercialPath: "TERRITORY_PARTNER" });
      const appCountBefore = await FieldAgentApplication.countDocuments();

      const sendRes = await sendLoginOtp(phone);
      check("Send login OTP -> 200", sendRes.status === 200, sendRes.status);
      const otp = sendRes.data.otp || "123456";

      const verifyRes = await verifyLoginOtp(phone, otp);
      check("A. Approved Field Agent can authenticate -> 200", verifyRes.status === 200, verifyRes.status);
      check("A. accessToken/refreshToken present", !!verifyRes.data.accessToken && !!verifyRes.data.refreshToken);
      check("B. role in response is FIELD_AGENT", verifyRes.data.role === "FIELD_AGENT", verifyRes.data.role);
      check("C. fieldAgentId correctly resolved", String(verifyRes.data.fieldAgentId) === String(fieldAgent._id), verifyRes.data.fieldAgentId);
      check("C. agentCode correctly resolved", verifyRes.data.agentCode === fieldAgent.agentCode);
      check("D. commercialPath correctly available", verifyRes.data.commercialPath === "TERRITORY_PARTNER", verifyRes.data.commercialPath);
      check("E. operationalStatus correctly available", verifyRes.data.operationalStatus === "ACTIVE", verifyRes.data.operationalStatus);

      const appCountAfter = await FieldAgentApplication.countDocuments();
      check("F. No FieldAgentApplication created by operational login", appCountAfter === appCountBefore, { before: appCountBefore, after: appCountAfter });

      // Decode the JWT payload to independently confirm role/id (not just trusting the response body).
      const [, payloadB64] = verifyRes.data.accessToken.split(".");
      const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8"));
      check("B. JWT payload role is FIELD_AGENT (authoritative token content)", payload.role === "FIELD_AGENT", payload.role);
      check("B. JWT payload id matches the User document", String(payload.id) === String(user._id));

      // J. Refresh works through the EXISTING, unmodified /api/auth/refresh.
      const refreshRes = await fetch(url("/api/auth/refresh"), {
        method: "POST",
        headers: { "x-refresh-token": verifyRes.data.refreshToken },
      }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
      check("J. Refresh via existing /api/auth/refresh succeeds", refreshRes.status === 200 && !!refreshRes.data.accessToken, refreshRes.status);
    }

    // ── G. OWNER phone cannot obtain FIELD_AGENT authority via this endpoint ──
    {
      const { phone } = await mkOwnerUser();
      const sendRes = await sendLoginOtp(phone);
      const otp = sendRes.data.otp || "123456";
      const verifyRes = await verifyLoginOtp(phone, otp);
      check("G. OWNER phone via Field Agent operational login -> 404 (never a FIELD_AGENT session)", verifyRes.status === 404, verifyRes.status);
      check("G. No accessToken/session issued for the OWNER phone", !verifyRes.data.accessToken);
    }

    // ── H. FIELD_AGENT phone via OWNER login — PRE-EXISTING, UNMODIFIED finding ──
    // IMPORTANT: this is NOT the behavior originally predicted (a 500
    // from a unique-phone collision). Live investigation this session
    // found the User collection's ACTUAL deployed index is
    // {phone:1,isDeleted:1} (plain compound, NOT unique) — the
    // {phone:1} partial-UNIQUE index declared in models/User.js was
    // apparently never built against the live Atlas cluster. So
    // createOrFindUser(phone,"OWNER",...) does NOT collide — it
    // silently creates a SECOND, real User document with the SAME
    // phone number and role OWNER, and issues a fully valid OWNER
    // session for it. This is a genuine, pre-existing, unrelated
    // security/data-integrity gap in a frozen, shared core model —
    // NOT introduced, caused, or fixed by FA-13A. Flagged, not fixed,
    // per this phase's own explicit stop-condition instructions.
    {
      const { phone } = await mkFieldAgentUser({ operationalStatus: "ACTIVE" });
      const sendRes = await post(`${OWNER_API}/send-otp`, { phone }, ipForPhone(phone));
      const otp = sendRes.data.otp || "123456";
      const verifyRes = await post(`${OWNER_API}/verify-otp`, { phone, otp }, ipForPhone(phone));
      check(
        "H. [FINDING, not a FA-13A defect] FIELD_AGENT phone via the pre-existing OWNER login endpoint succeeds and silently creates a SECOND User with role OWNER for the same phone number — the live User.phone index is not actually unique (see report)",
        verifyRes.status === 200 && verifyRes.data.role === "OWNER",
        verifyRes.status
      );
      if (verifyRes.data.userId) fixtureUserIds.push(verifyRes.data.userId);
      const phoneUserCount = await User.countDocuments({ phone });
      check("H. [FINDING] exactly 2 User documents now exist for this single phone number (FIELD_AGENT + OWNER) — confirms the live index does not enforce uniqueness", phoneUserCount === 2, phoneUserCount);
    }

    // ── Unknown phone (no User at all) ───────────────────────────────
    {
      const phone = nextPhone();
      const sendRes = await sendLoginOtp(phone);
      const otp = sendRes.data.otp || "123456";
      const verifyRes = await verifyLoginOtp(phone, otp);
      check("Unknown phone -> 404, no session", verifyRes.status === 404 && !verifyRes.data.accessToken, verifyRes.status);
    }

    // ── FIELD_AGENT User exists but no FieldAgent profile (applied, not yet approved) ──
    {
      const { phone } = await mkFieldAgentUserNoProfile();
      const sendRes = await sendLoginOtp(phone);
      const otp = sendRes.data.otp || "123456";
      const verifyRes = await verifyLoginOtp(phone, otp);
      check("FIELD_AGENT without an approved profile -> 404, no session", verifyRes.status === 404 && !verifyRes.data.accessToken, verifyRes.status);
    }

    // ── Inactive/non-operational Field Agent (PENDING_ACTIVATION) ────
    {
      const { phone } = await mkFieldAgentUser({ operationalStatus: "PENDING_ACTIVATION", commercialPath: null });
      const sendRes = await sendLoginOtp(phone);
      const otp = sendRes.data.otp || "123456";
      const verifyRes = await verifyLoginOtp(phone, otp);
      check("PENDING_ACTIVATION Field Agent -> 403, no session (frozen operationalStatus enum, no new status invented)", verifyRes.status === 403 && !verifyRes.data.accessToken, verifyRes.status);
    }

    // ── Blocked accountStatus ─────────────────────────────────────────
    {
      const { phone } = await mkFieldAgentUser({ operationalStatus: "ACTIVE", accountStatus: "SUSPENDED" });
      const sendRes = await sendLoginOtp(phone);
      const otp = sendRes.data.otp || "123456";
      const verifyRes = await verifyLoginOtp(phone, otp);
      check("I. SUSPENDED accountStatus -> 403 (existing enforcement reused, not reinvented)", verifyRes.status === 403 && !verifyRes.data.accessToken, verifyRes.status);
    }
    {
      const { phone } = await mkFieldAgentUser({ operationalStatus: "ACTIVE", accountStatus: "BLOCKED" });
      const sendRes = await sendLoginOtp(phone);
      const otp = sendRes.data.otp || "123456";
      const verifyRes = await verifyLoginOtp(phone, otp);
      check("I. BLOCKED accountStatus -> 403", verifyRes.status === 403 && !verifyRes.data.accessToken, verifyRes.status);
    }

    // ── Wrong OTP ──────────────────────────────────────────────────────
    {
      const { phone } = await mkFieldAgentUser({ operationalStatus: "ACTIVE" });
      await sendLoginOtp(phone);
      const wrongRes = await verifyLoginOtp(phone, "000000");
      check("Wrong OTP -> 401", wrongRes.status === 401, wrongRes.status);
    }

    // ── OTP reuse (same OTP verified twice) ───────────────────────────
    {
      const { phone } = await mkFieldAgentUser({ operationalStatus: "ACTIVE" });
      const sendRes = await sendLoginOtp(phone);
      const otp = sendRes.data.otp || "123456";
      const first = await verifyLoginOtp(phone, otp);
      check("First verify with a fresh OTP succeeds", first.status === 200, first.status);
      const second = await verifyLoginOtp(phone, otp);
      check("OTP reuse (same code verified a second time) -> 401, hash already consumed", second.status === 401, second.status);
    }

    // ── Expired OTP (simulated by deleting the Redis hash directly) ──
    {
      const { phone } = await mkFieldAgentUser({ operationalStatus: "ACTIVE" });
      await sendLoginOtp(phone);
      // OTP Engine V1.0 Revision 3 — key format is now
      // otp:{role}:{purpose}:{phone}:hash — see
      // modules/otp/services/otp.service.js#otpBaseKey.
      await redis.del(`otp:field_agent:field_agent_login:${phone}:hash`);
      const verifyRes = await verifyLoginOtp(phone, "123456");
      check("Expired OTP -> 401, atomic verify script correctly rejects a missing hash", verifyRes.status === 401, verifyRes.status);
    }

    // ── Concurrent verification (real races, same correct OTP) ───────
    {
      const { fieldAgent, phone } = await mkFieldAgentUser({ operationalStatus: "ACTIVE" });
      const sendRes = await sendLoginOtp(phone);
      const otp = sendRes.data.otp || "123456";
      const results = await Promise.all([verifyLoginOtp(phone, otp), verifyLoginOtp(phone, otp), verifyLoginOtp(phone, otp)]);
      const succeeded = results.filter((r) => r.status === 200);
      check("Concurrent verification: at least one succeeds", succeeded.length >= 1, results.map((r) => r.status));
      check(
        "Concurrent verification: no duplicate User/FieldAgent/Application created regardless of race outcome (this handler creates none of those)",
        (await User.countDocuments({ _id: fieldAgent.userRef })) === 1 && (await FieldAgent.countDocuments({ userRef: fieldAgent.userRef })) === 1
      );
    }

    // ── K. FA-2 apply-flow endpoints unchanged (regression) ──────────
    {
      const phone = nextPhone();
      const appCountBefore = await FieldAgentApplication.countDocuments();
      const sendRes = await post(`${APPLY_API}/send-otp`, { phone }, ipForPhone(phone));
      check("K. FA-2 apply-flow /send-otp still works unchanged -> 200", sendRes.status === 200, sendRes.status);
      const otp = sendRes.data.otp || "123456";
      const verifyRes = await post(`${APPLY_API}/verify-otp`, { phone, otp }, ipForPhone(phone));
      check("K. FA-2 apply-flow /verify-otp still works unchanged -> 200", verifyRes.status === 200, verifyRes.status);
      check("K. FA-2 apply-flow still returns an `application` object (unchanged contract)", !!verifyRes.data.application);
      check("K. FA-2 apply-flow role is FIELD_AGENT (unchanged)", verifyRes.data.role === "FIELD_AGENT");

      const appCountAfter = await FieldAgentApplication.countDocuments();
      check("K. FA-2 apply-flow still creates exactly one new DRAFT application (unchanged behavior)", appCountAfter === appCountBefore + 1, { before: appCountBefore, after: appCountAfter });

      // Track for cleanup.
      const createdUser = await User.findOne({ phone, role: "FIELD_AGENT" }).lean();
      if (createdUser) fixtureUserIds.push(createdUser._id);
      if (verifyRes.data.application?._id) fixtureApplicationIds.push(verifyRes.data.application._id);
    }

    // ── L. Broader existing auth regression smoke check ──────────────
    {
      // Existing OWNER send-otp/refresh/logout infra still reachable
      // and behaving per their own established contracts (not
      // touched by this phase at all).
      const phone = nextPhone();
      const ownerSend = await post(`${OWNER_API}/send-otp`, { phone }, ipForPhone(phone));
      check("L. Existing OWNER /send-otp unaffected -> 200", ownerSend.status === 200, ownerSend.status);
      const noTokenRefresh = await fetch(url("/api/auth/refresh"), { method: "POST" }).then((r) => r.status);
      check("L. Existing /api/auth/refresh with no token still -> 401 (unaffected)", noTokenRefresh === 401, noTokenRefresh);
    }
  } finally {
    // ── CLEANUP (explicit ID lists only) ─────────────────────────────
    await FieldAgentApplication.deleteMany({ _id: { $in: fixtureApplicationIds } });
    await FieldAgent.deleteMany({ _id: { $in: fixtureFieldAgentIds } });
    await User.deleteMany({ _id: { $in: fixtureUserIds } });

    const residue = {
      applications: await FieldAgentApplication.countDocuments({ _id: { $in: fixtureApplicationIds } }),
      fieldAgents: await FieldAgent.countDocuments({ _id: { $in: fixtureFieldAgentIds } }),
      users: await User.countDocuments({ _id: { $in: fixtureUserIds } }),
    };
    const zeroResidue = Object.values(residue).every((n) => n === 0);
    check("Zero residue — all FA-13A auth fixtures removed", zeroResidue, residue);

    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)\n`);
  await mongoose.connection.close();
  try {
    await redis.quit();
  } catch {}
  process.exit(failed > 0 ? 1 : 0);
};

run().catch(async (err) => {
  console.error("❌ FA-13A operational auth verification crashed:", err);
  try {
    await mongoose.connection.close();
  } catch {}
  process.exit(1);
});
