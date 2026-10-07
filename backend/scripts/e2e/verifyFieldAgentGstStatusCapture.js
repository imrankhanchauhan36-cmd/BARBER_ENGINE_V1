/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFieldAgentGstStatusCapture.js
 *
 * SALON GST — Field Agent live HTTP verification. Real Mongo Atlas,
 * real HTTP via app.listen(0), real signed JWT for an isolated
 * ACTIVE Field Agent fixture (makeActiveFieldAgent — no OTP rate-limit
 * risk, no real SMS). The salon itself is created via the real
 * production send-otp -> start assisted-onboarding flow (same pattern
 * as verifyFieldAgentOnboardingStepAdvancement.js), using a unique
 * test phone number so it cannot collide with or touch any real
 * salon/owner.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyFieldAgentGstStatusCapture.js
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
import AcquisitionClaim from "../../modules/fieldAgent/models/AcquisitionClaim.js";
import AcquisitionReferral from "../../modules/fieldAgent/models/AcquisitionReferral.js";

import { nextPhone, makeActiveFieldAgent, authFetch as sharedAuthFetch } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 400) : ""}`); }
};

const createdIds = { users: [], applications: [], fieldAgents: [], salons: [], referrals: [], claims: [] };

const BASIC_INFO_PAYLOAD = (shopName, gstStatus) => ({
  shopName, category: "UNISEX", tagline: "Test", brandName: null, branchCode: null,
  since: 2020, experience: "3_TO_5", tier: "STANDARD", setupType: "PROPER_SHOP", privacySetup: "MIXED",
  gstStatus,
  amenities: { hasAC: true, hasParking: false, hasWifi: true, waitingArea: false, restroom: false },
});

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts) => sharedAuthFetch(url, path, token, opts);
  const onboardingPath = (salonId, suffix) => `/api/field-agent/acquisition/applications/${salonId}/onboarding${suffix}`;

  try {
    const fa = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "GSTCAP");
    createdIds.users.push(fa.agentUser._id);
    createdIds.applications.push(fa.application._id);
    createdIds.fieldAgents.push(fa.fieldAgent._id);
    const faToken = fa.token;

    // Real production create path, isolated test phone, fixed test
    // OTP "123456" (same convention every other script in this
    // directory uses — not a real SMS).
    const ownerPhone = nextPhone("9");
    await authFetch("/api/field-agent/acquisition/assisted-onboarding/send-otp", faToken, { method: "POST", body: JSON.stringify({ phone: ownerPhone }) });
    const startRes = await authFetch("/api/field-agent/acquisition/assisted-onboarding/start", faToken, { method: "POST", body: JSON.stringify({ phone: ownerPhone, otp: "123456" }) });
    const salonId = startRes.data?.data?.salonId;
    const claimId = startRes.data?.data?.acquisitionClaim?.id;
    check("setup. Assisted onboarding start succeeds, returns a salonId", startRes.status === 201 && !!salonId, startRes.data);
    if (salonId) createdIds.salons.push(salonId);
    if (claimId) {
      createdIds.claims.push(claimId);
      const claimDoc = await AcquisitionClaim.findById(claimId).lean();
      if (claimDoc?.referralRef) createdIds.referrals.push(claimDoc.referralRef);
    }

    // ── 1. Save Basic Info with gstStatus=REGISTERED ──
    const saveRegistered = await authFetch(onboardingPath(salonId, "/basic-info"), faToken, {
      method: "PATCH", body: JSON.stringify(BASIC_INFO_PAYLOAD(`${fa.agentUser.name}_SALON`, "REGISTERED")),
    });
    check("1. basic-info save with gstStatus=REGISTERED -> 200", saveRegistered.status === 200, saveRegistered.data);
    check("2. HTTP response echoes basicInfo.gstStatus=REGISTERED", saveRegistered.data?.data?.basicInfo?.gstStatus === "REGISTERED", saveRegistered.data?.data?.basicInfo);

    const salonAfterRegistered = await Salon.findById(salonId).select("basicInfo.gstStatus onboarding.step").lean();
    check("3. Persisted Salon.basicInfo.gstStatus === REGISTERED", salonAfterRegistered?.basicInfo?.gstStatus === "REGISTERED", salonAfterRegistered);

    const reviewAfterRegistered = await authFetch(onboardingPath(salonId, "/review"), faToken, { method: "GET" });
    check("4. Review endpoint returns salon.basicInfo.gstStatus=REGISTERED", reviewAfterRegistered.status === 200 && reviewAfterRegistered.data?.data?.salon?.basicInfo?.gstStatus === "REGISTERED", reviewAfterRegistered.data?.data?.salon?.basicInfo);

    check("5. onboarding.step advanced to 1 (unaffected by the new field)", salonAfterRegistered?.onboarding?.step === 1, salonAfterRegistered?.onboarding);

    // ── 6. Re-save with gstStatus=UNREGISTERED — confirm it also persists ──
    const saveUnregistered = await authFetch(onboardingPath(salonId, "/basic-info"), faToken, {
      method: "PATCH", body: JSON.stringify(BASIC_INFO_PAYLOAD(`${fa.agentUser.name}_SALON`, "UNREGISTERED")),
    });
    check("6. basic-info re-save with gstStatus=UNREGISTERED -> 200", saveUnregistered.status === 200, saveUnregistered.data);
    check("7. HTTP response echoes basicInfo.gstStatus=UNREGISTERED", saveUnregistered.data?.data?.basicInfo?.gstStatus === "UNREGISTERED", saveUnregistered.data?.data?.basicInfo);

    const salonAfterUnregistered = await Salon.findById(salonId).select("basicInfo.gstStatus onboarding.step").lean();
    check("8. Persisted Salon.basicInfo.gstStatus === UNREGISTERED", salonAfterUnregistered?.basicInfo?.gstStatus === "UNREGISTERED", salonAfterUnregistered);
    check("9. onboarding.step still correctly 1 on repeat save (not reset, not double-incremented)", salonAfterUnregistered?.onboarding?.step === 1, salonAfterUnregistered?.onboarding);

    // ── 10. Approval status unaffected / unchanged behavior (still DRAFT, existing pre-existing behavior) ──
    const salonApproval = await Salon.findById(salonId).select("approval.status").lean();
    check("10. approval.status === DRAFT (existing saveBasicInfo behavior, unchanged by the GST field)", salonApproval?.approval?.status === "DRAFT", salonApproval);

    // ── CLEANUP — only this script's own tracked fixtures ──
    await Salon.deleteMany({ _id: { $in: createdIds.salons.filter(Boolean) } });
    await AcquisitionClaim.deleteMany({ _id: { $in: createdIds.claims.filter(Boolean) } });
    await AcquisitionReferral.deleteMany({ _id: { $in: createdIds.referrals.filter(Boolean) } });
    await FieldAgent.deleteMany({ _id: { $in: createdIds.fieldAgents.filter(Boolean) } });
    await FieldAgentApplication.deleteMany({ _id: { $in: createdIds.applications.filter(Boolean) } });
    await User.deleteMany({ _id: { $in: createdIds.users.filter(Boolean) } });

    const residue = {
      salons: await Salon.countDocuments({ _id: { $in: createdIds.salons.filter(Boolean) } }),
      claims: await AcquisitionClaim.countDocuments({ _id: { $in: createdIds.claims.filter(Boolean) } }),
      referrals: await AcquisitionReferral.countDocuments({ _id: { $in: createdIds.referrals.filter(Boolean) } }),
      fieldAgents: await FieldAgent.countDocuments({ _id: { $in: createdIds.fieldAgents.filter(Boolean) } }),
      applications: await FieldAgentApplication.countDocuments({ _id: { $in: createdIds.applications.filter(Boolean) } }),
      users: await User.countDocuments({ _id: { $in: createdIds.users.filter(Boolean) } }),
    };
    check("CLEANUP. Zero residue across all fixture collections", Object.values(residue).every((v) => v === 0), residue);
  } catch (err) {
    console.error("FATAL ERROR DURING FIELD AGENT GST STATUS CAPTURE E2E:", err);
    fail++;
    results.push(`❌ FATAL: ${err.message}`);
    try {
      await Salon.deleteMany({ _id: { $in: createdIds.salons.filter(Boolean) } });
      await AcquisitionClaim.deleteMany({ _id: { $in: createdIds.claims.filter(Boolean) } });
      await AcquisitionReferral.deleteMany({ _id: { $in: createdIds.referrals.filter(Boolean) } });
      await FieldAgent.deleteMany({ _id: { $in: createdIds.fieldAgents.filter(Boolean) } });
      await FieldAgentApplication.deleteMany({ _id: { $in: createdIds.applications.filter(Boolean) } });
      await User.deleteMany({ _id: { $in: createdIds.users.filter(Boolean) } });
      results.push("✅ Best-effort cleanup after failure completed (own fixtures only)");
    } catch (cleanupErr) {
      results.push(`❌ Best-effort cleanup ALSO failed: ${cleanupErr.message}`);
    }
  } finally {
    server.close();
    await mongoose.connection.close();
  }

  console.log("\n" + results.join("\n"));
  console.log(`\nFIELD-AGENT-GST-STATUS-CAPTURE-E2E: ${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail === 0 ? 0 : 1);
};

run();
