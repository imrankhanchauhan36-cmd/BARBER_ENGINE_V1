/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFieldAgentOnboardingStepAdvancement.js
 *
 * PHASE 11K — focused live verification for the saveBasicInfo $max fix
 * (fieldAgentOnboarding.service.js). Real Mongo (Atlas) + real HTTP
 * (app.listen(0)) + real JWT, same proven pattern as every other
 * disposable script in this directory. Every document created here is
 * tracked by exact _id and purged in the `finally` block.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyFieldAgentOnboardingStepAdvancement.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../../app.js";
import connectDB from "../../config/db.js";
import { generateAccessToken } from "../../services/token.service.js";

import User from "../../models/User.js";
import Salon from "../../models/Salon.js";
import FieldAgentApplication from "../../modules/fieldAgent/models/FieldAgentApplication.js";
import FieldAgent from "../../modules/fieldAgent/models/FieldAgent.js";
import AcquisitionReferral from "../../modules/fieldAgent/models/AcquisitionReferral.js";
import AcquisitionClaim from "../../modules/fieldAgent/models/AcquisitionClaim.js";

import { nextPhone, makeActiveFieldAgent, authFetch as sharedAuthFetch } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 400) : ""}`); }
};

const REAL_LAT = 28.6139, REAL_LNG = 77.2090; // New Delhi — same fixed point other scripts use.

const BASIC_INFO_PAYLOAD = (shopName) => ({
  shopName, category: "UNISEX", tagline: "Test", brandName: null, branchCode: null,
  since: 2020, experience: "3_TO_5", tier: "STANDARD", setupType: "PROPER_SHOP", privacySetup: "MIXED",
  amenities: { hasAC: true, hasParking: false, hasWifi: true, waitingArea: false, restroom: false },
});

const createdIds = { users: [], applications: [], fieldAgents: [], salons: [], referrals: [], claims: [] };

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts) => sharedAuthFetch(url, path, token, opts);
  const onboardingPath = (salonId, suffix) => `/api/field-agent/acquisition/applications/${salonId}/onboarding${suffix}`;

  try {
    // ═══════════════════════════════════════════════════════════
    // FIXTURES — one ACTIVE Field Agent (used for A-E,G,H) + one
    // independent second agent (used for F, isolation).
    // ═══════════════════════════════════════════════════════════
    const fa = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "P11K_A");
    createdIds.users.push(fa.agentUser._id);
    createdIds.applications.push(fa.application._id);
    createdIds.fieldAgents.push(fa.fieldAgent._id);
    const faToken = fa.token;

    const faB = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "P11K_B");
    createdIds.users.push(faB.agentUser._id);
    createdIds.applications.push(faB.application._id);
    createdIds.fieldAgents.push(faB.fieldAgent._id);
    const faBToken = faB.token;

    // Real production create path: send-otp -> start (CASE A, brand
    // new owner phone, no existing salons) — same as every other
    // disposable script in this directory, not a shortcut fixture.
    const startSalon = async (ownerPhone) => {
      await authFetch("/api/field-agent/acquisition/assisted-onboarding/send-otp", faToken, {
        method: "POST", body: JSON.stringify({ phone: ownerPhone }),
      });
      const startRes = await authFetch("/api/field-agent/acquisition/assisted-onboarding/start", faToken, {
        method: "POST", body: JSON.stringify({ phone: ownerPhone, otp: "123456" }),
      });
      const salonId = startRes.data?.data?.salonId;
      const claimId = startRes.data?.data?.acquisitionClaim?.id;
      createdIds.salons.push(salonId);
      createdIds.claims.push(claimId);
      const claimDoc = await AcquisitionClaim.findById(claimId).lean();
      if (claimDoc?.referralRef) createdIds.referrals.push(claimDoc.referralRef);
      return { startRes, salonId, claimId };
    };

    // ───────────────────────────────────────────────────────────
    // A — new salon starts at onboarding.step = 0
    // ───────────────────────────────────────────────────────────
    const { salonId: salon1 } = await startSalon(nextPhone("7"));
    {
      const doc = await Salon.findById(salon1).lean();
      check("A. New salon starts at onboarding.step = 0", doc?.onboarding?.step === 0, doc?.onboarding);
      check("A. New salon approval.status = DRAFT", doc?.approval?.status === "DRAFT", doc?.approval);
    }

    // ───────────────────────────────────────────────────────────
    // B — Basic Info save -> step becomes 1
    // ───────────────────────────────────────────────────────────
    const claim1Before = await AcquisitionClaim.findById(createdIds.claims[createdIds.claims.length - 1]).lean();
    {
      const res = await authFetch(onboardingPath(salon1, "/basic-info"), faToken, {
        method: "PATCH", body: JSON.stringify(BASIC_INFO_PAYLOAD("ZE2E P11K Salon 1")),
      });
      check("B. basic-info save -> 200", res.status === 200, res);
      check("B. response reports onboardingStep === 1", res.data?.data?.onboardingStep === 1, res.data);
      const doc = await Salon.findById(salon1).lean();
      check("B. persisted onboarding.step === 1", doc?.onboarding?.step === 1, doc?.onboarding);
      check("B. shopName persisted exactly as before (unrelated fields unaffected)", doc?.basicInfo?.shopName === "ZE2E P11K Salon 1", doc?.basicInfo);
      check("H. approval.status still DRAFT (existing behavior, unchanged)", doc?.approval?.status === "DRAFT", doc?.approval);
    }

    // ───────────────────────────────────────────────────────────
    // C — repeated Basic Info save while already at step 1 -> stays 1
    // ───────────────────────────────────────────────────────────
    {
      const res = await authFetch(onboardingPath(salon1, "/basic-info"), faToken, {
        method: "PATCH", body: JSON.stringify(BASIC_INFO_PAYLOAD("ZE2E P11K Salon 1 Renamed")),
      });
      check("C. repeated basic-info save -> 200", res.status === 200, res);
      check("C. onboardingStep remains 1 (not reset, not double-incremented)", res.data?.data?.onboardingStep === 1, res.data);
      const doc = await Salon.findById(salon1).lean();
      check("C. persisted onboarding.step still 1", doc?.onboarding?.step === 1, doc?.onboarding);
      check("C. shopName update from the repeat save still applied", doc?.basicInfo?.shopName === "ZE2E P11K Salon 1 Renamed", doc?.basicInfo);
    }

    // ───────────────────────────────────────────────────────────
    // D — higher-step preservation: a salon already at step 3 must
    // NOT be decreased by a later Basic Info save ($max, not $set).
    // ───────────────────────────────────────────────────────────
    const { salonId: salon2 } = await startSalon(nextPhone("7"));
    await authFetch(onboardingPath(salon2, "/basic-info"), faToken, { method: "PATCH", body: JSON.stringify(BASIC_INFO_PAYLOAD("ZE2E P11K Salon 2")) });
    await authFetch(onboardingPath(salon2, "/location"), faToken, {
      method: "PATCH", body: JSON.stringify({ address: "Test address", lat: REAL_LAT, lng: REAL_LNG }),
    });
    const servicesRes = await authFetch(onboardingPath(salon2, "/services"), faToken, {
      method: "PATCH", body: JSON.stringify({ services: [{ name: "Haircut", price: 100, duration: 30, category: "HAIRCUT", applicableFor: "MEN" }] }),
    });
    {
      const docBefore = await Salon.findById(salon2).lean();
      check("D(setup) salon2 reached step 3 via real saves", docBefore?.onboarding?.step === 3, { servicesRes: servicesRes.status, step: docBefore?.onboarding });
    }
    {
      const res = await authFetch(onboardingPath(salon2, "/basic-info"), faToken, {
        method: "PATCH", body: JSON.stringify(BASIC_INFO_PAYLOAD("ZE2E P11K Salon 2 Edited")),
      });
      check("D. basic-info re-save on a step-3 salon -> 200", res.status === 200, res);
      check("D. onboardingStep NOT decreased ($max preserves 3, not reset to 1)", res.data?.data?.onboardingStep === 3, res.data);
      const docAfter = await Salon.findById(salon2).lean();
      check("D. persisted onboarding.step still 3", docAfter?.onboarding?.step === 3, docAfter?.onboarding);
    }

    // ───────────────────────────────────────────────────────────
    // E — Phase 11J My Applications visibility now reflects the
    // fixed step advancement correctly.
    // ───────────────────────────────────────────────────────────
    const { salonId: salon3 } = await startSalon(nextPhone("7")); // left untouched at step 0
    {
      const res = await authFetch("/api/field-agent/acquisition/applications?limit=50", faToken, { method: "GET" });
      const apps = res.data?.data?.applications || [];
      const bySalonId = new Map(apps.map((a) => [String(a.salonId), a]));
      check("E. step-0 salon (never touched) is NOT returned by My Applications", !bySalonId.has(String(salon3)), apps.map((a) => a.salonId));
      check("E. step-1 salon (basic-info saved) IS returned by My Applications", bySalonId.has(String(salon1)), apps.map((a) => a.salonId));
      check("E. its onboardingStep is correctly reported as 1", bySalonId.get(String(salon1))?.onboardingStep === 1, bySalonId.get(String(salon1)));
    }

    // ───────────────────────────────────────────────────────────
    // F — Field Agent isolation remains intact under this fix.
    // ───────────────────────────────────────────────────────────
    {
      const resB = await authFetch("/api/field-agent/acquisition/applications?limit=50", faBToken, { method: "GET" });
      const appsB = resB.data?.data?.applications || [];
      check("F. a different Field Agent sees NONE of these salons", !appsB.some((a) => [salon1, salon2, salon3].some((s) => String(a.salonId) === String(s))), appsB);
    }

    // ───────────────────────────────────────────────────────────
    // G — no AcquisitionClaim mutation from any basic-info save.
    // ───────────────────────────────────────────────────────────
    {
      const claim1After = await AcquisitionClaim.findById(claim1Before._id).lean();
      check("G. AcquisitionClaim.status unchanged by basic-info saves", claim1After?.status === claim1Before?.status, { before: claim1Before?.status, after: claim1After?.status });
      check("G. AcquisitionClaim.salonRef unchanged", String(claim1After?.salonRef) === String(claim1Before?.salonRef), claim1After);
      check("G. AcquisitionClaim.updatedAt unchanged (claim never touched)", new Date(claim1After?.updatedAt).getTime() === new Date(claim1Before?.updatedAt).getTime(), { before: claim1Before?.updatedAt, after: claim1After?.updatedAt });
    }

  } finally {
    // ═══════════════════════════════════════════════════════════
    // CLEANUP — exact _id only.
    // ═══════════════════════════════════════════════════════════
    await AcquisitionClaim.deleteMany({ _id: { $in: createdIds.claims.filter(Boolean) } });
    await AcquisitionReferral.deleteMany({ _id: { $in: createdIds.referrals.filter(Boolean) } });
    await Salon.deleteMany({ _id: { $in: createdIds.salons.filter(Boolean) } });
    await FieldAgent.deleteMany({ _id: { $in: createdIds.fieldAgents } });
    await FieldAgentApplication.deleteMany({ _id: { $in: createdIds.applications } });
    await User.deleteMany({ _id: { $in: createdIds.users } });

    console.log("\n" + results.join("\n"));
    console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total\n`);

    server.close();
    await mongoose.connection.close();
    process.exit(fail > 0 ? 1 : 0);
  }
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
