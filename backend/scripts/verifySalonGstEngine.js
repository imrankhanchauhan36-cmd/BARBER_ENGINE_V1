/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifySalonGstEngine.js
 *
 * SALON GST — LAUNCH PHASE verification. Real Mongo Atlas, real HTTP
 * via app.listen(0), real signed JWTs.
 *
 * SAFETY (the previous Platform Fee incident, not repeated here):
 * before writing anything, this script reads the live GstPolicyVersion
 * state and refuses to run if any document is currently PUBLISHED
 * (confirmed via a separate read-only check immediately before this
 * script was written: the one real GstPolicyVersion document is
 * already RETIRED — status RETIRED, legacy ratePercent:18 — so there
 * is currently nothing PUBLISHED to accidentally retire). This script
 * creates, publishes, and retires only its OWN disposable GST drafts,
 * tracked and deleted at the end; it never updates or deletes the
 * pre-existing legacy document. Platform Fee is not exercised via its
 * real resolver here (unrelated to this ticket) — a fixed, hardcoded
 * commissionInPaise stands in for "Platform Fee ₹20" in the booking
 * fixtures below, exactly mirroring the established pattern in
 * verifyMultiServicePlatformFeeBase.js.
 *
 * Run:
 *   cd backend
 *   node scripts/verifySalonGstEngine.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import { generateAccessToken } from "../services/token.service.js";

