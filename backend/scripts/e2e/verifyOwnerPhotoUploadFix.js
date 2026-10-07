/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyOwnerPhotoUploadFix.js
 *
 * OWNER PHOTO UPLOAD FIX — live, device-relevant verification
 * (2026-10-01), mirroring verifyFieldAgentPhotoUploadFix.js exactly,
 * but against the REAL, frozen Owner route (`protect` +
 * requireRole("OWNER"), `Salon.findOne({ownerId})` resolution — never
 * salonId-scoped). No RN-runtime test performed here either (no
 * Xcode available in this environment — disclosed in the final
 * report); this proves, with REAL network calls, the two halves of
 * the flow that ARE testable outside the RN runtime:
 *
 *   (1) The REAL Cloudinary unsigned-upload contract (cloud/preset/
 *       folder/field names — exactly what SalonPhotosScreen.js now
 *       sends via axios) — 3 real images, uploaded for real.
 *   (2) The REAL backend Owner savePhotos round-trip, via the real,
 *       mounted HTTP route, using those 3 real secure_urls.
 *
 * Every Cloudinary asset uploaded here is destroyed in the `finally`
 * block. Every Mongo document is purged by exact _id.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyOwnerPhotoUploadFix.js
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
import Salon from "../../models/Salon.js";
import Service from "../../models/Service.js";
import Staff from "../../models/Staff.js";
import Chair from "../../models/Chair.js";
import SalonMedia from "../../models/SalonMedia.js";

import { nextPhone, authFetch as sharedAuthFetch } from "./fieldAgentE2EHelpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 400) : ""}`); }
};

const createdIds = { users: [], salons: [] };
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
const CLOUDINARY_UPLOAD_PRESET = "c4qu5hpg";
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`;
const CLOUDINARY_DESTROY_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/destroy`;

const TEST_IMAGE_PATH = path.resolve(__dirname, "../../../salon-app/assets/images/favicon.png");

