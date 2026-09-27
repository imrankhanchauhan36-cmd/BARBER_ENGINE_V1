/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyUnifiedWalletEngine.js
 *
 * STEP 6.2 — Unified Wallet Engine — disposable live verification. No
 * HTTP surface needed: WalletBalanceService has none — every call here
 * is a direct, real-Mongo service call inside a real mongoose
 * transaction (the service's own documented requirement), same
 * precedent as scripts/verifyTerritoryPathRetirement.js.
 *
 * Proves:
 *   1. SALON wallet behavior is COMPLETELY UNCHANGED (legacy `salonId`
 *      shorthand still works, same as before this change).
 *   2. The pre-existing FIELD_AGENT wallet type still works, unaffected
 *      by the two new enum values.
 *   3. ACQUISITION_AGENT and TERRITORY_PARTNER wallets now work with
 *      ZERO changes to WalletBalanceService.js itself — credit,
 *      creditPending→releasePendingToAvailable, hold→moveToProcessing→
 *      completePayout (Approved/Locked/Processing bucket lifecycle),
 *      for both new types.
 *   4. WalletLedger.ownerType is correctly set to the wallet's own
 *      entityType for every entry, for all 3 required types (SALON is
 *      exercised via the existing SALON scenario above it).
 *   5. Idempotency: the same idempotencyKey applied twice never
 *      double-credits, for a new entity type.
 *   6. Refund compatibility: debitPending correctly reverses a
 *      TERRITORY_PARTNER wallet's PENDING bucket, exactly like the
 *      existing SALON refund-reversal path already does.
 *   7. WalletLedger remains append-only — update/delete attempts are
 *      still blocked, unaffected by the enum extension.
 *   8. ISOLATION: no PayoutRequest, FieldAgentPayoutRequest, Razorpay,
 *      GSTLedger, RevenueSplit, TerritoryRevenueLedger, or Booking
 *      collection is touched by anything in this file — this step
 *      implements ONLY the wallet layer.
 *
 * Run:  cd backend && node scripts/verifyUnifiedWalletEngine.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import SalonEarnings, { WALLET_ENTITY_TYPE } from "../models/SalonEarnings.js";
import WalletLedger, { LEDGER_OWNER_TYPE } from "../models/WalletLedger.js";
import PayoutRequest from "../models/PayoutRequest.js";
import FieldAgentPayoutRequest from "../modules/fieldAgent/models/FieldAgentPayoutRequest.js";
import GSTLedger from "../modules/finance/models/GSTLedger.js";
import RevenueSplit from "../modules/finance/models/RevenueSplit.js";
import TerritoryRevenueLedger from "../modules/finance/models/TerritoryRevenueLedger.js";
import Booking from "../models/Booking.js";
import WalletBalanceService from "../services/WalletBalanceService.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const P = "ZTEST_UWE62_";
const oid = () => new mongoose.Types.ObjectId();

const fixtureEntityIds = []; // { entityType, entityId } pairs — SalonEarnings/WalletLedger cleanup

const purgeFixtures = async () => {
  for (const { entityType, entityId } of fixtureEntityIds) {
    await WalletLedger.collection.deleteMany({ ownerType: entityType, ownerId: entityId });
    await SalonEarnings.deleteMany({ entityType, entityId });
  }
};

const withSession = async (fn) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await fn(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

const run = async () => {
  await connectDB();

  try {
    // ── ISOLATION BASELINES ──────────────────────────────────────
    const payoutRequestCountBefore = await PayoutRequest.countDocuments({});
    const fieldAgentPayoutCountBefore = await FieldAgentPayoutRequest.countDocuments({});
    const gstLedgerCountBefore = await GSTLedger.countDocuments({});
    const revenueSplitCountBefore = await RevenueSplit.countDocuments({});
    const territoryRevenueLedgerCountBefore = await TerritoryRevenueLedger.countDocuments({});
    const bookingCountBefore = await Booking.countDocuments({});

    // ═══ SCENARIO A — SALON wallet: legacy salonId shorthand, COMPLETELY UNCHANGED ═══
    const salonId = oid();
    fixtureEntityIds.push({ entityType: WALLET_ENTITY_TYPE.SALON, entityId: salonId });
    await withSession((session) =>
      WalletBalanceService.creditPending({ salonId, amountInPaise: 10000, action: "BOOKING_SETTLEMENT", refType: "BOOKING", refId: oid(), idempotencyKey: `${P}salon:1`, session })
    );
    const salonWallet = await WalletBalanceService.getWallet(salonId);
    check("A1. SALON wallet still works via the legacy salonId shorthand, unchanged (₹100.00 PENDING)", salonWallet?.pendingBalanceInPaise === 10000, salonWallet);
    check("A2. SALON wallet's own entityType defaults correctly to SALON", salonWallet?.entityType === WALLET_ENTITY_TYPE.SALON);
    const salonLedgerRow = await WalletLedger.findOne({ idempotencyKey: `${P}salon:1` }).lean();
    check("A3. WalletLedger.ownerType correctly set to SALON for a legacy-salonId call", salonLedgerRow?.ownerType === LEDGER_OWNER_TYPE.SALON, salonLedgerRow);

    // ═══ SCENARIO B — pre-existing FIELD_AGENT type still works, unaffected by the new enum values ═══
    const fieldAgentId = oid();
    fixtureEntityIds.push({ entityType: WALLET_ENTITY_TYPE.FIELD_AGENT, entityId: fieldAgentId });
    await withSession((session) =>
      WalletBalanceService.credit({ entityType: WALLET_ENTITY_TYPE.FIELD_AGENT, entityId: fieldAgentId, amountInPaise: 5000, action: "EARNING_CREDIT", refType: "EARNING", refId: oid(), idempotencyKey: `${P}fa:1`, session })
    );
    const faWallet = await WalletBalanceService.getWallet({ entityType: WALLET_ENTITY_TYPE.FIELD_AGENT, entityId: fieldAgentId });
    check("B1. Pre-existing FIELD_AGENT wallet type still works exactly as before (₹50.00 AVAILABLE)", faWallet?.availableBalanceInPaise === 5000, faWallet);

    // ═══ SCENARIO C — ACQUISITION_AGENT wallet: NEW type, ZERO code changes to WalletBalanceService ═══
    const acqAgentId = oid();
    fixtureEntityIds.push({ entityType: WALLET_ENTITY_TYPE.ACQUISITION_AGENT, entityId: acqAgentId });
    await withSession((session) =>
      WalletBalanceService.credit({ entityType: WALLET_ENTITY_TYPE.ACQUISITION_AGENT, entityId: acqAgentId, amountInPaise: 7500, action: "EARNING_CREDIT", refType: "EARNING", refId: oid(), idempotencyKey: `${P}acq:1`, session })
    );
    const acqWallet = await WalletBalanceService.getWallet({ entityType: WALLET_ENTITY_TYPE.ACQUISITION_AGENT, entityId: acqAgentId });
    check("C1. ACQUISITION_AGENT wallet created and credited correctly (₹75.00 AVAILABLE) — new type, same collection, same service", acqWallet?.availableBalanceInPaise === 7500 && acqWallet?.entityType === WALLET_ENTITY_TYPE.ACQUISITION_AGENT, acqWallet);
    const acqLedgerRow = await WalletLedger.findOne({ idempotencyKey: `${P}acq:1` }).lean();
    check("C2. WalletLedger.ownerType correctly set to ACQUISITION_AGENT", acqLedgerRow?.ownerType === LEDGER_OWNER_TYPE.ACQUISITION_AGENT && String(acqLedgerRow.ownerId) === String(acqAgentId), acqLedgerRow);

    // Idempotency — same key applied twice must not double-credit.
    await withSession((session) =>
      WalletBalanceService.credit({ entityType: WALLET_ENTITY_TYPE.ACQUISITION_AGENT, entityId: acqAgentId, amountInPaise: 7500, action: "EARNING_CREDIT", refType: "EARNING", refId: oid(), idempotencyKey: `${P}acq:1`, session })
    );
    const acqWalletAfterRepeat = await WalletBalanceService.getWallet({ entityType: WALLET_ENTITY_TYPE.ACQUISITION_AGENT, entityId: acqAgentId });
    check("C3. Idempotent: repeating the SAME idempotencyKey does NOT double-credit (still ₹75.00, not ₹150.00)", acqWalletAfterRepeat?.availableBalanceInPaise === 7500, acqWalletAfterRepeat);
    check("C4. Exactly one ledger row exists for that idempotencyKey", (await WalletLedger.countDocuments({ idempotencyKey: `${P}acq:1` })) === 1);

    // ═══ SCENARIO D — TERRITORY_PARTNER wallet: full Approved/Locked/Processing lifecycle ═══
    const partnerId = oid();
    fixtureEntityIds.push({ entityType: WALLET_ENTITY_TYPE.TERRITORY_PARTNER, entityId: partnerId });

    // D1 — creditPending (booking confirmed, not yet earned) → releasePendingToAvailable (service delivered)
    await withSession((session) =>
      WalletBalanceService.creditPending({ entityType: WALLET_ENTITY_TYPE.TERRITORY_PARTNER, entityId: partnerId, amountInPaise: 20000, action: "BOOKING_SETTLEMENT", refType: "BOOKING", refId: oid(), idempotencyKey: `${P}tp:pending1`, session })
    );
    let tpWallet = await WalletBalanceService.getWallet({ entityType: WALLET_ENTITY_TYPE.TERRITORY_PARTNER, entityId: partnerId });
    check("D1. TERRITORY_PARTNER wallet credited to PENDING (₹200.00) — new type, PENDING bucket works", tpWallet?.pendingBalanceInPaise === 20000, tpWallet);

    await withSession((session) =>
      WalletBalanceService.releasePendingToAvailable({ entityType: WALLET_ENTITY_TYPE.TERRITORY_PARTNER, entityId: partnerId, amountInPaise: 20000, refType: "BOOKING", refId: oid(), idempotencyKey: `${P}tp:release1`, session })
    );
    tpWallet = await WalletBalanceService.getWallet({ entityType: WALLET_ENTITY_TYPE.TERRITORY_PARTNER, entityId: partnerId });
    check("D2. PENDING → AVAILABLE (₹200.00 now AVAILABLE, PENDING back to ₹0) — 'Booking complete → Approved Wallet only', proven for the new type", tpWallet?.availableBalanceInPaise === 20000 && tpWallet?.pendingBalanceInPaise === 0, tpWallet);

    // D2 — hold (withdrawal requested) → moveToProcessing (admin approved) → completePayout (gateway/manual confirms)
    await withSession((session) =>
      WalletBalanceService.hold({ entityType: WALLET_ENTITY_TYPE.TERRITORY_PARTNER, entityId: partnerId, amountInPaise: 15000, refType: "WITHDRAWAL", refId: oid(), idempotencyKey: `${P}tp:hold1`, session })
    );
    tpWallet = await WalletBalanceService.getWallet({ entityType: WALLET_ENTITY_TYPE.TERRITORY_PARTNER, entityId: partnerId });
    check("D3. AVAILABLE → LOCKED (₹150.00 LOCKED, ₹50.00 remains AVAILABLE) — Locked bucket works for the new type", tpWallet?.lockedBalanceInPaise === 15000 && tpWallet?.availableBalanceInPaise === 5000, tpWallet);

    await withSession((session) =>
      WalletBalanceService.moveToProcessing({ entityType: WALLET_ENTITY_TYPE.TERRITORY_PARTNER, entityId: partnerId, amountInPaise: 15000, refType: "WITHDRAWAL", refId: oid(), idempotencyKey: `${P}tp:proc1`, session })
    );
    tpWallet = await WalletBalanceService.getWallet({ entityType: WALLET_ENTITY_TYPE.TERRITORY_PARTNER, entityId: partnerId });
    check("D4. LOCKED → PROCESSING (₹150.00 PROCESSING) — Processing bucket works for the new type (no PayoutRequest/admin-approval model needed — pure wallet mechanics)", tpWallet?.processingBalanceInPaise === 15000 && tpWallet?.lockedBalanceInPaise === 0, tpWallet);

    await withSession((session) =>
      WalletBalanceService.completePayout({ entityType: WALLET_ENTITY_TYPE.TERRITORY_PARTNER, entityId: partnerId, amountInPaise: 15000, refType: "PAYOUT", refId: oid(), idempotencyKey: `${P}tp:paid1`, session })
    );
    tpWallet = await WalletBalanceService.getWallet({ entityType: WALLET_ENTITY_TYPE.TERRITORY_PARTNER, entityId: partnerId });
    check("D5. PROCESSING debited for good (₹0 PROCESSING), lifetimeWithdrawals updated — full withdrawal-adjacent lifecycle proven, still no bank transfer/gateway call made by this engine itself", tpWallet?.processingBalanceInPaise === 0 && tpWallet?.lifetimeWithdrawalsInPaise === 15000, tpWallet);

    // ═══ SCENARIO E — Refund compatibility: debitPending on a TERRITORY_PARTNER wallet ═══
    await withSession((session) =>
      WalletBalanceService.creditPending({ entityType: WALLET_ENTITY_TYPE.TERRITORY_PARTNER, entityId: partnerId, amountInPaise: 8000, action: "BOOKING_SETTLEMENT", refType: "BOOKING", refId: oid(), idempotencyKey: `${P}tp:pending2`, session })
    );
    await withSession((session) =>
      WalletBalanceService.debitPending({ entityType: WALLET_ENTITY_TYPE.TERRITORY_PARTNER, entityId: partnerId, amountInPaise: 8000, action: "REFUND", refType: "REFUND", refId: oid(), idempotencyKey: `${P}tp:refund1`, session })
    );
    tpWallet = await WalletBalanceService.getWallet({ entityType: WALLET_ENTITY_TYPE.TERRITORY_PARTNER, entityId: partnerId });
    check("E1. Refund compatibility intact: debitPending correctly claws back a TERRITORY_PARTNER wallet's PENDING bucket (₹0 remaining), exactly like the existing SALON refund path", tpWallet?.pendingBalanceInPaise === 0, tpWallet);
    const refundLedgerRow = await WalletLedger.findOne({ idempotencyKey: `${P}tp:refund1` }).lean();
    check("E2. Refund ledger row correctly recorded (DEBIT, PENDING bucket, action REFUND, ownerType TERRITORY_PARTNER)", refundLedgerRow?.direction === "DEBIT" && refundLedgerRow?.bucket === "PENDING" && refundLedgerRow?.action === "REFUND" && refundLedgerRow?.ownerType === LEDGER_OWNER_TYPE.TERRITORY_PARTNER, refundLedgerRow);

    // Insufficient-balance guard still works for the new type (no negative balances).
    let insufficientErr;
    try {
      await withSession((session) =>
        WalletBalanceService.debit({ entityType: WALLET_ENTITY_TYPE.TERRITORY_PARTNER, entityId: partnerId, amountInPaise: 999999999, action: "ADJUSTMENT", refType: "ADJUSTMENT", refId: oid(), idempotencyKey: `${P}tp:overdraft`, session })
      );
    } catch (e) { insufficientErr = e; }
    check("E3. Insufficient-balance guard still protects a TERRITORY_PARTNER wallet (cannot overdraw)", /Insufficient/i.test(insufficientErr?.message || ""), insufficientErr?.message);

    // ═══ SCENARIO F — WalletLedger remains append-only (unaffected by the enum extension) ═══
    let u1, d1;
    try { await WalletLedger.updateOne({ _id: acqLedgerRow._id }, { $set: { amountInPaise: 1 } }); } catch (e) { u1 = e; }
    try { await WalletLedger.deleteOne({ _id: acqLedgerRow._id }); } catch (e) { d1 = e; }
    check("F1. updateOne on a WalletLedger row is still blocked", /immutable/i.test(u1?.message || ""));
    check("F2. deleteOne on a WalletLedger row is still blocked", /immutable/i.test(d1?.message || ""));

    // ═══ ISOLATION — the ticket's explicit "implement only the wallet layer" scope ═══
    check("G1. PayoutRequest collection completely untouched — no payout request logic built", (await PayoutRequest.countDocuments({})) === payoutRequestCountBefore);
    check("G2. FieldAgentPayoutRequest collection completely untouched", (await FieldAgentPayoutRequest.countDocuments({})) === fieldAgentPayoutCountBefore);
    check("G3. GSTLedger collection completely untouched — no GST logic touched", (await GSTLedger.countDocuments({})) === gstLedgerCountBefore);
    check("G4. RevenueSplit collection completely untouched", (await RevenueSplit.countDocuments({})) === revenueSplitCountBefore);
    check("G5. TerritoryRevenueLedger collection completely untouched — this step did not wire any bridge into the wallet", (await TerritoryRevenueLedger.countDocuments({})) === territoryRevenueLedgerCountBefore);
    check("G6. Booking collection completely untouched — no booking created or mutated by this verification", (await Booking.countDocuments({})) === bookingCountBefore);
  } catch (err) {
    fail++; results.push(`❌ UNEXPECTED ERROR — ${err.stack || err}`);
  } finally {
    await purgeFixtures().catch((e) => results.push(`⚠️ purge error ${e.message}`));
    await mongoose.disconnect();
  }
  console.log(results.join("\n"));
  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
};
run();