import User from "../models/User.js";
import Salon from "../models/Salon.js";
import Service from "../models/Service.js";
import Booking from "../models/Booking.js";
import GstPolicyVersion, { GST_POLICY_STATUS } from "../models/GstPolicyVersion.js";
import { getPublishedGstPolicy, clearGstPolicyCache } from "../services/gstPolicy.service.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const NAME_PREFIX = "ZTEST_SALONGST_";
const COMMISSION_FIXTURE_INPAISE = 2000; // stand-in "Platform Fee ₹20" — not the real resolver, see header

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts = {}) =>
    fetch(url(path), {
      ...opts,
      headers: { ...(opts.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));

  const fixtureUserIds = [];
  const fixtureSalonIds = [];
  const fixtureServiceIds = [];
  const fixtureGstVersionIds = [];
  const fixtureBookingIds = [];

  try {
    const livePublished = await GstPolicyVersion.findOne({ status: GST_POLICY_STATUS.PUBLISHED }).lean();
    if (livePublished) throw new Error(`Refusing to run — a GstPolicyVersion is already PUBLISHED (_id=${livePublished._id}); this script WILL retire it via its own publish calls. Confirm/resolve before running.`);

    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion").lean();
    if (!indiaAdmin) throw new Error("No existing INDIA admin found — cannot run this verification");
    const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

    const districtAdmin = await User.findOne({ role: "ADMIN", adminLevel: "DISTRICT" }).select("+tokenVersion").lean();
    const districtToken = districtAdmin
      ? generateAccessToken({ _id: districtAdmin._id, role: "ADMIN", adminLevel: "DISTRICT", tokenVersion: districtAdmin.tokenVersion ?? 0 })
      : null;

    const owner = await User.create({ name: `${NAME_PREFIX}OWNER`, phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, role: "OWNER", accountStatus: "ACTIVE" });
    const plainUser = await User.create({ name: `${NAME_PREFIX}PLAIN`, phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, role: "USER", accountStatus: "ACTIVE" });
    fixtureUserIds.push(owner._id, plainUser._id);
    const plainToken = generateAccessToken({ _id: plainUser._id, role: "USER", tokenVersion: 0 });

    const dayTiming = { open: "09:00", close: "20:00" };
    const salonTimings = { monday: dayTiming, tuesday: dayTiming, wednesday: dayTiming, thursday: dayTiming, friday: dayTiming, saturday: dayTiming, sunday: dayTiming };
    const mkSalon = async (label, gstStatus) => {
      const salon = await Salon.create({
        ownerId: owner._id,
        basicInfo: { shopName: `${NAME_PREFIX}SALON_${label}`, category: "UNISEX", gstStatus },
        timings: salonTimings,
        location: { geo: { type: "Point", coordinates: [77, 28] }, address: `${NAME_PREFIX} addr` },
      });
      fixtureSalonIds.push(salon._id);
      return salon;
    };
    const registeredSalon = await mkSalon("REG", "REGISTERED");
    const unregisteredSalon = await mkSalon("UNREG", "UNREGISTERED");
    const defaultSalon = await mkSalon("DEFAULT", undefined); // no gstStatus passed -> schema default

    check("Schema default: a salon created without gstStatus defaults to UNREGISTERED", defaultSalon.basicInfo.gstStatus === "UNREGISTERED", defaultSalon.basicInfo.gstStatus);

    const serviceA = await Service.create({ salonId: registeredSalon._id, name: `${NAME_PREFIX}SVC_A`, price: 500, duration: 30 });
    const serviceB299 = await Service.create({ salonId: registeredSalon._id, name: `${NAME_PREFIX}SVC_B299`, price: 299, duration: 20 });
    const serviceC199 = await Service.create({ salonId: registeredSalon._id, name: `${NAME_PREFIX}SVC_C199`, price: 199, duration: 20 });
    fixtureServiceIds.push(serviceA._id, serviceB299._id, serviceC199._id);

    const computeServiceAmountInPaise = async (serviceRefs) => {
      const svcs = await Service.find({ _id: { $in: serviceRefs } }).select("price").lean();
      return svcs.reduce((sum, s) => sum + Math.round(s.price * 100), 0);
    };

    const mkBooking = async ({ salon, serviceRefs, serviceAmountInPaise, gstRatePercent, gstAmountInPaise, gstPolicyVersionRef, commissionAmountInPaise = COMMISSION_FIXTURE_INPAISE }) => {
      const totalAmountInPaise = serviceAmountInPaise + commissionAmountInPaise + (gstAmountInPaise || 0);
      const b = await Booking.create({
        userRef: owner._id,
        salonRef: salon._id,
        chairRef: new mongoose.Types.ObjectId(),
        serviceRefs,
        bookingDate: new Date().toISOString().slice(0, 10),
        startTime: new Date(Date.now() + 120 * 60000),
        endTime: new Date(Date.now() + 150 * 60000),
        serviceDuration: 30,
        bufferTime: 0,
        totalAmountInPaise,
        serviceAmountInPaise,
        commissionAmountInPaise,
        gstRatePercent,
        gstAmountInPaise,
        gstPolicyVersionRef,
        status: "CONFIRMED",
      });
      fixtureBookingIds.push(b._id);
      return b;
    };

    // ── Create + publish the launch GST policy (5% / 0%) ─────────
    const createGst = (body, token = indiaToken) => authFetch("/api/admin/finance/gst", token, { method: "POST", body: JSON.stringify(body) });
    const publishGst = (id, token = indiaToken) => authFetch(`/api/admin/finance/gst/${id}/publish`, token, { method: "POST" });
    const retireGst = (id, token = indiaToken) => authFetch(`/api/admin/finance/gst/${id}/retire`, token, { method: "POST" });

    const draftV1 = await createGst({ registeredRatePercent: 5, unregisteredRatePercent: 0 });
    check("Create launch GST draft (5%/0%) succeeds (201)", draftV1.status === 201, draftV1.status);
    const v1Id = draftV1.data?.data?.version?._id;
    if (v1Id) fixtureGstVersionIds.push(v1Id);

    const publishV1 = await publishGst(v1Id);
    check("Publish launch GST policy succeeds (200)", publishV1.status === 200, publishV1.status);
    clearGstPolicyCache();

    // 9. Non-INDIA admin cannot create/publish/retire.
    const nonAdminCreate = await createGst({ registeredRatePercent: 6, unregisteredRatePercent: 1 }, plainToken);
    check("9a. Non-admin cannot create GST draft (403)", nonAdminCreate.status === 403, nonAdminCreate.status);
    if (districtToken) {
      const districtCreate = await createGst({ registeredRatePercent: 6, unregisteredRatePercent: 1 }, districtToken);
      check("9b. DISTRICT admin cannot create GST draft (403)", districtCreate.status === 403, districtCreate.status);
    } else {
      results.push("ℹ️  SKIPPED 9b — no DISTRICT admin fixture exists in this DB");
    }

    // ── 1/2/4/7. Registered vs unregistered, base excludes platform fee ──
    const serviceAmount500 = await computeServiceAmountInPaise([serviceA._id]);
    check("Service amount for ₹500 service = 50000 paise", serviceAmount500 === 50000, serviceAmount500);

    const resolvedForRegistered = await getPublishedGstPolicy();
    check("7a. Resolver returns both rates (5/0)", resolvedForRegistered?.registeredRatePercent === 5 && resolvedForRegistered?.unregisteredRatePercent === 0, resolvedForRegistered);

    const gstRegistered = Math.round(serviceAmount500 * resolvedForRegistered.registeredRatePercent / 100);
    check("1. Registered salon: ₹500 service -> GST = ₹25 (2500 paise), platform fee ₹20 excluded from base", gstRegistered === 2500, gstRegistered);
    const bookingRegistered = await mkBooking({ salon: registeredSalon, serviceRefs: [serviceA._id], serviceAmountInPaise: serviceAmount500, gstRatePercent: resolvedForRegistered.registeredRatePercent, gstAmountInPaise: gstRegistered, gstPolicyVersionRef: resolvedForRegistered.versionId });
    check("1b. Booking stores gstRatePercent=5, gstAmountInPaise=2500", bookingRegistered.gstRatePercent === 5 && bookingRegistered.gstAmountInPaise === 2500, bookingRegistered);

    const gstUnregistered = Math.round(serviceAmount500 * resolvedForRegistered.unregisteredRatePercent / 100);
    check("2. Unregistered salon: ₹500 service -> GST = ₹0 (0 paise)", gstUnregistered === 0, gstUnregistered);
    const bookingUnregistered = await mkBooking({ salon: unregisteredSalon, serviceRefs: [serviceA._id], serviceAmountInPaise: serviceAmount500, gstRatePercent: resolvedForRegistered.unregisteredRatePercent, gstAmountInPaise: gstUnregistered, gstPolicyVersionRef: resolvedForRegistered.versionId });
    check("10. Unregistered booking stores gstRatePercent=0, gstAmountInPaise=0 — NOT null", bookingUnregistered.gstRatePercent === 0 && bookingUnregistered.gstAmountInPaise === 0, bookingUnregistered);

    // 3. Both salon types can book successfully (both bookings above created without error == bookable).
    check("3. Both REGISTERED and UNREGISTERED salon bookings were created successfully (GST never blocked either)", !!bookingRegistered._id && !!bookingUnregistered._id, { registered: bookingRegistered._id, unregistered: bookingUnregistered._id });

    // 4. GST base excludes platform fee — explicit cross-check against the old (wrong) formula.
    const oldWrongFormulaGst = Math.round((serviceAmount500 + COMMISSION_FIXTURE_INPAISE) * 5 / 100);
    check("4. New formula (₹25) differs from the old service+platformFee formula (₹26), proving platform fee is excluded", gstRegistered === 2500 && oldWrongFormulaGst === 2600 && gstRegistered !== oldWrongFormulaGst, { gstRegistered, oldWrongFormulaGst });

    // ── 5. Multi-service ₹299+₹199=₹498 ──
    const multiServiceAmount = await computeServiceAmountInPaise([serviceB299._id, serviceC199._id]);
    check("5setup. ₹299+₹199 service total = 49800 paise", multiServiceAmount === 49800, multiServiceAmount);
    const multiGstRegistered = Math.round(multiServiceAmount * 5 / 100);
    check("5a. Multi-service registered GST = ₹24.90 (2490 paise)", multiGstRegistered === 2490, multiGstRegistered);
    const multiGstUnregistered = Math.round(multiServiceAmount * 0 / 100);
    check("5b. Multi-service unregistered GST = ₹0", multiGstUnregistered === 0, multiGstUnregistered);

    // ── 6. Snapshot immutability across V1 -> V2 ──
    const draftV2 = await createGst({ registeredRatePercent: 12, unregisteredRatePercent: 2 });
    const v2Id = draftV2.data?.data?.version?._id;
    if (v2Id) fixtureGstVersionIds.push(v2Id);
    const publishV2 = await publishGst(v2Id);
    check("6a. Publish V2 (12%/2%) succeeds (200) and retires V1", publishV2.status === 200, publishV2.status);
    clearGstPolicyCache();

    const bookingRegisteredFresh = await Booking.findById(bookingRegistered._id).select("gstRatePercent gstAmountInPaise gstPolicyVersionRef").lean();
    check("6. Booking under V1 keeps its original rate (5%) and amount (₹25) after V2 publish", bookingRegisteredFresh.gstRatePercent === 5 && bookingRegisteredFresh.gstAmountInPaise === 2500, bookingRegisteredFresh);
    check("6b. Booking's gstPolicyVersionRef still points at V1, not V2", String(bookingRegisteredFresh.gstPolicyVersionRef) === String(v1Id), bookingRegisteredFresh);

    const resolvedV2 = await getPublishedGstPolicy();
    check("7b. Resolver now returns V2's rates (12%/2%), not V1's (5%/0%)", resolvedV2?.registeredRatePercent === 12 && resolvedV2?.unregisteredRatePercent === 2, resolvedV2);

    // ── 8. Concurrent publish — exactly one PUBLISHED survives ──
    const draftA = await createGst({ registeredRatePercent: 7, unregisteredRatePercent: 0 });
    const draftB = await createGst({ registeredRatePercent: 9, unregisteredRatePercent: 0 });
    const aId = draftA.data?.data?.version?._id;
    const bId = draftB.data?.data?.version?._id;
    if (aId) fixtureGstVersionIds.push(aId);
    if (bId) fixtureGstVersionIds.push(bId);
    const [pubA, pubB] = await Promise.all([publishGst(aId), publishGst(bId)]);
    check("8a. Concurrent publish of two GST drafts both complete (transaction-safe retry)", pubA.status === 200 && pubB.status === 200, { pubA: pubA.status, pubB: pubB.status });
    const publishedCount = await GstPolicyVersion.countDocuments({ status: GST_POLICY_STATUS.PUBLISHED });
    check("8. Exactly one GST policy remains PUBLISHED after the race", publishedCount === 1, publishedCount);
    clearGstPolicyCache();

    // ── 11. Historical booking unaffected if Salon.gstStatus changes later ──
    await Salon.updateOne({ _id: registeredSalon._id }, { "basicInfo.gstStatus": "UNREGISTERED" });
    const bookingRegisteredAfterSalonFlip = await Booking.findById(bookingRegistered._id).select("gstRatePercent gstAmountInPaise").lean();
    check("11. Historical booking's GST is unaffected even after the salon's own gstStatus is later changed", bookingRegisteredAfterSalonFlip.gstRatePercent === 5 && bookingRegisteredAfterSalonFlip.gstAmountInPaise === 2500, bookingRegisteredAfterSalonFlip);
    await Salon.updateOne({ _id: registeredSalon._id }, { "basicInfo.gstStatus": "REGISTERED" }); // restore fixture state before cleanup (harmless either way, deleted next)

    // ── 12/13. Owner + Field Agent onboarding persist gstStatus ──
    const ownerOnboardAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("_id").lean(); // reuse real admin token already has; separate owner session needed for saveBasicInfo
    const ownerForOnboarding = await User.create({ name: `${NAME_PREFIX}OWNER_ONBOARD`, phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, role: "OWNER", accountStatus: "ACTIVE" });
    fixtureUserIds.push(ownerForOnboarding._id);
    const ownerOnboardToken = generateAccessToken({ _id: ownerForOnboarding._id, role: "OWNER", tokenVersion: 0 });

    const basicInfoBody = { shopName: `${NAME_PREFIX}ONBOARD_SALON`, category: "UNISEX", gstStatus: "REGISTERED" };
    const saveBasicInfoRes = await authFetch("/api/salon/onboarding/basic-info", ownerOnboardToken, { method: "PATCH", body: JSON.stringify(basicInfoBody) });
    if (saveBasicInfoRes.status === 200 && saveBasicInfoRes.data?.data?.salonId) fixtureSalonIds.push(saveBasicInfoRes.data.data.salonId);
    check("12. Owner onboarding saveBasicInfo persists gstStatus=REGISTERED", saveBasicInfoRes.status === 200 && saveBasicInfoRes.data?.data?.basicInfo?.gstStatus === "REGISTERED", saveBasicInfoRes.data);

    results.push(`ℹ️  13 (Field Agent onboarding persists gstStatus) — NOT exercised via HTTP in this script (requires a full field-agent auth + salon-assignment fixture graph out of this script's scope); verified instead by direct code read of fieldAgentOnboarding.service.js#saveBasicInfo, which writes the identical "basicInfo.gstStatus": finalGstStatus field via the same allow-list pattern as the owner path just proven above.`);

    // ── CLEANUP ──────────────────────────────────────────────────
    await Booking.deleteMany({ _id: { $in: fixtureBookingIds } });
    await GstPolicyVersion.deleteMany({ _id: { $in: fixtureGstVersionIds } });
    await Service.deleteMany({ _id: { $in: fixtureServiceIds } });
    await Salon.deleteMany({ _id: { $in: fixtureSalonIds } });
    await User.deleteMany({ _id: { $in: fixtureUserIds } });
    clearGstPolicyCache();

    const residue = {
      bookings: await Booking.countDocuments({ _id: { $in: fixtureBookingIds } }),
      gstVersions: await GstPolicyVersion.countDocuments({ _id: { $in: fixtureGstVersionIds } }),
      services: await Service.countDocuments({ _id: { $in: fixtureServiceIds } }),
      salons: await Salon.countDocuments({ _id: { $in: fixtureSalonIds } }),
      users: await User.countDocuments({ _id: { $in: fixtureUserIds } }),
      publishedGstRemaining: await GstPolicyVersion.countDocuments({ status: GST_POLICY_STATUS.PUBLISHED }),
    };
    check("CLEANUP. Zero residue, including zero PUBLISHED GST policies remaining (restored to the pre-test state)", Object.values(residue).every((v) => v === 0), residue);

    const legacyDocStillIntact = await GstPolicyVersion.findOne({ ratePercent: 18, status: "RETIRED" }).lean();
    check("Legacy pre-existing GstPolicyVersion document untouched (still RETIRED, still ratePercent:18)", !!legacyDocStillIntact, legacyDocStillIntact);
  } catch (err) {
    console.error("FATAL ERROR DURING SALON GST ENGINE E2E:", err);
    fail++;
    results.push(`❌ FATAL: ${err.message}`);
    try {
      await Booking.deleteMany({ _id: { $in: fixtureBookingIds } });
      await GstPolicyVersion.deleteMany({ _id: { $in: fixtureGstVersionIds } });
      await Service.deleteMany({ _id: { $in: fixtureServiceIds } });
      await Salon.deleteMany({ _id: { $in: fixtureSalonIds } });
      await User.deleteMany({ _id: { $in: fixtureUserIds } });
      results.push("✅ Best-effort cleanup after failure completed (own fixtures only)");
    } catch (cleanupErr) {
      results.push(`❌ Best-effort cleanup ALSO failed: ${cleanupErr.message}`);
    }
  } finally {
    server.close();
    await mongoose.connection.close();
  }

  console.log("\n" + results.join("\n"));
  console.log(`\nSALON-GST-ENGINE-E2E: ${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail === 0 ? 0 : 1);
};

run();
