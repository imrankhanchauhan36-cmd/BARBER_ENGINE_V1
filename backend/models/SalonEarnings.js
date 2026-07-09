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

const SalonEarningsSchema = new mongoose.Schema(
  {
    salonId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "Salon",
      unique:   true,
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

export default mongoose.models.SalonEarnings ||
  mongoose.model("SalonEarnings", SalonEarningsSchema);