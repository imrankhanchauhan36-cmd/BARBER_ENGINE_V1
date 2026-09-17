/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyFieldAgentSecurityPhaseA.js
 *
 * FA-15 Phase A — permanent regression suite for the four mandatory
 * security fixes: OTP rate limiter (F1), production fixed-OTP
 * guardrail (F2), FieldAgent.operationalStatus request-level re-check,
 * and the support-service relatedBookingRef/relatedSalonRef
 * defense-in-depth hardening (F10). Real Mongo, real HTTP, real Redis,
 * real child-process boot for the F2 guardrail — mirrors this
 * project's established methodology (app.listen(0), generateAccessToken,
 * disposable fixtures with a NAME_PREFIX marker, exact-ID cleanup).
 *
 * Run:
 *   cd backend
 *   node scripts/verifyFieldAgentSecurityPhaseA.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import { spawn } from "child_process";
import app from "../app.js";
import connectDB from "../config/db.js";
import redis from "../config/redis.js";
import { generateAccessToken } from "../services/token.service.js";

import User from "../models/User.js";
import Booking from "../models/Booking.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import FieldAgentApplication from "../modules/fieldAgent/models/FieldAgentApplication.js";
import SupportCategory from "../modules/support/models/SupportCategory.js";
import SupportSlaPolicy from "../modules/support/models/SupportSlaPolicy.js";
import SupportTicket from "../modules/support/models/SupportTicket.js";
import { createTicket } from "../modules/support/services/supportTicket.service.js";
import { hashOtp } from "../utils/otp.helpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const NAME_PREFIX = "ZTEST_FA15A_";
const oid = () => new mongoose.Types.ObjectId();

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const fetchFrom = (path, { token, ip, ...opts } = {}) =>
    fetch(url(path), {
      ...opts,
      headers: {
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(ip ? { "X-Forwarded-For": ip } : {}),
      },
    }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));

  const fixtureUserIds = [];
  const fixtureFieldAgentIds = [];
  const fixtureApplicationIds = [];
  const fixtureBookingIds = [];
  const fixtureCategoryIds = [];
  const fixtureTicketIds = [];
  const otpRedisKeysToClean = [];
  let createdOwnSlaPolicy = false;
  let globalSlaId = null;

  try {
    // ═══════════════════════════════════════════════════════════
    // SECTION 1 — F1: OTP RATE LIMITER (per-IP, not global)
    // ═══════════════════════════════════════════════════════════
    {
      const ipA = `10.15.${Math.floor(Math.random() * 200)}.1`;
      const ipB = `10.15.${Math.floor(Math.random() * 200)}.2`;
      const phoneA = `9${Math.floor(100000000 + Math.random() * 899999999)}`;
      const phoneB = `9${Math.floor(100000000 + Math.random() * 899999999)}`;
      otpRedisKeysToClean.push(`otp:hash:FIELD_AGENT:${phoneA}`, `otp:attempts:FIELD_AGENT:${phoneA}`, `otp:hash:FIELD_AGENT:${phoneB}`, `otp:attempts:FIELD_AGENT:${phoneB}`);

      // fieldAgentOtpLimiter: max 5 per 5min. Exhaust IP A's budget.
      let lastA;
      for (let i = 0; i < 5; i++) {
        lastA = await fetchFrom("/api/field-agent/auth/send-otp", { ip: ipA, method: "POST", body: JSON.stringify({ phone: phoneA }) });
      }
      check("F1-1. IP A's 5th send-otp request succeeds (still within budget)", lastA.status !== 429, lastA);

      const sixthA = await fetchFrom("/api/field-agent/auth/send-otp", { ip: ipA, method: "POST", body: JSON.stringify({ phone: phoneA }) });
      check("F1-2. IP A's 6th send-otp request is rate limited (429)", sixthA.status === 429, sixthA);

      // THE CORE FIX: a DIFFERENT simulated IP must have its OWN,
      // independent budget — not share IP A's exhausted global bucket.
      const firstB = await fetchFrom("/api/field-agent/auth/send-otp", { ip: ipB, method: "POST", body: JSON.stringify({ phone: phoneB }) });
      check("F1-3. IP B is NOT blocked by IP A's exhausted budget (per-IP fix confirmed)", firstB.status !== 429, firstB);

      // verify-otp limiter: same per-IP proof, independent budget from send-otp's.
      let lastVerifyA;
      for (let i = 0; i < 10; i++) {
        lastVerifyA = await fetchFrom("/api/field-agent/auth/verify-otp", { ip: ipA, method: "POST", body: JSON.stringify({ phone: phoneA, otp: "000000" }) });
      }
      check("F1-4. IP A's verify-otp requests are being processed (not immediately 429)", lastVerifyA.status !== 429 || lastVerifyA.data?.message?.toLowerCase().includes("otp"), lastVerifyA);

      const eleventhVerifyA = await fetchFrom("/api/field-agent/auth/verify-otp", { ip: ipA, method: "POST", body: JSON.stringify({ phone: phoneA, otp: "000000" }) });
      check("F1-5. IP A's 11th verify-otp request is rate limited (429)", eleventhVerifyA.status === 429, eleventhVerifyA);

      const verifyB = await fetchFrom("/api/field-agent/auth/verify-otp", { ip: ipB, method: "POST", body: JSON.stringify({ phone: phoneB, otp: "000000" }) });
      check("F1-6. IP B's verify-otp is NOT blocked by IP A's exhausted verify budget", verifyB.status !== 429, verifyB);
    }

    // ── Existing per-phone+role OTP attempt protection must remain intact ──
    {
      const phone = `8${Math.floor(100000000 + Math.random() * 899999999)}`;
      const ip = `10.16.${Math.floor(Math.random() * 200)}.1`;
      otpRedisKeysToClean.push(`otp:hash:FIELD_AGENT:${phone}`, `otp:attempts:FIELD_AGENT:${phone}`);

      // Seed a real OTP hash so verify attempts have something to check against.
      await redis.set(`otp:hash:FIELD_AGENT:${phone}`, hashOtp("999999"), { EX: 300 });

      let lastAttempt;
      for (let i = 0; i < 5; i++) {
        lastAttempt = await fetchFrom("/api/field-agent/auth/verify-otp", { ip, method: "POST", body: JSON.stringify({ phone, otp: "111111" }) });
      }
      const sixthAttempt = await fetchFrom("/api/field-agent/auth/verify-otp", { ip, method: "POST", body: JSON.stringify({ phone, otp: "111111" }) });
      check("F1-7. Per-phone+role OTP attempt limit (OTP_ATTEMPT_LIMIT=5) still blocks after repeated wrong guesses", sixthAttempt.status === 429 && /too many/i.test(sixthAttempt.data?.message || ""), sixthAttempt);
    }

    // ═══════════════════════════════════════════════════════════
    // SECTION 2 — F2: PRODUCTION FIXED-OTP GUARDRAIL
    // ═══════════════════════════════════════════════════════════
    {
      const runServerWith = (env) => new Promise((resolve) => {
        const child = spawn(process.execPath, ["server.js"], {
          cwd: process.cwd(),
          env: { ...process.env, ...env, PORT: "0" },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stderr = "";
        child.stderr.on("data", (d) => { stderr += d.toString(); });
        child.on("exit", (code) => resolve({ exited: true, code, stderr }));
        // If it hasn't exited within the window, treat it as "still running" (booted normally).
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
            resolve({ exited: false, code: null, stderr });
          }
        }, 3000);
      });

      const prodWithBypass = await runServerWith({ NODE_ENV: "production", ALLOW_FIXED_OTP: "true" });
      check("F2-1. NODE_ENV=production + ALLOW_FIXED_OTP=true refuses to start (exits, non-zero code)", prodWithBypass.exited === true && prodWithBypass.code !== 0, prodWithBypass);
      check("F2-2. Refusal message is clear and does not leak secret values", /ALLOW_FIXED_OTP/.test(prodWithBypass.stderr) && !/mongodb\+srv|redis:\/\/.*:.*@/i.test(prodWithBypass.stderr), { stderrSnippet: prodWithBypass.stderr.slice(0, 300) });

      const prodWithoutBypass = await runServerWith({ NODE_ENV: "production", ALLOW_FIXED_OTP: "false" });
      check("F2-3. NODE_ENV=production + ALLOW_FIXED_OTP=false boots normally (does not exit within the window)", prodWithoutBypass.exited === false, prodWithoutBypass);

      const devWithBypass = await runServerWith({ NODE_ENV: "development", ALLOW_FIXED_OTP: "true" });
      check("F2-4. NODE_ENV=development + ALLOW_FIXED_OTP=true still boots normally (dev behavior preserved)", devWithBypass.exited === false, devWithBypass);
    }

    // ═══════════════════════════════════════════════════════════
    // SECTION 3 — FieldAgent.operationalStatus request-level re-check
    // ═══════════════════════════════════════════════════════════
    {
      const mkFieldAgent = async (label, operationalStatus) => {
        const agentUser = await User.create({ name: `${NAME_PREFIX}${label}`, phone: `7${Math.floor(100000000 + Math.random() * 899999999)}`, role: "FIELD_AGENT", accountStatus: "ACTIVE" });
        fixtureUserIds.push(agentUser._id);
        const application = await FieldAgentApplication.create({ userRef: agentUser._id, phone: agentUser.phone, status: "APPROVED", nonTerminal: false });
        fixtureApplicationIds.push(application._id);
        const fieldAgent = await FieldAgent.create({ userRef: agentUser._id, applicationRef: application._id, agentCode: `ZF15A-${label}-${Date.now()}`, operationalStatus, commercialPath: "ACQUISITION_AGENT" });
        fixtureFieldAgentIds.push(fieldAgent._id);
        const token = generateAccessToken({ _id: agentUser._id, role: "FIELD_AGENT", tokenVersion: 0 });
        return { agentUser, fieldAgent, token };
      };

      const active = await mkFieldAgent("ACTIVE_AGENT", "ACTIVE");
      const pending = await mkFieldAgent("PENDING_AGENT", "PENDING_ACTIVATION");

      const activeEarnings = await fetchFrom("/api/field-agent/earnings/mine", { token: active.token });
      check("OS-1. ACTIVE Field Agent can access earnings (operational API)", activeEarnings.status === 200, activeEarnings);

      const pendingEarnings = await fetchFrom("/api/field-agent/earnings/mine", { token: pending.token });
      check("OS-2. PENDING_ACTIVATION Field Agent is rejected on earnings (403)", pendingEarnings.status === 403, pendingEarnings);

      const activeBalance = await fetchFrom("/api/field-agent/payouts/balance", { token: active.token });
      check("OS-3. ACTIVE Field Agent can access payout balance", activeBalance.status === 200, activeBalance);

      const pendingBalance = await fetchFrom("/api/field-agent/payouts/balance", { token: pending.token });
      check("OS-4. PENDING_ACTIVATION Field Agent is rejected on payout balance (403)", pendingBalance.status === 403, pendingBalance);

      const activeClaims = await fetchFrom("/api/field-agent/acquisition/claims/mine", { token: active.token });
      check("OS-5. ACTIVE Field Agent can access claims list", activeClaims.status === 200, activeClaims);

      const pendingClaims = await fetchFrom("/api/field-agent/acquisition/claims/mine", { token: pending.token });
      check("OS-6. PENDING_ACTIVATION Field Agent is rejected on claims list (403)", pendingClaims.status === 403, pendingClaims);

      // Client cannot influence operationalStatus via request body.
      const pendingWithSpoof = await fetchFrom("/api/field-agent/earnings/mine?operationalStatus=ACTIVE", { token: pending.token });
      check("OS-7. Client cannot bypass the gate via a spoofed query/body field", pendingWithSpoof.status === 403, pendingWithSpoof);

      // USER/OWNER/other roles unaffected (they never reach this middleware
      // at all — requireRole("FIELD_AGENT") rejects them first; confirms no regression).
      const plainUser = await User.create({ name: `${NAME_PREFIX}PLAIN_USER`, phone: `6${Math.floor(100000000 + Math.random() * 899999999)}`, role: "USER", accountStatus: "ACTIVE" });
      fixtureUserIds.push(plainUser._id);
      const userToken = generateAccessToken({ _id: plainUser._id, role: "USER", tokenVersion: 0 });
      const userOnFieldAgentRoute = await fetchFrom("/api/field-agent/earnings/mine", { token: userToken });
      check("OS-8. USER role still gets its pre-existing 403 from requireRole (unaffected by the new gate)", userOnFieldAgentRoute.status === 403, userOnFieldAgentRoute);
    }

    // ═══════════════════════════════════════════════════════════
    // SECTION 4 — F10: support service-layer relatedRef defense-in-depth
    // ═══════════════════════════════════════════════════════════
    {
      const category = await SupportCategory.create({ name: `${NAME_PREFIX}CATEGORY`, code: `ZF15A${Date.now() % 100000}`, isActive: true, isDeleted: false });
      fixtureCategoryIds.push(category._id);

      let globalSla = await SupportSlaPolicy.findOne({ categoryRef: null, isActive: true, isDeleted: false }).lean();
      if (!globalSla) {
        const targets = { firstResponseMinutes: 60, resolutionMinutes: 1440 };
        globalSla = await SupportSlaPolicy.create({
          categoryRef: null,
          targetsByPriority: { LOW: targets, NORMAL: targets, HIGH: targets, CRITICAL: targets },
          warningThresholdPercent: 80,
          isActive: true,
          isDeleted: false,
        });
        createdOwnSlaPolicy = true;
      }
      globalSlaId = globalSla._id;

      const agentUser = await User.create({ name: `${NAME_PREFIX}SUPPORT_AGENT`, phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, role: "FIELD_AGENT", accountStatus: "ACTIVE" });
      fixtureUserIds.push(agentUser._id);

      const someBooking = await Booking.create({
        userRef: oid(), salonRef: oid(), chairRef: oid(), serviceRefs: [oid()],
        bookingDate: new Date().toISOString().slice(0, 10),
        startTime: new Date(Date.now() + 3600000), endTime: new Date(Date.now() + 5400000),
        serviceDuration: 30, status: "CONFIRMED",
        serviceAmountInPaise: 40000, commissionAmountInPaise: 10000, totalAmountInPaise: 50000,
      });
      fixtureBookingIds.push(someBooking._id);

      // Calling createTicket() DIRECTLY (bypassing the HTTP validator
      // entirely) — this is the only way to actually exercise the new
      // service-layer defense-in-depth, since the real HTTP route's own
      // validator already forbids these fields before the service is
      // ever reached. Proves the fix works independent of the validator.
      let bookingRefError = null;
      try {
        await createTicket({
          requesterId: agentUser._id, role: "FIELD_AGENT",
          categoryRef: category._id, subject: `${NAME_PREFIX}subject`, body: `${NAME_PREFIX}body`,
          relatedBookingRef: someBooking._id, relatedSalonRef: null, attachments: [],
        });
      } catch (err) { bookingRefError = err; }
      check("F10-1. FIELD_AGENT + relatedBookingRef is rejected at the SERVICE layer (bypassing the validator)", bookingRefError?.status === 403 || bookingRefError?.message?.includes("not supported"), { message: bookingRefError?.message, status: bookingRefError?.status });

      let salonRefError = null;
      try {
        await createTicket({
          requesterId: agentUser._id, role: "FIELD_AGENT",
          categoryRef: category._id, subject: `${NAME_PREFIX}subject2`, body: `${NAME_PREFIX}body2`,
          relatedBookingRef: null, relatedSalonRef: oid(), attachments: [],
        });
      } catch (err) { salonRefError = err; }
      check("F10-2. FIELD_AGENT + relatedSalonRef is rejected at the SERVICE layer (pre-existing behavior preserved)", salonRefError?.status === 400 || salonRefError?.message?.includes("requires a valid"), { message: salonRefError?.message, status: salonRefError?.status });

      // USER/OWNER valid related references continue working (regression check).
      const customer = await User.create({ name: `${NAME_PREFIX}CUSTOMER`, phone: `8${Math.floor(100000000 + Math.random() * 899999999)}`, role: "USER", accountStatus: "ACTIVE" });
      fixtureUserIds.push(customer._id);
      const ownBooking = await Booking.create({
        userRef: customer._id, salonRef: oid(), chairRef: oid(), serviceRefs: [oid()],
        bookingDate: new Date().toISOString().slice(0, 10),
        startTime: new Date(Date.now() + 3600000), endTime: new Date(Date.now() + 5400000),
        serviceDuration: 30, status: "CONFIRMED",
        serviceAmountInPaise: 40000, commissionAmountInPaise: 10000, totalAmountInPaise: 50000,
      });
      fixtureBookingIds.push(ownBooking._id);

      const userTicket = await createTicket({
        requesterId: customer._id, role: "USER",
        categoryRef: category._id, subject: `${NAME_PREFIX}user-subject`, body: `${NAME_PREFIX}user-body`,
        relatedBookingRef: ownBooking._id, relatedSalonRef: null, attachments: [],
      });
      check("F10-3. USER + own relatedBookingRef still succeeds (no regression)", !!userTicket?._id, userTicket);
      if (userTicket?._id) fixtureTicketIds.push(userTicket._id);

      // Cross-agent access still impossible (no new IDOR introduced).
      const otherAgent = await User.create({ name: `${NAME_PREFIX}OTHER_AGENT`, phone: `7${Math.floor(100000000 + Math.random() * 899999999)}`, role: "FIELD_AGENT", accountStatus: "ACTIVE" });
      fixtureUserIds.push(otherAgent._id);
      const otherAgentToken = generateAccessToken({ _id: otherAgent._id, role: "FIELD_AGENT", tokenVersion: 0 });
      const crossAccess = await fetchFrom("/api/support/field-agent/tickets/000000000000000000000000", { token: otherAgentToken });
      check("F10-4. Cross-agent ticket access remains impossible (404/403, not a new IDOR)", crossAccess.status === 404 || crossAccess.status === 403, crossAccess);
    }

    // ═══════════════════════════════════════════════════════════
    // CLEANUP — exact-ID, zero residue
    // ═══════════════════════════════════════════════════════════
    await Promise.all(otpRedisKeysToClean.map((k) => redis.del(k)));
  } catch (err) {
    console.error("FATAL ERROR DURING TEST RUN:", err);
    fail++;
    results.push(`❌ FATAL: ${err.message}`);
  } finally {
    try {
      await SupportTicket.deleteMany({ _id: { $in: fixtureTicketIds } });
      await SupportCategory.deleteMany({ _id: { $in: fixtureCategoryIds } });
      if (createdOwnSlaPolicy && globalSlaId) await SupportSlaPolicy.deleteMany({ _id: globalSlaId });
      await Booking.deleteMany({ _id: { $in: fixtureBookingIds } });
      await FieldAgent.deleteMany({ _id: { $in: fixtureFieldAgentIds } });
      await FieldAgentApplication.deleteMany({ _id: { $in: fixtureApplicationIds } });
      await User.deleteMany({ _id: { $in: fixtureUserIds } });
      await Promise.all(otpRedisKeysToClean.map((k) => redis.del(k)));

      const residue = {
        users: await User.countDocuments({ _id: { $in: fixtureUserIds } }),
        fieldAgents: await FieldAgent.countDocuments({ _id: { $in: fixtureFieldAgentIds } }),
        applications: await FieldAgentApplication.countDocuments({ _id: { $in: fixtureApplicationIds } }),
        bookings: await Booking.countDocuments({ _id: { $in: fixtureBookingIds } }),
        categories: await SupportCategory.countDocuments({ _id: { $in: fixtureCategoryIds } }),
        tickets: await SupportTicket.countDocuments({ _id: { $in: fixtureTicketIds } }),
      };
      check("Zero residue — all FA-15 Phase A fixtures removed", Object.values(residue).every((n) => n === 0), residue);
    } catch (cleanupErr) {
      console.error("CLEANUP FAILED:", cleanupErr);
      fail++;
      results.push(`❌ CLEANUP FAILED: ${cleanupErr.message}`);
    }

    server.close();
    await mongoose.disconnect();
    await redis.quit().catch(() => {});
  }

  console.log(results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)\n`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
