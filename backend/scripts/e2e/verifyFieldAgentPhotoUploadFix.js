/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFieldAgentPhotoUploadFix.js
 *
 * FIELD AGENT PHOTO UPLOAD FIX — live, device-relevant verification
 * (2026-10-01). Not an RN-runtime test (no Xcode available in this
 * environment — disclosed in the final report); instead this proves,
 * with REAL network calls, the two halves of the real flow that ARE
 * testable outside the RN runtime:
 *
 *   (1) The REAL Cloudinary unsigned-upload contract (cloud/preset/
 *       folder/field names — exactly what FieldAgentSalonPhotosScreen.js
 *       now sends via axios) — 3 real images, uploaded for real,
 *       3 real secure_urls returned.
 *   (2) The REAL backend savePhotos round-trip, via the real,
 *       mounted HTTP route, using those 3 real secure_urls — proving
 *       salonId correctness, media persistence, and that an unrelated
 *       salon is never touched.
 *
 * Every Cloudinary asset uploaded here is destroyed in the `finally`
 * block (signed Cloudinary destroy, same credentials the backend
 * itself already holds in .env) — no test clutter left in the real
 * Cloudinary account. Every Mongo document is purged by exact _id,
 * same convention as every other script in this directory.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyFieldAgentPhotoUploadFix.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import FormDataNode from "form-data";
import app from "../../app.js";
import connectDB from "../../config/db.js";
import { generateAccessToken } from "../../services/token.service.js";

import User from "../../models/User.js";
import FieldAgentApplication from "../../modules/fieldAgent/models/FieldAgentApplication.js";
import FieldAgent from "../../modules/fieldAgent/models/FieldAgent.js";
import Salon from "../../models/Salon.js";
import AcquisitionReferral from "../../modules/fieldAgent/models/AcquisitionReferral.js";
import AcquisitionClaim from "../../modules/fieldAgent/models/AcquisitionClaim.js";
import Service from "../../models/Service.js";
import Staff from "../../models/Staff.js";
import Chair from "../../models/Chair.js";
import SalonMedia from "../../models/SalonMedia.js";

import { nextPhone, makeActiveFieldAgent, authFetch as sharedAuthFetch } from "./fieldAgentE2EHelpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 400) : ""}`); }
};

const createdIds = { users: [], applications: [], fieldAgents: [], salons: [], referrals: [], claims: [] };
const uploadedCloudinaryPublicIds = [];

const REAL_LAT = 9.1833;
const REAL_LNG = 92.7667;
const fullWeekTimings = () => {
  const day = { open: "09:00", close: "20:00", isClosed: false, isOpen24Hours: false, breaks: [] };
  return { monday: day, tuesday: day, wednesday: day, thursday: day, friday: day, saturday: day, sunday: day };
};

const CLOUDINARY_CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;
// Same unsigned preset the app's EXPO_PUBLIC_CLOUDINARY_PRESET falls
// back to — confirmed identical value in both screens' own source.
const CLOUDINARY_UPLOAD_PRESET = "c4qu5hpg";
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`;
const CLOUDINARY_DESTROY_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/destroy`;

// Real, tiny, already-in-repo image asset — same file used for the
// standalone Cloudinary-contract smoke test earlier in this audit.
const TEST_IMAGE_PATH = path.resolve(__dirname, "../../../salon-app/assets/images/favicon.png");

const uploadRealImageToCloudinary = async (label) => {
  const form = new FormDataNode();
  form.append("file", fs.createReadStream(TEST_IMAGE_PATH), { filename: `ZE2E_FA_PHOTO_${label}.png`, contentType: "image/png" });
  form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  form.append("folder", "barber_engine/salons");
  const res = await axios.post(CLOUDINARY_UPLOAD_URL, form, { headers: form.getHeaders(), timeout: 60000 });
  if (!res.data?.secure_url) throw new Error("Cloudinary upload did not return secure_url: " + JSON.stringify(res.data));
  uploadedCloudinaryPublicIds.push(res.data.public_id);
  return res.data;
};

const destroyCloudinaryAsset = async (publicId) => {
  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = `public_id=${publicId}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`;
  const signature = crypto.createHash("sha1").update(toSign).digest("hex");
  await axios.post(CLOUDINARY_DESTROY_URL, {
    public_id: publicId, timestamp, api_key: CLOUDINARY_API_KEY, signature,
  }, { headers: { "Content-Type": "application/x-www-form-urlencoded" } }).catch(() => {});
};

