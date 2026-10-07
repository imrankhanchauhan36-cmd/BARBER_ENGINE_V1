/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyRefundCancellationPolicyEngine.js
 *
 * Global Refund & Cancellation Policy — disposable, real-Mongo,
 * real-HTTP verification. Mirrors this project's established
 * methodology (verifyOwnerBookingCancellation.js / verifyGSTReversal.js):
 * real Express app via app.listen(0), real signed JWTs for the
 * booking.controller.js HTTP endpoints, direct service calls for the
 * finance-ledger-only logic (RefundPolicyService, RefundReversalService,
 * GSTLedgerService) — the same two established testing conventions this
 * codebase already uses side by side, not a new one invented here.
 *
 * SAFETY — aborts immediately if a real PUBLISHED RefundPolicyVersion
 * already exists: never retires/overwrites a real admin's live policy.
 * Records before/after counts for every collection this feature can
 * write to; cleans up ONLY its own NAME_PREFIX-tagged fixtures via raw
 * collection bypasses where a model is immutable (blockMutation).
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyRefundCancellationPolicyEngine.js
 */

import "dotenv/config";
import crypto from "crypto";
import mongoose from "mongoose";
import app from "../../app.js";
import connectDB from "../../config/db.js";
import { generateAccessToken } from "../../services/token.service.js";

import User from "../../models/User.js";
import Salon from "../../models/Salon.js";
import Booking, { BOOKING_STATUS } from "../../models/Booking.js";
import SalonEarnings from "../../models/SalonEarnings.js";
import WalletTransaction from "../../models/WalletTransaction.js";
import Refund from "../../models/Refund.js";
import Transaction from "../../models/Transaction.js";
import RevenueSplit from "../../modules/finance/models/RevenueSplit.js";
import GSTLedger from "../../modules/finance/models/GSTLedger.js";
import { GST_LEDGER_TYPE, GST_LEDGER_STATUS } from "../../modules/finance/constants/gstLedger.constants.js";
import ZemishRevenueReversalLedger from "../../modules/finance/models/ZemishRevenueReversalLedger.js";
import TerritoryRevenueSplit from "../../modules/finance/models/TerritoryRevenueSplit.js";
import TerritoryRevenueLedger from "../../modules/finance/models/TerritoryRevenueLedger.js";
import RefundPolicyVersion, { REFUND_POLICY_STATUS } from "../../modules/finance/models/RefundPolicyVersion.js";
import {
  createDraftRefundPolicy,
  updateDraftRefundPolicy,
  publishRefundPolicy,
  retireRefundPolicy,
  getPublishedRefundPolicy,
} from "../../modules/finance/services/RefundPolicyService.js";
import { reverseRevenueForCancelledBooking } from "../../modules/finance/services/RefundReversalService.js";
import { REFUND_FRACTION_BY_POLICY } from "../../services/refundComponentSplitter.js";
import CancellationPolicyService from "../../services/CancellationPolicyService.js";
import WalletBalanceService from "../../services/WalletBalanceService.js";
import { completeRefund } from "../../services/RazorpayRefundService.js";
import { issueRefundForCancelledBooking } from "../../services/RefundExecutionService.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 500) : ""}`); }
};
const expectThrows = async (name, fn, statusExpected) => {
  try {
    await fn();
    check(name, false, "did not throw");
  } catch (err) {
    // Errors.* (utils/response.js) sets .statusCode; CancellationPolicyService's
    // own plain Object.assign(new Error(...), {status}) sets .status —
    // two different conventions already coexisting in this codebase.
    const actualStatus = err.statusCode ?? err.status;
    check(name, statusExpected == null || actualStatus === statusExpected, { status: actualStatus, message: err.message });
  }
};

const NAME_PREFIX = "ZTEST_REFUNDPOLICY_";
const oid = () => new mongoose.Types.ObjectId();
const OTP_SECRET = process.env.OTP_SECRET || "otp-fallback-secret-change-in-prod";
const hashOtp = (otp) => crypto.createHmac("sha256", OTP_SECRET).update(String(otp)).digest("hex");

const REVENUE_SPLIT_ENGINE_GENERATION = 1;

