/**
 * STRICTLY READ-ONLY follow-up: isolates the AVAILABLE bucket timeline
 * for TESTING SALON 2 to find exactly where the stored balanceAfter
 * snapshot diverges from what the ledger row itself would produce.
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../../config/db.js";
import WalletLedger from "../../models/WalletLedger.js";

const run = async () => {
  await connectDB();
  const rows = await WalletLedger.find({ ownerType: "SALON", ownerId: new mongoose.Types.ObjectId("6a28483c3b043bc85838a2d3"), bucket: "AVAILABLE" }).sort({ createdAt: 1 }).lean();
  console.log(`Total AVAILABLE-bucket rows: ${rows.length}`);
  let running = 0;
  let prevSnapshot = 0;
  for (const r of rows) {
    const delta = r.direction === "CREDIT" ? r.amountInPaise : -r.amountInPaise;
    running += delta;
    const snapshot = r.balanceAfter?.availableInPaise ?? null;
    const expectedSnapshot = prevSnapshot + delta;
    const jumpUnexplained = snapshot !== null && expectedSnapshot !== snapshot;
    console.log(JSON.stringify({
      createdAt: r.createdAt, direction: r.direction, amount: r.amountInPaise, action: r.action,
      idempotencyKey: r.idempotencyKey, referenceId: r.entityId ? String(r.entityId) : null,
      runningFromLedgerOnly: running,
      prevSnapshot, expectedSnapshot, actualSnapshot: snapshot,
      jumpUnexplained,
    }));
    prevSnapshot = snapshot;
  }
  await mongoose.connection.close();
};
run().catch(async (e) => { console.error(e); try { await mongoose.connection.close(); } catch {} process.exit(1); });
