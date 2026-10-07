/**
 * BARBER_ENGINE_V1
 * backend/scripts/financeCleanupFinal3Ops_2026-10-04.js
 *
 * FINAL CLEANUP — exactly 3 operations, explicitly authorized.
 * WalletLedger/RevenueSplit/GSTLedger/FieldAgentEarningLedger are
 * PERMANENTLY EXCLUDED (schema-immutable, confirmed) — not imported
 * for any write, only for the post-cleanup count verification.
 *
 *   OP 1 — delete 5 test SalonEarnings wallet documents (Salon docs untouched)
 *   OP 2 — delete 17 PayoutRequest rows (all salonId = TESTING SALON 2)
 *   OP 3 — delete 7 confirmed disposable DRAFT test Salon documents
 *
 * Each op: fresh query -> assert exact count -> assert no protected
 * record included -> delete by exact filter -> verify deleted count
 * -> continue. Any mismatch aborts immediately, no further ops run.
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
const log = (m) => console.log(`[FINAL-3OPS] ${m}`);

const TEST_WALLET_SALON_IDS = [
  "6a27461b3b043bc85837107a", // Testing Salon 1
  "6a28483c3b043bc85838a2d3", // TESTING SALON 2
  "6a402736616f7392f163dfc7", // Testing salon no6
  "6a69f11eaf6418886704d4b1", // Testing salon no 10
  "6aa2701ad0104a244ab02749", // P0-1 Test Salon #1
];
const DRAFT_TEST_SALON_IDS = [
  "6a6f29d7af641888670f2c70","6aa2701ad0104a244ab02749","6aa2701fd0104a244ab027fa",
  "6abdb808bbcae3fe996ee169","6abe0748b63e557199ba040c","6abed4a9a07cb5975bdbca4c","6abed8f0a07cb5975bdbd543",
];
const RIDA_ID = "6a4f67e237bba49fad164506";
const TESTING_SALON_2_ID = "6a28483c3b043bc85838a2d3";

let STOPPED = null;
const report = { deletedCounts: {} };
const abort = (reason) => { STOPPED = reason; log(`❌ ABORT: ${reason}`); };

const run = async () => {
  await connectDB();

  const approvedBefore = await Salon.countDocuments({ "approval.status": "APPROVED" });
  if (approvedBefore !== 20) abort(`Pre-flight: expected 20 APPROVED salons, found ${approvedBefore}`);
  const walletLedgerBefore = await WalletLedger.countDocuments({});
  if (walletLedgerBefore !== 347) abort(`Pre-flight: expected WalletLedger to remain at 347 (untouched since last run), found ${walletLedgerBefore}`);

  // ════════════════════════════════════════════════════════════
  // OP 1 — Delete 5 test SalonEarnings wallet documents
  // ════════════════════════════════════════════════════════════
  if (!STOPPED) {
    const filter = { entityType: "SALON", entityId: { $in: TEST_WALLET_SALON_IDS.map(oid) } };
    const liveWallets = await SalonEarnings.find(filter).select("_id entityId").lean();
    const noOtherIncluded = (await SalonEarnings.countDocuments({})) - liveWallets.length === 4; // 9 total - 5 = 4 expected remaining
    if (liveWallets.length !== 5) {
      abort(`OP1 pre-check failed: expected 5 test SalonEarnings wallets, found ${liveWallets.length}`);
    } else if (!noOtherIncluded) {
      abort(`OP1 pre-check failed: deleting these 5 would not leave exactly 4 remaining wallets`);
    } else {
      const result = await SalonEarnings.deleteMany(filter);
      report.deletedCounts.salonEarnings = result.deletedCount;
      log(`✅ Deleted ${result.deletedCount} SalonEarnings wallets (expected 5)`);
      if (result.deletedCount !== 5) {
        abort(`OP1 deleted count mismatch: ${result.deletedCount} != 5`);
      } else {
        const salonsStillExist = await Salon.countDocuments({ _id: { $in: TEST_WALLET_SALON_IDS.map(oid) } });
        if (salonsStillExist !== 5) abort(`OP1 safety check failed: expected all 5 corresponding Salon documents to still exist, found ${salonsStillExist}`);
        const walletLedgerUnchanged = (await WalletLedger.countDocuments({})) === 347;
        if (!walletLedgerUnchanged) abort("OP1 safety check failed: WalletLedger count changed — it must remain exactly 347");
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // OP 2 — Delete 17 PayoutRequest rows (TESTING SALON 2 only)
  // ════════════════════════════════════════════════════════════
  if (!STOPPED) {
    const livePayouts = await PayoutRequest.find({}).select("_id salonId").lean();
    const allBelong = livePayouts.length === 17 && livePayouts.every((p) => String(p.salonId) === TESTING_SALON_2_ID);
    if (livePayouts.length !== 17) {
      abort(`OP2 pre-check failed: expected 17 PayoutRequest, found ${livePayouts.length}`);
    } else if (!allBelong) {
      abort("OP2 pre-check failed: not every PayoutRequest belongs to TESTING SALON 2");
    } else {
      const result = await PayoutRequest.deleteMany({ _id: { $in: livePayouts.map((p) => p._id) } });
      report.deletedCounts.payoutRequests = result.deletedCount;
      log(`✅ Deleted ${result.deletedCount} PayoutRequest rows (expected 17)`);
      if (result.deletedCount !== 17) abort(`OP2 deleted count mismatch: ${result.deletedCount} != 17`);
    }
  }

  // ════════════════════════════════════════════════════════════
  // OP 3 — Delete 7 confirmed disposable DRAFT test salons
  // ════════════════════════════════════════════════════════════
  if (!STOPPED) {
    if (DRAFT_TEST_SALON_IDS.includes(RIDA_ID)) {
      abort("OP3 safety check failed: Rida beauty parlor ID is in the draft-delete list");
    } else {
      const liveDrafts = await Salon.find({ _id: { $in: DRAFT_TEST_SALON_IDS.map(oid) } }).select("_id approval.status").lean();
      const anyApproved = liveDrafts.some((s) => s.approval?.status === "APPROVED");
      if (liveDrafts.length !== 7) {
        abort(`OP3 pre-check failed: expected 7 DRAFT salons, found ${liveDrafts.length}`);
      } else if (anyApproved) {
        abort("OP3 safety check failed: one of the 7 draft-delete candidates is now APPROVED");
      } else {
        let anyUnexpected = false;
        for (const sid of DRAFT_TEST_SALON_IDS) {
          const b = await Booking.countDocuments({ salonRef: oid(sid) });
          const t = await Transaction.countDocuments({ salonId: oid(sid) });
          const w = await SalonEarnings.countDocuments({ salonId: oid(sid) });
          if (b > 0 || t > 0 || w > 0) { anyUnexpected = true; log(`⚠️ Unexpected dependency on ${sid}: bookings=${b} transactions=${t} wallets=${w}`); }
        }
        if (anyUnexpected) {
          abort("OP3 safety check failed: unexpected booking/transaction/wallet dependency found on a draft salon");
        } else {
          const result = await Salon.deleteMany({ _id: { $in: DRAFT_TEST_SALON_IDS.map(oid) } });
          report.deletedCounts.draftSalons = result.deletedCount;
          log(`✅ Deleted ${result.deletedCount} DRAFT test salons (expected 7)`);
          if (result.deletedCount !== 7) abort(`OP3 deleted count mismatch: ${result.deletedCount} != 7`);
        }
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
    walletLedgerUnchangedAt347: freshCounts.WalletLedger === 347,
    revenueSplitCount5: freshCounts.RevenueSplit === 5,
    gstLedgerCount4: freshCounts.GSTLedger === 4,
    refundCount1: freshCounts.Refund === 1,
    fieldAgentEarningLedgerCount7: freshCounts.FieldAgentEarningLedger === 7,
    policyGapCount20AllResolved: freshCounts.FieldAgentEarningPolicyGap === 20 && resolvedGapCount === 20,
    acquisitionClaimCount4: freshCounts.AcquisitionClaim === 4,
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
