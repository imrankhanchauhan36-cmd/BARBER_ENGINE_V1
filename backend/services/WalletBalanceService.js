import SalonEarnings, { WALLET_ENTITY_TYPE } from "../models/SalonEarnings.js";
import WalletLedger, {
  LEDGER_BUCKET,
  LEDGER_DIRECTION,
} from "../models/WalletLedger.js";
import { Errors } from "../utils/response.js";

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
//
// FA-P3-C Step 1 — PARAMETERIZED BY WALLET OWNER (SALON |
// FIELD_AGENT). This is the SAME collection (SalonEarnings), the
// SAME ledger (WalletLedger), and the SAME methods — no second
// wallet engine was created. Two distinct parameter pairs matter here
// and must never be confused:
//   - entityType / entityId — WHO owns this wallet (SALON or
//     FIELD_AGENT + their id). New in this phase.
//   - refType / refId — WHAT this specific transaction is ABOUT
//     (a Booking, a Withdrawal, ...). This is what every pre-existing
//     caller in this codebase used to pass as "entityType"/"entityId"
//     before this phase — renamed here ONLY at the JS parameter level
//     to avoid colliding with the new owner-identity meaning of that
//     name. The underlying WalletLedger DB fields are UNCHANGED
//     (still literally named entityType/entityId there); only this
//     service's own parameter names shifted.
//   - Legacy `salonId` is still accepted everywhere and is 100%
//     backward compatible: every pre-existing SALON call site in this
//     codebase needs zero changes to keep working exactly as before —
//     omitting entityType/entityId defaults to
//     { entityType: "SALON", entityId: salonId }.
//////////////////////////////////////////////////////////////

// Generous ceiling — ₹1000 crore in paise. Verified against the real
// database before adding this: the largest amount ever recorded here
// is ~₹2,448 (244,820 paise), so this bound is nowhere near legitimate
// data; it exists purely to catch a garbage/corrupted/malicious value
// (e.g. an upstream calculation bug producing an absurd number) before
// it silently corrupts a wallet balance.
const MAX_AMOUNT_IN_PAISE = 1_000_000_000_000;

const integerOrThrow = (amountInPaise) => {
  if (!Number.isInteger(amountInPaise) || amountInPaise <= 0) {
    throw Errors.badRequest("amountInPaise must be a positive integer");
  }
  if (amountInPaise > MAX_AMOUNT_IN_PAISE) {
    throw Errors.badRequest(`amountInPaise exceeds the sanity ceiling (${MAX_AMOUNT_IN_PAISE})`);
  }
};

/**
 * FA-P3-C Step 1 — the single place that resolves "which wallet is
 * this call about", accepting either the new explicit
 * { entityType, entityId } or the legacy { salonId } shorthand (never
 * both required — salonId alone still fully identifies a SALON
 * wallet, exactly as before this phase). Returns the normalized
 * identity PLUS a backward-compatible `salonId` (populated only for
 * entityType SALON, null otherwise) so every pre-existing salonId-based
 * read elsewhere in the codebase keeps working unchanged.
 */
const resolveOwner = ({ salonId, entityType, entityId }) => {
  const resolvedType = entityType || WALLET_ENTITY_TYPE.SALON;
  const resolvedId = entityId || salonId;

  if (!Object.values(WALLET_ENTITY_TYPE).includes(resolvedType)) {
    throw Errors.badRequest(`Unknown wallet entityType: ${resolvedType}`);
  }
  if (!resolvedId) {
    throw Errors.badRequest("entityId (or legacy salonId) is required");
  }

  return {
    entityType: resolvedType,
    entityId: resolvedId,
    salonId: resolvedType === WALLET_ENTITY_TYPE.SALON ? resolvedId : null,
  };
};

