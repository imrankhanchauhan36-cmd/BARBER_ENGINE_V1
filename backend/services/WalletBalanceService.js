import SalonEarnings from "../models/SalonEarnings.js";
import WalletLedger, {
  LEDGER_BUCKET,
  LEDGER_DIRECTION,
} from "../models/WalletLedger.js";

//////////////////////////////////////////////////////////////
// 🔥 WALLET BALANCE SERVICE
//
// ⚠️ THIS IS THE ONLY FILE ALLOWED TO WRITE TO SalonEarnings'
// *InPaise fields. Every other file — controllers, jobs,
// webhooks — must go through one of the methods below.
//
// Every method:
//   1. Accepts an existing mongoose `session` (most callers —
//      confirmBooking, completeService, cancelBooking, payout
//      controllers — already have one open; this service never
//      starts its own, so it composes into the caller's atomic
//      transaction instead of creating a second one).
//   2. Writes exactly one WalletLedger entry per bucket touched.
//   3. Uses an atomic conditional $inc (the filter itself checks
//      sufficient balance) instead of read-then-write, so two
//      concurrent debits against the same wallet cannot both
//      "succeed" and drive the balance negative.
//   4. Is idempotent when called with the same idempotencyKey —
//      a retried webhook or a retried request is a safe no-op,
//      not a double-credit.
//////////////////////////////////////////////////////////////

const integerOrThrow = (amountInPaise) => {
  if (!Number.isInteger(amountInPaise) || amountInPaise <= 0) {
    throw Object.assign(
      new Error("amountInPaise must be a positive integer"),
      { status: 400 }
    );
  }
};

/**
 * Returns the existing ledger entry's snapshot if idempotencyKey
 * was already used — null if this is a fresh key.
 */
const findExistingByIdempotencyKey = async (idempotencyKey, session) => {
  if (!idempotencyKey) return null;
  return WalletLedger.findOne({ idempotencyKey }).session(session).lean();
};

/**
 * Writes a single ledger entry + the corresponding bucket $inc,
 * atomically, with idempotency protection. Internal helper — all
 * public methods below call this once or twice (hold/release/etc
 * touch two buckets, so they call this twice in the same session).
 */
const applyLedgerEntry = async ({
  salonId,
  direction,
  bucket,
  amountInPaise,
  action,
  entityType,
  entityId,
  idempotencyKey,
  triggeredBy = "SYSTEM",
  triggeredById = null,
  remarks = null,
  session,
}) => {
  integerOrThrow(amountInPaise);

  // ── Idempotency short-circuit ──────────────────────────────
  if (idempotencyKey) {
    const existing = await findExistingByIdempotencyKey(idempotencyKey, session);
    if (existing) {
      // Already applied — safe no-op, return the prior result.
      return { ledgerEntry: existing, wallet: null, idempotent: true };
    }
  }

  const bucketField = {
    [LEDGER_BUCKET.AVAILABLE]:  "availableBalanceInPaise",
    [LEDGER_BUCKET.PENDING]:    "pendingBalanceInPaise",
    [LEDGER_BUCKET.LOCKED]:     "lockedBalanceInPaise",
    [LEDGER_BUCKET.PROCESSING]: "processingBalanceInPaise",
  }[bucket];

  const delta = direction === LEDGER_DIRECTION.CREDIT ? amountInPaise : -amountInPaise;

  // ── Atomic conditional update ──────────────────────────────
  // For DEBIT, the filter requires the bucket to already have
  // enough balance — if not, findOneAndUpdate matches nothing and
  // returns null, so two concurrent debits can never both pass.
  const filter = { salonId };
  if (direction === LEDGER_DIRECTION.DEBIT) {
    filter[bucketField] = { $gte: amountInPaise };
  }

  const update = {
    $inc: { [bucketField]: delta, walletVersion: 1 },
    $set: { lastTransactionAt: new Date() },
  };
  if (direction === LEDGER_DIRECTION.CREDIT) {
    update.$setOnInsert = { salonId };
  }

  const wallet = await SalonEarnings.findOneAndUpdate(
    filter,
    update,
    {
      new: true,
      session,
      upsert: direction === LEDGER_DIRECTION.CREDIT, // never upsert on debit — wallet must already exist with funds
    }
  );

  if (!wallet) {
    throw Object.assign(
      new Error(`Insufficient ${bucket} balance for this operation`),
      { status: 400 }
    );
  }

  const balanceAfter = {
    availableInPaise:  wallet.availableBalanceInPaise,
    pendingInPaise:    wallet.pendingBalanceInPaise,
    lockedInPaise:     wallet.lockedBalanceInPaise,
    processingInPaise: wallet.processingBalanceInPaise,
  };

  try {
    const [ledgerEntry] = await WalletLedger.create(
      [{
        salonId, direction, bucket, action, amountInPaise,
        entityType, entityId, idempotencyKey,
        triggeredBy, triggeredById, remarks, balanceAfter,
      }],
      { session }
    );
    return { ledgerEntry, wallet, idempotent: false };
  } catch (err) {
    // Duplicate idempotencyKey raced in between our check and
    // insert (rare, but possible under concurrent retries) —
    // treat as the same safe no-op rather than letting the
    // wallet $inc above stand uncommitted-but-unlogged. Since this
    // whole function runs inside the caller's session, the $inc
    // above will be rolled back along with everything else when
    // the caller aborts the transaction on this thrown error.
    if (err?.code === 11000 && idempotencyKey) {
      const existing = await findExistingByIdempotencyKey(idempotencyKey, session);
      if (existing) return { ledgerEntry: existing, wallet: null, idempotent: true };
    }
    throw err;
  }
};

