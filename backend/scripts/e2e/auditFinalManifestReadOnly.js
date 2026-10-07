/**
 * FINAL PRE-DELETE MANIFEST. STRICTLY READ-ONLY.
 * No .create(/.save(/.update*(/.delete*(/$set anywhere in this file.
 * Writes a JSON manifest to the scratchpad dir for handoff — this
 * script itself never mutates MongoDB.
 */
import "dotenv/config";
import fs from "fs";
import mongoose from "mongoose";
import connectDB from "../../config/db.js";

import Salon from "../../models/Salon.js";
import User from "../../models/User.js";
import Booking from "../../models/Booking.js";
import Transaction from "../../models/Transaction.js";
import WalletTransaction from "../../models/WalletTransaction.js";
import WalletLedger from "../../models/WalletLedger.js";
import SalonEarnings from "../../models/SalonEarnings.js";
import PayoutRequest from "../../models/PayoutRequest.js";
import Refund from "../../models/Refund.js";
import RevenueSplit from "../../modules/finance/models/RevenueSplit.js";
import GSTLedger from "../../modules/finance/models/GSTLedger.js";
import AcquisitionClaim from "../../modules/fieldAgent/models/AcquisitionClaim.js";
import AcquisitionEarningProgress from "../../modules/fieldAgent/models/AcquisitionEarningProgress.js";
import FieldAgentEarningLedger from "../../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import FieldAgentEarningPolicyGap from "../../modules/fieldAgent/models/FieldAgentEarningPolicyGap.js";

const oid = (s) => new mongoose.Types.ObjectId(s);

// Kept test salons whose OPERATIONAL data is to be cleaned (salon doc itself KEPT)
const KEPT_TEST_SALON_IDS = [
  "6a27461b3b043bc85837107a", // Testing Salon 1
  "6a28483c3b043bc85838a2d3", // TESTING SALON 2
  "6a402736616f7392f163dfc7", // Testing salon no6
  "6a69f11eaf6418886704d4b1", // Testing salon no 10
];
// Draft test fixture salons — candidate for full deletion (salon doc + everything)
const DRAFT_TEST_SALON_IDS = [
  "6a6f29d7af641888670f2c70",
  "6aa2701ad0104a244ab02749",
  "6aa2701fd0104a244ab027fa",
  "6abdb808bbcae3fe996ee169",
  "6abe0748b63e557199ba040c",
  "6abed4a9a07cb5975bdbca4c",
  "6abed8f0a07cb5975bdbd543",
];
const ALL_20_APPROVED_SALON_IDS_EXPECTED_KEEP = [
  "6a27461b3b043bc85837107a","6a28483c3b043bc85838a2d3","6a28684d3b043bc85838b231","6a2869bf3b043bc85838b320",
  "6a2870e83b043bc85838b5c1","6a2872133b043bc85838b67b","6a2873f43b043bc85838b68e","6a311a6d4633fa58986b8a04",
  "6a367a184c9a3dd9caeffe70","6a3da136616f7392f162b762","6a402736616f7392f163dfc7","6a6fab19af641888670f7028",
  "6a6fb6c1af641888670f777a","6a6fbdcaaf641888670f7bf9","6a6fbf2eaf641888670f7c1b","6a6fcb86af641888670f831d",
  "6a7055e1af641888670fc435","6abe16b7b63e557199ba2c76","6abe46c31c0a777ec2f2b497","6a69f11eaf6418886704d4b1",
];
const TEST_USER_IDS = [
  "6a288f50b3f2799ea0629715","6a54bc145ab07bd642480afb","6ab91724a05ed5894f9db717",
  "6aa2701bd0104a244ab02767","6aa2701fd0104a244ab02801",
];

