import mongoose from "mongoose";

//////////////////////////////////////////////////////////////
// 🔥 WALLET LEDGER — Single Source of Truth
//
// Every event that touches a salon's wallet balance creates
// exactly ONE entry here. Nothing else is allowed to mutate
// SalonEarnings directly — only WalletBalanceService, which
// always writes a ledger entry + the wallet update in the same
// mongoose session (see WalletBalanceService.js).
//
// This collection is APPEND-ONLY. Entries are never updated or
// deleted — corrections happen via a new reversing entry
// (action: ADJUSTMENT or COMMISSION_REVERSAL), never by editing
// history. This is enforced below at the schema level, not just
// by convention.
//////////////////////////////////////////////////////////////

export const LEDGER_DIRECTION = {
  CREDIT: "CREDIT",
  DEBIT:  "DEBIT",
};

// Which wallet bucket this entry affects — lets us reconstruct
// exactly how balances moved without re-deriving from amounts alone.
export const LEDGER_BUCKET = {
  AVAILABLE:  "AVAILABLE",
  PENDING:    "PENDING",    // settlement-delay bucket (T+1/T+2, future use)
  LOCKED:     "LOCKED",     // held while a withdrawal request is REQUESTED
  PROCESSING: "PROCESSING", // admin approved, payout in flight at gateway
};

// Business reason for the entry.
export const LEDGER_ACTION = {
  BOOKING_SETTLEMENT:    "BOOKING_SETTLEMENT",     // booking completed → salon's share credited
  WITHDRAWAL_HOLD:       "WITHDRAWAL_HOLD",         // withdraw requested → available→locked
  WITHDRAWAL_RELEASE:    "WITHDRAWAL_RELEASE",      // withdraw rejected/cancelled → locked→available
  WITHDRAWAL_PROCESSING: "WITHDRAWAL_PROCESSING",   // admin approved → locked→processing
  PAYOUT_SUCCESS:        "PAYOUT_SUCCESS",          // gateway confirms transfer → processing debited for good
  PAYOUT_FAILED_REVERSAL:"PAYOUT_FAILED_REVERSAL",  // gateway payout failed → processing→available
  REFUND:                "REFUND",
  ADJUSTMENT:            "ADJUSTMENT",              // manual correction by admin
  BONUS:                 "BONUS",
  PENALTY:               "PENALTY",
  COMMISSION_REVERSAL:   "COMMISSION_REVERSAL",
  // FA-P4-C Step 1 — a credited Field Agent earning (FieldAgentEarningLedger
  // row) mirrored into that agent's wallet AVAILABLE bucket. Additive only.
  EARNING_CREDIT:        "EARNING_CREDIT",
};

// What kind of record this ledger entry is about — deliberately
// generic (entityType/entityId) rather than booking-specific
// refType/refId, so any future module can attach to the ledger
// without a schema migration.
export const LEDGER_ENTITY_TYPE = {
  BOOKING:    "BOOKING",
  WITHDRAWAL: "WITHDRAWAL",
  PAYOUT:     "PAYOUT",
  REFUND:     "REFUND",
  ADJUSTMENT: "ADJUSTMENT",
  BONUS:      "BONUS",
  PENALTY:    "PENALTY",
  EARNING:    "EARNING",   // FA-P4-C Step 1 — refId = the FieldAgentEarningLedger row
};

// FA-P3-C Step 1 — WHO this ledger entry's wallet belongs to. This is
// deliberately a SEPARATE field pair from entityType/entityId above —
// that pair already means "what this entry is ABOUT" (a booking, a
// withdrawal, ...) and is unchanged. ownerType/ownerId means "WHOSE
// wallet moved" — SALON (existing behavior) or FIELD_AGENT (new,
// FA-P3-C). Naming them differently avoids silently reinterpreting
// every pre-existing entityType:"BOOKING"/"WITHDRAWAL" value as an
// (invalid) owner type.
//
// STEP 6.2 — Unified Wallet Engine. ACQUISITION_AGENT and
// TERRITORY_PARTNER added, additive only, mirroring SalonEarnings'
// own WALLET_ENTITY_TYPE extension exactly — every WalletLedger row
// this service ever writes sets ownerType = the wallet's own
// entityType (see WalletBalanceService.js#applyLedgerEntry), so this
// enum must accept the same set of owner kinds SalonEarnings does.
export const LEDGER_OWNER_TYPE = {
  SALON:              "SALON",
  FIELD_AGENT:        "FIELD_AGENT",
  ACQUISITION_AGENT:  "ACQUISITION_AGENT",
  TERRITORY_PARTNER:  "TERRITORY_PARTNER",
};

const integerValidator = {
  validator: Number.isInteger,
  message: "{VALUE} is not a valid integer amount (paise)",
};

