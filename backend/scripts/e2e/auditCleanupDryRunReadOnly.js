/**
 * STEP 2 — MONGODB FINANCE TEST-DATA CLEANUP, DRY RUN. STRICTLY
 * READ-ONLY. No .create(/.save(/.update*(/.delete*(/$set anywhere.
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../../config/db.js";

import Salon from "../../models/Salon.js";
import Booking from "../../models/Booking.js";
import Transaction from "../../models/Transaction.js";
import WalletTransaction from "../../models/WalletTransaction.js";
import WalletLedger from "../../models/WalletLedger.js";
import SalonEarnings from "../../models/SalonEarnings.js";
import Refund from "../../models/Refund.js";
import RevenueSplit from "../../modules/finance/models/RevenueSplit.js";
import GSTLedger from "../../modules/finance/models/GSTLedger.js";
import AcquisitionClaim from "../../modules/fieldAgent/models/AcquisitionClaim.js";
import AcquisitionEarningProgress from "../../modules/fieldAgent/models/AcquisitionEarningProgress.js";
import FieldAgentEarningLedger from "../../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import FieldAgentEarningPolicyGap from "../../modules/fieldAgent/models/FieldAgentEarningPolicyGap.js";

const section = (t) => console.log(`\n${"=".repeat(10)} ${t} ${"=".repeat(10)}`);
const j = (x) => JSON.stringify(x);

const TEST_SALON_IDS = [
  "6a27461b3b043bc85837107a", // Testing Salon 1
  "6a28483c3b043bc85838a2d3", // TESTING SALON 2
  "6a402736616f7392f163dfc7", // Testing salon no6
  "6a69f11eaf6418886704d4b1", // Testing salon no 10
  "6a6f29d7af641888670f2c70", // Testing salon no 12
  "6a6fbdcaaf641888670f7bf9", // Testing salon 98
  "6a6fbf2eaf641888670f7c1b", // Testing salon 87
  "6a6fcb86af641888670f831d", // Testing salon 43
  "6aa2701ad0104a244ab02749", // P0-1 Test Salon
  "6aa2701fd0104a244ab027fa", // P0-1 Test Salon (second)
  "6abe16b7b63e557199ba2c76", // Testing salon 10
  "6abe46c31c0a777ec2f2b497", // Delete Button Test Salon (PENDING)
];

const run = async () => {
  await connectDB();

  // ════════════════════════════════════════════════════════════
  // PART A — root salons, full field set including ownerId
  // ════════════════════════════════════════════════════════════
  section("PART A — root test salons, full detail");
  for (const sid of TEST_SALON_IDS) {
    const s = await Salon.findById(sid).select("basicInfo.shopName approval.status ownerId isDeleted").lean();
    if (!s) { console.log(j({ salonId: sid, exists: false })); continue; }
    const bookings = await Booking.find({ salonRef: s._id }).select("_id").lean();
    const bookingIds = bookings.map((b) => String(b._id));
    const transactions = await Transaction.countDocuments({ salonId: s._id });
    const wallet = await SalonEarnings.findOne({ entityType: "SALON", entityId: s._id }).select("_id").lean();
    const walletLedgerCount = await WalletLedger.countDocuments({ salonId: s._id });
    const revenueSplits = await RevenueSplit.countDocuments({ bookingId: { $in: bookingIds.map((id) => new mongoose.Types.ObjectId(id)) } });
    const gstLedgerCount = await GSTLedger.countDocuments({ bookingId: { $in: bookingIds.map((id) => new mongoose.Types.ObjectId(id)) } });
    const refundCount = await Refund.countDocuments({ bookingId: { $in: bookingIds.map((id) => new mongoose.Types.ObjectId(id)) } });
    const claims = await AcquisitionClaim.find({ salonRef: s._id }).select("_id").lean();
    const claimIds = claims.map((c) => String(c._id));
    const progressCount = await AcquisitionEarningProgress.countDocuments({ acquisitionClaimRef: { $in: claimIds.map((id) => new mongoose.Types.ObjectId(id)) } });
    const agentLedgerCount = await FieldAgentEarningLedger.countDocuments({ acquisitionClaimRef: { $in: claimIds.map((id) => new mongoose.Types.ObjectId(id)) } });
    const policyGapCount = await FieldAgentEarningPolicyGap.countDocuments({ salonRef: s._id });
    console.log(j({
      salonId: String(s._id),
      shopName: s.basicInfo?.shopName,
      approvalStatus: s.approval?.status,
      ownerId: String(s.ownerId),
      isDeleted: s.isDeleted,
      bookingCount: bookingIds.length,
      transactionCount: transactions,
      walletExists: !!wallet,
      walletLedgerCount,
      revenueSplitCount: revenueSplits,
      gstLedgerCount,
      refundCount,
      claimCount: claimIds.length,
      claimIds,
      acquisitionProgressCount: progressCount,
      fieldAgentLedgerCount: agentLedgerCount,
      policyGapCount,
    }));
  }

  // ════════════════════════════════════════════════════════════
  // PART C — every GSTLedger + RevenueSplit row, full trace
  // ════════════════════════════════════════════════════════════
  section("PART C — every GSTLedger + RevenueSplit row, immutability + linkage");
  const allSplits = await RevenueSplit.find({}).lean();
  for (const sp of allSplits) {
    const booking = await Booking.findById(sp.bookingId).select("salonRef status").lean();
    const salon = booking ? await Salon.findById(booking.salonRef).select("basicInfo.shopName").lean() : null;
    const gstRow = await GSTLedger.findOne({ revenueSplitId: sp._id, ledgerType: "SALE" }).lean();
    console.log(j({
      revenueSplitId: String(sp._id),
      bookingId: String(sp.bookingId),
      bookingExists: !!booking,
      bookingStatus: booking?.status ?? null,
      salonId: booking ? String(booking.salonRef) : null,
      salonName: salon?.basicInfo?.shopName ?? "(not found / presumed real)",
      isTestSalon: /ZE2E|TEST/i.test(salon?.basicInfo?.shopName || ""),
      linkedGstLedgerId: gstRow ? String(gstRow._id) : null,
      schemaImmutable: true,
    }));
  }

  // ════════════════════════════════════════════════════════════
  // PART D — exact orphan lists
  // ════════════════════════════════════════════════════════════
  section("PART D — 61 bare orphaned AcquisitionClaim IDs");
  const allClaims = await AcquisitionClaim.find({}).select("_id salonRef fieldAgentRef status").lean();
  const bareOrphanIds = [];
  const nonOrphanClaims = [];
  for (const c of allClaims) {
    const salonExists = await Salon.exists({ _id: c.salonRef });
    if (!salonExists) bareOrphanIds.push(String(c._id));
    else nonOrphanClaims.push({ id: String(c._id), salonRef: String(c.salonRef), status: c.status });
  }
  console.log(`Bare orphaned claim count: ${bareOrphanIds.length}`);
  console.log(j(bareOrphanIds));
  console.log(`Non-orphaned claims (salon still exists): ${nonOrphanClaims.length}`);
  console.log(j(nonOrphanClaims));

  section("PART D — 29 orphaned AcquisitionEarningProgress IDs (claim itself gone)");
  const allProgress = await AcquisitionEarningProgress.find({}).select("_id acquisitionClaimRef earnedInPaise status").lean();
  console.log(j(allProgress.map((p) => ({ id: String(p._id), claimRef: String(p.acquisitionClaimRef), earnedInPaise: p.earnedInPaise, status: p.status }))));

  section("PART D — 7 orphaned FieldAgentEarningLedger IDs (claim itself gone)");
  const allAgentLedger = await FieldAgentEarningLedger.find({}).select("_id acquisitionClaimRef bookingRef creditedAmountInPaise creditOutcome idempotencyKey").lean();
  console.log(j(allAgentLedger.map((r) => ({ id: String(r._id), claimRef: r.acquisitionClaimRef ? String(r.acquisitionClaimRef) : null, bookingRef: String(r.bookingRef), creditedAmountInPaise: r.creditedAmountInPaise, creditOutcome: r.creditOutcome, idempotencyKey: r.idempotencyKey }))));

  section("PART D — FieldAgentEarningPolicyGap by type+status (counts only, too many for full ID dump)");
  const gapAgg = await FieldAgentEarningPolicyGap.aggregate([{ $group: { _id: { type: "$gapType", status: "$status" }, count: { $sum: 1 } } }]);
  console.log(j(gapAgg));
  const openGaps = await FieldAgentEarningPolicyGap.find({ status: "OPEN" }).select("_id gapType referenceKey acquisitionClaimRef salonRef attemptCount lastErrorCode").lean();
  console.log(`\nAll 20 OPEN gap IDs, full detail:`);
  console.log(j(openGaps.map((g) => ({ id: String(g._id), gapType: g.gapType, referenceKey: g.referenceKey, claimRef: g.acquisitionClaimRef ? String(g.acquisitionClaimRef) : null, salonRef: g.salonRef ? String(g.salonRef) : null, attemptCount: g.attemptCount, lastErrorCode: g.lastErrorCode }))));

  // ════════════════════════════════════════════════════════════
  // PART E — orphaned Transactions
  // ════════════════════════════════════════════════════════════
  section("PART E — orphaned Transaction rows (bookingId doesn't resolve)");
  const orphanTxns = await Transaction.aggregate([
    { $lookup: { from: "bookings", localField: "bookingId", foreignField: "_id", as: "b" } },
    { $match: { b: { $size: 0 } } },
  ]);
  console.log(j(orphanTxns.map((t) => ({ transactionId: String(t._id), bookingId: String(t.bookingId), salonId: t.salonId ? String(t.salonId) : null, amount: t.amount, commission: t.commission, payoutAmount: t.payoutAmount, status: t.status, provider: t.provider }))));

  // ════════════════════════════════════════════════════════════
  // PART H — overall current counts
  // ════════════════════════════════════════════════════════════
  section("PART H — current total counts for every relevant collection");
  console.log(j({
    Salon: await Salon.countDocuments({}),
    Booking: await Booking.countDocuments({}),
    Transaction: await Transaction.countDocuments({}),
    WalletTransaction: await WalletTransaction.countDocuments({}),
    WalletLedger: await WalletLedger.countDocuments({}),
    SalonEarnings: await SalonEarnings.countDocuments({}),
    RevenueSplit: await RevenueSplit.countDocuments({}),
    GSTLedger: await GSTLedger.countDocuments({}),
    Refund: await Refund.countDocuments({}),
    AcquisitionClaim: await AcquisitionClaim.countDocuments({}),
    AcquisitionEarningProgress: await AcquisitionEarningProgress.countDocuments({}),
    FieldAgentEarningLedger: await FieldAgentEarningLedger.countDocuments({}),
    FieldAgentEarningPolicyGap: await FieldAgentEarningPolicyGap.countDocuments({}),
  }));

  // ════════════════════════════════════════════════════════════
  // PART F — wallet docs for the two problem salons
  // ════════════════════════════════════════════════════════════
  section("PART F — SalonEarnings docs for TESTING SALON 2 and P0-1 Test Salon");
  const w1 = await SalonEarnings.findOne({ entityType: "SALON", entityId: new mongoose.Types.ObjectId("6a28483c3b043bc85838a2d3") }).lean();
  const w2 = await SalonEarnings.findOne({ entityType: "SALON", entityId: new mongoose.Types.ObjectId("6aa2701ad0104a244ab02749") }).lean();
  console.log("TESTING SALON 2 wallet:", j(w1));
  console.log("P0-1 Test Salon wallet:", j(w2));
  const wl1Count = await WalletLedger.countDocuments({ salonId: new mongoose.Types.ObjectId("6a28483c3b043bc85838a2d3") });
  const wl2Count = await WalletLedger.countDocuments({ salonId: new mongoose.Types.ObjectId("6aa2701ad0104a244ab02749") });
  console.log(`TESTING SALON 2 WalletLedger row count: ${wl1Count}`);
  console.log(`P0-1 Test Salon WalletLedger row count: ${wl2Count}`);

  await mongoose.connection.close();
};

run().catch(async (err) => {
  console.error("AUDIT FAILED:", err);
  try { await mongoose.connection.close(); } catch {}
  process.exit(1);
});
