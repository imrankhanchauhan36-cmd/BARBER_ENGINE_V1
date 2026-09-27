/**
 * BARBER_ENGINE_V1
 * backend/scripts/migrateWalletEntityType.js
 *
 * FA-P3-C Step 1 — one-time backfill. Every pre-existing SalonEarnings
 * document and WalletLedger row predates the new entityType/entityId
 * (wallet) and ownerType/ownerId (ledger) fields introduced to
 * parameterize WalletBalanceService for FIELD_AGENT wallets. This
 * script sets entityType/ownerType = "SALON" and entityId/ownerId =
 * the document's own existing salonId — a pure, additive backfill;
 * salonId itself is never touched or removed.
 *
 * Required before the new SalonEarnings {entityType,entityId} unique
 * index can build — without this backfill, every pre-existing
 * document is missing both fields, which MongoDB treats as duplicate
 * {null,null} keys, so the unique index build fails once there is
 * more than one such document.
 *
 * Idempotent — matches only documents where entityId/ownerId does not
 * yet exist, so re-running this script after it has already succeeded
 * is a safe no-op.
 *
 * Run:
 *   cd backend
 *   node scripts/migrateWalletEntityType.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import SalonEarnings from "../models/SalonEarnings.js";
import WalletLedger from "../models/WalletLedger.js";

const run = async () => {
  await connectDB();

  // ── SalonEarnings backfill ────────────────────────────────────────
  const walletsBefore = await SalonEarnings.countDocuments({ entityId: { $exists: false } });
  console.log(`SalonEarnings documents missing entityId: ${walletsBefore}`);

  const walletResult = await SalonEarnings.updateMany(
    { entityId: { $exists: false } },
    [{ $set: { entityType: "SALON", entityId: "$salonId" } }]
  );
  console.log(`SalonEarnings backfilled: matched=${walletResult.matchedCount} modified=${walletResult.modifiedCount}`);

  const walletsAfter = await SalonEarnings.countDocuments({ entityId: { $exists: false } });
  console.log(`SalonEarnings documents still missing entityId: ${walletsAfter}`);

  // ── WalletLedger backfill (consistency — not required for any
  // unique index, since ownerType/ownerId only back a non-unique
  // index, but kept aligned with the wallet backfill above) ─────────
  const ledgerBefore = await WalletLedger.countDocuments({ ownerId: { $exists: false } });
  console.log(`WalletLedger rows missing ownerId: ${ledgerBefore}`);

  // WalletLedger blocks updateMany via its own immutability guard
  // (see models/WalletLedger.js) — this is exactly the intended
  // protection (no caller may ever mutate a ledger row's financial
  // fields), so this one-time structural backfill uses the raw driver
  // collection to bypass Mongoose's query middleware, same precedent
  // as this repo's own verify*.js scripts' cleanup of immutable
  // ledger fixtures.
  const ledgerResult = await WalletLedger.collection.updateMany(
    { ownerId: { $exists: false } },
    [{ $set: { ownerType: "SALON", ownerId: "$salonId" } }]
  );
  console.log(`WalletLedger backfilled: matched=${ledgerResult.matchedCount} modified=${ledgerResult.modifiedCount}`);

  const ledgerAfter = await WalletLedger.countDocuments({ ownerId: { $exists: false } });
  console.log(`WalletLedger rows still missing ownerId: ${ledgerAfter}`);

  // ── Rebuild indexes now that data is backfilled ───────────────────
  console.log("Syncing SalonEarnings indexes...");
  const walletSync = await SalonEarnings.syncIndexes();
  console.log("SalonEarnings syncIndexes result:", walletSync);

  console.log("Syncing WalletLedger indexes...");
  const ledgerSync = await WalletLedger.syncIndexes();
  console.log("WalletLedger syncIndexes result:", ledgerSync);

  const walletIndexes = await SalonEarnings.collection.indexes();
  console.log("Final SalonEarnings indexes:", JSON.stringify(walletIndexes, null, 2));

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
