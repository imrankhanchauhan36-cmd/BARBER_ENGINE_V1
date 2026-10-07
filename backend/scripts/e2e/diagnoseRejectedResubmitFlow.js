/**
 * DIAGNOSTIC ONLY — reproduces the exact reported REJECTED -> Resubmit
 * flow against the live dev server (port 6060, same one Expo Go
 * targets), step by step, mirroring the user's own described sequence:
 *
 *   DRAFT -> complete all steps -> submit -> PENDING
 *   -> (simulate Admin reject) -> REJECTED
 *   -> Field Agent reopens salon (fetch review) -> sees REJECTED
 *   -> Field Agent goes "back to the list" (no-op, stateless)
 *   -> Field Agent reopens the SAME salon again (fetch review again)
 *   -> presses Resubmit -> expect DRAFT
 *   -> Field Agent goes "back to the list" AGAIN (no-op)
 *   -> Field Agent reopens the SAME salon a third time (fetch review)
 *   -> attempts to edit a step (saveBasicInfo)
 *   -> attempts Submit again -> expect PENDING
 *
 * Disposable fixture salon — fully cleaned up in `finally`.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/diagnoseRejectedResubmitFlow.js
 */
import "dotenv/config";
import mongoose from "mongoose";
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

const createdIds = { users: [], applications: [], fieldAgents: [], salons: [], referrals: [], claims: [] };
const REAL_LAT = 9.1833, REAL_LNG = 92.7667;
const fullWeekTimings = () => {
  const day = { open: "09:00", close: "20:00", isClosed: false, isOpen24Hours: false, breaks: [] };
  return { monday: day, tuesday: day, wednesday: day, thursday: day, friday: day, saturday: day, sunday: day };
};

const makeClaimedDraftSalon = async ({ ownerPhone, fieldAgentId }) => {
  const owner = await User.create({ name: "ZE2E_REJRESUB_OWNER", phone: ownerPhone, role: "OWNER", accountStatus: "ACTIVE" });
  const salon = await Salon.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId() },
    { $set: { ownerId: owner._id, "onboarding.step": 0, "approval.status": "DRAFT" } },
    { new: true, upsert: true, runValidators: false, setDefaultsOnInsert: false }
  );
  const referral = await AcquisitionReferral.create({
    code: `ZE2EREJRESUB-${Date.now()}`, fieldAgentRef: fieldAgentId, status: "CONSUMED",
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), consumedSalonRef: salon._id, consumedAt: new Date(),
  });
  const claim = await AcquisitionClaim.create({ salonRef: salon._id, fieldAgentRef: fieldAgentId, referralRef: referral._id, status: "PENDING_APPROVAL" });
  return { owner, salon, referral, claim };
};

