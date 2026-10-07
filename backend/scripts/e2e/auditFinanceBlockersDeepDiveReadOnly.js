/**
 * BARBER_ENGINE_V1 — FINANCE AUDIT STEP 1 (blocker resolution)
 * backend/scripts/e2e/auditFinanceBlockersDeepDiveReadOnly.js
 *
 * STRICTLY READ-ONLY. No .create(/.save(/.update*(/.delete*(/$set
 * anywhere in this file — only find/countDocuments/aggregate/distinct.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/auditFinanceBlockersDeepDiveReadOnly.js
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../../config/db.js";

import Booking from "../../models/Booking.js";
import Transaction from "../../models/Transaction.js";
import WalletTransaction from "../../models/WalletTransaction.js";
import WalletLedger from "../../models/WalletLedger.js";
import SalonEarnings from "../../models/SalonEarnings.js";
import Salon from "../../models/Salon.js";
import Refund from "../../models/Refund.js";
import RevenueSplit from "../../modules/finance/models/RevenueSplit.js";
import GSTLedger from "../../modules/finance/models/GSTLedger.js";
import AcquisitionClaim from "../../modules/fieldAgent/models/AcquisitionClaim.js";
import AcquisitionEarningProgress from "../../modules/fieldAgent/models/AcquisitionEarningProgress.js";
import FieldAgentEarningLedger from "../../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import FieldAgentEarningPolicyGap from "../../modules/fieldAgent/models/FieldAgentEarningPolicyGap.js";
import CommercialPolicyVersion from "../../modules/fieldAgent/models/CommercialPolicyVersion.js";
import CommercialPolicyOverride from "../../modules/fieldAgent/models/CommercialPolicyOverride.js";

const section = (t) => console.log(`\n${"=".repeat(12)} ${t} ${"=".repeat(12)}`);
const j = (x) => JSON.stringify(x, null, 0);

const run = async () => {
  await connectDB();

  // ════════════════════════════════════════════════════════════
  // PART A — GSTLEDGER
  // ════════════════════════════════════════════════════════════
  section("PART A — GSTLedger SALE rows, full detail");
  const saleRows = await GSTLedger.find({ ledgerType: "SALE" }).lean();
  for (const row of saleRows) {
    const split = row.revenueSplitId ? await RevenueSplit.findById(row.revenueSplitId).lean() : null;
    const booking = await Booking.findById(row.bookingId).select("serviceAmountInPaise commissionAmountInPaise gstAmountInPaise gstRatePercent totalAmountInPaise").lean();
    const expectedGstFromStoredTaxable = Math.round((row.taxableValueInPaise * row.gstRate) / 100);
    const actualBaseUsedByBooking = booking ? booking.serviceAmountInPaise + booking.commissionAmountInPaise : null;
    const reconciles = expectedGstFromStoredTaxable === row.gstAmountInPaise;
    console.log(j({
      _id: String(row._id),
      bookingId: String(row.bookingId),
      revenueSplitId: row.revenueSplitId ? String(row.revenueSplitId) : null,
      taxableValueInPaise: row.taxableValueInPaise,
      gstRate: row.gstRate,
      gstAmountInPaise: row.gstAmountInPaise,
      expectedGstFromStoredTaxable,
      reconciles,
      bookingServiceAmountInPaise: booking?.serviceAmountInPaise ?? null,
      bookingPlatformFeeInPaise: booking?.commissionAmountInPaise ?? null,
      bookingGstAmountInPaise: booking?.gstAmountInPaise ?? null,
      actualBaseUsedByBooking,
      splitPlatformFeeInPaise: split?.platformFeeInPaise ?? null,
      splitGstAmountInPaise: split?.gstAmountInPaise ?? null,
    }));
  }

  // ════════════════════════════════════════════════════════════
  // PART B — lifetimeEarningsInPaise, per-wallet reconciliation
  // ════════════════════════════════════════════════════════════
  section("PART B — SalonEarnings wallets, full reconciliation");
  const wallets = await SalonEarnings.find({}).lean();
  for (const w of wallets) {
    const ledgerRows = await WalletLedger.find({ ownerType: w.entityType, ownerId: w.entityId }).lean();
    const totalCredit = ledgerRows.filter((r) => r.direction === "CREDIT").reduce((s, r) => s + r.amountInPaise, 0);
    const totalDebit = ledgerRows.filter((r) => r.direction === "DEBIT").reduce((s, r) => s + r.amountInPaise, 0);
    const netSumAllBuckets = w.availableBalanceInPaise + w.pendingBalanceInPaise + w.lockedBalanceInPaise + w.processingBalanceInPaise;
    console.log(j({
      entityType: w.entityType,
      entityId: String(w.entityId),
      salonId: w.salonId ? String(w.salonId) : null,
      availableBalanceInPaise: w.availableBalanceInPaise,
      pendingBalanceInPaise: w.pendingBalanceInPaise,
      lockedBalanceInPaise: w.lockedBalanceInPaise,
      processingBalanceInPaise: w.processingBalanceInPaise,
      netSumAllBuckets,
      lifetimeEarningsInPaise: w.lifetimeEarningsInPaise,
      lifetimeWithdrawalsInPaise: w.lifetimeWithdrawalsInPaise,
      ledgerRowCount: ledgerRows.length,
      totalLedgerCredit: totalCredit,
      totalLedgerDebit: totalDebit,
      netCreditMinusDebit: totalCredit - totalDebit,
      netMatchesCurrentBalance: (totalCredit - totalDebit) === netSumAllBuckets,
    }));
  }

  // ════════════════════════════════════════════════════════════
  // PART C — Commercial Policy
  // ════════════════════════════════════════════════════════════
  section("PART C — CommercialPolicyVersion / Override (ALL rows, any status)");
  const cpv = await CommercialPolicyVersion.find({}).lean();
  console.log(`CommercialPolicyVersion total: ${cpv.length}`);
  console.log(j(cpv));
  const cpo = await CommercialPolicyOverride.find({}).lean();
  console.log(`CommercialPolicyOverride total: ${cpo.length}`);
  console.log(j(cpo));

  // ════════════════════════════════════════════════════════════
  // PART D — Field Agent orphan financial data, full dependency graph
  // ════════════════════════════════════════════════════════════
  section("PART D — AcquisitionEarningProgress full dependency graph");
  const progresses = await AcquisitionEarningProgress.find({}).lean();
  for (const p of progresses) {
    const claim = await AcquisitionClaim.findById(p.acquisitionClaimRef).lean();
    const salon = claim ? await Salon.findById(claim.salonRef).select("basicInfo.shopName approval.status isDeleted").lean() : null;
    const ledgerRows = await FieldAgentEarningLedger.find({ acquisitionClaimRef: p.acquisitionClaimRef }).lean();
    const ledgerSum = ledgerRows.reduce((s, r) => s + (r.creditedAmountInPaise || 0), 0);
    const gaps = await FieldAgentEarningPolicyGap.find({ acquisitionClaimRef: p.acquisitionClaimRef }).select("gapType status referenceKey").lean();
    console.log(j({
      progressId: String(p._id),
      acquisitionClaimRef: String(p.acquisitionClaimRef),
      claimExists: !!claim,
      claimStatus: claim?.status ?? null,
      claimSalonRef: claim ? String(claim.salonRef) : null,
      salonExists: !!salon,
      salonShopName: salon?.basicInfo?.shopName ?? null,
      fieldAgentRef: claim ? String(claim.fieldAgentRef) : null,
      targetInPaise: p.targetInPaise,
      earnedInPaise: p.earnedInPaise,
      progressStatus: p.status,
      ledgerRowCount: ledgerRows.length,
      ledgerSum,
      difference: p.earnedInPaise - ledgerSum,
      policyGaps: gaps.map((g) => ({ gapType: g.gapType, status: g.status })),
    }));
  }

  section("PART D — FieldAgentEarningLedger full detail (all rows)");
  const allLedger = await FieldAgentEarningLedger.find({}).lean();
  for (const row of allLedger) {
    const booking = await Booking.findById(row.bookingRef).select("salonRef status completedAt").lean();
    const salon = booking ? await Salon.findById(booking.salonRef).select("basicInfo.shopName").lean() : null;
    const claim = row.acquisitionClaimRef ? await AcquisitionClaim.findById(row.acquisitionClaimRef).lean() : null;
    const progress = row.acquisitionClaimRef ? await AcquisitionEarningProgress.findOne({ acquisitionClaimRef: row.acquisitionClaimRef }).lean() : null;
    console.log(j({
      _id: String(row._id),
      acquisitionClaimRef: row.acquisitionClaimRef ? String(row.acquisitionClaimRef) : null,
      bookingRef: String(row.bookingRef),
      entitlementType: row.entitlementType,
      creditOutcome: row.creditOutcome,
      creditedAmountInPaise: row.creditedAmountInPaise,
      idempotencyKey: row.idempotencyKey,
      bookingExists: !!booking,
      bookingStatus: booking?.status ?? null,
      salonExistsViaBooking: !!salon,
      salonShopName: salon?.basicInfo?.shopName ?? null,
      claimExists: !!claim,
      progressExists: !!progress,
    }));
  }

  // ════════════════════════════════════════════════════════════
  // PART E — per TEST/ZE2E-named Salon full dependency trace
  // ════════════════════════════════════════════════════════════
  section("PART E — per-test-Salon dependency graph");
  const testSalons = await Salon.find({ "basicInfo.shopName": { $regex: /ZE2E|TEST/i } }).select("basicInfo.shopName approval.status isDeleted").lean();
  console.log(`Test-named salons found: ${testSalons.length}`);
  for (const s of testSalons) {
    const bookings = await Booking.find({ salonRef: s._id }).select("_id").lean();
    const bookingIds = bookings.map((b) => b._id);
    const transactions = await Transaction.find({ salonId: s._id }).select("_id").lean();
    const walletTxns = await WalletTransaction.find({ bookingId: { $in: bookingIds } }).select("_id").lean();
    const revenueSplits = await RevenueSplit.find({ bookingId: { $in: bookingIds } }).select("_id").lean();
    const revenueSplitIds = revenueSplits.map((r) => r._id);
    const gstLedgerRows = await GSTLedger.find({ bookingId: { $in: bookingIds } }).select("_id").lean();
    const refunds = await Refund.find({ bookingId: { $in: bookingIds } }).select("_id").lean();
    const walletLedgerRows = await WalletLedger.find({ salonId: s._id }).select("_id").lean();
    const salonEarningsWallet = await SalonEarnings.findOne({ entityType: "SALON", entityId: s._id }).select("_id").lean();
    const claims = await AcquisitionClaim.find({ salonRef: s._id }).select("_id").lean();
    const claimIds = claims.map((c) => c._id);
    const progresses2 = await AcquisitionEarningProgress.find({ acquisitionClaimRef: { $in: claimIds } }).select("_id").lean();
    const agentLedgerRows = await FieldAgentEarningLedger.find({ acquisitionClaimRef: { $in: claimIds } }).select("_id").lean();
    const policyGaps2 = await FieldAgentEarningPolicyGap.find({ salonRef: s._id }).select("_id").lean();

    console.log(j({
      salonId: String(s._id),
      shopName: s.basicInfo?.shopName,
      approvalStatus: s.approval?.status,
      isDeleted: s.isDeleted,
      bookingCount: bookingIds.length,
      bookingIds: bookingIds.map(String),
      transactionCount: transactions.length,
      walletTransactionCount: walletTxns.length,
      revenueSplitCount: revenueSplits.length,
      revenueSplitIds: revenueSplitIds.map(String),
      gstLedgerCount: gstLedgerRows.length,
      refundCount: refunds.length,
      walletLedgerCount: walletLedgerRows.length,
      salonEarningsWalletExists: !!salonEarningsWallet,
      claimCount: claimIds.length,
      claimIds: claimIds.map(String),
      acquisitionProgressCount: progresses2.length,
      fieldAgentLedgerCount: agentLedgerRows.length,
      policyGapCount: policyGaps2.length,
    }));
  }

  // Also: orphaned claims (salon hard-deleted) — group by whether ANY
  // financial trace still exists for them.
  section("PART D(cont) — orphaned claims (salon missing) summary");
  const allClaims = await AcquisitionClaim.find({}).select("_id salonRef fieldAgentRef status").lean();
  let orphanWithProgress = 0, orphanWithLedger = 0, orphanBare = 0;
  for (const c of allClaims) {
    const salon = await Salon.findById(c.salonRef).select("_id").lean();
    if (salon) continue;
    const hasProgress = await AcquisitionEarningProgress.exists({ acquisitionClaimRef: c._id });
    const hasLedger = await FieldAgentEarningLedger.exists({ acquisitionClaimRef: c._id });
    if (hasProgress) orphanWithProgress++;
    if (hasLedger) orphanWithLedger++;
    if (!hasProgress && !hasLedger) orphanBare++;
  }
  console.log(`Orphaned claims (salon missing): withProgress=${orphanWithProgress}, withLedgerRows=${orphanWithLedger}, bareNoChildren=${orphanBare}`);

  await mongoose.connection.close();
};

run().catch(async (err) => {
  console.error("AUDIT FAILED:", err);
  try { await mongoose.connection.close(); } catch {}
  process.exit(1);
});
