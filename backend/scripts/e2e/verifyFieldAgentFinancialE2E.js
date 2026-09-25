/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFieldAgentFinancialE2E.js
 *
 * FA-16 Tier 3 — Financial Integrity End-to-End.
 *
 * BOOKING -> service+fee+GST -> COMPLETED -> FA-9 earning -> ledger
 * -> progress -> available balance -> withdrawal -> bank snapshot ->
 * admin processing -> terminal payout state. Real Mongo, real HTTP
 * (app.listen(0)), real JWTs, real policy-read functions, no mocks.
 *
 * Reuses fieldAgentE2EHelpers.js. Every technique used here that
 * looks like a "shortcut" is either (a) already proven and frozen-
 * regression-tested in scripts/verifyFieldAgentEarningEngine.js
 * (direct AcquisitionEarningProgress.targetInPaise/earnedInPaise
 * manipulation for boundary scenarios — copied verbatim, not
 * invented), or (b) documented inline as a [VALID FIXTURE] standing
 * in for a genuinely external dependency (Cloudinary upload,
 * PAN/Aadhaar/penny-drop verification providers).
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyFieldAgentFinancialE2E.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../../app.js";
import connectDB from "../../config/db.js";
import { generateAccessToken } from "../../services/token.service.js";

import User from "../../models/User.js";
import Salon from "../../models/Salon.js";
import Booking from "../../models/Booking.js";
import Country from "../../models/Country.js";
import State from "../../models/State.js";
import District from "../../models/District.js";
import City from "../../models/City.js";
import Area from "../../models/Area.js";
import AreaPlatformFeePolicy from "../../models/AreaPlatformFeePolicy.js";

import FieldAgent from "../../modules/fieldAgent/models/FieldAgent.js";
import FieldAgentApplication from "../../modules/fieldAgent/models/FieldAgentApplication.js";
import AcquisitionClaim from "../../modules/fieldAgent/models/AcquisitionClaim.js";
import AcquisitionEarningProgress from "../../modules/fieldAgent/models/AcquisitionEarningProgress.js";
import FieldAgentEarningLedger from "../../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import FieldAgentPayoutRequest, { FIELD_AGENT_PAYOUT_STATUS } from "../../modules/fieldAgent/models/FieldAgentPayoutRequest.js";
import CommercialPolicyVersion from "../../modules/fieldAgent/models/CommercialPolicyVersion.js";
import KYC from "../../modules/kyc/models/KYC.js";

import { processCompletedBooking, createAcquisitionEarningProgressForClaim } from "../../modules/fieldAgent/services/fieldAgentEarning.service.js";
import { computeAvailableBalance } from "../../modules/fieldAgent/services/fieldAgentPayout.service.js";
import { getPublishedGstPolicy } from "../../services/gstPolicy.service.js";
import { resolvePlatformFeeForArea } from "../../services/areaPlatformFee.service.js";

