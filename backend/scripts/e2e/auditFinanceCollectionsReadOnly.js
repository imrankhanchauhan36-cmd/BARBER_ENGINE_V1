/**
 * BARBER_ENGINE_V1 — FINAL FINANCE AUDIT
 * backend/scripts/e2e/auditFinanceCollectionsReadOnly.js
 *
 * STRICTLY READ-ONLY. No .create(/.save(/.update*(/.delete*(/$set
 * anywhere in this file — only countDocuments/aggregate($match,$group,
 * $sample)/distinct. Produces real collection counts + a few targeted
 * reconciliation checks for the Phase "Final Finance Audit" report.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/auditFinanceCollectionsReadOnly.js
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../../config/db.js";

import Booking from "../../models/Booking.js";
import Transaction from "../../models/Transaction.js";
import WalletTransaction from "../../models/WalletTransaction.js";
import WalletLedger from "../../models/WalletLedger.js";
import SalonEarnings from "../../models/SalonEarnings.js";
import PayoutRequest from "../../models/PayoutRequest.js";
import GstPolicyVersion from "../../models/GstPolicyVersion.js";
import Salon from "../../models/Salon.js";
import AcquisitionClaim from "../../modules/fieldAgent/models/AcquisitionClaim.js";
import AcquisitionEarningProgress from "../../modules/fieldAgent/models/AcquisitionEarningProgress.js";
import FieldAgentEarningLedger from "../../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import FieldAgentEarningPolicyGap from "../../modules/fieldAgent/models/FieldAgentEarningPolicyGap.js";
import FieldAgentPayoutRequest from "../../modules/fieldAgent/models/FieldAgentPayoutRequest.js";
import CommercialPolicyVersion from "../../modules/fieldAgent/models/CommercialPolicyVersion.js";
import CommercialPolicyOverride from "../../modules/fieldAgent/models/CommercialPolicyOverride.js";
import GenericPayoutRequest from "../../modules/payout/models/GenericPayoutRequest.js";
import RevenueSplit from "../../modules/finance/models/RevenueSplit.js";
import GSTLedger from "../../modules/finance/models/GSTLedger.js";
import TerritoryRevenueLedger from "../../modules/finance/models/TerritoryRevenueLedger.js";

const NAME_PREFIX_PATTERNS = [/^ZE2E_/i, /ZE2E/i, /TEST/i];

const section = (title) => console.log(`\n${"=".repeat(10)} ${title} ${"=".repeat(10)}`);

const run = async () => {
  await connectDB();

  section("BOOKING");
  const bookingTotal = await Booking.countDocuments({});
  const bookingByStatus = await Booking.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
  console.log("total:", bookingTotal);
  console.log("by status:", bookingByStatus);
  const bookingsWithGst = await Booking.countDocuments({ gstAmountInPaise: { $ne: null } });
  console.log("bookings with a non-null gstAmountInPaise (GST feature in effect):", bookingsWithGst);
  const likelyTestBookings = await Booking.countDocuments({
    $or: NAME_PREFIX_PATTERNS.map((re) => ({ "statusHistory.meta.note": re })),
  });
  console.log("bookings matching obvious test-marker patterns (heuristic, may be 0 if none tagged):", likelyTestBookings);

  section("TRANSACTION");
  const txnTotal = await Transaction.countDocuments({});
  const txnByStatus = await Transaction.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
  const txnByProvider = await Transaction.aggregate([{ $group: { _id: "$provider", count: { $sum: 1 } } }]);
  console.log("total:", txnTotal, "by status:", txnByStatus, "by provider:", txnByProvider);
  const bookingsWithoutTxn = bookingTotal - txnTotal >= 0 ? null : null;
  const orphanTxn = await Transaction.aggregate([
    { $lookup: { from: "bookings", localField: "bookingId", foreignField: "_id", as: "b" } },
    { $match: { b: { $size: 0 } } },
    { $count: "orphanCount" },
  ]);
  console.log("Transactions whose bookingId no longer resolves to a Booking (orphans):", orphanTxn[0]?.orphanCount || 0);

  section("WALLET TRANSACTION (customer wallet)");
  console.log("total:", await WalletTransaction.countDocuments({}));

  section("WALLET LEDGER (salon + field agent wallets)");
  const ledgerTotal = await WalletLedger.countDocuments({});
  const ledgerByOwnerType = await WalletLedger.aggregate([{ $group: { _id: "$ownerType", count: { $sum: 1 } } }]);
  console.log("total:", ledgerTotal, "by ownerType:", ledgerByOwnerType);

  section("SALON EARNINGS (wallet balances, Salon + FieldAgent entities)");
  const walletTotal = await SalonEarnings.countDocuments({});
  const walletByEntityType = await SalonEarnings.aggregate([{ $group: { _id: "$entityType", count: { $sum: 1 } } }]);
  const walletBalanceSums = await SalonEarnings.aggregate([
    { $group: {
      _id: null,
      totalAvailable: { $sum: "$availableBalanceInPaise" },
      totalPending: { $sum: "$pendingBalanceInPaise" },
      totalLocked: { $sum: "$lockedBalanceInPaise" },
      totalProcessing: { $sum: "$processingBalanceInPaise" },
      totalLifetimeEarnings: { $sum: "$lifetimeEarningsInPaise" },
      totalLifetimeWithdrawals: { $sum: "$lifetimeWithdrawalsInPaise" },
    } },
  ]);
  console.log("total wallets:", walletTotal, "by entityType:", walletByEntityType);
  console.log("balance sums (paise):", walletBalanceSums[0]);
  // Cross-check: does SUM(ledger CREDIT-DEBIT per bucket) match the stored bucket balances?
  const ledgerBucketRecon = await WalletLedger.aggregate([
    { $group: {
      _id: { bucket: "$bucket", direction: "$direction" },
      total: { $sum: "$amountInPaise" },
    } },
  ]);
  console.log("ledger sums by bucket+direction (for manual bucket reconciliation):", ledgerBucketRecon);

  section("PAYOUT REQUEST (salon, legacy model)");
  console.log("total:", await PayoutRequest.countDocuments({}));

  section("FIELD AGENT PAYOUT REQUEST");
  const faPayoutTotal = await FieldAgentPayoutRequest.countDocuments({});
  const faPayoutByStatus = await FieldAgentPayoutRequest.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
  console.log("total:", faPayoutTotal, "by status:", faPayoutByStatus);

  section("GENERIC PAYOUT REQUEST (unified engine)");
  console.log("total:", await GenericPayoutRequest.countDocuments({}));

  section("GST POLICY VERSION");
  const gstPolicies = await GstPolicyVersion.find({}).select("ratePercent status publishedAt retiredAt").lean();
  console.log("all GST policy versions:", gstPolicies);

  section("REVENUE SPLIT (per-booking finance snapshot)");
  const revenueSplitTotal = await RevenueSplit.countDocuments({});
  console.log("total:", revenueSplitTotal);
  const revenueSplitVsRazorpayBookings = await Booking.countDocuments({ razorpayOrderId: { $ne: null }, status: { $in: ["CONFIRMED", "CHECKED_IN", "ONGOING", "COMPLETED"] } });
  console.log("Razorpay-paid, non-HOLD bookings (expected upper bound for RevenueSplit count):", revenueSplitVsRazorpayBookings);
  // Inconsistency check flagged in the audit: does any RevenueSplit's
  // gstAmountInPaise fail to reconcile against taxableValue recorded on
  // its own GSTLedger SALE row (platformFeeInPaise vs service+fee base)?
  const gstLedgerSample = await GSTLedger.aggregate([
    { $match: { ledgerType: "SALE" } },
    { $lookup: { from: "revenuesplits", localField: "revenueSplitId", foreignField: "_id", as: "split" } },
    { $unwind: "$split" },
    { $project: {
      gstAmountInPaise: 1,
      gstRate: 1,
      taxableValueInPaise: 1,
      recomputedFromTaxableValue: { $round: [{ $multiply: [{ $divide: ["$gstRate", 100] }, "$taxableValueInPaise"] }, 0] },
      actualBaseUsed: { $add: ["$split.serviceAmountInPaise", "$split.platformFeeInPaise"] },
    } },
    { $limit: 5 },
  ]);
  console.log("GSTLedger SALE rows — taxableValueInPaise vs actual (service+fee) base used to compute gstAmountInPaise (sample up to 5):", gstLedgerSample);

  section("GST LEDGER");
  const gstLedgerTotal = await GSTLedger.countDocuments({});
  const gstLedgerByType = await GSTLedger.aggregate([{ $group: { _id: "$ledgerType", count: { $sum: 1 }, totalGst: { $sum: "$gstAmountInPaise" } } }]);
  console.log("total:", gstLedgerTotal, "by type:", gstLedgerByType);

  section("TERRITORY REVENUE LEDGER");
  console.log("total:", await TerritoryRevenueLedger.countDocuments({}));

  section("ACQUISITION CLAIM");
  const claimTotal = await AcquisitionClaim.countDocuments({});
  const claimByStatus = await AcquisitionClaim.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
  console.log("total:", claimTotal, "by status:", claimByStatus);

  section("ACQUISITION EARNING PROGRESS");
  const progressTotal = await AcquisitionEarningProgress.countDocuments({});
  const progressByStatus = await AcquisitionEarningProgress.aggregate([{ $group: { _id: "$status", count: { $sum: 1 }, totalTarget: { $sum: "$targetInPaise" }, totalEarned: { $sum: "$earnedInPaise" } } }]);
  console.log("total:", progressTotal, "by status:", progressByStatus);

  section("FIELD AGENT EARNING LEDGER");
  const faLedgerTotal = await FieldAgentEarningLedger.countDocuments({});
  const faLedgerByOutcome = await FieldAgentEarningLedger.aggregate([{ $group: { _id: "$creditOutcome", count: { $sum: 1 }, totalCredited: { $sum: "$creditedAmountInPaise" } } }]);
  console.log("total:", faLedgerTotal, "by outcome:", faLedgerByOutcome);
  // Structural invariant check (per that file's own header):
  // SUM(ledger.creditedAmountInPaise) per claim === progress.earnedInPaise
  const ledgerSumByClaim = await FieldAgentEarningLedger.aggregate([
    { $match: { entitlementType: "ACQUISITION", acquisitionClaimRef: { $ne: null } } },
    { $group: { _id: "$acquisitionClaimRef", sumCredited: { $sum: "$creditedAmountInPaise" } } },
  ]);
  let claimMismatches = 0;
  for (const row of ledgerSumByClaim) {
    const progress = await AcquisitionEarningProgress.findOne({ acquisitionClaimRef: row._id }).select("earnedInPaise").lean();
    if (!progress || progress.earnedInPaise !== row.sumCredited) claimMismatches++;
  }
  console.log(`Claims checked for SUM(ledger)===progress.earnedInPaise invariant: ${ledgerSumByClaim.length}, mismatches found: ${claimMismatches}`);

  section("FIELD AGENT EARNING POLICY GAP (open gaps)");
  const gapTotal = await FieldAgentEarningPolicyGap.countDocuments({});
  const gapByStatus = await FieldAgentEarningPolicyGap.aggregate([{ $group: { _id: { type: "$gapType", status: "$status" }, count: { $sum: 1 } } }]);
  console.log("total:", gapTotal, "by type+status:", gapByStatus);

  section("COMMERCIAL POLICY VERSION / OVERRIDE");
  const cpvAll = await CommercialPolicyVersion.find({}).select("status publishedAt retiredAt acquisitionEarningTargetInPaise acquisitionAgentCommissionPercent territoryPartnerCommissionPercent").lean();
  console.log("all national policy versions:", cpvAll);
  console.log("override total:", await CommercialPolicyOverride.countDocuments({}));

  section("TEST-DATA HEURISTIC SCAN");
  const testUserBookings = await Booking.aggregate([
    { $lookup: { from: "users", localField: "userRef", foreignField: "_id", as: "u" } },
    { $unwind: { path: "$u", preserveNullAndEmptyArrays: true } },
    { $match: { $or: [
      { "u.name": { $regex: /ZE2E|TEST/i } },
      { "u.phone": { $regex: /^7000000|^9000000/i } },
    ] } },
    { $count: "count" },
  ]);
  console.log("bookings whose customer looks like a disposable test fixture (name/phone heuristic):", testUserBookings[0]?.count || 0);

  const testSalonBookings = await Booking.aggregate([
    { $lookup: { from: "salons", localField: "salonRef", foreignField: "_id", as: "s" } },
    { $unwind: { path: "$s", preserveNullAndEmptyArrays: true } },
    { $match: { "s.basicInfo.shopName": { $regex: /ZE2E|TEST/i } } },
    { $count: "count" },
  ]);
  console.log("bookings against a ZE2E/TEST-named salon (heuristic):", testSalonBookings[0]?.count || 0);

  await mongoose.connection.close();
};

run().catch(async (err) => {
  console.error("AUDIT FAILED:", err);
  try { await mongoose.connection.close(); } catch {}
  process.exit(1);
});
