/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyPhase3bKycSecurityHardening.mjs
 *
 * Phase 3b — Global Verification Engine security hardening (approved
 * 2026-10-10). Real Mongo, real HTTP (app.listen(0)), real Redis
 * (idempotency/scopedIdempotency), real express-rate-limit — NO
 * Cashfree/Surepass/Cloudinary live call anywhere in this script.
 *
 * Covers:
 *   A. Owner submission rate limit (10/min) — below, at, above threshold
 *   B. Owner document rate limit (10/min) — below, at, above threshold
 *      (deliberately sends NO file, so the limiter's own count is
 *      proven without ever reaching real Cloudinary — see inline note)
 *   C. Admin verify rate limit (30/min) — below, at, above threshold
 *   D. Per-user isolation — a second user's budget is untouched by the
 *      first user's requests, on both Owner and Admin routes
 *   E. RBAC/auth still enforced — no token (401), wrong role on Owner
 *      route (403), DISTRICT admin on verify route (403) — unaffected
 *      by the new middleware
 *   F. Idempotency — same key + same payload = cached; same key +
 *      different payload = 409; same literal key reused on a
 *      DIFFERENT route = no collision (route-scoping proven)
 *   G. Field Agent regression — fieldAgentKyc.routes.js's OWN,
 *      unwrapped idempotency usage still behaves exactly as before
 *      (same key -> cached, the ORIGINAL contract, unmodified)
 *
 * Does NOT test Redis-failure fail-open — that is covered by the
 * separate, controlled unit test scripts/unit/verifyScopedIdempotencyRedisFailure.mjs,
 * where the Redis client can be deterministically forced to throw.
 *
 * Run:  cd backend && node scripts/e2e/verifyPhase3bKycSecurityHardening.mjs
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../../app.js";
import connectDB from "../../config/db.js";
import { generateAccessToken } from "../../services/token.service.js";
import User from "../../models/User.js";
import Salon from "../../models/Salon.js";
import Country from "../../models/Country.js";
import State from "../../models/State.js";
import District from "../../models/District.js";
import City from "../../models/City.js";
import Area from "../../models/Area.js";
import KYC from "../../modules/kyc/models/KYC.js";
import VerificationLog from "../../modules/kyc/models/VerificationLog.js";
import { APPLICANT_TYPE } from "../../modules/kyc/constants/kyc.constants.js";
import { makeGeoFixture, nextPhone, NAME_PREFIX as SHARED_PREFIX } from "./fieldAgentE2EHelpers.js";

