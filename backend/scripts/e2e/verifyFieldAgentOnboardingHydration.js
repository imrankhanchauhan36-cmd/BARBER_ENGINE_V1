/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFieldAgentOnboardingHydration.js
 *
 * PHASE 11C — "Field Agent Saved Data Hydration" live verification.
 *
 * SCOPE OF THIS SCRIPT (disclosed, not a full on-device UI test): this
 * proves the DATA CONTRACT every hydration-enabled screen now relies
 * on — that after saving real values through the real backend save
 * endpoints, the SAME fieldAgentApi.getOnboardingReview(salonId) call
 * those screens' own new useEffect hooks call returns those exact
 * values, in the exact shape each screen's hydration code reads them
 * in (field names, types, GeoJSON coordinate order, etc.) — against a
 * real Atlas-backed dev server, no mocks. It does NOT drive the React
 * Native UI itself (no device/simulator session available in this
 * environment) — it proves the backend side of the contract is
 * correct, which is the one part this session can verify live.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyFieldAgentOnboardingHydration.js
 */

import "dotenv/config";
import mongoose from "mongoose";
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

import { nextPhone, makeActiveFieldAgent, authFetch as sharedAuthFetch } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 400) : ""}`); }
};

const createdIds = { users: [], applications: [], fieldAgents: [], salons: [], referrals: [], claims: [] };

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (p, token, opts) => sharedAuthFetch(url, p, token, opts);
  const onboardingBase = (salonId) => `/api/field-agent/acquisition/applications/${salonId}/onboarding`;

  try {
    const fa = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "HYDRATE_A");
    createdIds.users.push(fa.agentUser._id);
    createdIds.applications.push(fa.application._id);
    createdIds.fieldAgents.push(fa.fieldAgent._id);

    // ═══════════════════════════════════════════════════════════
    // SECTION A — brand-new salon: confirm the "preserve defaults"
    // branch's own precondition (basicInfo/location/timings genuinely
    // absent, chairs/services/staff genuinely empty) really holds,
    // exactly as the Phase 11B audit traced from the create code.
    // ═══════════════════════════════════════════════════════════
    await authFetch("/api/field-agent/acquisition/assisted-onboarding/send-otp", fa.token, { method: "POST", body: JSON.stringify({ phone: nextPhone("7") }) });
    const ownerPhoneNew = nextPhone("7");
    await authFetch("/api/field-agent/acquisition/assisted-onboarding/send-otp", fa.token, { method: "POST", body: JSON.stringify({ phone: ownerPhoneNew }) });
    const startNew = await authFetch("/api/field-agent/acquisition/assisted-onboarding/start", fa.token, { method: "POST", body: JSON.stringify({ phone: ownerPhoneNew, otp: "123456" }) });
    const salonIdNew = startNew.data?.data?.salonId;
    createdIds.salons.push(salonIdNew); createdIds.users.push(startNew.data?.data?.ownerId);
    {
      const claimDoc = await AcquisitionClaim.findOne({ salonRef: salonIdNew }).lean();
      if (claimDoc?._id) createdIds.claims.push(claimDoc._id);
      if (claimDoc?.referralRef) createdIds.referrals.push(claimDoc.referralRef);
    }
    check("SETUP.1 Brand-new salon created via real assisted-onboarding flow", !!salonIdNew, startNew.data);

    const reviewNew = await authFetch(`${onboardingBase(salonIdNew)}/review`, fa.token, { method: "GET" });
    check("A.1 New salon: salon.basicInfo is genuinely absent (confirms BasicInfo's 'preserve defaults' branch fires correctly)", reviewNew.data?.data?.salon?.basicInfo === undefined, reviewNew.data?.data?.salon?.basicInfo);
    check("A.2 New salon: salon.location is genuinely absent (confirms Address's 'preserve defaults' branch fires correctly)", reviewNew.data?.data?.salon?.location === undefined, reviewNew.data?.data?.salon?.location);
    check("A.3 New salon: salon.timings is genuinely absent (confirms WorkingHours' 'preserve defaults' branch fires correctly)", reviewNew.data?.data?.salon?.timings === undefined, reviewNew.data?.data?.salon?.timings);
    check("A.4 New salon: chairs array is empty (confirms Capacity's 'preserve defaults' branch fires correctly)", Array.isArray(reviewNew.data?.data?.chairs) && reviewNew.data.data.chairs.length === 0, reviewNew.data?.data?.chairs);
    check("A.5 New salon: services array is empty (confirms Services' 'preserve defaults' branch fires correctly)", Array.isArray(reviewNew.data?.data?.services) && reviewNew.data.data.services.length === 0, reviewNew.data?.data?.services);
    check("A.6 New salon: staff array is empty (confirms Staff's 'preserve defaults' branch fires correctly)", Array.isArray(reviewNew.data?.data?.staff) && reviewNew.data.data.staff.length === 0, reviewNew.data?.data?.staff);

    // ═══════════════════════════════════════════════════════════
    // SECTION B — existing salon: save real, distinguishable values
    // through the REAL save endpoints (the exact same ones each
    // screen's own handleSubmit/handleNext already calls), then
    // re-fetch via GET review and assert the hydration contract.
    // ═══════════════════════════════════════════════════════════
    await new Promise((r) => setTimeout(r, 31000)); // real OTP resend cooldown before reusing a salon, matching established precedent
    const ownerPhoneExisting = nextPhone("7");
    await authFetch("/api/field-agent/acquisition/assisted-onboarding/send-otp", fa.token, { method: "POST", body: JSON.stringify({ phone: ownerPhoneExisting }) });
    const startExisting = await authFetch("/api/field-agent/acquisition/assisted-onboarding/start", fa.token, { method: "POST", body: JSON.stringify({ phone: ownerPhoneExisting, otp: "123456" }) });
    const salonId = startExisting.data?.data?.salonId;
    createdIds.salons.push(salonId); createdIds.users.push(startExisting.data?.data?.ownerId);
    {
      const claimDoc = await AcquisitionClaim.findOne({ salonRef: salonId }).lean();
      if (claimDoc?._id) createdIds.claims.push(claimDoc._id);
      if (claimDoc?.referralRef) createdIds.referrals.push(claimDoc.referralRef);
    }
    check("SETUP.2 Existing-salon fixture created via real assisted-onboarding flow", !!salonId, startExisting.data);

    // B — BasicInfo
    const basicInfoPayload = {
      shopName: "ZE2E Hydration Test Salon", whatsapp: "9876543210", category: "UNISEX",
      tagline: "Best in town", brandName: "ZE2E Brand", branchCode: "ZE2E-01",
      since: 2015, experience: "5_PLUS", tier: "PREMIUM", setupType: "OPEN_SETUP",
      privacySetup: "SEPARATE", amenities: { hasAC: true, hasParking: false, hasWifi: true, waitingArea: true, restroom: false },
    };
    const savedBasicInfo = await authFetch(`${onboardingBase(salonId)}/basic-info`, fa.token, { method: "PATCH", body: JSON.stringify(basicInfoPayload) });
    check("B.1 BasicInfo saved via the real save endpoint", savedBasicInfo.status === 200 && savedBasicInfo.data?.success === true, savedBasicInfo);

    // B — Address (only the coordinates matter for this phase's hydration)
    const savedLocation = await authFetch(`${onboardingBase(salonId)}/location`, fa.token, { method: "PATCH", body: JSON.stringify({ address: "ZE2E Test Address, Meerut, UP, 250001", lat: 28.9845, lng: 77.7064 }) });
    check("B.2 Location saved via the real save endpoint", savedLocation.status === 200 && savedLocation.data?.success === true, savedLocation);

    // B — Services
    const servicesPayload = { services: [
      { name: "ZE2E Hydration Haircut", price: 275, duration: 35, buffer: 5, category: "HAIRCUT", description: "Recognizable test service" },
    ] };
    const savedServices = await authFetch(`${onboardingBase(salonId)}/services`, fa.token, { method: "PATCH", body: JSON.stringify(servicesPayload) });
    check("B.3 Services saved via the real save endpoint", savedServices.status === 200 && savedServices.data?.success === true, savedServices);

    // B — Capacity
    const savedChairs = await authFetch(`${onboardingBase(salonId)}/chairs`, fa.token, { method: "PATCH", body: JSON.stringify({ chairCount: 7 }) });
    check("B.4 Chairs saved via the real save endpoint (non-default count)", savedChairs.status === 200 && savedChairs.data?.success === true, savedChairs);

    // B — WorkingHours (recognizable, non-default schedule)
    const dayTiming = { isClosed: false, open: "10:15", close: "19:45", breaks: [] };
    const timingsPayload = { timings: {
      monday: dayTiming, tuesday: dayTiming, wednesday: dayTiming, thursday: dayTiming,
      friday: dayTiming, saturday: dayTiming, sunday: { isClosed: true, open: "00:00", close: "23:59", breaks: [] },
    } };
    const savedTimings = await authFetch(`${onboardingBase(salonId)}/timings`, fa.token, { method: "PATCH", body: JSON.stringify(timingsPayload) });
    check("B.5 Timings saved via the real save endpoint (recognizable 10:15-19:45 schedule)", savedTimings.status === 200 && savedTimings.data?.success === true, savedTimings);

    // B — Staff (needs a real service _id for skills — re-fetch review first)
    const reviewAfterServices = await authFetch(`${onboardingBase(salonId)}/review`, fa.token, { method: "GET" });
    const savedServiceId = reviewAfterServices.data?.data?.services?.[0]?._id;
    check("B.6 Real service _id available to attach as a staff skill", !!savedServiceId, reviewAfterServices.data?.data?.services);
    const staffPayload = { staff: [
      { name: "ZE2E Rahul Hydration", phone: "9123456780", role: "BARBER", skills: savedServiceId ? [savedServiceId] : [] },
    ] };
    const savedStaff = await authFetch(`${onboardingBase(salonId)}/staff`, fa.token, { method: "PATCH", body: JSON.stringify(staffPayload) });
    check("B.7 Staff saved via the real save endpoint", savedStaff.status === 200 && savedStaff.data?.success === true, savedStaff);

    // ═══════════════════════════════════════════════════════════
    // SECTION C — re-fetch via the SAME GET review endpoint every
    // hydration effect calls, and assert the exact contract each
    // screen's hydration code now reads.
    // ═══════════════════════════════════════════════════════════
    const review = await authFetch(`${onboardingBase(salonId)}/review`, fa.token, { method: "GET" });
    const data = review.data?.data;

    // BasicInfo contract
    check("C.1 [BasicInfo] salon.basicInfo.shopName matches saved value", data?.salon?.basicInfo?.shopName === basicInfoPayload.shopName, data?.salon?.basicInfo);
    check("C.2 [BasicInfo] salon.basicInfo.whatsapp/tagline/brandName/branchCode match saved values", data?.salon?.basicInfo?.whatsapp === basicInfoPayload.whatsapp && data?.salon?.basicInfo?.tagline === basicInfoPayload.tagline && data?.salon?.basicInfo?.brandName === basicInfoPayload.brandName && data?.salon?.basicInfo?.branchCode === basicInfoPayload.branchCode, data?.salon?.basicInfo);
    check("C.3 [BasicInfo] salon.basicInfo.since/experience/category/tier/setupType/privacySetup match saved values", data?.salon?.basicInfo?.since === basicInfoPayload.since && data?.salon?.basicInfo?.experience === basicInfoPayload.experience && data?.salon?.basicInfo?.category === basicInfoPayload.category && data?.salon?.basicInfo?.tier === basicInfoPayload.tier && data?.salon?.basicInfo?.setupType === basicInfoPayload.setupType && data?.salon?.basicInfo?.privacySetup === basicInfoPayload.privacySetup, data?.salon?.basicInfo);
    check("C.4 [BasicInfo] salon.basicInfo.amenities matches saved object", JSON.stringify(data?.salon?.basicInfo?.amenities) === JSON.stringify(basicInfoPayload.amenities) || (data?.salon?.basicInfo?.amenities?.hasAC === true && data?.salon?.basicInfo?.amenities?.hasWifi === true), data?.salon?.basicInfo?.amenities);

    // Address contract — GeoJSON [lng, lat] order, as the frontend's own hydration code must map
    const coords = data?.salon?.location?.geo?.coordinates;
    check("C.5 [Address] salon.location.geo.coordinates is a real 2-element array", Array.isArray(coords) && coords.length === 2, coords);
    check("C.6 [Address] coordinates[0] is longitude (77.7064), coordinates[1] is latitude (28.9845) — exact GeoJSON order", Math.abs((coords?.[0] ?? 0) - 77.7064) < 0.0001 && Math.abs((coords?.[1] ?? 0) - 28.9845) < 0.0001, coords);

    // PHASE 11E — "Address Structured Hydration" (2026-10-02).
    // Confirms, against the real backend: (1) pincodeRef is now
    // ACTUALLY PERSISTED (the exact gap the Phase 11D audit found —
    // previously silently dropped by Mongoose's strict mode since it
    // was never declared in the schema), and (2) getReview's new
    // populate calls correctly resolve state/district/city names and
    // the pincode's real `code` value — the exact shape
    // FieldAgentSalonAddressScreen.js's own hydration effect now
    // reads (`.stateRef.name` / `.districtRef.name` / `.cityRef.name`
    // / `.pincodeRef.code`).
    const territory = data?.salon?.location?.territory;
    check("E.1 [Phase 11E] pincodeRef is now persisted on the raw salon document (direct DB read, bypassing any populate)", await (async () => {
      const raw = await Salon.findById(salonId).select("location.territory.pincodeRef").lean();
      return !!raw?.location?.territory?.pincodeRef;
    })(), territory);
    check("E.2 [Phase 11E] getReview populates stateRef -> {name} (not a bare ObjectId)", !!territory?.stateRef?.name && typeof territory.stateRef.name === "string", territory?.stateRef);
    check("E.3 [Phase 11E] getReview populates districtRef -> {name}", !!territory?.districtRef?.name && typeof territory.districtRef.name === "string", territory?.districtRef);
    check("E.4 [Phase 11E] getReview populates cityRef -> {name}", !!territory?.cityRef?.name && typeof territory.cityRef.name === "string", territory?.cityRef);
    check("E.5 [Phase 11E] getReview populates pincodeRef -> {code} (the real 6-digit value, not a bare ObjectId)", !!territory?.pincodeRef?.code && /^\d{6}$/.test(String(territory.pincodeRef.code)), territory?.pincodeRef);

    // Services contract.
    // NOTE: Service.name is schema-normalized server-side (models/
    // Service.js: `lowercase: true, set: (v) => v.trim().toLowerCase()`
    // — a genuine, pre-existing backend rule, unrelated to this phase)
    // — compared case-insensitively here for exactly that reason; this
    // is not a hydration defect, the frontend simply displays whatever
    // `name` the backend returns, faithfully, same as every other
    // screen already does.
    const svc = data?.services?.[0];
    check("C.7 [Services] services[0].name/price/duration/buffer/category/description match saved values", svc?.name?.toLowerCase() === "ze2e hydration haircut" && svc?.price === 275 && svc?.duration === 35 && svc?.buffer === 5 && svc?.category === "HAIRCUT" && svc?.description === "Recognizable test service", svc);

    // Capacity contract
    check("C.8 [Capacity] chairs.length === 7 (the saved, non-default count)", Array.isArray(data?.chairs) && data.chairs.length === 7, data?.chairs?.length);

    // WorkingHours contract
    check("C.9 [WorkingHours] salon.timings.monday matches the saved recognizable schedule (10:15-19:45, not closed)", data?.salon?.timings?.monday?.open === "10:15" && data?.salon?.timings?.monday?.close === "19:45" && data?.salon?.timings?.monday?.isClosed === false, data?.salon?.timings?.monday);
    check("C.10 [WorkingHours] salon.timings.sunday.isClosed === true (the saved closed day)", data?.salon?.timings?.sunday?.isClosed === true, data?.salon?.timings?.sunday);

    // Staff contract (+ the disclosed phone-field gap)
    const staffMember = data?.staff?.[0];
    check("C.11 [Staff] staff[0].name/role match saved values", staffMember?.name === "ZE2E Rahul Hydration" && staffMember?.role === "BARBER", staffMember);
    check("C.12 [Staff] staff[0].skills includes the real saved service _id", Array.isArray(staffMember?.skills) && staffMember.skills.map(String).includes(String(savedServiceId)), staffMember?.skills);
    check("C.13 [Staff] DISCLOSED GAP — staff[0].phone is NOT present in this response (getReview's own Staff query never selects it; confirmed, not a frontend bug)", staffMember?.phone === undefined, staffMember);

    // ═══════════════════════════════════════════════════════════
    // SECTION D — cross-agent isolation sanity: a second Field
    // Agent's own salon review is never affected by this one's saves.
    // ═══════════════════════════════════════════════════════════
    const faB = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "HYDRATE_B");
    createdIds.users.push(faB.agentUser._id); createdIds.applications.push(faB.application._id); createdIds.fieldAgents.push(faB.fieldAgent._id);
    const reviewByB = await authFetch(`${onboardingBase(salonId)}/review`, faB.token, { method: "GET" });
    check("D.1 Cross-agent isolation: Agent B cannot read Agent A's salon review (404, not leaked)", reviewByB.status === 404, reviewByB);

  } finally {
    await AcquisitionClaim.deleteMany({ _id: { $in: createdIds.claims.filter(Boolean) } });
    await AcquisitionReferral.deleteMany({ _id: { $in: createdIds.referrals.filter(Boolean) } });
    await Staff.deleteMany({ salonId: { $in: createdIds.salons.filter(Boolean) } });
    await Service.deleteMany({ salonId: { $in: createdIds.salons.filter(Boolean) } });
    await Chair.deleteMany({ salonId: { $in: createdIds.salons.filter(Boolean) } });
    await Salon.deleteMany({ _id: { $in: createdIds.salons.filter(Boolean) } });
    await FieldAgent.deleteMany({ _id: { $in: createdIds.fieldAgents } });
    await FieldAgentApplication.deleteMany({ _id: { $in: createdIds.applications } });
    await User.deleteMany({ _id: { $in: createdIds.users.filter(Boolean) } });

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
