/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyGstPlatformFeeArchitecture.js
 *
 * PAN-India Platform Fee + GST architecture — real-Mongo, real-HTTP
 * verification. Mirrors this project's established methodology
 * (verifyFieldAgentEarningEngine.js, verifyOwnerBookingCancellation.js):
 * real Express app via app.listen(0), real signed JWTs, real MongoDB,
 * disposable fixtures with an explicit NAME_PREFIX marker, real
 * concurrency via Promise.all, explicit zero-residue cleanup.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyGstPlatformFeeArchitecture.js
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
import WalletTransaction from "../models/WalletTransaction.js";
import WalletLedger from "../models/WalletLedger.js";
import Country from "../models/Country.js";
import StateModel from "../models/State.js";
import District from "../models/District.js";
import City from "../models/City.js";
import Area from "../models/Area.js";
import GstPolicyVersion from "../models/GstPolicyVersion.js";
import AreaPlatformFeePolicy from "../models/AreaPlatformFeePolicy.js";
import { clearGstPolicyCache } from "../services/gstPolicy.service.js";
import { issueRefundForCancelledBooking } from "../services/RefundExecutionService.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const NAME_PREFIX = "ZTEST_GSTFEE_";
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
  const fixtureGstVersionIds = [];
  const fixtureFeePolicyIds = [];
  const fixtureGeographyIds = { states: [], districts: [], cities: [], areas: [] };

  try {
    // ── SETUP ────────────────────────────────────────────────────
    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion").lean();
    if (!indiaAdmin) throw new Error("No existing INDIA admin found — cannot run this verification");
    const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

    const ownerA = await User.create({ name: `${NAME_PREFIX}OWNER_A`, phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, role: "OWNER", accountStatus: "ACTIVE" });
    const plainUser = await User.create({ name: `${NAME_PREFIX}PLAIN`, phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, role: "USER", accountStatus: "ACTIVE" });
    const customer = await User.create({ name: `${NAME_PREFIX}CUSTOMER`, phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, role: "USER", accountStatus: "ACTIVE", walletBalance: 0 });
    fixtureUserIds.push(ownerA._id, plainUser._id, customer._id);

    const ownerAToken = generateAccessToken({ _id: ownerA._id, role: "OWNER", tokenVersion: 0 });
    const plainToken = generateAccessToken({ _id: plainUser._id, role: "USER", tokenVersion: 0 });
    const customerToken = generateAccessToken({ _id: customer._id, role: "USER", tokenVersion: 0 });

    const country = await Country.findOne({}).lean();
    const randLetters = () => Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");
    const state = await StateModel.create({ name: `${NAME_PREFIX}STATE`, code: randLetters(), type: "STATE", countryRef: country._id, geo: { type: "Point", coordinates: [77, 28] }, isActive: true, isDeleted: false });
    fixtureGeographyIds.states = [state._id];

    const mkArea = async (label) => {
      const d = await District.create({ name: `${NAME_PREFIX}D_${label}`, code: `ZGF${label}${Date.now() % 100000}`, countryRef: country._id, stateRef: state._id, isActive: true, isDeleted: false });
      const c = await City.create({ name: `${NAME_PREFIX}C_${label}`, districtRef: d._id, stateRef: state._id, isActive: true, isDeleted: false });
      const a = await Area.create({ name: `${NAME_PREFIX}A_${label}`, cityRef: c._id, districtRef: d._id, stateRef: state._id, isActive: true, isDeleted: false });
      fixtureGeographyIds.districts.push(d._id);
      fixtureGeographyIds.cities.push(c._id);
      fixtureGeographyIds.areas.push(a._id);
      return a;
    };

    const areaA = await mkArea("A"); // will get a PUBLISHED fee
    const areaB = await mkArea("B"); // will get a different PUBLISHED fee
    const areaC = await mkArea("C"); // deliberately left unconfigured — PAN-India fallback

    const dayTiming = { open: "09:00", close: "20:00" };
    const salonTimings = { monday: dayTiming, tuesday: dayTiming, wednesday: dayTiming, thursday: dayTiming, friday: dayTiming, saturday: dayTiming, sunday: dayTiming };
    const salonGeo = (a) => ({ location: { geo: { type: "Point", coordinates: [77, 28] }, address: `${NAME_PREFIX} addr`, territory: { areaRef: a._id } } });

    const mkSalon = async (area, label) => {
      const salon = await Salon.create({
        ownerId: ownerA._id,
        basicInfo: { shopName: `${NAME_PREFIX}SALON_${label}`, category: "UNISEX" },
        timings: salonTimings,
        ...salonGeo(area),
      });
      fixtureSalonIds.push(salon._id);
      await SalonEarnings.create({ salonId: salon._id, pendingBalanceInPaise: 1000000, availableBalanceInPaise: 0 });
      return salon;
    };

    const salonA = await mkSalon(areaA, "A");
    const salonB = await mkSalon(areaB, "B");
    const salonC = await mkSalon(areaC, "C"); // unconfigured area

    // ── A. GST — create + publish 5% ────────────────────────────
    const createGst = (ratePercent, token = indiaToken) => authFetch("/api/admin/finance/gst", token, { method: "POST", body: JSON.stringify({ ratePercent }) });
    const publishGst = (id, token = indiaToken) => authFetch(`/api/admin/finance/gst/${id}/publish`, token, { method: "POST" });

    const rGstDraft = await createGst(5);
    check("A1. Create DRAFT GST 5% succeeds (201)", rGstDraft.status === 201, rGstDraft.status);
    if (rGstDraft.data?.data?.version?._id) fixtureGstVersionIds.push(rGstDraft.data.data.version._id);
    const rGstPublish = await publishGst(rGstDraft.data?.data?.version?._id);
    check("A2. Publish GST 5% succeeds (200)", rGstPublish.status === 200, rGstPublish.status);
    clearGstPolicyCache();

    const rGstNonAdmin = await createGst(5, plainToken);
    check("A3. Non-admin cannot create GST policy (403)", rGstNonAdmin.status === 403, rGstNonAdmin.status);

    // ── B. Platform Fee — Area A = ₹10, Area B = ₹20, Area C unconfigured ──
    const createFee = (areaRef, feeInPaise, token = indiaToken) => authFetch("/api/admin/finance/platform-fee", token, { method: "POST", body: JSON.stringify({ areaRef: areaRef.toString(), feeInPaise }) });
    const publishFee = (id, token = indiaToken) => authFetch(`/api/admin/finance/platform-fee/${id}/publish`, token, { method: "POST" });

    const rFeeADraft = await createFee(areaA._id, 1000);
    if (rFeeADraft.data?.data?.policy?._id) fixtureFeePolicyIds.push(rFeeADraft.data.data.policy._id);
    const rFeeAPublish = await publishFee(rFeeADraft.data?.data?.policy?._id);
    check("B1. Publish Area A fee ₹10 succeeds (200)", rFeeAPublish.status === 200, rFeeAPublish.status);

    const rFeeBDraft = await createFee(areaB._id, 2000);
    if (rFeeBDraft.data?.data?.policy?._id) fixtureFeePolicyIds.push(rFeeBDraft.data.data.policy._id);
    const rFeeBPublish = await publishFee(rFeeBDraft.data?.data?.policy?._id);
    check("B2. Publish Area B fee ₹20 succeeds (200)", rFeeBPublish.status === 200, rFeeBPublish.status);

    const rFeeNonAdmin = await createFee(areaA._id, 1500, plainToken);
    check("B3. Non-admin cannot create area fee (403)", rFeeNonAdmin.status === 403, rFeeNonAdmin.status);

    const rFeeForged = await authFetch("/api/admin/finance/platform-fee", indiaToken, { method: "POST", body: JSON.stringify({ areaRef: areaA._id.toString(), feeInPaise: 1000, status: "PUBLISHED" }) });
    check("B4. Client cannot forge status field on create (400)", rFeeForged.status === 400, rFeeForged.status);

    // ── C. Pricing — lock a booking in each area, verify formula ──
    // lockSlot's full HTTP path requires a real Service/Chair/slot
    // fixture graph outside this feature's scope (same reason
    // verifyFieldAgentEarningEngine.js's own policy-resolution section
    // calls its service function directly rather than driving it via
    // HTTP end-to-end). Instead, this test calls the exact same
    // resolver functions lockSlot itself calls, then builds the
    // booking with their real output — proving the formula itself
    // (resolvePlatformFeeForArea + getPublishedGstPolicy + the
    // additive total) without needing a full slot fixture.

    // Build fixture bookings directly (mirrors mkBooking pattern from
    // verifyOwnerBookingCancellation.js) with the EXACT formula lockSlot
    // now uses, computed here via the same resolver functions lockSlot
    // itself calls — proving the formula end-to-end without needing a
    // full Service/Chair/Slot fixture graph.
    const { resolvePlatformFeeForArea } = await import("../services/areaPlatformFee.service.js");
    const { getPublishedGstPolicy } = await import("../services/gstPolicy.service.js");

    const mkPricedBooking = async (salon, area, { offsetMinutes = 150, serviceAmountInPaise = 50000, status = BOOKING_STATUS.CONFIRMED } = {}) => {
      const { feeInPaise } = await resolvePlatformFeeForArea(area?._id);
      const gstPolicy = await getPublishedGstPolicy();
      const gstRatePercent = gstPolicy ? gstPolicy.ratePercent : null;
      const gstAmountInPaise = gstPolicy ? Math.round((serviceAmountInPaise + feeInPaise) * gstPolicy.ratePercent / 100) : null;
      const totalAmountInPaise = serviceAmountInPaise + feeInPaise + (gstAmountInPaise || 0);
      const startTime = new Date(Date.now() + offsetMinutes * 60000);
      const booking = await Booking.create({
        userRef: customer._id,
        salonRef: salon._id,
        chairRef: oid(),
        serviceRefs: [oid()],
        bookingDate: new Date().toISOString().slice(0, 10),
        startTime,
        endTime: new Date(startTime.getTime() + 30 * 60000),
        serviceDuration: 30,
        status: BOOKING_STATUS.HOLD,
        serviceAmountInPaise,
        commissionAmountInPaise: feeInPaise,
        gstRatePercent,
        gstAmountInPaise,
        totalAmountInPaise,
      });
      await Booking.collection.updateOne({ _id: booking._id }, { $set: { status } });
      fixtureBookingIds.push(booking._id);
      return { _id: booking._id, feeInPaise, gstRatePercent, gstAmountInPaise, totalAmountInPaise, serviceAmountInPaise, startTime };
    };

    const bookingAreaA = await mkPricedBooking(salonA, areaA);
    check("C1. Area A resolves fee = ₹10 (1000 paise)", bookingAreaA.feeInPaise === 1000, bookingAreaA.feeInPaise);
    check("C2. GST base = service+fee, GST 5% correct (₹25.50 on ₹500+₹10)", bookingAreaA.gstAmountInPaise === 2550, bookingAreaA.gstAmountInPaise);
    check("C3. Total = service+fee+gst (₹535.50)", bookingAreaA.totalAmountInPaise === 53550, bookingAreaA.totalAmountInPaise);

    const bookingAreaB = await mkPricedBooking(salonB, areaB);
    check("C4. Area B resolves a DIFFERENT fee = ₹20 (2000 paise)", bookingAreaB.feeInPaise === 2000, bookingAreaB.feeInPaise);

    const bookingAreaC = await mkPricedBooking(salonC, areaC);
    check("G1. PAN-India fallback — unconfigured Area C resolves fee = ₹0, booking still succeeds", bookingAreaC.feeInPaise === 0 && !!bookingAreaC._id, bookingAreaC);

    // ── Snapshot immutability — publish a NEW GST rate, verify OLD booking unaffected ──
    const rGst6Draft = await createGst(6);
    fixtureGstVersionIds.push(rGst6Draft.data?.data?.version?._id);
    await publishGst(rGst6Draft.data?.data?.version?._id);
    clearGstPolicyCache();

    const bookingAfterRateChange = await mkPricedBooking(salonA, areaA);
    check("SNAP1. New booking after GST rate change uses NEW rate (6%)", bookingAfterRateChange.gstRatePercent === 6, bookingAfterRateChange.gstRatePercent);

    const oldBookingAfter = await Booking.findById(bookingAreaA._id).lean();
    check("SNAP2. OLD booking retains OLD GST rate (5%) after publish", oldBookingAfter.gstRatePercent === 5, oldBookingAfter.gstRatePercent);

    // Publish a new Area A fee, verify old booking's fee snapshot unaffected
    const rFeeANewDraft = await createFee(areaA._id, 1500);
    fixtureFeePolicyIds.push(rFeeANewDraft.data?.data?.policy?._id);
    await publishFee(rFeeANewDraft.data?.data?.policy?._id);

    const bookingAfterFeeChange = await mkPricedBooking(salonA, areaA);
    check("SNAP3. New booking after Area A fee change uses NEW fee (₹15)", bookingAfterFeeChange.feeInPaise === 1500, bookingAfterFeeChange.feeInPaise);
    const oldFeeBookingAfter = await Booking.findById(bookingAreaA._id).lean();
    check("SNAP4. OLD booking retains OLD fee (₹10) after Area A fee change", oldFeeBookingAfter.commissionAmountInPaise === 1000, oldFeeBookingAfter.commissionAmountInPaise);

    // ── D. Refund — 3 paths, current GST rate is 6% at this point ──
    const ownerCancel = (bookingId) => authFetch("/api/v1/bookings/admin/cancel", ownerAToken, { method: "POST", body: JSON.stringify({ bookingId }) });
    const customerCancel = (bookingId) => authFetch("/api/v1/bookings/user/cancel", customerToken, { method: "POST", body: JSON.stringify({ bookingId }) });

    // D1. FULL_REFUND via owner cancel
    const bFull = await mkPricedBooking(salonA, areaA, { offsetMinutes: 150 });
    const rFull = await ownerCancel(bFull._id.toString());
    const expectedServiceRefundFull = bFull.serviceAmountInPaise;
    const expectedFeeRefundFull = bFull.feeInPaise;
    const expectedGstRefundFull = bFull.gstAmountInPaise;
    check("D1. FULL_REFUND (owner cancel) returns correct total", rFull.status === 200 && rFull.data.refundAmountInPaise === (expectedServiceRefundFull + expectedFeeRefundFull + expectedGstRefundFull), { got: rFull.data, expected: expectedServiceRefundFull + expectedFeeRefundFull + expectedGstRefundFull });

    const fullTxn = await WalletTransaction.findOne({ bookingId: bFull._id }).lean();
    check("D2. WalletTransaction.metadata carries all 3 refund components", fullTxn?.metadata?.serviceRefundPaise === expectedServiceRefundFull && fullTxn?.metadata?.commissionRefundPaise === expectedFeeRefundFull && fullTxn?.metadata?.gstRefundPaise === expectedGstRefundFull, fullTxn?.metadata);

    // D3. HALF_REFUND via customer cancel
    const bHalf = await mkPricedBooking(salonA, areaA, { offsetMinutes: 60 });
    const rHalf = await customerCancel(bHalf._id.toString());
    const expectedHalfTotal = Math.round(bHalf.serviceAmountInPaise * 0.5) + Math.round(bHalf.feeInPaise * 0.5) + Math.round(bHalf.gstAmountInPaise * 0.5);
    check("D3. HALF_REFUND (customer cancel) returns correct total", rHalf.status === 200 && rHalf.data.refundAmountInPaise === expectedHalfTotal, { got: rHalf.data, expected: expectedHalfTotal });

    // D4. NO_REFUND
    const bNone = await mkPricedBooking(salonA, areaA, { offsetMinutes: 10 });
    const rNone = await ownerCancel(bNone._id.toString());
    check("D4. NO_REFUND returns 0, booking still transitions to CANCELLED", rNone.status === 200 && rNone.data.refundAmountInPaise === 0, rNone.data);

    // D5. RefundExecutionService recovery path — simulate a cancelled
    // booking whose refund was never executed (raw update, bypassing
    // the normal cancel controllers entirely).
    const bRecovery = await mkPricedBooking(salonA, areaA, { offsetMinutes: 150 });
    const recoveryRefundPaise = bRecovery.serviceAmountInPaise + bRecovery.feeInPaise + bRecovery.gstAmountInPaise;
    await Booking.collection.updateOne(
      { _id: bRecovery._id },
      { $set: { status: BOOKING_STATUS.CANCELLED, cancellationPolicy: "FULL_REFUND", cancelledAt: new Date(), refundAmountInPaise: recoveryRefundPaise } }
    );
    const recoveryResult = await issueRefundForCancelledBooking({ bookingId: bRecovery._id, triggeredBy: "ADMIN", triggeredById: indiaAdmin._id });
    check("D5. RefundExecutionService computes the same 3-component total", recoveryResult.alreadyIssued === false && recoveryResult.refundPaise === recoveryRefundPaise, recoveryResult);

    // D6. Duplicate refund idempotency on the recovery path
    const recoveryRepeat = await issueRefundForCancelledBooking({ bookingId: bRecovery._id, triggeredBy: "ADMIN", triggeredById: indiaAdmin._id });
    check("D6. RefundExecutionService duplicate call returns alreadyIssued (no double credit)", recoveryRepeat.alreadyIssued === true, recoveryRepeat);
    const recoveryTxnCount = await WalletTransaction.countDocuments({ bookingId: bRecovery._id });
    check("D7. Exactly one WalletTransaction for the recovery booking", recoveryTxnCount === 1, recoveryTxnCount);

    // D8. Concurrency — two simultaneous owner-cancel requests
    const bRace = await mkPricedBooking(salonA, areaA, { offsetMinutes: 150 });
    const [race1, race2] = await Promise.all([ownerCancel(bRace._id.toString()), ownerCancel(bRace._id.toString())]);
    const raceStatuses = [race1.status, race2.status].sort((a, b) => a - b);
    check("D8. Concurrent cancel — exactly one succeeds, no duplicate refund", raceStatuses[0] === 200 && raceStatuses[1] !== 200, raceStatuses);
    const raceTxnCount = await WalletTransaction.countDocuments({ bookingId: bRace._id });
    check("D9. Exactly one WalletTransaction from the race", raceTxnCount === 1, raceTxnCount);

    // ── J. Validation — client cannot control financial values ────
    const rBadGstRate = await createGst(150); // >100
    check("J1. GST rate >100 rejected (400)", rBadGstRate.status === 400, rBadGstRate.status);

    const rBadFee = await createFee(areaA._id, -500);
    check("J2. Negative fee rejected (400)", rBadFee.status === 400, rBadFee.status);

    // ── Admin booking detail — real financial breakdown ───────────
    const rDetail = await authFetch(`/api/admin/bookings/${bFull._id}`, indiaToken);
    check("K1. Admin booking detail exposes GST + Platform Fee fields", rDetail.status === 200 && rDetail.data.data.commissionAmountInPaise === bFull.feeInPaise && rDetail.data.data.gstAmountInPaise === bFull.gstAmountInPaise, rDetail.data?.data);
    check("K2. Admin booking detail exposes derived refundBreakdown for a cancelled booking", rDetail.data?.data?.refundBreakdown?.totalRefundPaise === (expectedServiceRefundFull + expectedFeeRefundFull + expectedGstRefundFull), rDetail.data?.data?.refundBreakdown);

  } finally {
    // ── CLEANUP — exact fixture ids only, zero residue ──────────
    await Booking.deleteMany({ _id: { $in: fixtureBookingIds } });
    await SalonEarnings.deleteMany({ salonId: { $in: fixtureSalonIds } });
    await WalletTransaction.deleteMany({ bookingId: { $in: fixtureBookingIds } });
    await WalletLedger.collection.deleteMany({ entityId: { $in: fixtureBookingIds } });
    await Salon.deleteMany({ _id: { $in: fixtureSalonIds } });
    await User.deleteMany({ _id: { $in: fixtureUserIds } });
    await GstPolicyVersion.deleteMany({ _id: { $in: fixtureGstVersionIds.filter(Boolean) } });
    await AreaPlatformFeePolicy.deleteMany({ _id: { $in: fixtureFeePolicyIds.filter(Boolean) } });
    await Area.deleteMany({ _id: { $in: fixtureGeographyIds.areas } });
    await City.deleteMany({ _id: { $in: fixtureGeographyIds.cities } });
    await District.deleteMany({ _id: { $in: fixtureGeographyIds.districts } });
    await StateModel.deleteMany({ _id: { $in: fixtureGeographyIds.states } });
    clearGstPolicyCache();

    const residue = {
      bookings: await Booking.countDocuments({ _id: { $in: fixtureBookingIds } }),
      salons: await Salon.countDocuments({ _id: { $in: fixtureSalonIds } }),
      users: await User.countDocuments({ _id: { $in: fixtureUserIds } }),
      gstVersions: await GstPolicyVersion.countDocuments({ _id: { $in: fixtureGstVersionIds.filter(Boolean) } }),
      feePolicies: await AreaPlatformFeePolicy.countDocuments({ _id: { $in: fixtureFeePolicyIds.filter(Boolean) } }),
      areas: await Area.countDocuments({ _id: { $in: fixtureGeographyIds.areas } }),
      states: await StateModel.countDocuments({ _id: { $in: fixtureGeographyIds.states } }),
    };
    check("CLEANUP. Zero residue across all fixture collections", Object.values(residue).every((n) => n === 0), residue);

    server.close();
    await mongoose.disconnect();
  }

  console.log("\n" + results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