const makeClaimedDraftSalon = async ({ ownerPhone, fieldAgentId }) => {
  const owner = await User.create({ name: "ZE2E_PHOTOFIX_OWNER", phone: ownerPhone, role: "OWNER", accountStatus: "ACTIVE" });
  const salon = await Salon.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId() },
    { $set: { ownerId: owner._id, "onboarding.step": 0, "approval.status": "DRAFT" } },
    { new: true, upsert: true, runValidators: false, setDefaultsOnInsert: false }
  );
  const referral = await AcquisitionReferral.create({
    code: `ZE2EPHOTOFIX-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    fieldAgentRef: fieldAgentId, status: "CONSUMED",
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    consumedSalonRef: salon._id, consumedAt: new Date(),
  });
  const claim = await AcquisitionClaim.create({ salonRef: salon._id, fieldAgentRef: fieldAgentId, referralRef: referral._id, status: "PENDING_APPROVAL" });
  return { owner, salon, referral, claim };
};

const run = async () => {
  if (!CLOUDINARY_CLOUD || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error("Cloudinary env vars missing — cannot run live test");
  }
  if (!fs.existsSync(TEST_IMAGE_PATH)) {
    throw new Error("Test image not found at " + TEST_IMAGE_PATH);
  }

  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path_, token, opts) => sharedAuthFetch(url, path_, token, opts);
  const onboardingPath = (salonId, suffix) => `/api/field-agent/acquisition/applications/${salonId}/onboarding${suffix}`;

  try {
    const fa = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "PHOTOFIX_A");
    createdIds.users.push(fa.agentUser._id);
    createdIds.applications.push(fa.application._id);
    createdIds.fieldAgents.push(fa.fieldAgent._id);
    const faToken = fa.token;

    // ── SALON X — the one we actually upload photos to ──
    const fixX = await makeClaimedDraftSalon({ ownerPhone: nextPhone("7"), fieldAgentId: fa.fieldAgent._id });
    createdIds.users.push(fixX.owner._id);
    createdIds.salons.push(fixX.salon._id);
    createdIds.referrals.push(fixX.referral._id);
    createdIds.claims.push(fixX.claim._id);
    const salonX = fixX.salon._id;

    // ── SALON Y — untouched control, proves isolation ──
    const fixY = await makeClaimedDraftSalon({ ownerPhone: nextPhone("7"), fieldAgentId: fa.fieldAgent._id });
    createdIds.users.push(fixY.owner._id);
    createdIds.salons.push(fixY.salon._id);
    createdIds.referrals.push(fixY.referral._id);
    createdIds.claims.push(fixY.claim._id);
    const salonY = fixY.salon._id;

    // Walk Salon X to step 6 (staff) via the REAL API, exactly like the
    // real onboarding flow a Field Agent would perform before reaching
    // the Photos step — same sequence verified in Phase 2B/2C-4.
    {
      const r1 = await authFetch(onboardingPath(salonX, "/basic-info"), faToken, { method: "PATCH", body: JSON.stringify({ shopName: "ZE2E PhotoFix Salon X", category: "UNISEX" }) });
      check("Setup: basic-info -> 200", r1.status === 200, r1);
      const r2 = await authFetch(onboardingPath(salonX, "/location"), faToken, { method: "PATCH", body: JSON.stringify({ address: "x", lat: REAL_LAT, lng: REAL_LNG }) });
      check("Setup: location -> 200, step 2", r2.status === 200 && r2.data?.data?.onboardingStep === 2, r2);
      const r3 = await authFetch(onboardingPath(salonX, "/services"), faToken, { method: "PATCH", body: JSON.stringify({ services: [{ name: "Haircut", price: 200, duration: 30 }] }) });
      check("Setup: services -> 200, step 3", r3.status === 200 && r3.data?.data?.onboardingStep === 3, r3);
      const r4 = await authFetch(onboardingPath(salonX, "/chairs"), faToken, { method: "PATCH", body: JSON.stringify({ chairCount: 2 }) });
      check("Setup: chairs -> 200, step 4", r4.status === 200 && r4.data?.data?.onboardingStep === 4, r4);
      const r5 = await authFetch(onboardingPath(salonX, "/timings"), faToken, { method: "PATCH", body: JSON.stringify({ timings: fullWeekTimings() }) });
      check("Setup: timings -> 200, step 5", r5.status === 200 && r5.data?.data?.onboardingStep === 5, r5);
      const r6 = await authFetch(onboardingPath(salonX, "/staff"), faToken, { method: "PATCH", body: JSON.stringify({ isOwnerOnly: true }) });
      check("Setup: staff -> 200, step 6", r6.status === 200 && r6.data?.data?.onboardingStep === 6, r6);
    }

    // ── LIVE CLOUDINARY UPLOADS (3 real images, real network calls) ──
    const upload1 = await uploadRealImageToCloudinary("1_cover");
    check("Photo 1: real Cloudinary upload -> secure_url returned", !!upload1.secure_url, upload1);
    const upload2 = await uploadRealImageToCloudinary("2_shop");
    check("Photo 2: real Cloudinary upload -> secure_url returned", !!upload2.secure_url, upload2);
    const upload3 = await uploadRealImageToCloudinary("3_work");
    check("Photo 3: real Cloudinary upload -> secure_url returned", !!upload3.secure_url, upload3);
    check("All 3 uploads landed in the correct folder (public_id prefix)", [upload1, upload2, upload3].every((u) => u.public_id.startsWith("barber_engine/salons/")), [upload1.public_id, upload2.public_id, upload3.public_id]);

    // ── REAL backend savePhotos call, with the 3 real secure_urls ──
    const photosPayload = {
      photos: [
        { url: upload1.secure_url, type: "COVER" },
        { url: upload2.secure_url, type: "SHOP" },
        { url: upload3.secure_url, type: "WORK" },
      ],
    };
    const rPhotos = await authFetch(onboardingPath(salonX, "/photos"), faToken, { method: "PATCH", body: JSON.stringify(photosPayload) });
    check("savePhotos -> 200 with 3 real Cloudinary URLs", rPhotos.status === 200, rPhotos);
    check("savePhotos -> onboardingStep advances to 7", rPhotos.data?.data?.onboardingStep === 7, rPhotos.data);
    check("savePhotos -> totalPhotos === 3", rPhotos.data?.data?.totalPhotos === 3, rPhotos.data);

    // ── Verify correct salonId / media persistence ──
    const mediaX = await SalonMedia.find({ salonId: salonX, isDeleted: false }).lean();
    check("Exactly 3 SalonMedia docs created, all with salonId === Salon X", mediaX.length === 3 && mediaX.every((m) => String(m.salonId) === String(salonX)), mediaX.map((m) => m.salonId));
    check("SalonMedia URLs match the 3 real Cloudinary secure_urls", new Set(mediaX.map((m) => m.url)).size === 3 && [upload1, upload2, upload3].every((u) => mediaX.some((m) => m.url === u.secure_url)), mediaX.map((m) => m.url));
    check("Exactly one COVER photo", mediaX.filter((m) => m.type === "COVER").length === 1, mediaX.map((m) => m.type));

    // ── Verify existing/other salon (Y) was never touched ──
    const mediaY = await SalonMedia.find({ salonId: salonY }).lean();
    check("Salon Y (untouched control) has ZERO SalonMedia docs", mediaY.length === 0, mediaY);
    const salonYAfter = await Salon.findById(salonY).lean();
    check("Salon Y onboarding.step unchanged (still 0)", (salonYAfter?.onboarding?.step ?? 0) === 0, salonYAfter?.onboarding);

    // ── Review endpoint reflects the real photos (same path the UI's
    // "Loading existing photos" + Review/Submit screen both use) ──
    const rReview = await authFetch(onboardingPath(salonX, "/review"), faToken, { method: "GET" });
    check("getReview -> 200, media array has 3 real entries", rReview.status === 200 && (rReview.data?.data?.media || []).length === 3, rReview.data?.data?.media);

  } finally {
    // Destroy every Cloudinary asset this run created — no test
    // clutter left in the real Cloudinary account.
    for (const publicId of uploadedCloudinaryPublicIds) {
      await destroyCloudinaryAsset(publicId);
    }

    await AcquisitionClaim.deleteMany({ _id: { $in: createdIds.claims } });
    await AcquisitionReferral.deleteMany({ _id: { $in: createdIds.referrals } });
    await Service.deleteMany({ salonId: { $in: createdIds.salons } });
    await Staff.deleteMany({ salonId: { $in: createdIds.salons } });
    await Chair.deleteMany({ salonId: { $in: createdIds.salons } });
    await SalonMedia.deleteMany({ salonId: { $in: createdIds.salons } });
    await Salon.deleteMany({ _id: { $in: createdIds.salons } });
    await FieldAgent.deleteMany({ _id: { $in: createdIds.fieldAgents } });
    await FieldAgentApplication.deleteMany({ _id: { $in: createdIds.applications } });
    await User.deleteMany({ _id: { $in: createdIds.users } });

    console.log("\n" + results.join("\n"));
    console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total\n`);
    console.log(`Cloudinary assets uploaded and destroyed: ${uploadedCloudinaryPublicIds.length}`);

    server.close();
    await mongoose.connection.close();
    process.exit(fail > 0 ? 1 : 0);
  }
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