const run = async () => {
  await connectDB();
  const url = (p) => `http://127.0.0.1:6060${p}`;
  const authFetch = (p, token, opts) => sharedAuthFetch(url, p, token, opts);
  const onboardingPath = (salonId, suffix) => `/api/field-agent/acquisition/applications/${salonId}/onboarding${suffix}`;

  try {
    const fa = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "REJRESUB");
    createdIds.users.push(fa.agentUser._id);
    createdIds.applications.push(fa.application._id);
    createdIds.fieldAgents.push(fa.fieldAgent._id);
    const faToken = fa.token;

    const fix = await makeClaimedDraftSalon({ ownerPhone: nextPhone("7"), fieldAgentId: fa.fieldAgent._id });
    createdIds.users.push(fix.owner._id);
    createdIds.salons.push(fix.salon._id);
    createdIds.referrals.push(fix.referral._id);
    createdIds.claims.push(fix.claim._id);
    const salonId = fix.salon._id;

    console.log("\n--- Walking salon to step 7 (DRAFT) ---");
    await authFetch(onboardingPath(salonId, "/basic-info"), faToken, { method: "PATCH", body: JSON.stringify({ shopName: "ZE2E RejResub", category: "UNISEX" }) });
    await authFetch(onboardingPath(salonId, "/location"), faToken, { method: "PATCH", body: JSON.stringify({ address: "x", lat: REAL_LAT, lng: REAL_LNG }) });
    await authFetch(onboardingPath(salonId, "/services"), faToken, { method: "PATCH", body: JSON.stringify({ services: [{ name: "Haircut", price: 200, duration: 30 }] }) });
    await authFetch(onboardingPath(salonId, "/chairs"), faToken, { method: "PATCH", body: JSON.stringify({ chairCount: 2 }) });
    await authFetch(onboardingPath(salonId, "/timings"), faToken, { method: "PATCH", body: JSON.stringify({ timings: fullWeekTimings() }) });
    await authFetch(onboardingPath(salonId, "/staff"), faToken, { method: "PATCH", body: JSON.stringify({ isOwnerOnly: true }) });
    await authFetch(onboardingPath(salonId, "/photos"), faToken, { method: "PATCH", body: JSON.stringify({ photos: [{ url: "https://example.com/p1.jpg", type: "COVER" }, { url: "https://example.com/p2.jpg", type: "SHOP" }, { url: "https://example.com/p3.jpg", type: "WORK" }] }) });

    console.log("--- Submit (DRAFT -> PENDING) ---");
    const rSubmit1 = await authFetch(onboardingPath(salonId, "/submit"), faToken, { method: "POST" });
    console.log("submit:", rSubmit1.status, JSON.stringify(rSubmit1.data));

    console.log("\n--- Simulating Admin reject (direct DB write — no admin API involved in this diagnosis) ---");
    await Salon.findByIdAndUpdate(salonId, { $set: { "approval.status": "REJECTED", "approval.rejectionReason": "ZE2E test rejection reason" } });

    console.log("\n--- Field Agent reopens salon (fetch review #1) ---");
    const rReview1 = await authFetch(onboardingPath(salonId, "/review"), faToken, { method: "GET" });
    console.log("review#1 status field:", rReview1.data?.data?.salon?.approval?.status);

    console.log("\n--- Field Agent 'goes back to list' (no-op) then reopens the SAME salon (fetch review #2) ---");
    const rReview2 = await authFetch(onboardingPath(salonId, "/review"), faToken, { method: "GET" });
    console.log("review#2 status field:", rReview2.data?.data?.salon?.approval?.status);

    console.log("\n--- Field Agent presses 'Edit Application / Resubmit' ---");
    const rResubmit = await authFetch(onboardingPath(salonId, "/resubmit"), faToken, { method: "PATCH" });
    console.log("resubmit:", rResubmit.status, JSON.stringify(rResubmit.data));

    // UX fix verification — confirm the APPLICATIONS LIST endpoint
    // (the one FieldAgentApplicationsScreen.js's "View & Resubmit"
    // card reads) ALSO reflects DRAFT immediately after resubmit, not
    // just the /review endpoint checked earlier.
    const rAppsList = await authFetch("/api/field-agent/acquisition/applications", faToken, { method: "GET" });
    const appEntry = (rAppsList.data?.data?.applications || []).find((a) => String(a.salonId) === String(salonId));
    console.log("applications-list entry after resubmit:", JSON.stringify(appEntry));

    console.log("\n--- Field Agent 'goes back to list' AGAIN (no-op) then reopens the SAME salon (fetch review #3) ---");
    const rReview3 = await authFetch(onboardingPath(salonId, "/review"), faToken, { method: "GET" });
    console.log("review#3 status field:", rReview3.data?.data?.salon?.approval?.status, "step:", rReview3.data?.data?.salon?.onboarding?.step);

    console.log("\n--- Field Agent attempts to edit a step (saveBasicInfo) ---");
    const rEdit = await authFetch(onboardingPath(salonId, "/basic-info"), faToken, { method: "PATCH", body: JSON.stringify({ shopName: "ZE2E RejResub Edited", category: "UNISEX" }) });
    console.log("edit basic-info:", rEdit.status, JSON.stringify(rEdit.data));

    console.log("\n--- Field Agent attempts Submit again ---");
    const rSubmit2 = await authFetch(onboardingPath(salonId, "/submit"), faToken, { method: "POST" });
    console.log("submit#2:", rSubmit2.status, JSON.stringify(rSubmit2.data));

  } finally {
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
    console.log("\nDone. Cleanup complete.");
    await mongoose.connection.close();
    process.exit(0);
  }
};

run().catch((err) => { console.error("FATAL:", err); process.exit(1); });