const NAME_PREFIX = `${SHARED_PREFIX}P3B_`;

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

  const createdIds = { users: [], kycs: [], salons: [], states: [], districts: [], cities: [], areas: [] };

  const mkOwner = async (label) => {
    const owner = await User.create({ name: `${NAME_PREFIX}OWNER_${label}`, phone: nextPhone("7"), role: "OWNER", accountStatus: "ACTIVE", tokenVersion: 0 });
    createdIds.users.push(owner._id);
    const token = generateAccessToken({ _id: owner._id, role: "OWNER", tokenVersion: 0 });
    return { user: owner, token };
  };

  // Minimal geo fixture — needed only to satisfy User.js's own
  // pre-validate hook (STATE admin requires countryRef+stateRef,
  // DISTRICT requires countryRef+stateRef+districtRef). KYC scope
  // resolution itself is NOT exercised by this script's scenarios
  // (verify-pan has no status gate and the INDIA/DISTRICT checks below
  // are rejected by requireAdminLevel before any scope logic runs), so
  // a single shared geo fixture is sufficient — no per-test Salon
  // territory matching is required.
  const geo = await makeGeoFixture({ Country, State, District, City, Area }, "P3B");
  createdIds.states.push(geo.state._id);
  createdIds.districts.push(geo.district._id);
  createdIds.cities.push(geo.city._id);
  createdIds.areas.push(geo.area._id);

  const mkAdmin = async (label, adminLevel) => {
    const admin = await User.create({
      name: `${NAME_PREFIX}ADMIN_${label}`,
      phone: nextPhone("8"),
      email: `${NAME_PREFIX.toLowerCase()}admin_${label.toLowerCase()}_${Date.now()}@example.test`,
      role: "ADMIN",
      adminLevel,
      countryRef: geo.country._id,
      stateRef: adminLevel !== "INDIA" ? geo.state._id : null,
      districtRef: adminLevel === "DISTRICT" ? geo.district._id : null,
      adminSubRole: adminLevel === "INDIA" ? null : "PRIMARY",
      accountStatus: "ACTIVE",
      tokenVersion: 0,
    });
    createdIds.users.push(admin._id);
    const token = generateAccessToken({ _id: admin._id, role: "ADMIN", adminLevel, tokenVersion: 0 });
    return { user: admin, token };
  };

  const mkFieldAgentUser = async (label) => {
    const fa = await User.create({ name: `${NAME_PREFIX}FA_${label}`, phone: nextPhone("9"), role: "FIELD_AGENT", accountStatus: "ACTIVE", tokenVersion: 0 });
    createdIds.users.push(fa._id);
    const token = generateAccessToken({ _id: fa._id, role: "FIELD_AGENT", tokenVersion: 0 });
    return { user: fa, token };
  };

  // Needed only for the STATE-admin isolation check in Section D —
  // assertKYCInScope resolves a STATE/DISTRICT admin's scope via the
  // owner's Salon territory (Phase 1 audit finding), so a STATE admin
  // can only legitimately act on an owner who actually has a Salon in
  // that state. Exact fixture shape mirrors verifyKycApprovalCorrectness.js's
  // own mkOwnerWithSalon.
  const mkSalonInGeo = async (ownerId, label) => {
    const dayTiming = { open: "09:00", close: "20:00" };
    const timings = { monday: dayTiming, tuesday: dayTiming, wednesday: dayTiming, thursday: dayTiming, friday: dayTiming, saturday: dayTiming, sunday: dayTiming };
    const salon = await Salon.create({
      ownerId,
      basicInfo: { shopName: `${NAME_PREFIX}SALON_${label}_${Date.now()}`, category: "UNISEX" },
      location: {
        address: `${NAME_PREFIX} addr`,
        geo: { type: "Point", coordinates: [77, 28] },
        territory: { countryRef: geo.country._id, stateRef: geo.state._id, districtRef: geo.district._id, cityRef: geo.city._id, areaRef: geo.area._id },
      },
      timings, approval: { status: "APPROVED" }, onboarding: { step: 7 }, isDeleted: false,
    });
    createdIds.salons.push(salon._id);
    return salon;
  };

  const mkOwnerKYC = async (ownerId) => {
    const kyc = await KYC.create({ ownerId, applicantType: APPLICANT_TYPE.OWNER, status: "PENDING" });
    createdIds.kycs.push(kyc._id);
    return kyc;
  };

  try {
    const indiaAdminDoc = await User.findOne({ role: "ADMIN", adminLevel: "INDIA", isDeleted: { $ne: true } }).select("+tokenVersion");
    if (!indiaAdminDoc) throw new Error("No real INDIA admin exists in this DB — cannot proceed");
    const indiaAdmin = { token: generateAccessToken({ _id: indiaAdminDoc._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdminDoc.tokenVersion ?? 0 }) };

    // ════════════════════════════════════════════════════════
    // SECTION A — Owner submission rate limit (10/min), no Idempotency-Key
    // ════════════════════════════════════════════════════════
    {
      const ownerA = await mkOwner("RATE_A");
      let allBelowOk = true;
      for (let i = 0; i < 10; i++) {
        const r = await authFetch("/api/salon/kyc/identity", ownerA.token, { method: "POST", body: JSON.stringify({ panNumber: "ABCDE1234F", nameOnPAN: "Rate Test" }) });
        if (r.status !== 200) { allBelowOk = false; }
      }
      check("A. 10 identity submissions within 1 min all succeed (at threshold)", allBelowOk);

      const r11 = await authFetch("/api/salon/kyc/identity", ownerA.token, { method: "POST", body: JSON.stringify({ panNumber: "ABCDE1234F", nameOnPAN: "Rate Test" }) });
      check("A. 11th identity submission within the same minute = 429", r11.status === 429, r11.data);
    }

    // ════════════════════════════════════════════════════════
    // SECTION B — Owner document rate limit (10/min). Deliberately
    // sends NO document field — multer leaves req.file undefined, the
    // inline handler 400s AFTER the rate limiter already counted the
    // request (rate limiter runs first in the chain) — proves the
    // limiter's own threshold without ever reaching real Cloudinary.
    // ════════════════════════════════════════════════════════
    {
      const ownerB = await mkOwner("RATE_B");
      let all400 = true;
      for (let i = 0; i < 10; i++) {
        const res = await fetch(url("/api/salon/kyc/documents/panCard"), {
          method: "POST",
          headers: { Authorization: `Bearer ${ownerB.token}` }, // no body, no file — multer sees nothing
        });
        if (res.status !== 400) all400 = false;
      }
      check("B. 10 document-upload attempts (no file) all reach the handler (400, not 429) — rate limiter passed them through", all400);

      const res11 = await fetch(url("/api/salon/kyc/documents/panCard"), { method: "POST", headers: { Authorization: `Bearer ${ownerB.token}` } });
      check("B. 11th document-upload attempt within the same minute = 429 (blocked before multer)", res11.status === 429);
    }

    // ════════════════════════════════════════════════════════
    // SECTION C — Admin verify-pan rate limit (30/min), INDIA admin,
    // no Idempotency-Key. One shared KYC fixture — verify-pan has no
    // status gate, safe to call repeatedly.
    // ════════════════════════════════════════════════════════
    {
      const ownerC = await mkOwner("RATE_C");
      const kycC = await mkOwnerKYC(ownerC.user._id);
      let all30Ok = true;
      for (let i = 0; i < 30; i++) {
        const r = await authFetch(`/api/admin/kyc/${kycC._id}/verify-pan`, indiaAdmin.token, { method: "PATCH", body: JSON.stringify({ panNumber: "ABCDE1234F", nameOnPAN: "Admin Rate Test" }) });
        if (r.status !== 200) all30Ok = false;
      }
      check("C. 30 admin verify-pan calls within 1 min all succeed (at threshold)", all30Ok);

      const r31 = await authFetch(`/api/admin/kyc/${kycC._id}/verify-pan`, indiaAdmin.token, { method: "PATCH", body: JSON.stringify({ panNumber: "ABCDE1234F", nameOnPAN: "Admin Rate Test" }) });
      check("C. 31st admin verify-pan call within the same minute = 429", r31.status === 429, r31.data);
    }

    // ════════════════════════════════════════════════════════
    // SECTION D — per-user isolation
    // ════════════════════════════════════════════════════════
    {
      // ownerA (Section A) already exhausted its 10/min budget above —
      // a brand-new owner must be completely unaffected.
      const ownerD = await mkOwner("ISOLATION_D");
      const r = await authFetch("/api/salon/kyc/identity", ownerD.token, { method: "POST", body: JSON.stringify({ panNumber: "ABCDE1234F", nameOnPAN: "Isolation Test" }) });
      check("D. A brand-new Owner is NOT affected by another Owner's exhausted rate limit", r.status === 200, r.data);

      // Same for Admin — indiaAdmin (Section C) exhausted its budget on
      // THIS SAME admin identity; a different INDIA admin fixture would
      // need its own user, but INDIA admin is a unique-constraint
      // singleton in this DB (confirmed by existing e2e precedent), so
      // isolation is instead proven using a STATE admin, a completely
      // separate identity, hitting the SAME route+KYC concurrently with
      // the India admin already at its ceiling.
      const stateAdminD = await mkAdmin("ISOLATION_D", "STATE");
      const ownerD2 = await mkOwner("ISOLATION_D2");
      await mkSalonInGeo(ownerD2.user._id, "ISOLATION_D2"); // puts ownerD2 inside stateAdminD's scope
      const kycD2 = await mkOwnerKYC(ownerD2.user._id);
      const r2 = await authFetch(`/api/admin/kyc/${kycD2._id}/verify-pan`, stateAdminD.token, { method: "PATCH", body: JSON.stringify({ panNumber: "ABCDE1234F", nameOnPAN: "Isolation Test" }) });
      check("D. A different Admin identity is NOT affected by the INDIA admin's exhausted rate limit", r2.status === 200, r2.data);
    }

    // ════════════════════════════════════════════════════════
    // SECTION E — RBAC/auth unaffected by the new middleware
    // ════════════════════════════════════════════════════════
    {
      const rNoToken = await authFetch("/api/salon/kyc/identity", null, { method: "POST", body: JSON.stringify({ panNumber: "ABCDE1234F" }) });
      check("E. No token on Owner route = 401 (unaffected)", rNoToken.status === 401, rNoToken.data);

      const faUser = await mkFieldAgentUser("RBAC_E");
      const rWrongRole = await authFetch("/api/salon/kyc/identity", faUser.token, { method: "POST", body: JSON.stringify({ panNumber: "ABCDE1234F" }) });
      check("E. FIELD_AGENT token on Owner-only route = 403 (requireRole still enforced)", rWrongRole.status === 403, rWrongRole.data);

      const ownerE = await mkOwner("RBAC_E");
      const kycE = await mkOwnerKYC(ownerE.user._id);
      const districtAdminE = await mkAdmin("RBAC_E", "DISTRICT");
      const rDistrict = await authFetch(`/api/admin/kyc/${kycE._id}/verify-pan`, districtAdminE.token, { method: "PATCH", body: JSON.stringify({ panNumber: "ABCDE1234F" }) });
      check("E. DISTRICT admin on verify-pan = 403 (requireAdminLevel still enforced)", rDistrict.status === 403, rDistrict.data);
    }

    // ════════════════════════════════════════════════════════
    // SECTION F — idempotency: same payload, different payload, cross-route
    // ════════════════════════════════════════════════════════
    {
      const ownerF = await mkOwner("IDEMP_F");
      const key1 = "p3b-f-" + Date.now();

      const first = await authFetch("/api/salon/kyc/identity", ownerF.token, {
        method: "POST", headers: { "Idempotency-Key": key1 },
        body: JSON.stringify({ panNumber: "ABCDE1234F", nameOnPAN: "Idempotency Test" }),
      });
      check("F. First /identity call with a fresh key succeeds, not cached", first.status === 200 && first.data?.cached !== true, first.data);

      const logsAfterFirst = await VerificationLog.countDocuments({ ownerId: ownerF.user._id, action: "IDENTITY_SUBMITTED" });

      const second = await authFetch("/api/salon/kyc/identity", ownerF.token, {
        method: "POST", headers: { "Idempotency-Key": key1 },
        body: JSON.stringify({ panNumber: "ABCDE1234F", nameOnPAN: "Idempotency Test" }), // SAME payload
      });
      check("F. Same key + SAME payload = cached:true", second.status === 200 && second.data?.cached === true, second.data);

      const logsAfterSecond = await VerificationLog.countDocuments({ ownerId: ownerF.user._id, action: "IDENTITY_SUBMITTED" });
      check("F. Same key + same payload creates NO additional VerificationLog row", logsAfterSecond === logsAfterFirst, { logsAfterFirst, logsAfterSecond });

      const third = await authFetch("/api/salon/kyc/identity", ownerF.token, {
        method: "POST", headers: { "Idempotency-Key": key1 },
        body: JSON.stringify({ panNumber: "ZZZZZ9999Z", nameOnPAN: "Different Payload" }), // DIFFERENT payload, same key
      });
      check("F. Same key + DIFFERENT payload = 409, not a silently-served stale cached response", third.status === 409, third.data);

      // ── Cross-route collision check — same literal key reused on
      // /bank for the SAME owner. Must NOT return /identity's cached
      // response or otherwise collide — route scoping must isolate it. ──
      const bankCall = await authFetch("/api/salon/kyc/bank", ownerF.token, {
        method: "POST", headers: { "Idempotency-Key": key1 }, // SAME literal key value as /identity's
        body: JSON.stringify({ accountHolder: "Idempotency Test", accountNumber: "123456789012", ifsc: "HDFC0001234", bankName: "Test Bank" }),
      });
      check("F. Same literal Idempotency-Key reused on a DIFFERENT route (/bank) succeeds independently, not cross-route-cached", bankCall.status === 200 && bankCall.data?.cached !== true, bankCall.data);
      check("F. The cross-route call's response is actually /bank data, not /identity's", bankCall.data?.data?.bank?.maskedAccount !== undefined, bankCall.data);
    }

    // ════════════════════════════════════════════════════════
    // SECTION G — Field Agent regression: its OWN, unwrapped idempotency
    // usage (fieldAgentKyc.routes.js, untouched by this phase) behaves
    // exactly as it always did — same key -> cached, the ORIGINAL
    // contract, proving this phase introduced zero behavior change there.
    // ════════════════════════════════════════════════════════
    {
      const faUserG = await mkFieldAgentUser("REGRESSION_G");
      const sendOtpRes = await authFetch("/api/field-agent/auth/send-otp", null, { method: "POST", body: JSON.stringify({ phone: faUserG.user.phone }) });
      if (sendOtpRes.status === 200 && sendOtpRes.data?.otp) {
        const verifyOtpRes = await authFetch("/api/field-agent/auth/verify-otp", null, { method: "POST", body: JSON.stringify({ phone: faUserG.user.phone, otp: sendOtpRes.data.otp }) });
        const faToken = verifyOtpRes.data?.accessToken;
        if (faToken) {
          const keyG = "p3b-g-" + Date.now();
          const fa1 = await authFetch("/api/field-agent/kyc/identity", faToken, {
            method: "POST", headers: { "Idempotency-Key": keyG },
            body: JSON.stringify({ panNumber: "ABCDE1234F", nameOnPAN: "FA Regression" }),
          });
          const fa2 = await authFetch("/api/field-agent/kyc/identity", faToken, {
            method: "POST", headers: { "Idempotency-Key": keyG },
            body: JSON.stringify({ panNumber: "ABCDE1234F", nameOnPAN: "FA Regression" }),
          });
          check("G. Field Agent /identity: first call with a fresh key succeeds", fa1.status === 200, fa1.data);
          check("G. Field Agent /identity: same key + same payload = cached:true (original, unmodified contract)", fa2.status === 200 && fa2.data?.cached === true, fa2.data);
        } else {
          rows.push("⚠️  G. Skipped (field-agent auth did not return a usable token in this environment) — not counted as pass or fail");
        }
      } else {
        rows.push("⚠️  G. Skipped (field-agent send-otp unavailable/rate-limited in this environment) — not counted as pass or fail");
      }
    }

  } catch (err) {
    console.error("FATAL:", err);
    fail++;
    rows.push({ n: "FATAL", name: err.message, status: "FAIL" });
  } finally {
    await VerificationLog.deleteMany({ ownerId: { $in: createdIds.users } });
    await KYC.deleteMany({ _id: { $in: createdIds.kycs } });
    await KYC.deleteMany({ ownerId: { $in: createdIds.users } }); // lazily-created KYCs not tracked by id above
    await Salon.deleteMany({ _id: { $in: createdIds.salons } });
    await User.deleteMany({ _id: { $in: createdIds.users } });
    await Area.deleteMany({ _id: { $in: createdIds.areas } });
    await City.deleteMany({ _id: { $in: createdIds.cities } });
    await District.deleteMany({ _id: { $in: createdIds.districts } });
    await State.deleteMany({ _id: { $in: createdIds.states } });
    server.close();
    await mongoose.disconnect();
  }

  console.log(rows.join("\n"));
  console.log(`\nPHASE 3b KYC SECURITY HARDENING: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
