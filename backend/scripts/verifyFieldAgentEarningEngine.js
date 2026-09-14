/**
 * BARBER ENGINE V1
 * backend/scripts/verifyFieldAgentEarningEngine.js
 *
 * FA-9 — dedicated, real-Mongo, real-HTTP verification suite for the
 * Field Agent Earning/Commission Engine. Mirrors this project's own
 * established methodology (verifyCommercialTerritory.js,
 * verifyCrossAgentOverlap.js, verifyCommercialPolicyHardening.js): real
 * Express app via app.listen(0) for admin CRUD, real signed JWTs, real
 * MongoDB (no mocks), disposable fixtures with an explicit marker,
 * concurrency proven via real Promise.all against real MongoDB
 * transactions (never simulated), explicit zero-residue cleanup.
 *
 * The core financial engine (policy resolution, atomic acquisition
 * cap, acquisition->territory transition, background job) has no HTTP
 * surface at all (no Field Agent financial write endpoint exists
 * anywhere — locked security requirement) — those sections call
 * fieldAgentEarning.service.js / fieldAgentEarning.job.js directly,
 * against a real MongoDB connection, exactly mirroring how
 * verifyCrossAgentOverlap.js/verifyFraudDetectionEngine.js already
 * test their own read-only job/service layers.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyFieldAgentEarningEngine.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import { generateAccessToken } from "../services/token.service.js";

import User from "../models/User.js";
import Salon from "../models/Salon.js";
import Booking, { BOOKING_STATUS } from "../models/Booking.js";
import Country from "../models/Country.js";
import State from "../models/State.js";
import District from "../models/District.js";
import City from "../models/City.js";
import Area from "../models/Area.js";

import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import AcquisitionClaim from "../modules/fieldAgent/models/AcquisitionClaim.js";
import AcquisitionEarningProgress from "../modules/fieldAgent/models/AcquisitionEarningProgress.js";
import FieldAgentEarningLedger from "../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import FieldAgentEarningJobCheckpoint from "../modules/fieldAgent/models/FieldAgentEarningJobCheckpoint.js";
import FieldAgentEarningPolicyGap from "../modules/fieldAgent/models/FieldAgentEarningPolicyGap.js";
import CommercialPolicyVersion from "../modules/fieldAgent/models/CommercialPolicyVersion.js";
import CommercialPolicyOverride from "../modules/fieldAgent/models/CommercialPolicyOverride.js";
import PolicyOverrideActivationLock from "../modules/fieldAgent/models/PolicyOverrideActivationLock.js";
import CommercialTerritory from "../modules/fieldAgent/models/CommercialTerritory.js";
import TerritoryAssignment from "../modules/fieldAgent/models/TerritoryAssignment.js";

import { publishPolicyOverride } from "../modules/fieldAgent/services/commercialPolicyOverride.service.js";
import {
  processCompletedBooking,
  resolveApplicableCommercialPolicyForBooking,
  createAcquisitionEarningProgressForClaim,
  reprocessOneGap,
  listOpenGaps,
  PROCESSING_OUTCOME,
} from "../modules/fieldAgent/services/fieldAgentEarning.service.js";
import { redeemReferral, issueReferral } from "../modules/fieldAgent/services/acquisitionClaim.service.js";
import AcquisitionReferral from "../modules/fieldAgent/models/AcquisitionReferral.js";
import {
  EARNING_JOB_CHECKPOINT_ID,
  EARNING_ENTITLEMENT_TYPE,
  EARNING_CREDIT_OUTCOME,
  GAP_TYPE,
  GAP_STATUS,
} from "../modules/fieldAgent/constants/fieldAgentEarning.constants.js";
import { _internal as jobInternal } from "../modules/fieldAgent/jobs/fieldAgentEarning.job.js";

let pass = 0,
  fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) {
    pass++;
    results.push(`✅ ${name}`);
  } else {
    fail++;
    results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`);
  }
};

const FIXTURE_MARKER = "FA-9-VERIFY-FIXTURE";
const NAME_PREFIX = "ZTEST_FA9_";

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
  const fixtureClaimIds = [];
  const fixtureOverrideIds = [];
  const fixturePolicyIds = [];
  const fixtureTerritoryIds = [];
  const fixtureAssignmentIds = [];
  const fixtureFieldAgentIds = [];

  // ── SETUP: reuse an existing INDIA admin (never create a fixture
  // ADMIN — User's own pre-validate hook requires email for role
  // ADMIN, and reusing a real admin matches verifyCommercialTerritory.js's
  // own established precedent), geography, national policy ──────────
  const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion").lean();
  if (!indiaAdmin) throw new Error("No existing INDIA admin found — cannot run FA-9 verification");
  const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

  // IMPORTANT: FieldAgentEarningJobCheckpoint is a real, SHARED,
  // production singleton — the live fieldAgentEarning.job.js (running
  // under nodemon on this same database) reads/advances it every 30s.
  // This script's own tests (22/30/31/32/F-1) deliberately overwrite it
  // to simulate specific cursor states, so its ORIGINAL real value is
  // saved here and explicitly RESTORED in cleanup — never deleted.
  // Deleting it (an earlier version of this script did) resets the
  // live job's real discovery progress back to epoch, causing it to
  // needlessly re-scan the entire real Booking history on its next
  // tick every time this script runs.
  const originalCheckpoint = await FieldAgentEarningJobCheckpoint.findById(EARNING_JOB_CHECKPOINT_ID).lean();

  const country = await Country.findOne({}).lean();
  const randLetters = () => Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");
  const state = await State.create({ name: `${NAME_PREFIX}STATE`, code: randLetters(), type: "STATE", countryRef: country._id, geo: { type: "Point", coordinates: [77, 28] }, isActive: true, isDeleted: false });
  const districtA = await District.create({ name: `${NAME_PREFIX}DISTRICT_A`, code: `ZF9DA${Date.now() % 100000}`, countryRef: country._id, stateRef: state._id, isActive: true, isDeleted: false });
  const districtB = await District.create({ name: `${NAME_PREFIX}DISTRICT_B`, code: `ZF9DB${Date.now() % 100000}`, countryRef: country._id, stateRef: state._id, isActive: true, isDeleted: false });
  const cityA = await City.create({ name: `${NAME_PREFIX}CITY_A`, districtRef: districtA._id, stateRef: state._id, isActive: true, isDeleted: false });
  const cityB = await City.create({ name: `${NAME_PREFIX}CITY_B`, districtRef: districtB._id, stateRef: state._id, isActive: true, isDeleted: false });
  const areaA1 = await Area.create({ name: `${NAME_PREFIX}AREA_A1`, cityRef: cityA._id, districtRef: districtA._id, stateRef: state._id, isActive: true, isDeleted: false });
  const areaB1 = await Area.create({ name: `${NAME_PREFIX}AREA_B1`, cityRef: cityB._id, districtRef: districtB._id, stateRef: state._id, isActive: true, isDeleted: false });
  // districtC/cityC/areaC1 deliberately NEVER receive a
  // CommercialPolicyOverride anywhere in this script — reserved for
  // every test that assumes plain national-policy behavior (10%
  // acquisition rate, 100000 target), so those tests can't be
  // contaminated by the override published against districtB in the
  // policy-resolution section above.
  const districtC = await District.create({ name: `${NAME_PREFIX}DISTRICT_C`, code: `ZF9DC${Date.now() % 100000}`, countryRef: country._id, stateRef: state._id, isActive: true, isDeleted: false });
  const cityC = await City.create({ name: `${NAME_PREFIX}CITY_C`, districtRef: districtC._id, stateRef: state._id, isActive: true, isDeleted: false });
  const areaC1 = await Area.create({ name: `${NAME_PREFIX}AREA_C1`, cityRef: cityC._id, districtRef: districtC._id, stateRef: state._id, isActive: true, isDeleted: false });

  // Extra throwaway districts, one per test section that creates its
  // own CommercialTerritory fixture directly (bypassing
  // commercialTerritory.service.js's own overlap-prevention, which
  // only runs for activateTerritory — a raw .create() has none). Every
  // such territory MUST get its own dedicated district, otherwise
  // multiple ACTIVE DISTRICT-scoped territory fixtures sharing
  // districtC would make resolveTerritoryPartnerEligibility's findOne
  // match arbitrarily among them across unrelated test sections.
  const fixtureDistrictIds = [districtA._id, districtB._id, districtC._id];
  const fixtureCityIds = [cityA._id, cityB._id, cityC._id];
  const fixtureAreaIds = [areaA1._id, areaB1._id, areaC1._id];
  const mkFreshGeography = async (label) => {
    const d = await District.create({ name: `${NAME_PREFIX}DISTRICT_${label}`, code: `ZF9D${label}${Date.now() % 100000}`, countryRef: country._id, stateRef: state._id, isActive: true, isDeleted: false });
    const c = await City.create({ name: `${NAME_PREFIX}CITY_${label}`, districtRef: d._id, stateRef: state._id, isActive: true, isDeleted: false });
    const a = await Area.create({ name: `${NAME_PREFIX}AREA_${label}`, cityRef: c._id, districtRef: d._id, stateRef: state._id, isActive: true, isDeleted: false });
    fixtureDistrictIds.push(d._id);
    fixtureCityIds.push(c._id);
    fixtureAreaIds.push(a._id);
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
    obligations: [{ key: FIXTURE_MARKER, description: "Verification fixture marker — safe to delete." }],
  });
  fixturePolicyIds.push(nationalPolicy._id);

  const dayTiming = { open: "09:00", close: "20:00" };
  const salonTimings = { monday: dayTiming, tuesday: dayTiming, wednesday: dayTiming, thursday: dayTiming, friday: dayTiming, saturday: dayTiming, sunday: dayTiming };
  const mkSalon = async (districtRef, cityRef, areaRef, opts = {}) => {
    const owner = await User.create({ name: `${NAME_PREFIX}OWNER_${Date.now()}_${Math.random()}`, phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, role: "OWNER", accountStatus: "ACTIVE" });
    fixtureUserIds.push(owner._id);
    const salon = await Salon.create({
      ownerId: owner._id,
      basicInfo: { shopName: `${NAME_PREFIX}SALON_${Date.now()}_${Math.random()}`, category: "UNISEX" },
      location: { address: `${NAME_PREFIX} addr`, geo: { type: "Point", coordinates: [77, 28] }, territory: { countryRef: country._id, stateRef: state._id, districtRef, cityRef, areaRef } },
      timings: salonTimings,
      approval: { status: "APPROVED" },
      onboarding: { step: 2 },
      isDeleted: false,
      ...opts,
    });
    fixtureSalonIds.push(salon._id);
    return salon;
  };

  const mkFieldAgentWithClaim = async (salon, accountStatus = "ACTIVE") => {
    const agentUser = await User.create({ name: `${NAME_PREFIX}AGENT_${Date.now()}_${Math.random()}`, phone: `8${Math.floor(100000000 + Math.random() * 899999999)}`, role: "FIELD_AGENT", accountStatus });
    fixtureUserIds.push(agentUser._id);
    const application = new mongoose.Types.ObjectId();
    const fieldAgent = await FieldAgent.create({ userRef: agentUser._id, applicationRef: application, agentCode: `ZF9-${Date.now()}-${Math.floor(Math.random() * 100000)}`, operationalStatus: "ACTIVE", commercialPath: "ACQUISITION_AGENT" });
    fixtureFieldAgentIds.push(fieldAgent._id);
    const claim = await AcquisitionClaim.create({ salonRef: salon._id, fieldAgentRef: fieldAgent._id, status: "ACTIVE", stateRef: state._id, districtRef: salon.location.territory.districtRef });
    fixtureClaimIds.push(claim._id);
    // FA-9 CORRECTIVE architecture: progress is no longer auto-created
    // on first booking — this helper mirrors the real
    // acquisitionClaim.service.js#redeemReferral integration by
    // eagerly snapshotting it right after claim creation, at
    // claim.createdAt, exactly like the real flow does.
    const progress = await createAcquisitionEarningProgressForClaim({ claim, salon });
    return { agentUser, fieldAgent, claim, progress };
  };

  const mkBooking = async (salon, { commissionAmountInPaise = 10000, completedAt = new Date() } = {}) => {
    const booking = await Booking.create({
      userRef: oid(),
      salonRef: salon._id,
      chairRef: oid(),
      serviceRefs: [oid()],
      bookingDate: "2026-01-01",
      startTime: new Date(),
      endTime: new Date(Date.now() + 3600000),
      serviceDuration: 30,
      status: BOOKING_STATUS.HOLD,
      commissionAmountInPaise,
    });
    await Booking.collection.updateOne({ _id: booking._id }, { $set: { status: BOOKING_STATUS.COMPLETED, completedAt } });
    fixtureBookingIds.push(booking._id);
    return { _id: booking._id, salonRef: salon._id, commissionAmountInPaise, completedAt };
  };

  try {
    // ── 1-2. POLICY RESOLUTION: national fallback ────────────────────
    {
      const salon = await mkSalon(districtA._id, cityA._id, areaA1._id);
      const resolved = await resolveApplicableCommercialPolicyForBooking(salon, new Date());
      check("1-2. No override exists → resolves to national policy", resolved?.policySource === "NATIONAL" && String(resolved.policy._id) === String(nationalPolicy._id));
    }

    // ── 4/5/6. Geographic override — DISTRICT/CITY/AREA_SET, via HTTP CRUD + publish ──
    const createOverride = (body) => authFetch("/api/admin/commercial-policy-overrides", indiaToken, { method: "POST", body: JSON.stringify(body) });
    const publishOverrideHttp = (id) => authFetch(`/api/admin/commercial-policy-overrides/${id}/publish`, indiaToken, { method: "POST" });

    const rDistrict = await createOverride({ scopeType: "DISTRICT", districtRef: String(districtA._id), acquisitionAgentCommissionPercent: 20, acquisitionEarningTargetInPaise: 50000, territoryPartnerCommissionPercent: 15 });
    check("6. Create DRAFT DISTRICT override succeeds (201)", rDistrict.status === 201, rDistrict.status);
    if (rDistrict.data?.data?.override?._id) fixtureOverrideIds.push(rDistrict.data.data.override._id);
    const pDistrict = await publishOverrideHttp(rDistrict.data?.data?.override?._id);
    check("6. Publish DISTRICT override succeeds (200)", pDistrict.status === 200, pDistrict.status);

    {
      const salon = await mkSalon(districtA._id, cityA._id, areaA1._id);
      const resolved = await resolveApplicableCommercialPolicyForBooking(salon, new Date());
      check("4. Salon under overridden district resolves to AREA_OVERRIDE", resolved?.policySource === "AREA_OVERRIDE" && resolved.policy.acquisitionAgentCommissionPercent === 20);
    }

    // ── 7. Overlap prevention — a CITY override inside the same district must be blocked ──
    const rCityOverlap = await createOverride({ scopeType: "CITY", districtRef: String(districtA._id), cityRef: String(cityA._id), acquisitionAgentCommissionPercent: 25, acquisitionEarningTargetInPaise: 50000, territoryPartnerCommissionPercent: 15 });
    if (rCityOverlap.data?.data?.override?._id) fixtureOverrideIds.push(rCityOverlap.data.data.override._id);
    const pCityOverlap = await publishOverrideHttp(rCityOverlap.data?.data?.override?._id);
    check("7. Publish blocked — overlapping CITY override inside a PUBLISHED DISTRICT override's district", pCityOverlap.status === 409, pCityOverlap.status);

    // ── A different, non-overlapping district's override should publish fine ──
    const rDistrictB = await createOverride({ scopeType: "DISTRICT", districtRef: String(districtB._id), acquisitionAgentCommissionPercent: 30, acquisitionEarningTargetInPaise: 40000, territoryPartnerCommissionPercent: 9 });
    if (rDistrictB.data?.data?.override?._id) fixtureOverrideIds.push(rDistrictB.data.data.override._id);
    const pDistrictB = await publishOverrideHttp(rDistrictB.data?.data?.override?._id);
    check("7. Publish succeeds for a genuinely non-overlapping district", pDistrictB.status === 200, pDistrictB.status);

    // ── 8/9. publishedAt/retiredAt boundary semantics ────────────────
    {
      const salon = await mkSalon(districtA._id, cityA._id, areaA1._id);
      const override = await CommercialPolicyOverride.findById(rDistrict.data.data.override._id);
      const atPublish = await resolveApplicableCommercialPolicyForBooking(salon, override.publishedAt);
      check("8. completedAt === publishedAt → override applies (inclusive)", atPublish?.policySource === "AREA_OVERRIDE");

      const retiredAt = new Date(Date.now() + 1000);
      await CommercialPolicyOverride.updateOne({ _id: override._id }, { $set: { retiredAt } });
      const atRetire = await resolveApplicableCommercialPolicyForBooking(salon, retiredAt);
      check("9. completedAt === retiredAt → override does NOT apply (exclusive)", atRetire?.policySource !== "AREA_OVERRIDE" || String(atRetire.policy._id) !== String(override._id));
      const beforeRetire = await resolveApplicableCommercialPolicyForBooking(salon, new Date(retiredAt.getTime() - 1));
      check("9. completedAt one ms before retiredAt → override still applies", beforeRetire?.policySource === "AREA_OVERRIDE" && String(beforeRetire.policy._id) === String(override._id));
      await CommercialPolicyOverride.updateOne({ _id: override._id }, { $set: { retiredAt: null } }); // restore for later tests
    }

    // ── 10/11. No policy at all → fail closed, retryable (not a permanent skip) ──
    // Uses districtC — never has an override, so retiring the national
    // policy alone is sufficient to create a genuine "no policy
    // anywhere" gap for this salon.
    {
      const isolatedSalon = await mkSalon(districtC._id, cityC._id, areaC1._id);
      await CommercialPolicyVersion.updateOne({ _id: nationalPolicy._id }, { $set: { status: "RETIRED", retiredAt: new Date(Date.now() - 1) } });
      const resolved = await resolveApplicableCommercialPolicyForBooking(isolatedSalon, new Date());
      check("10. No PUBLISHED policy anywhere → resolves to null (fail closed)", resolved === null);

      const booking = await mkBooking(isolatedSalon);
      const outcome = await processCompletedBooking(booking);
      check("11. processCompletedBooking on a policy gap → PENDING_POLICY_GAP, no ledger row", outcome.outcome === PROCESSING_OUTCOME.PENDING_POLICY_GAP);
      const ledgerCount = await FieldAgentEarningLedger.countDocuments({ bookingRef: booking._id });
      check("11. Zero ledger rows written for a policy-gap booking (retryable, not permanently skipped)", ledgerCount === 0, ledgerCount);

      // restore
      await CommercialPolicyVersion.updateOne({ _id: nationalPolicy._id }, { $set: { status: "PUBLISHED", retiredAt: null } });
    }

    // ── 12/14/15. Acquisition calc, rounding, zero commission ────────
    {
      const salon = await mkSalon(districtC._id, cityC._id, areaC1._id); // national policy: 10%, target 100000
      const { claim } = await mkFieldAgentWithClaim(salon);
      const booking = await mkBooking(salon, { commissionAmountInPaise: 12345 }); // 10% of 12345 = 1234.5 → round-half-up = 1235
      const outcome = await processCompletedBooking(booking);
      check("12/14. Acquisition CREDITED with Math.round(commission*rate/100)", outcome.outcome === "CREDITED" && outcome.creditedAmountInPaise === 1235, outcome);

      const zeroBooking = await mkBooking(salon, { commissionAmountInPaise: 0 });
      const zeroOutcome = await processCompletedBooking(zeroBooking);
      check("15. Zero commission booking → CREDITED with creditedAmountInPaise 0 (never negative, never errors)", zeroOutcome.outcome === "CREDITED" && zeroOutcome.creditedAmountInPaise === 0, zeroOutcome);
    }

    // ── 16/17. Exact target boundary + target exceeded ───────────────
    {
      const salon = await mkSalon(districtC._id, cityC._id, areaC1._id);
      const { claim } = await mkFieldAgentWithClaim(salon);
      // national target 100000, rate 10% → a 1,000,000 paise commission booking's raw eligible = 100000 = exactly the target
      const exactBooking = await mkBooking(salon, { commissionAmountInPaise: 1000000 });
      const exactOutcome = await processCompletedBooking(exactBooking);
      check("16. Exact-target booking credits exactly the remaining capacity", exactOutcome.outcome === "CREDITED" && exactOutcome.creditedAmountInPaise === 100000, exactOutcome);
      const progress = await AcquisitionEarningProgress.findOne({ acquisitionClaimRef: claim._id }).lean();
      check("16. Progress flips to TARGET_REACHED exactly at target, never exceeds it", progress.status === "TARGET_REACHED" && progress.earnedInPaise === 100000, progress);

      const excessBooking = await mkBooking(salon, { commissionAmountInPaise: 1000000 });
      const excessOutcome = await processCompletedBooking(excessBooking);
      check("17. Booking after target reached → ZERO_TARGET_REACHED for acquisition, falls through", excessOutcome !== undefined);
      const acqLedgerAfter = await FieldAgentEarningLedger.findOne({ bookingRef: excessBooking._id, entitlementType: EARNING_ENTITLEMENT_TYPE.ACQUISITION }).lean();
      check("17. Excess booking's ACQUISITION row is ZERO_TARGET_REACHED with 0 credited (no split, no overpay)", acqLedgerAfter?.creditOutcome === EARNING_CREDIT_OUTCOME.ZERO_TARGET_REACHED && acqLedgerAfter.creditedAmountInPaise === 0, acqLedgerAfter);
    }

    // ── 18/19/20. Concurrent workers race (2/5/10) on the SAME claim ──
    for (const n of [2, 5, 10]) {
      const salon = await mkSalon(districtC._id, cityC._id, areaC1._id);
      const { claim } = await mkFieldAgentWithClaim(salon);
      // Each worker processes a DIFFERENT booking (unique idempotencyKey)
      // for the SAME claim, concurrently — raw eligible per booking =
      // 10% of 500000 = 50000; target is 100000, so only 2 bookings'
      // worth of capacity exists regardless of how many race.
      const bookings = await Promise.all(Array.from({ length: n }, () => mkBooking(salon, { commissionAmountInPaise: 500000 })));
      const outcomes = await Promise.all(bookings.map((b) => processCompletedBooking(b)));

      const progress = await AcquisitionEarningProgress.findOne({ acquisitionClaimRef: claim._id }).lean();
      const ledgerRows = await FieldAgentEarningLedger.find({ acquisitionClaimRef: claim._id }).lean();
      const sumCredited = ledgerRows.reduce((s, r) => s + r.creditedAmountInPaise, 0);

      check(`18-20. [${n} workers] earnedInPaise never exceeds targetInPaise`, progress.earnedInPaise <= progress.targetInPaise, progress);
      check(`18-20. [${n} workers] earnedInPaise reaches exactly the target (no under-credit)`, progress.earnedInPaise === progress.targetInPaise, progress);
      check(`18-20. [${n} workers] SUM(ledger.creditedAmountInPaise) === progress.earnedInPaise`, sumCredited === progress.earnedInPaise, { sumCredited, earned: progress.earnedInPaise });
      check(`18-20. [${n} workers] exactly one ledger row per booking (idempotency held under real concurrency)`, ledgerRows.length === n, ledgerRows.length);
    }

    // ── 21. Same-claim sequential ordering — job's own groupBySalon + sequential drain ──
    {
      const salon = await mkSalon(districtC._id, cityC._id, areaC1._id);
      await mkFieldAgentWithClaim(salon);
      const t0 = Date.now();
      const b1 = await mkBooking(salon, { commissionAmountInPaise: 1000000, completedAt: new Date(t0) });
      const b2 = await mkBooking(salon, { commissionAmountInPaise: 1000000, completedAt: new Date(t0 + 1000) });
      const groups = jobInternal.groupBySalon([b1, b2]);
      check("21. groupBySalon groups same-salon bookings into one sequential group", groups.length === 1 && groups[0].length === 2, groups.map((g) => g.length));
      for (const b of groups[0]) await processCompletedBooking(b); // sequential, ascending completedAt — mirrors job's own loop
      const acqRows = await FieldAgentEarningLedger.find({ bookingRef: { $in: [b1._id, b2._id] }, entitlementType: EARNING_ENTITLEMENT_TYPE.ACQUISITION }).sort({ bookingCompletedAt: 1 }).lean();
      check("21. Earlier completedAt booking (b1) gets the positive acquisition credit", acqRows[0]?.creditOutcome === EARNING_CREDIT_OUTCOME.CREDITED && acqRows[0].creditedAmountInPaise === 100000, acqRows[0]);
      check("21. Later completedAt booking (b2) gets ZERO_TARGET_REACHED, never the credit", acqRows[1]?.creditOutcome === EARNING_CREDIT_OUTCOME.ZERO_TARGET_REACHED, acqRows[1]);
    }

    // ── 22. Same completedAt tie — compound cursor must not skip a sibling ──
    {
      const salon = await mkSalon(districtC._id, cityC._id, areaC1._id);
      const tie = new Date();
      const bTie1 = await mkBooking(salon, { commissionAmountInPaise: 1000, completedAt: tie });
      const bTie2 = await mkBooking(salon, { commissionAmountInPaise: 1000, completedAt: tie });
      await FieldAgentEarningJobCheckpoint.updateOne({ _id: EARNING_JOB_CHECKPOINT_ID }, { $set: { lastCompletedAt: tie, lastId: bTie1._id < bTie2._id ? bTie1._id : bTie2._id } }, { upsert: true });
      const checkpoint = await FieldAgentEarningJobCheckpoint.findById(EARNING_JOB_CHECKPOINT_ID).lean();
      const batch = await jobInternal.fetchDiscoveryBatch(checkpoint, new Date(Date.now() + 60000));
      const surviving = batch.filter((b) => String(b._id) === String(bTie1._id) || String(b._id) === String(bTie2._id));
      const higherId = bTie1._id > bTie2._id ? bTie1._id : bTie2._id;
      check("22. Same-completedAt sibling with a higher _id is NOT skipped by the compound cursor", surviving.some((b) => String(b._id) === String(higherId)), surviving.map((b) => String(b._id)));
    }

    // ── 23. Acquisition -> Territory Partner transition ──────────────
    {
      const geo23 = await mkFreshGeography("T23");
      const salon = await mkSalon(geo23.district._id, geo23.city._id, geo23.area._id);
      const { claim } = await mkFieldAgentWithClaim(salon);
      const territory = await CommercialTerritory.create({ name: `${NAME_PREFIX}TERRITORY`, code: `ZF9CT-${Date.now()}`, scopeType: "DISTRICT", scopeKey: `DISTRICT:${geo23.district._id}`, stateRef: state._id, districtRef: geo23.district._id, status: "ACTIVE", createdBy: indiaAdmin._id, updatedBy: indiaAdmin._id });
      fixtureTerritoryIds.push(territory._id);
      const tpUser = await User.create({ name: `${NAME_PREFIX}TP_AGENT`, phone: `7${Math.floor(100000000 + Math.random() * 899999999)}`, role: "FIELD_AGENT", accountStatus: "ACTIVE" });
      fixtureUserIds.push(tpUser._id);
      const tpAgent = await FieldAgent.create({ userRef: tpUser._id, applicationRef: oid(), agentCode: `ZF9TP-${Date.now()}`, operationalStatus: "ACTIVE", commercialPath: "TERRITORY_PARTNER" });
      fixtureFieldAgentIds.push(tpAgent._id);
      const assignment = await TerritoryAssignment.create({ territoryRef: territory._id, fieldAgentRef: tpAgent._id, status: "ACTIVE", effectiveFrom: new Date(Date.now() - 3600000), assignedBy: indiaAdmin._id });
      fixtureAssignmentIds.push(assignment._id);
      await CommercialTerritory.updateOne({ _id: territory._id }, { $set: { currentAssignmentRef: assignment._id } });

      const targetBooking = await mkBooking(salon, { commissionAmountInPaise: 1000000 }); // hits exact target
      await processCompletedBooking(targetBooking);
      const subsequentBooking = await mkBooking(salon, { commissionAmountInPaise: 200000, completedAt: new Date(targetBooking.completedAt.getTime() + 1000) });
      const tpOutcome = await processCompletedBooking(subsequentBooking);
      check("23. Booking after acquisition target reached → CREDITED as TERRITORY_PARTNER", tpOutcome.outcome === "CREDITED", tpOutcome);
      const tpRow = await FieldAgentEarningLedger.findOne({ bookingRef: subsequentBooking._id, entitlementType: "TERRITORY_PARTNER" }).lean();
      check("23. Territory Partner row uses territoryPartnerCommissionPercent (8% of 200000 = 16000)", tpRow?.entitlementType === "TERRITORY_PARTNER" && tpRow.creditedAmountInPaise === 16000, tpRow);
      const allRowsForBooking = await FieldAgentEarningLedger.find({ bookingRef: subsequentBooking._id }).lean();
      const positiveRows = allRowsForBooking.filter((r) => r.creditedAmountInPaise > 0);
      check("6/8/23. Never two positive rows for the same booking", positiveRows.length === 1, positiveRows.length);
    }

    // ── 24/25. Same-booking duplicate processing + E11000 rollback correctness ──
    {
      const salon = await mkSalon(districtC._id, cityC._id, areaC1._id);
      const { claim } = await mkFieldAgentWithClaim(salon);
      const booking = await mkBooking(salon, { commissionAmountInPaise: 50000 });
      const [o1, o2, o3] = await Promise.all([processCompletedBooking(booking), processCompletedBooking(booking), processCompletedBooking(booking)]);
      const rows = await FieldAgentEarningLedger.find({ bookingRef: booking._id, entitlementType: EARNING_ENTITLEMENT_TYPE.ACQUISITION }).lean();
      check("24/25. Triplicate concurrent processing of the SAME booking → exactly one ledger row (E11000-guarded)", rows.length === 1, rows.length);
      const progress = await AcquisitionEarningProgress.findOne({ acquisitionClaimRef: claim._id }).lean();
      check("25. Duplicate attempts never double-increment progress (rollback-on-collision proven)", progress.earnedInPaise === rows[0].creditedAmountInPaise, { earned: progress.earnedInPaise, row: rows[0].creditedAmountInPaise });
    }

    // ── 26. Immutable ledger ──────────────────────────────────────────
    {
      const anyRow = await FieldAgentEarningLedger.findOne({}).lean();
      let blocked = false;
      try {
        await FieldAgentEarningLedger.updateOne({ _id: anyRow._id }, { $set: { creditedAmountInPaise: 999999999 } });
      } catch (err) {
        blocked = /immutable/i.test(err.message);
      }
      check("26. FieldAgentEarningLedger update is blocked at the schema level", blocked);
    }

    // ── 27. Deleted/inactive salon remains processable ────────────────
    {
      const salon = await mkSalon(districtC._id, cityC._id, areaC1._id, { isDeleted: true });
      await mkFieldAgentWithClaim(salon);
      const booking = await mkBooking(salon, { commissionAmountInPaise: 10000 });
      const outcome = await processCompletedBooking(booking);
      check("27. isDeleted salon's completed booking is still processed (CREDITED)", outcome.outcome === "CREDITED", outcome);
    }

    // ── 28/29. Suspended / blocked agent ───────────────────────────────
    for (const status of ["SUSPENDED", "BLOCKED"]) {
      const salon = await mkSalon(districtC._id, cityC._id, areaC1._id);
      const { claim } = await mkFieldAgentWithClaim(salon, status);
      const booking = await mkBooking(salon, { commissionAmountInPaise: 10000 });
      const outcome = await processCompletedBooking(booking);
      check(`28/29. ${status} agent → ZERO_AGENT_INELIGIBLE, creditedAmountInPaise 0`, outcome.outcome === "ZERO_AGENT_INELIGIBLE" && outcome.creditedAmountInPaise === 0, outcome);
      const progress = await AcquisitionEarningProgress.findOne({ acquisitionClaimRef: claim._id }).lean();
      check(`28/29. ${status} agent's forfeited booking does NOT consume target capacity`, !progress || progress.earnedInPaise === 0, progress);
    }

    // ── 30/31/32. Crash/retry, checkpoint recovery, duplicate backend workers ──
    {
      const salon = await mkSalon(districtC._id, cityC._id, areaC1._id);
      await mkFieldAgentWithClaim(salon);
      // Backdated well beyond EARNING_JOB_GRACE_PERIOD_MS (3 minutes) —
      // the discovery query's upper bound excludes anything more
      // recent than that (clock-skew defense), so a "just now"
      // completedAt would never be discovered at all.
      const backdatedNow = new Date(Date.now() - 10 * 60 * 1000);
      const b1 = await mkBooking(salon, { commissionAmountInPaise: 10000, completedAt: backdatedNow });
      const b2 = await mkBooking(salon, { commissionAmountInPaise: 10000, completedAt: new Date(backdatedNow.getTime() + 1000) });

      await FieldAgentEarningJobCheckpoint.updateOne({ _id: EARNING_JOB_CHECKPOINT_ID }, { $set: { lastCompletedAt: new Date(b1.completedAt.getTime() - 60000), lastId: new mongoose.Types.ObjectId("000000000000000000000000") } }, { upsert: true });

      // Simulate two "backend instances" ticking concurrently against
      // the same durable checkpoint.
      const [tickA, tickB] = await Promise.allSettled([jobInternal.runEarningJobTick(), jobInternal.runEarningJobTick()]);
      check("32. Two concurrent job ticks (duplicate backend workers) both complete without throwing", tickA.status === "fulfilled" && tickB.status === "fulfilled", [tickA.status, tickB.status]);

      const rows = await FieldAgentEarningLedger.find({ bookingRef: { $in: [b1._id, b2._id] } }).lean();
      const byBooking = new Map();
      for (const r of rows) {
        const k = `${r.bookingRef}:${r.entitlementType}`;
        byBooking.set(k, (byBooking.get(k) || 0) + 1);
      }
      check("32. No booking+entitlementType has more than one ledger row after concurrent ticks", [...byBooking.values()].every((c) => c === 1), [...byBooking.entries()]);

      const checkpointAfter = await FieldAgentEarningJobCheckpoint.findById(EARNING_JOB_CHECKPOINT_ID).lean();
      check("31. Checkpoint advanced forward past both bookings (recovery from a stale checkpoint works)", checkpointAfter.lastCompletedAt.getTime() >= b2.completedAt.getTime(), checkpointAfter.lastCompletedAt);

      // 30 — "crash": force the checkpoint back and confirm a fresh tick reprocesses safely (idempotent replay, no duplicate rows, no crash)
      await FieldAgentEarningJobCheckpoint.updateOne({ _id: EARNING_JOB_CHECKPOINT_ID }, { $set: { lastCompletedAt: new Date(b1.completedAt.getTime() - 60000), lastId: new mongoose.Types.ObjectId("000000000000000000000000") } });
      await jobInternal.runEarningJobTick();
      const rowsAfterReplay = await FieldAgentEarningLedger.find({ bookingRef: { $in: [b1._id, b2._id] } }).lean();
      check("30. Replaying an already-processed range after a simulated crash produces no duplicate rows", rowsAfterReplay.length === rows.length, { before: rows.length, after: rowsAfterReplay.length });
    }

    // ── 33. Query explain / IXSCAN on the new Booking index ───────────
    {
      const explainResult = await Booking.collection
        .find({ status: BOOKING_STATUS.COMPLETED, completedAt: { $gt: new Date(0) } })
        .sort({ completedAt: 1, _id: 1 })
        .explain("executionStats");
      const winningPlan = explainResult.queryPlanner.winningPlan;
      const stageStr = JSON.stringify(winningPlan);
      check("33. Discovery query plan uses an IXSCAN (not COLLSCAN)", stageStr.includes("IXSCAN"), winningPlan.stage || winningPlan.inputStage?.stage);
      check("33. Discovery query plan has no in-memory SORT stage", !stageStr.includes('"stage":"SORT"'));
    }

    // ── 34. Production/frozen-boundary verification ───────────────────
    {
      const bookingIndexes = await Booking.collection.indexes();
      const hasEarningIndex = bookingIndexes.some((i) => i.partialFilterExpression?.status === "COMPLETED" && Object.keys(i.key).join(",") === "status,completedAt,_id");
      check("34. Booking has the new additive {status,completedAt,_id} partial index", hasEarningIndex);
      check("34. No new field was added to Booking's own schema (spot check on a fresh doc)", (await Booking.findById(fixtureBookingIds[0]).lean()).acquisitionClaimRef === undefined);

      const overrideIndexes = await CommercialPolicyOverride.collection.indexes();
      check("34. CommercialPolicyOverride has per-scope PUBLISHED unique index", overrideIndexes.some((i) => i.unique && i.partialFilterExpression?.status === "PUBLISHED"));
      const lockIndexes = await PolicyOverrideActivationLock.collection.indexes();
      check("34. PolicyOverrideActivationLock has unique districtRef index (separate from TerritoryActivationLock)", lockIndexes.some((i) => i.unique && Object.keys(i.key).join(",") === "districtRef"));

      const ledgerIndexes = await FieldAgentEarningLedger.collection.indexes();
      check("34. FieldAgentEarningLedger has unique idempotencyKey index", ledgerIndexes.some((i) => i.unique && Object.keys(i.key).join(",") === "idempotencyKey"));
    }

    // ════════════════════════════════════════════════════════════════
    // FA-9 CORRECTIVE ROUND — Findings A-1, B-1, B-2 regression tests
    // ════════════════════════════════════════════════════════════════

    // ── F-1. Job-level PENDING_POLICY_GAP: gap recorded, checkpoint
    // still advances, later policy publication makes it reprocessable ──
    {
      const isolatedSalon = await mkSalon(districtC._id, cityC._id, areaC1._id);
      // Give this salon a real ACTIVE claim (created WHILE the policy
      // is still published, so its progress snapshots normally) so
      // reconciliation, once the policy is republished, produces an
      // actual CREDITED ledger row — a more meaningful proof than
      // merely observing the gap flip to RESOLVED with no entitlement.
      await mkFieldAgentWithClaim(isolatedSalon);
      await CommercialPolicyVersion.updateOne({ _id: nationalPolicy._id }, { $set: { status: "RETIRED", retiredAt: new Date(Date.now() - 1) } });

      const backdated = new Date(Date.now() - 10 * 60 * 1000);
      const gapBooking = await mkBooking(isolatedSalon, { commissionAmountInPaise: 10000, completedAt: backdated });
      const outcome = await processCompletedBooking(gapBooking);
      check("F-1. Policy-gap booking returns PENDING_POLICY_GAP", outcome.outcome === "PENDING_POLICY_GAP");

      const gapRow = await FieldAgentEarningPolicyGap.findOne({ referenceKey: `gap:booking:${gapBooking._id}` }).lean();
      check("F-1. Gap durably recorded as OPEN with correct resolutionInstant", gapRow?.status === GAP_STATUS.OPEN && gapRow.gapType === GAP_TYPE.BOOKING_POLICY_GAP && gapRow.resolutionInstant.getTime() === backdated.getTime());

      // Simulate the checkpoint having already advanced PAST this
      // booking (exactly the real defect scenario) — the gap must
      // still be independently reprocessable regardless.
      await FieldAgentEarningJobCheckpoint.updateOne({ _id: EARNING_JOB_CHECKPOINT_ID }, { $set: { lastCompletedAt: new Date(), lastId: new mongoose.Types.ObjectId("ffffffffffffffffffffffff") } }, { upsert: true });

      // Now publish a policy and run the reconciliation sweep directly.
      await CommercialPolicyVersion.updateOne({ _id: nationalPolicy._id }, { $set: { status: "PUBLISHED", retiredAt: null } });
      const reGap = await FieldAgentEarningPolicyGap.findOne({ referenceKey: `gap:booking:${gapBooking._id}` }).lean();
      const reprocessResult = await reprocessOneGap(reGap);
      check("F-1. Reconciliation reprocesses the gap successfully once policy exists", reprocessResult.reprocessed === true, reprocessResult);

      const gapAfter = await FieldAgentEarningPolicyGap.findOne({ referenceKey: `gap:booking:${gapBooking._id}` }).lean();
      check("F-1. Gap transitions to RESOLVED", gapAfter?.status === GAP_STATUS.RESOLVED);
      const ledgerAfter = await FieldAgentEarningLedger.findOne({ bookingRef: gapBooking._id }).lean();
      check("F-1. Booking now has a real ledger outcome after reconciliation", !!ledgerAfter);
    }

    // ── F-2. Recovery / backfill for bookings the checkpoint already
    // passed BEFORE gap-tracking existed for them ──
    {
      const isolatedSalon = await mkSalon(districtC._id, cityC._id, areaC1._id);
      await mkFieldAgentWithClaim(isolatedSalon);
      const backdated = new Date(Date.now() - 20 * 60 * 1000);
      const preExistingBooking = await mkBooking(isolatedSalon, { commissionAmountInPaise: 5000, completedAt: backdated });
      // No gap recorded yet, no ledger row yet — simulating history the
      // checkpoint consumed before this corrective round existed.
      const preCheck = await FieldAgentEarningPolicyGap.findOne({ referenceKey: `gap:booking:${preExistingBooking._id}` }).lean();
      check("F-2. No gap exists yet for this simulated pre-existing booking", !preCheck);

      const { backfillHistoricalBookingGaps } = await import("../modules/fieldAgent/services/fieldAgentEarning.service.js");
      // IMPORTANT: sinceCompletedAt scopes this strictly to the fixture
      // window — omitting it would scan the ENTIRE real production
      // Booking history (confirmed the hard way: an earlier version of
      // this test without the bound registered gap-tracking rows for
      // every real completed booking in production before being caught
      // and cleaned up). A verification script must never touch
      // unbounded real history.
      const backfillResult = await backfillHistoricalBookingGaps({
        sinceCompletedAt: new Date(backdated.getTime() - 1000),
        upToCompletedAt: new Date(backdated.getTime() + 1000),
        batchSize: 500,
      });
      check("F-2. Backfill scans and records at least the one simulated booking", backfillResult.scanned >= 1 && backfillResult.gapsRecorded >= 1, backfillResult);

      const gapNow = await FieldAgentEarningPolicyGap.findOne({ referenceKey: `gap:booking:${preExistingBooking._id}` }).lean();
      check("F-2. Backfill durably records the previously-untracked booking as OPEN", gapNow?.status === GAP_STATUS.OPEN);

      const reprocessResult = await reprocessOneGap(gapNow);
      check("F-2. Backfilled gap is fully reprocessable (no loss)", reprocessResult.reprocessed === true, reprocessResult);
      const ledgerAfter = await FieldAgentEarningLedger.findOne({ bookingRef: preExistingBooking._id }).lean();
      check("F-2. Reprocessed backfilled booking has a real ledger outcome", !!ledgerAfter);

      // Re-running backfill (same bound) must be a safe no-op (idempotent).
      const backfillAgain = await backfillHistoricalBookingGaps({
        sinceCompletedAt: new Date(backdated.getTime() - 1000),
        upToCompletedAt: new Date(backdated.getTime() + 1000),
        batchSize: 500,
      });
      check("F-2. Re-running backfill after resolution does not re-flag the same booking as a NEW gap", backfillAgain.gapsRecorded === 0, backfillAgain);
    }

    // ── F-3/F-4/F-13/F-14. Suspended & blocked Territory Partner MUST
    // NOT receive earning; suspended Acquisition Agent MUST NOT fall
    // through to Territory Partner ──
    for (const status of ["SUSPENDED", "BLOCKED"]) {
      const geoTp = await mkFreshGeography(`TP${status.slice(0, 3)}`);
      const salon = await mkSalon(geoTp.district._id, geoTp.city._id, geoTp.area._id);
      const territory = await CommercialTerritory.create({ name: `${NAME_PREFIX}TERR_TP_${status}`, code: `ZF9CT-TP-${status}-${Date.now()}`, scopeType: "DISTRICT", scopeKey: `DISTRICT:${geoTp.district._id}`, stateRef: state._id, districtRef: geoTp.district._id, status: "ACTIVE", createdBy: indiaAdmin._id, updatedBy: indiaAdmin._id });
      fixtureTerritoryIds.push(territory._id);
      const tpUser = await User.create({ name: `${NAME_PREFIX}TP_${status}`, phone: `7${Math.floor(100000000 + Math.random() * 899999999)}`, role: "FIELD_AGENT", accountStatus: status });
      fixtureUserIds.push(tpUser._id);
      const tpAgent = await FieldAgent.create({ userRef: tpUser._id, applicationRef: oid(), agentCode: `ZF9TP-${status}-${Date.now()}`, operationalStatus: "ACTIVE", commercialPath: "TERRITORY_PARTNER" });
      fixtureFieldAgentIds.push(tpAgent._id);
      const assignment = await TerritoryAssignment.create({ territoryRef: territory._id, fieldAgentRef: tpAgent._id, status: "ACTIVE", effectiveFrom: new Date(Date.now() - 3600000), assignedBy: indiaAdmin._id });
      fixtureAssignmentIds.push(assignment._id);
      await CommercialTerritory.updateOne({ _id: territory._id }, { $set: { currentAssignmentRef: assignment._id } });

      // No AcquisitionClaim on this salon — booking goes straight to Territory Partner evaluation.
      const booking = await mkBooking(salon, { commissionAmountInPaise: 50000 });
      const outcome = await processCompletedBooking(booking);
      check(`F-3/F-4. ${status} Territory Partner → ZERO_AGENT_INELIGIBLE, not CREDITED`, outcome.outcome === "ZERO_AGENT_INELIGIBLE" && outcome.creditedAmountInPaise === 0, outcome);
    }
    {
      // F-13: suspended Acquisition Agent must NOT fall through to a
      // (separately eligible) Territory Partner for the same booking.
      const geoFt = await mkFreshGeography("FT");
      const salon = await mkSalon(geoFt.district._id, geoFt.city._id, geoFt.area._id);
      const territory = await CommercialTerritory.create({ name: `${NAME_PREFIX}TERR_FALLTHRU`, code: `ZF9CT-FT-${Date.now()}`, scopeType: "DISTRICT", scopeKey: `DISTRICT:${geoFt.district._id}`, stateRef: state._id, districtRef: geoFt.district._id, status: "ACTIVE", createdBy: indiaAdmin._id, updatedBy: indiaAdmin._id });
      fixtureTerritoryIds.push(territory._id);
      const tpUser = await User.create({ name: `${NAME_PREFIX}TP_ACTIVE_FT`, phone: `7${Math.floor(100000000 + Math.random() * 899999999)}`, role: "FIELD_AGENT", accountStatus: "ACTIVE" });
      fixtureUserIds.push(tpUser._id);
      const tpAgent = await FieldAgent.create({ userRef: tpUser._id, applicationRef: oid(), agentCode: `ZF9TP-FT-${Date.now()}`, operationalStatus: "ACTIVE", commercialPath: "TERRITORY_PARTNER" });
      fixtureFieldAgentIds.push(tpAgent._id);
      const assignment = await TerritoryAssignment.create({ territoryRef: territory._id, fieldAgentRef: tpAgent._id, status: "ACTIVE", effectiveFrom: new Date(Date.now() - 3600000), assignedBy: indiaAdmin._id });
      fixtureAssignmentIds.push(assignment._id);
      await CommercialTerritory.updateOne({ _id: territory._id }, { $set: { currentAssignmentRef: assignment._id } });

      await mkFieldAgentWithClaim(salon, "SUSPENDED"); // suspended Acquisition Agent, ACTIVE claim, target not reached
      const booking = await mkBooking(salon, { commissionAmountInPaise: 50000 });
      const outcome = await processCompletedBooking(booking);
      check("F-13. Suspended Acquisition Agent → ZERO_AGENT_INELIGIBLE, no Territory Partner fallthrough on same booking", outcome.outcome === "ZERO_AGENT_INELIGIBLE");
      const tpRow = await FieldAgentEarningLedger.findOne({ bookingRef: booking._id, entitlementType: "TERRITORY_PARTNER" }).lean();
      check("F-13/F-14. No Territory Partner row was ever written for this booking", !tpRow);
    }

    // ── F-5. Partial cap: target 200, earned 180, raw 70 → credit exactly 20 ──
    {
      const geoF5 = await mkFreshGeography("F5");
      const salon = await mkSalon(geoF5.district._id, geoF5.city._id, geoF5.area._id);
      const { claim } = await mkFieldAgentWithClaim(salon);
      // National policy target is 100000; drive earnedInPaise to 18000
      // (analogous to ₹180 of a ₹200 target) via a first booking, then
      // present a second booking whose raw eligible (10% of commission)
      // is 7000 (₹70) — only 2000 (₹20) of remaining capacity exists.
      await AcquisitionEarningProgress.updateOne({ acquisitionClaimRef: claim._id }, { $set: { earnedInPaise: 18000, targetInPaise: 20000 } });
      const booking = await mkBooking(salon, { commissionAmountInPaise: 70000 }); // 10% => raw eligible 7000
      const outcome = await processCompletedBooking(booking);
      check("F-5. Partial cap credits exactly the remaining capacity (20), not the full raw eligible (70)", outcome.outcome === "CREDITED" && outcome.creditedAmountInPaise === 2000, outcome);
      const progress = await AcquisitionEarningProgress.findOne({ acquisitionClaimRef: claim._id }).lean();
      check("F-5. Progress reaches exactly target, TARGET_REACHED", progress.earnedInPaise === 20000 && progress.status === "TARGET_REACHED");
      const tpRow = await FieldAgentEarningLedger.findOne({ bookingRef: booking._id, entitlementType: "TERRITORY_PARTNER" }).lean();
      check("F-5/F-6. Target-reaching booking itself has NO Territory Partner row (no split, excess discarded)", !tpRow);

      // F-7: the SUBSEQUENT booking may earn Territory Partner.
      const territory = await CommercialTerritory.create({ name: `${NAME_PREFIX}TERR_F7`, code: `ZF9CT-F7-${Date.now()}`, scopeType: "DISTRICT", scopeKey: `DISTRICT:${geoF5.district._id}`, stateRef: state._id, districtRef: geoF5.district._id, status: "ACTIVE", createdBy: indiaAdmin._id, updatedBy: indiaAdmin._id });
      fixtureTerritoryIds.push(territory._id);
      const tpUser = await User.create({ name: `${NAME_PREFIX}TP_F7`, phone: `7${Math.floor(100000000 + Math.random() * 899999999)}`, role: "FIELD_AGENT", accountStatus: "ACTIVE" });
      fixtureUserIds.push(tpUser._id);
      const tpAgent = await FieldAgent.create({ userRef: tpUser._id, applicationRef: oid(), agentCode: `ZF9TP-F7-${Date.now()}`, operationalStatus: "ACTIVE", commercialPath: "TERRITORY_PARTNER" });
      fixtureFieldAgentIds.push(tpAgent._id);
      const assignment = await TerritoryAssignment.create({ territoryRef: territory._id, fieldAgentRef: tpAgent._id, status: "ACTIVE", effectiveFrom: new Date(Date.now() - 3600000), assignedBy: indiaAdmin._id });
      fixtureAssignmentIds.push(assignment._id);
      await CommercialTerritory.updateOne({ _id: territory._id }, { $set: { currentAssignmentRef: assignment._id } });

      const nextBooking = await mkBooking(salon, { commissionAmountInPaise: 40000, completedAt: new Date(booking.completedAt.getTime() + 1000) });
      const nextOutcome = await processCompletedBooking(nextBooking);
      check("F-7. Subsequent booking after target reached earns Territory Partner", nextOutcome.outcome === "CREDITED" && nextOutcome.creditedAmountInPaise === 3200 /* 8% of 40000 */, nextOutcome);
    }

    // ── F-8. Same completedAt + different _id ordering for the actual
    // earning transition (not just discovery) ──
    {
      const salon = await mkSalon(districtC._id, cityC._id, areaC1._id);
      const { claim } = await mkFieldAgentWithClaim(salon);
      await AcquisitionEarningProgress.updateOne({ acquisitionClaimRef: claim._id }, { $set: { earnedInPaise: 0, targetInPaise: 5000 } });
      const tie = new Date();
      const bA = await mkBooking(salon, { commissionAmountInPaise: 50000, completedAt: tie }); // raw 5000 — exactly the target
      const bB = await mkBooking(salon, { commissionAmountInPaise: 50000, completedAt: tie }); // same completedAt tie
      const ordered = bA._id < bB._id ? [bA, bB] : [bB, bA]; // mirror the job's own (completedAt,_id) sort
      const outcomes = [];
      for (const b of ordered) outcomes.push(await processCompletedBooking(b));
      check("F-8. First _id-ordered booking (of an exact completedAt tie) gets the acquisition credit", outcomes[0].outcome === "CREDITED" && outcomes[0].creditedAmountInPaise === 5000, outcomes[0]);
      check("F-8. Second _id-ordered booking gets ZERO_TARGET_REACHED (or falls through), never a second positive acquisition credit", outcomes[1].outcome !== "CREDITED" || outcomes[1].creditedAmountInPaise === 0, outcomes[1]);
    }

    // ── F-9. Target snapshot: claim created under Policy V1 (target
    // 200), Policy V2 (target 500) published later — progress target
    // MUST remain locked at 200, resolved via the REAL redeemReferral
    // integration point (acquisitionClaim.service.js) ──
    {
      // Retire the original nationalPolicy FIRST — CommercialPolicyVersion
      // has a real partial-unique index on {status:"PUBLISHED"} (at
      // most one at a time), so V1 cannot be created as PUBLISHED while
      // nationalPolicy is still PUBLISHED.
      await CommercialPolicyVersion.updateOne({ _id: nationalPolicy._id }, { $set: { status: "RETIRED", retiredAt: new Date(Date.now() - 61000) } });

      const v1Policy = await CommercialPolicyVersion.create({
        versionNumber: 910001 + Math.floor(Math.random() * 100000),
        status: "PUBLISHED",
        acquisitionAgentCommissionPercent: 10,
        acquisitionEarningTargetInPaise: 20000, // "₹200"
        territoryPartnerCommissionPercent: 8,
        licenseTermMonths: 12,
        claimExpiryDays: 30,
        createdBy: indiaAdmin._id,
        publishedBy: indiaAdmin._id,
        publishedAt: new Date(Date.now() - 60000),
        obligations: [{ key: FIXTURE_MARKER, description: "F-9 fixture" }],
      });
      fixturePolicyIds.push(v1Policy._id);

      const geoF9 = await mkFreshGeography("F9");
      const salon = await mkSalon(geoF9.district._id, geoF9.city._id, geoF9.area._id);
      const agentUser = await User.create({ name: `${NAME_PREFIX}F9_AGENT`, phone: `6${Math.floor(100000000 + Math.random() * 899999999)}`, role: "FIELD_AGENT", accountStatus: "ACTIVE" });
      fixtureUserIds.push(agentUser._id);
      const application = oid();
      const fieldAgent = await FieldAgent.create({ userRef: agentUser._id, applicationRef: application, agentCode: `ZF9-F9-${Date.now()}`, operationalStatus: "ACTIVE", commercialPath: "ACQUISITION_AGENT" });
      fixtureFieldAgentIds.push(fieldAgent._id);
      const referral = await issueReferral({ userId: agentUser._id });

      const { claim } = await redeemReferral({ ownerId: salon.ownerId, referralCode: referral.code });
      fixtureClaimIds.push(claim._id);

      const progressAtCreation = await AcquisitionEarningProgress.findOne({ acquisitionClaimRef: claim._id }).lean();
      check("F-9. Real redeemReferral integration eagerly creates AcquisitionEarningProgress", !!progressAtCreation);
      check("F-9. Target snapshotted from V1 (20000), not defaulted/invented", progressAtCreation?.targetInPaise === 20000, progressAtCreation);

      // Publish V2 with a different target — must NOT retroactively
      // affect this already-created claim's progress. Retire V1 FIRST
      // (same single-PUBLISHED unique-index constraint as above).
      await CommercialPolicyVersion.updateOne({ _id: v1Policy._id }, { $set: { status: "RETIRED", retiredAt: new Date() } });
      const v2Policy = await CommercialPolicyVersion.create({
        versionNumber: 920001 + Math.floor(Math.random() * 100000),
        status: "PUBLISHED",
        acquisitionAgentCommissionPercent: 10,
        acquisitionEarningTargetInPaise: 50000, // "₹500"
        territoryPartnerCommissionPercent: 8,
        licenseTermMonths: 12,
        claimExpiryDays: 30,
        createdBy: indiaAdmin._id,
        publishedBy: indiaAdmin._id,
        publishedAt: new Date(),
        obligations: [{ key: FIXTURE_MARKER, description: "F-9 fixture V2" }],
      });
      fixturePolicyIds.push(v2Policy._id);

      const firstBooking = await mkBooking(salon, { commissionAmountInPaise: 10000, completedAt: new Date() });
      await processCompletedBooking(firstBooking);
      const progressAfterV2 = await AcquisitionEarningProgress.findOne({ acquisitionClaimRef: claim._id }).lean();
      check("F-9. Target remains locked at V1's 20000 after V2 publication and a booking processed under V2's rate window", progressAfterV2.targetInPaise === 20000, progressAfterV2);

      // restore national policy for subsequent tests — retire V2 FIRST.
      await CommercialPolicyVersion.updateOne({ _id: v2Policy._id }, { $set: { status: "RETIRED", retiredAt: new Date() } });
      await CommercialPolicyVersion.updateOne({ _id: nationalPolicy._id }, { $set: { status: "PUBLISHED", retiredAt: null } });
    }

    // ── F-10. Target snapshot concurrency/idempotency: simultaneous
    // progress-creation attempts for the SAME claim produce exactly one
    // progress record ──
    {
      const salon = await mkSalon(districtC._id, cityC._id, areaC1._id);
      const agentUser = await User.create({ name: `${NAME_PREFIX}F10_AGENT`, phone: `6${Math.floor(100000000 + Math.random() * 899999999)}`, role: "FIELD_AGENT", accountStatus: "ACTIVE" });
      fixtureUserIds.push(agentUser._id);
      const fieldAgent = await FieldAgent.create({ userRef: agentUser._id, applicationRef: oid(), agentCode: `ZF9-F10-${Date.now()}`, operationalStatus: "ACTIVE", commercialPath: "ACQUISITION_AGENT" });
      fixtureFieldAgentIds.push(fieldAgent._id);
      const claim = await AcquisitionClaim.create({ salonRef: salon._id, fieldAgentRef: fieldAgent._id, status: "ACTIVE", stateRef: state._id, districtRef: salon.location.territory.districtRef });
      fixtureClaimIds.push(claim._id);

      const results = await Promise.all(Array.from({ length: 8 }, () => createAcquisitionEarningProgressForClaim({ claim, salon })));
      check("F-10. All 8 concurrent attempts resolve without throwing", results.every((r) => r !== undefined));
      const progressCount = await AcquisitionEarningProgress.countDocuments({ acquisitionClaimRef: claim._id });
      check("F-10. Exactly one AcquisitionEarningProgress document exists after 8 concurrent creation attempts", progressCount === 1, progressCount);
    }

    // ── F-12. Zero-commission booking AFTER target reached — must be
    // ZERO_TARGET_REACHED (not conflated with a legitimate zero credit) ──
    {
      const salon = await mkSalon(districtC._id, cityC._id, areaC1._id);
      const { claim } = await mkFieldAgentWithClaim(salon);
      await AcquisitionEarningProgress.updateOne({ acquisitionClaimRef: claim._id }, { $set: { earnedInPaise: 100000, targetInPaise: 100000, status: "TARGET_REACHED" } });
      const zeroBooking = await mkBooking(salon, { commissionAmountInPaise: 0 });
      const outcome = await processCompletedBooking(zeroBooking);
      const acqRow = await FieldAgentEarningLedger.findOne({ bookingRef: zeroBooking._id, entitlementType: "ACQUISITION" }).lean();
      check("F-12. Zero-commission booking after target reached → ZERO_TARGET_REACHED (not a plain zero-credit)", acqRow?.creditOutcome === "ZERO_TARGET_REACHED", acqRow);
    }

    // ── F-11. Policy-resolution query explain() — indexed, not a
    // collection scan ──
    {
      const explainResult = await CommercialPolicyOverride.collection
        .find({ status: "PUBLISHED", scopeType: "DISTRICT", districtRef: districtC._id })
        .explain("executionStats");
      const stageStr = JSON.stringify(explainResult.queryPlanner.winningPlan);
      check("F-11. Policy-override resolution query uses an index (IXSCAN or a covered/indexed plan, not COLLSCAN)", !stageStr.includes("COLLSCAN"), explainResult.queryPlanner.winningPlan.stage);
    }
  } catch (err) {
    console.error("❌ FA-9 verification body threw — printing before cleanup:", err.message);
    console.error(err.stack);
    fail++;
    results.push(`❌ Script body threw an uncaught error: ${err.message}`);
  } finally {
    // ── CLEANUP — zero residue ────────────────────────────────────────
    await FieldAgentEarningPolicyGap.deleteMany({ $or: [{ bookingRef: { $in: fixtureBookingIds } }, { acquisitionClaimRef: { $in: fixtureClaimIds } }] });
    await AcquisitionReferral.deleteMany({ fieldAgentRef: { $in: fixtureFieldAgentIds } });
    await FieldAgentEarningLedger.collection.deleteMany({ bookingRef: { $in: fixtureBookingIds } });
    await AcquisitionEarningProgress.deleteMany({ acquisitionClaimRef: { $in: fixtureClaimIds } });
    await Booking.deleteMany({ _id: { $in: fixtureBookingIds } });
    await AcquisitionClaim.deleteMany({ _id: { $in: fixtureClaimIds } });
    await TerritoryAssignment.deleteMany({ _id: { $in: fixtureAssignmentIds } });
    await CommercialTerritory.deleteMany({ _id: { $in: fixtureTerritoryIds } });
    await FieldAgent.deleteMany({ _id: { $in: fixtureFieldAgentIds } });
    for (const id of fixtureOverrideIds) {
      await PolicyOverrideActivationLock.deleteMany({}); // districtA/B locks are fixture-only in this run
    }
    await CommercialPolicyOverride.deleteMany({ _id: { $in: fixtureOverrideIds } });
    await CommercialPolicyVersion.deleteMany({ _id: { $in: fixturePolicyIds } });
    await Salon.deleteMany({ _id: { $in: fixtureSalonIds } });
    await User.deleteMany({ _id: { $in: fixtureUserIds } });
    await Area.deleteMany({ _id: { $in: [areaA1._id, areaB1._id, areaC1._id] } });
    await City.deleteMany({ _id: { $in: [cityA._id, cityB._id, cityC._id] } });
    await District.deleteMany({ _id: { $in: [districtA._id, districtB._id, districtC._id] } });
    await State.deleteMany({ _id: state._id });
    // Restore the REAL production checkpoint exactly as it was before
    // this run touched it (see the setup comment above) — never delete
    // the shared singleton.
    if (originalCheckpoint) {
      await FieldAgentEarningJobCheckpoint.updateOne(
        { _id: EARNING_JOB_CHECKPOINT_ID },
        { $set: { lastCompletedAt: originalCheckpoint.lastCompletedAt, lastId: originalCheckpoint.lastId, updatedAt: new Date() } }
      );
    } else {
      await FieldAgentEarningJobCheckpoint.deleteOne({ _id: EARNING_JOB_CHECKPOINT_ID }); // it genuinely didn't exist before this run
    }

    const residue = {
      bookings: await Booking.countDocuments({ _id: { $in: fixtureBookingIds } }),
      claims: await AcquisitionClaim.countDocuments({ _id: { $in: fixtureClaimIds } }),
      ledger: await FieldAgentEarningLedger.countDocuments({ bookingRef: { $in: fixtureBookingIds } }),
      salons: await Salon.countDocuments({ _id: { $in: fixtureSalonIds } }),
      users: await User.countDocuments({ _id: { $in: fixtureUserIds } }),
      overrides: await CommercialPolicyOverride.countDocuments({ _id: { $in: fixtureOverrideIds } }),
      policies: await CommercialPolicyVersion.countDocuments({ _id: { $in: fixturePolicyIds } }),
      gaps: await FieldAgentEarningPolicyGap.countDocuments({ $or: [{ bookingRef: { $in: fixtureBookingIds } }, { acquisitionClaimRef: { $in: fixtureClaimIds } }] }),
    };
    check("Zero residue — all FA-9 fixtures removed", Object.values(residue).every((c) => c === 0), residue);

    server.close();
    console.log("\n" + results.join("\n"));
    console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
    await mongoose.connection.close();
    process.exit(fail > 0 ? 1 : 0);
  }
};

run().catch(async (err) => {
  console.error("❌ Verification script crashed:", err.message);
  console.error(err.stack);
  try {
    await mongoose.connection.close();
  } catch (_) {}
  process.exit(1);
});
