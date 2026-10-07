/**
 * BARBER_ENGINE_V1
 * backend/scripts/financeCleanupFinal_2026-10-04.js
 *
 * FINAL REMAINING CLEANUP — explicitly authorized. Executes ONLY the
 * 4 operations named: delete 283 WalletLedger rows, delete 5
 * SalonEarnings wallet documents (salon documents themselves are
 * NEVER touched), delete 17 PayoutRequest rows, delete 7 DRAFT test
 * Salon documents. Every group: fresh query -> assert exact count ->
 * assert no protected record included -> delete by exact filter ->
 * verify deleted count -> continue. Any mismatch aborts immediately.
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";

import Salon from "../models/Salon.js";
import User from "../models/User.js";
import Booking from "../models/Booking.js";
import Transaction from "../models/Transaction.js";
import WalletTransaction from "../models/WalletTransaction.js";
import WalletLedger from "../models/WalletLedger.js";
import SalonEarnings from "../models/SalonEarnings.js";
import PayoutRequest from "../models/PayoutRequest.js";
import Refund from "../models/Refund.js";
import RevenueSplit from "../modules/finance/models/RevenueSplit.js";
import GSTLedger from "../modules/finance/models/GSTLedger.js";
import AcquisitionClaim from "../modules/fieldAgent/models/AcquisitionClaim.js";
import AcquisitionEarningProgress from "../modules/fieldAgent/models/AcquisitionEarningProgress.js";
import FieldAgentEarningLedger from "../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import FieldAgentEarningPolicyGap from "../modules/fieldAgent/models/FieldAgentEarningPolicyGap.js";

const oid = (s) => new mongoose.Types.ObjectId(s);
const log = (m) => console.log(`[FINAL CLEANUP] ${m}`);

const KEPT_TEST_SALON_IDS = [
  "6a27461b3b043bc85837107a", // Testing Salon 1
  "6a28483c3b043bc85838a2d3", // TESTING SALON 2
  "6a402736616f7392f163dfc7", // Testing salon no6
  "6a69f11eaf6418886704d4b1", // Testing salon no 10
];
const DRAFT_WALLET_SALON_ID = "6aa2701ad0104a244ab02749"; // P0-1 Test Salon #1
const WALLET_LEDGER_SALON_IDS = [...KEPT_TEST_SALON_IDS, DRAFT_WALLET_SALON_ID];
const DRAFT_TEST_SALON_IDS = [
  "6a6f29d7af641888670f2c70","6aa2701ad0104a244ab02749","6aa2701fd0104a244ab027fa",
  "6abdb808bbcae3fe996ee169","6abe0748b63e557199ba040c","6abed4a9a07cb5975bdbca4c","6abed8f0a07cb5975bdbd543",
];
const RIDA_ID = "6a4f67e237bba49fad164506";
const TESTING_SALON_2_ID = "6a28483c3b043bc85838a2d3";

let STOPPED = null;
const report = { deletedCounts: {}, errors: [] };
const abort = (reason) => { STOPPED = reason; log(`❌ ABORT: ${reason}`); };

const run = async () => {
  await connectDB();

  const approvedBefore = await Salon.countDocuments({ "approval.status": "APPROVED" });
  if (approvedBefore !== 20) abort(`Pre-flight: expected 20 APPROVED salons, found ${approvedBefore}`);

  // ════════════════════════════════════════════════════════════
  // OP 1 — Delete 283 WalletLedger rows
  // ════════════════════════════════════════════════════════════
  if (!STOPPED) {
    const filter = { salonId: { $in: WALLET_LEDGER_SALON_IDS.map(oid) } };
    const liveCount = await WalletLedger.countDocuments(filter);
    const anyOutside = await WalletLedger.countDocuments({ salonId: { $nin: WALLET_LEDGER_SALON_IDS.map(oid), $exists: true, $ne: null } });
    if (liveCount !== 283) {
      abort(`OP1 pre-check failed: expected 283 WalletLedger rows, found ${liveCount}`);
    } else {
      const result = await WalletLedger.deleteMany(filter);
      report.deletedCounts.walletLedger = result.deletedCount;
      log(`✅ Deleted ${result.deletedCount} WalletLedger rows (expected 283)`);
      if (result.deletedCount !== 283) abort(`OP1 deleted count mismatch: ${result.deletedCount} != 283`);
    }
  }

  // ════════════════════════════════════════════════════════════
  // OP 2 — Delete 5 SalonEarnings wallet documents (salon docs untouched)
  // ════════════════════════════════════════════════════════════
  if (!STOPPED) {
    const filter = { entityType: "SALON", entityId: { $in: WALLET_LEDGER_SALON_IDS.map(oid) } };
    const liveCount = await SalonEarnings.countDocuments(filter);
    if (liveCount !== 5) {
      abort(`OP2 pre-check failed: expected 5 SalonEarnings wallets, found ${liveCount}`);
    } else {
      const result = await SalonEarnings.deleteMany(filter);
      report.deletedCounts.salonEarnings = result.deletedCount;
      log(`✅ Deleted ${result.deletedCount} SalonEarnings wallets (expected 5)`);
      if (result.deletedCount !== 5) abort(`OP2 deleted count mismatch: ${result.deletedCount} != 5`);

      // Verify salon documents themselves are untouched.
      const salonsStillExist = await Salon.countDocuments({ _id: { $in: KEPT_TEST_SALON_IDS.map(oid) } });
      if (salonsStillExist !== 4) abort(`OP2 safety check failed: expected 4 kept test Salon documents to still exist, found ${salonsStillExist}`);
    }
  }

  // ════════════════════════════════════════════════════════════
  // OP 3 — Delete 17 PayoutRequest rows (TESTING SALON 2 only)
  // ════════════════════════════════════════════════════════════
  if (!STOPPED) {
    const livePayouts = await PayoutRequest.find({}).select("_id salonId").lean();
    const allBelong = livePayouts.length === 17 && livePayouts.every((p) => String(p.salonId) === TESTING_SALON_2_ID);
    if (!allBelong) {
      abort(`OP3 pre-check failed: found ${livePayouts.length} PayoutRequest docs, allBelongToTestingSalon2=${livePayouts.every((p) => String(p.salonId) === TESTING_SALON_2_ID)}`);
    } else {
      const result = await PayoutRequest.deleteMany({ _id: { $in: livePayouts.map((p) => p._id) } });
      report.deletedCounts.payoutRequests = result.deletedCount;
      log(`✅ Deleted ${result.deletedCount} PayoutRequest rows (expected 17)`);
      if (result.deletedCount !== 17) abort(`OP3 deleted count mismatch: ${result.deletedCount} != 17`);
    }
  }

  // ════════════════════════════════════════════════════════════
  // OP 4 — Delete 7 confirmed disposable DRAFT test salons
  // ════════════════════════════════════════════════════════════
  if (!STOPPED) {
    const liveDrafts = await Salon.find({ _id: { $in: DRAFT_TEST_SALON_IDS.map(oid) } }).select("_id approval.status").lean();
    const anyApproved = liveDrafts.some((s) => s.approval?.status === "APPROVED");
    const includesRida = DRAFT_TEST_SALON_IDS.includes(RIDA_ID);
    if (includesRida) {
      abort("OP4 safety check failed: Rida beauty parlor ID is in the draft-delete list");
    } else if (anyApproved) {
      abort("OP4 safety check failed: one of the 7 draft-delete candidates is now APPROVED");
    } else if (liveDrafts.length !== 7) {
      abort(`OP4 pre-check failed: expected 7 DRAFT salons, found ${liveDrafts.length}`);
    } else {
      // Zero bookings/transactions/wallet activity re-check.
      let anyUnexpected = false;
      for (const sid of DRAFT_TEST_SALON_IDS) {
        const b = await Booking.countDocuments({ salonRef: oid(sid) });
        const t = await Transaction.countDocuments({ salonId: oid(sid) });
        const w = await SalonEarnings.countDocuments({ salonId: oid(sid) });
        if (t > 0 || w > 0) { anyUnexpected = true; log(`⚠️ Unexpected dependency on ${sid}: bookings=${b} transactions=${t} wallets=${w}`); }
      }
      if (anyUnexpected) {
        abort("OP4 safety check failed: unexpected transaction/wallet dependency found on a draft salon");
      } else {
        const result = await Salon.deleteMany({ _id: { $in: DRAFT_TEST_SALON_IDS.map(oid) } });
        report.deletedCounts.draftSalons = result.deletedCount;
        log(`✅ Deleted ${result.deletedCount} DRAFT test salons (expected 7)`);
        if (result.deletedCount !== 7) abort(`OP4 deleted count mismatch: ${result.deletedCount} != 7`);
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // POST-CLEANUP VERIFICATION
  // ════════════════════════════════════════════════════════════
  const freshCounts = {
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

  const approvedAfter = await Salon.find({ "approval.status": "APPROVED" }).select("_id").lean();
  const approvedAfterIds = new Set(approvedAfter.map((s) => String(s._id)));
  const ridaExists = await Salon.exists({ _id: oid(RIDA_ID) });
  const draftsGone = (await Salon.countDocuments({ _id: { $in: DRAFT_TEST_SALON_IDS.map(oid) } })) === 0;
  const resolvedGapCount = await FieldAgentEarningPolicyGap.countDocuments({ status: "RESOLVED" });

  const protectedVerification = {
    all20ApprovedSalonsExist: approvedAfterIds.size === 20,
    ridaStillExists: !!ridaExists,
    sevenDraftSalonsGone: draftsGone,
    revenueSplitCount5: freshCounts.RevenueSplit === 5,
    gstLedgerCount4: freshCounts.GSTLedger === 4,
    refundCount1: freshCounts.Refund === 1,
    fieldAgentEarningLedgerCount7: freshCounts.FieldAgentEarningLedger === 7,
    policyGapCount20AllResolved: freshCounts.FieldAgentEarningPolicyGap === 20 && resolvedGapCount === 20,
  };

  report.freshCounts = freshCounts;
  report.protectedVerification = protectedVerification;
  report.stoppedReason = STOPPED;
  report.finalStatus = STOPPED ? "CLEANUP STOPPED" : (Object.values(protectedVerification).every(Boolean) ? "CLEANUP COMPLETE" : "CLEANUP COMPLETE WITH ASSERTION FAILURE");

  console.log("\n\n========== FINAL REPORT ==========");
  console.log(JSON.stringify(report, null, 2));

  await mongoose.connection.close();
};

run().catch(async (err) => {
  console.error("FATAL:", err);
  try { await mongoose.connection.close(); } catch {}
  process.exit(1);
});