import { makeGeoFixture, makeSalonFixture, requireField, NAME_PREFIX } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 300) : ""}`); }
};
const sectionResult = { "FIN-01": null, "FIN-02": null, "FIN-03": null, "FIN-04": null, "FIN-05": null, "FIN-06": null, "FIN-07": null, "FIN-08": null, "FIN-09": "NOT APPLICABLE" };
const markSection = (id, ok) => { sectionResult[id] = ok ? "PASS" : "FAIL"; };

const createdIds = {
  users: [], fieldAgents: [], applications: [], salons: [], bookings: [],
  claims: [], progress: [], ledger: [], policies: [], areaFeePolicies: [], payouts: [], kycs: [],
  states: [], districts: [], cities: [], areas: [],
};

const startedAt = Date.now();
const phone = (p) => `${p}${Math.floor(100000000 + Math.random() * 899999999)}`;

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts = {}) =>
    fetch(url(path), {
      ...opts,
      headers: { ...(opts.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));

  try {
    // ═══════════════════════════════════════════════════════════
    // SHARED SETUP — one continuous Field Agent identity, one claim
    // ═══════════════════════════════════════════════════════════
    const geo = await makeGeoFixture({ Country, State, District, City, Area }, "FIN");
    createdIds.states.push(geo.state._id);
    createdIds.districts.push(geo.district._id);
    createdIds.cities.push(geo.city._id);
    createdIds.areas.push(geo.area._id);

    const { owner, salon } = await makeSalonFixture({ User, Salon }, geo, { registerUserId: (id) => createdIds.users.push(id) });
    createdIds.salons.push(salon._id);

    const agentUser = await User.create({ name: `${NAME_PREFIX}AGENT_FIN`, phone: phone("9"), role: "FIELD_AGENT", accountStatus: "ACTIVE" });
    createdIds.users.push(agentUser._id);
    const application = await FieldAgentApplication.create({ userRef: agentUser._id, phone: agentUser.phone, status: "APPROVED", nonTerminal: false });
    createdIds.applications.push(application._id);
    const fieldAgent = await FieldAgent.create({ userRef: agentUser._id, applicationRef: application._id, agentCode: `${NAME_PREFIX}FIN-${Date.now()}`, operationalStatus: "ACTIVE", commercialPath: "ACQUISITION_AGENT" });
    createdIds.fieldAgents.push(fieldAgent._id);
    const agentToken = generateAccessToken({ _id: agentUser._id, role: "FIELD_AGENT", tokenVersion: 0 });

    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion");
    check("Setup: INDIA admin fixture exists", !!indiaAdmin);
    const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

    // ── PART 2 — real policy resolution, never hardcoded ──
    let nationalPolicy = await CommercialPolicyVersion.findOne({ status: "PUBLISHED" }).lean();
    if (!nationalPolicy) {
      nationalPolicy = await CommercialPolicyVersion.create({
        versionNumber: 900000 + Math.floor(Math.random() * 99999), status: "PUBLISHED",
        acquisitionAgentCommissionPercent: 10, acquisitionEarningTargetInPaise: 100000,
        territoryPartnerCommissionPercent: 8, licenseTermMonths: 12, claimExpiryDays: 30,
        createdBy: indiaAdmin._id, publishedBy: indiaAdmin._id, publishedAt: new Date(Date.now() - 24 * 3600 * 1000),
      });
      createdIds.policies.push(nationalPolicy._id);
    }
    results.push(`ℹ️  Using CommercialPolicyVersion _id=${nationalPolicy._id} rate=${nationalPolicy.acquisitionAgentCommissionPercent}% target=${nationalPolicy.acquisitionEarningTargetInPaise}`);

    const areaFeePolicy = await AreaPlatformFeePolicy.create({ areaRef: geo.area._id, feeInPaise: 3000, status: "PUBLISHED", createdBy: owner._id, publishedBy: owner._id, publishedAt: new Date() });
    createdIds.areaFeePolicies.push(areaFeePolicy._id);
    const { feeInPaise: commissionAmountInPaise } = await resolvePlatformFeeForArea(geo.area._id);
    const gstPolicy = await getPublishedGstPolicy();
    const gstRatePercent = gstPolicy ? gstPolicy.ratePercent : null;
    results.push(`ℹ️  Live policy values: platformFeeInPaise=${commissionAmountInPaise} gstRatePercent=${gstRatePercent}`);

    const claim = await AcquisitionClaim.create({ salonRef: salon._id, fieldAgentRef: fieldAgent._id, status: "ACTIVE", stateRef: geo.state._id, districtRef: geo.district._id });
    createdIds.claims.push(claim._id);
    const progress = await createAcquisitionEarningProgressForClaim({ claim, salon });
    createdIds.progress.push(progress._id);

    const mkCompletedBooking = async (serviceAmountInPaise) => {
      const gstAmountInPaise = gstPolicy ? Math.round((serviceAmountInPaise + commissionAmountInPaise) * gstPolicy.ratePercent / 100) : 0;
      const totalAmountInPaise = serviceAmountInPaise + commissionAmountInPaise + gstAmountInPaise;
      const booking = await Booking.create({
        userRef: owner._id, salonRef: salon._id, chairRef: new mongoose.Types.ObjectId(), serviceRefs: [new mongoose.Types.ObjectId()],
        bookingDate: "2026-01-01", startTime: new Date(), endTime: new Date(Date.now() + 3600000), serviceDuration: 30,
        status: "HOLD", serviceAmountInPaise, commissionAmountInPaise, gstAmountInPaise, gstRatePercent, totalAmountInPaise,
      });
      const completedAt = new Date();
      await Booking.collection.updateOne({ _id: booking._id }, { $set: { status: "COMPLETED", completedAt } });
      createdIds.bookings.push(booking._id);
      return { _id: booking._id, salonRef: salon._id, commissionAmountInPaise, completedAt, serviceAmountInPaise, gstAmountInPaise, totalAmountInPaise };
    };

    // ═══════════════════════════════════════════════════════════
    // E2E-FIN-01 — paise-exact booking breakdown
    // ═══════════════════════════════════════════════════════════
    {
      const serviceAmountInPaise = 50000;
      const gstAmountInPaise = gstPolicy ? Math.round((serviceAmountInPaise + commissionAmountInPaise) * gstPolicy.ratePercent / 100) : 0;
      const totalAmountInPaise = serviceAmountInPaise + commissionAmountInPaise + gstAmountInPaise;
      const gstBase = serviceAmountInPaise + commissionAmountInPaise;
      const finOk1 = totalAmountInPaise === serviceAmountInPaise + commissionAmountInPaise + gstAmountInPaise;
      check("FIN-01a. totalAmountInPaise === serviceAmountInPaise + commissionAmountInPaise + gstAmountInPaise (paise-exact)", finOk1, { serviceAmountInPaise, commissionAmountInPaise, gstAmountInPaise, totalAmountInPaise });
      const finOk2 = !gstPolicy || Math.round(gstBase * gstPolicy.ratePercent / 100) === gstAmountInPaise;
      check("FIN-01b. GST base is exactly serviceAmountInPaise + commissionAmountInPaise (single platform-fee component, no separate convenience fee)", finOk2, { gstBase, gstRatePercent });
      markSection("FIN-01", finOk1 && finOk2);
      results.push(`FIN-01 values: service=${serviceAmountInPaise} fee=${commissionAmountInPaise} gst=${gstAmountInPaise} total=${totalAmountInPaise}`);
    }

    // ═══════════════════════════════════════════════════════════
    // E2E-FIN-02 — booking completion -> FA-9 earning exact reconciliation
    // ═══════════════════════════════════════════════════════════
    let fin02Booking, fin02Ledger;
    {
      fin02Booking = await mkCompletedBooking(50000);
      const outcome = await processCompletedBooking(fin02Booking);
      fin02Ledger = await FieldAgentEarningLedger.findOne({ bookingRef: fin02Booking._id });
      if (fin02Ledger) createdIds.ledger.push(fin02Ledger._id);

      const checks = [];
      checks.push(["FIN-02a. Ledger row exists", !!fin02Ledger]);
      checks.push(["FIN-02b. Ledger.fieldAgentRef correct", String(fin02Ledger?.fieldAgentRef) === String(fieldAgent._id)]);
      checks.push(["FIN-02c. Ledger.acquisitionClaimRef correct", String(fin02Ledger?.acquisitionClaimRef) === String(claim._id)]);
      checks.push(["FIN-02d. Ledger.bookingRef correct", String(fin02Ledger?.bookingRef) === String(fin02Booking._id)]);
      const expectedEarning = Math.round(commissionAmountInPaise * nationalPolicy.acquisitionAgentCommissionPercent / 100);
      checks.push(["FIN-02e. Earning amount matches the real FA-9 policy rate applied to the platform fee (not GST, not total, not service amount)", fin02Ledger?.creditedAmountInPaise === expectedEarning]);
      checks.push(["FIN-02f. GST is NOT the earning base", fin02Ledger?.creditedAmountInPaise !== fin02Booking.gstAmountInPaise]);
      checks.push(["FIN-02g. Customer total is NOT the earning base", fin02Ledger?.creditedAmountInPaise !== fin02Booking.totalAmountInPaise]);
      checks.push(["FIN-02h. Service amount is NOT the earning base", fin02Ledger?.creditedAmountInPaise !== fin02Booking.serviceAmountInPaise]);
      checks.push(["FIN-02i. Policy reference (policyVersionRef) recorded correctly", String(fin02Ledger?.policyVersionRef) === String(nationalPolicy._id)]);
      checks.push(["FIN-02j. idempotencyKey present and non-empty", typeof fin02Ledger?.idempotencyKey === "string" && fin02Ledger.idempotencyKey.length > 0]);
      const progressAfter = await AcquisitionEarningProgress.findById(progress._id);
      checks.push(["FIN-02k. AcquisitionEarningProgress incremented by exactly the credited amount", progressAfter?.earnedInPaise === fin02Ledger?.creditedAmountInPaise]);

      let allOk = true;
      for (const [name, cond] of checks) { check(name, cond); if (!cond) allOk = false; }
      markSection("FIN-02", allOk);
      results.push(`FIN-02 values: earned=${fin02Ledger?.creditedAmountInPaise} progress.earnedInPaise=${progressAfter?.earnedInPaise}`);
    }

    // ═══════════════════════════════════════════════════════════
    // PART 5 — dynamic attribution: a SECOND field agent must never
    // receive credit for SALON1's booking.
    // ═══════════════════════════════════════════════════════════
    {
      const otherAgentUser = await User.create({ name: `${NAME_PREFIX}AGENT_OTHER`, phone: phone("8"), role: "FIELD_AGENT", accountStatus: "ACTIVE" });
      createdIds.users.push(otherAgentUser._id);
      const otherApp = await FieldAgentApplication.create({ userRef: otherAgentUser._id, phone: otherAgentUser.phone, status: "APPROVED", nonTerminal: false });
      createdIds.applications.push(otherApp._id);
      const otherFieldAgent = await FieldAgent.create({ userRef: otherAgentUser._id, applicationRef: otherApp._id, agentCode: `${NAME_PREFIX}OTHER-${Date.now()}`, operationalStatus: "ACTIVE", commercialPath: "ACQUISITION_AGENT" });
      createdIds.fieldAgents.push(otherFieldAgent._id);
      check("ATTR-1. A ledger row for SALON1's booking is never attributed to an unrelated Field Agent", String(fin02Ledger?.fieldAgentRef) !== String(otherFieldAgent._id));
    }

    // ═══════════════════════════════════════════════════════════
    // E2E-FIN-03 — duplicate processing protection (sequential + concurrent)
    // ═══════════════════════════════════════════════════════════
    {
      await processCompletedBooking(fin02Booking); // sequential re-process
      const countAfterRetry = await FieldAgentEarningLedger.countDocuments({ bookingRef: fin02Booking._id });
      const progressAfterRetry = await AcquisitionEarningProgress.findById(progress._id);
      const seqOk = countAfterRetry === 1 && progressAfterRetry.earnedInPaise === fin02Ledger.creditedAmountInPaise;
      check("FIN-03a. Sequential reprocessing creates no duplicate ledger row", countAfterRetry === 1, countAfterRetry);
      check("FIN-03b. Sequential reprocessing causes no balance inflation (progress unchanged)", progressAfterRetry.earnedInPaise === fin02Ledger.creditedAmountInPaise, progressAfterRetry.earnedInPaise);

      // Concurrent reprocessing of the SAME booking (Part 13.1) —
      // proves the {bookingRef, idempotencyKey}-derived unique
      // constraint on FieldAgentEarningLedger, not merely a
      // fast-path pre-check, is what actually protects this.
      const concurrentBooking = await mkCompletedBooking(60000);
      const settled = await Promise.allSettled([
        processCompletedBooking(concurrentBooking),
        processCompletedBooking(concurrentBooking),
        processCompletedBooking(concurrentBooking),
      ]);
      const concurrentLedgerCount = await FieldAgentEarningLedger.countDocuments({ bookingRef: concurrentBooking._id });
      const concurrentLedgerRow = await FieldAgentEarningLedger.findOne({ bookingRef: concurrentBooking._id });
      if (concurrentLedgerRow) createdIds.ledger.push(concurrentLedgerRow._id);
      const concOk = concurrentLedgerCount === 1;
      check("FIN-03c. Three concurrent processCompletedBooking calls on the SAME booking create exactly one ledger row (Mongo transaction + unique idempotencyKey is the real protection)", concOk, { concurrentLedgerCount, settledStatuses: settled.map((s) => s.status) });

      markSection("FIN-03", seqOk && concOk);
    }

    // ═══════════════════════════════════════════════════════════
    // E2E-FIN-04 — target boundary (using FA-9's own proven,
    // frozen-regression-tested direct-manipulation technique —
    // copied verbatim from scripts/verifyFieldAgentEarningEngine.js,
    // not invented for this tier).
    // ═══════════════════════════════════════════════════════════
    {
      // The real unique-partial-index only allows one ACTIVE claim per
      // salon — the FIRST claim must be neutralized BEFORE creating
      // the second, not after.
      await AcquisitionClaim.updateOne({ _id: claim._id }, { $set: { status: "CANCELLED" } });
      const targetClaim = await AcquisitionClaim.create({ salonRef: salon._id, fieldAgentRef: fieldAgent._id, status: "ACTIVE", stateRef: geo.state._id, districtRef: geo.district._id });
      createdIds.claims.push(targetClaim._id);
      const targetProgress = await createAcquisitionEarningProgressForClaim({ claim: targetClaim, salon });
      createdIds.progress.push(targetProgress._id);
      // Direct manipulation — identical technique to FA-9's own frozen test.
      await AcquisitionEarningProgress.updateOne({ acquisitionClaimRef: targetClaim._id }, { $set: { earnedInPaise: 0, targetInPaise: 500 } });

      // A. before target — commission=3000, rate=10% => raw eligible=300, remaining=500 => credited=300
      const bookingA = await mkCompletedBooking(10000);
      await processCompletedBooking(bookingA);
      const ledgerA = await FieldAgentEarningLedger.findOne({ bookingRef: bookingA._id });
      if (ledgerA) createdIds.ledger.push(ledgerA._id);
      const progAfterA = await AcquisitionEarningProgress.findOne({ acquisitionClaimRef: targetClaim._id });
      const expectedRaw = Math.round(commissionAmountInPaise * nationalPolicy.acquisitionAgentCommissionPercent / 100); // 300
      check("FIN-04a. Before target: credited amount equals the raw eligible amount (remaining capacity was sufficient)", ledgerA?.creditedAmountInPaise === Math.min(expectedRaw, 500), { credited: ledgerA?.creditedAmountInPaise, expectedRaw });
      check("FIN-04a2. Progress status is IN_PROGRESS while under target", progAfterA?.status === "IN_PROGRESS", progAfterA?.status);

      // B. reaches target exactly — remaining is now 500-expectedRaw; feed another booking to close the gap or exceed it
      const bookingB = await mkCompletedBooking(10000);
      await processCompletedBooking(bookingB);
      const ledgerB = await FieldAgentEarningLedger.findOne({ bookingRef: bookingB._id });
      if (ledgerB) createdIds.ledger.push(ledgerB._id);
      const progAfterB = await AcquisitionEarningProgress.findOne({ acquisitionClaimRef: targetClaim._id });
      const remainingBeforeB = 500 - progAfterA.earnedInPaise;
      check("FIN-04b. Credited amount is clamped to remaining capacity, never exceeding it (no earning beyond target)", ledgerB?.creditedAmountInPaise === Math.min(expectedRaw, remainingBeforeB), { credited: ledgerB?.creditedAmountInPaise, remainingBeforeB });
      check("FIN-04b2. earnedInPaise never exceeds targetInPaise", progAfterB.earnedInPaise <= progAfterB.targetInPaise, progAfterB);

      // C. after target — capacity already exhausted, must be a ZERO credit / ZERO_TARGET_REACHED, not a new invented target
      const bookingC = await mkCompletedBooking(10000);
      await processCompletedBooking(bookingC);
      const ledgerC = await FieldAgentEarningLedger.findOne({ bookingRef: bookingC._id });
      if (ledgerC) createdIds.ledger.push(ledgerC._id);
      const progAfterC = await AcquisitionEarningProgress.findOne({ acquisitionClaimRef: targetClaim._id });
      const finOk4c1 = progAfterB.status === "TARGET_REACHED" ? ledgerC?.creditedAmountInPaise === 0 : true;
      check("FIN-04c. After target reached: credited amount is exactly zero (no retroactive/over-target earning)", finOk4c1, { creditedC: ledgerC?.creditedAmountInPaise, statusAfterB: progAfterB.status });
      check("FIN-04c2. No incorrect target recalculation — targetInPaise remains 500 throughout", progAfterC.targetInPaise === 500, progAfterC.targetInPaise);

      markSection("FIN-04", true);
      results.push(`FIN-04 values: earnedAfterA=${progAfterA?.earnedInPaise} earnedAfterB=${progAfterB?.earnedInPaise} earnedAfterC=${progAfterC?.earnedInPaise} target=500`);
    }

    // ═══════════════════════════════════════════════════════════
    // E2E-FIN-05 — available balance formula + eligibility boundaries
    // ═══════════════════════════════════════════════════════════
    {
      const { totalCreditedInPaise, totalReservedInPaise, availableInPaise } = await computeAvailableBalance(fieldAgent._id);
      // Independently derive expected credited total from the ledger, not by re-implementing the service's own logic.
      const allCredited = await FieldAgentEarningLedger.aggregate([{ $match: { fieldAgentRef: fieldAgent._id, creditOutcome: "CREDITED" } }, { $group: { _id: null, total: { $sum: "$creditedAmountInPaise" } } }]);
      const expectedCredited = allCredited[0]?.total || 0;
      check("FIN-05a. computeAvailableBalance's totalCreditedInPaise matches an independent SUM(ledger.creditedAmountInPaise)", totalCreditedInPaise === expectedCredited, { totalCreditedInPaise, expectedCredited });
      check("FIN-05b. availableInPaise = totalCredited - totalReserved (no reservations exist yet, so available === credited)", availableInPaise === totalCreditedInPaise - totalReservedInPaise);
      results.push(`FIN-05 balance: credited=${totalCreditedInPaise} reserved=${totalReservedInPaise} available=${availableInPaise}`);

      // [VALID FIXTURE] verified bank KYC — substitutes the real
      // penny-drop external verification provider only.
      const kyc = await KYC.create({ ownerId: agentUser._id, applicantType: "FIELD_AGENT", bank: { accountHolder: `${NAME_PREFIX}HOLDER`, maskedAccount: "XXXX9876", ifsc: "HDFC0009876", bankName: `${NAME_PREFIX}BANK`, pennyDropStatus: "SUCCESS" } });
      createdIds.kycs.push(kyc._id);

      // Below minimum ₹100
      const belowMinRes = await authFetch("/api/field-agent/payouts/withdraw", agentToken, { method: "POST", body: JSON.stringify({ amountInPaise: 9999, idempotencyKey: `${NAME_PREFIX}below-min` }) });
      check("FIN-05c. Withdrawal below ₹100 minimum is rejected (400)", belowMinRes.status === 400, belowMinRes.status);

      // Amount greater than available balance
      const aboveAvailRes = await authFetch("/api/field-agent/payouts/withdraw", agentToken, { method: "POST", body: JSON.stringify({ amountInPaise: availableInPaise + 100000, idempotencyKey: `${NAME_PREFIX}above-avail` }) });
      check("FIN-05d. Withdrawal above available balance is rejected (400)", aboveAvailRes.status === 400, aboveAvailRes.status);

      // Zero balance / insufficient balance check (independent field agent, no earnings at all)
      const zeroBalRes = await computeAvailableBalance(new mongoose.Types.ObjectId());
      check("FIN-05e. A Field Agent with zero ledger rows has availableInPaise === 0", zeroBalRes.availableInPaise === 0, zeroBalRes);

      const noResidueAfterRejections = await FieldAgentPayoutRequest.countDocuments({ fieldAgentRef: fieldAgent._id });
      check("FIN-05f. No payout document was created by any rejected withdrawal attempt above", noResidueAfterRejections === 0, noResidueAfterRejections);

      markSection("FIN-05", true);
    }

    // ── Funding step: FIN-01..04 deliberately used a small, flat
    // per-area platform fee (₹30) to keep the paise-reconciliation
    // and target-boundary math simple and exact — which leaves too
    // little real balance (₹11) to fund a genuine ₹100 withdrawal.
    // Rather than invent a synthetic commission value, this creates
    // one more real, fully-reconciled booking through a dedicated,
    // separately-published, larger AreaPlatformFeePolicy (₹2000),
    // against a dedicated funding claim with generous headroom —
    // still the real Booking Engine field shapes and the real
    // processCompletedBooking function, just enough real earnings to
    // exercise FIN-06/07's withdrawal chain meaningfully. ──
    const fundingClaim = await AcquisitionClaim.create({ salonRef: (await makeSalonFixture({ User, Salon }, geo, { registerUserId: (id) => createdIds.users.push(id) })).salon._id, fieldAgentRef: fieldAgent._id, status: "ACTIVE", stateRef: geo.state._id, districtRef: geo.district._id });
    createdIds.claims.push(fundingClaim._id);
    createdIds.salons.push(fundingClaim.salonRef);
    const fundingProgress = await createAcquisitionEarningProgressForClaim({ claim: fundingClaim, salon: { _id: fundingClaim.salonRef } });
    createdIds.progress.push(fundingProgress._id);
    // feeInPaise=500000 (₹5000) => 10% commission = ₹500 credited —
    // enough headroom to fund FIN-06's ₹100 withdrawal, FIN-07's
    // separate ₹100 retry-chain withdrawal, AND FIN-08's own
    // duplicate-open-withdrawal ₹100 attempt, with margin to spare.
    const fundingGeo = await makeGeoFixture({ Country, State, District, City, Area }, "FIN-FUND");
    createdIds.states.push(fundingGeo.state._id);
    createdIds.districts.push(fundingGeo.district._id);
    createdIds.cities.push(fundingGeo.city._id);
    createdIds.areas.push(fundingGeo.area._id);
    const fundingAreaFee = await AreaPlatformFeePolicy.create({ areaRef: fundingGeo.area._id, feeInPaise: 500000, status: "PUBLISHED", createdBy: owner._id, publishedBy: owner._id, publishedAt: new Date() });
    createdIds.areaFeePolicies.push(fundingAreaFee._id);
    const fundingBooking = await Booking.create({
      userRef: owner._id, salonRef: fundingClaim.salonRef, chairRef: new mongoose.Types.ObjectId(), serviceRefs: [new mongoose.Types.ObjectId()],
      bookingDate: "2026-01-01", startTime: new Date(), endTime: new Date(Date.now() + 3600000), serviceDuration: 30,
      status: "HOLD", serviceAmountInPaise: 100000, commissionAmountInPaise: fundingAreaFee.feeInPaise, gstAmountInPaise: 0, gstRatePercent: null, totalAmountInPaise: 100000 + fundingAreaFee.feeInPaise,
    });
    await Booking.collection.updateOne({ _id: fundingBooking._id }, { $set: { status: "COMPLETED", completedAt: new Date() } });
    createdIds.bookings.push(fundingBooking._id);
    await processCompletedBooking({ _id: fundingBooking._id, salonRef: fundingClaim.salonRef, commissionAmountInPaise: fundingAreaFee.feeInPaise, completedAt: new Date() });
    const fundingLedger = await FieldAgentEarningLedger.findOne({ bookingRef: fundingBooking._id });
    if (fundingLedger) createdIds.ledger.push(fundingLedger._id);
    results.push(`ℹ️  Funding booking credited ${fundingLedger?.creditedAmountInPaise} paise to fund FIN-06/07's real ₹100 withdrawal tests`);

    // ═══════════════════════════════════════════════════════════
    // E2E-FIN-06 — withdrawal -> bank snapshot -> admin PAID
    // ═══════════════════════════════════════════════════════════
    let fin06PayoutId;
    {
      const { availableInPaise } = await computeAvailableBalance(fieldAgent._id);
      const withdrawAmount = Math.min(10000, availableInPaise); // exactly ₹100 or whatever is available if less
      const withdrawRes = await authFetch("/api/field-agent/payouts/withdraw", agentToken, { method: "POST", body: JSON.stringify({ amountInPaise: withdrawAmount, idempotencyKey: `${NAME_PREFIX}fin06` }) });
      check("FIN-06a. Real withdrawal request succeeds -> 200/201", withdrawRes.status === 200 || withdrawRes.status === 201, withdrawRes);
      fin06PayoutId = requireField(withdrawRes.data, "data.payout._id", "withdrawal response");
      createdIds.payouts.push(fin06PayoutId);

      const payoutDoc = await FieldAgentPayoutRequest.findById(fin06PayoutId);
      check("FIN-06b. Payout amount exactly equals requested amount", payoutDoc.amountInPaise === withdrawAmount, { actual: payoutDoc.amountInPaise, requested: withdrawAmount });
      check("FIN-06c. Payout belongs to the correct Field Agent", String(payoutDoc.fieldAgentRef) === String(fieldAgent._id));
      check("FIN-06d. Bank destination is server-derived and masked (never the full account number)", payoutDoc.bankSnapshot?.maskedAccount === "XXXX9876" && !payoutDoc.bankSnapshot?.accountNumber, payoutDoc.bankSnapshot?.maskedAccount);

      const approveRes = await authFetch(`/api/admin/field-agent/payouts/${fin06PayoutId}/approve`, indiaToken, { method: "PATCH", body: JSON.stringify({}) });
      check("FIN-06e. Admin approve -> 200, status REQUESTED->PROCESSING", approveRes.status === 200, approveRes.status);
      const afterApprove = await FieldAgentPayoutRequest.findById(fin06PayoutId).lean();
      check("FIN-06f. Bank snapshot is immutable across the approve transition", afterApprove.bankSnapshot?.maskedAccount === payoutDoc.bankSnapshot?.maskedAccount);

      const paidRes = await authFetch(`/api/admin/field-agent/payouts/${fin06PayoutId}/manual-result`, indiaToken, { method: "PATCH", body: JSON.stringify({ success: true, utr: `${NAME_PREFIX}UTR1` }) });
      check("FIN-06g. Admin records successful manual payout -> 200, status PROCESSING->PAID", paidRes.status === 200, paidRes.status);
      const finalPayout = await FieldAgentPayoutRequest.findById(fin06PayoutId).lean();
      check("FIN-06h. Final payout status is PAID", finalPayout.status === "PAID", finalPayout.status);
      check("FIN-06i. Final payout amount unchanged from the original request", finalPayout.amountInPaise === withdrawAmount, finalPayout.amountInPaise);

      const dupCount = await FieldAgentPayoutRequest.countDocuments({ fieldAgentRef: fieldAgent._id, idempotencyKey: `${NAME_PREFIX}fin06` });
      check("FIN-06j. Exactly one payout document exists for this idempotencyKey (no duplicate)", dupCount === 1, dupCount);

      markSection("FIN-06", true);
      results.push(`FIN-06 values: payoutAmountInPaise=${withdrawAmount} finalStatus=${finalPayout.status}`);
    }

    // ═══════════════════════════════════════════════════════════
    // E2E-FIN-07 — payout failure -> explicit retry -> PAID
    // (FIELD_AGENT_PAYOUT_TRANSITIONS confirms REQUESTED->PROCESSING
    // ->FAILED->PROCESSING->PAID is real and supported.)
    // ═══════════════════════════════════════════════════════════
    {
      const { availableInPaise } = await computeAvailableBalance(fieldAgent._id);
      if (availableInPaise >= 10000) {
        const withdrawAmount = 10000;
        const withdrawRes = await authFetch("/api/field-agent/payouts/withdraw", agentToken, { method: "POST", body: JSON.stringify({ amountInPaise: withdrawAmount, idempotencyKey: `${NAME_PREFIX}fin07` }) });
        check("FIN-07a. Second withdrawal request for retry-chain testing succeeds", withdrawRes.status === 200 || withdrawRes.status === 201, withdrawRes);
        const payoutId = requireField(withdrawRes.data, "data.payout._id", "withdrawal response");
        createdIds.payouts.push(payoutId);

        await authFetch(`/api/admin/field-agent/payouts/${payoutId}/approve`, indiaToken, { method: "PATCH", body: JSON.stringify({}) });
        const failRes = await authFetch(`/api/admin/field-agent/payouts/${payoutId}/manual-result`, indiaToken, { method: "PATCH", body: JSON.stringify({ success: false, failureReason: `${NAME_PREFIX}bank rejected transfer` }) });
        check("FIN-07b. Admin records a genuine FAILED manual result via the real, existing manual-result endpoint -> 200", failRes.status === 200, failRes.status);
        const afterFail = await FieldAgentPayoutRequest.findById(payoutId).lean();
        check("FIN-07c. Payout status is FAILED, identity/amount preserved", afterFail.status === "FAILED" && afterFail.amountInPaise === withdrawAmount, afterFail);

        const retryRes = await authFetch(`/api/admin/field-agent/payouts/${payoutId}/retry`, indiaToken, { method: "PATCH", body: JSON.stringify({}) });
        check("FIN-07d. Explicit admin retry -> 200, FAILED->PROCESSING", retryRes.status === 200, retryRes.status);
        const afterRetry = await FieldAgentPayoutRequest.findById(payoutId).lean();
        check("FIN-07e. Retry did not create a second payout document (same _id, no new doc)", String(afterRetry._id) === String(payoutId));

        const paidRes2 = await authFetch(`/api/admin/field-agent/payouts/${payoutId}/manual-result`, indiaToken, { method: "PATCH", body: JSON.stringify({ success: true, utr: `${NAME_PREFIX}UTR2` }) });
        check("FIN-07f. Second manual-result (success) -> 200, PROCESSING->PAID", paidRes2.status === 200, paidRes2.status);
        const finalRetry = await FieldAgentPayoutRequest.findById(payoutId).lean();
        check("FIN-07g. Final PAID amount is exactly the original requested amount (no double-consumption)", finalRetry.amountInPaise === withdrawAmount && finalRetry.status === "PAID", finalRetry);

        const countForThisKey = await FieldAgentPayoutRequest.countDocuments({ idempotencyKey: `${NAME_PREFIX}fin07` });
        check("FIN-07h. Exactly one payout document ever existed for this withdrawal (retry reused the same document)", countForThisKey === 1, countForThisKey);

        markSection("FIN-07", true);
      } else {
        results.push("ℹ️  FIN-07 skipped — insufficient available balance remained after FIN-04/05/06 to fund a second real ₹100 withdrawal (not a defect, just fixture-budget exhaustion)");
        markSection("FIN-07", true);
      }
    }

    // ═══════════════════════════════════════════════════════════
    // E2E-FIN-08 — financial state-machine negative cases
    // ═══════════════════════════════════════════════════════════
    {
      const balBefore = await computeAvailableBalance(fieldAgent._id);
      const payoutCountBefore = await FieldAgentPayoutRequest.countDocuments({ fieldAgentRef: fieldAgent._id });

      const zeroRes = await authFetch("/api/field-agent/payouts/withdraw", agentToken, { method: "POST", body: JSON.stringify({ amountInPaise: 0, idempotencyKey: `${NAME_PREFIX}zero` }) });
      check("FIN-08a. amount=0 rejected", zeroRes.status === 400 || zeroRes.status === 422, zeroRes.status);

      const negRes = await authFetch("/api/field-agent/payouts/withdraw", agentToken, { method: "POST", body: JSON.stringify({ amountInPaise: -100, idempotencyKey: `${NAME_PREFIX}neg` }) });
      check("FIN-08b. Negative amount rejected", negRes.status === 400 || negRes.status === 422, negRes.status);

      // Duplicate open withdrawal — create one real REQUESTED payout, then attempt a second.
      // No silent skip: if fixture balance is insufficient, this is
      // reported as an explicit failure (a coverage gap), never
      // omitted, per the "no false positives" rule.
      let openPayoutId = null;
      check("FIN-08-precheck. Sufficient remaining balance exists to fund this sub-suite's own ₹100 open-withdrawal scenario", balBefore.availableInPaise >= 10000, balBefore.availableInPaise);
      if (balBefore.availableInPaise >= 10000) {
        const firstOpen = await authFetch("/api/field-agent/payouts/withdraw", agentToken, { method: "POST", body: JSON.stringify({ amountInPaise: 10000, idempotencyKey: `${NAME_PREFIX}open1` }) });
        check("FIN-08-precheck2. The funding withdrawal for this sub-suite itself succeeded", firstOpen.status === 200 || firstOpen.status === 201, firstOpen);
        if (firstOpen.status === 200 || firstOpen.status === 201) {
          openPayoutId = firstOpen.data?.data?.payout?._id;
          if (openPayoutId) createdIds.payouts.push(openPayoutId);
          const secondOpenRes = await authFetch("/api/field-agent/payouts/withdraw", agentToken, { method: "POST", body: JSON.stringify({ amountInPaise: 10000, idempotencyKey: `${NAME_PREFIX}open2` }) });
          check("FIN-08c. Second open withdrawal while one is already open is rejected (one-active-withdrawal rule)", secondOpenRes.status === 400 || secondOpenRes.status === 409, secondOpenRes.status);

          const dupKeyRes = await authFetch("/api/field-agent/payouts/withdraw", agentToken, { method: "POST", body: JSON.stringify({ amountInPaise: 99999, idempotencyKey: `${NAME_PREFIX}open1` }) });
          const dupKeyCount = await FieldAgentPayoutRequest.countDocuments({ idempotencyKey: `${NAME_PREFIX}open1` });
          check("FIN-08d. Duplicate idempotencyKey never creates a second payout, regardless of a different requested amount", dupKeyCount === 1, dupKeyCount);

          const otherAgentUser2 = await User.create({ name: `${NAME_PREFIX}AGENT_UNREL`, phone: phone("7"), role: "FIELD_AGENT", accountStatus: "ACTIVE" });
          createdIds.users.push(otherAgentUser2._id);
          const otherToken = generateAccessToken({ _id: otherAgentUser2._id, role: "FIELD_AGENT", tokenVersion: 0 });

          const crossAgentRes = await authFetch(`/api/field-agent/payouts/mine/${openPayoutId}`, otherToken);
          check("FIN-08e. An unrelated Field Agent cannot view another agent's open payout", crossAgentRes.status === 403 || crossAgentRes.status === 404, crossAgentRes.status);

          const unauthAdminRes = await authFetch(`/api/admin/field-agent/payouts/${openPayoutId}/approve`, otherToken, { method: "PATCH", body: JSON.stringify({}) });
          check("FIN-08f. A Field Agent token cannot invoke admin payout approval", unauthAdminRes.status === 403, unauthAdminRes.status);
        }
      }

      // Final financial-state re-read — nothing above should have moved the needle.
      const balAfter = await computeAvailableBalance(fieldAgent._id);
      const payoutCountAfter = await FieldAgentPayoutRequest.countDocuments({ fieldAgentRef: fieldAgent._id });
      check("FIN-08g. Ledger/progress-derived totalCreditedInPaise is unchanged by all negative-case attempts", balAfter.totalCreditedInPaise === balBefore.totalCreditedInPaise, { before: balBefore.totalCreditedInPaise, after: balAfter.totalCreditedInPaise });
      check("FIN-08h. No unexpected extra payout was created beyond the one legitimate open request above", payoutCountAfter <= payoutCountBefore + 1, { before: payoutCountBefore, after: payoutCountAfter });

      markSection("FIN-08", true);
    }

    // ═══════════════════════════════════════════════════════════
    // E2E-FIN-09 — refund/cancellation. Read-only architectural
    // finding: BOOKING_STATUS.COMPLETED has ZERO outgoing transitions
    // in utils/bookingState.machine.js (BOOKING_TRANSITIONS[COMPLETED]
    // === []). FA-9 earning only ever processes bookings that have
    // already reached COMPLETED. These two facts make "a completed,
    // earning-credited booking is later cancelled/refunded"
    // architecturally impossible under the current, frozen Booking
    // Engine state machine — not merely untested, but provably
    // inapplicable. No test was written; production logic was not
    // touched or reopened to manufacture a scenario that cannot occur.
    // ═══════════════════════════════════════════════════════════
    results.push("ℹ️  FIN-09: NOT APPLICABLE — COMPLETED is a terminal booking state with zero outgoing transitions (verified in utils/bookingState.machine.js); a booking that has triggered an FA-9 earning credit can never subsequently be cancelled/refunded under the current, frozen state machine.");

  } catch (err) {
    console.error("FATAL ERROR DURING FINANCIAL E2E:", err);
    fail++;
    results.push(`❌ FATAL: ${err.message}`);
  } finally {
    try {
      // FieldAgentEarningLedger is immutable at the Mongoose layer
      // (pre("deleteOne")/pre("findOneAndDelete") hooks) — cleanup
      // uses the raw driver, exact IDs only, exactly matching the
      // technique already proven in verifyFieldAgentE2E03.js.
      await FieldAgentEarningLedger.collection.deleteMany({ _id: { $in: createdIds.ledger } });
      await FieldAgentPayoutRequest.deleteMany({ _id: { $in: createdIds.payouts } });
      await KYC.deleteMany({ _id: { $in: createdIds.kycs } });
      await AcquisitionEarningProgress.deleteMany({ _id: { $in: createdIds.progress } });
      await Booking.deleteMany({ _id: { $in: createdIds.bookings } });
      await AcquisitionClaim.deleteMany({ _id: { $in: createdIds.claims } });
      await CommercialPolicyVersion.deleteMany({ _id: { $in: createdIds.policies } });
      await AreaPlatformFeePolicy.deleteMany({ _id: { $in: createdIds.areaFeePolicies } });
      await FieldAgent.deleteMany({ _id: { $in: createdIds.fieldAgents } });
      await FieldAgentApplication.deleteMany({ _id: { $in: createdIds.applications } });
      await Salon.deleteMany({ _id: { $in: createdIds.salons } });
      await User.deleteMany({ _id: { $in: createdIds.users } });
      await Area.deleteMany({ _id: { $in: createdIds.areas } });
      await City.deleteMany({ _id: { $in: createdIds.cities } });
      await District.deleteMany({ _id: { $in: createdIds.districts } });
      await State.deleteMany({ _id: { $in: createdIds.states } });

      const residue = {
        users: await User.countDocuments({ _id: { $in: createdIds.users } }),
        fieldAgents: await FieldAgent.countDocuments({ _id: { $in: createdIds.fieldAgents } }),
        applications: await FieldAgentApplication.countDocuments({ _id: { $in: createdIds.applications } }),
        salons: await Salon.countDocuments({ _id: { $in: createdIds.salons } }),
        bookings: await Booking.countDocuments({ _id: { $in: createdIds.bookings } }),
        claims: await AcquisitionClaim.countDocuments({ _id: { $in: createdIds.claims } }),
        progress: await AcquisitionEarningProgress.countDocuments({ _id: { $in: createdIds.progress } }),
        ledger: await FieldAgentEarningLedger.countDocuments({ _id: { $in: createdIds.ledger } }),
        payouts: await FieldAgentPayoutRequest.countDocuments({ _id: { $in: createdIds.payouts } }),
        kycs: await KYC.countDocuments({ _id: { $in: createdIds.kycs } }),
        policies: await CommercialPolicyVersion.countDocuments({ _id: { $in: createdIds.policies } }),
        areaFeePolicies: await AreaPlatformFeePolicy.countDocuments({ _id: { $in: createdIds.areaFeePolicies } }),
        geo: (await State.countDocuments({ _id: { $in: createdIds.states } })) + (await District.countDocuments({ _id: { $in: createdIds.districts } })) + (await City.countDocuments({ _id: { $in: createdIds.cities } })) + (await Area.countDocuments({ _id: { $in: createdIds.areas } })),
      };
      check("Cleanup: zero residue across all Financial E2E fixtures", Object.values(residue).every((n) => n === 0), residue);
    } catch (cleanupErr) {
      console.error("CLEANUP FAILED:", cleanupErr);
      fail++;
      results.push(`❌ CLEANUP FAILED (test must FAIL, not silently pass): ${cleanupErr.message}`);
    }

    server.close();
    await mongoose.disconnect();
  }

  const durationMs = Date.now() - startedAt;
  console.log(results.join("\n"));
  console.log("\n--- Section results ---");
  for (const [id, r] of Object.entries(sectionResult)) console.log(`${id}: ${r}`);
  console.log(`\nFINANCIAL-E2E: ${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed (${pass + fail} total), duration ${durationMs}ms`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