/**
 * Every mutating method in this service composes into the caller's
 * existing mongoose transaction (see header note) — it never starts
 * its own. Without an active transaction, the atomic conditional
 * $inc still protects each individual bucket update, but the
 * cross-leg atomicity that two-leg methods (hold, release,
 * releasePendingToAvailable, etc.) depend on silently vanishes: if
 * the second leg fails, the first leg's effect has nothing to roll
 * it back. This has never been true of any real caller (verified
 * against every call site in the codebase), but nothing enforced it
 * — a future caller forgetting `session` would fail this way
 * silently instead of loudly.
 */
const sessionOrThrow = (session) => {
  if (!session || typeof session.inTransaction !== "function" || !session.inTransaction()) {
    throw Errors.internal("WalletBalanceService requires an active mongoose transaction session");
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
  entityType,
  entityId,
  direction,
  bucket,
  amountInPaise,
  action,
  refType,
  refId,
  idempotencyKey,
  triggeredBy = "SYSTEM",
  triggeredById = null,
  remarks = null,
  session,
}) => {
  integerOrThrow(amountInPaise);
  const owner = resolveOwner({ salonId, entityType, entityId });
  sessionOrThrow(session);

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

  if (!bucketField) {
    throw Errors.internal(`Unknown wallet bucket: ${bucket}`);
  }

  const delta = direction === LEDGER_DIRECTION.CREDIT ? amountInPaise : -amountInPaise;

  // ── Atomic conditional update ──────────────────────────────
  // For DEBIT, the filter requires the bucket to already have
  // enough balance — if not, findOneAndUpdate matches nothing and
  // returns null, so two concurrent debits can never both pass.
  const filter = { entityType: owner.entityType, entityId: owner.entityId };
  if (direction === LEDGER_DIRECTION.DEBIT) {
    filter[bucketField] = { $gte: amountInPaise };
  }

  const update = {
    $inc: { [bucketField]: delta, walletVersion: 1 },
    $set: { lastTransactionAt: new Date() },
  };
  if (direction === LEDGER_DIRECTION.CREDIT) {
    update.$setOnInsert = {
      entityType: owner.entityType,
      entityId: owner.entityId,
      salonId: owner.salonId,
    };
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
    throw Errors.badRequest(`Insufficient ${bucket} balance for this operation`);
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
        salonId: owner.salonId,
        ownerType: owner.entityType,
        ownerId: owner.entityId,
        direction, bucket, action, amountInPaise,
        entityType: refType, entityId: refId, // transaction-subject — unchanged DB field names
        idempotencyKey,
        triggeredBy, triggeredById, remarks, balanceAfter,
      }],
      { session }
    );
    return { ledgerEntry, wallet, idempotent: false };
  } catch (err) {
    // Duplicate idempotencyKey raced in between our check and
    // insert (rare, but requires two overlapping transactions whose
    // wallet writes don't conflict with each other — e.g. the same
    // idempotencyKey mistakenly reused across two different wallets.
    // Same-wallet races are additionally caught by MongoDB's own
    // transaction conflict detection on the $inc above, since both
    // would target the same document — but that protection doesn't
    // apply here, so this path must be self-sufficient rather than
    // assume it never survives to this point.
    if (err?.code === 11000 && idempotencyKey) {
      const existing = await findExistingByIdempotencyKey(idempotencyKey, session);
      if (existing) {
        // This call's own $inc already committed against the wallet
        // above, but its ledger entry lost the race and was never
        // recorded — the *other* call's entry is the one that
        // exists. Reverse exactly the delta this call applied so
        // the wallet ends up matching the ledger (the documented
        // single source of truth) instead of silently double-
        // counting. Safe unconditional reversal: within this same
        // transaction, nothing else can have touched this field
        // between our forward $inc and this compensating one.
        await SalonEarnings.findOneAndUpdate(
          { entityType: owner.entityType, entityId: owner.entityId },
          { $inc: { [bucketField]: -delta } },
          { session }
        );
        return { ledgerEntry: existing, wallet: null, idempotent: true };
      }
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
  credit: async ({ salonId, entityType, entityId, amountInPaise, action, refType, refId, idempotencyKey, session, triggeredBy, triggeredById, remarks }) => {
    return applyLedgerEntry({
      salonId, entityType, entityId, amountInPaise, action, refType, refId, idempotencyKey,
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
   * refType: "BOOKING" — these are the only values in the
   * WalletLedger enum for this scenario (verified against
   * models/WalletLedger.js — LEDGER_ACTION / LEDGER_ENTITY_TYPE).
   */
  creditPending: async ({ salonId, entityType, entityId, amountInPaise, action, refType, refId, idempotencyKey, session, triggeredBy, triggeredById, remarks }) => {
    return applyLedgerEntry({
      salonId, entityType, entityId, amountInPaise, action, refType, refId, idempotencyKey,
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
   */
  releasePendingToAvailable: async ({ salonId, entityType, entityId, amountInPaise, refType, refId, idempotencyKey, session, triggeredBy, triggeredById, remarks }) => {
    await applyLedgerEntry({
      salonId, entityType, entityId, amountInPaise, refType, refId, session, triggeredBy, triggeredById, remarks,
      action: "BOOKING_SETTLEMENT", direction: LEDGER_DIRECTION.DEBIT,  bucket: LEDGER_BUCKET.PENDING,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:pending` : null,
    });
    return applyLedgerEntry({
      salonId, entityType, entityId, amountInPaise, refType, refId, session, triggeredBy, triggeredById, remarks,
      action: "BOOKING_SETTLEMENT", direction: LEDGER_DIRECTION.CREDIT, bucket: LEDGER_BUCKET.AVAILABLE,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:available` : null,
    });
  },

  /**
   * Debit AVAILABLE balance directly. Used for: penalty,
   * adjustment (negative correction), commission reversal.
   * NOT used for withdrawal flow — that's hold/release/etc below.
   */
  debit: async ({ salonId, entityType, entityId, amountInPaise, action, refType, refId, idempotencyKey, session, triggeredBy, triggeredById, remarks }) => {
    return applyLedgerEntry({
      salonId, entityType, entityId, amountInPaise, action, refType, refId, idempotencyKey,
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
  debitPending: async ({ salonId, entityType, entityId, amountInPaise, action, refType, refId, idempotencyKey, session, triggeredBy, triggeredById, remarks }) => {
    return applyLedgerEntry({
      salonId, entityType, entityId, amountInPaise, action, refType, refId, idempotencyKey,
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
  hold: async ({ salonId, entityType, entityId, amountInPaise, refType, refId, idempotencyKey, session, triggeredBy, triggeredById, remarks }) => {
    await applyLedgerEntry({
      salonId, entityType, entityId, amountInPaise, refType, refId, session, triggeredBy, triggeredById, remarks,
      action: "WITHDRAWAL_HOLD", direction: LEDGER_DIRECTION.DEBIT,  bucket: LEDGER_BUCKET.AVAILABLE,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:available` : null,
    });
    return applyLedgerEntry({
      salonId, entityType, entityId, amountInPaise, refType, refId, session, triggeredBy, triggeredById, remarks,
      action: "WITHDRAWAL_HOLD", direction: LEDGER_DIRECTION.CREDIT, bucket: LEDGER_BUCKET.LOCKED,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:locked` : null,
    });
  },

  /**
   * Withdrawal rejected or cancelled before processing:
   * LOCKED → AVAILABLE (money goes back where it came from).
   */
  release: async ({ salonId, entityType, entityId, amountInPaise, refType, refId, idempotencyKey, session, triggeredBy, triggeredById, remarks }) => {
    await applyLedgerEntry({
      salonId, entityType, entityId, amountInPaise, refType, refId, session, triggeredBy, triggeredById, remarks,
      action: "WITHDRAWAL_RELEASE", direction: LEDGER_DIRECTION.DEBIT,  bucket: LEDGER_BUCKET.LOCKED,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:locked` : null,
    });
    return applyLedgerEntry({
      salonId, entityType, entityId, amountInPaise, refType, refId, session, triggeredBy, triggeredById, remarks,
      action: "WITHDRAWAL_RELEASE", direction: LEDGER_DIRECTION.CREDIT, bucket: LEDGER_BUCKET.AVAILABLE,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:available` : null,
    });
  },

  /**
   * Admin approved the withdrawal: LOCKED → PROCESSING
   * (payout now in flight — manual transfer or gateway call).
   */
  moveToProcessing: async ({ salonId, entityType, entityId, amountInPaise, refType, refId, idempotencyKey, session, triggeredBy, triggeredById, remarks }) => {
    await applyLedgerEntry({
      salonId, entityType, entityId, amountInPaise, refType, refId, session, triggeredBy, triggeredById, remarks,
      action: "WITHDRAWAL_PROCESSING", direction: LEDGER_DIRECTION.DEBIT,  bucket: LEDGER_BUCKET.LOCKED,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:locked` : null,
    });
    return applyLedgerEntry({
      salonId, entityType, entityId, amountInPaise, refType, refId, session, triggeredBy, triggeredById, remarks,
      action: "WITHDRAWAL_PROCESSING", direction: LEDGER_DIRECTION.CREDIT, bucket: LEDGER_BUCKET.PROCESSING,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:processing` : null,
    });
  },

  /**
   * Payout confirmed successful (manual UTR entered, or gateway
   * webhook confirms): PROCESSING bucket debited for good, money
   * has left the platform. lifetimeWithdrawals increments.
   */
  completePayout: async ({ salonId, entityType, entityId, amountInPaise, refType, refId, idempotencyKey, session, triggeredBy, triggeredById, remarks }) => {
    const owner = resolveOwner({ salonId, entityType, entityId });
    const result = await applyLedgerEntry({
      salonId, entityType, entityId, amountInPaise, refType, refId, idempotencyKey, session, triggeredBy, triggeredById, remarks,
      action: "PAYOUT_SUCCESS", direction: LEDGER_DIRECTION.DEBIT, bucket: LEDGER_BUCKET.PROCESSING,
    });
    if (!result.idempotent) {
      await SalonEarnings.findOneAndUpdate(
        { entityType: owner.entityType, entityId: owner.entityId },
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
  failPayout: async ({ salonId, entityType, entityId, amountInPaise, refType, refId, idempotencyKey, session, triggeredBy, triggeredById, remarks }) => {
    await applyLedgerEntry({
      salonId, entityType, entityId, amountInPaise, refType, refId, session, triggeredBy, triggeredById, remarks,
      action: "PAYOUT_FAILED_REVERSAL", direction: LEDGER_DIRECTION.DEBIT,  bucket: LEDGER_BUCKET.PROCESSING,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:processing` : null,
    });
    return applyLedgerEntry({
      salonId, entityType, entityId, amountInPaise, refType, refId, session, triggeredBy, triggeredById, remarks,
      action: "PAYOUT_FAILED_REVERSAL", direction: LEDGER_DIRECTION.CREDIT, bucket: LEDGER_BUCKET.AVAILABLE,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:available` : null,
    });
  },

  /**
   * Convenience read — always go through this rather than
   * inlining `SalonEarnings.findOne()` everywhere, so any future
   * derived/computed field stays in one place.
   *
   * FA-P3-C Step 1 — accepts either the legacy positional form
   * `getWallet(salonId, session)` (every pre-existing call site,
   * unchanged) or the new object form
   * `getWallet({ entityType, entityId, session })` for a
   * FIELD_AGENT (or explicitly-typed SALON) wallet.
   */
  getWallet: async (arg1, arg2 = null) => {
    const isParamsObject = !!arg1 && typeof arg1 === "object" &&
      ("entityType" in arg1 || "entityId" in arg1 || "salonId" in arg1);

    const owner = isParamsObject
      ? resolveOwner({ salonId: arg1.salonId, entityType: arg1.entityType, entityId: arg1.entityId })
      : resolveOwner({ salonId: arg1 });
    const session = isParamsObject ? (arg1.session || null) : arg2;

    const query = SalonEarnings.findOne({ entityType: owner.entityType, entityId: owner.entityId });
    if (session) query.session(session);
    return query.lean();
  },
};

export default WalletBalanceService;
