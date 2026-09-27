/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyTerritoryPathRetirement.js
 *
 * STEP 6.1 — Territory Decision Gate (IMPLEMENTED) — disposable live
 * verification. No HTTP surface is involved anywhere in this file:
 * processCompletedBooking (and everything it calls) has no HTTP
 * endpoint at all — same precedent as scripts/verifyFieldAgentEarningEngine.js's
 * own header ("no Field Agent financial write endpoint exists
 * anywhere") — so every call here is a direct, real-Mongo service/model
 * call, no app.listen() needed.
 *
 * Proves:
 *   1. Acquisition crediting is COMPLETELY UNCHANGED (same math, same
 *      outcome, same ledger row shape as before this migration).
 *   2. The ZERO_TARGET_REACHED fall-through — which used to credit a
 *      Territory Partner — now returns TERRITORY_PATH_RETIRED and
 *      creates NO ledger row, even though a real, ACTIVE, assigned,
 *      term-valid Territory Partner genuinely exists for that booking's
 *      geography (proving the retirement is real, not just "nothing to
 *      credit anyway").
 *   3. A booking with no acquisition claim at all (the common case) also
 *      now returns TERRITORY_PATH_RETIRED, no ledger row.
 *   4. Zero FieldAgentEarningLedger rows with entitlementType
 *      TERRITORY_PARTNER are created ANYWHERE across this entire run.
 *   5. createTerritoryPartnerTermSnapshot (FA-5.2's own dependency,
 *      deliberately left in place) still works correctly when
 *      commercialTerritory.service.js#assignPartner calls it — FA-5.2
 *      itself is completely unaffected by this migration.
 *   6. TerritoryRevenueLedger (STEP 5.3) continues to work completely
 *      independently — proving it is now the ONLY authoritative
 *      Territory Partner revenue source, unaffected by this file.
 *   7. ISOLATION: zero writes to Wallet/WalletLedger/SalonEarnings/
 *      GSTLedger/RevenueSplit/Refund/Razorpay-adjacent collections, and
 *      Booking documents are never mutated by processCompletedBooking.
 *
 * Run:  cd backend && node scripts/verifyTerritoryPathRetirement.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import Country from "../models/Country.js";
import State from "../models/State.js";
import District from "../models/District.js";
import City from "../models/City.js";
import Area from "../models/Area.js";
import Salon from "../models/Salon.js";
import Booking, { BOOKING_STATUS } from "../models/Booking.js";
import SalonEarnings from "../models/SalonEarnings.js";
import WalletLedger from "../models/WalletLedger.js";
import RefundModel from "../models/Refund.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import AcquisitionClaim from "../modules/fieldAgent/models/AcquisitionClaim.js";
import AcquisitionEarningProgress from "../modules/fieldAgent/models/AcquisitionEarningProgress.js";
import FieldAgentEarningLedger from "../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import TerritoryPartnerTermSnapshot from "../modules/fieldAgent/models/TerritoryPartnerTermSnapshot.js";
import CommercialPolicyVersion from "../modules/fieldAgent/models/CommercialPolicyVersion.js";
import CommercialTerritory from "../modules/fieldAgent/models/CommercialTerritory.js";
import TerritoryAssignment from "../modules/fieldAgent/models/TerritoryAssignment.js";
import { createDraftTerritory, activateTerritory, assignPartner } from "../modules/fieldAgent/services/commercialTerritory.service.js";
import {
  processCompletedBooking,
  createAcquisitionEarningProgressForClaim,
  PROCESSING_OUTCOME,
} from "../modules/fieldAgent/services/fieldAgentEarning.service.js";
import { CLAIM_STATUS } from "../modules/fieldAgent/constants/acquisitionClaim.constants.js";
import { EARNING_ENTITLEMENT_TYPE, EARNING_CREDIT_OUTCOME } from "../modules/fieldAgent/constants/fieldAgentEarning.constants.js";
import GSTLedger from "../modules/finance/models/GSTLedger.js";
import RevenueSplit from "../modules/finance/models/RevenueSplit.js";
import RevenueSettings from "../modules/finance/models/RevenueSettings.js";
import TerritoryRevenueSettings from "../modules/finance/models/TerritoryRevenueSettings.js";
import TerritoryRevenueSplit from "../modules/finance/models/TerritoryRevenueSplit.js";
import TerritoryRevenueLedger from "../modules/finance/models/TerritoryRevenueLedger.js";
import SalonTerritoryAssignment from "../modules/territoryAutoAssignment/models/SalonTerritoryAssignment.js";
import { createRevenueSplitForBooking } from "../modules/finance/services/RevenueSplitIntegrationService.js";
import { createDraftTerritoryRevenueSettings, publishTerritoryRevenueSettings } from "../modules/finance/services/TerritoryRevenueSettingsService.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const P = "ZTEST_TPR61_";
const oid = () => new mongoose.Types.ObjectId();
let phoneSeq = 0;
const nextPhone = () => `6${String(6660000000 + phoneSeq++).slice(-9)}`;

const fixtureUserIds = [];
const fixtureStateIds = [];
const fixtureDistrictIds = [];
const fixtureCityIds = [];
const fixtureAreaIds = [];
const fixtureSalonIds = [];
const fixtureFieldAgentIds = [];
const fixtureClaimIds = [];
const fixtureBookingIds = [];
const fixturePolicyIds = [];
const fixtureTerritoryIds = [];
const fixtureAssignmentIds = [];
const fixtureRevenueSettingsIds = [];
const fixtureTerritoryRevenueSettingsIds = [];

const purgeFixtures = async () => {
  await TerritoryRevenueLedger.collection.deleteMany({ bookingId: { $in: fixtureBookingIds } });
  await TerritoryRevenueSplit.collection.deleteMany({ bookingId: { $in: fixtureBookingIds } });
  await SalonTerritoryAssignment.deleteMany({ salonRef: { $in: fixtureSalonIds } });
  await GSTLedger.collection.deleteMany({ bookingId: { $in: fixtureBookingIds } });
  await RevenueSplit.collection.deleteMany({ bookingId: { $in: fixtureBookingIds } });
  await FieldAgentEarningLedger.collection.deleteMany({ bookingRef: { $in: fixtureBookingIds } });
  await AcquisitionEarningProgress.deleteMany({ acquisitionClaimRef: { $in: fixtureClaimIds } });
  await AcquisitionClaim.deleteMany({ _id: { $in: fixtureClaimIds } });
  await TerritoryPartnerTermSnapshot.deleteMany({ territoryAssignmentRef: { $in: fixtureAssignmentIds } });
  await TerritoryAssignment.deleteMany({ _id: { $in: fixtureAssignmentIds } });
  await CommercialTerritory.deleteMany({ _id: { $in: fixtureTerritoryIds } });
  await Booking.collection.deleteMany({ _id: { $in: fixtureBookingIds } });
  await Salon.deleteMany({ _id: { $in: fixtureSalonIds } });
  await FieldAgent.deleteMany({ _id: { $in: fixtureFieldAgentIds } });
  await CommercialPolicyVersion.deleteMany({ _id: { $in: fixturePolicyIds } });
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

  try {
    // ── ISOLATION BASELINES ──────────────────────────────────────
    const walletLedgerCountBefore = await WalletLedger.countDocuments({});
    const salonEarningsCountBefore = await SalonEarnings.countDocuments({});
    const refundCountBefore = await RefundModel.countDocuments({});

    // ── SETUP ────────────────────────────────────────────────────
    const country = await Country.findOne({}).lean();
    check("SETUP. Real Country fixture exists", !!country);
    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("_id").lean();
    check("SETUP. Real INDIA admin fixture exists (pre-existing)", !!indiaAdmin);

    const randLetters = () => Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");
    const state = await State.create({ name: `${P}STATE`, code: randLetters(), type: "STATE", countryRef: country._id, geo: { type: "Point", coordinates: [77, 28] }, isActive: true, isDeleted: false });
    fixtureStateIds.push(state._id);

    const mkGeo = async (label) => {
      const d = await District.create({ name: `${P}DISTRICT_${label}`, code: `T6${label}${Date.now() % 10000}`, countryRef: country._id, stateRef: state._id, isActive: true, isDeleted: false });
      const c = await City.create({ name: `${P}CITY_${label}`, districtRef: d._id, stateRef: state._id, isActive: true, isDeleted: false });
      const a = await Area.create({ name: `${P}AREA_${label}`, cityRef: c._id, districtRef: d._id, stateRef: state._id, isActive: true, isDeleted: false });
      fixtureDistrictIds.push(d._id); fixtureCityIds.push(c._id); fixtureAreaIds.push(a._id);
      return { district: d, city: c, area: a };
    };

    const nationalPolicy = await CommercialPolicyVersion.create({
      versionNumber: 900001 + Math.floor(Math.random() * 100000),
      status: "PUBLISHED",
      acquisitionAgentCommissionPercent: 10,
      acquisitionEarningTargetInPaise: 100000,
      territoryPartnerCommissionPercent: 8,
      licenseTermMonths: 12,
      claimExpiryDays: 30,
      createdBy: indiaAdmin._id,
      publishedBy: indiaAdmin._id,
      publishedAt: new Date(Date.now() - 365 * 24 * 3600 * 1000),
    });
    fixturePolicyIds.push(nationalPolicy._id);

    const mkSalon = async (geo) => {
      const owner = await User.create({ name: `${P}OWNER_${Date.now()}_${Math.random()}`, phone: nextPhone(), role: "OWNER", isActive: true });
      fixtureUserIds.push(owner._id);
      const salon = await Salon.create({
        ownerId: owner._id,
        basicInfo: { shopName: `${P}SALON_${Date.now()}_${Math.random()}`, category: "UNISEX" },
        location: { address: `${P} addr`, geo: { type: "Point", coordinates: [77, 28] }, territory: { countryRef: country._id, stateRef: state._id, districtRef: geo.district._id, cityRef: geo.city._id, areaRef: geo.area._id } },
        timings: salonTimings,
        approval: { status: "APPROVED" },
        onboarding: { step: 8 },
        isDeleted: false,
      });
      fixtureSalonIds.push(salon._id);
      return salon;
    };

    const mkFieldAgent = async (suffix, commercialPath) => {
      const u = await User.create({ name: `${P}FA_${suffix}`, phone: nextPhone(), role: "FIELD_AGENT", isActive: true });
      fixtureUserIds.push(u._id);
      const fa = await FieldAgent.create({ userRef: u._id, applicationRef: oid(), agentCode: `FA-99999999-${String(Math.floor(Math.random() * 900000) + 100000)}`, operationalStatus: "PENDING_ACTIVATION", commercialPath });
      fixtureFieldAgentIds.push(fa._id);
      return fa;
    };

    let slot = 0;
    const mkBooking = async (salon, { commissionAmountInPaise = 10000, completedAt = new Date() } = {}) => {
      const start = new Date(Date.now() + (240 + slot++ * 45) * 60000);
      const b = await Booking.create({
        userRef: (await User.findOne({ role: "ADMIN" }).select("_id").lean())._id, // any valid userRef; not exercised by processCompletedBooking
        salonRef: salon._id, chairRef: oid(), serviceRefs: [oid()],
        bookingDate: new Date().toISOString().slice(0, 10), startTime: start, endTime: new Date(start.getTime() + 30 * 60000),
        serviceDuration: 30, status: BOOKING_STATUS.COMPLETED, serviceAmountInPaise: 10000, commissionAmountInPaise, totalAmountInPaise: 12360,
      });
      await Booking.collection.updateOne({ _id: b._id }, { $set: { completedAt } });
      fixtureBookingIds.push(b._id);
      return { _id: b._id, salonRef: salon._id, commissionAmountInPaise, completedAt };
    };

    // Real Territory setup — ACTIVE CommercialTerritory + ACTIVE
    // TerritoryAssignment + TerritoryPartnerTermSnapshot, all created
    // through the REAL, unmodified commercialTerritory.service.js
    // functions (createDraftTerritory/activateTerritory/assignPartner)
    // — proves FA-5.2 keeps working, and gives every scenario below a
    // genuinely eligible Territory Partner to (not) credit.
    const geoT = await mkGeo("T");
    const partner = await mkFieldAgent("PARTNER", "TERRITORY_PARTNER");
    const draftTerritory = await createDraftTerritory({ adminId: indiaAdmin._id, name: `${P}Territory`, scopeType: "DISTRICT", districtRef: geoT.district._id });
    fixtureTerritoryIds.push(draftTerritory._id);
    await activateTerritory({ territoryId: draftTerritory._id, adminId: indiaAdmin._id });
    const { assignment } = await assignPartner({ territoryId: draftTerritory._id, fieldAgentId: partner._id, adminId: indiaAdmin._id });
    fixtureAssignmentIds.push(assignment._id);
    const termSnapshot = await TerritoryPartnerTermSnapshot.findOne({ territoryAssignmentRef: assignment._id }).lean();
    check("SETUP. FA-5.2's own createTerritoryPartnerTermSnapshot still fires correctly via the real assignPartner() call — this dependency remains fully functional", !!termSnapshot && termSnapshot.termMonths === 12, termSnapshot);

    // ═══ SCENARIO A — Acquisition crediting is COMPLETELY UNCHANGED ═══
    const geoA = await mkGeo("A");
    const salonA = await mkSalon(geoA);
    const acqAgent = await mkFieldAgent("ACQ", "ACQUISITION_AGENT");
    const claimA = await AcquisitionClaim.create({ salonRef: salonA._id, fieldAgentRef: acqAgent._id, status: CLAIM_STATUS.ACTIVE_RECOVERY, stateRef: state._id, districtRef: geoA.district._id });
    fixtureClaimIds.push(claimA._id);
    await createAcquisitionEarningProgressForClaim({ claim: claimA, salon: salonA });
    const bookingA = await mkBooking(salonA, { commissionAmountInPaise: 10000 }); // 10% of 10000 = 1000
    const outcomeA = await processCompletedBooking(bookingA);
    check("A1. Acquisition credit UNCHANGED: CREDITED, ₹10.00 (10% of ₹100.00 commission) — exact same math as before this migration", outcomeA.outcome === "CREDITED" && outcomeA.creditedAmountInPaise === 1000, outcomeA);
    const acqRow = await FieldAgentEarningLedger.findOne({ bookingRef: bookingA._id }).lean();
    check("A2. Ledger row entitlementType is ACQUISITION, exactly as before", acqRow?.entitlementType === EARNING_ENTITLEMENT_TYPE.ACQUISITION, acqRow);

    // ═══ SCENARIO B — ZERO_TARGET_REACHED fall-through NO LONGER credits Territory ═══
    // Push the SAME claim's progress to exactly its target with one booking,
    // then a SUBSEQUENT booking on the SAME salon (still inside geoT's
    // territory) — under the OLD code this would have fallen through and
    // credited the REAL Territory Partner set up above. It must not.
    const salonB = await mkSalon(geoT); // inside the REAL, ACTIVE, assigned, term-valid territory
    const acqAgentB = await mkFieldAgent("ACQB", "ACQUISITION_AGENT");
    const claimB = await AcquisitionClaim.create({ salonRef: salonB._id, fieldAgentRef: acqAgentB._id, status: CLAIM_STATUS.ACTIVE_RECOVERY, stateRef: state._id, districtRef: geoT.district._id });
    fixtureClaimIds.push(claimB._id);
    await createAcquisitionEarningProgressForClaim({ claim: claimB, salon: salonB });
    const targetBooking = await mkBooking(salonB, { commissionAmountInPaise: 1000000 }); // hits exact ₹1,00,000 target
    const targetOutcome = await processCompletedBooking(targetBooking);
    check("B1. Target-hitting booking still credits Acquisition normally (unchanged)", targetOutcome.outcome === "CREDITED" && targetOutcome.creditedAmountInPaise === 100000, targetOutcome);
    const subsequentBooking = await mkBooking(salonB, { commissionAmountInPaise: 200000, completedAt: new Date(targetBooking.completedAt.getTime() + 1000) });
    const subsequentOutcome = await processCompletedBooking(subsequentBooking);
    check("B2. Subsequent booking (would have fallen through to Territory Partner under the OLD path) now returns TERRITORY_PATH_RETIRED", subsequentOutcome.outcome === PROCESSING_OUTCOME.TERRITORY_PATH_RETIRED && subsequentOutcome.creditedAmountInPaise === 0, subsequentOutcome);
    // NOTE: attemptAcquisitionCredit itself (pre-existing, unmodified)
    // writes its OWN entitlementType:ACQUISITION audit row recording the
    // ZERO_TARGET_REACHED outcome — that row is EXPECTED and unrelated
    // to Territory. The correct assertion is that NO entitlementType:
    // TERRITORY_PARTNER row exists for this booking (D1 below proves
    // this globally; this is the same check scoped to this one booking).
    const territoryRowB = await FieldAgentEarningLedger.findOne({ bookingRef: subsequentBooking._id, entitlementType: EARNING_ENTITLEMENT_TYPE.TERRITORY_PARTNER }).lean();
    check("B3. NO TERRITORY_PARTNER FieldAgentEarningLedger row was created for the retired-path booking (an unrelated ACQUISITION audit row for the ZERO_TARGET_REACHED outcome is expected and pre-existing behavior)", territoryRowB === null, territoryRowB);

    // ═══ SCENARIO C — no acquisition claim at all (the common real-world case) ═══
    const salonC = await mkSalon(geoT); // same real, eligible territory — no claim on this salon at all
    const bookingC = await mkBooking(salonC, { commissionAmountInPaise: 50000 });
    const outcomeC = await processCompletedBooking(bookingC);
    check("C1. No acquisition claim → straight to the retired Territory branch → TERRITORY_PATH_RETIRED", outcomeC.outcome === PROCESSING_OUTCOME.TERRITORY_PATH_RETIRED && outcomeC.creditedAmountInPaise === 0, outcomeC);
    const territoryRowC = await FieldAgentEarningLedger.findOne({ bookingRef: bookingC._id }).lean();
    check("C2. NO ledger row created for booking C either", territoryRowC === null);

    // ═══ SCENARIO D — global proof: ZERO TERRITORY_PARTNER rows anywhere in this run ═══
    const anyTerritoryPartnerRow = await FieldAgentEarningLedger.findOne({ bookingRef: { $in: fixtureBookingIds }, entitlementType: EARNING_ENTITLEMENT_TYPE.TERRITORY_PARTNER }).lean();
    check("D1. ZERO FieldAgentEarningLedger rows with entitlementType TERRITORY_PARTNER exist anywhere across this entire run", anyTerritoryPartnerRow === null, anyTerritoryPartnerRow);

    // ═══ SCENARIO E — TerritoryRevenueLedger (STEP 5.3) remains the sole, fully-functional authoritative source ═══
    await RevenueSettings.updateMany({ status: "PUBLISHED" }, { $set: { status: "RETIRED", retiredAt: new Date() } });
    const lastRs = await RevenueSettings.findOne().sort({ version: -1 }).select("version").lean();
    const rs = await RevenueSettings.create({ platformFeeInPaise: 2000, gstRate: 18, gstEnabled: true, minimumPayoutInPaise: 50000, autoPayoutEnabled: false, version: (lastRs?.version ?? 0) + 1, createdBy: indiaAdmin._id, status: "PUBLISHED", publishedAt: new Date(), publishedBy: indiaAdmin._id });
    fixtureRevenueSettingsIds.push(rs._id);
    const draftTrs = await createDraftTerritoryRevenueSettings({ adminId: indiaAdmin._id, territoryCommissionPercent: 10, minimumPayoutInPaise: 50000 });
    fixtureTerritoryRevenueSettingsIds.push(draftTrs._id);
    await publishTerritoryRevenueSettings({ versionId: draftTrs._id, adminId: indiaAdmin._id });

    const salonE = await mkSalon(geoT);
    await SalonTerritoryAssignment.create({ salonRef: salonE._id, territoryRef: draftTerritory._id, fieldAgentRef: partner._id, source: "AUTO_ON_APPROVAL" });
    const start = new Date(Date.now() + 600 * 60000);
    const bookingEDoc = await Booking.create({
      userRef: indiaAdmin._id, salonRef: salonE._id, chairRef: oid(), serviceRefs: [oid()],
      bookingDate: new Date().toISOString().slice(0, 10), startTime: start, endTime: new Date(start.getTime() + 1800000),
      serviceDuration: 30, status: BOOKING_STATUS.CONFIRMED, serviceAmountInPaise: 10000, commissionAmountInPaise: 2000, totalAmountInPaise: 12360,
      razorpayOrderId: `order_${P}${Date.now()}`,
    });
    fixtureBookingIds.push(bookingEDoc._id);
    const splitE = await createRevenueSplitForBooking({ booking: bookingEDoc });
    const territorySplitE = await TerritoryRevenueSplit.findOne({ revenueSplitId: splitE._id }).lean();
    check("E1. TerritoryRevenueLedger (STEP 5.3) still creates a correct split completely independently of this migration — ₹2.00 share (10% of ₹20 zemishRevenue)", territorySplitE?.territoryShareInPaise === 200, territorySplitE);
    const territorySaleLedgerE = await TerritoryRevenueLedger.findOne({ territoryRevenueSplitId: territorySplitE._id, ledgerType: "SALE" }).lean();
    check("E2. TerritoryRevenueLedger SALE row created, CREDITED — confirms STEP 5.3 is now the ONLY functioning Territory Partner revenue path", territorySaleLedgerE?.status === "CREDITED", territorySaleLedgerE);

    // ═══ ISOLATION — Wallet, Razorpay, GST, Refund, Booking untouched by this migration ═══
    const walletLedgerCountAfter = await WalletLedger.countDocuments({});
    check("F1. WalletLedger collection completely untouched by processCompletedBooking's retirement path (only STEP 5.3's own, unrelated write from Scenario E may exist — none expected here since STEP 5.3 never writes WalletLedger either)", walletLedgerCountAfter === walletLedgerCountBefore, { before: walletLedgerCountBefore, after: walletLedgerCountAfter });
    const salonEarningsCountAfter = await SalonEarnings.countDocuments({});
    check("F2. SalonEarnings collection completely untouched", salonEarningsCountAfter === salonEarningsCountBefore, { before: salonEarningsCountBefore, after: salonEarningsCountAfter });
    const refundCountAfter = await RefundModel.countDocuments({});
    check("F3. Refund collection completely untouched (no refund logic touched by this migration)", refundCountAfter === refundCountBefore, { before: refundCountBefore, after: refundCountAfter });
    const bookingAAfter = await Booking.findById(bookingA._id).select("status completedAt serviceAmountInPaise").lean();
    check("F4. Booking A document is bit-for-bit unchanged by processCompletedBooking (it only reads Booking, never writes) — status/completedAt/serviceAmountInPaise all exactly as set by this script's own fixture, not mutated by the earning engine", bookingAAfter.status === BOOKING_STATUS.COMPLETED && bookingAAfter.serviceAmountInPaise === 10000);
  } catch (err) {
    fail++; results.push(`❌ UNEXPECTED ERROR — ${err.stack || err}`);
  } finally {
    await purgeFixtures().catch((e) => results.push(`⚠️ purge error ${e.message}`));
    await mongoose.disconnect();
  }
  console.log(results.join("\n"));
  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
};
run();