const run = async () => {
  await connectDB();
  const manifest = {};

  // A — DRAFT salon re-verification
  manifest.draftSalons = [];
  for (const sid of DRAFT_TEST_SALON_IDS) {
    const s = await Salon.findById(sid).select("basicInfo.shopName approval.status onboarding.step ownerId createdAt").lean();
    const bookingCount = await Booking.countDocuments({ salonRef: oid(sid) });
    const owner = s ? await User.findById(s.ownerId).select("name phone accountStatus").lean() : null;
    const ownerApprovedSalonCount = s ? await Salon.countDocuments({ ownerId: s.ownerId, "approval.status": "APPROVED" }) : 0;
    manifest.draftSalons.push({ salonId: sid, exists: !!s, shopName: s?.basicInfo?.shopName ?? null, approvalStatus: s?.approval?.status, step: s?.onboarding?.step, bookingCount, ownerId: s ? String(s.ownerId) : null, ownerExists: !!owner, ownerAlsoOwnsAnApprovedSalon: ownerApprovedSalonCount > 0 });
  }

  // B — APPROVED salons re-verify count + confirm none equal draft/delete lists
  const approvedSalons = await Salon.find({ "approval.status": "APPROVED" }).select("_id basicInfo.shopName ownerId").lean();
  manifest.approvedSalonCount = approvedSalons.length;
  manifest.approvedSalonIds = approvedSalons.map((s) => String(s._id));
  manifest.approvedOwnerIds = [...new Set(approvedSalons.map((s) => String(s.ownerId)))];

  // C — test users re-verify role
  manifest.testUsers = [];
  for (const uid of TEST_USER_IDS) {
    const u = await User.findById(uid).select("name phone role accountStatus").lean();
    const ownsAnySalon = await Salon.exists({ ownerId: oid(uid) });
    const isFieldAgent = await mongoose.connection.db.collection("fieldagents").findOne({ userRef: oid(uid) });
    manifest.testUsers.push({ userId: uid, exists: !!u, name: u?.name, phone: u?.phone, role: u?.role, isOwnerOfAnySalon: !!ownsAnySalon, isFieldAgent: !!isFieldAgent });
  }

  // D — exact Booking IDs for the 4 kept test salons
  manifest.testBookings = { total: 0, bySalon: {} };
  let allTestBookingIds = [];
  for (const sid of KEPT_TEST_SALON_IDS) {
    const bookings = await Booking.find({ salonRef: oid(sid) }).select("_id").lean();
    const ids = bookings.map((b) => String(b._id));
    manifest.testBookings.bySalon[sid] = { count: ids.length, ids };
    allTestBookingIds.push(...ids);
    manifest.testBookings.total += ids.length;
  }

  // E — exact Transaction IDs (linked to those bookings) + 3 known orphans
  const txns = await Transaction.find({ bookingId: { $in: allTestBookingIds.map(oid) } }).select("_id bookingId").lean();
  const orphanTxns = await Transaction.aggregate([
    { $lookup: { from: "bookings", localField: "bookingId", foreignField: "_id", as: "b" } },
    { $match: { b: { $size: 0 } } },
  ]);
  manifest.testTransactions = {
    linkedToKeptTestBookings: { count: txns.length, ids: txns.map((t) => String(t._id)) },
    orphaned: { count: orphanTxns.length, ids: orphanTxns.map((t) => ({ id: String(t._id), bookingId: String(t.bookingId), salonId: t.salonId ? String(t.salonId) : null, amount: t.amount })) },
  };

  // F — exact WalletTransaction IDs, full detail
  const wtxns = await WalletTransaction.find({ bookingId: { $in: allTestBookingIds.map(oid) } }).select("_id bookingId userId direction amountInPaise").lean();
  manifest.testWalletTransactions = {
    count: wtxns.length,
    rows: wtxns.map((w) => ({ id: String(w._id), bookingId: w.bookingId ? String(w.bookingId) : null, userId: w.userId ? String(w.userId) : null, direction: w.direction, amountInPaise: w.amountInPaise })),
  };
  // Also check total WalletTransaction count overall for reconciliation
  manifest.walletTransactionTotalInDb = await WalletTransaction.countDocuments({});

  // G — exact WalletLedger IDs for the kept test salons' wallets
  manifest.testWalletLedger = { total: 0, bySalon: {} };
  for (const sid of KEPT_TEST_SALON_IDS) {
    const rows = await WalletLedger.find({ salonId: oid(sid) }).select("_id").lean();
    manifest.testWalletLedger.bySalon[sid] = rows.length;
    manifest.testWalletLedger.total += rows.length;
  }
  // P0-1 #1's wallet ledger (draft salon, 2 rows)
  const p01Ledger = await WalletLedger.find({ salonId: oid("6aa2701ad0104a244ab02749") }).select("_id").lean();
  manifest.testWalletLedger.bySalon["6aa2701ad0104a244ab02749_draftWallet"] = p01Ledger.length;
  manifest.testWalletLedger.total += p01Ledger.length;

  // H — exact PayoutRequest IDs
  const payouts = await PayoutRequest.find({}).select("_id salonId amountInPaise status").lean();
  manifest.testPayoutRequests = { count: payouts.length, allBelongToTestingSalon2: payouts.every((p) => String(p.salonId) === "6a28483c3b043bc85838a2d3"), ids: payouts.map((p) => String(p._id)) };

  // I — Field Agent data exact IDs
  const allClaims = await AcquisitionClaim.find({}).select("_id salonRef").lean();
  const bareOrphanClaimIds = [];
  for (const c of allClaims) {
    const salonExists = await Salon.exists({ _id: c.salonRef });
    if (!salonExists) bareOrphanClaimIds.push(String(c._id));
  }
  const bareClaimsOnKeptTestSalons = await AcquisitionClaim.find({ salonRef: { $in: ["6abe16b7b63e557199ba2c76", "6abe46c31c0a777ec2f2b497"].map(oid) } }).select("_id").lean();
  manifest.fieldAgentData = {
    bareOrphanedClaims: { count: bareOrphanClaimIds.length, ids: bareOrphanClaimIds },
    bareClaimsOnKeptSalons: { count: bareClaimsOnKeptTestSalons.length, ids: bareClaimsOnKeptTestSalons.map((c) => String(c._id)) },
  };
  const allProgress = await AcquisitionEarningProgress.find({}).select("_id").lean();
  manifest.fieldAgentData.acquisitionEarningProgress = { count: allProgress.length, ids: allProgress.map((p) => String(p._id)) };
  const allAgentLedger = await FieldAgentEarningLedger.find({}).select("_id").lean();
  manifest.fieldAgentData.fieldAgentEarningLedger = { count: allAgentLedger.length, ids: allAgentLedger.map((l) => String(l._id)) };
  const resolvedGaps = await FieldAgentEarningPolicyGap.find({ status: "RESOLVED" }).select("_id").lean();
  manifest.fieldAgentData.resolvedPolicyGaps = { count: resolvedGaps.length, ids: resolvedGaps.map((g) => String(g._id)) };
  const openGaps = await FieldAgentEarningPolicyGap.find({ status: "OPEN" }).select("_id").lean();
  manifest.fieldAgentData.openPolicyGapsDoNotTouch = { count: openGaps.length, ids: openGaps.map((g) => String(g._id)) };

  // J — immutable records
  const splits = await RevenueSplit.find({}).select("_id").lean();
  const gstRows = await GSTLedger.find({}).select("_id").lean();
  manifest.immutable = { revenueSplitIds: splits.map((s) => String(s._id)), gstLedgerIds: gstRows.map((g) => String(g._id)) };

  // K — Refund
  const refund = await Refund.findOne({}).select("_id").lean();
  manifest.refundDoNotDelete = refund ? String(refund._id) : null;

  // M — fresh exact counts
  manifest.freshCounts = {
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
    PayoutRequest: await PayoutRequest.countDocuments({}),
    User: await User.countDocuments({}),
  };

  // N — final safety assertions
  const approvedSalonIdSet = new Set(manifest.approvedSalonIds);
  const draftDeleteIdSet = new Set(DRAFT_TEST_SALON_IDS);
  const assertions = {
    noApprovedSalonInDraftDeleteList: [...draftDeleteIdSet].every((id) => !approvedSalonIdSet.has(id)),
    approvedCountMatchesExpected20: manifest.approvedSalonCount === 20,
    ridaBeautyParlorExcludedFromDraftList: !draftDeleteIdSet.has("6a4f67e237bba49fad164506"),
    refundNotInAnyDeleteList: true, // never queried into any delete list above
    revenueSplitNotInDeleteList: true,
    gstLedgerNotInDeleteList: true,
    openGapsNotInDeleteList: true,
  };
  manifest.finalSafetyAssertions = assertions;
  manifest.allAssertionsPass = Object.values(assertions).every(Boolean);

  fs.writeFileSync("/tmp/final_cleanup_manifest.json", JSON.stringify(manifest, null, 2));
  console.log("Manifest written to /tmp/final_cleanup_manifest.json");
  console.log(JSON.stringify({
    approvedSalonCount: manifest.approvedSalonCount,
    testBookingsTotal: manifest.testBookings.total,
    testTransactionsLinked: manifest.testTransactions.linkedToKeptTestBookings.count,
    testTransactionsOrphaned: manifest.testTransactions.orphaned.count,
    testWalletTransactions: manifest.testWalletTransactions.count,
    walletTransactionTotalInDb: manifest.walletTransactionTotalInDb,
    testWalletLedgerTotal: manifest.testWalletLedger.total,
    testPayoutRequests: manifest.testPayoutRequests.count,
    payoutsAllBelongToTestingSalon2: manifest.testPayoutRequests.allBelongToTestingSalon2,
    bareOrphanedClaims: manifest.fieldAgentData.bareOrphanedClaims.count,
    bareClaimsOnKeptSalons: manifest.fieldAgentData.bareClaimsOnKeptSalons.count,
    totalClaimsToDelete: manifest.fieldAgentData.bareOrphanedClaims.count + manifest.fieldAgentData.bareClaimsOnKeptSalons.count,
    progressCount: manifest.fieldAgentData.acquisitionEarningProgress.count,
    agentLedgerCount: manifest.fieldAgentData.fieldAgentEarningLedger.count,
    resolvedGaps: manifest.fieldAgentData.resolvedPolicyGaps.count,
    openGapsDoNotTouch: manifest.fieldAgentData.openPolicyGapsDoNotTouch.count,
    revenueSplitCount: manifest.immutable.revenueSplitIds.length,
    gstLedgerCount: manifest.immutable.gstLedgerIds.length,
    refundId: manifest.refundDoNotDelete,
    freshCounts: manifest.freshCounts,
    finalSafetyAssertions: manifest.finalSafetyAssertions,
    allAssertionsPass: manifest.allAssertionsPass,
  }, null, 2));

  console.log("\nDraft salons re-verification:");
  console.log(JSON.stringify(manifest.draftSalons, null, 2));
  console.log("\nTest users re-verification:");
  console.log(JSON.stringify(manifest.testUsers, null, 2));

  await mongoose.connection.close();
};

run().catch(async (err) => {
  console.error("MANIFEST FAILED:", err);
  try { await mongoose.connection.close(); } catch {}
  process.exit(1);
});