const WalletLedgerSchema = new mongoose.Schema(
  {
    // Legacy identity — kept for 100% backward-compatible reads (every
    // pre-existing "show this salon's ledger" query filters
    // {salonId}). No longer required — a FIELD_AGENT-owned entry has
    // no salonId — but WalletBalanceService always populates it
    // (mirroring ownerId) for ownerType SALON.
    salonId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "Salon",
      default: null,
      index:   true,
    },

    // FA-P3-C Step 1 — the generic wallet-owner identity (see
    // LEDGER_OWNER_TYPE above for why this is a distinct field pair
    // from entityType/entityId, not a reuse of it).
    ownerType: {
      type:     String,
      enum:     Object.values(LEDGER_OWNER_TYPE),
      required: true,
      default:  LEDGER_OWNER_TYPE.SALON,
    },
    ownerId: {
      type:     mongoose.Schema.Types.ObjectId,
      required: true,
      index:    true,
    },

    direction: {
      type:     String,
      enum:     Object.values(LEDGER_DIRECTION),
      required: true,
    },

    bucket: {
      type:     String,
      enum:     Object.values(LEDGER_BUCKET),
      required: true,
    },

    action: {
      type:     String,
      enum:     Object.values(LEDGER_ACTION),
      required: true,
      index:    true,
    },

    amountInPaise: {
      type:     Number,
      required: true,
      min:      0,
      validate: integerValidator,
    },

    currency: {
      type:    String,
      default: "INR",
      maxlength: 10,
    },

    // ── Generic entity link (not booking-specific) ────────────
    entityType: {
      type:     String,
      enum:     Object.values(LEDGER_ENTITY_TYPE),
      required: true,
    },
    entityId: {
      type:     mongoose.Schema.Types.ObjectId,
      required: true,
      index:    true,
    },

    // ── Idempotency — prevents double-credit from retried/duplicate
    // webhooks or retried requests. Caller builds a deterministic key,
    // e.g. `booking:<bookingId>:settlement`. unique+sparse creates the
    // index — no separate index:true needed.
    idempotencyKey: {
      type:   String,
      default: null,
      unique:  true,
      sparse:  true,
    },

    // ── Snapshot of wallet buckets AFTER this entry applied —
    // invaluable for audit/debugging without replaying the whole
    // ledger. Never trust this over the ledger itself; it's a
    // convenience cache, not the source of truth.
    balanceAfter: {
      availableInPaise:  { type: Number, default: 0 },
      pendingInPaise:    { type: Number, default: 0 },
      lockedInPaise:     { type: Number, default: 0 },
      processingInPaise: { type: Number, default: 0 },
    },

    // ── Who triggered this ────────────────────────────────────
    triggeredBy: {
      type:    String,
      // FA-P4-B Step 2 — FIELD_AGENT added so a Field Agent's own
      // self-service actions (e.g. requesting/cancelling a withdrawal
      // against their own wallet) can be attributed truthfully instead
      // of being mislabeled OWNER/SYSTEM. Additive only.
      enum:    ["SYSTEM", "ADMIN", "OWNER", "FIELD_AGENT"],
      default: "SYSTEM",
    },
    triggeredById: {
      type:    mongoose.Schema.Types.ObjectId,
      default: null,
    },

    remarks: {
      type:      String,
      default:   null,
      maxlength: 500,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

//////////////////////////////////////////////////////////////
// 🚀 COMPOUND INDEXES
//////////////////////////////////////////////////////////////

// Most common query — "show this salon's wallet history"
WalletLedgerSchema.index({ salonId: 1, createdAt: -1 });

// "Show all ledger entries for this booking/withdrawal/payout"
WalletLedgerSchema.index({ entityType: 1, entityId: 1 });

// FA-P3-C Step 1 — the generic "show this wallet's history" query,
// covering FIELD_AGENT owners (which have no salonId) and equally
// usable for SALON owners going forward.
WalletLedgerSchema.index({ ownerType: 1, ownerId: 1, createdAt: -1 });

//////////////////////////////////////////////////////////////
// 🔒 ENFORCE APPEND-ONLY AT THE SCHEMA LEVEL
//
// Ledger entries must never be modified or deleted — corrections
// happen via a new reversing entry. This is enforced here, not
// left to convention.
//////////////////////////////////////////////////////////////

const blockMutation = function () {
  throw new Error("WalletLedger entries are immutable — they cannot be updated or deleted.");
};
WalletLedgerSchema.pre("updateOne",        blockMutation);
WalletLedgerSchema.pre("updateMany",       blockMutation);
WalletLedgerSchema.pre("findOneAndUpdate", blockMutation);
WalletLedgerSchema.pre("deleteOne",        blockMutation);
WalletLedgerSchema.pre("deleteMany",       blockMutation);
WalletLedgerSchema.pre("findOneAndDelete", blockMutation);

//////////////////////////////////////////////////////////////
// 🚀 EXPORT
//////////////////////////////////////////////////////////////

export default mongoose.models.WalletLedger ||
  mongoose.model("WalletLedger", WalletLedgerSchema);