//////////////////////////////////////////////////////////////
// 🚀 PUBLIC METHODS
//////////////////////////////////////////////////////////////

const WalletBalanceService = {
  /**
   * Credit AVAILABLE balance directly. Used for: bonus,
   * payout-failed-reversal, and any other case where money is
   * immediately withdrawable with no delivery condition attached.
   * NOT used for booking settlement anymore — see creditPending.
   */
  credit: async ({ salonId, amountInPaise, action, entityType, entityId, idempotencyKey, session, triggeredBy, triggeredById, remarks }) => {
    return applyLedgerEntry({
      salonId, amountInPaise, action, entityType, entityId, idempotencyKey,
      triggeredBy, triggeredById, remarks, session,
      direction: LEDGER_DIRECTION.CREDIT,
      bucket:    LEDGER_BUCKET.AVAILABLE,
    });
  },

  /**
   * Credit PENDING balance. Used for: booking payment confirmed
   * (confirmBooking) — money is real and owed to the salon, but
   * NOT withdrawable until the service is actually delivered.
   * Mirrors `credit` exactly except the bucket.
   *
   * NOTE: caller must pass action: "BOOKING_SETTLEMENT" and
   * entityType: "BOOKING" — these are the only values in the
   * WalletLedger enum for this scenario (verified against
   * models/WalletLedger.js — LEDGER_ACTION / LEDGER_ENTITY_TYPE).
   */
  creditPending: async ({ salonId, amountInPaise, action, entityType, entityId, idempotencyKey, session, triggeredBy, triggeredById, remarks }) => {
    return applyLedgerEntry({
      salonId, amountInPaise, action, entityType, entityId, idempotencyKey,
      triggeredBy, triggeredById, remarks, session,
      direction: LEDGER_DIRECTION.CREDIT,
      bucket:    LEDGER_BUCKET.PENDING,
    });
  },

  /**
   * Service delivered: PENDING → AVAILABLE. Called from
   * completeService() / forceComplete() once the booking is
   * verified COMPLETED — this is the moment the salon actually
   * earns the right to withdraw the money that's been sitting in
   * PENDING since payment. Two ledger rows (one per bucket), same
   * pattern as hold/release/moveToProcessing below.
   *
   * ✅ FIX — action was "SERVICE_SETTLEMENT", which does not exist
   * in LEDGER_ACTION (verified against models/WalletLedger.js).
   * This threw a Mongoose enum validation error on every call.
   * The only valid booking-related action in the enum is
   * "BOOKING_SETTLEMENT" — used here for both the debit and
   * credit leg, same as creditPending uses for its credit leg.
   */
  releasePendingToAvailable: async ({ salonId, amountInPaise, entityType, entityId, idempotencyKey, session, triggeredBy, triggeredById, remarks }) => {
    await applyLedgerEntry({
      salonId, amountInPaise, entityType, entityId, session, triggeredBy, triggeredById, remarks,
      action: "BOOKING_SETTLEMENT", direction: LEDGER_DIRECTION.DEBIT,  bucket: LEDGER_BUCKET.PENDING,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:pending` : null,
    });
    return applyLedgerEntry({
      salonId, amountInPaise, entityType, entityId, session, triggeredBy, triggeredById, remarks,
      action: "BOOKING_SETTLEMENT", direction: LEDGER_DIRECTION.CREDIT, bucket: LEDGER_BUCKET.AVAILABLE,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:available` : null,
    });
  },

  /**
   * Debit AVAILABLE balance directly. Used for: penalty,
   * adjustment (negative correction), commission reversal.
   * NOT used for withdrawal flow — that's hold/release/etc below.
   */
  debit: async ({ salonId, amountInPaise, action, entityType, entityId, idempotencyKey, session, triggeredBy, triggeredById, remarks }) => {
    return applyLedgerEntry({
      salonId, amountInPaise, action, entityType, entityId, idempotencyKey,
      triggeredBy, triggeredById, remarks, session,
      direction: LEDGER_DIRECTION.DEBIT,
      bucket:    LEDGER_BUCKET.AVAILABLE,
    });
  },

  /**
   * Debit PENDING balance directly. Used for: cancelling a booking
   * whose payment was credited to PENDING (via creditPending at
   * confirm time) but hasn't yet been released to AVAILABLE (via
   * releasePendingToAvailable at service completion) — the refund
   * claws back money that was never released, so it must come out
   * of PENDING, not AVAILABLE. Mirrors `debit` exactly except the
   * bucket. Atomic conditional $inc (see applyLedgerEntry) means
   * this throws rather than silently under/over-drawing if PENDING
   * doesn't have enough balance for the requested amount.
   */
  debitPending: async ({ salonId, amountInPaise, action, entityType, entityId, idempotencyKey, session, triggeredBy, triggeredById, remarks }) => {
    return applyLedgerEntry({
      salonId, amountInPaise, action, entityType, entityId, idempotencyKey,
      triggeredBy, triggeredById, remarks, session,
      direction: LEDGER_DIRECTION.DEBIT,
      bucket:    LEDGER_BUCKET.PENDING,
    });
  },

  /**
   * Withdrawal requested: AVAILABLE → LOCKED. Two ledger rows
   * (one per bucket) so each bucket's change is independently
   * auditable, both inside the same caller session.
   */
  hold: async ({ salonId, amountInPaise, entityType, entityId, idempotencyKey, session, triggeredBy, triggeredById, remarks }) => {
    await applyLedgerEntry({
      salonId, amountInPaise, entityType, entityId, session, triggeredBy, triggeredById, remarks,
      action: "WITHDRAWAL_HOLD", direction: LEDGER_DIRECTION.DEBIT,  bucket: LEDGER_BUCKET.AVAILABLE,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:available` : null,
    });
    return applyLedgerEntry({
      salonId, amountInPaise, entityType, entityId, session, triggeredBy, triggeredById, remarks,
      action: "WITHDRAWAL_HOLD", direction: LEDGER_DIRECTION.CREDIT, bucket: LEDGER_BUCKET.LOCKED,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:locked` : null,
    });
  },

  /**
   * Withdrawal rejected or cancelled before processing:
   * LOCKED → AVAILABLE (money goes back where it came from).
   */
  release: async ({ salonId, amountInPaise, entityType, entityId, idempotencyKey, session, triggeredBy, triggeredById, remarks }) => {
    await applyLedgerEntry({
      salonId, amountInPaise, entityType, entityId, session, triggeredBy, triggeredById, remarks,
      action: "WITHDRAWAL_RELEASE", direction: LEDGER_DIRECTION.DEBIT,  bucket: LEDGER_BUCKET.LOCKED,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:locked` : null,
    });
    return applyLedgerEntry({
      salonId, amountInPaise, entityType, entityId, session, triggeredBy, triggeredById, remarks,
      action: "WITHDRAWAL_RELEASE", direction: LEDGER_DIRECTION.CREDIT, bucket: LEDGER_BUCKET.AVAILABLE,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:available` : null,
    });
  },

  /**
   * Admin approved the withdrawal: LOCKED → PROCESSING
   * (payout now in flight — manual transfer or gateway call).
   */
  moveToProcessing: async ({ salonId, amountInPaise, entityType, entityId, idempotencyKey, session, triggeredBy, triggeredById, remarks }) => {
    await applyLedgerEntry({
      salonId, amountInPaise, entityType, entityId, session, triggeredBy, triggeredById, remarks,
      action: "WITHDRAWAL_PROCESSING", direction: LEDGER_DIRECTION.DEBIT,  bucket: LEDGER_BUCKET.LOCKED,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:locked` : null,
    });
    return applyLedgerEntry({
      salonId, amountInPaise, entityType, entityId, session, triggeredBy, triggeredById, remarks,
      action: "WITHDRAWAL_PROCESSING", direction: LEDGER_DIRECTION.CREDIT, bucket: LEDGER_BUCKET.PROCESSING,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:processing` : null,
    });
  },

  /**
   * Payout confirmed successful (manual UTR entered, or gateway
   * webhook confirms): PROCESSING bucket debited for good, money
   * has left the platform. lifetimeWithdrawals increments.
   */
  completePayout: async ({ salonId, amountInPaise, entityType, entityId, idempotencyKey, session, triggeredBy, triggeredById, remarks }) => {
    const result = await applyLedgerEntry({
      salonId, amountInPaise, entityType, entityId, idempotencyKey, session, triggeredBy, triggeredById, remarks,
      action: "PAYOUT_SUCCESS", direction: LEDGER_DIRECTION.DEBIT, bucket: LEDGER_BUCKET.PROCESSING,
    });
    if (!result.idempotent) {
      await SalonEarnings.findOneAndUpdate(
        { salonId },
        {
          $inc: { lifetimeWithdrawalsInPaise: amountInPaise },
          $set: { lastPayoutAt: new Date(), lastPayoutAmountInPaise: amountInPaise },
        },
        { session }
      );
    }
    return result;
  },

  /**
   * Payout failed at the gateway (or manual transfer failed):
   * PROCESSING → AVAILABLE (money goes back, owner can retry).
   */
  failPayout: async ({ salonId, amountInPaise, entityType, entityId, idempotencyKey, session, triggeredBy, triggeredById, remarks }) => {
    await applyLedgerEntry({
      salonId, amountInPaise, entityType, entityId, session, triggeredBy, triggeredById, remarks,
      action: "PAYOUT_FAILED_REVERSAL", direction: LEDGER_DIRECTION.DEBIT,  bucket: LEDGER_BUCKET.PROCESSING,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:processing` : null,
    });
    return applyLedgerEntry({
      salonId, amountInPaise, entityType, entityId, session, triggeredBy, triggeredById, remarks,
      action: "PAYOUT_FAILED_REVERSAL", direction: LEDGER_DIRECTION.CREDIT, bucket: LEDGER_BUCKET.AVAILABLE,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:available` : null,
    });
  },

  /**
   * Convenience read — always go through this rather than
   * inlining `SalonEarnings.findOne()` everywhere, so any future
   * derived/computed field stays in one place.
   */
  getWallet: async (salonId, session = null) => {
    const query = SalonEarnings.findOne({ salonId });
    if (session) query.session(session);
    return query.lean();
  },
};

export default WalletBalanceService;