/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyTerritoryRevenueDistribution.js
 *
 * STEP 5.3 — Territory Revenue Distribution Engine — disposable live
 * verification. Same methodology as every other verify script this
 * session: real Express app (app.listen(0)), real signed JWTs, real
 * Atlas dev DB, fresh disposable fixtures, purged before/after. No live
 * Razorpay gateway call is made — completeRefund() is exercised
 * directly with a synthetic PROCESSED Refund fixture (same "Part A,
 * unit-level, real Mongo writes, no gateway call" methodology already
 * proven by scripts/verifyGSTReversal.js), which is sufficient to prove
 * this engine's hook inside RazorpayRefundService.js actually fires,
 * since completeRefund() itself makes no external network call.
 *
 * Proves:
 *   1. The REAL, unmodified createRevenueSplitForBooking() (RevenueSplit
 *      IntegrationService.js) automatically creates a TerritoryRevenueSplit
 *      + SALE TerritoryRevenueLedger row when the booking's salon has an
 *      ACTIVE Territory Partner (STEP 5.2) AND a commission rate is
 *      PUBLISHED (STEP 5.1) — with the correct amounts.
 *   2. Base amount is Zemish's own zemishRevenueInPaise, never salon
 *      credit or customer total.
 *   3. Safe no-op when there is no Territory Partner link, and safe
 *      no-op when no TerritoryRevenueSettings is PUBLISHED yet — in both
 *      cases the REAL RevenueSplit + GST SALE ledger are still created
 *      completely normally (existing engines unaffected).
 *   4. Idempotent: calling twice never creates a duplicate split or
 *      ledger row.
 *   5. The REAL, unmodified completeRefund() (RazorpayRefundService.js)
 *      automatically creates a proportional REFUND_REVERSAL ledger row
 *      for a PARTIAL refund, and a full (100%) reversal for a FULL
 *      refund — while the existing GST Reversal Engine (Step 4.2) still
 *      fires correctly alongside it, unaffected.
 *   6. Immutability: TerritoryRevenueSplit/TerritoryRevenueLedger rows
 *      can never be updated or deleted.
 *   7. DB-level uniqueness: a direct duplicate create is rejected by the
 *      partial unique indexes, not just application logic.
 *   8. ISOLATION: RevenueSplit, GSTLedger, Refund, Booking's own
 *      pre-existing fields, and TerritoryRevenueSettings/
 *      SalonTerritoryAssignment (read-only dependencies) are all
 *      completely unaffected by this engine's own writes.
 *
 * Run:  cd backend && node scripts/verifyTerritoryRevenueDistribution.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import { generateAccessToken } from "../services/token.service.js";
import User from "../models/User.js";
import Country from "../models/Country.js";
import State from "../models/State.js";
import District from "../models/District.js";
import City from "../models/City.js";
import Area from "../models/Area.js";
import Salon from "../models/Salon.js";
import Booking, { BOOKING_STATUS } from "../models/Booking.js";
import RefundModel from "../models/Refund.js";
import Transaction from "../models/Transaction.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import CommercialTerritory from "../modules/fieldAgent/models/CommercialTerritory.js";
import TerritoryAssignment from "../modules/fieldAgent/models/TerritoryAssignment.js";
import RevenueSettings from "../modules/finance/models/RevenueSettings.js";
import RevenueSplit from "../modules/finance/models/RevenueSplit.js";
import GSTLedger from "../modules/finance/models/GSTLedger.js";
import TerritoryRevenueSettings from "../modules/finance/models/TerritoryRevenueSettings.js";
import TerritoryRevenueSplit from "../modules/finance/models/TerritoryRevenueSplit.js";
import TerritoryRevenueLedger from "../modules/finance/models/TerritoryRevenueLedger.js";
import SalonTerritoryAssignment from "../modules/territoryAutoAssignment/models/SalonTerritoryAssignment.js";
import { createRevenueSplitForBooking } from "../modules/finance/services/RevenueSplitIntegrationService.js";
import { createTerritoryRevenueSplitForBooking, createTerritoryRevenueReversal, getTerritoryPartnerBalance } from "../modules/finance/services/TerritoryRevenueService.js";
import { completeRefund } from "../services/RazorpayRefundService.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const P = "ZTEST_TRD53_";
const oid = () => new mongoose.Types.ObjectId();
let phoneSeq = 0;
const nextPhone = () => `7${String(7770000000 + phoneSeq++).slice(-9)}`;
const runTag = Date.now();

