import mongoose from "mongoose";

const integerValidator = {
  validator: Number.isInteger,
  message: "{VALUE} is not a valid integer amount",
};

//////////////////////////////////////////////////////////////
// 🔥 WALLET STATUS
//////////////////////////////////////////////////////////////
export const WALLET_STATUS = {
  ACTIVE:   "ACTIVE",   // normal operation
  FROZEN:   "FROZEN",   // admin frozen — no withdrawals
  BLOCKED:  "BLOCKED",  // compliance block
  INACTIVE: "INACTIVE", // no transactions yet
};

// FA-P3-C Step 1 — which kind of owner this wallet belongs to. This is
// the SAME document/collection for both — a Field Agent wallet is not
// a new architecture, it is the same 4-bucket SalonEarnings shape
// keyed by a generic (entityType, entityId) identity instead of a
// hardcoded salonId. See WalletBalanceService.js for the single code
// path that writes both.
//
// STEP 6.2 — Unified Wallet Engine. ACQUISITION_AGENT and
// TERRITORY_PARTNER added, additive only — FIELD_AGENT is kept
// unchanged (fieldAgentWalletBridge.service.js and every pre-existing
// FIELD_AGENT wallet document keep working exactly as before). No
// second wallet model was created — this is the SAME SalonEarnings
// collection, the SAME WalletBalanceService methods (already fully
// generic — see that file's own header), now simply allowed to open a
// wallet for these two additional owner kinds too.
export const WALLET_ENTITY_TYPE = {
  SALON:              "SALON",
  FIELD_AGENT:        "FIELD_AGENT",
  ACQUISITION_AGENT:  "ACQUISITION_AGENT",
  TERRITORY_PARTNER:  "TERRITORY_PARTNER",
};

const SalonEarningsSchema = new mongoose.Schema(
  {
    // Legacy identity — kept for 100% backward-compatible reads
    // (every pre-existing SALON wallet query in this codebase reads
    // `.salonId` / filters `{salonId}`). No longer required or unique
    // at the schema level — a FIELD_AGENT-owned wallet has no
    // salonId — but WalletBalanceService always populates it
    // (mirroring entityId) for entityType SALON, so every existing
    // caller keeps working unchanged. Uniqueness now lives on the
    // {entityType, entityId} compound index below instead.
    salonId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "Salon",
      default: null,
      index:   true,
    },

    // FA-P3-C Step 1 — the generic wallet-owner identity. required
    // going forward; entityType defaults to SALON so this is additive
    // for any document created before this migration (see the
    // companion backfill in scripts/, run once against every
    // pre-existing document that predates this field).
    entityType: {
      type:     String,
      enum:     Object.values(WALLET_ENTITY_TYPE),
      required: true,
      default:  WALLET_ENTITY_TYPE.SALON,
      index:    true,
    },
    entityId: {
      type:     mongoose.Schema.Types.ObjectId,
      required: true,
      index:    true,
    },

    currency: {
      type:      String,
      default:   "INR",
      maxlength: 10,
    },

    ////////////////////////////////////////////////////////
    // 💰 MULTI-BUCKET BALANCE (all in paise)
    ////////////////////////////////////////////////////////

    availableBalanceInPaise: {
      type: Number, default: 0, min: 0, validate: integerValidator,
    },
    pendingBalanceInPaise: {
      type: Number, default: 0, min: 0, validate: integerValidator,
    },
    lockedBalanceInPaise: {
      type: Number, default: 0, min: 0, validate: integerValidator,
    },
    processingBalanceInPaise: {
      type: Number, default: 0, min: 0, validate: integerValidator,
    },

    ////////////////////////////////////////////////////////
    // 📊 LIFETIME COUNTERS
    ////////////////////////////////////////////////////////

    lifetimeEarningsInPaise: {
      type: Number, default: 0, min: 0, validate: integerValidator,
    },
    lifetimeWithdrawalsInPaise: {
      type: Number, default: 0, min: 0, validate: integerValidator,
    },

    lastTransactionAt: { type: Date, default: null },
    lastPayoutAt:       { type: Date, default: null },
    lastPayoutAmountInPaise: {
      type: Number, default: 0, min: 0, validate: integerValidator,
    },

    ////////////////////////////////////////////////////////
    // 🔒 WALLET STATUS — Admin Control
    ////////////////////////////////////////////////////////
    status: {
      type:    String,
      enum:    Object.values(WALLET_STATUS),
      default: WALLET_STATUS.ACTIVE,
    },

    // Who froze/blocked and when
    frozenBy:  { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    frozenAt:  { type: Date, default: null },
    frozenNote:{ type: String, default: null, maxlength: 500 },

    ////////////////////////////////////////////////////////
    // 🔢 OPTIMISTIC LOCK
    ////////////////////////////////////////////////////////
    walletVersion: {
      type: Number, default: 1, min: 1, validate: integerValidator,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

SalonEarningsSchema.index({ availableBalanceInPaise: -1 });
SalonEarningsSchema.index({ status: 1 });

// FA-P3-C Step 1 — the sole uniqueness authority for "one wallet per
// owner", replacing the old standalone unique index on salonId (which
// could never have supported a second owner type — a non-sparse
// unique index rejects a second document with salonId:null, which is
// exactly what every FIELD_AGENT wallet would have).
SalonEarningsSchema.index({ entityType: 1, entityId: 1 }, { unique: true });

export default mongoose.models.SalonEarnings ||
  mongoose.model("SalonEarnings", SalonEarningsSchema);