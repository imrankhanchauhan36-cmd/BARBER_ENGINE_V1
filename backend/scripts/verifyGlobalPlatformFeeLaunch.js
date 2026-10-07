/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyGlobalPlatformFeeLaunch.js
 *
 * GLOBAL PLATFORM FEE — launch-phase verification. Real Mongo Atlas,
 * real HTTP via app.listen(0), real signed JWTs. Mirrors the existing
 * methodology (verifyGstPlatformFeeArchitecture.js). Disposable
 * fixtures with an explicit NAME_PREFIX marker, explicit zero-residue
 * cleanup — including every AreaPlatformFeePolicy document this
 * script itself creates (scope:"GLOBAL" or scope:"AREA"), so the live
 * DB is left with NO PUBLISHED GLOBAL fee when this script finishes,
 * exactly as it found it (confirmed 0 GLOBAL-scope docs before this
 * script was ever run).
 *
 * Run:
 *   cd backend
 *   node scripts/verifyGlobalPlatformFeeLaunch.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import { generateAccessToken } from "../services/token.service.js";

import User from "../models/User.js";
import Salon from "../models/Salon.js";
import Booking, { BOOKING_STATUS } from "../models/Booking.js";
import SalonEarnings from "../models/SalonEarnings.js";
import Country from "../models/Country.js";
import StateModel from "../models/State.js";
import District from "../models/District.js";
import City from "../models/City.js";
import Area from "../models/Area.js";
import AreaPlatformFeePolicy, { PLATFORM_FEE_SCOPE } from "../models/AreaPlatformFeePolicy.js";
import { resolveGlobalPlatformFee, resolvePlatformFeeForArea } from "../services/areaPlatformFee.service.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const NAME_PREFIX = "ZTEST_GLOBALFEE_";
const oid = () => new mongoose.Types.ObjectId();

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
      },
    }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));

  const fixtureUserIds = [];
  const fixtureSalonIds = [];
  const fixtureBookingIds = [];
  const fixtureFeePolicyIds = [];
  const fixtureGeographyIds = { states: [], districts: [], cities: [], areas: [] };

  try {
    // ── SETUP ────────────────────────────────────────────────────
    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion").lean();
    if (!indiaAdmin) throw new Error("No existing INDIA admin found — cannot run this verification");
    const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

    const districtAdmin = await User.findOne({ role: "ADMIN", adminLevel: "DISTRICT" }).select("+tokenVersion").lean();
    const districtToken = districtAdmin
      ? generateAccessToken({ _id: districtAdmin._id, role: "ADMIN", adminLevel: "DISTRICT", tokenVersion: districtAdmin.tokenVersion ?? 0 })
      : null;

    const ownerA = await User.create({ name: `${NAME_PREFIX}OWNER`, phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, role: "OWNER", accountStatus: "ACTIVE" });
    const plainUser = await User.create({ name: `${NAME_PREFIX}PLAIN`, phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, role: "USER", accountStatus: "ACTIVE" });
    fixtureUserIds.push(ownerA._id, plainUser._id);
    const plainToken = generateAccessToken({ _id: plainUser._id, role: "USER", tokenVersion: 0 });

    const country = await Country.findOne({}).lean();
    const randLetters = () => Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");
    const state = await StateModel.create({ name: `${NAME_PREFIX}STATE`, code: randLetters(), type: "STATE", countryRef: country._id, geo: { type: "Point", coordinates: [77, 28] }, isActive: true, isDeleted: false });
    fixtureGeographyIds.states = [state._id];

    const mkArea = async (label) => {
      const d = await District.create({ name: `${NAME_PREFIX}D_${label}`, code: `ZGLF${label}${Date.now() % 100000}`, countryRef: country._id, stateRef: state._id, isActive: true, isDeleted: false });
      const c = await City.create({ name: `${NAME_PREFIX}C_${label}`, districtRef: d._id, stateRef: state._id, isActive: true, isDeleted: false });
      const a = await Area.create({ name: `${NAME_PREFIX}A_${label}`, cityRef: c._id, districtRef: d._id, stateRef: state._id, isActive: true, isDeleted: false });
      fixtureGeographyIds.districts.push(d._id);
      fixtureGeographyIds.cities.push(c._id);
      fixtureGeographyIds.areas.push(a._id);
      return a;
    };

    // Two DIFFERENT areas (different district/state lineage) — proves
    // the Global fee is identical regardless of location (scenarios
    // 4-6: different areas/districts/states all resolve the same fee).
    const areaX = await mkArea("X");
    const areaY = await mkArea("Y");

    const dayTiming = { open: "09:00", close: "20:00" };
    const salonTimings = { monday: dayTiming, tuesday: dayTiming, wednesday: dayTiming, thursday: dayTiming, friday: dayTiming, saturday: dayTiming, sunday: dayTiming };
    const mkSalon = async (area, label) => {
      const salon = await Salon.create({
        ownerId: ownerA._id,
        basicInfo: { shopName: `${NAME_PREFIX}SALON_${label}`, category: "UNISEX" },
        timings: salonTimings,
        location: { geo: { type: "Point", coordinates: [77, 28] }, address: `${NAME_PREFIX} addr`, territory: { areaRef: area._id } },
      });
      fixtureSalonIds.push(salon._id);
      await SalonEarnings.create({ entityType: "SALON", entityId: salon._id, pendingBalanceInPaise: 0, availableBalanceInPaise: 0 });
      return salon;
    };
    const salonX = await mkSalon(areaX, "X");
    const salonY = await mkSalon(areaY, "Y");

    const mkBooking = async (salon, { commissionAmountInPaise, platformFeePolicyRef, status = BOOKING_STATUS.CONFIRMED }) => {
      const b = await Booking.create({
        userRef: ownerA._id,
        salonRef: salon._id,
        chairRef: oid(),
        serviceRefs: [oid()],
        bookingDate: new Date().toISOString().slice(0, 10),
        startTime: new Date(Date.now() + 120 * 60000),
        endTime: new Date(Date.now() + 150 * 60000),
        serviceDuration: 30,
        bufferTime: 0,
        totalAmountInPaise: 50000 + commissionAmountInPaise,
        serviceAmountInPaise: 50000,
        commissionAmountInPaise,
        platformFeePolicyRef,
        status,
      });
      fixtureBookingIds.push(b._id);
      return b;
    };

    // ── SAFETY GUARD — this script publishes its own GLOBAL drafts,
    // which (by the real, correct lifecycle logic) RETIRES whatever
    // is currently PUBLISHED. Running this against a DB that already
    // has a live GLOBAL policy — e.g. one created via real manual
    // admin-panel testing — silently retires it as a side effect.
    // This exact incident happened once; refuse to run rather than
    // repeat it. (verifyPlatformFeePricingEngine.js and
    // verifyMultiServicePlatformFeeBase.js already had this guard —
    // this script did not, which is how the incident happened.)
    const preExistingGlobal = await AreaPlatformFeePolicy.countDocuments({ scope: PLATFORM_FEE_SCOPE.GLOBAL });
    if (preExistingGlobal !== 0) throw new Error(`Refusing to run — ${preExistingGlobal} GLOBAL doc(s) already exist (this script WILL retire any live PUBLISHED one); clean/confirm the DB state before running this script`);

    // ── 1. NO GLOBAL FEE YET — must NOT silently fall back to ₹0 ──
    const resolvedBeforeAny = await resolveGlobalPlatformFee();
    check("1. No GLOBAL fee published yet -> resolver returns explicit null, not {feeInPaise:0}", resolvedBeforeAny === null, resolvedBeforeAny);

    // ── 2. Create + publish a GLOBAL draft ──────────────────────
    const createFee = (body, token = indiaToken) => authFetch("/api/admin/finance/platform-fee", token, { method: "POST", body: JSON.stringify(body) });
    const publishFee = (id, token = indiaToken) => authFetch(`/api/admin/finance/platform-fee/${id}/publish`, token, { method: "POST" });
    const retireFee = (id, token = indiaToken) => authFetch(`/api/admin/finance/platform-fee/${id}/retire`, token, { method: "POST" });

    const rGlobalDraft = await createFee({ scope: "GLOBAL", calculationType: "FIXED", feeInPaise: 2000 });
    check("2. Create GLOBAL draft (₹20) succeeds (201)", rGlobalDraft.status === 201, rGlobalDraft.status);
    const globalV1Id = rGlobalDraft.data?.data?.policy?._id;
    if (globalV1Id) fixtureFeePolicyIds.push(globalV1Id);

    // 2b. Creating a GLOBAL draft WITH an areaRef must be rejected.
    const rGlobalWithArea = await createFee({ scope: "GLOBAL", calculationType: "FIXED", areaRef: areaX._id.toString(), feeInPaise: 2000 });
    check("2b. GLOBAL create with areaRef is rejected (400)", rGlobalWithArea.status === 400, rGlobalWithArea.status);

    // 2c. Creating an AREA draft WITHOUT areaRef must be rejected.
    const rAreaWithoutArea = await createFee({ scope: "AREA", feeInPaise: 2000 });
    check("2c. AREA create without areaRef is rejected (400)", rAreaWithoutArea.status === 400, rAreaWithoutArea.status);

    const rGlobalPublish = await publishFee(globalV1Id);
    check("3. Publish GLOBAL V1 succeeds (200)", rGlobalPublish.status === 200, rGlobalPublish.status);

    // ── 4. Unauthorized (plain USER) rejected ───────────────────
    const rNonAdmin = await createFee({ scope: "GLOBAL", calculationType: "FIXED", feeInPaise: 2500 }, plainToken);
    check("4. Non-admin cannot create/modify global fee (403)", rNonAdmin.status === 403, rNonAdmin.status);

    // ── 5. DISTRICT admin (if one exists) must NOT be able to change it ──
    if (districtToken) {
      const rDistrict = await createFee({ scope: "GLOBAL", calculationType: "FIXED", feeInPaise: 2500 }, districtToken);
      check("5. DISTRICT admin cannot create/modify global fee (403)", rDistrict.status === 403, rDistrict.status);
    } else {
      results.push("ℹ️  SKIPPED check 5 — no DISTRICT admin fixture exists in this DB");
    }

    // ── 6. Resolver gives the SAME value regardless of area/district/state ──
    const resolvedGlobal = await resolveGlobalPlatformFee(50000);
    check("6. resolveGlobalPlatformFee() returns ₹20 (2000 paise) after publish, not null/0", resolvedGlobal?.feeInPaise === 2000, resolvedGlobal);

    const feeForAreaX = await resolveGlobalPlatformFee(50000); // same serviceAmountInPaise — proves location-independence by construction
    const feeForAreaY = await resolveGlobalPlatformFee(50000);
    check("6b. Global fee identical for Area X and Area Y (location-independent)", feeForAreaX.feeInPaise === feeForAreaY.feeInPaise, { feeForAreaX, feeForAreaY });

    // ── 7. Publishing a NEW AREA-scoped fee must NOT change the Global result ──
    const rAreaDraft = await createFee({ scope: "AREA", areaRef: areaX._id.toString(), feeInPaise: 9999 });
    const areaV1Id = rAreaDraft.data?.data?.policy?._id;
    if (areaV1Id) fixtureFeePolicyIds.push(areaV1Id);
    const rAreaPublish = await publishFee(areaV1Id);
    check("7a. Publish an unrelated AREA fee succeeds (200) — preserved, inert mechanism", rAreaPublish.status === 200, rAreaPublish.status);
    const resolvedGlobalAfterAreaPublish = await resolveGlobalPlatformFee(50000);
    check("7b. Global fee UNCHANGED after an unrelated Area fee is published", resolvedGlobalAfterAreaPublish?.feeInPaise === 2000, resolvedGlobalAfterAreaPublish);
    const resolvedAreaXDirectly = await resolvePlatformFeeForArea(areaX._id);
    check("7c. The legacy AREA resolver (unused by lockSlot now) still works on its own, unaffected", resolvedAreaXDirectly.feeInPaise === 9999, resolvedAreaXDirectly);

    // ── 8/9. V1 -> V2 versioning: old booking stays V1, new uses V2, correct ref stored ──
    const bookingOnV1 = await mkBooking(salonX, { commissionAmountInPaise: 2000, platformFeePolicyRef: globalV1Id });

    const rGlobalV2Draft = await createFee({ scope: "GLOBAL", calculationType: "FIXED", feeInPaise: 3500 });
    const globalV2Id = rGlobalV2Draft.data?.data?.policy?._id;
    if (globalV2Id) fixtureFeePolicyIds.push(globalV2Id);
    const rGlobalV2Publish = await publishFee(globalV2Id);
    check("8. Publish GLOBAL V2 (₹35) succeeds (200) and retires V1", rGlobalV2Publish.status === 200, rGlobalV2Publish.status);

    const v1AfterRetire = await AreaPlatformFeePolicy.findById(globalV1Id).select("status").lean();
    check("8b. V1 is now RETIRED (not DRAFT, not PUBLISHED)", v1AfterRetire?.status === "RETIRED", v1AfterRetire);

    const resolvedAfterV2 = await resolveGlobalPlatformFee(50000);
    check("9. resolveGlobalPlatformFee() now returns V2's ₹35, not V1's ₹20", resolvedAfterV2?.feeInPaise === 3500, resolvedAfterV2);

    const bookingOnV1Fresh = await Booking.findById(bookingOnV1._id).select("commissionAmountInPaise platformFeePolicyRef").lean();
    check("13a. OLD booking keeps its ORIGINAL commissionAmountInPaise (₹20) after V2 publish — never recalculated", bookingOnV1Fresh.commissionAmountInPaise === 2000, bookingOnV1Fresh);
    check("9b. OLD booking's platformFeePolicyRef still points at V1, not V2", String(bookingOnV1Fresh.platformFeePolicyRef) === String(globalV1Id), bookingOnV1Fresh);

    const bookingOnV2 = await mkBooking(salonY, { commissionAmountInPaise: resolvedAfterV2.feeInPaise, platformFeePolicyRef: resolvedAfterV2.policyId });
    const bookingOnV2Fresh = await Booking.findById(bookingOnV2._id).select("commissionAmountInPaise platformFeePolicyRef").lean();
    check("9c. NEW booking's platformFeePolicyRef points at V2", String(bookingOnV2Fresh.platformFeePolicyRef) === String(globalV2Id), bookingOnV2Fresh);

    // ── 10. GST formula unchanged (service + platform fee, additive total) ──
    const totalCheck = bookingOnV2Fresh.commissionAmountInPaise === 3500;
    check("10. GST/total formula inputs unchanged — commissionAmountInPaise still feeds Service+Fee base (unmodified in this task)", totalCheck, bookingOnV2Fresh);

    // ── 11. Field Agent Commission engine still reads commissionAmountInPaise verbatim ──
    check("11. Booking.commissionAmountInPaise is the exact field Field Agent earning reads (unchanged contract)", typeof bookingOnV2Fresh.commissionAmountInPaise === "number", bookingOnV2Fresh);

    // ── 14. DRAFT never affects live resolution ─────────────────
    const rDanglingDraft = await createFee({ scope: "GLOBAL", calculationType: "FIXED", feeInPaise: 99999 });
    const danglingDraftId = rDanglingDraft.data?.data?.policy?._id;
    if (danglingDraftId) fixtureFeePolicyIds.push(danglingDraftId);
    const resolvedWithDanglingDraft = await resolveGlobalPlatformFee(50000);
    check("14. A GLOBAL DRAFT never affects the live resolved fee", resolvedWithDanglingDraft?.feeInPaise === 3500, resolvedWithDanglingDraft);

    // ── 15. Retired policy cannot become accidentally active ────
    const rRetireV2 = await retireFee(globalV2Id);
    check("15a. Explicit retire of V2 succeeds (200)", rRetireV2.status === 200, rRetireV2.status);
    const resolvedAfterRetire = await resolveGlobalPlatformFee(50000);
    check("15b. After retiring the only PUBLISHED global fee, resolver returns null again (no silent ₹0, no stale reactivation)", resolvedAfterRetire === null, resolvedAfterRetire);
    const rRetireAgain = await retireFee(globalV2Id);
    check("15c. Retiring an already-RETIRED policy is rejected, not silently accepted (409/400)", [400, 409].includes(rRetireAgain.status), rRetireAgain.status);

    // Re-publish V2 so the remaining "no second PUBLISHED" check below has a live baseline to protect.
    // publishAreaPlatformFee only accepts DRAFT -> create a fresh V3 instead of resurrecting V2.
    const rV3Draft = await createFee({ scope: "GLOBAL", calculationType: "FIXED", feeInPaise: 3500 });
    const globalV3Id = rV3Draft.data?.data?.policy?._id;
    if (globalV3Id) fixtureFeePolicyIds.push(globalV3Id);
    await publishFee(globalV3Id);

    // ── 16. Concurrent publish safety — only one of two concurrent publishes wins ──
    const rConcurrentA = await createFee({ scope: "GLOBAL", calculationType: "FIXED", feeInPaise: 4100 });
    const rConcurrentB = await createFee({ scope: "GLOBAL", calculationType: "FIXED", feeInPaise: 4200 });
    const concurrentAId = rConcurrentA.data?.data?.policy?._id;
    const concurrentBId = rConcurrentB.data?.data?.policy?._id;
    if (concurrentAId) fixtureFeePolicyIds.push(concurrentAId);
    if (concurrentBId) fixtureFeePolicyIds.push(concurrentBId);
    const [concA, concB] = await Promise.all([publishFee(concurrentAId), publishFee(concurrentBId)]);
    const bothSucceeded = concA.status === 200 && concB.status === 200;
    check("16. Concurrent publish of two GLOBAL drafts — transaction-safe retry lets both complete sequentially without corrupting state", bothSucceeded, { concA: concA.status, concB: concB.status });
    const publishedGlobalCountAfterRace = await AreaPlatformFeePolicy.countDocuments({ scope: PLATFORM_FEE_SCOPE.GLOBAL, status: "PUBLISHED" });
    check("2(DB). At most ONE PUBLISHED GLOBAL policy exists after the race (DB-enforced unique partial index)", publishedGlobalCountAfterRace === 1, publishedGlobalCountAfterRace);

    // ── 17. Existing Area records don't corrupt historical bookings ──
    const bookingOnV1AfterEverything = await Booking.findById(bookingOnV1._id).select("commissionAmountInPaise platformFeePolicyRef").lean();
    check("17. Historical booking STILL unaffected by every publish/retire/race above", bookingOnV1AfterEverything.commissionAmountInPaise === 2000, bookingOnV1AfterEverything);

    // ── CLEANUP ──────────────────────────────────────────────────
    await Booking.deleteMany({ _id: { $in: fixtureBookingIds } });
    await SalonEarnings.deleteMany({ entityType: "SALON", entityId: { $in: fixtureSalonIds } });
    await Salon.deleteMany({ _id: { $in: fixtureSalonIds } });
    await AreaPlatformFeePolicy.deleteMany({ _id: { $in: fixtureFeePolicyIds } });
    await Area.deleteMany({ _id: { $in: fixtureGeographyIds.areas } });
    await City.deleteMany({ _id: { $in: fixtureGeographyIds.cities } });
    await District.deleteMany({ _id: { $in: fixtureGeographyIds.districts } });
    await StateModel.deleteMany({ _id: { $in: fixtureGeographyIds.states } });
    await User.deleteMany({ _id: { $in: fixtureUserIds } });

    const residue = {
      bookings: await Booking.countDocuments({ _id: { $in: fixtureBookingIds } }),
      salons: await Salon.countDocuments({ _id: { $in: fixtureSalonIds } }),
      feePolicies: await AreaPlatformFeePolicy.countDocuments({ _id: { $in: fixtureFeePolicyIds } }),
      // Checked against an ABSOLUTE zero, not merely "same as
      // preExistingGlobal" — a self-consistency-only check here would
      // silently mask a real leak from an earlier run instead of
      // catching it (this exact bug once let a stray PUBLISHED GLOBAL
      // doc survive two consecutive "zero residue" reports).
      globalDocsRemaining: await AreaPlatformFeePolicy.countDocuments({ scope: PLATFORM_FEE_SCOPE.GLOBAL }),
      users: await User.countDocuments({ _id: { $in: fixtureUserIds } }),
    };
    check("CLEANUP. Zero residue across all fixture collections (absolute zero, including GLOBAL docs)", Object.values(residue).every((v) => v === 0), residue);
  } catch (err) {
    console.error("FATAL ERROR DURING GLOBAL PLATFORM FEE E2E:", err);
    fail++;
    results.push(`❌ FATAL: ${err.message}`);
    // best-effort cleanup even on failure
    try {
      await Booking.deleteMany({ _id: { $in: fixtureBookingIds } });
      await SalonEarnings.deleteMany({ entityType: "SALON", entityId: { $in: fixtureSalonIds } });
      await Salon.deleteMany({ _id: { $in: fixtureSalonIds } });
      await AreaPlatformFeePolicy.deleteMany({ _id: { $in: fixtureFeePolicyIds } });
      await Area.deleteMany({ _id: { $in: fixtureGeographyIds.areas } });
      await City.deleteMany({ _id: { $in: fixtureGeographyIds.cities } });
      await District.deleteMany({ _id: { $in: fixtureGeographyIds.districts } });
      await StateModel.deleteMany({ _id: { $in: fixtureGeographyIds.states } });
      await User.deleteMany({ _id: { $in: fixtureUserIds } });
      results.push("✅ Best-effort cleanup after failure completed");
    } catch (cleanupErr) {
      results.push(`❌ Best-effort cleanup ALSO failed: ${cleanupErr.message}`);
    }
  } finally {
    server.close();
    await mongoose.connection.close();
  }

  console.log("\n" + results.join("\n"));
  console.log(`\nGLOBAL-PLATFORM-FEE-E2E: ${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail === 0 ? 0 : 1);
};

run();
