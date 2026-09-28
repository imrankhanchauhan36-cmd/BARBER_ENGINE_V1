/**
 * BARBER_ENGINE_V1
 * backend/scripts/rebuildSalonWallets.js
 *
 * STEP 4.5B — Salon Wallet Rebuild (P0).
 *
 * BACKGROUND (see STEP 4.5A's own audit for the full evidence trail):
 * an earlier session's cleanup script ran `SalonEarnings.deleteMany({})`
 * with an empty filter instead of an `_id` filter, deleting all 14 real
 * SalonEarnings documents that existed at the time. WalletLedger (the
 * real, append-only transaction history — 344 real rows) was never
 * touched by that mistake and remains fully intact — it is the ONLY
 * source this script reads from.
 *
 * SOURCE OF TRUTH — WalletLedger ONLY. RevenueSplit is deliberately
 * never read here: STEP 4.5A proved by direct data comparison that
 * RevenueSplit only covers ~2.7% of real wallet-credited bookings (5
 * RevenueSplit documents vs 185 real BOOKING_SETTLEMENT credits in
 * WalletLedger) — it was wired into the booking flow long after most
 * of this real wallet history was created, so rebuilding from it would
 * silently ignore ~97% of real transactions and produce wrong balances.
 *
 * WRITE SCOPE — this script creates SalonEarnings documents ONLY.
 * WalletLedger, Booking, SettlementEngine, and WalletBalanceService
 * are never imported for writing (WalletLedger/Booking are read-only
 * imports below) and are never modified in any way.
 *
 * SCOPE — ownerType: "SALON" only, per this ticket's own explicit
 * instruction (Step 2 of the algorithm below). Field-agent-owned
 * wallets (ACQUISITION_AGENT/TERRITORY_PARTNER/FIELD_AGENT) are
 * out of scope for this script.
 *
 * ORPHAN HANDLING — a ledger owner is skipped (not recreated) when its
 * Salon document no longer exists. Cross-checked during STEP 4.5A: of
 * 47 total distinct WalletLedger owners (all ownerTypes), only 9
 * SALON-type owners correspond to a Salon that still exists today; the
 * rest are orphaned test fixtures from earlier tickets in this
 * engagement. Recreating a wallet for a deleted salon would be new
 * clutter, not a restoration.
 *
 * IDEMPOTENCY — aborts immediately (no write of any kind) if
 * SalonEarnings already has any document. Safe to re-run after a
 * failed/partial attempt only once the collection has been emptied
 * again by a human decision — this script will never overwrite or
 * duplicate an existing wallet.
 *
 * FIELDS SET, PER SalonEarnings.js's OWN SCHEMA:
 *   entityType / entityId / salonId — from the ledger owner identity.
 *   availableBalanceInPaise / pendingBalanceInPaise /
 *     lockedBalanceInPaise / processingBalanceInPaise — taken directly
 *     from that owner's MOST RECENT ledger row's own `balanceAfter`
 *     snapshot. Never summed/recomputed from individual entries.
 *   lifetimeWithdrawalsInPaise — SUM(amountInPaise) across that
 *     owner's PAYOUT_SUCCESS entries (the one lifetime-counter field
 *     WalletBalanceService.completePayout() genuinely writes).
 *   lastPayoutAt / lastPayoutAmountInPaise — from that owner's most
 *     recent PAYOUT_SUCCESS entry.
 *   lastTransactionAt — most recent ledger entry's own createdAt.
 *   walletVersion — ledgerCount + 1 (matches applyLedgerEntry's own
 *     `$inc: {walletVersion: 1}` starting from the schema default 1).
 *   lifetimeEarningsInPaise — 0. Confirmed in STEP 4.5A (grepped
 *     WalletBalanceService.js directly) that this field is never
 *     written by the real system for ANY wallet, ever — 0 is the
 *     faithful value a freshly-created real wallet would also have,
 *     not a gap introduced by this script.
 *   status — "ACTIVE" (schema default). Any prior admin FROZEN/BLOCKED
 *     action cannot be recovered from the ledger — the one disclosed,
 *     unrecoverable gap (see STEP 4.5A).
 *   currency — "INR" (schema default, always true in this codebase).
 *
 * DO NOT EXECUTE — per this ticket's own explicit instruction, this
 * script is created but not run, and the database is not touched
 * automatically. Run manually only when explicitly told to:
 *
 *   cd backend
 *   node scripts/rebuildSalonWallets.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import Salon from "../models/Salon.js";
import WalletLedger from "../models/WalletLedger.js";
import SalonEarnings from "../models/SalonEarnings.js";

const OWNER_TYPE_SALON = "SALON";
const ACTION_PAYOUT_SUCCESS = "PAYOUT_SUCCESS";

const run = async () => {
  await connectDB();

  // ── Step 1 — idempotency guard ─────────────────────────────────────
  const existingCount = await SalonEarnings.countDocuments({});
  if (existingCount > 0) {
    console.log(
      `ABORTING — SalonEarnings already has ${existingCount} document(s). ` +
        `This script only runs against an empty collection, to guarantee it can ` +
        `never overwrite or duplicate an existing wallet. Inspect the collection first.`
    );
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log("SalonEarnings is empty — proceeding.");

  // ── Steps 2-6 — read WalletLedger (SALON only), group by ownerId,
  //     derive every field per-owner from that owner's own rows ───────
  const rows = await WalletLedger.aggregate([
    { $match: { ownerType: OWNER_TYPE_SALON } },
    { $sort: { ownerId: 1, createdAt: 1, _id: 1 } },
    {
      $group: {
        _id: "$ownerId",
        count: { $sum: 1 },
        lastCreatedAt: { $last: "$createdAt" },
        lastBalanceAfter: { $last: "$balanceAfter" },
        entries: { $push: { action: "$action", amountInPaise: "$amountInPaise", createdAt: "$createdAt" } },
      },
    },
  ]);

  console.log(`Distinct SALON wallet owners found in WalletLedger: ${rows.length}`);

  // ── Orphan filter — only rebuild wallets for salons that still exist ──
  const ownerIds = rows.map((r) => r._id);
  const existingSalons = await Salon.find({ _id: { $in: ownerIds } }).select("_id").lean();
  const existingSalonIds = new Set(existingSalons.map((s) => String(s._id)));

  const toRebuild = [];
  const skippedOrphans = [];
  for (const r of rows) {
    if (existingSalonIds.has(String(r._id))) toRebuild.push(r);
    else skippedOrphans.push(r._id);
  }

  // ── Step 6 — per-owner derived fields ───────────────────────────────
  const docs = toRebuild.map((r) => {
    const payoutSuccessEntries = r.entries.filter((e) => e.action === ACTION_PAYOUT_SUCCESS);
    const lifetimeWithdrawalsInPaise = payoutSuccessEntries.reduce((sum, e) => sum + e.amountInPaise, 0);
    const lastPayout = payoutSuccessEntries.length
      ? payoutSuccessEntries.reduce((a, b) => (new Date(a.createdAt) > new Date(b.createdAt) ? a : b))
      : null;

    return {
      entityType: OWNER_TYPE_SALON,
      entityId: r._id,
      salonId: r._id,
      currency: "INR",
      availableBalanceInPaise: r.lastBalanceAfter?.availableInPaise ?? 0,
      pendingBalanceInPaise: r.lastBalanceAfter?.pendingInPaise ?? 0,
      lockedBalanceInPaise: r.lastBalanceAfter?.lockedInPaise ?? 0,
      processingBalanceInPaise: r.lastBalanceAfter?.processingInPaise ?? 0,
      lifetimeEarningsInPaise: 0,
      lifetimeWithdrawalsInPaise,
      lastTransactionAt: r.lastCreatedAt,
      lastPayoutAt: lastPayout?.createdAt ?? null,
      lastPayoutAmountInPaise: lastPayout?.amountInPaise ?? 0,
      status: "ACTIVE",
      walletVersion: r.count + 1,
    };
  });

  // ── Step 7 — create SalonEarnings documents ─────────────────────────
  let inserted = [];
  if (docs.length > 0) {
    inserted = await SalonEarnings.insertMany(docs, { ordered: true });
  }

  // ── Step 8 — print summary (exact fields the ticket asks for) ──────
  const totals = docs.reduce(
    (acc, d) => {
      acc.available += d.availableBalanceInPaise;
      acc.pending += d.pendingBalanceInPaise;
      acc.locked += d.lockedBalanceInPaise;
      acc.processing += d.processingBalanceInPaise;
      return acc;
    },
    { available: 0, pending: 0, locked: 0, processing: 0 }
  );

  console.log("");
  console.log("──────────────────────────────────────────");
  console.log("SALON WALLET REBUILD — SUMMARY");
  console.log("──────────────────────────────────────────");
  console.log(`Wallets recreated:      ${inserted.length}`);
  console.log(`Skipped orphan salons:  ${skippedOrphans.length}`);
  console.log(`Total available:        ${totals.available} paise`);
  console.log(`Total pending:          ${totals.pending} paise`);
  console.log(`Total locked:           ${totals.locked} paise`);
  console.log(`Total processing:       ${totals.processing} paise`);
  console.log("──────────────────────────────────────────");
  if (skippedOrphans.length > 0) {
    console.log("Skipped owner IDs (Salon no longer exists):");
    console.log(skippedOrphans.map(String).join(", "));
  }

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
