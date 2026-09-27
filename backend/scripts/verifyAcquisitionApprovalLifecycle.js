/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyAcquisitionApprovalLifecycle.js
 *
 * FA-P3-B Step 1 — LIVE, real-HTTP, real-DB verification for the new
 * PENDING_APPROVAL -> ACTIVE_RECOVERY -> COMPLETED lifecycle. Same
 * precedent as every other verify* script in this repo: real Express
 * app via app.listen(0), real signed JWTs, real MongoDB (no mocks),
 * disposable fixtures under one marker, explicit cleanup.
 *
 * Scoped ONLY to what Step 1 actually changed:
 *  - claims now start PENDING_APPROVAL, not ACTIVE
 *  - POST /admin/acquisition-claims/:id/approve (INDIA-only) is the
 *    only path into ACTIVE_RECOVERY, atomically creating
 *    AcquisitionEarningProgress in the same transaction
 *  - processCompletedBooking only credits acquisition against
 *    ACTIVE_RECOVERY, never PENDING_APPROVAL
 *  - reject/reassign now accept either non-terminal status
 *  - the partial unique index widened to {PENDING_APPROVAL,ACTIVE_RECOVERY}
 *  - adminListClaims/adminGetClaimDetail now populate salon/agent names
 *
 * Does NOT re-run the full pre-existing FA-5.3 referral/redemption
 * regression (verifyAcquisitionClaim.js) — that script's own
 * "ACTIVE"-literal assertions are now stale after this status rename
 * and are flagged separately in the implementation report, not fixed
 * here (out of Step 1's scope).
 *
 * Run:
 *   cd backend
 *   node scripts/verifyAcquisitionApprovalLifecycle.js
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
import CommercialPolicyVersion from "../modules/fieldAgent/models/CommercialPolicyVersion.js";
import { CLAIM_STATUS } from "../modules/fieldAgent/constants/acquisitionClaim.constants.js";
import { EARNING_ENTITLEMENT_TYPE } from "../modules/fieldAgent/constants/fieldAgentEarning.constants.js";
import { processCompletedBooking, PROCESSING_OUTCOME } from "../modules/fieldAgent/services/fieldAgentEarning.service.js";

let pass = 0;
let fail = 0;
const results = [];
const check = (name, condition, detail) => {
  if (condition) {
    pass += 1;
    results.push(`✅ ${name}`);
  } else {
    fail += 1;
    results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 300) : ""}`);
  }
};

const NAME_PREFIX = "ZTEST_FAP3B1_";
const FIXTURE_MARKER = "FA-P3B-STEP1-VERIFY-FIXTURE";
const oid = () => new mongoose.Types.ObjectId();
const randLetters = () => Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");

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
  const post = (p, token) => authFetch(p, token, { method: "POST" });
  const get = (p, token) => authFetch(p, token, { method: "GET" });

  const fixtureUserIds = [];
  const fixtureSalonIds = [];
  const fixtureFieldAgentIds = [];
  const fixtureClaimIds = [];
  const fixtureBookingIds = [];
  const fixturePolicyIds = [];

  try {
    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion").lean();
    check("SETUP: real INDIA admin fixture exists (pre-existing)", !!indiaAdmin);
    const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

    const stateAdmin = await User.findOne({ role: "ADMIN", adminLevel: "STATE" }).select("+tokenVersion").lean();
    check("SETUP: real STATE admin fixture exists (pre-existing, for RBAC test)", !!stateAdmin);
    const stateToken = stateAdmin
      ? generateAccessToken({ _id: stateAdmin._id, role: "ADMIN", adminLevel: "STATE", tokenVersion: stateAdmin.tokenVersion ?? 0 })
      : null;

    const country = await Country.findOne({}).lean();
    const state = await State.create({ name: `${NAME_PREFIX}STATE`, code: randLetters(), type: "STATE", countryRef: country._id, geo: { type: "Point", coordinates: [77, 28] }, isActive: true, isDeleted: false });
    const district = await District.create({ name: `${NAME_PREFIX}DISTRICT`, code: `ZP3B${Date.now() % 100000}`, countryRef: country._id, stateRef: state._id, isActive: true, isDeleted: false });
    const city = await City.create({ name: `${NAME_PREFIX}CITY`, districtRef: district._id, stateRef: state._id, isActive: true, isDeleted: false });
    const areaFixture = await Area.create({ name: `${NAME_PREFIX}AREA`, cityRef: city._id, districtRef: district._id, stateRef: state._id, isActive: true, isDeleted: false });

    const nationalPolicy = await CommercialPolicyVersion.create({
      versionNumber: 990001 + Math.floor(Math.random() * 100000),
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

    const mkSalon = async (suffix) => {
      const owner = await User.create({ name: `${NAME_PREFIX}OWNER_${suffix}`, phone: `8${Math.floor(100000000 + Math.random() * 899999999)}`, role: "OWNER", accountStatus: "ACTIVE" });
      fixtureUserIds.push(owner._id);
      const salon = await Salon.create({
        ownerId: owner._id,
        basicInfo: { shopName: `${NAME_PREFIX}SALON_${suffix}`, category: "UNISEX" },
        location: { address: `${NAME_PREFIX} addr ${suffix}`, geo: { type: "Point", coordinates: [77, 28] }, territory: { countryRef: country._id, stateRef: state._id, districtRef: district._id, cityRef: city._id, areaRef: areaFixture._id } },
        timings: salonTimings,
        approval: { status: "APPROVED" },
        onboarding: { step: 2 },
        isDeleted: false,
      });
      fixtureSalonIds.push(salon._id);
      return salon;
    };

    const mkFieldAgent = async (suffix) => {
      const agentUser = await User.create({ name: `${NAME_PREFIX}AGENT_${suffix}`, phone: `7${Math.floor(100000000 + Math.random() * 899999999)}`, role: "FIELD_AGENT", accountStatus: "ACTIVE" });
      fixtureUserIds.push(agentUser._id);
      const fieldAgent = await FieldAgent.create({
        userRef: agentUser._id,
        applicationRef: oid(),
        agentCode: `ZP3B-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        operationalStatus: "ACTIVE",
        commercialPath: "ACQUISITION_AGENT",
      });
      fixtureFieldAgentIds.push(fieldAgent._id);
      return { agentUser, fieldAgent };
    };

    // Directly creates the claim the way redeemReferral does post-Step-1
    // (PENDING_APPROVAL, no progress record yet) — bypasses the referral
    // issuance/redemption HTTP surface, which is unchanged FA-5.3
    // machinery already covered by verifyAcquisitionClaim.js.
    const mkPendingClaim = async (salon, fieldAgent) => {
      const claim = await AcquisitionClaim.create({
        salonRef: salon._id,
        fieldAgentRef: fieldAgent._id,
        status: CLAIM_STATUS.PENDING_APPROVAL,
        stateRef: state._id,
        districtRef: district._id,
      });
      fixtureClaimIds.push(claim._id);
      return claim;
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

    // ── 1. CLAIM STARTS PENDING_APPROVAL ──────────────────────────────
    let salon1, agent1, claim1;
    {
      salon1 = await mkSalon("1");
      const { fieldAgent } = await mkFieldAgent("1");
      agent1 = fieldAgent;
      claim1 = await mkPendingClaim(salon1, agent1);
      check("1. New claim starts PENDING_APPROVAL", claim1.status === CLAIM_STATUS.PENDING_APPROVAL, claim1.status);

      const progress = await AcquisitionEarningProgress.findOne({ acquisitionClaimRef: claim1._id }).lean();
      check("1. No AcquisitionEarningProgress exists yet for a PENDING_APPROVAL claim", !progress);
    }

    // ── 2. NO RECOVERY BEFORE APPROVAL ────────────────────────────────
    {
      const booking = await mkBooking(salon1);
      const outcome = await processCompletedBooking(booking);
      check("2. processCompletedBooking against a PENDING_APPROVAL claim credits nothing", outcome.outcome !== PROCESSING_OUTCOME.CREDITED, outcome);
      const ledgerRow = await FieldAgentEarningLedger.findOne({ bookingRef: booking._id, entitlementType: EARNING_ENTITLEMENT_TYPE.ACQUISITION }).lean();
      check("2. No FieldAgentEarningLedger row was created for this booking", !ledgerRow);
    }

    // ── 3. PARTIAL UNIQUE INDEX WIDENED ($in PENDING_APPROVAL+ACTIVE_RECOVERY) ──
    {
      let dupErrCode = null;
      try {
        await AcquisitionClaim.create({ salonRef: salon1._id, fieldAgentRef: agent1._id, status: CLAIM_STATUS.PENDING_APPROVAL, stateRef: state._id, districtRef: district._id });
      } catch (err) {
        dupErrCode = err?.code;
      }
      check("3. A second non-terminal claim on the same salon is rejected by the partial unique index (E11000)", dupErrCode === 11000, dupErrCode);
    }

    // ── 4. RBAC — approve is INDIA-only ───────────────────────────────
    if (stateToken) {
      const rState = await post(`/api/admin/acquisition-claims/${claim1._id}/approve`, stateToken);
      check("4. STATE admin cannot approve (403)", rState.status === 403, rState.status);
      const stillPending = await AcquisitionClaim.findById(claim1._id).lean();
      check("4. Claim status unchanged after rejected STATE approve attempt", stillPending.status === CLAIM_STATUS.PENDING_APPROVAL, stillPending.status);
    }

    // ── 5. APPROVE TRANSITIONS PENDING_APPROVAL -> ACTIVE_RECOVERY ────
    {
      const rApprove = await post(`/api/admin/acquisition-claims/${claim1._id}/approve`, indiaToken);
      check("5. INDIA admin approve succeeds (200)", rApprove.status === 200, rApprove.status);
      check("5. Response claim.status is ACTIVE_RECOVERY", rApprove.data?.data?.claim?.status === CLAIM_STATUS.ACTIVE_RECOVERY, rApprove.data?.data?.claim?.status);

      const claimAfter = await AcquisitionClaim.findById(claim1._id).lean();
      check("5. Persisted claim.status is ACTIVE_RECOVERY", claimAfter.status === CLAIM_STATUS.ACTIVE_RECOVERY, claimAfter.status);

      const progress = await AcquisitionEarningProgress.findOne({ acquisitionClaimRef: claim1._id }).lean();
      check("5. AcquisitionEarningProgress was created atomically on approve", !!progress);
      check("5. Progress targetInPaise matches the policy applicable at claim.createdAt", progress?.targetInPaise === 100000, progress?.targetInPaise);
      check("5. Progress status is IN_PROGRESS", progress?.status === "IN_PROGRESS", progress?.status);
    }

    // ── 6. RE-APPROVING AN ALREADY-APPROVED CLAIM FAILS (idempotency) ─
    {
      const rReapprove = await post(`/api/admin/acquisition-claims/${claim1._id}/approve`, indiaToken);
      check("6. Re-approving an ACTIVE_RECOVERY claim is rejected (409/404, not 200)", rReapprove.status !== 200, rReapprove.status);
    }

    // ── 7. APPROVING A NON-EXISTENT CLAIM RETURNS 404 ─────────────────
    {
      const rMissing = await post(`/api/admin/acquisition-claims/${oid()}/approve`, indiaToken);
      check("7. Approving a non-existent claim returns 404", rMissing.status === 404, rMissing.status);
    }

    // ── 8. RECOVERY NOW ACTIVE — booking credits acquisition ──────────
    {
      const booking2 = await mkBooking(salon1, { commissionAmountInPaise: 20000 });
      const outcome = await processCompletedBooking(booking2);
      check("8. processCompletedBooking against an ACTIVE_RECOVERY claim credits acquisition", outcome.outcome === PROCESSING_OUTCOME.CREDITED, outcome);
      const ledgerRow = await FieldAgentEarningLedger.findOne({ bookingRef: booking2._id, entitlementType: EARNING_ENTITLEMENT_TYPE.ACQUISITION }).lean();
      check("8. FieldAgentEarningLedger row created for the ACQUISITION credit", !!ledgerRow, ledgerRow);
      check("8. Ledger row references the approved claim", ledgerRow && String(ledgerRow.acquisitionClaimRef) === String(claim1._id));
    }

    // ── 9. REJECT FROM PENDING_APPROVAL (existing rejection architecture) ──
    let salon2, agent2, claim2;
    {
      salon2 = await mkSalon("2");
      const { fieldAgent } = await mkFieldAgent("2");
      agent2 = fieldAgent;
      claim2 = await mkPendingClaim(salon2, agent2);

      const rReject = await post(`/api/admin/acquisition-claims/${claim2._id}/reject`, indiaToken);
      check("9. Reject from PENDING_APPROVAL succeeds (200)", rReject.status === 200, rReject.status);
      const rejected = await AcquisitionClaim.findById(claim2._id).lean();
      check("9. Rejected claim: ENDED/ADMIN_REJECTED", rejected.status === "ENDED" && rejected.endedReason === "ADMIN_REJECTED", rejected.status);
    }

    // ── 10. REJECT FROM ACTIVE_RECOVERY (widened precondition) ────────
    {
      const salon3 = await mkSalon("3");
      const { fieldAgent: agent3 } = await mkFieldAgent("3");
      const claim3 = await mkPendingClaim(salon3, agent3);
      await post(`/api/admin/acquisition-claims/${claim3._id}/approve`, indiaToken);
      const activeCheck = await AcquisitionClaim.findById(claim3._id).lean();
      check("10. Setup: claim3 is ACTIVE_RECOVERY before reject test", activeCheck.status === CLAIM_STATUS.ACTIVE_RECOVERY, activeCheck.status);

      const rReject = await post(`/api/admin/acquisition-claims/${claim3._id}/reject`, indiaToken);
      check("10. Reject from ACTIVE_RECOVERY still succeeds (200)", rReject.status === 200, rReject.status);
      const rejected = await AcquisitionClaim.findById(claim3._id).lean();
      check("10. Rejected: ENDED/ADMIN_REJECTED even though it started from ACTIVE_RECOVERY", rejected.status === "ENDED" && rejected.endedReason === "ADMIN_REJECTED");
    }

    // ── 11. ADMIN LIST/DETAIL POPULATION (new enrichment) ─────────────
    {
      const salon4 = await mkSalon("4");
      const { agentUser, fieldAgent: agent4 } = await mkFieldAgent("4");
      const claim4 = await mkPendingClaim(salon4, agent4);

      const rList = await get(`/api/admin/acquisition-claims?status=PENDING_APPROVAL&limit=50`, indiaToken);
      check("11. Admin list endpoint returns 200", rList.status === 200, rList.status);
      const found = (rList.data?.data?.claims || []).find((c) => String(c._id) === String(claim4._id));
      check("11. List result includes the fixture claim", !!found);
      check("11. List result's salonRef is populated with basicInfo.shopName", found?.salonRef?.basicInfo?.shopName === salon4.basicInfo.shopName, found?.salonRef);
      check("11. List result's fieldAgentRef is populated with agentCode", found?.fieldAgentRef?.agentCode === agent4.agentCode, found?.fieldAgentRef);
      check("11. List result's fieldAgentRef.userRef is populated with name", found?.fieldAgentRef?.userRef?.name === agentUser.name, found?.fieldAgentRef?.userRef);

      const rDetail = await get(`/api/admin/acquisition-claims/${claim4._id}`, indiaToken);
      check("11. Detail endpoint returns 200", rDetail.status === 200, rDetail.status);
      check("11. Detail result's salonRef is populated", rDetail.data?.data?.claim?.salonRef?.basicInfo?.shopName === salon4.basicInfo.shopName);
      check("11. Detail result's fieldAgentRef.userRef.name is populated", rDetail.data?.data?.claim?.fieldAgentRef?.userRef?.name === agentUser.name);
    }
  } catch (err) {
    console.error(err);
    fail += 1;
    results.push(`❌ UNCAUGHT ERROR — ${err.message}`);
  } finally {
    // ── CLEANUP — hard delete every fixture, exact tracked _id only ──
    // FieldAgentEarningLedger blocks deleteMany/updateMany/etc. at the
    // schema level (immutable, append-only) — same precedent as
    // verifyFieldAgentEarningEngine.js's own cleanup: bypass Mongoose's
    // query middleware via the raw driver collection for disposable
    // fixture teardown only.
    await FieldAgentEarningLedger.collection.deleteMany({ bookingRef: { $in: fixtureBookingIds } });
    await Booking.deleteMany({ _id: { $in: fixtureBookingIds } });
    await AcquisitionEarningProgress.deleteMany({ acquisitionClaimRef: { $in: fixtureClaimIds } });
    await AcquisitionClaim.deleteMany({ _id: { $in: fixtureClaimIds } });
    await FieldAgent.deleteMany({ _id: { $in: fixtureFieldAgentIds } });
    await CommercialPolicyVersion.deleteMany({ _id: { $in: fixturePolicyIds } });
    await Salon.deleteMany({ _id: { $in: fixtureSalonIds } });
    await User.deleteMany({ _id: { $in: fixtureUserIds } });
    await Area.deleteMany({ name: `${NAME_PREFIX}AREA` });
    await City.deleteMany({ name: `${NAME_PREFIX}CITY` });
    await District.deleteMany({ name: `${NAME_PREFIX}DISTRICT` });
    await State.deleteMany({ name: `${NAME_PREFIX}STATE` });

    console.log("\n" + results.join("\n"));
    console.log(`\n${pass} PASS, ${fail} FAIL`);

    server.close();
    await mongoose.disconnect();
    process.exit(fail > 0 ? 1 : 0);
  }
};

run();
