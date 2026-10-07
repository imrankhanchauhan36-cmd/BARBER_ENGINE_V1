/**
 * DIAGNOSTIC ONLY — same flow as diagnoseFieldAgentSubmitError.js, but
 * hits the ALREADY-RUNNING dev server on port 6060 (the exact server
 * the user's own `npx expo start` + Expo Go session targets per
 * src/config/env.js's __DEV__ auto-LAN-IP resolution), instead of
 * spinning up a fresh ephemeral app.listen(0) instance. This rules out
 * any difference between "my own ephemeral test instance" and "the
 * actual live process the device hits".
 *
 * This script does NOT start its own HTTP server — it only opens its
 * own Mongoose connection for pre-submit DB state reads/cleanup.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/diagnoseFieldAgentSubmitErrorLiveServer.js
 */
import "dotenv/config";
import mongoose from "mongoose";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import FormDataNode from "form-data";
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
const CLOUDINARY_UPLOAD_PRESET = "c4qu5hpg";
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`;
const CLOUDINARY_DESTROY_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/destroy`;
const TEST_IMAGE_PATH = path.resolve(__dirname, "../../../salon-app/assets/images/favicon.png");

const uploadRealImageToCloudinary = async (label) => {
  const form = new FormDataNode();
  form.append("file", fs.createReadStream(TEST_IMAGE_PATH), { filename: `ZE2E_SUBMITDIAGLIVE_${label}.png`, contentType: "image/png" });
  form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  form.append("folder", "barber_engine/salons");
  const res = await axios.post(CLOUDINARY_UPLOAD_URL, form, { headers: form.getHeaders(), timeout: 60000 });
  uploadedCloudinaryPublicIds.push(res.data.public_id);
  return res.data;
};
const destroyCloudinaryAsset = async (publicId) => {
  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = `public_id=${publicId}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`;
  const signature = crypto.createHash("sha1").update(toSign).digest("hex");
  await axios.post(CLOUDINARY_DESTROY_URL, { public_id: publicId, timestamp, api_key: CLOUDINARY_API_KEY, signature }, { headers: { "Content-Type": "application/x-www-form-urlencoded" } }).catch(() => {});
};

const run = async () => {
  await connectDB(); // separate connection, for direct DB reads/cleanup only
  const url = (p) => `http://127.0.0.1:6060${p}`;
  const authFetch = (p, token, opts) => sharedAuthFetch(url, p, token, opts);
  const onboardingPath = (salonId, suffix) => `/api/field-agent/acquisition/applications/${salonId}/onboarding${suffix}`;

  try {
    const fa = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "SUBMITDIAGLIVE");
    createdIds.users.push(fa.agentUser._id);
    createdIds.applications.push(fa.application._id);
    createdIds.fieldAgents.push(fa.fieldAgent._id);
    const faToken = fa.token;

    const ownerPhone = nextPhone("7");
    const otpRes = await authFetch("/api/field-agent/acquisition/assisted-onboarding/send-otp", faToken, { method: "POST", body: JSON.stringify({ phone: ownerPhone }) });
    const devOtp = otpRes.data?.data?.devOtp;
    console.log("send-otp:", otpRes.status, JSON.stringify(otpRes.data));

    const startRes = await authFetch("/api/field-agent/acquisition/assisted-onboarding/start", faToken, { method: "POST", body: JSON.stringify({ phone: ownerPhone, otp: devOtp, createNewBranch: true }) });
    console.log("start:", startRes.status, JSON.stringify(startRes.data));
    const salonId = startRes.data?.data?.salonId;
    if (!salonId) throw new Error("No salonId returned from /start");
    createdIds.salons.push(salonId);
    const claimId = startRes.data?.data?.acquisitionClaim?.id;
    if (claimId) createdIds.claims.push(claimId);
    const ownerId = startRes.data?.data?.ownerId;
    if (ownerId) createdIds.users.push(ownerId);

    const r1 = await authFetch(onboardingPath(salonId, "/basic-info"), faToken, { method: "PATCH", body: JSON.stringify({ shopName: "ZE2E Submit Diag Live Salon", category: "UNISEX" }) });
    console.log("basic-info:", r1.status, JSON.stringify(r1.data));
    const r2 = await authFetch(onboardingPath(salonId, "/location"), faToken, { method: "PATCH", body: JSON.stringify({ address: "x", lat: REAL_LAT, lng: REAL_LNG }) });
    console.log("location:", r2.status, JSON.stringify(r2.data));
    const r3 = await authFetch(onboardingPath(salonId, "/services"), faToken, { method: "PATCH", body: JSON.stringify({ services: [{ name: "Haircut", price: 200, duration: 30 }] }) });
    console.log("services:", r3.status, JSON.stringify(r3.data));
    const r4 = await authFetch(onboardingPath(salonId, "/chairs"), faToken, { method: "PATCH", body: JSON.stringify({ chairCount: 2 }) });
    console.log("chairs:", r4.status, JSON.stringify(r4.data));
    const r5 = await authFetch(onboardingPath(salonId, "/timings"), faToken, { method: "PATCH", body: JSON.stringify({ timings: fullWeekTimings() }) });
    console.log("timings:", r5.status, JSON.stringify(r5.data));
    const r6 = await authFetch(onboardingPath(salonId, "/staff"), faToken, { method: "PATCH", body: JSON.stringify({ isOwnerOnly: true }) });
    console.log("staff:", r6.status, JSON.stringify(r6.data));

    const u1 = await uploadRealImageToCloudinary("1");
    const u2 = await uploadRealImageToCloudinary("2");
    const u3 = await uploadRealImageToCloudinary("3");
    const r7 = await authFetch(onboardingPath(salonId, "/photos"), faToken, { method: "PATCH", body: JSON.stringify({ photos: [{ url: u1.secure_url, type: "COVER" }, { url: u2.secure_url, type: "SHOP" }, { url: u3.secure_url, type: "WORK" }] }) });
    console.log("photos:", r7.status, JSON.stringify(r7.data));

    const salonDoc = await Salon.findById(salonId).lean();
    console.log("\n=== PRE-SUBMIT SALON DOC (step/status only) ===", JSON.stringify({ step: salonDoc?.onboarding, approval: salonDoc?.approval }));

    console.log("\n=== CALLING /submit on LIVE server (port 6060) ===");
    const r8 = await authFetch(onboardingPath(salonId, "/submit"), faToken, { method: "POST" });
    console.log("submit STATUS:", r8.status);
    console.log("submit BODY:", JSON.stringify(r8.data, null, 2));

  } finally {
    for (const publicId of uploadedCloudinaryPublicIds) await destroyCloudinaryAsset(publicId);
    await AcquisitionClaim.deleteMany({ _id: { $in: createdIds.claims } });
    await AcquisitionReferral.deleteMany({ consumedSalonRef: { $in: createdIds.salons } });
    await Service.deleteMany({ salonId: { $in: createdIds.salons } });
    await Staff.deleteMany({ salonId: { $in: createdIds.salons } });
    await Chair.deleteMany({ salonId: { $in: createdIds.salons } });
    await SalonMedia.deleteMany({ salonId: { $in: createdIds.salons } });
    await Salon.deleteMany({ _id: { $in: createdIds.salons } });
    await FieldAgent.deleteMany({ _id: { $in: createdIds.fieldAgents } });
    await FieldAgentApplication.deleteMany({ _id: { $in: createdIds.applications } });
    await User.deleteMany({ _id: { $in: createdIds.users } });
    console.log("\nDone. Cleanup complete.");
    await mongoose.connection.close();
    process.exit(0);
  }
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
