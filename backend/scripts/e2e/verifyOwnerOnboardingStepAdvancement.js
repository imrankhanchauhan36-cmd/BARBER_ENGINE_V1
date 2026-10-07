/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyOwnerOnboardingStepAdvancement.js
 *
 * PHASE 11L — focused live verification for the Owner saveBasicInfo
 * $max fix (controllers/salon.onboarding.controller.js). Real Mongo
 * (Atlas) + real HTTP (app.listen(0)) + real JWT, same proven pattern
 * as every other disposable script in this directory. Every document
 * created here is tracked by exact _id and purged in the `finally`
 * block.
 *
 * Deliberately independent of the Field Agent test suite (per the
 * ticket's own instruction: "Do NOT use the Field Agent tests as
 * proof of Owner correctness") — every call here goes through the
 * real Owner route, /api/salon/onboarding/*, never the Field Agent's
 * /api/field-agent/... routes.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyOwnerOnboardingStepAdvancement.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../../app.js";
import connectDB from "../../config/db.js";
import { generateAccessToken } from "../../services/token.service.js";

import User from "../../models/User.js";
import Salon from "../../models/Salon.js";

import { nextPhone, authFetch as sharedAuthFetch } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 400) : ""}`); }
};

const REAL_LAT = 28.6139, REAL_LNG = 77.2090;

const createdIds = { users: [], salons: [] };

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts) => sharedAuthFetch(url, path, token, opts);
  const onboardingPath = (suffix) => `/api/salon/onboarding${suffix}`;

  const makeOwner = async (label) => {
    const owner = await User.create({ name: `ZE2E_P11L_${label}`, phone: nextPhone("7"), role: "OWNER", accountStatus: "ACTIVE" });
    createdIds.users.push(owner._id);
    const token = generateAccessToken({ _id: owner._id, role: "OWNER", tokenVersion: 0 });
    return { owner, token };
  };

  try {
    // ───────────────────────────────────────────────────────────
    // A — brand-new Owner Salon: first Basic Info call -> step 1.
    // No pre-existing Salon document for this owner at all; the
    // upsert both creates and populates it in one call.
    // ───────────────────────────────────────────────────────────
    const ownerA = await makeOwner("A");
    {
      const res = await authFetch(onboardingPath("/basic-info"), ownerA.token, {
        method: "PATCH", body: JSON.stringify({ shopName: "ZE2E P11L Owner A", category: "UNISEX" }),
      });
      check("A. basic-info -> 200", res.status === 200, res);
      check("A. onboardingStep === 1 on first-ever call", res.data?.data?.onboardingStep === 1, res.data);
      const doc = await Salon.findOne({ ownerId: ownerA.owner._id }).lean();
      createdIds.salons.push(doc._id);
      check("A. persisted onboarding.step === 1", doc?.onboarding?.step === 1, doc?.onboarding);
      check("F. approval.status === DRAFT (existing behavior, unchanged)", doc?.approval?.status === "DRAFT", doc?.approval);
      check("E. basicInfo fields persisted correctly", doc?.basicInfo?.shopName === "ZE2E P11L Owner A" && doc?.basicInfo?.category === "UNISEX", doc?.basicInfo);
    }

    // ───────────────────────────────────────────────────────────
    // B — existing Owner Salon already at step 1: re-save -> stays 1.
    // (ownerA's salon from above is already at step 1.)
    // ───────────────────────────────────────────────────────────
    {
      const res = await authFetch(onboardingPath("/basic-info"), ownerA.token, {
        method: "PATCH", body: JSON.stringify({ shopName: "ZE2E P11L Owner A Renamed", category: "UNISEX" }),
      });
      check("B. repeated basic-info -> 200", res.status === 200, res);
      check("B. onboardingStep stays at 1 (not reset, not double-incremented)", res.data?.data?.onboardingStep === 1, res.data);
      const doc = await Salon.findOne({ ownerId: ownerA.owner._id }).lean();
      check("B. shopName update from the repeat save applied", doc?.basicInfo?.shopName === "ZE2E P11L Owner A Renamed", doc?.basicInfo);
    }

    // ───────────────────────────────────────────────────────────
    // C — existing Owner Salon at step 3: basic-info re-save must
    // NOT decrease it ($max preserves the higher value).
    // ───────────────────────────────────────────────────────────
    const ownerC = await makeOwner("C");
    await authFetch(onboardingPath("/basic-info"), ownerC.token, { method: "PATCH", body: JSON.stringify({ shopName: "ZE2E P11L Owner C", category: "UNISEX" }) });
    await authFetch(onboardingPath("/location"), ownerC.token, { method: "PATCH", body: JSON.stringify({ address: "x", lat: REAL_LAT, lng: REAL_LNG }) });
    await authFetch(onboardingPath("/services"), ownerC.token, { method: "PATCH", body: JSON.stringify({ services: [{ name: "Haircut", price: 200, duration: 30 }] }) });
    {
      const docBefore = await Salon.findOne({ ownerId: ownerC.owner._id }).lean();
      createdIds.salons.push(docBefore._id);
      check("C(setup) Owner C salon reached step 3 via real saves", docBefore?.onboarding?.step === 3, docBefore?.onboarding);
    }
    {
      const res = await authFetch(onboardingPath("/basic-info"), ownerC.token, {
        method: "PATCH", body: JSON.stringify({ shopName: "ZE2E P11L Owner C Edited", category: "UNISEX" }),
      });
      check("C. basic-info re-save on a step-3 salon -> 200", res.status === 200, res);
      check("C. onboardingStep NOT decreased ($max preserves 3, not reset to 1)", res.data?.data?.onboardingStep === 3, res.data);
      const docAfter = await Salon.findOne({ ownerId: ownerC.owner._id }).lean();
      check("C. persisted onboarding.step still 3", docAfter?.onboarding?.step === 3, docAfter?.onboarding);
    }

    // ───────────────────────────────────────────────────────────
    // D / H — THE critical regression case the audit identified: an
    // existing Owner-owned Salon document sitting at onboarding.step
    // = 0 (the exact shape a Field-Agent-assisted salon has for this
    // same owner — [VALID FIXTURE] standing in for that real creation
    // path, same idiom verifyOwnerPhotoUploadFix.js already uses).
    // Because this Salon document ALREADY EXISTS, the Owner route's
    // findOneAndUpdate({ownerId}, ..., {upsert:true}) performs a pure
    // UPDATE here, not an insert — so no schema default ever applies,
    // and the fix must be the thing that actually advances the step.
    // ───────────────────────────────────────────────────────────
    const ownerD = await makeOwner("D");
    const preExistingSalonD = await Salon.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId() },
      { $set: { ownerId: ownerD.owner._id, "onboarding.step": 0, "approval.status": "DRAFT" } },
      { new: true, upsert: true, runValidators: false, setDefaultsOnInsert: false }
    );
    createdIds.salons.push(preExistingSalonD._id);
    {
      const docBefore = await Salon.findById(preExistingSalonD._id).lean();
      check("D(setup) pre-existing salon starts at onboarding.step = 0", docBefore?.onboarding?.step === 0, docBefore?.onboarding);
    }
    {
      const res = await authFetch(onboardingPath("/basic-info"), ownerD.token, {
        method: "PATCH", body: JSON.stringify({ shopName: "ZE2E P11L Owner D (ex-Field-Agent salon)", category: "UNISEX" }),
      });
      check("D/H. basic-info -> 200", res.status === 200, res);
      check("D/H. CRITICAL: response.data.onboardingStep === 1 (Phase 11L fix — was stuck at 0 before)", res.data?.data?.onboardingStep === 1, res.data);
      const docAfter = await Salon.findById(preExistingSalonD._id).lean();
      check("D/H. persisted onboarding.step === 1", docAfter?.onboarding?.step === 1, docAfter?.onboarding);
      check("D/H. same salonId throughout (no new document created)", String(docAfter?._id) === String(preExistingSalonD._id), { before: preExistingSalonD._id, after: docAfter?._id });
      check("E. basicInfo fields persisted correctly on this path too", docAfter?.basicInfo?.shopName === "ZE2E P11L Owner D (ex-Field-Agent salon)", docAfter?.basicInfo);
      check("F. approval.status === DRAFT on this path too", docAfter?.approval?.status === "DRAFT", docAfter?.approval);
    }

    // ───────────────────────────────────────────────────────────
    // G — Owner authentication/isolation remains unchanged.
    // ───────────────────────────────────────────────────────────
    {
      const resNoToken = await authFetch(onboardingPath("/basic-info"), null, { method: "PATCH", body: JSON.stringify({ shopName: "x", category: "UNISEX" }) });
      check("G. no token -> 401", resNoToken.status === 401, resNoToken);

      // Owner A must never be able to affect Owner C's salon — the
      // route is keyed purely by the authenticated caller's own
      // ownerId, never a client-supplied salonId.
      await authFetch(onboardingPath("/basic-info"), ownerA.token, { method: "PATCH", body: JSON.stringify({ shopName: "ZE2E P11L Owner A Again", category: "UNISEX" }) });
      const ownerCSalonAfter = await Salon.findOne({ ownerId: ownerC.owner._id }).lean();
      check("G. Owner A's own save never touched Owner C's salon (shopName unaffected)", ownerCSalonAfter?.basicInfo?.shopName === "ZE2E P11L Owner C Edited", ownerCSalonAfter?.basicInfo);
    }

  } finally {
    // ═══════════════════════════════════════════════════════════
    // CLEANUP — exact _id only.
    // ═══════════════════════════════════════════════════════════
    await Salon.deleteMany({ _id: { $in: createdIds.salons.filter(Boolean) } });
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
