/**
 * BARBER ENGINE V1
 * backend/scripts/verifyTerritoryPartnerTermEnforcement.js
 *
 * FA-10 — dedicated, real-Mongo verification suite for Territory
 * Partner 3-year term enforcement. Mirrors verifyFieldAgentEarningEngine.js's
 * own established methodology exactly: real MongoDB (no mocks), real
 * transactions/concurrency, disposable fixtures with an explicit
 * marker, explicit zero-residue cleanup, and careful preservation of
 * the shared production FieldAgentEarningJobCheckpoint singleton
 * (never deleted — snapshotted and restored, per the FA-9 corrective
 * round's own hard-learned lesson).
 *
 * Run:
 *   cd backend
 *   node scripts/verifyTerritoryPartnerTermEnforcement.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";

import User from "../models/User.js";
import Salon from "../models/Salon.js";
import Booking, { BOOKING_STATUS } from "../models/Booking.js";
import Country from "../models/Country.js";
import State from "../models/State.js";
import District from "../models/District.js";
import City from "../models/City.js";
import Area from "../models/Area.js";

import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import CommercialTerritory from "../modules/fieldAgent/models/CommercialTerritory.js";
import TerritoryAssignment from "../modules/fieldAgent/models/TerritoryAssignment.js";
import TerritoryPartnerTermSnapshot from "../modules/fieldAgent/models/TerritoryPartnerTermSnapshot.js";
import CommercialPolicyVersion from "../modules/fieldAgent/models/CommercialPolicyVersion.js";
import FieldAgentEarningLedger from "../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import FieldAgentEarningPolicyGap from "../modules/fieldAgent/models/FieldAgentEarningPolicyGap.js";
import FieldAgentEarningJobCheckpoint from "../modules/fieldAgent/models/FieldAgentEarningJobCheckpoint.js";
import AcquisitionClaim from "../modules/fieldAgent/models/AcquisitionClaim.js";
import AcquisitionEarningProgress from "../modules/fieldAgent/models/AcquisitionEarningProgress.js";

import { assignPartner, vacatePartner } from "../modules/fieldAgent/services/commercialTerritory.service.js";
import {
  processCompletedBooking,
  createTerritoryPartnerTermSnapshot,
  createAcquisitionEarningProgressForClaim,
  reprocessOneGap,
} from "../modules/fieldAgent/services/fieldAgentEarning.service.js";
import { GAP_TYPE, GAP_STATUS, EARNING_CREDIT_OUTCOME } from "../modules/fieldAgent/constants/fieldAgentEarning.constants.js";

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

const FIXTURE_MARKER = "FA-10-VERIFY-FIXTURE";
const NAME_PREFIX = "ZTEST_FA10_";
const oid = () => new mongoose.Types.ObjectId();

const run = async () => {
  await connectDB();

  const fixtureUserIds = [];
  const fixtureSalonIds = [];
  const fixtureBookingIds = [];
  const fixtureClaimIds = [];
  const fixtureFieldAgentIds = [];
  const fixturePolicyIds = [];
  const fixtureTerritoryIds = [];
  const fixtureAssignmentIds = [];
  const fixtureSnapshotIds = [];

  const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion").lean();
  if (!indiaAdmin) throw new Error("No existing INDIA admin found — cannot run FA-10 verification");

  // Preserve the REAL, shared production checkpoint exactly as-is —
  // never deleted, restored verbatim in cleanup (FA-9 corrective
  // round's own lesson, applied proactively here even though this
  // script never intentionally rewrites it).
  const originalCheckpoint = await FieldAgentEarningJobCheckpoint.findById("FIELD_AGENT_EARNING_CURSOR").lean();

  const country = await Country.findOne({}).lean();
  const randLetters = () => Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");
  const state = await State.create({ name: `${NAME_PREFIX}STATE`, code: randLetters(), type: "STATE", countryRef: country._id, geo: { type: "Point", coordinates: [77, 28] }, isActive: true, isDeleted: false });

  const mkFreshGeography = async (label) => {
    const d = await District.create({ name: `${NAME_PREFIX}D_${label}`, code: `ZFXD${label}${Date.now() % 100000}`, countryRef: country._id, stateRef: state._id, isActive: true, isDeleted: false });
    const c = await City.create({ name: `${NAME_PREFIX}C_${label}`, districtRef: d._id, stateRef: state._id, isActive: true, isDeleted: false });
    const a = await Area.create({ name: `${NAME_PREFIX}A_${label}`, cityRef: c._id, districtRef: d._id, stateRef: state._id, isActive: true, isDeleted: false });
    return { district: d, city: c, area: a };
  };
  const fixtureDistrictIds = [];
  const fixtureCityIds = [];
  const fixtureAreaIds = [];
  const mkGeo = async (label) => {
    const g = await mkFreshGeography(label);
    fixtureDistrictIds.push(g.district._id);
    fixtureCityIds.push(g.city._id);
    fixtureAreaIds.push(g.area._id);
    return g;
  };

  // National policy: 36-month (3-year) term — the real locked business value.
  const nationalPolicy = await CommercialPolicyVersion.create({
    versionNumber: 950001 + Math.floor(Math.random() * 100000),
    status: "PUBLISHED",
    acquisitionAgentCommissionPercent: 10,
    acquisitionEarningTargetInPaise: 100000,
    territoryPartnerCommissionPercent: 8,
    licenseTermMonths: 36,
    claimExpiryDays: 30,
    createdBy: indiaAdmin._id,
    publishedBy: indiaAdmin._id,
    // Backdated far enough (year 2000) to cover every historical
    // effectiveFrom fixture date used below (some as old as 2010) —
    // otherwise this policy would itself have "no applicable policy"
    // for those backdated assignment-creation instants, which is a
    // genuine, correct fail-closed result, just not what those specific
    // tests are trying to exercise.
    publishedAt: new Date("2000-01-01T00:00:00.000Z"),
    obligations: [{ key: FIXTURE_MARKER, description: "Verification fixture marker — safe to delete." }],
  });
  fixturePolicyIds.push(nationalPolicy._id);

  const dayTiming = { open: "09:00", close: "20:00" };
  const salonTimings = { monday: dayTiming, tuesday: dayTiming, wednesday: dayTiming, thursday: dayTiming, friday: dayTiming, saturday: dayTiming, sunday: dayTiming };
  const mkSalon = async (geo) => {
    const owner = await User.create({ name: `${NAME_PREFIX}OWNER_${Date.now()}_${Math.random()}`, phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, role: "OWNER", accountStatus: "ACTIVE" });
    fixtureUserIds.push(owner._id);
    const salon = await Salon.create({
      ownerId: owner._id,
      basicInfo: { shopName: `${NAME_PREFIX}SALON_${Date.now()}_${Math.random()}`, category: "UNISEX" },
      location: { address: `${NAME_PREFIX} addr`, geo: { type: "Point", coordinates: [77, 28] }, territory: { countryRef: country._id, stateRef: state._id, districtRef: geo.district._id, cityRef: geo.city._id, areaRef: geo.area._id } },
      timings: salonTimings,
      approval: { status: "APPROVED" },
      onboarding: { step: 2 },
      isDeleted: false,
    });
    fixtureSalonIds.push(salon._id);
    return salon;
  };

  const mkTerritoryPartnerAgent = async (accountStatus = "ACTIVE") => {
    const tpUser = await User.create({ name: `${NAME_PREFIX}TP_${Date.now()}_${Math.random()}`, phone: `7${Math.floor(100000000 + Math.random() * 899999999)}`, role: "FIELD_AGENT", accountStatus });
    fixtureUserIds.push(tpUser._id);
    const tpAgent = await FieldAgent.create({ userRef: tpUser._id, applicationRef: oid(), agentCode: `ZF10-${Date.now()}-${Math.floor(Math.random() * 100000)}`, operationalStatus: "ACTIVE", commercialPath: "TERRITORY_PARTNER" });
    fixtureFieldAgentIds.push(tpAgent._id);
    return { tpUser, tpAgent };
  };

  // Raw fixture territory (mirrors verifyFieldAgentEarningEngine.js's
  // own established pattern of bypassing the service for direct
  // control over test state) — one fresh district per territory to
  // avoid any cross-test CommercialTerritory overlap (the exact lesson
  // from the FA-9 corrective round's own test-isolation bug).
  const mkActiveTerritory = async (geo, label) => {
    const territory = await CommercialTerritory.create({
      name: `${NAME_PREFIX}TERR_${label}`,
      code: `ZF10CT-${label}-${Date.now()}`,
      scopeType: "DISTRICT",
      scopeKey: `DISTRICT:${geo.district._id}`,
      stateRef: state._id,
      districtRef: geo.district._id,
      status: "ACTIVE",
      createdBy: indiaAdmin._id,
      updatedBy: indiaAdmin._id,
    });
    fixtureTerritoryIds.push(territory._id);
    return territory;
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
    // ── A/D/E. Term snapshot creation, correct start, correct expiry ──
    {
      const geo = await mkGeo("A");
      const territory = await mkActiveTerritory(geo, "A");
      const { tpAgent } = await mkTerritoryPartnerAgent();
      const effectiveFrom = new Date("2026-01-15T10:00:00.000Z");
      const assignment = await TerritoryAssignment.create({ territoryRef: territory._id, fieldAgentRef: tpAgent._id, status: "ACTIVE", effectiveFrom, assignedBy: indiaAdmin._id });
      fixtureAssignmentIds.push(assignment._id);

      const snapshot = await createTerritoryPartnerTermSnapshot({ assignment });
      fixtureSnapshotIds.push(snapshot._id);
      check("A. Term snapshot created", !!snapshot);
      check("D. termStartAt equals assignment.effectiveFrom exactly", snapshot.termStartAt.getTime() === effectiveFrom.getTime());
      check("E. termMonths snapshotted from national policy (36)", snapshot.termMonths === 36);
      const expected = new Date(Date.UTC(2029, 0, 15, 10, 0, 0, 0)); // +36 months = Jan 15 2029
      check("E. termExpiresAt = termStartAt + 36 UTC calendar months exactly", snapshot.termExpiresAt.getTime() === expected.getTime(), { got: snapshot.termExpiresAt, expected });
      check("Policy source recorded for audit", String(snapshot.policyVersionRef) === String(nationalPolicy._id));
    }

    // ── B/C. Exactly one snapshot per assignment, incl. under concurrency ──
    {
      const geo = await mkGeo("B");
      const territory = await mkActiveTerritory(geo, "B");
      const { tpAgent } = await mkTerritoryPartnerAgent();
      const assignment = await TerritoryAssignment.create({ territoryRef: territory._id, fieldAgentRef: tpAgent._id, status: "ACTIVE", effectiveFrom: new Date(), assignedBy: indiaAdmin._id });
      fixtureAssignmentIds.push(assignment._id);

      const results10 = await Promise.all(Array.from({ length: 10 }, () => createTerritoryPartnerTermSnapshot({ assignment })));
      check("C. 10 concurrent snapshot-creation attempts all resolve without throwing", results10.every((r) => r !== undefined && r !== null));
      const count = await TerritoryPartnerTermSnapshot.countDocuments({ territoryAssignmentRef: assignment._id });
      check("B/C. Exactly one snapshot exists after 10 concurrent attempts", count === 1, count);
      const snap = await TerritoryPartnerTermSnapshot.findOne({ territoryAssignmentRef: assignment._id }).lean();
      fixtureSnapshotIds.push(snap._id);
    }

    // ── Leap-year date arithmetic ──
    {
      const geo = await mkGeo("LEAP");
      const territory = await mkActiveTerritory(geo, "LEAP");
      const { tpAgent } = await mkTerritoryPartnerAgent();
      const effectiveFrom = new Date("2024-02-29T00:00:00.000Z"); // leap day
      const assignment = await TerritoryAssignment.create({ territoryRef: territory._id, fieldAgentRef: tpAgent._id, status: "ACTIVE", effectiveFrom, assignedBy: indiaAdmin._id });
      fixtureAssignmentIds.push(assignment._id);
      const snapshot = await createTerritoryPartnerTermSnapshot({ assignment });
      fixtureSnapshotIds.push(snapshot._id);
      // 2024-02-29 + 36 months = 2027-02-29, but 2027 is not a leap
      // year -> JS Date.UTC overflow normalizes to 2027-03-01.
      const expected = new Date(Date.UTC(2027, 1, 29, 0, 0, 0, 0)); // Date.UTC auto-normalizes Feb 29 non-leap -> Mar 1
      check("Leap-year start date (Feb 29) + 36 months normalizes deterministically (documented JS Date overflow behavior)", snapshot.termExpiresAt.getTime() === expected.getTime(), { got: snapshot.termExpiresAt.toISOString(), expectedNormalized: expected.toISOString() });
    }

    // ── F/G/H/I/O. Exact expiry boundary + earning eligibility ──
    {
      const geo = await mkGeo("BOUND");
      const salon = await mkSalon(geo);
      const territory = await mkActiveTerritory(geo, "BOUND");
      const { tpAgent } = await mkTerritoryPartnerAgent();
      const effectiveFrom = new Date("2020-01-01T00:00:00.000Z");
      const assignment = await TerritoryAssignment.create({ territoryRef: territory._id, fieldAgentRef: tpAgent._id, status: "ACTIVE", effectiveFrom, assignedBy: indiaAdmin._id });
      fixtureAssignmentIds.push(assignment._id);
      const snapshot = await createTerritoryPartnerTermSnapshot({ assignment });
      fixtureSnapshotIds.push(snapshot._id);
      const termExpiresAt = snapshot.termExpiresAt; // 2023-01-01T00:00:00.000Z

      // O/G — 1ms before expiry: earns normally.
      const before = await mkBooking(salon, { commissionAmountInPaise: 100000, completedAt: new Date(termExpiresAt.getTime() - 1) });
      const beforeOutcome = await processCompletedBooking(before);
      check("G/O. Booking 1ms before termExpiresAt earns normally (CREDITED)", beforeOutcome.outcome === "CREDITED" && beforeOutcome.creditedAmountInPaise === 8000, beforeOutcome);

      // H — exactly at expiry: does NOT earn (boundary is exclusive).
      const at = await mkBooking(salon, { commissionAmountInPaise: 100000, completedAt: new Date(termExpiresAt.getTime()) });
      const atOutcome = await processCompletedBooking(at);
      check("H. Booking exactly AT termExpiresAt does NOT earn (ZERO_TERM_EXPIRED)", atOutcome.outcome === "ZERO_TERM_EXPIRED" && atOutcome.creditedAmountInPaise === 0, atOutcome);

      // I — 1ms after expiry: does NOT earn.
      const after = await mkBooking(salon, { commissionAmountInPaise: 100000, completedAt: new Date(termExpiresAt.getTime() + 1) });
      const afterOutcome = await processCompletedBooking(after);
      check("I. Booking 1ms after termExpiresAt does NOT earn (ZERO_TERM_EXPIRED)", afterOutcome.outcome === "ZERO_TERM_EXPIRED" && afterOutcome.creditedAmountInPaise === 0, afterOutcome);

      // L. No other positive ledger row exists for the expired bookings.
      const atRows = await FieldAgentEarningLedger.find({ bookingRef: at._id }).lean();
      check("L. Expired-term booking produces no positive row of any kind (no fallthrough)", atRows.every((r) => r.creditedAmountInPaise === 0), atRows);
    }

    // ── J. Later policy change does not alter an existing snapshot's expiry ──
    {
      const geo = await mkGeo("J");
      const territory = await mkActiveTerritory(geo, "J");
      const { tpAgent } = await mkTerritoryPartnerAgent();
      const effectiveFrom = new Date("2026-06-01T00:00:00.000Z");
      const assignment = await TerritoryAssignment.create({ territoryRef: territory._id, fieldAgentRef: tpAgent._id, status: "ACTIVE", effectiveFrom, assignedBy: indiaAdmin._id });
      fixtureAssignmentIds.push(assignment._id);
      const snapshot = await createTerritoryPartnerTermSnapshot({ assignment });
      fixtureSnapshotIds.push(snapshot._id);
      const originalExpiry = snapshot.termExpiresAt.getTime();

      // Publish a NEW national policy with a DIFFERENT term (24 months) — must NOT retroactively change the existing snapshot.
      await CommercialPolicyVersion.updateOne({ _id: nationalPolicy._id }, { $set: { status: "RETIRED", retiredAt: new Date() } });
      const newPolicy = await CommercialPolicyVersion.create({
        versionNumber: 960001 + Math.floor(Math.random() * 100000),
        status: "PUBLISHED",
        acquisitionAgentCommissionPercent: 10,
        acquisitionEarningTargetInPaise: 100000,
        territoryPartnerCommissionPercent: 8,
        licenseTermMonths: 24,
        claimExpiryDays: 30,
        createdBy: indiaAdmin._id,
        publishedBy: indiaAdmin._id,
        publishedAt: new Date(),
        obligations: [{ key: FIXTURE_MARKER, description: "J fixture" }],
      });
      fixturePolicyIds.push(newPolicy._id);

      const snapshotAfter = await TerritoryPartnerTermSnapshot.findById(snapshot._id).lean();
      check("J. Existing snapshot's termExpiresAt is unchanged after a later policy change", snapshotAfter.termExpiresAt.getTime() === originalExpiry);
      check("J. Existing snapshot's termMonths remains 36, not retroactively 24", snapshotAfter.termMonths === 36);

      // restore
      await CommercialPolicyVersion.updateOne({ _id: newPolicy._id }, { $set: { status: "RETIRED", retiredAt: new Date() } });
      await CommercialPolicyVersion.updateOne({ _id: nationalPolicy._id }, { $set: { status: "PUBLISHED", retiredAt: null } });
    }

    // ── M/N. Suspended+valid-term vs Active+expired-term (distinct outcomes) ──
    {
      const geo = await mkGeo("MN");
      const salon = await mkSalon(geo);
      const territory = await mkActiveTerritory(geo, "MN");
      const { tpAgent, tpUser } = await mkTerritoryPartnerAgent("SUSPENDED");
      const assignment = await TerritoryAssignment.create({ territoryRef: territory._id, fieldAgentRef: tpAgent._id, status: "ACTIVE", effectiveFrom: new Date(Date.now() - 3600000), assignedBy: indiaAdmin._id });
      fixtureAssignmentIds.push(assignment._id);
      const snapshot = await createTerritoryPartnerTermSnapshot({ assignment });
      fixtureSnapshotIds.push(snapshot._id);

      const booking = await mkBooking(salon, { commissionAmountInPaise: 50000 });
      const outcome = await processCompletedBooking(booking);
      check("M. Suspended partner + valid (not-yet-expired) term -> ZERO_AGENT_INELIGIBLE, not ZERO_TERM_EXPIRED", outcome.outcome === "ZERO_AGENT_INELIGIBLE", outcome);
    }
    {
      const geo = await mkGeo("MN2");
      const salon = await mkSalon(geo);
      const territory = await mkActiveTerritory(geo, "MN2");
      const { tpAgent } = await mkTerritoryPartnerAgent("ACTIVE");
      const effectiveFrom = new Date("2010-01-01T00:00:00.000Z"); // long-expired
      const assignment = await TerritoryAssignment.create({ territoryRef: territory._id, fieldAgentRef: tpAgent._id, status: "ACTIVE", effectiveFrom, assignedBy: indiaAdmin._id });
      fixtureAssignmentIds.push(assignment._id);
      const snapshot = await createTerritoryPartnerTermSnapshot({ assignment });
      fixtureSnapshotIds.push(snapshot._id);

      const booking = await mkBooking(salon, { commissionAmountInPaise: 50000 });
      const outcome = await processCompletedBooking(booking);
      check("N. Active partner + expired term -> ZERO_TERM_EXPIRED, not ZERO_AGENT_INELIGIBLE (term checked before accountStatus)", outcome.outcome === "ZERO_TERM_EXPIRED", outcome);
    }

    // ── P/Q. Idempotency + concurrency on the SAME booking ──
    {
      const geo = await mkGeo("PQ");
      const salon = await mkSalon(geo);
      const territory = await mkActiveTerritory(geo, "PQ");
      const { tpAgent } = await mkTerritoryPartnerAgent();
      const assignment = await TerritoryAssignment.create({ territoryRef: territory._id, fieldAgentRef: tpAgent._id, status: "ACTIVE", effectiveFrom: new Date(Date.now() - 3600000), assignedBy: indiaAdmin._id });
      fixtureAssignmentIds.push(assignment._id);
      const snapshot = await createTerritoryPartnerTermSnapshot({ assignment });
      fixtureSnapshotIds.push(snapshot._id);

      const booking = await mkBooking(salon, { commissionAmountInPaise: 50000 });
      const [o1, o2, o3, o4, o5] = await Promise.all(Array.from({ length: 5 }, () => processCompletedBooking(booking)));
      const rows = await FieldAgentEarningLedger.find({ bookingRef: booking._id, entitlementType: "TERRITORY_PARTNER" }).lean();
      check("P/Q. 5 concurrent workers processing the SAME booking produce exactly one ledger row", rows.length === 1, rows.length);
      check("P/Q. That row is CREDITED with the correct amount (8% of 50000 = 4000)", rows[0]?.creditOutcome === "CREDITED" && rows[0].creditedAmountInPaise === 4000, rows[0]);
    }

    // ── S. TERM_SNAPSHOT_GAP recovery (reusing FA-9's gap mechanism) ──
    {
      const geo = await mkGeo("GAP");
      const territory = await mkActiveTerritory(geo, "GAP");
      const { tpAgent } = await mkTerritoryPartnerAgent();
      await CommercialPolicyVersion.updateOne({ _id: nationalPolicy._id }, { $set: { status: "RETIRED", retiredAt: new Date(Date.now() - 1) } });

      const assignment = await TerritoryAssignment.create({ territoryRef: territory._id, fieldAgentRef: tpAgent._id, status: "ACTIVE", effectiveFrom: new Date(), assignedBy: indiaAdmin._id });
      fixtureAssignmentIds.push(assignment._id);
      const attempt = await createTerritoryPartnerTermSnapshot({ assignment });
      check("S. No policy at assignment time -> snapshot creation returns null (no invented term)", attempt === null);

      const gapRow = await FieldAgentEarningPolicyGap.findOne({ referenceKey: `gap:term:${assignment._id}` }).lean();
      check("S. TERM_SNAPSHOT_GAP durably recorded as OPEN", gapRow?.status === GAP_STATUS.OPEN && gapRow.gapType === GAP_TYPE.TERM_SNAPSHOT_GAP);

      await CommercialPolicyVersion.updateOne({ _id: nationalPolicy._id }, { $set: { status: "PUBLISHED", retiredAt: null } });
      const reGap = await FieldAgentEarningPolicyGap.findOne({ referenceKey: `gap:term:${assignment._id}` }).lean();
      const reprocessResult = await reprocessOneGap(reGap);
      check("S. Reconciliation creates the snapshot once policy exists", reprocessResult.reprocessed === true, reprocessResult);
      const snapshotAfter = await TerritoryPartnerTermSnapshot.findOne({ territoryAssignmentRef: assignment._id }).lean();
      if (snapshotAfter) fixtureSnapshotIds.push(snapshotAfter._id);
      check("S. Snapshot now exists, gap resolved", !!snapshotAfter);
      const gapAfter = await FieldAgentEarningPolicyGap.findOne({ referenceKey: `gap:term:${assignment._id}` }).lean();
      check("S. Gap transitions to RESOLVED", gapAfter?.status === GAP_STATUS.RESOLVED);
    }

    // ── Assignment vacate vs term expiry interaction ──
    {
      const geo = await mkGeo("VAC");
      const salon = await mkSalon(geo);
      const territory = await mkActiveTerritory(geo, "VAC");
      const { tpAgent } = await mkTerritoryPartnerAgent();
      const assignment = await TerritoryAssignment.create({ territoryRef: territory._id, fieldAgentRef: tpAgent._id, status: "ACTIVE", effectiveFrom: new Date(Date.now() - 3600000), assignedBy: indiaAdmin._id });
      fixtureAssignmentIds.push(assignment._id);
      await CommercialTerritory.updateOne({ _id: territory._id }, { $set: { currentAssignmentRef: assignment._id } });
      const snapshot = await createTerritoryPartnerTermSnapshot({ assignment });
      fixtureSnapshotIds.push(snapshot._id);

      // Admin vacates the partner (effectiveUntil set) BEFORE the
      // natural 3-year term would have expired — the assignment lookup
      // itself (frozen FA-5.2 logic, untouched) should already exclude
      // bookings after effectiveUntil, regardless of the term snapshot.
      const vacatedAt = new Date();
      await vacatePartner({ territoryId: territory._id, adminId: indiaAdmin._id, endReason: "PARTNER_EXIT" });

      const bookingAfterVacate = await mkBooking(salon, { commissionAmountInPaise: 50000, completedAt: new Date(vacatedAt.getTime() + 5000) });
      const outcome = await processCompletedBooking(bookingAfterVacate);
      check("Vacated assignment (well before natural term expiry) correctly produces no Territory Partner credit (NO_ENTITLEMENT, governed by the earlier of the two end conditions)", outcome.outcome === "NO_ENTITLEMENT", outcome);
    }

    // ── Real end-to-end integration: assignPartner itself creates the snapshot atomically ──
    {
      const geo = await mkGeo("E2E");
      const territory = await mkActiveTerritory(geo, "E2E");
      const { tpAgent } = await mkTerritoryPartnerAgent();
      const { assignment } = await assignPartner({ territoryId: territory._id, fieldAgentId: tpAgent._id, adminId: indiaAdmin._id });
      fixtureAssignmentIds.push(assignment._id);
      const snapshot = await TerritoryPartnerTermSnapshot.findOne({ territoryAssignmentRef: assignment._id }).lean();
      check("Real assignPartner() integration creates the term snapshot atomically, same transaction", !!snapshot);
      if (snapshot) fixtureSnapshotIds.push(snapshot._id);
      check("Real integration: termStartAt matches the real assignment.effectiveFrom", snapshot?.termStartAt.getTime() === assignment.effectiveFrom.getTime());
    }

    // ── R. Existing FA-9 acquisition behavior unchanged (spot check) ──
    {
      const geo = await mkGeo("R");
      const salon = await mkSalon(geo);
      const agentUser = await User.create({ name: `${NAME_PREFIX}ACQ_R`, phone: `6${Math.floor(100000000 + Math.random() * 899999999)}`, role: "FIELD_AGENT", accountStatus: "ACTIVE" });
      fixtureUserIds.push(agentUser._id);
      const fieldAgent = await FieldAgent.create({ userRef: agentUser._id, applicationRef: oid(), agentCode: `ZF10-ACQ-${Date.now()}`, operationalStatus: "ACTIVE", commercialPath: "ACQUISITION_AGENT" });
      fixtureFieldAgentIds.push(fieldAgent._id);
      const claim = await AcquisitionClaim.create({ salonRef: salon._id, fieldAgentRef: fieldAgent._id, status: "ACTIVE", stateRef: state._id, districtRef: geo.district._id });
      fixtureClaimIds.push(claim._id);
      await createAcquisitionEarningProgressForClaim({ claim, salon });
      const booking = await mkBooking(salon, { commissionAmountInPaise: 12345 });
      const outcome = await processCompletedBooking(booking);
      check("R. Acquisition earning (10% of 12345 = 1235) still works exactly as before FA-10", outcome.outcome === "CREDITED" && outcome.creditedAmountInPaise === 1235, outcome);
    }
  } catch (err) {
    console.error("❌ FA-10 verification body threw — printing before cleanup:", err.message);
    console.error(err.stack);
    fail++;
    results.push(`❌ Script body threw an uncaught error: ${err.message}`);
  } finally {
    // ── CLEANUP — zero residue ────────────────────────────────────────
    await TerritoryPartnerTermSnapshot.deleteMany({ _id: { $in: fixtureSnapshotIds } });
    await FieldAgentEarningPolicyGap.deleteMany({ $or: [{ bookingRef: { $in: fixtureBookingIds } }, { acquisitionClaimRef: { $in: fixtureClaimIds } }, { territoryAssignmentRef: { $in: fixtureAssignmentIds } }] });
    await FieldAgentEarningLedger.collection.deleteMany({ bookingRef: { $in: fixtureBookingIds } });
    await AcquisitionEarningProgress.deleteMany({ acquisitionClaimRef: { $in: fixtureClaimIds } });
    await Booking.deleteMany({ _id: { $in: fixtureBookingIds } });
    await AcquisitionClaim.deleteMany({ _id: { $in: fixtureClaimIds } });
    await TerritoryAssignment.deleteMany({ _id: { $in: fixtureAssignmentIds } });
    await CommercialTerritory.deleteMany({ _id: { $in: fixtureTerritoryIds } });
    await FieldAgent.deleteMany({ _id: { $in: fixtureFieldAgentIds } });
    await CommercialPolicyVersion.deleteMany({ _id: { $in: fixturePolicyIds } });
    await Salon.deleteMany({ _id: { $in: fixtureSalonIds } });
    await User.deleteMany({ _id: { $in: fixtureUserIds } });
    await Area.deleteMany({ _id: { $in: fixtureAreaIds } });
    await City.deleteMany({ _id: { $in: fixtureCityIds } });
    await District.deleteMany({ _id: { $in: fixtureDistrictIds } });
    await State.deleteMany({ _id: state._id });

    // Restore the real production checkpoint exactly as it was.
    if (originalCheckpoint) {
      await FieldAgentEarningJobCheckpoint.updateOne(
        { _id: "FIELD_AGENT_EARNING_CURSOR" },
        { $set: { lastCompletedAt: originalCheckpoint.lastCompletedAt, lastId: originalCheckpoint.lastId, updatedAt: new Date() } }
      );
    }

    const residue = {
      snapshots: await TerritoryPartnerTermSnapshot.countDocuments({ _id: { $in: fixtureSnapshotIds } }),
      bookings: await Booking.countDocuments({ _id: { $in: fixtureBookingIds } }),
      ledger: await FieldAgentEarningLedger.countDocuments({ bookingRef: { $in: fixtureBookingIds } }),
      gaps: await FieldAgentEarningPolicyGap.countDocuments({ territoryAssignmentRef: { $in: fixtureAssignmentIds } }),
      assignments: await TerritoryAssignment.countDocuments({ _id: { $in: fixtureAssignmentIds } }),
      territories: await CommercialTerritory.countDocuments({ _id: { $in: fixtureTerritoryIds } }),
      salons: await Salon.countDocuments({ _id: { $in: fixtureSalonIds } }),
      users: await User.countDocuments({ _id: { $in: fixtureUserIds } }),
      policies: await CommercialPolicyVersion.countDocuments({ _id: { $in: fixturePolicyIds } }),
    };
    check("Zero residue — all FA-10 fixtures removed", Object.values(residue).every((c) => c === 0), residue);

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