// Same inline session helper already proven in verifyUnifiedWalletEngine.js
// — used only to simulate the ORIGINAL confirm-time salon credit
// (WalletBalanceService.creditPending), standing in for the full
// booking-confirmation flow (payment capture, slot lock, etc.) this
// script does not need to re-exercise.
const withSession = async (fn) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await fn(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

const run = async () => {
  await connectDB();

  // ─── SAFETY GUARD — never run against a real published policy ────
  const preExistingPublished = await RefundPolicyVersion.countDocuments({ status: REFUND_POLICY_STATUS.PUBLISHED });
  if (preExistingPublished !== 0) {
    console.error(`SAFETY ABORT: ${preExistingPublished} PUBLISHED RefundPolicyVersion document(s) already exist — refusing to run.`);
    process.exit(1);
  }

  const before = {
    RefundPolicyVersion: await RefundPolicyVersion.countDocuments({}),
    Booking: await Booking.countDocuments({}),
    Refund: await Refund.countDocuments({}),
    Transaction: await Transaction.countDocuments({}),
    WalletTransaction: await WalletTransaction.countDocuments({}),
    GSTLedger: await GSTLedger.countDocuments({}),
    RevenueSplit: await RevenueSplit.countDocuments({}),
    ZemishRevenueReversalLedger: await ZemishRevenueReversalLedger.countDocuments({}),
    TerritoryRevenueSplit: await TerritoryRevenueSplit.countDocuments({}),
    TerritoryRevenueLedger: await TerritoryRevenueLedger.countDocuments({}),
  };
  results.push(`ℹ️  BEFORE counts: ${JSON.stringify(before)}`);

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
  const fixtureRefundPolicyIds = [];
  const fixtureRevenueSplitIds = [];
  const fixtureRefundIds = [];

  const adminId = oid();

  try {
    // ── SETUP ──────────────────────────────────────────────────
    const owner = await User.create({ name: `${NAME_PREFIX}OWNER`, phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, role: "OWNER", accountStatus: "ACTIVE" });
    const customer = await User.create({ name: `${NAME_PREFIX}CUSTOMER`, phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, role: "USER", accountStatus: "ACTIVE", walletBalance: 0 });
    fixtureUserIds.push(owner._id, customer._id);

    const dayTiming = { open: "09:00", close: "20:00" };
    const salonTimings = { monday: dayTiming, tuesday: dayTiming, wednesday: dayTiming, thursday: dayTiming, friday: dayTiming, saturday: dayTiming, sunday: dayTiming };
    const salonGeo = { location: { geo: { type: "Point", coordinates: [77, 28] }, address: `${NAME_PREFIX} addr` } };
    const salon = await Salon.create({ ownerId: owner._id, basicInfo: { shopName: `${NAME_PREFIX}SALON`, category: "UNISEX" }, timings: salonTimings, ...salonGeo });
    fixtureSalonIds.push(salon._id);
    await SalonEarnings.create({ salonId: salon._id, entityType: "SALON", entityId: salon._id, pendingBalanceInPaise: 10000000, availableBalanceInPaise: 0 });

    const ownerToken = generateAccessToken({ _id: owner._id, role: "OWNER", tokenVersion: 0 });
    const customerToken = generateAccessToken({ _id: customer._id, role: "USER", tokenVersion: 0 });

    const mkBooking = async ({ status = BOOKING_STATUS.CONFIRMED, offsetMinutes = 150, serviceAmountInPaise = 40000, commissionAmountInPaise = 10000, gstAmountInPaise = null, razorpayOrderId = null } = {}) => {
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
        commissionAmountInPaise,
        gstAmountInPaise,
        totalAmountInPaise: serviceAmountInPaise + commissionAmountInPaise + (gstAmountInPaise || 0),
        ...(razorpayOrderId ? { razorpayOrderId } : {}),
      });
      // Raw-driver status override for fixture setup only (same
      // precedent as verifyOwnerBookingCancellation.js's own mkBooking)
      // — bypasses the state machine deliberately, since these
      // fixtures must start in an arbitrary state.
      await Booking.collection.updateOne({ _id: booking._id }, { $set: { status } });
      fixtureBookingIds.push(booking._id);
      return booking;
    };

    // [VALID FIXTURE] Stands in for the full Razorpay-confirm webhook
    // flow (RevenueSplitIntegrationService.createRevenueSplitForBooking)
    // — creates the exact same shape that flow would, so this script
    // can test the GST/Zemish reversal mechanism without needing a
    // live Razorpay payment.
    const mkRevenueSplitWithGstSale = async (booking) => {
      const split = await RevenueSplit.create({
        bookingId: booking._id,
        serviceAmountInPaise: booking.serviceAmountInPaise,
        platformFeeInPaise: booking.commissionAmountInPaise,
        gstRatePercent: 5,
        gstAmountInPaise: booking.gstAmountInPaise,
        customerPaidInPaise: booking.totalAmountInPaise,
        salonCreditInPaise: booking.serviceAmountInPaise,
        zemishRevenueInPaise: booking.commissionAmountInPaise,
        policyVersion: REVENUE_SPLIT_ENGINE_GENERATION,
      });
      fixtureRevenueSplitIds.push(split._id);
      const saleLedger = await GSTLedger.create({
        bookingId: booking._id,
        revenueSplitId: split._id,
        ledgerType: GST_LEDGER_TYPE.SALE,
        status: GST_LEDGER_STATUS.COLLECTED,
        taxableValueInPaise: booking.commissionAmountInPaise,
        gstRate: 5,
        gstAmountInPaise: booking.gstAmountInPaise,
        platformFeeInPaise: booking.commissionAmountInPaise,
        invoiceDate: new Date(),
        policyVersion: REVENUE_SPLIT_ENGINE_GENERATION,
      });
      return { split, saleLedger };
    };

    const customerCancel = (token, bookingId, extra = {}) =>
      authFetch("/api/v1/bookings/user/cancel", token, { method: "POST", body: JSON.stringify({ bookingId, ...extra }) });
    const ownerCancel = (token, bookingId, extra = {}) =>
      authFetch("/api/v1/bookings/admin/cancel", token, { method: "POST", body: JSON.stringify({ bookingId, ...extra }) });

    // ═══════════════════════════════════════════════════════════
    // SECTION A — RefundPolicyVersion rule validation
    // ═══════════════════════════════════════════════════════════
    await expectThrows("A1. Empty rules array rejected", () => createDraftRefundPolicy({ adminId, rules: [] }), 400);
    await expectThrows("A2. Lowest rule must start at 0", () => createDraftRefundPolicy({ adminId, rules: [{ minMinutes: 5, maxMinutes: null, cancellationPercent: 100 }] }), 400);
    await expectThrows("A3. Gap between rules rejected", () => createDraftRefundPolicy({ adminId, rules: [{ minMinutes: 0, maxMinutes: 20, cancellationPercent: 100 }, { minMinutes: 25, maxMinutes: null, cancellationPercent: 0 }] }), 400);
    await expectThrows("A4. Overlap between rules rejected", () => createDraftRefundPolicy({ adminId, rules: [{ minMinutes: 0, maxMinutes: 30, cancellationPercent: 100 }, { minMinutes: 20, maxMinutes: null, cancellationPercent: 0 }] }), 400);
    await expectThrows("A5. Two unlimited rules rejected", () => createDraftRefundPolicy({ adminId, rules: [{ minMinutes: 0, maxMinutes: null, cancellationPercent: 100 }, { minMinutes: 30, maxMinutes: null, cancellationPercent: 0 }] }), 400);
    await expectThrows("A6. No unlimited top rule rejected", () => createDraftRefundPolicy({ adminId, rules: [{ minMinutes: 0, maxMinutes: 30, cancellationPercent: 100 }, { minMinutes: 31, maxMinutes: 100, cancellationPercent: 0 }] }), 400);
    await expectThrows("A7. cancellationPercent > 100 rejected", () => createDraftRefundPolicy({ adminId, rules: [{ minMinutes: 0, maxMinutes: null, cancellationPercent: 150 }] }), 400);
    await expectThrows("A8. Non-integer minMinutes rejected", () => createDraftRefundPolicy({ adminId, rules: [{ minMinutes: 0.5, maxMinutes: null, cancellationPercent: 100 }] }), 400);

    // ⚠️ cancellationPercent is the CANCELLATION/RETENTION percentage
    // (what the salon/Zemish/GST retain), NOT the customer refund
    // percentage — see RefundPolicyVersion.js's own header. This
    // ladder reproduces the pre-existing hardcoded CUSTOMER-REFUND
    // behavior (>=120min -> 100% refund, >=30min -> 50% refund, else
    // -> 0% refund) via the INVERTED values: 0-29min is a 100%
    // cancellation hit (0% refund), 120+min is a 0% cancellation hit
    // (100% refund).
    const draft1 = await createDraftRefundPolicy({
      adminId,
      rules: [
        { minMinutes: 0, maxMinutes: 29, cancellationPercent: 100 },
        { minMinutes: 30, maxMinutes: 119, cancellationPercent: 50 },
        { minMinutes: 120, maxMinutes: null, cancellationPercent: 0 },
      ],
    });
    fixtureRefundPolicyIds.push(draft1._id);
    check("A9. Valid gapless/non-overlapping ladder accepted, status DRAFT", draft1.status === "DRAFT", draft1.status);

    // ═══════════════════════════════════════════════════════════
    // SECTION B — Publish lifecycle
    // ═══════════════════════════════════════════════════════════
    const published1 = await publishRefundPolicy({ versionId: draft1._id, adminId });
    check("B1. Publish succeeds, status PUBLISHED", published1.status === "PUBLISHED" && !!published1.publishedAt && String(published1.publishedBy) === String(adminId), published1);
    const publishedCount1 = await RefundPolicyVersion.countDocuments({ status: "PUBLISHED" });
    check("B2. Exactly one PUBLISHED policy exists", publishedCount1 === 1, publishedCount1);

    await expectThrows("B4. Cannot publish a non-DRAFT version", () => publishRefundPolicy({ versionId: draft1._id, adminId }), 409);
    await expectThrows("B5. Cannot retire a non-PUBLISHED (not-yet-existing) version", () => retireRefundPolicy({ versionId: oid(), adminId }), 404);
    await expectThrows("B6. updateDraft on a PUBLISHED version rejected", () => updateDraftRefundPolicy({ versionId: draft1._id, adminId, rules: [{ minMinutes: 0, maxMinutes: null, cancellationPercent: 0 }] }), 409);

    // ═══════════════════════════════════════════════════════════
    // SECTION C — Exact boundary reproduction (pure function)
    // ═══════════════════════════════════════════════════════════
    const now = new Date();
    const mkStart = (mins) => new Date(now.getTime() + mins * 60000);
    const evalAt = (minsUntil, status = "CONFIRMED") =>
      CancellationPolicyService.evaluate({
        booking: { status, startTime: mkStart(minsUntil), totalAmountInPaise: 70000, serviceAmountInPaise: 50000, commissionAmountInPaise: 20000 },
        now,
        refundPolicy: published1,
      });

    check("C1. 150 min (>=120) -> FULL_REFUND 100%", evalAt(150).refundPolicy === "FULL_REFUND" && evalAt(150).refundPercent === 100);
    check("C2. Exactly 120 min -> FULL_REFUND 100% (inclusive boundary)", evalAt(120).refundPolicy === "FULL_REFUND" && evalAt(120).refundPercent === 100);
    check("C3. 119.9 min (just under 120, fractional) -> HALF_REFUND 50% (no gap)", evalAt(119.9).refundPolicy === "HALF_REFUND" && evalAt(119.9).refundPercent === 50, evalAt(119.9));
    check("C4. 60 min -> HALF_REFUND 50%", evalAt(60).refundPolicy === "HALF_REFUND" && evalAt(60).refundPercent === 50);
    check("C5. Exactly 30 min -> HALF_REFUND 50% (inclusive boundary)", evalAt(30).refundPolicy === "HALF_REFUND" && evalAt(30).refundPercent === 50);
    check("C6. 29.9 min (just under 30, fractional) -> NO_REFUND 0%", evalAt(29.9).refundPolicy === "NO_REFUND" && evalAt(29.9).refundPercent === 0, evalAt(29.9));
    check("C7. 10 min -> NO_REFUND 0%", evalAt(10).refundPolicy === "NO_REFUND" && evalAt(10).refundPercent === 0);
    check("C8. HOLD status -> NO_PAYMENT 0% regardless of policy", evalAt(150, "HOLD").refundPolicy === "NO_PAYMENT" && evalAt(150, "HOLD").refundFraction === 0);
    await expectThrows("C9. No published policy passed, non-HOLD status -> fails closed (503)", async () => {
      CancellationPolicyService.evaluate({ booking: { status: "CONFIRMED", startTime: mkStart(150), totalAmountInPaise: 70000, serviceAmountInPaise: 50000, commissionAmountInPaise: 20000 }, now, refundPolicy: null });
    }, 503);

    // ═══════════════════════════════════════════════════════════
    // SECTION D — Real HTTP: customer vs salon cancellation, same
    // global policy, identical outcome (no fault-based override)
    // ═══════════════════════════════════════════════════════════
    const bCustomer = await mkBooking({ offsetMinutes: 150, serviceAmountInPaise: 50000, commissionAmountInPaise: 20000 });
    const rCustomer = await customerCancel(customerToken, bCustomer._id.toString());
    check("D1. Customer cancel at 150min -> 200, FULL_REFUND", rCustomer.status === 200 && rCustomer.data.refundPolicy === "FULL_REFUND", rCustomer.data);

    const bOwner = await mkBooking({ offsetMinutes: 150, serviceAmountInPaise: 50000, commissionAmountInPaise: 20000 });
    const rOwner = await ownerCancel(ownerToken, bOwner._id.toString());
    check("D2. Owner(salon) cancel at same 150min timing -> 200, IDENTICAL refundPolicy", rOwner.status === 200 && rOwner.data.refundPolicy === rCustomer.data.refundPolicy && rOwner.data.refundAmountInPaise === rCustomer.data.refundAmountInPaise, { customer: rCustomer.data, owner: rOwner.data });

    const bCustomerAfter = await Booking.findById(bCustomer._id).lean();
    const bOwnerAfter = await Booking.findById(bOwner._id).lean();
    check("D3. Both bookings froze the IDENTICAL refundFractionApplied + refundPolicyVersionRef (one global policy)", bCustomerAfter.refundFractionApplied === bOwnerAfter.refundFractionApplied && String(bCustomerAfter.refundPolicyVersionRef) === String(bOwnerAfter.refundPolicyVersionRef) && String(bCustomerAfter.refundPolicyVersionRef) === String(published1._id), { customer: bCustomerAfter.refundPolicyVersionRef, owner: bOwnerAfter.refundPolicyVersionRef, published: published1._id });

    // ═══════════════════════════════════════════════════════════
    // SECTION E — Multi-component proportional reversal
    // ═══════════════════════════════════════════════════════════
    const bWithSplit = await mkBooking({ offsetMinutes: 60, serviceAmountInPaise: 50000, commissionAmountInPaise: 20000, gstAmountInPaise: 3500, razorpayOrderId: `order_${NAME_PREFIX}${Date.now()}` });
    await mkRevenueSplitWithGstSale(bWithSplit);
    const rWithSplit = await customerCancel(customerToken, bWithSplit._id.toString());
    check("E1. 60min cancel with RevenueSplit -> 200, HALF_REFUND", rWithSplit.status === 200 && rWithSplit.data.refundPolicy === "HALF_REFUND", rWithSplit.data);

    const expectedWalletCredit = Math.round(50000 * 0.5) + Math.round(20000 * 0.5) + Math.round(3500 * 0.5);
    check("E2. Wallet credit = proportional service+commission+GST", rWithSplit.data.refundAmountInPaise === expectedWalletCredit, { got: rWithSplit.data.refundAmountInPaise, expected: expectedWalletCredit });

    const gstReversal = await GSTLedger.findOne({ bookingId: bWithSplit._id, ledgerType: GST_LEDGER_TYPE.REFUND_REVERSAL }).lean();
    check("E3. GST REFUND_REVERSAL ledger row created, correct proportional amount", !!gstReversal && gstReversal.gstAmountInPaise === Math.round(3500 * 0.5) && gstReversal.refundId === `cancel:${bWithSplit._id}`, gstReversal);

    const zemishReversal = await ZemishRevenueReversalLedger.findOne({ bookingId: bWithSplit._id }).lean();
    check("E4. Zemish Platform Fee revenue REVERSAL row created, correct proportional amount, correct ownership", !!zemishReversal && zemishReversal.reversedAmountInPaise === Math.round(20000 * 0.5) && zemishReversal.refundFraction === 0.5 && zemishReversal.reversalKey === `cancel:${bWithSplit._id}`, zemishReversal);

    const bNoSplit = await mkBooking({ offsetMinutes: 60, serviceAmountInPaise: 50000, commissionAmountInPaise: 20000, gstAmountInPaise: 2500 });
    const rNoSplit = await customerCancel(customerToken, bNoSplit._id.toString());
    check("E5. Wallet-paid-at-origin booking (no RevenueSplit) cancelled -> 200, wallet refund still correct", rNoSplit.status === 200 && rNoSplit.data.refundAmountInPaise === Math.round(50000 * 0.5) + Math.round(20000 * 0.5) + Math.round(2500 * 0.5));
    const noSplitGstRow = await GSTLedger.findOne({ bookingId: bNoSplit._id }).lean();
    const noSplitZemishRow = await ZemishRevenueReversalLedger.findOne({ bookingId: bNoSplit._id }).lean();
    check("E6. No RevenueSplit -> NO GST/Zemish reversal row invented (nothing was ever recorded to reverse)", !noSplitGstRow && !noSplitZemishRow);

    // ═══════════════════════════════════════════════════════════
    // SECTION F — Wallet vs Razorpay-source structural parity
    // ═══════════════════════════════════════════════════════════
    const bParityA = await mkBooking({ offsetMinutes: 60, serviceAmountInPaise: 60000, commissionAmountInPaise: 15000, gstAmountInPaise: 3000, razorpayOrderId: `order_${NAME_PREFIX}A_${Date.now()}` });
    const bParityB = await mkBooking({ offsetMinutes: 60, serviceAmountInPaise: 60000, commissionAmountInPaise: 15000, gstAmountInPaise: 3000, razorpayOrderId: `order_${NAME_PREFIX}B_${Date.now()}` });
    const { split: splitA } = await mkRevenueSplitWithGstSale(bParityA);
    const { split: splitB } = await mkRevenueSplitWithGstSale(bParityB);

    const resultWalletPath = await reverseRevenueForCancelledBooking({ bookingId: bParityA._id, refundFraction: 0.5, reversalKey: `cancel:${bParityA._id}` });
    const resultSourcePath = await reverseRevenueForCancelledBooking({ bookingId: bParityB._id, refundFraction: 0.5, reversalKey: `rfnd_${NAME_PREFIX}SOURCE_${Date.now()}` });
    check("F1. Wallet-path key and Razorpay-source-style key BOTH produce an equivalent GST reversal amount", resultWalletPath.gstReversal?.gstAmountInPaise === resultSourcePath.gstReversal?.gstAmountInPaise && resultWalletPath.gstReversal?.gstAmountInPaise === Math.round(3000 * 0.5), { wallet: resultWalletPath.gstReversal, source: resultSourcePath.gstReversal });
    check("F2. Wallet-path key and Razorpay-source-style key BOTH produce an equivalent Zemish reversal amount", resultWalletPath.zemishReversal?.reversedAmountInPaise === resultSourcePath.zemishReversal?.reversedAmountInPaise && resultWalletPath.zemishReversal?.reversedAmountInPaise === Math.round(15000 * 0.5));

    // ═══════════════════════════════════════════════════════════
    // SECTION G — Duplicate cancellation/refund protection
    // ═══════════════════════════════════════════════════════════
    const rDup = await customerCancel(customerToken, bCustomer._id.toString());
    check("G1. Re-cancelling an already-CANCELLED booking rejected (400)", rDup.status === 400, rDup.status);

    const gstCountBefore = await GSTLedger.countDocuments({ bookingId: bWithSplit._id });
    const zemishCountBefore = await ZemishRevenueReversalLedger.countDocuments({ bookingId: bWithSplit._id });
    await reverseRevenueForCancelledBooking({ bookingId: bWithSplit._id, refundFraction: 0.5, reversalKey: `cancel:${bWithSplit._id}` });
    const gstCountAfter = await GSTLedger.countDocuments({ bookingId: bWithSplit._id });
    const zemishCountAfter = await ZemishRevenueReversalLedger.countDocuments({ bookingId: bWithSplit._id });
    check("G2. Re-running the SAME reversal key is idempotent — no duplicate rows", gstCountBefore === gstCountAfter && zemishCountBefore === zemishCountAfter, { gstCountBefore, gstCountAfter, zemishCountBefore, zemishCountAfter });

    // ═══════════════════════════════════════════════════════════
    // SECTION H — Historical-booking-snapshot immutability
    // ═══════════════════════════════════════════════════════════
    const snapshotBefore = await Booking.findById(bCustomer._id).select("cancellationPolicy refundAmountInPaise refundPolicyVersionRef refundFractionApplied").lean();

    // cancellationPercent (retained), inverted to reproduce the SAME
    // external refund outcome as before (10% refund 0-59min [90%
    // cancellation], 90% refund 60+min [10% cancellation]).
    const draft2 = await createDraftRefundPolicy({
      adminId,
      rules: [
        { minMinutes: 0, maxMinutes: 59, cancellationPercent: 90 },
        { minMinutes: 60, maxMinutes: null, cancellationPercent: 10 },
      ],
    });
    fixtureRefundPolicyIds.push(draft2._id);
    const published2 = await publishRefundPolicy({ versionId: draft2._id, adminId });
    check("H1. New policy published, retiring the old one", published2.status === "PUBLISHED");
    const oldPolicyAfter = await RefundPolicyVersion.findById(published1._id).lean();
    check("H2. Old policy version is now RETIRED", oldPolicyAfter.status === "RETIRED");

    const snapshotAfter = await Booking.findById(bCustomer._id).select("cancellationPolicy refundAmountInPaise refundPolicyVersionRef refundFractionApplied").lean();
    check("H3. Already-cancelled booking's stored policy snapshot is UNCHANGED after a new policy publish", JSON.stringify(snapshotBefore) === JSON.stringify(snapshotAfter), { before: snapshotBefore, after: snapshotAfter });

    const bUnderNewPolicy = await mkBooking({ offsetMinutes: 75, serviceAmountInPaise: 50000, commissionAmountInPaise: 20000 });
    const rUnderNewPolicy = await customerCancel(customerToken, bUnderNewPolicy._id.toString());
    check("H4. A NEW cancellation now uses the NEWLY published policy's rules (90% at 75min, not the old policy's 50%)", rUnderNewPolicy.status === 200 && rUnderNewPolicy.data.refundPolicy === "PARTIAL_REFUND", rUnderNewPolicy.data);
    const bUnderNewPolicyAfter = await Booking.findById(bUnderNewPolicy._id).lean();
    check("H5. refundFractionApplied = 0.9, refundPolicyVersionRef = the NEW published version", bUnderNewPolicyAfter.refundFractionApplied === 0.9 && String(bUnderNewPolicyAfter.refundPolicyVersionRef) === String(published2._id));

    // ═══════════════════════════════════════════════════════════
    // SECTION I — No-show stays separate, untouched by the policy
    // ═══════════════════════════════════════════════════════════
    const bNoShow = await mkBooking({ offsetMinutes: 150 });
    const otp = "482917";
    await Booking.collection.updateOne({ _id: bNoShow._id }, { $set: { noShowOtp: hashOtp(otp), noShowOtpExpiresAt: new Date(Date.now() + 5 * 60000) } });
    const rNoShow = await authFetch("/api/v1/bookings/admin/confirm-noshow", ownerToken, { method: "POST", body: JSON.stringify({ bookingId: bNoShow._id.toString(), otp }) });
    check("I1. No-show OTP confirmation succeeds (200)", rNoShow.status === 200, rNoShow.data);
    const bNoShowAfter = await Booking.findById(bNoShow._id).lean();
    check("I2. No-show booking: cancellationPolicy/refundAmountInPaise/refundPolicyVersionRef/refundFractionApplied ALL remain null — never governed by the configurable policy", bNoShowAfter.cancellationPolicy === null && bNoShowAfter.refundAmountInPaise === null && bNoShowAfter.refundPolicyVersionRef === null && bNoShowAfter.refundFractionApplied === null && bNoShowAfter.cancelledViaOtpConfirmation === true, bNoShowAfter);

    // ═══════════════════════════════════════════════════════════
    // SECTION J — Fail-closed when no policy is published
    // ═══════════════════════════════════════════════════════════
    await retireRefundPolicy({ versionId: published2._id, adminId });
    const nonePublished = await getPublishedRefundPolicy();
    check("J1. No PUBLISHED policy exists after retiring this script's own fixture", nonePublished === null);
    const bFailClosed = await mkBooking({ offsetMinutes: 150 });
    const rFailClosed = await customerCancel(customerToken, bFailClosed._id.toString());
    check("J2. Cancellation with NO published policy fails closed (503), never a silent default", rFailClosed.status === 503, rFailClosed.data);
    const bFailClosedAfter = await Booking.findById(bFailClosed._id).lean();
    check("J3. Booking left untouched (still CONFIRMED, never cancelled) after the fail-closed rejection", bFailClosedAfter.status === "CONFIRMED");

    // ═══════════════════════════════════════════════════════════
    // SECTION K — Legacy REFUND_FRACTION_BY_POLICY fallback preserved
    // ═══════════════════════════════════════════════════════════
    const legacyFraction = null ?? REFUND_FRACTION_BY_POLICY["HALF_REFUND"]; // simulates booking.refundFractionApplied being null (pre-feature booking)
    check("K1. A pre-feature booking (refundFractionApplied null) still resolves via the legacy label table", legacyFraction === 0.5);

    // ═══════════════════════════════════════════════════════════
    // SECTION M — the 4th cancellation path discovered during
    // implementation: performAdminCancellation (adminCancelBooking /
    // adminUpdateBookingStatus, PATCH /api/admin/bookings/:id/*).
    // Uses a REAL, pre-existing INDIA admin (read-only lookup — never
    // created, never modified, never deleted) so this exercises the
    // real requireAdminLevel gate exactly as production does.
    // ═══════════════════════════════════════════════════════════
    const draftM = await createDraftRefundPolicy({ adminId, rules: [{ minMinutes: 0, maxMinutes: 29, cancellationPercent: 100 }, { minMinutes: 30, maxMinutes: 119, cancellationPercent: 50 }, { minMinutes: 120, maxMinutes: null, cancellationPercent: 0 }] });
    fixtureRefundPolicyIds.push(draftM._id);
    const publishedM = await publishRefundPolicy({ versionId: draftM._id, adminId });

    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA", isDeleted: { $ne: true } }).select("+tokenVersion").lean();
    if (!indiaAdmin) {
      results.push("⚠️  SECTION M SKIPPED — no real INDIA admin user exists in this environment to generate a token for (read-only lookup found none). Not counted as pass or fail.");
    } else {
      const indiaAdminToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });
      const bAdminCancel = await mkBooking({ offsetMinutes: 60, serviceAmountInPaise: 40000, commissionAmountInPaise: 16000, gstAmountInPaise: 2000, razorpayOrderId: `order_${NAME_PREFIX}ADMIN_${Date.now()}` });
      await mkRevenueSplitWithGstSale(bAdminCancel);
      const rAdminCancel = await authFetch(`/api/admin/bookings/${bAdminCancel._id}/cancel`, indiaAdminToken, { method: "PATCH", body: JSON.stringify({ reason: `${NAME_PREFIX}admin cancel test` }) });
      check("M1. PATCH /api/admin/bookings/:id/cancel (performAdminCancellation) -> 200", rAdminCancel.status === 200, rAdminCancel.data);
      const bAdminCancelAfter = await Booking.findById(bAdminCancel._id).lean();
      check("M2. Admin-cancelled booking: refundPolicy=HALF_REFUND, refundFractionApplied=0.5, refundPolicyVersionRef = the published version (same global policy, same as customer/owner paths)", bAdminCancelAfter.cancellationPolicy === "HALF_REFUND" && bAdminCancelAfter.refundFractionApplied === 0.5 && String(bAdminCancelAfter.refundPolicyVersionRef) === String(publishedM._id), bAdminCancelAfter);
      const adminGstReversal = await GSTLedger.findOne({ bookingId: bAdminCancel._id, ledgerType: GST_LEDGER_TYPE.REFUND_REVERSAL }).lean();
      const adminZemishReversal = await ZemishRevenueReversalLedger.findOne({ bookingId: bAdminCancel._id }).lean();
      check("M3. Admin cancellation ALSO produced the GST + Zemish revenue reversal (same reverseRevenueForCancelledBooking call as every other path)", !!adminGstReversal && adminGstReversal.gstAmountInPaise === Math.round(2000 * 0.5) && !!adminZemishReversal && adminZemishReversal.reversedAmountInPaise === Math.round(16000 * 0.5), { adminGstReversal, adminZemishReversal });
    }

    // ═══════════════════════════════════════════════════════════
    // SECTION N — explicit 25% CANCELLATION HIT, all THREE
    // cancellation paths (customer/salon/admin), with EXACT
    // per-component REFUND amounts AND RETAINED amounts (service/GST/
    // Platform Fee individually, not just the wallet total), plus
    // corresponding GST + Zemish reversal and the invariant
    // refund+retained == original total. ONLY the three components
    // that genuinely exist on this booking's frozen snapshot — service
    // amount, the ONE salon/service GST field that actually exists in
    // production, and Platform Fee/Zemish revenue. No "Platform GST"
    // is asserted anywhere — it does not exist.
    //
    // ⚠️ FIELD SEMANTICS (corrected per explicit business-rule review):
    // cancellationPercent: 25 in the published rule below is a 25%
    // CANCELLATION HIT — the customer receives 75%, and 25% is
    // RETAINED by the salon (service)/Zemish (Platform Fee)/GST
    // ledger. This matches the locked worked example exactly:
    // service ₹800/Platform Fee ₹240/GST ₹40 -> customer refund
    // ₹600+₹180+₹30=₹810 (75%), retained ₹200+₹60+₹10=₹270 (25%).
    // ═══════════════════════════════════════════════════════════
    const draftN = await createDraftRefundPolicy({ adminId, rules: [{ minMinutes: 0, maxMinutes: 44, cancellationPercent: 25 }, { minMinutes: 45, maxMinutes: null, cancellationPercent: 0 }] });
    fixtureRefundPolicyIds.push(draftN._id);
    const publishedN = await publishRefundPolicy({ versionId: draftN._id, adminId });

    // Exactly the locked worked example's own numbers (₹800/₹240/₹40).
    const N_SERVICE = 80000, N_COMMISSION = 24000, N_GST = 4000;
    const N_CANCELLATION_PERCENT = 25;
    const N_REFUND_FRACTION = (100 - N_CANCELLATION_PERCENT) / 100; // 0.75 — what the CUSTOMER receives
    const N_SERVICE_REFUND = Math.round(N_SERVICE * N_REFUND_FRACTION);       // 60000 (₹600)
    const N_COMMISSION_REFUND = Math.round(N_COMMISSION * N_REFUND_FRACTION); // 18000 (₹180)
    const N_GST_REFUND = Math.round(N_GST * N_REFUND_FRACTION);              // 3000 (₹30)
    const N_TOTAL_REFUND = N_SERVICE_REFUND + N_COMMISSION_REFUND + N_GST_REFUND; // 81000 (₹810)
    const N_SERVICE_RETAINED = N_SERVICE - N_SERVICE_REFUND;       // 20000 (₹200) — salon
    const N_COMMISSION_RETAINED = N_COMMISSION - N_COMMISSION_REFUND; // 6000 (₹60) — Zemish
    const N_GST_RETAINED = N_GST - N_GST_REFUND;                   // 1000 (₹10) — GST ledger liability
    const N_TOTAL_RETAINED = N_SERVICE_RETAINED + N_COMMISSION_RETAINED + N_GST_RETAINED; // 27000 (₹270)
    check("N0. Sanity: refund (81000) + retained (27000) == original booking total (108000)", N_TOTAL_REFUND + N_TOTAL_RETAINED === N_SERVICE + N_COMMISSION + N_GST, { N_TOTAL_REFUND, N_TOTAL_RETAINED, total: N_SERVICE + N_COMMISSION + N_GST });

    // N1/N2 — CUSTOMER cancellation at a 25% cancellation hit
    const bN_customer = await mkBooking({ offsetMinutes: 20, serviceAmountInPaise: N_SERVICE, commissionAmountInPaise: N_COMMISSION, gstAmountInPaise: N_GST, razorpayOrderId: `order_${NAME_PREFIX}N_CUST_${Date.now()}` });
    const { split: splitN_customer } = await mkRevenueSplitWithGstSale(bN_customer);
    const rN_customer = await customerCancel(customerToken, bN_customer._id.toString());
    check("N1. 25% cancellation hit — customer cancellation -> 200, PARTIAL_REFUND label, customer receives EXACTLY 75% (₹810 total)", rN_customer.status === 200 && rN_customer.data.refundPolicy === "PARTIAL_REFUND" && rN_customer.data.refundAmountInPaise === N_TOTAL_REFUND, rN_customer.data);
    const walletTxnN_customer = await WalletTransaction.findOne({ bookingId: bN_customer._id, type: "REFUND" }).lean();
    check("N2. Customer path — EXACT per-component REFUND (75%): service=₹600, platform fee=₹180, GST=₹30", walletTxnN_customer?.metadata?.serviceRefundPaise === N_SERVICE_REFUND && walletTxnN_customer?.metadata?.commissionRefundPaise === N_COMMISSION_REFUND && walletTxnN_customer?.metadata?.gstRefundPaise === N_GST_REFUND, walletTxnN_customer?.metadata);
    const gstRevN_customer = await GSTLedger.findOne({ bookingId: bN_customer._id, ledgerType: GST_LEDGER_TYPE.REFUND_REVERSAL }).lean();
    const zemishRevN_customer = await ZemishRevenueReversalLedger.findOne({ bookingId: bN_customer._id }).lean();
    check("N3. Customer path — GST reversal (returned to customer) = ₹30 (75%), leaving GST ledger RETAINED liability = ₹10 (25%)", gstRevN_customer?.gstAmountInPaise === N_GST_REFUND && (splitN_customer.gstAmountInPaise - gstRevN_customer?.gstAmountInPaise) === N_GST_RETAINED, { gstRevN_customer, retained: splitN_customer.gstAmountInPaise - (gstRevN_customer?.gstAmountInPaise || 0) });
    check("N3b. Customer path — Zemish/Platform-Fee reversal (returned to customer) = ₹180 (75%), leaving Zemish RETAINED revenue = ₹60 (25%)", zemishRevN_customer?.reversedAmountInPaise === N_COMMISSION_REFUND && (splitN_customer.zemishRevenueInPaise - zemishRevN_customer?.reversedAmountInPaise) === N_COMMISSION_RETAINED, { zemishRevN_customer, retained: splitN_customer.zemishRevenueInPaise - (zemishRevN_customer?.reversedAmountInPaise || 0) });

    // N4/N5 — SALON (owner) cancellation at the SAME 25% cancellation hit, IDENTICAL outcome, no fault-based override
    const bN_owner = await mkBooking({ offsetMinutes: 20, serviceAmountInPaise: N_SERVICE, commissionAmountInPaise: N_COMMISSION, gstAmountInPaise: N_GST, razorpayOrderId: `order_${NAME_PREFIX}N_OWNER_${Date.now()}` });
    const { split: splitN_owner } = await mkRevenueSplitWithGstSale(bN_owner);
    const rN_owner = await ownerCancel(ownerToken, bN_owner._id.toString());
    check("N4. 25% cancellation hit — salon/owner cancellation -> 200, IDENTICAL label+amount to customer path (no fault-based override)", rN_owner.status === 200 && rN_owner.data.refundPolicy === rN_customer.data.refundPolicy && rN_owner.data.refundAmountInPaise === N_TOTAL_REFUND, rN_owner.data);
    const walletTxnN_owner = await WalletTransaction.findOne({ bookingId: bN_owner._id, type: "REFUND" }).lean();
    check("N5. Salon path — EXACT per-component REFUND amounts IDENTICAL to customer path (₹600/₹180/₹30)", walletTxnN_owner?.metadata?.serviceRefundPaise === N_SERVICE_REFUND && walletTxnN_owner?.metadata?.commissionRefundPaise === N_COMMISSION_REFUND && walletTxnN_owner?.metadata?.gstRefundPaise === N_GST_REFUND);
    const gstRevN_owner = await GSTLedger.findOne({ bookingId: bN_owner._id, ledgerType: GST_LEDGER_TYPE.REFUND_REVERSAL }).lean();
    const zemishRevN_owner = await ZemishRevenueReversalLedger.findOne({ bookingId: bN_owner._id }).lean();
    check("N6. Salon path — GST retained = ₹10, Zemish retained = ₹60 (identical to customer path)", (splitN_owner.gstAmountInPaise - (gstRevN_owner?.gstAmountInPaise || 0)) === N_GST_RETAINED && (splitN_owner.zemishRevenueInPaise - (zemishRevN_owner?.reversedAmountInPaise || 0)) === N_COMMISSION_RETAINED);

    // N7/N8 — ADMIN cancellation at the SAME 25% cancellation hit, IDENTICAL outcome
    if (indiaAdmin) {
      const indiaAdminToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });
      const bN_admin = await mkBooking({ offsetMinutes: 20, serviceAmountInPaise: N_SERVICE, commissionAmountInPaise: N_COMMISSION, gstAmountInPaise: N_GST, razorpayOrderId: `order_${NAME_PREFIX}N_ADMIN_${Date.now()}` });
      const { split: splitN_admin } = await mkRevenueSplitWithGstSale(bN_admin);
      const rN_admin = await authFetch(`/api/admin/bookings/${bN_admin._id}/cancel`, indiaAdminToken, { method: "PATCH", body: JSON.stringify({ reason: `${NAME_PREFIX}25pct admin test` }) });
      check("N7. 25% cancellation hit — admin cancellation -> 200, IDENTICAL label+amount to customer/salon paths (one global policy, no admin-specific override)", rN_admin.status === 200 && rN_admin.data.data?.status === "CANCELLED", rN_admin.data);
      const bN_adminAfter = await Booking.findById(bN_admin._id).lean();
      check("N7b. Admin path — booking froze refundFractionApplied=0.75 and refundAmountInPaise=81000 (customer receives 75%), identical to customer/salon paths", bN_adminAfter.refundFractionApplied === N_REFUND_FRACTION && bN_adminAfter.refundAmountInPaise === N_TOTAL_REFUND && bN_adminAfter.cancellationPolicy === "PARTIAL_REFUND", bN_adminAfter);
      const gstRevN_admin = await GSTLedger.findOne({ bookingId: bN_admin._id, ledgerType: GST_LEDGER_TYPE.REFUND_REVERSAL }).lean();
      const zemishRevN_admin = await ZemishRevenueReversalLedger.findOne({ bookingId: bN_admin._id }).lean();
      check("N8. Admin path — GST retained = ₹10, Zemish retained = ₹60 (identical to customer/salon paths)", (splitN_admin.gstAmountInPaise - (gstRevN_admin?.gstAmountInPaise || 0)) === N_GST_RETAINED && (splitN_admin.zemishRevenueInPaise - (zemishRevN_admin?.reversedAmountInPaise || 0)) === N_COMMISSION_RETAINED, { gstRevN_admin, zemishRevN_admin });
    } else {
      results.push("⚠️  N7/N7b/N8 SKIPPED — no real INDIA admin user available (same reason as Section M).");
    }

    // ═══════════════════════════════════════════════════════════
    // SECTION O — the TRUE gateway/Razorpay-source path, exercised
    // through the REAL RazorpayRefundService.completeRefund() code
    // path (not a simulated key) — proves wallet path and gateway
    // path produce EQUIVALENT GST + Zemish reversals (and therefore
    // equivalent RETAINED amounts) via the actual production entry
    // point each one uses, for the SAME 25% cancellation hit.
    // ═══════════════════════════════════════════════════════════
    const bGateway = await mkBooking({ offsetMinutes: 20, serviceAmountInPaise: N_SERVICE, commissionAmountInPaise: N_COMMISSION, gstAmountInPaise: N_GST, razorpayOrderId: `order_${NAME_PREFIX}GW_${Date.now()}` });
    const { split: splitGateway } = await mkRevenueSplitWithGstSale(bGateway);
    const gwRefundId = `rfnd_${NAME_PREFIX}GW_${Date.now()}`;
    const gwRefundDoc = await Refund.create({
      paymentId: `pay_${NAME_PREFIX}GW_${Date.now()}`,
      bookingId: bGateway._id,
      amountInPaise: N_TOTAL_REFUND, // 81000 — the customer's 75% refund of the total payment
      paymentAmountInPaise: bGateway.totalAmountInPaise, // 108000
      idempotencyKey: `booking-refund:${bGateway._id}`,
      razorpayRefundId: gwRefundId,
      refundStatus: "PENDING",
    });
    fixtureRefundIds.push(gwRefundDoc._id);
    await completeRefund({ refundDoc: gwRefundDoc, gatewayStatus: "processed", gatewayRefundId: gwRefundId });

    const gstRevGateway = await GSTLedger.findOne({ bookingId: bGateway._id, ledgerType: GST_LEDGER_TYPE.REFUND_REVERSAL }).lean();
    const zemishRevGateway = await ZemishRevenueReversalLedger.findOne({ bookingId: bGateway._id }).lean();
    check("O1. GATEWAY path (completeRefund, real Razorpay-style refund completion) -> GST reversal = ₹30 (75%), retained GST liability = ₹10 (25%) — matches the WALLET path exactly", gstRevGateway?.gstAmountInPaise === N_GST_REFUND && (splitGateway.gstAmountInPaise - gstRevGateway?.gstAmountInPaise) === N_GST_RETAINED && gstRevGateway?.refundId === gwRefundId, gstRevGateway);
    check("O2. GATEWAY path -> Zemish/Platform-Fee reversal = ₹180 (75%), retained Zemish revenue = ₹60 (25%) — matches the WALLET path exactly", zemishRevGateway?.reversedAmountInPaise === N_COMMISSION_REFUND && (splitGateway.zemishRevenueInPaise - zemishRevGateway?.reversedAmountInPaise) === N_COMMISSION_RETAINED && zemishRevGateway?.reversalKey === gwRefundId, zemishRevGateway);

    // O3 — duplicate gateway completion (e.g. a replayed webhook) must
    // NOT create a second reversal row.
    const gstCountGatewayBefore = await GSTLedger.countDocuments({ bookingId: bGateway._id });
    const zemishCountGatewayBefore = await ZemishRevenueReversalLedger.countDocuments({ bookingId: bGateway._id });
    await completeRefund({ refundDoc: gwRefundDoc, gatewayStatus: "processed", gatewayRefundId: gwRefundId });
    const gstCountGatewayAfter = await GSTLedger.countDocuments({ bookingId: bGateway._id });
    const zemishCountGatewayAfter = await ZemishRevenueReversalLedger.countDocuments({ bookingId: bGateway._id });
    check("O3. Replaying the SAME gateway refund completion is idempotent — no duplicate GST/Zemish reversal rows", gstCountGatewayBefore === gstCountGatewayAfter && zemishCountGatewayBefore === zemishCountGatewayAfter, { gstCountGatewayBefore, gstCountGatewayAfter, zemishCountGatewayBefore, zemishCountGatewayAfter });

    // ═══════════════════════════════════════════════════════════
    // SECTION P — refundPolicyVersionRef/refundFractionApplied cannot
    // be overwritten by a LATER flow, and a duplicate REAL refund
    // execution (not just a duplicate raw reversal call) cannot create
    // duplicate wallet credits or duplicate reversal ledger entries.
    // Reuses bWithSplit (Section E), already cancelled under
    // `published1` at 50% — several policy publishes/retires have
    // happened since (Sections H, M, N) without touching it.
    // ═══════════════════════════════════════════════════════════
    const bWithSplitSnapshotBefore = await Booking.findById(bWithSplit._id).select("refundPolicyVersionRef refundFractionApplied cancellationPolicy refundAmountInPaise").lean();
    const walletTxnCountBefore = await WalletTransaction.countDocuments({ bookingId: bWithSplit._id, type: "REFUND" });

    // A genuine "later flow" — the real, exported Support-triggered
    // completion service, not this script's own test helper.
    const laterFlowResult = await issueRefundForCancelledBooking({ bookingId: bWithSplit._id, triggeredBy: "ADMIN", triggeredById: adminId });
    check("P1. A later flow (RefundExecutionService, the real Support-completion service) on an already-refunded booking reports alreadyIssued=true — no new refund issued", laterFlowResult.alreadyIssued === true, laterFlowResult);

    const bWithSplitSnapshotAfter = await Booking.findById(bWithSplit._id).select("refundPolicyVersionRef refundFractionApplied cancellationPolicy refundAmountInPaise").lean();
    check("P2. refundPolicyVersionRef and refundFractionApplied are BYTE-IDENTICAL after the later flow ran — never overwritten by any later flow", JSON.stringify(bWithSplitSnapshotBefore) === JSON.stringify(bWithSplitSnapshotAfter), { before: bWithSplitSnapshotBefore, after: bWithSplitSnapshotAfter });

    const walletTxnCountAfter = await WalletTransaction.countDocuments({ bookingId: bWithSplit._id, type: "REFUND" });
    const gstCountPBefore = await GSTLedger.countDocuments({ bookingId: bWithSplit._id, ledgerType: GST_LEDGER_TYPE.REFUND_REVERSAL });
    const zemishCountPBefore = await ZemishRevenueReversalLedger.countDocuments({ bookingId: bWithSplit._id });
    check("P3. A duplicate REAL refund execution attempt creates NO second WalletTransaction (still exactly 1)", walletTxnCountBefore === 1 && walletTxnCountAfter === 1, { walletTxnCountBefore, walletTxnCountAfter });
    check("P4. ...and NO duplicate GST/Zemish reversal ledger rows either (still exactly 1 each)", gstCountPBefore === 1 && zemishCountPBefore === 1, { gstCountPBefore, zemishCountPBefore });

    // ═══════════════════════════════════════════════════════════
    // SECTION Q — OWNERSHIP ALLOCATION PROOF (not just refund-amount
    // math). For a given CANCELLATION % (the admin-configured
    // retention/penalty share — NOT the customer refund %), proves
    // WHERE the retained money actually sits:
    //   - SALON retains the service component — proven against
    //     SalonEarnings.pendingBalanceInPaise itself (the real wallet
    //     balance), not a derived number: credit the FULL service
    //     amount (simulating the real confirm-time credit), cancel,
    //     and the balance delta must equal exactly the retained share.
    //   - ZEMISH retains the Platform Fee — proven as
    //     RevenueSplit.zemishRevenueInPaise (the original, immutable
    //     SALE amount) MINUS ZemishRevenueReversalLedger.reversedAmountInPaise
    //     (the new REFUND_REVERSAL row) — the standard SALE-minus-
    //     REVERSAL net-liability ledger pattern already proven for GST.
    //   - GST ledger retains/still owes the GST on the non-refunded
    //     portion — proven the identical way: GSTLedger SALE.gstAmountInPaise
    //     minus REFUND_REVERSAL.gstAmountInPaise.
    // Run across all three cancellation paths, at both a 25% and a
    // 50% CANCELLATION HIT, with an explicit refund+retained==total
    // invariant check at each point.
    // ═══════════════════════════════════════════════════════════
    const verifyOwnershipAllocation = async ({ cancellationPercent, path, service, commission, gst, offsetMinutes }) => {
      const refundFraction = (100 - cancellationPercent) / 100; // what the CUSTOMER receives
      const serviceRefund = Math.round(service * refundFraction);
      const commissionRefund = Math.round(commission * refundFraction);
      const gstRefund = Math.round(gst * refundFraction);
      const serviceRetained = service - serviceRefund;
      const commissionRetained = commission - commissionRefund;
      const gstRetained = gst - gstRefund;
      const refundPercent = 100 - cancellationPercent;
      const label = `${cancellationPercent}%cancel/${path}`;

      const booking = await mkBooking({ offsetMinutes, serviceAmountInPaise: service, commissionAmountInPaise: commission, gstAmountInPaise: gst, razorpayOrderId: `order_${NAME_PREFIX}OWN_${path}_${cancellationPercent}_${Date.now()}` });
      const { split } = await mkRevenueSplitWithGstSale(booking);

      // Simulate the ORIGINAL confirm-time salon credit (the real
      // confirmBooking flow's own WalletBalanceService.creditPending
      // call, booking.controller.js:1187) — full service amount into
      // the salon's own PENDING wallet balance. This is what the
      // retained share below is measured against.
      const pendBefore = (await SalonEarnings.findOne({ salonId: salon._id }).lean()).pendingBalanceInPaise;
      await withSession((session) => WalletBalanceService.creditPending({
        salonId: salon._id, amountInPaise: service, action: "BOOKING_SETTLEMENT", refType: "BOOKING", refId: booking._id,
        idempotencyKey: `${NAME_PREFIX}credit:${booking._id}`, session, triggeredBy: "SYSTEM",
      }));

      let cancelResp;
      if (path === "customer") {
        cancelResp = await customerCancel(customerToken, booking._id.toString());
      } else if (path === "salon") {
        cancelResp = await ownerCancel(ownerToken, booking._id.toString());
      } else if (indiaAdmin) {
        const indiaAdminToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });
        cancelResp = await authFetch(`/api/admin/bookings/${booking._id}/cancel`, indiaAdminToken, { method: "PATCH", body: JSON.stringify({ reason: `${NAME_PREFIX}ownership test` }) });
      } else {
        results.push(`⚠️  Q-${label} SKIPPED — no real INDIA admin available.`);
        return;
      }
      // Read from the DB directly (not the HTTP response body), since
      // the admin endpoint's response shape doesn't echo refundAmountInPaise
      // the way the customer/owner endpoints do — the stored booking is
      // the one consistent source across all three paths.
      const bookingAfterCancel = await Booking.findById(booking._id).select("status refundAmountInPaise").lean();
      const totalRefund = serviceRefund + commissionRefund + gstRefund;
      const totalRetained = serviceRetained + commissionRetained + gstRetained;
      check(`Q-${label} — cancellation succeeds (200); a ${cancellationPercent}% cancellation hit means the customer receives exactly ${refundPercent}% (₹${totalRefund / 100} of ₹${(service + commission + gst) / 100})`, cancelResp.status === 200 && bookingAfterCancel.status === "CANCELLED" && bookingAfterCancel.refundAmountInPaise === totalRefund, { cancelRespStatus: cancelResp.status, bookingAfterCancel });
      check(`Q-${label} — INVARIANT: refund (₹${totalRefund / 100}) + retained (₹${totalRetained / 100}) == original booking total (₹${(service + commission + gst) / 100})`, totalRefund + totalRetained === service + commission + gst);

      const pendAfterCancel = (await SalonEarnings.findOne({ salonId: salon._id }).lean()).pendingBalanceInPaise;
      const salonNetRetained = pendAfterCancel - pendBefore;

      const gstRev = await GSTLedger.findOne({ bookingId: booking._id, ledgerType: GST_LEDGER_TYPE.REFUND_REVERSAL }).lean();
      const zemishRev = await ZemishRevenueReversalLedger.findOne({ bookingId: booking._id }).lean();
      const gstNetLiability = split.gstAmountInPaise - (gstRev?.gstAmountInPaise || 0);
      const zemishNetRetained = split.zemishRevenueInPaise - (zemishRev?.reversedAmountInPaise || 0);

      check(`Q-${label} — SALON retains exactly ${cancellationPercent}% of SERVICE (₹${serviceRetained / 100}) in its OWN SalonEarnings.pendingBalanceInPaise (real wallet balance delta, not a derived number)`, salonNetRetained === serviceRetained, { pendBefore, pendAfterCancel, serviceRetained, salonNetRetained });
      check(`Q-${label} — ZEMISH retains exactly ${cancellationPercent}% of PLATFORM FEE (₹${commissionRetained / 100}) — RevenueSplit.zemishRevenueInPaise MINUS ZemishRevenueReversalLedger.reversedAmountInPaise`, zemishNetRetained === commissionRetained, { zemishRevenueInPaise: split.zemishRevenueInPaise, reversed: zemishRev?.reversedAmountInPaise ?? 0, zemishNetRetained, commissionRetained });
      check(`Q-${label} — GST LEDGER correctly represents the RETAINED liability at exactly ${cancellationPercent}% (₹${gstRetained / 100}) — SALE.gstAmountInPaise MINUS REFUND_REVERSAL.gstAmountInPaise`, gstNetLiability === gstRetained, { saleGst: split.gstAmountInPaise, reversedGst: gstRev?.gstAmountInPaise ?? 0, gstNetLiability, gstRetained });
    };

    // 25% cancellation hit — reuses the CURRENTLY published policy
    // (publishedN, still active: 0-44min -> cancellationPercent:25,
    // nothing has republished since Section N). Customer receives 75%.
    for (const path of ["customer", "salon", "admin"]) {
      await verifyOwnershipAllocation({ cancellationPercent: 25, path, service: 80000, commission: 24000, gst: 4000, offsetMinutes: 20 });
    }

    // 50% cancellation hit — needs a freshly published
    // reproduction-ladder policy (0-29min->100% cancellation,
    // 30-119min->50%, 120+min->0%) so a 60-minute-offset booking
    // resolves to exactly a 50% cancellation hit (symmetric — customer
    // also receives 50%).
    const draftQ50 = await createDraftRefundPolicy({ adminId, rules: [{ minMinutes: 0, maxMinutes: 29, cancellationPercent: 100 }, { minMinutes: 30, maxMinutes: 119, cancellationPercent: 50 }, { minMinutes: 120, maxMinutes: null, cancellationPercent: 0 }] });
    fixtureRefundPolicyIds.push(draftQ50._id);
    await publishRefundPolicy({ versionId: draftQ50._id, adminId });
    for (const path of ["customer", "salon", "admin"]) {
      await verifyOwnershipAllocation({ cancellationPercent: 50, path, service: 60000, commission: 18000, gst: 3000, offsetMinutes: 60 });
    }

    // ═══════════════════════════════════════════════════════════
    // CLEANUP — restore to exactly the pre-test state.
    // ═══════════════════════════════════════════════════════════
    await GSTLedger.collection.deleteMany({ bookingId: { $in: fixtureBookingIds } });
    await ZemishRevenueReversalLedger.collection.deleteMany({ bookingId: { $in: fixtureBookingIds } });
    await RevenueSplit.collection.deleteMany({ _id: { $in: fixtureRevenueSplitIds } });
    await WalletTransaction.deleteMany({ bookingId: { $in: fixtureBookingIds } });
    await Refund.deleteMany({ _id: { $in: fixtureRefundIds } });
    await Booking.deleteMany({ _id: { $in: fixtureBookingIds } });
    await SalonEarnings.deleteMany({ salonId: { $in: fixtureSalonIds } });
    await Salon.deleteMany({ _id: { $in: fixtureSalonIds } });
    await User.deleteMany({ _id: { $in: fixtureUserIds } });
    await RefundPolicyVersion.deleteMany({ _id: { $in: fixtureRefundPolicyIds } });

    const after = {
      RefundPolicyVersion: await RefundPolicyVersion.countDocuments({}),
      Booking: await Booking.countDocuments({}),
      Refund: await Refund.countDocuments({}),
      Transaction: await Transaction.countDocuments({}),
      WalletTransaction: await WalletTransaction.countDocuments({}),
      GSTLedger: await GSTLedger.countDocuments({}),
      RevenueSplit: await RevenueSplit.countDocuments({}),
      ZemishRevenueReversalLedger: await ZemishRevenueReversalLedger.countDocuments({}),
      TerritoryRevenueSplit: await TerritoryRevenueSplit.countDocuments({}),
      TerritoryRevenueLedger: await TerritoryRevenueLedger.countDocuments({}),
    };
    results.push(`ℹ️  AFTER counts: ${JSON.stringify(after)}`);
    check("Z. All counts returned exactly to their BEFORE values", JSON.stringify(before) === JSON.stringify(after), { before, after });
  } catch (err) {
    console.error("FATAL ERROR DURING REFUND & CANCELLATION POLICY E2E:", err);
    fail++;
    results.push(`❌ FATAL: ${err.message}`);
    try {
      await GSTLedger.collection.deleteMany({ bookingId: { $in: fixtureBookingIds } });
      await ZemishRevenueReversalLedger.collection.deleteMany({ bookingId: { $in: fixtureBookingIds } });
      await RevenueSplit.collection.deleteMany({ _id: { $in: fixtureRevenueSplitIds } });
      await WalletTransaction.deleteMany({ bookingId: { $in: fixtureBookingIds } });
      await Refund.deleteMany({ _id: { $in: fixtureRefundIds } });
      await Booking.deleteMany({ _id: { $in: fixtureBookingIds } });
      await SalonEarnings.deleteMany({ salonId: { $in: fixtureSalonIds } });
      await Salon.deleteMany({ _id: { $in: fixtureSalonIds } });
      await User.deleteMany({ _id: { $in: fixtureUserIds } });
      await RefundPolicyVersion.deleteMany({ _id: { $in: fixtureRefundPolicyIds } });
      results.push("✅ Best-effort cleanup after failure completed (own fixtures only)");
    } catch (cleanupErr) {
      results.push(`❌ Best-effort cleanup ALSO failed: ${cleanupErr.message}`);
    }
  } finally {
    server.close();
    await mongoose.connection.close();
  }

  console.log("\n" + results.join("\n"));
  console.log(`\nREFUND-CANCELLATION-POLICY-E2E: ${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail === 0 ? 0 : 1);
};

run();
