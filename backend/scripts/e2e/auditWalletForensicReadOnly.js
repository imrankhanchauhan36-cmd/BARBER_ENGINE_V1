/**
 * STEP 1A — WALLET RECONCILIATION FORENSIC AUDIT. STRICTLY READ-ONLY.
 * No .create(/.save(/.update*(/.delete*(/$set anywhere in this file.
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../../config/db.js";
import SalonEarnings from "../../models/SalonEarnings.js";
import WalletLedger from "../../models/WalletLedger.js";
import Booking from "../../models/Booking.js";
import Transaction from "../../models/Transaction.js";
import RevenueSplit from "../../modules/finance/models/RevenueSplit.js";
import GSTLedger from "../../modules/finance/models/GSTLedger.js";
import Refund from "../../models/Refund.js";

const section = (t) => console.log(`\n${"=".repeat(10)} ${t} ${"=".repeat(10)}`);
const j = (x) => JSON.stringify(x);

const forensics = async (entityId, label) => {
  section(`${label} — entity ${entityId}`);

  const wallet = await SalonEarnings.findOne({ entityType: "SALON", entityId: new mongoose.Types.ObjectId(entityId) }).lean();
  console.log("Current SalonEarnings document:", j(wallet));

  const rows = await WalletLedger.find({ ownerType: "SALON", ownerId: new mongoose.Types.ObjectId(entityId) }).sort({ createdAt: 1 }).lean();
  console.log(`\nTotal WalletLedger rows: ${rows.length}`);

  // ── PART B: replay by bucket ──
  const buckets = { AVAILABLE: { credit: 0, debit: 0 }, PENDING: { credit: 0, debit: 0 }, LOCKED: { credit: 0, debit: 0 }, PROCESSING: { credit: 0, debit: 0 } };
  for (const r of rows) {
    const b = buckets[r.bucket];
    if (!b) continue;
    if (r.direction === "CREDIT") b.credit += r.amountInPaise;
    else b.debit += r.amountInPaise;
  }
  section(`${label} — PART B: replayed bucket totals vs stored`);
  for (const bucketName of Object.keys(buckets)) {
    const net = buckets[bucketName].credit - buckets[bucketName].debit;
    const storedField = { AVAILABLE: "availableBalanceInPaise", PENDING: "pendingBalanceInPaise", LOCKED: "lockedBalanceInPaise", PROCESSING: "processingBalanceInPaise" }[bucketName];
    const stored = wallet?.[storedField] ?? 0;
    console.log(j({ bucket: bucketName, totalCredit: buckets[bucketName].credit, totalDebit: buckets[bucketName].debit, replayedNet: net, storedBalance: stored, matches: net === stored, diff: stored - net }));
  }

  // ── PART A (detail) + PART C (reference trace) — every row ──
  section(`${label} — PART A/C: every WalletLedger row, full detail + reference trace`);
  const bookingIdsSeen = new Set();
  for (const r of rows) {
    let bookingSummary = null;
    if (r.entityType === "BOOKING" && r.entityId) {
      const b = await Booking.findById(r.entityId).select("status totalAmountInPaise serviceAmountInPaise commissionAmountInPaise gstAmountInPaise completedAt cancelledAt").lean();
      bookingSummary = b ? { status: b.status, totalAmountInPaise: b.totalAmountInPaise, serviceAmountInPaise: b.serviceAmountInPaise, commissionAmountInPaise: b.commissionAmountInPaise, gstAmountInPaise: b.gstAmountInPaise } : "BOOKING NOT FOUND";
      bookingIdsSeen.add(String(r.entityId));
    }
    console.log(j({
      _id: String(r._id),
      bucket: r.bucket,
      direction: r.direction,
      amountInPaise: r.amountInPaise,
      action: r.action,
      referenceType: r.entityType,
      referenceId: r.entityId ? String(r.entityId) : null,
      idempotencyKey: r.idempotencyKey,
      triggeredBy: r.triggeredBy,
      remarks: r.remarks,
      balanceAfter: r.balanceAfter,
      createdAt: r.createdAt,
      linkedBooking: bookingSummary,
    }));
  }

  // ── PART E: booking-level reconciliation summary ──
  section(`${label} — PART E: booking-level summary for every linked booking`);
  for (const bid of bookingIdsSeen) {
    const booking = await Booking.findById(bid).select("status totalAmountInPaise serviceAmountInPaise commissionAmountInPaise gstAmountInPaise completedAt cancelledAt refundAmountInPaise cancellationPolicy").lean();
    const txn = await Transaction.findOne({ bookingId: bid }).select("amount commission payoutAmount status").lean();
    const ledgerForBooking = rows.filter((r) => r.entityType === "BOOKING" && String(r.entityId) === bid);
    const refund = await Refund.findOne({ bookingId: bid }).select("amountInPaise refundStatus").lean();
    console.log(j({
      bookingId: bid,
      status: booking?.status,
      serviceAmountInPaise: booking?.serviceAmountInPaise,
      commissionAmountInPaise: booking?.commissionAmountInPaise,
      gstAmountInPaise: booking?.gstAmountInPaise,
      totalAmountInPaise: booking?.totalAmountInPaise,
      cancellationPolicy: booking?.cancellationPolicy,
      refundAmountInPaise: booking?.refundAmountInPaise,
      txnAmount: txn?.amount ?? null,
      txnCommission: txn?.commission ?? null,
      txnPayoutAmount: txn?.payoutAmount ?? null,
      ledgerRowsForThisBooking: ledgerForBooking.map((r) => ({ bucket: r.bucket, direction: r.direction, amount: r.amountInPaise, action: r.action })),
      refund: refund ? { amountInPaise: refund.amountInPaise, status: refund.refundStatus } : null,
    }));
  }

  return { wallet, rows, buckets };
};

const run = async () => {
  await connectDB();

  const t2 = await forensics("6a28483c3b043bc85838a2d3", "TESTING SALON 2");
  const p01 = await forensics("6aa2701ad0104a244ab02749", "P0-1 TEST SALON");

  // ── PART F: timeline — first divergence point for TESTING SALON 2's PENDING bucket (the bucket likely holding the discrepancy) ──
  section("TESTING SALON 2 — PART F: chronological running balance per bucket, first divergence vs stored");
  const runningByBucket = { AVAILABLE: 0, PENDING: 0, LOCKED: 0, PROCESSING: 0 };
  for (const r of t2.rows) {
    const delta = r.direction === "CREDIT" ? r.amountInPaise : -r.amountInPaise;
    runningByBucket[r.bucket] = (runningByBucket[r.bucket] || 0) + delta;
    console.log(j({
      createdAt: r.createdAt,
      bucket: r.bucket,
      direction: r.direction,
      amountInPaise: r.amountInPaise,
      runningBalanceThisBucket: runningByBucket[r.bucket],
      storedBalanceAfterOnRow: r.balanceAfter,
      action: r.action,
      refId: r.entityId ? String(r.entityId) : null,
    }));
  }

  await mongoose.connection.close();
};

run().catch(async (err) => {
  console.error("FORENSIC AUDIT FAILED:", err);
  try { await mongoose.connection.close(); } catch {}
  process.exit(1);
});
