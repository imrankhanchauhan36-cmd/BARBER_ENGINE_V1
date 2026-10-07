/**
 * BARBER_ENGINE_V1
 * backend/scripts/financeCleanupP01Final_2026-10-04.js
 *
 * NARROWLY AUTHORIZED continuation of the already-approved cleanup.
 *   STEP 1 — delete exactly 2 named P0-1 test Bookings (after
 *            re-confirming salon match, no Transaction, no
 *            WalletTransaction for each).
 *   STEP 2 — delete exactly 7 named DRAFT test Salon documents
 *            (after re-verifying DRAFT status, zero remaining
 *            Booking/Transaction/WalletTransaction/SalonEarnings).
 * Owners/Users are NOT touched. No immutable ledger
 * (WalletLedger/RevenueSplit/GSTLedger/FieldAgentEarningLedger),
 * Refund, or FieldAgentEarningPolicyGap is written to anywhere in
 * this file — none of those models are even imported for a write.
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
const log = (m) => console.log(`[P01-FINAL] ${m}`);

const BOOKINGS_TO_DELETE = [
  { bookingId: "6aa2701cd0104a244ab02774", salonId: "6aa2701ad0104a244ab02749" },
  { bookingId: "6aa2701fd0104a244ab02808", salonId: "6aa2701fd0104a244ab027fa" },
];
const DRAFT_TEST_SALON_IDS = [
  "6a6f29d7af641888670f2c70","6aa2701ad0104a244ab02749","6aa2701fd0104a244ab027fa",
  "6abdb808bbcae3fe996ee169","6abe0748b63e557199ba040c","6abed4a9a07cb5975bdbca4c","6abed8f0a07cb5975bdbd543",
];
const RIDA_ID = "6a4f67e237bba49fad164506";

let STOPPED = null;
const report = { deletedBookingIds: [], deletedSalonIds: [] };
const abort = (reason) => { STOPPED = reason; log(`❌ ABORT: ${reason}`); };

const run = async () => {
  await connectDB();

  // Pre-flight: protected baselines unchanged from the prior run.
  const walletLedgerCount = await WalletLedger.countDocuments({});
  const revenueSplitCount = await RevenueSplit.countDocuments({});
  const gstLedgerCount = await GSTLedger.countDocuments({});
  const refundCount = await Refund.countDocuments({});
  const faLedgerCount = await FieldAgentEarningLedger.countDocuments({});
  const gapCount = await FieldAgentEarningPolicyGap.countDocuments({ status: "RESOLVED" });
  const claimCount = await AcquisitionClaim.countDocuments({});
  if (walletLedgerCount !== 347) abort(`Pre-flight: WalletLedger expected 347, found ${walletLedgerCount}`);
  else if (revenueSplitCount !== 5) abort(`Pre-flight: RevenueSplit expected 5, found ${revenueSplitCount}`);
  else if (gstLedgerCount !== 4) abort(`Pre-flight: GSTLedger expected 4, found ${gstLedgerCount}`);
  else if (refundCount !== 1) abort(`Pre-flight: Refund expected 1, found ${refundCount}`);
  else if (faLedgerCount !== 7) abort(`Pre-flight: FieldAgentEarningLedger expected 7, found ${faLedgerCount}`);
  else if (gapCount !== 20) abort(`Pre-flight: RESOLVED PolicyGap expected 20, found ${gapCount}`);
  else if (claimCount !== 4) abort(`Pre-flight: AcquisitionClaim expected 4, found ${claimCount}`);

  // ════════════════════════════════════════════════════════════
  // STEP 1 — delete exactly 2 named P0-1 test bookings
  // ════════════════════════════════════════════════════════════
  if (!STOPPED) {
    for (const { bookingId, salonId } of BOOKINGS_TO_DELETE) {
      if (STOPPED) break;
      const booking = await Booking.findById(bookingId).select("_id salonRef status").lean();
      if (!booking) {
        abort(`Booking ${bookingId} does not exist — refusing to proceed`);
        break;
      }
      if (String(booking.salonRef) !== salonId) {
        abort(`Booking ${bookingId} belongs to salon ${booking.salonRef}, not the expected ${salonId} — STOP`);
        break;
      }
      const txnCount = await Transaction.countDocuments({ bookingId: booking._id });
      const wtxnCount = await WalletTransaction.countDocuments({ bookingId: booking._id });
      if (txnCount > 0) {
        abort(`Booking ${bookingId} has ${txnCount} Transaction row(s) — unexpected, STOP before deleting this booking`);
        break;
      }
      if (wtxnCount > 0) {
        abort(`Booking ${bookingId} has ${wtxnCount} WalletTransaction row(s) — unexpected, STOP before deleting this booking`);
        break;
      }
      const result = await Booking.deleteOne({ _id: booking._id });
      if (result.deletedCount !== 1) {
        abort(`Failed to delete booking ${bookingId} — deletedCount=${result.deletedCount}`);
        break;
      }
      report.deletedBookingIds.push(bookingId);
      log(`✅ Deleted booking ${bookingId} (salon ${salonId} confirmed, 0 Transaction, 0 WalletTransaction)`);
    }
  }

  // ════════════════════════════════════════════════════════════
  // STEP 2 — re-verify + delete the 7 DRAFT test salons
  // ════════════════════════════════════════════════════════════
  if (!STOPPED) {
    if (DRAFT_TEST_SALON_IDS.includes(RIDA_ID)) {
      abort("Rida beauty parlor ID found in the draft-delete list — refusing to proceed");
    } else {
      let allSafe = true;
      for (const sid of DRAFT_TEST_SALON_IDS) {
        const s = await Salon.findById(sid).select("_id approval.status").lean();
        if (!s) { abort(`Draft salon ${sid} not found`); allSafe = false; break; }
        if (s.approval?.status !== "DRAFT") { abort(`Draft salon ${sid} has approval.status=${s.approval?.status}, expected DRAFT — refusing`); allSafe = false; break; }
        const remainingBookingIds = (await Booking.find({ salonRef: oid(sid) }).select("_id").lean()).map((bk) => bk._id);
        const b = remainingBookingIds.length;
        const t = await Transaction.countDocuments({ salonId: oid(sid) });
        // WalletTransaction has no salonId field (schema: userId/bookingId only)
        // — correctly checked via the salon's own remaining booking IDs instead.
        const wt = remainingBookingIds.length ? await WalletTransaction.countDocuments({ bookingId: { $in: remainingBookingIds } }) : 0;
        const w = await SalonEarnings.countDocuments({ salonId: oid(sid) });
        if (b > 0) { abort(`Draft salon ${sid} still has ${b} Booking(s) remaining — refusing`); allSafe = false; break; }
        if (t > 0) { abort(`Draft salon ${sid} still has ${t} Transaction(s) remaining — refusing`); allSafe = false; break; }
        if (wt > 0) { abort(`Draft salon ${sid} still has ${wt} WalletTransaction(s) remaining — refusing`); allSafe = false; break; }
        if (w > 0) { abort(`Draft salon ${sid} still has ${w} SalonEarnings wallet(s) remaining — refusing`); allSafe = false; break; }
        log(`✅ Pre-check passed for ${sid}: DRAFT, 0 bookings, 0 transactions, 0 wallet-transactions, 0 wallets`);
      }
      if (allSafe && !STOPPED) {
        const result = await Salon.deleteMany({ _id: { $in: DRAFT_TEST_SALON_IDS.map(oid) } });
        report.deletedSalonIds = DRAFT_TEST_SALON_IDS;
        log(`✅ Deleted ${result.deletedCount} DRAFT test salons (expected 7)`);
        if (result.deletedCount !== 7) abort(`Deleted count mismatch: ${result.deletedCount} != 7`);
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // FINAL VERIFICATION
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
  const ridaExists = await Salon.exists({ _id: oid(RIDA_ID) });
  const bothBookingsGone = (await Booking.countDocuments({ _id: { $in: BOOKINGS_TO_DELETE.map((b) => oid(b.bookingId)) } })) === 0;
  const allSevenSalonsGone = (await Salon.countDocuments({ _id: { $in: DRAFT_TEST_SALON_IDS.map(oid) } })) === 0;
  const resolvedGapCount = await FieldAgentEarningPolicyGap.countDocuments({ status: "RESOLVED" });

  const finalVerification = {
    bothP01BookingsGone: bothBookingsGone,
    allSevenDraftSalonsGone: allSevenSalonsGone,
    all20ApprovedSalonsExist: approvedAfter.length === 20,
    ridaStillExists: !!ridaExists,
    walletLedgerCount347: freshCounts.WalletLedger === 347,
    revenueSplitCount5: freshCounts.RevenueSplit === 5,
    gstLedgerCount4: freshCounts.GSTLedger === 4,
    refundCount1: freshCounts.Refund === 1,
    fieldAgentEarningLedgerCount7: freshCounts.FieldAgentEarningLedger === 7,
    policyGapCount20AllResolved: freshCounts.FieldAgentEarningPolicyGap === 20 && resolvedGapCount === 20,
    acquisitionClaimCount4: freshCounts.AcquisitionClaim === 4,
  };

  report.freshCounts = freshCounts;
  report.finalVerification = finalVerification;
  report.stoppedReason = STOPPED;
  report.finalStatus = STOPPED ? "CLEANUP STOPPED" : (Object.values(finalVerification).every(Boolean) ? "CLEANUP COMPLETE" : "CLEANUP COMPLETE WITH ASSERTION FAILURE");

  console.log("\n\n========== FINAL REPORT ==========");
  console.log(JSON.stringify(report, null, 2));

  await mongoose.connection.close();
};

run().catch(async (err) => {
  console.error("FATAL:", err);
  try { await mongoose.connection.close(); } catch {}
  process.exit(1);
});