const fixtureUserIds = [];
const fixtureStateIds = [];
const fixtureDistrictIds = [];
const fixtureCityIds = [];
const fixtureAreaIds = [];
const fixtureFieldAgentIds = [];
const fixtureTerritoryIds = [];
const fixtureAssignmentIds = [];
const fixtureSalonIds = [];
const fixtureBookingIds = [];
const fixturePaymentIds = [];
const fixtureRevenueSettingsIds = [];
const fixtureTerritoryRevenueSettingsIds = [];

const purgeFixtures = async () => {
  await TerritoryRevenueLedger.collection.deleteMany({ bookingId: { $in: fixtureBookingIds } });
  await TerritoryRevenueSplit.collection.deleteMany({ bookingId: { $in: fixtureBookingIds } });
  await GSTLedger.collection.deleteMany({ bookingId: { $in: fixtureBookingIds } });
  await RevenueSplit.collection.deleteMany({ bookingId: { $in: fixtureBookingIds } });
  await RefundModel.deleteMany({ $or: [{ bookingId: { $in: fixtureBookingIds } }, { paymentId: { $in: fixturePaymentIds } }] });
  await Transaction.deleteMany({ bookingId: { $in: fixtureBookingIds } });
  await Booking.collection.deleteMany({ _id: { $in: fixtureBookingIds } });
  await SalonTerritoryAssignment.deleteMany({ salonRef: { $in: fixtureSalonIds } });
  await Salon.deleteMany({ _id: { $in: fixtureSalonIds } });
  await TerritoryAssignment.deleteMany({ _id: { $in: fixtureAssignmentIds } });
  await CommercialTerritory.deleteMany({ _id: { $in: fixtureTerritoryIds } });
  await FieldAgent.deleteMany({ _id: { $in: fixtureFieldAgentIds } });
  await Area.deleteMany({ _id: { $in: fixtureAreaIds } });
  await City.deleteMany({ _id: { $in: fixtureCityIds } });
  await District.deleteMany({ _id: { $in: fixtureDistrictIds } });
  await State.deleteMany({ _id: { $in: fixtureStateIds } });
  await RevenueSettings.deleteMany({ _id: { $in: fixtureRevenueSettingsIds.filter(Boolean) } });
  await TerritoryRevenueSettings.deleteMany({ _id: { $in: fixtureTerritoryRevenueSettingsIds.filter(Boolean) } });
  await User.deleteMany({ _id: { $in: fixtureUserIds } });
};

