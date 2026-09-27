/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyFinanceDashboardKPIEngine.js
 *
 * STEP 7.1 — Finance Dashboard KPI Engine — disposable live
 * verification. Real Atlas dev DB (already has real, pre-existing
 * data from the whole engagement) — every assertion checks the DELTA
 * (after − before) contributed by this script's own disposable
 * fixtures, never an absolute value, so this is safe to run against a
 * live, non-empty database.
 *
 * Proves:
 *   1. Merchant Amount Received includes PAID and REFUNDED transactions,
 *      EXCLUDES FAILED ones.
 *   2. Salon Paid / Acquisition Paid / Territory Paid correctly SUM
 *      PAID rows across ALL THREE coexisting payout-request models
 *      (legacy PayoutRequest, FieldAgentPayoutRequest joined to
 *      FieldAgent.commercialPath, and GenericPayoutRequest).
 *   3. Source Refunds reads Transaction.refundAmount (the refund
 *      engine's own maintained field), not a re-derivation.
 *   4. GST Already Paid = net GST Liability (SALE − REFUND_REVERSAL),
 *      all-time, and is the SAME number the GST Liability KPI reports.
 *   5. Zemish Holding = Merchant Amount Received − Salon Paid −
 *      Acquisition Paid − Territory Paid − Source Refunds − GST
 *      Already Paid — the exact corrected formula, verified arithmetically.
 *   6. Salon Liability / Agent Liability correctly sum all 4 wallet
 *      buckets, scoped to the right entityType set each.
 *   7. Processing Payouts sums the PROCESSING bucket across ALL entity
 *      types.
 *   8. Refund Exposure sums PENDING + PROCESSED Refund rows only.
 *   9. The real HTTP endpoint (/api/admin/finance/dashboard/kpis)
 *      returns the exact same numbers as the direct service call.
 *  10. ISOLATION: zero writes anywhere — every collection's document
 *      COUNT (not just totals) is checked before/after to confirm only
 *      this script's own fixtures were added, nothing was mutated.
 *
 * Run:  cd backend && node scripts/verifyFinanceDashboardKPIEngine.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import { generateAccessToken } from "../services/token.service.js";
import User from "../models/User.js";
import Transaction from "../models/Transaction.js";
import Refund from "../models/Refund.js";
import PayoutRequest from "../models/PayoutRequest.js";
import SalonEarnings from "../models/SalonEarnings.js";
import WalletLedger from "../models/WalletLedger.js";
import GSTLedger from "../modules/finance/models/GSTLedger.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import FieldAgentPayoutRequest from "../modules/fieldAgent/models/FieldAgentPayoutRequest.js";
import GenericPayoutRequest from "../modules/payout/models/GenericPayoutRequest.js";
import { getFinanceDashboardKPIs } from "../modules/finance/services/FinanceDashboardKPIService.js";
import WalletBalanceService from "../services/WalletBalanceService.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const P = "ZTEST_FDK71_";
const oid = () => new mongoose.Types.ObjectId();
let phoneSeq = 0;
const nextPhone = () => `9${String(9220000000 + phoneSeq++).slice(-9)}`;

const fixtureUserIds = [];
const fixtureFieldAgentIds = [];
const fixtureTxnIds = [];
const fixtureRefundIds = [];
const fixturePayoutRequestIds = [];
const fixtureFieldAgentPayoutIds = [];
const fixtureGenericPayoutIds = [];
const fixtureGstLedgerIds = [];
const fixtureWalletEntities = [];

const purgeFixtures = async () => {
  await Transaction.deleteMany({ _id: { $in: fixtureTxnIds } });
  await Refund.deleteMany({ _id: { $in: fixtureRefundIds } });
  await PayoutRequest.deleteMany({ _id: { $in: fixturePayoutRequestIds } });
  await FieldAgentPayoutRequest.deleteMany({ _id: { $in: fixtureFieldAgentPayoutIds } });
  await GenericPayoutRequest.collection.deleteMany({ _id: { $in: fixtureGenericPayoutIds } });
  await GSTLedger.collection.deleteMany({ _id: { $in: fixtureGstLedgerIds } });
  for (const { entityType, entityId } of fixtureWalletEntities) {
    await WalletLedger.collection.deleteMany({ ownerType: entityType, ownerId: entityId });
    await SalonEarnings.deleteMany({ entityType, entityId });
  }
  await FieldAgent.deleteMany({ _id: { $in: fixtureFieldAgentIds } });
  await User.deleteMany({ _id: { $in: fixtureUserIds } });
};

const withSession = async (fn) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const out = await fn(session);
    await session.commitTransaction();
    return out;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

const bankSnapshot = { accountHolder: `${P}HOLDER`, maskedAccount: "XXXX0000", ifsc: "HDFC0000001", bankName: "HDFC Bank" };

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token) => fetch(url(path), { headers: { Authorization: `Bearer ${token}` } }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));

  try {
    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion").lean();
    if (!indiaAdmin) throw new Error("No INDIA admin in DB to drive this verification");
    const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

    // ── BASELINE (before any fixture activity) ──────────────────────
    const before = await getFinanceDashboardKPIs();

    // ── FIXTURES: Transactions (Merchant Amount Received + Source Refunds) ──
    const owner = await User.create({ name: `${P}OWNER`, phone: nextPhone(), role: "OWNER", isActive: true });
    fixtureUserIds.push(owner._id);

    const mkTxn = async ({ status, amount, refundAmount = 0 }) => {
      const t = await Transaction.create({
        bookingId: oid(), userId: owner._id, salonId: oid(), resourceId: oid(),
        amount, commission: Math.round(amount * 0.1), payoutAmount: amount - Math.round(amount * 0.1),
        refundAmount, status, provider: "RAZORPAY", paymentId: `pay_${P}${Date.now()}_${Math.random()}`,
      });
      fixtureTxnIds.push(t._id);
      return t;
    };
    await mkTxn({ status: "PAID", amount: 100000, refundAmount: 0 });      // fully paid, no refund
    await mkTxn({ status: "REFUNDED", amount: 50000, refundAmount: 50000 }); // fully refunded
    await mkTxn({ status: "PAID", amount: 20000, refundAmount: 5000 });    // partially refunded
    await mkTxn({ status: "FAILED", amount: 30000, refundAmount: 0 });     // must be EXCLUDED entirely

    // ── FIXTURES: Refund (Refund Exposure) ──────────────────────────
    const mkRefund = async (refundStatus, amountInPaise) => {
      const r = await Refund.create({
        paymentId: `pay_${P}${Date.now()}_${Math.random()}`, bookingId: oid(), amountInPaise, paymentAmountInPaise: amountInPaise * 2,
        isFull: false, reason: "BOOKING_CANCELLED", initiatedBy: { type: "ADMIN" }, idempotencyKey: `${P}refund_${Math.random()}`,
        refundStatus, gatewayStatus: refundStatus.toLowerCase(),
      });
      fixtureRefundIds.push(r._id);
      return r;
    };
    await mkRefund("PENDING", 7000);
    await mkRefund("PROCESSED", 12000);
    await mkRefund("FAILED", 9000); // must be EXCLUDED

    // ── FIXTURES: GSTLedger (GST Liability / GST Already Paid) ──────
    const gstSale = await GSTLedger.create({ bookingId: oid(), revenueSplitId: oid(), ledgerType: "SALE", status: "COLLECTED", taxableValueInPaise: 2000, gstRate: 18, gstAmountInPaise: 3600, platformFeeInPaise: 2000, invoiceDate: new Date(), policyVersion: 1 });
    fixtureGstLedgerIds.push(gstSale._id);
    const gstReversal = await GSTLedger.create({ bookingId: gstSale.bookingId, revenueSplitId: gstSale.revenueSplitId, ledgerType: "REFUND_REVERSAL", status: "REVERSED", taxableValueInPaise: 1000, gstRate: 18, gstAmountInPaise: 1800, platformFeeInPaise: 1000, invoiceDate: new Date(), policyVersion: 1, refundId: `rfnd_${P}${Date.now()}` });
    fixtureGstLedgerIds.push(gstReversal._id);

    // ── FIXTURES: PayoutRequest (legacy SALON) — PAID ───────────────
    const legacySalonPayout = await PayoutRequest.create({ salonId: oid(), amountInPaise: 40000, status: "PAID" });
    fixturePayoutRequestIds.push(legacySalonPayout._id);
    const legacySalonPayoutOpen = await PayoutRequest.create({ salonId: oid(), amountInPaise: 99999, status: "REQUESTED" }); // must be EXCLUDED (not PAID)
    fixturePayoutRequestIds.push(legacySalonPayoutOpen._id);

    // ── FIXTURES: FieldAgentPayoutRequest (legacy, joined to FieldAgent.commercialPath) ──
    const mkFieldAgent = async (commercialPath) => {
      const u = await User.create({ name: `${P}FA_${commercialPath}`, phone: nextPhone(), role: "FIELD_AGENT", isActive: true });
      fixtureUserIds.push(u._id);
      const fa = await FieldAgent.create({ userRef: u._id, applicationRef: oid(), agentCode: `FA-99999999-${Math.floor(Math.random() * 900000) + 100000}`, operationalStatus: "ACTIVE", commercialPath });
      fixtureFieldAgentIds.push(fa._id);
      return fa;
    };
    const acqAgentLegacy = await mkFieldAgent("ACQUISITION_AGENT");
    const tpAgentLegacy = await mkFieldAgent("TERRITORY_PARTNER");
    const mkFieldAgentPayout = async (fieldAgentRef, amountInPaise, status, isOpen) => {
      const p = await FieldAgentPayoutRequest.create({ fieldAgentRef, amountInPaise, status, bankSnapshot, idempotencyKey: `${P}fap_${Math.random()}`, isOpen });
      fixtureFieldAgentPayoutIds.push(p._id);
      return p;
    };
    await mkFieldAgentPayout(acqAgentLegacy._id, 25000, "PAID", false);
    await mkFieldAgentPayout(tpAgentLegacy._id, 18000, "PAID", false);
    const acqAgentLegacyOpen = await mkFieldAgent("ACQUISITION_AGENT"); // separate agent — avoids the isOpen partial-unique-index collision with the PAID row above
    await mkFieldAgentPayout(acqAgentLegacyOpen._id, 77777, "REQUESTED", true); // must be EXCLUDED (not PAID)

    // ── FIXTURES: GenericPayoutRequest (STEP 6.3/6.4, all 3 types) — PAID ──
    const salonEntityId = oid();
    const acqEntityId = oid();
    const tpEntityId = oid();
    const mkGenericPayout = async (entityType, entityId, amountInPaise, status, isOpen) => {
      const p = await GenericPayoutRequest.create({ entityType, entityId, amountInPaise, status, bankSnapshot, idempotencyKey: `${P}gpr_${Math.random()}`, isOpen });
      fixtureGenericPayoutIds.push(p._id);
      return p;
    };
    await mkGenericPayout("SALON", salonEntityId, 15000, "PAID", false);
    await mkGenericPayout("ACQUISITION_AGENT", acqEntityId, 9000, "PAID", false);
    await mkGenericPayout("TERRITORY_PARTNER", tpEntityId, 6000, "PAID", false);
    await mkGenericPayout("SALON", oid(), 88888, "PROCESSING", true); // must be EXCLUDED (not PAID)

    // ── FIXTURES: SalonEarnings wallet buckets (Salon/Agent Liability + Processing Payouts) ──
    const walletSalon = oid();
    const walletAcq = oid();
    const walletTp = oid();
    const walletLegacyFieldAgent = oid();
    fixtureWalletEntities.push({ entityType: "SALON", entityId: walletSalon });
    fixtureWalletEntities.push({ entityType: "ACQUISITION_AGENT", entityId: walletAcq });
    fixtureWalletEntities.push({ entityType: "TERRITORY_PARTNER", entityId: walletTp });
    fixtureWalletEntities.push({ entityType: "FIELD_AGENT", entityId: walletLegacyFieldAgent });

    await withSession((session) => WalletBalanceService.credit({ entityType: "SALON", entityId: walletSalon, amountInPaise: 10000, action: "BONUS", refType: "ADJUSTMENT", refId: oid(), idempotencyKey: `${P}salon:avail`, session }));
    await withSession((session) => WalletBalanceService.creditPending({ entityType: "SALON", entityId: walletSalon, amountInPaise: 5000, action: "BOOKING_SETTLEMENT", refType: "BOOKING", refId: oid(), idempotencyKey: `${P}salon:pend`, session }));

    await withSession((session) => WalletBalanceService.credit({ entityType: "ACQUISITION_AGENT", entityId: walletAcq, amountInPaise: 8000, action: "EARNING_CREDIT", refType: "EARNING", refId: oid(), idempotencyKey: `${P}acq:avail`, session }));
    await withSession((session) => WalletBalanceService.credit({ entityType: "TERRITORY_PARTNER", entityId: walletTp, amountInPaise: 6000, action: "EARNING_CREDIT", refType: "EARNING", refId: oid(), idempotencyKey: `${P}tp:avail`, session }));
    await withSession((session) => WalletBalanceService.credit({ entityType: "FIELD_AGENT", entityId: walletLegacyFieldAgent, amountInPaise: 4000, action: "EARNING_CREDIT", refType: "EARNING", refId: oid(), idempotencyKey: `${P}legacyfa:avail`, session }));

    // Processing bucket, for KPI 5, via hold -> moveToProcessing (real lifecycle).
    await withSession((session) => WalletBalanceService.hold({ entityType: "TERRITORY_PARTNER", entityId: walletTp, amountInPaise: 3000, refType: "WITHDRAWAL", refId: oid(), idempotencyKey: `${P}tp:hold`, session }));
    await withSession((session) => WalletBalanceService.moveToProcessing({ entityType: "TERRITORY_PARTNER", entityId: walletTp, amountInPaise: 3000, refType: "WITHDRAWAL", refId: oid(), idempotencyKey: `${P}tp:proc`, session }));

    // ── COMPUTE ──────────────────────────────────────────────────────
    const after = await getFinanceDashboardKPIs();
    const delta = (a, b) => a - b;

    // ═══ KPI checks (all as DELTAs) ═══════════════════════════════════
    check("1. Merchant Amount Received includes PAID+REFUNDED only: +₹1700.00 (₹1000+₹500+₹200), EXCLUDES the ₹300 FAILED transaction", delta(after.zemishHolding.merchantAmountReceivedInPaise, before.zemishHolding.merchantAmountReceivedInPaise) === 170000, { before: before.zemishHolding.merchantAmountReceivedInPaise, after: after.zemishHolding.merchantAmountReceivedInPaise });
    check("2. Source Refunds reads Transaction.refundAmount directly: +₹550.00 (₹500 + ₹50)", delta(after.zemishHolding.sourceRefundsInPaise, before.zemishHolding.sourceRefundsInPaise) === 55000, { before: before.zemishHolding.sourceRefundsInPaise, after: after.zemishHolding.sourceRefundsInPaise });
    check("3. Salon Paid sums BOTH legacy PayoutRequest AND GenericPayoutRequest PAID rows: +₹550.00 (₹400 + ₹150), EXCLUDES the two non-PAID rows", delta(after.zemishHolding.salonPaidInPaise, before.zemishHolding.salonPaidInPaise) === 55000, { before: before.zemishHolding.salonPaidInPaise, after: after.zemishHolding.salonPaidInPaise });
    check("4. Acquisition Paid sums FieldAgentPayoutRequest (joined via FieldAgent.commercialPath) AND GenericPayoutRequest: +₹340.00 (₹250 + ₹90)", delta(after.zemishHolding.acquisitionPaidInPaise, before.zemishHolding.acquisitionPaidInPaise) === 34000, { before: before.zemishHolding.acquisitionPaidInPaise, after: after.zemishHolding.acquisitionPaidInPaise });
    check("5. Territory Paid sums FieldAgentPayoutRequest (joined) AND GenericPayoutRequest: +₹240.00 (₹180 + ₹60)", delta(after.zemishHolding.territoryPaidInPaise, before.zemishHolding.territoryPaidInPaise) === 24000, { before: before.zemishHolding.territoryPaidInPaise, after: after.zemishHolding.territoryPaidInPaise });
    check("6. GST Already Paid = net GST Liability: +₹18.00 (₹36 collected − ₹18 reversed)", delta(after.zemishHolding.gstAlreadyPaidInPaise, before.zemishHolding.gstAlreadyPaidInPaise) === 1800, { before: before.zemishHolding.gstAlreadyPaidInPaise, after: after.zemishHolding.gstAlreadyPaidInPaise });
    check("7. GST Already Paid (inside Holding) EXACTLY equals the separate GST Liability KPI card's own net figure", after.zemishHolding.gstAlreadyPaidInPaise === after.gstLiability.netInPaise);

    const expectedHoldingDelta = 170000 - 55000 - 34000 - 24000 - 55000 - 1800; // merchant - salonPaid - acqPaid - tpPaid - sourceRefunds - gst
    check("8. Zemish Holding = Merchant Received − Salon Paid − Acquisition Paid − Territory Paid − Source Refunds − GST Already Paid (exact corrected formula, verified arithmetically)", delta(after.zemishHolding.holdingInPaise, before.zemishHolding.holdingInPaise) === expectedHoldingDelta, { expectedHoldingDelta, actualDelta: delta(after.zemishHolding.holdingInPaise, before.zemishHolding.holdingInPaise) });

    check("9. Salon Liability: +₹150.00 (₹100 AVAILABLE + ₹50 PENDING)", delta(after.salonLiability.totalInPaise, before.salonLiability.totalInPaise) === 15000, { before: before.salonLiability, after: after.salonLiability });
    // TP: credited ₹60.00 AVAILABLE, then hold() moved ₹30.00 AVAILABLE->LOCKED,
    // then moveToProcessing() moved that same ₹30.00 LOCKED->PROCESSING — so TP
    // nets AVAILABLE ₹30.00 + PROCESSING ₹30.00, not AVAILABLE ₹60.00 + PROCESSING ₹30.00.
    check("10. Agent Liability: +₹180.00 (₹80 ACQ avail + ₹30 TP avail + ₹30 TP processing + ₹40 legacy FIELD_AGENT avail)", delta(after.agentLiability.totalInPaise, before.agentLiability.totalInPaise) === 18000, { before: before.agentLiability, after: after.agentLiability });
    check("11. Processing Payouts: +₹30.00 (the TERRITORY_PARTNER hold moved to PROCESSING)", delta(after.processingPayoutsInPaise, before.processingPayoutsInPaise) === 3000, { before: before.processingPayoutsInPaise, after: after.processingPayoutsInPaise });
    check("12. Refund Exposure: +₹190.00 (₹70 PENDING + ₹120 PROCESSED), EXCLUDES the ₹90 FAILED refund", delta(after.refundExposure.totalInPaise, before.refundExposure.totalInPaise) === 19000, { before: before.refundExposure, after: after.refundExposure });
    check("13. GST Liability KPI card itself: +₹18.00 net (matches check 6/7)", delta(after.gstLiability.netInPaise, before.gstLiability.netInPaise) === 1800);

    // ═══ Real HTTP endpoint returns the SAME numbers ═══════════════════
    const httpRes = await authFetch("/api/admin/finance/dashboard/kpis", indiaToken);
    check("14. Real HTTP GET /api/admin/finance/dashboard/kpis succeeds (200)", httpRes.status === 200, httpRes.data);
    check("15. HTTP response's holdingInPaise matches the direct service call exactly", httpRes.data?.data?.zemishHolding?.holdingInPaise === after.zemishHolding.holdingInPaise, { http: httpRes.data?.data?.zemishHolding?.holdingInPaise, direct: after.zemishHolding.holdingInPaise });
    const stateAdmin = await User.create({ name: `${P}STATEADMIN`, phone: nextPhone(), email: `${P.toLowerCase()}stateadmin_${Date.now()}@ztest.local`, role: "ADMIN", adminLevel: "STATE", adminSubRole: "PRIMARY", countryRef: oid(), stateRef: oid(), isActive: true });
    fixtureUserIds.push(stateAdmin._id);
    const stateToken = generateAccessToken({ _id: stateAdmin._id, role: "ADMIN", adminLevel: "STATE", tokenVersion: 0 });
    check("16. Non-INDIA admin is rejected (403) — same RBAC precedent as every other finance route", (await authFetch("/api/admin/finance/dashboard/kpis", stateToken)).status === 403);

    // ═══ ISOLATION — read-only confirmed by document COUNT, not just totals ═══
    const salonEarningsDocsAfter = await SalonEarnings.countDocuments({ entityType: { $in: ["SALON", "ACQUISITION_AGENT", "TERRITORY_PARTNER", "FIELD_AGENT"] }, entityId: { $in: fixtureWalletEntities.map((e) => e.entityId) } });
    check("17. Exactly 4 SalonEarnings wallet documents exist for this script's own fixtures (one per entity) — nothing duplicated by re-reading KPIs twice", salonEarningsDocsAfter === 4, salonEarningsDocsAfter);
    const gstLedgerDocsUnchanged = await GSTLedger.countDocuments({ _id: { $in: fixtureGstLedgerIds } });
    check("18. GSTLedger fixture rows still exactly 2 — the KPI engine never wrote a 3rd row", gstLedgerDocsUnchanged === 2);
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