const uploadRealImageToCloudinary = async (label) => {
  const form = new FormDataNode();
  form.append("file", fs.createReadStream(TEST_IMAGE_PATH), { filename: `ZE2E_OWNER_PHOTO_${label}.png`, contentType: "image/png" });
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
  const onboardingPath = (suffix) => `/api/salon/onboarding${suffix}`;

  try {
    // ── OWNER X — the one we actually upload photos for ──
    const ownerX = await User.create({ name: "ZE2E_OWNERPHOTOFIX_X", phone: nextPhone("7"), role: "OWNER", accountStatus: "ACTIVE" });
    createdIds.users.push(ownerX._id);
    const ownerXToken = generateAccessToken({ _id: ownerX._id, role: "OWNER", tokenVersion: 0 });
    // Bare DRAFT salon at step 0, same findOneAndUpdate idiom Phase
    // 1/2B fixtures use (avoids the 2dsphere-index `new Model()`
    // crash). NOTE (corrected by the Phase 11L audit): a real brand-new
    // Owner salon never actually starts at step 0 — saveBasicInfo's own
    // upsert defaults it to the schema's step:1 on insert. This step:0
    // shape instead models the genuine cross-flow case the Phase 11L
    // fix targets: a Field-Agent-assisted salon (created at step 0) for
    // the same ownerId, later opened in the Owner App itself.
    const salonX = await Salon.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId() },
      { $set: { ownerId: ownerX._id, "onboarding.step": 0, "approval.status": "DRAFT" } },
      { new: true, upsert: true, runValidators: false, setDefaultsOnInsert: false }
    );
    createdIds.salons.push(salonX._id);

    // ── OWNER Y — untouched control, proves isolation ──
    const ownerY = await User.create({ name: "ZE2E_OWNERPHOTOFIX_Y", phone: nextPhone("7"), role: "OWNER", accountStatus: "ACTIVE" });
    createdIds.users.push(ownerY._id);
    const salonY = await Salon.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId() },
      { $set: { ownerId: ownerY._id, "onboarding.step": 0, "approval.status": "DRAFT" } },
      { new: true, upsert: true, runValidators: false, setDefaultsOnInsert: false }
    );
    createdIds.salons.push(salonY._id);

    // Walk Owner X to step 6 (staff) via the REAL, frozen Owner API —
    // same sequence a real owner onboarding flow performs.
    {
      const r1 = await authFetch(onboardingPath("/basic-info"), ownerXToken, { method: "PATCH", body: JSON.stringify({ shopName: "ZE2E OwnerPhotoFix Salon X", category: "UNISEX" }) });
      check("Setup: basic-info -> 200", r1.status === 200, r1);
      // Phase 11L fix: this salon started at onboarding.step 0 (line
      // ~121 above) — a real update (not an insert, since the doc
      // already exists), so no schema default applies. Before the fix,
      // $max was a silent no-op here and this would have stayed 0.
      check("Setup: basic-info response reports onboardingStep === 1 (Phase 11L fix)", r1.data?.data?.onboardingStep === 1, r1.data);
      const r2 = await authFetch(onboardingPath("/location"), ownerXToken, { method: "PATCH", body: JSON.stringify({ address: "x", lat: REAL_LAT, lng: REAL_LNG }) });
      check("Setup: location -> 200", r2.status === 200, r2);
      const r3 = await authFetch(onboardingPath("/services"), ownerXToken, { method: "PATCH", body: JSON.stringify({ services: [{ name: "Haircut", price: 200, duration: 30 }] }) });
      check("Setup: services -> 200", r3.status === 200, r3);
      const r4 = await authFetch(onboardingPath("/chairs"), ownerXToken, { method: "PATCH", body: JSON.stringify({ chairCount: 2 }) });
      check("Setup: chairs -> 200", r4.status === 200, r4);
      const r5 = await authFetch(onboardingPath("/timings"), ownerXToken, { method: "PATCH", body: JSON.stringify({ timings: fullWeekTimings() }) });
      check("Setup: timings -> 200", r5.status === 200, r5);
      const r6 = await authFetch(onboardingPath("/staff"), ownerXToken, { method: "PATCH", body: JSON.stringify({ isOwnerOnly: true }) });
      check("Setup: staff -> 200, step advances to >= 6", r6.status === 200, r6);
      const salonXAfterSetup = await Salon.findById(salonX._id).lean();
      check("Setup: Salon X reached onboarding.step >= 6", (salonXAfterSetup?.onboarding?.step ?? 0) >= 6, salonXAfterSetup?.onboarding);
    }

    // ── LIVE CLOUDINARY UPLOADS (3 real images, real network calls) ──
    const upload1 = await uploadRealImageToCloudinary("1_cover");
    check("Photo 1: real Cloudinary upload -> secure_url returned", !!upload1.secure_url, upload1);
    const upload2 = await uploadRealImageToCloudinary("2_shop");
    check("Photo 2: real Cloudinary upload -> secure_url returned", !!upload2.secure_url, upload2);
    const upload3 = await uploadRealImageToCloudinary("3_work");
    check("Photo 3: real Cloudinary upload -> secure_url returned", !!upload3.secure_url, upload3);
    check("All 3 uploads landed in the correct folder (public_id prefix)", [upload1, upload2, upload3].every((u) => u.public_id.startsWith("barber_engine/salons/")), [upload1.public_id, upload2.public_id, upload3.public_id]);

    // ── REAL backend Owner savePhotos call, with the 3 real secure_urls ──
    const photosPayload = {
      photos: [
        { url: upload1.secure_url, type: "COVER" },
        { url: upload2.secure_url, type: "SHOP" },
        { url: upload3.secure_url, type: "WORK" },
      ],
    };
    const rPhotos = await authFetch(onboardingPath("/photos"), ownerXToken, { method: "PATCH", body: JSON.stringify(photosPayload) });
    check("Owner savePhotos -> 200 with 3 real Cloudinary URLs", rPhotos.status === 200, rPhotos);

    // ── Verify correct salonId / media persistence ──
    const mediaX = await SalonMedia.find({ salonId: salonX._id, isDeleted: false }).lean();
    check("Exactly 3 SalonMedia docs created, all with salonId === Salon X", mediaX.length === 3 && mediaX.every((m) => String(m.salonId) === String(salonX._id)), mediaX.map((m) => m.salonId));
    check("SalonMedia URLs match the 3 real Cloudinary secure_urls", [upload1, upload2, upload3].every((u) => mediaX.some((m) => m.url === u.secure_url)), mediaX.map((m) => m.url));
    check("Exactly one COVER photo", mediaX.filter((m) => m.type === "COVER").length === 1, mediaX.map((m) => m.type));

    // ── Verify the untouched control salon (Y) was never touched ──
    const mediaY = await SalonMedia.find({ salonId: salonY._id }).lean();
    check("Salon Y (untouched control) has ZERO SalonMedia docs", mediaY.length === 0, mediaY);
    const salonYAfter = await Salon.findById(salonY._id).lean();
    check("Salon Y onboarding.step unchanged (still 0)", (salonYAfter?.onboarding?.step ?? 0) === 0, salonYAfter?.onboarding);

    // ── Review endpoint reflects the real photos ──
    const rReview = await authFetch(onboardingPath("/review"), ownerXToken, { method: "GET" });
    check("Owner getReview -> 200, media array has 3 real entries", rReview.status === 200 && (rReview.data?.data?.media || []).length === 3, rReview.data?.data?.media);

  } finally {
    for (const publicId of uploadedCloudinaryPublicIds) {
      await destroyCloudinaryAsset(publicId);
    }

    await Service.deleteMany({ salonId: { $in: createdIds.salons } });
    await Staff.deleteMany({ salonId: { $in: createdIds.salons } });
    await Chair.deleteMany({ salonId: { $in: createdIds.salons } });
    await SalonMedia.deleteMany({ salonId: { $in: createdIds.salons } });
    await Salon.deleteMany({ _id: { $in: createdIds.salons } });
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