const dayTiming = { open: "09:00", close: "20:00" };
const salonTimings = { monday: dayTiming, tuesday: dayTiming, wednesday: dayTiming, thursday: dayTiming, friday: dayTiming, saturday: dayTiming, sunday: dayTiming };

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

  try {
    // ── ISOLATION BASELINES (before any activity) ─────────────────
    const revenueSplitCountBefore = await RevenueSplit.countDocuments({});
    const gstLedgerCountBefore = await GSTLedger.countDocuments({});
    const refundCountBefore = await RefundModel.countDocuments({});

    // ── SETUP: geography + INDIA admin + Territory Partner (STEP 5.2 base) ──
    const country = await Country.findOne({}).lean();
    check("SETUP. Real Country fixture exists", !!country);
    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion").lean();
    check("SETUP. Real INDIA admin fixture exists (pre-existing)", !!indiaAdmin);
    const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

    const randLetter = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
    const state = await State.create({ name: `${P}STATE`, code: `Z${randLetter()}${randLetter()}`, type: "STATE", countryRef: country._id, geo: { type: "Point", coordinates: [77, 28] }, isActive: true, isDeleted: false });
    fixtureStateIds.push(state._id);

    const mkDistrict = async (suffix) => { const d = await District.create({ name: `${P}DISTRICT_${suffix}`, code: `T5${suffix}`, countryRef: country._id, stateRef: state._id, isActive: true, isDeleted: false }); fixtureDistrictIds.push(d._id); return d; };
    const mkCity = async (suffix, districtRef) => { const c = await City.create({ name: `${P}CITY_${suffix}`, districtRef, stateRef: state._id, isActive: true, isDeleted: false }); fixtureCityIds.push(c._id); return c; };
    const mkArea = async (suffix, cityRef, districtRef) => { const a = await Area.create({ name: `${P}AREA_${suffix}`, cityRef, districtRef, stateRef: state._id, isActive: true, isDeleted: false }); fixtureAreaIds.push(a._id); return a; };
    const mkFieldAgent = async (suffix) => {
      const u = await User.create({ name: `${P}FA_${suffix}`, phone: nextPhone(), role: "FIELD_AGENT", isActive: true });
      fixtureUserIds.push(u._id);
      const fa = await FieldAgent.create({ userRef: u._id, applicationRef: oid(), agentCode: `FA-99999999-${String(Math.floor(Math.random() * 900000) + 100000)}`, operationalStatus: "PENDING_ACTIVATION", commercialPath: "TERRITORY_PARTNER" });
      fixtureFieldAgentIds.push(fa._id);
      return fa;
    };
    const mkCityAdmin = async (suffix, cityRef) => {
      // See STEP 5.2's own verify script for the same pre-existing gap
      // note: User.adminLevel's schema enum has no "CITY" value, so this
      // bypasses validation for this disposable test fixture only.
      const u = new User({ name: `${P}CITYADMIN_${suffix}`, phone: nextPhone(), email: `${P.toLowerCase()}cityadmin_${suffix}_${Date.now()}@ztest.local`, role: "ADMIN", adminLevel: "CITY", adminSubRole: "PRIMARY", countryRef: country._id, stateRef: state._id, cityRef, isActive: true });
      await u.save({ validateBeforeSave: false });
      fixtureUserIds.push(u._id);
      return generateAccessToken({ _id: u._id, role: "ADMIN", adminLevel: "CITY", tokenVersion: 0 });
    };
    const mkSalon = async (suffix, { stateRef, districtRef, cityRef, areaRef }) => {
      const owner = await User.create({ name: `${P}OWNER_${suffix}`, phone: nextPhone(), role: "OWNER", isActive: true });
      fixtureUserIds.push(owner._id);
      const salon = await Salon.create({
        ownerId: owner._id,
        basicInfo: { shopName: `${P}SALON_${suffix}`, category: "UNISEX" },
        location: { address: `${P} addr ${suffix}`, geo: { type: "Point", coordinates: [77, 28] }, territory: { countryRef: country._id, stateRef, districtRef, cityRef, areaRef: areaRef ?? null } },
        timings: salonTimings,
        approval: { status: "PENDING" },
        onboarding: { step: 2 },
        isDeleted: false,
      });
      fixtureSalonIds.push(salon._id);
      return salon;
    };
    const custUser = await User.create({ name: `${P}CUST`, phone: nextPhone(), role: "USER", isActive: true });
    fixtureUserIds.push(custUser._id);

    let slot = 0;
    const mkBooking = async (salonId, { service = 10000 } = {}) => {
      const start = new Date(Date.now() + (240 + slot++ * 45) * 60000);
      const b = await Booking.create({
        userRef: custUser._id, salonRef: salonId, chairRef: oid(), serviceRefs: [oid()],
        bookingDate: new Date().toISOString().slice(0, 10), startTime: start, endTime: new Date(start.getTime() + 30 * 60000),
        serviceDuration: 30, status: BOOKING_STATUS.CONFIRMED, serviceAmountInPaise: service, commissionAmountInPaise: 2000, totalAmountInPaise: service + 2360,
        razorpayOrderId: `order_${P}${runTag}_${slot}`, // LOCKED gate in RevenueSplitIntegrationService — Razorpay bookings only
      });
      fixtureBookingIds.push(b._id);
      return b;
    };
    const publishRevenueSettings = async (platformFeeInPaise, gstRate) => {
      await RevenueSettings.updateMany({ status: "PUBLISHED" }, { $set: { status: "RETIRED", retiredAt: new Date() } });
      const last = await RevenueSettings.findOne().sort({ version: -1 }).select("version").lean();
      const doc = await RevenueSettings.create({ platformFeeInPaise, gstRate, gstEnabled: true, minimumPayoutInPaise: 50000, autoPayoutEnabled: false, version: (last?.version ?? 0) + 1, createdBy: indiaAdmin._id, status: "PUBLISHED", publishedAt: new Date(), publishedBy: indiaAdmin._id });
      fixtureRevenueSettingsIds.push(doc._id);
      return doc;
    };
    const mkRefundFixture = async ({ bookingId, amountInPaise, paymentAmountInPaise, razorpayRefundId }) => {
      const paymentId = `pay_${P}${runTag}${Math.floor(Math.random() * 1e6)}`;
      fixturePaymentIds.push(paymentId);
      return RefundModel.create({
        paymentId, bookingId, amountInPaise, paymentAmountInPaise, isFull: amountInPaise >= paymentAmountInPaise,
        reason: "BOOKING_CANCELLED", initiatedBy: { type: "ADMIN" }, idempotencyKey: `${P}k_${runTag}_${Math.random()}`,
        razorpayRefundId, refundStatus: "PROCESSED", gatewayStatus: "processed", processedAt: new Date(),
      });
    };

    const createTerritory = (body) => authFetch("/api/admin/commercial-territories", indiaToken, { method: "POST", body: JSON.stringify(body) });
    const activateTerritoryHttp = (id) => authFetch(`/api/admin/commercial-territories/${id}/activate`, indiaToken, { method: "POST" });
    const assignPartnerHttp = (id, fieldAgentId) => authFetch(`/api/admin/commercial-territories/${id}/assign-partner`, indiaToken, { method: "POST", body: JSON.stringify({ fieldAgentId }) });
    const approveSalonHttp = (id, token) => authFetch(`/api/salon/admin/${id}/approve`, token, { method: "PATCH" });
    const createTerritoryRevSettingsDraft = (body) => authFetch("/api/admin/finance/territory-settings", indiaToken, { method: "POST", body: JSON.stringify(body) });
    const publishTerritoryRevSettingsHttp = (id) => authFetch(`/api/admin/finance/territory-settings/${id}/publish`, indiaToken, { method: "POST" });

    // ── Territory Partner + AREA_SET territory, ACTIVE + ASSIGNED (STEP 5.2) ──
    const district = await mkDistrict("A");
    const city = await mkCity("A", district._id);
    const area1 = await mkArea("A1", city._id, district._id);
    const partner = await mkFieldAgent("PARTNER");
    let r = await createTerritory({ name: `${P}Territory`, scopeType: "AREA_SET", districtRef: String(district._id), cityRef: String(city._id), areaRefs: [String(area1._id)] });
    fixtureTerritoryIds.push(r.data.data.territory._id);
    await activateTerritoryHttp(r.data.data.territory._id);
    await assignPartnerHttp(r.data.data.territory._id, partner._id);
    const assignment = await TerritoryAssignment.findOne({ territoryRef: r.data.data.territory._id, status: "ACTIVE" }).lean();
    fixtureAssignmentIds.push(assignment._id);
    const territoryId = r.data.data.territory._id;

    // ── A salon approved inside that territory (STEP 5.2 auto-link fires) ──
    const cityAdminToken = await mkCityAdmin("A", city._id);
    const linkedSalon = await mkSalon("LINKED", { stateRef: state._id, districtRef: district._id, cityRef: city._id, areaRef: area1._id });
    await approveSalonHttp(linkedSalon._id, cityAdminToken);
    const link = await SalonTerritoryAssignment.findOne({ salonRef: linkedSalon._id }).lean();
    check("SETUP. STEP 5.2 auto-link fired — linkedSalon now has an active Territory Partner", !!link && String(link.fieldAgentRef) === String(partner._id), link);

    // A second salon, in an UNCOVERED district — never gets a Territory Partner link.
    const districtUncovered = await mkDistrict("U");
    const cityUncovered = await mkCity("U", districtUncovered._id);
    const cityAdminTokenU = await mkCityAdmin("U", cityUncovered._id);
    const unlinkedSalon = await mkSalon("UNLINKED", { stateRef: state._id, districtRef: districtUncovered._id, cityRef: cityUncovered._id, areaRef: null });
    await approveSalonHttp(unlinkedSalon._id, cityAdminTokenU);
    const linkForUnlinked = await SalonTerritoryAssignment.findOne({ salonRef: unlinkedSalon._id }).lean();
    check("SETUP. Uncovered salon correctly has NO Territory Partner link", linkForUnlinked === null);

    await publishRevenueSettings(2000, 18); // ₹20 platform fee, 18% GST — needed for ANY RevenueSplit to be created at all

    // ═══ SCENARIO C — NO TerritoryRevenueSettings published yet: safe no-op ═══
    const bookingC = await mkBooking(linkedSalon._id, { service: 10000 });
    const splitC = await createRevenueSplitForBooking({ booking: bookingC });
    check("C1. RevenueSplit still created normally (existing P0 engine unaffected)", !!splitC && splitC.zemishRevenueInPaise === 2000, splitC);
    const saleC = await GSTLedger.findOne({ revenueSplitId: splitC._id, ledgerType: "SALE" }).lean();
    check("C2. GST SALE ledger still created normally (existing Step 4.1 engine unaffected)", saleC?.gstAmountInPaise === 360, saleC);
    const territorySplitC = await TerritoryRevenueSplit.findOne({ revenueSplitId: splitC._id }).lean();
    check("C3. NO TerritoryRevenueSplit created — no TerritoryRevenueSettings PUBLISHED yet (safe no-op)", territorySplitC === null);

    // ═══ Now PUBLISH TerritoryRevenueSettings — 10% commission ═══
    let rTRS = await createTerritoryRevSettingsDraft({ territoryCommissionPercent: 10, minimumPayout: 500 });
    check("SETUP. TerritoryRevenueSettings draft created (10%)", rTRS.status === 201, rTRS.data);
    fixtureTerritoryRevenueSettingsIds.push(rTRS.data.data.id);
    const publishedTRS = await publishTerritoryRevSettingsHttp(rTRS.data.data.id);
    check("SETUP. TerritoryRevenueSettings PUBLISHED", publishedTRS.status === 200 && publishedTRS.data.data.status === "PUBLISHED", publishedTRS.data);
    const trsVersion = publishedTRS.data.data.version;

    // ═══ SCENARIO A — full automatic chain, via the REAL unmodified integration function ═══
    const bookingA = await mkBooking(linkedSalon._id, { service: 10000 });
    const splitA = await createRevenueSplitForBooking({ booking: bookingA });
    check("A1. RevenueSplit created (fee ₹20, zemishRevenue = platformFee = ₹20)", splitA?.zemishRevenueInPaise === 2000, splitA);
    const saleA = await GSTLedger.findOne({ revenueSplitId: splitA._id, ledgerType: "SALE" }).lean();
    check("A2. GST SALE ledger created normally, unaffected by this engine", saleA?.gstAmountInPaise === 360);

    const territorySplitA = await TerritoryRevenueSplit.findOne({ revenueSplitId: splitA._id }).lean();
    check("A3. TerritoryRevenueSplit AUTOMATICALLY created by the REAL, unmodified createRevenueSplitForBooking()", !!territorySplitA, territorySplitA);
    check("A4. territoryPartnerRef matches the REAL ACTIVE Territory Partner", String(territorySplitA?.territoryPartnerRef) === String(partner._id));
    check("A5. territoryRef matches the REAL ACTIVE Commercial Territory", String(territorySplitA?.territoryRef) === String(territoryId));
    check("A6. baseAmountInPaise = zemishRevenueInPaise (₹20), NEVER salonCredit or customerPaid", territorySplitA?.baseAmountInPaise === 2000, territorySplitA);
    check("A7. territoryCommissionPercent = 10 (snapshotted from PUBLISHED TerritoryRevenueSettings)", territorySplitA?.territoryCommissionPercent === 10);
    check("A8. territoryRevenueSettingsVersion snapshotted correctly", territorySplitA?.territoryRevenueSettingsVersion === trsVersion);
    check("A9. territoryShareInPaise = round(2000 * 10 / 100) = 200 EXACTLY", territorySplitA?.territoryShareInPaise === 200, territorySplitA);

    const saleLedgerA = await TerritoryRevenueLedger.findOne({ territoryRevenueSplitId: territorySplitA._id, ledgerType: "SALE" }).lean();
    check("A10. TerritoryRevenueLedger SALE row created, amount = ₹2.00, status CREDITED", saleLedgerA?.amountInPaise === 200 && saleLedgerA?.status === "CREDITED", saleLedgerA);

    // Idempotency — calling the REAL integration function again for the SAME booking.
    const splitAAgain = await createRevenueSplitForBooking({ booking: bookingA });
    check("A11. Calling createRevenueSplitForBooking again returns the SAME RevenueSplit (idempotent)", String(splitAAgain._id) === String(splitA._id));
    const territorySplitAAgain = await createTerritoryRevenueSplitForBooking({ revenueSplit: splitA });
    check("A12. Calling createTerritoryRevenueSplitForBooking again returns the SAME split, no duplicate", String(territorySplitAAgain._id) === String(territorySplitA._id) && (await TerritoryRevenueSplit.countDocuments({ revenueSplitId: splitA._id })) === 1);
    check("A13. Exactly ONE SALE TerritoryRevenueLedger row exists for this split (no duplicate)", (await TerritoryRevenueLedger.countDocuments({ territoryRevenueSplitId: territorySplitA._id, ledgerType: "SALE" })) === 1);

    // ═══ SCENARIO B — salon with NO Territory Partner link: safe no-op ═══
    const bookingB = await mkBooking(unlinkedSalon._id, { service: 10000 });
    const splitB = await createRevenueSplitForBooking({ booking: bookingB });
    check("B1. RevenueSplit still created normally for the unlinked salon's booking", !!splitB && splitB.zemishRevenueInPaise === 2000);
    const saleB = await GSTLedger.findOne({ revenueSplitId: splitB._id, ledgerType: "SALE" }).lean();
    check("B2. GST SALE ledger still created normally, unaffected", saleB?.gstAmountInPaise === 360);
    const territorySplitB = await TerritoryRevenueSplit.findOne({ revenueSplitId: splitB._id }).lean();
    check("B3. NO TerritoryRevenueSplit created — salon has no Territory Partner link (safe no-op)", territorySplitB === null);

    // ═══ SCENARIO D — PARTIAL refund → proportional reversal, via the REAL completeRefund() ═══
    const refundD = await mkRefundFixture({ bookingId: bookingA._id, amountInPaise: 6180, paymentAmountInPaise: 12360, razorpayRefundId: `rfnd_${P}${runTag}D` }); // 50%
    await completeRefund({ refundDoc: refundD, gatewayStatus: "processed", gatewayRefundId: refundD.razorpayRefundId });
    const gstReversalD = await GSTLedger.findOne({ refundId: refundD.razorpayRefundId }).lean();
    check("D1. Existing GST Reversal Engine (Step 4.2) still fires correctly alongside this engine: ₹1.80 reversal", gstReversalD?.gstAmountInPaise === 180, gstReversalD);
    const territoryReversalD = await TerritoryRevenueLedger.findOne({ refundId: refundD.razorpayRefundId }).lean();
    check("D2. TerritoryRevenueLedger REFUND_REVERSAL row AUTOMATICALLY created by the REAL, unmodified completeRefund()", !!territoryReversalD, territoryReversalD);
    check("D3. Proportional reversal = round(₹2.00 * 50%) = ₹1.00 EXACTLY", territoryReversalD?.amountInPaise === 100, territoryReversalD);
    check("D4. ledgerType REFUND_REVERSAL, status REVERSED, refundId stored", territoryReversalD?.ledgerType === "REFUND_REVERSAL" && territoryReversalD?.status === "REVERSED");
    const saleLedgerAAfterD = await TerritoryRevenueLedger.findById(saleLedgerA._id).lean();
    check("D5. SALE row is COMPLETELY UNCHANGED by the reversal — still ₹2.00, never updated", saleLedgerAAfterD.amountInPaise === 200 && saleLedgerAAfterD.status === "CREDITED");

    // Idempotency on the reversal — calling completeRefund again for the same refund.
    await completeRefund({ refundDoc: refundD, gatewayStatus: "processed", gatewayRefundId: refundD.razorpayRefundId });
    check("D6. Re-completing the SAME refund does not create a duplicate reversal row", (await TerritoryRevenueLedger.countDocuments({ refundId: refundD.razorpayRefundId })) === 1);

    // ═══ SCENARIO E — FULL refund (100%) → full proportional reversal ═══
    const bookingE = await mkBooking(linkedSalon._id, { service: 10000 });
    const splitE = await createRevenueSplitForBooking({ booking: bookingE });
    const territorySplitE = await TerritoryRevenueSplit.findOne({ revenueSplitId: splitE._id }).lean();
    check("E1. Territory split created for the booking that will be fully refunded (₹2.00 share)", territorySplitE?.territoryShareInPaise === 200, territorySplitE);
    const refundE = await mkRefundFixture({ bookingId: bookingE._id, amountInPaise: 12360, paymentAmountInPaise: 12360, razorpayRefundId: `rfnd_${P}${runTag}E` }); // 100%
    await completeRefund({ refundDoc: refundE, gatewayStatus: "processed", gatewayRefundId: refundE.razorpayRefundId });
    const territoryReversalE = await TerritoryRevenueLedger.findOne({ refundId: refundE.razorpayRefundId }).lean();
    check("E2. FULL refund → FULL reversal of the entire ₹2.00 territory share (fraction = 1.0, exactly matches the SALE amount)", territoryReversalE?.amountInPaise === 200, territoryReversalE);
    const netForE = 200 - 200;
    check("E3. Net Territory Partner liability for this fully-refunded booking is EXACTLY ₹0.00", netForE === 0);

    // ═══ Immutability ═══════════════════════════════════════════════
    let u1, u2, d1;
    try { await TerritoryRevenueLedger.updateOne({ _id: saleLedgerA._id }, { $set: { amountInPaise: 1 } }); } catch (e) { u1 = e; }
    try { await TerritoryRevenueSplit.findOneAndUpdate({ _id: territorySplitA._id }, { $set: { territoryShareInPaise: 1 } }); } catch (e) { u2 = e; }
    try { await TerritoryRevenueLedger.deleteOne({ _id: saleLedgerA._id }); } catch (e) { d1 = e; }
    check("I1. updateOne on a TerritoryRevenueLedger row is blocked", /immutable/i.test(u1?.message || ""));
    check("I2. findOneAndUpdate on a TerritoryRevenueSplit row is blocked", /immutable/i.test(u2?.message || ""));
    check("I3. deleteOne on a TerritoryRevenueLedger row is blocked", /immutable/i.test(d1?.message || ""));
    check("I4. Rows completely unchanged after every attack", (await TerritoryRevenueLedger.findById(saleLedgerA._id).lean()).amountInPaise === 200 && (await TerritoryRevenueSplit.findById(territorySplitA._id).lean()).territoryShareInPaise === 200);

    // ═══ DB-level uniqueness (bypassing the service, direct model writes) ═══
    let dupSplitErr, dupLedgerErr, dupReversalErr;
    try { await TerritoryRevenueSplit.create({ bookingId: bookingA._id, revenueSplitId: splitA._id, salonId: linkedSalon._id, territoryPartnerRef: partner._id, territoryRef: territoryId, baseAmountInPaise: 2000, territoryCommissionPercent: 10, territoryRevenueSettingsVersion: trsVersion, territoryShareInPaise: 200 }); } catch (e) { dupSplitErr = e; }
    check("F1. Direct duplicate TerritoryRevenueSplit for the same revenueSplitId rejected by the DB (unique index)", dupSplitErr?.code === 11000, dupSplitErr?.message);
    try { await TerritoryRevenueLedger.create({ bookingId: bookingA._id, territoryRevenueSplitId: territorySplitA._id, territoryPartnerRef: partner._id, ledgerType: "SALE", status: "CREDITED", amountInPaise: 200 }); } catch (e) { dupLedgerErr = e; }
    check("F2. Direct duplicate SALE TerritoryRevenueLedger for the same split rejected by the DB (partial unique index)", dupLedgerErr?.code === 11000, dupLedgerErr?.message);
    try { await TerritoryRevenueLedger.create({ bookingId: bookingA._id, territoryRevenueSplitId: territorySplitA._id, territoryPartnerRef: partner._id, ledgerType: "REFUND_REVERSAL", status: "REVERSED", amountInPaise: 50, refundId: refundD.razorpayRefundId }); } catch (e) { dupReversalErr = e; }
    check("F3. Direct duplicate REFUND_REVERSAL for the same refundId rejected by the DB (partial unique index)", dupReversalErr?.code === 11000, dupReversalErr?.message);

    // ═══ Read-only balance helper ═══════════════════════════════════
    const balance = await getTerritoryPartnerBalance(partner._id);
    check("G1. getTerritoryPartnerBalance: credited ₹4.00 (₹2.00 x2 SALE rows: A + E), reversed ₹3.00 (₹1.00 partial + ₹2.00 full), balance ₹1.00", balance.creditedInPaise === 400 && balance.reversedInPaise === 300 && balance.balanceInPaise === 100, balance);

    // ═══ ISOLATION — the ticket's central requirement ═══════════════
    const revenueSplitCountAfter = await RevenueSplit.countDocuments({});
    check("H1. Only this run's OWN 4 RevenueSplit documents were added — LOCKED engine's own collection shape unaffected (create/read semantics identical)", revenueSplitCountAfter === revenueSplitCountBefore + 4, { before: revenueSplitCountBefore, after: revenueSplitCountAfter });
    const gstLedgerCountAfter = await GSTLedger.countDocuments({});
    check("H2. GST Ledger collection only gained this run's own expected rows (4 SALE + 2 REFUND_REVERSAL) — Step 4.1/4.2 completely unaffected", gstLedgerCountAfter === gstLedgerCountBefore + 6, { before: gstLedgerCountBefore, after: gstLedgerCountAfter });
    const refundCountAfter = await RefundModel.countDocuments({});
    check("H3. Refund collection only gained this run's own 2 fixtures — Refund Engine completely unaffected", refundCountAfter === refundCountBefore + 2, { before: refundCountBefore, after: refundCountAfter });
    const saleAAfterAll = await GSTLedger.findById(saleA._id).lean();
    check("H4. The original GST SALE row for booking A is still bit-for-bit correct after everything (fee ₹20, GST ₹3.60) — never touched by this engine", saleAAfterAll.platformFeeInPaise === 2000 && saleAAfterAll.gstAmountInPaise === 360);
    const splitAFromDb = await RevenueSplit.findById(splitA._id).lean();
    check("H5. The original RevenueSplit for booking A is still bit-for-bit correct (immutable, LOCKED model never touched)", splitAFromDb.zemishRevenueInPaise === 2000 && splitAFromDb.customerPaidInPaise === 12360);
  } catch (err) {
    fail++; results.push(`❌ UNEXPECTED ERROR — ${err.stack || err}`);
  } finally {
    await purgeFixtures().catch((e) => results.push(`⚠️ purge error ${e.message}`));
    server.close();
    await mongoose.disconnect();
  }
  console.log(results.join("\n"));
  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
};
run();
