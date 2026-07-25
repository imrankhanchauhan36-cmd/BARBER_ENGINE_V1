import mongoose from "mongoose";

//////////////////////////////////////////////////////////////
// 🔥 WALLET TRANSACTION — User-side wallet ledger
//
// Separate from models/Transaction.js (which is booking-payment
// specific, bookingId required+unique) and models/WalletLedger.js
// (which is salon-owner earnings/payout specific, salonId-based).
// This model is the user wallet's own append-only history: top-ups
// via Razorpay today, with `type` and `source` designed to extend
// to future entries (refund-to-wallet, booking-paid-via-wallet,
// admin adjustment) without a schema change.
//////////////////////////////////////////////////////////////

export const WALLET_TXN_DIRECTION = {
  CREDIT: "CREDIT",
  DEBIT:  "DEBIT",
};

export const WALLET_TXN_TYPE = {
  TOPUP:          "TOPUP",           // user added money via Razorpay
  BOOKING_PAYMENT:"BOOKING_PAYMENT", // future: paid for a booking using wallet balance
  REFUND:         "REFUND",          // future: booking refund credited to wallet
  ADJUSTMENT:     "ADJUSTMENT",      // manual admin correction
};

export const WALLET_TXN_STATUS = {
  PENDING: "PENDING", // order created, payment not yet verified
  SUCCESS: "SUCCESS",
  FAILED:  "FAILED",
};

export const WALLET_TXN_SOURCE = {
  RAZORPAY: "RAZORPAY",
  BOOKING:  "BOOKING",
  ADMIN:    "ADMIN",
  SYSTEM:   "SYSTEM",
};

export const WALLET_TXN_FAILURE_CODE = {
  SIGNATURE_INVALID: "SIGNATURE_INVALID",
  PAYMENT_FAILED:    "PAYMENT_FAILED",
  PAYMENT_CANCELLED: "PAYMENT_CANCELLED",
  DUPLICATE_PAYMENT: "DUPLICATE_PAYMENT",
  ORDER_EXPIRED:     "ORDER_EXPIRED",
};

const WalletTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: true,
      index:    true,
    },

    // Only set for type: BOOKING_PAYMENT / REFUND — links this
    // wallet entry back to the booking that caused it. Null for
    // plain TOPUP entries.
    bookingId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "Booking",
      default: null,
      index:   true,
    },

    direction: {
      type:     String,
      enum:     Object.values(WALLET_TXN_DIRECTION),
      required: true,
    },

    type: {
      type:     String,
      enum:     Object.values(WALLET_TXN_TYPE),
      required: true,
      index:    true,
    },

    status: {
      type:    String,
      enum:    Object.values(WALLET_TXN_STATUS),
      default: WALLET_TXN_STATUS.PENDING,
      index:   true,
    },

    // Who/what initiated this entry — mirrors WalletLedger's
    // triggeredBy pattern from the salon-side ledger.
    source: {
      type:    String,
      enum:    Object.values(WALLET_TXN_SOURCE),
      default: WALLET_TXN_SOURCE.SYSTEM,
    },

    // Always in paise — same convention as Booking.totalAmountInPaise
    amountInPaise: {
      type:     Number,
      required: true,
      min:      1,
      validate: {
        validator: Number.isInteger,
        message:   "amountInPaise must be a whole number (paise, not rupees)",
      },
    },

    currency: {
      type:    String,
      enum:    ["INR"], // India-only for now — widen when multi-currency is needed
      default: "INR",
    },

    // ── Idempotency / audit — caller-generated deterministic key,
    // e.g. `topup:<orderId>` or `verify:<paymentId>`. Prevents a
    // retried request or duplicate webhook from creating two rows
    // for the same real-world event.
    requestId: {
      type:    String,
      default: null,
      unique:  true,
      sparse:  true,
      index:   true,
    },

    // ── Razorpay linkage (TOPUP only) ──────────────────────────
    razorpayOrderId: {
      type:    String,
      default: null,
      index:   true,
    },
    // NOTE: no `default: null` here — a sparse unique index only
    // exempts documents where the field is truly absent (undefined).
    // An explicit `null` on every pending row (from a default) would
    // count as a duplicate value across rows and throw E11000 on the
    // second-ever top-up attempt. Leaving it unset until verifyTopup
    // actually assigns a real paymentId keeps the sparse index correct.
    razorpayPaymentId: {
      type:    String,
      unique:  true,
      sparse:  true,
    },
    razorpaySignature: {
      type:    String,
      default: null,
      select:  false, // never returned in queries
    },

    // Snapshot of User.walletBalance BEFORE/AFTER this entry applied —
    // audit convenience, never the source of truth.
    balanceBeforeInPaise: {
      type:    Number,
      default: null,
    },
    balanceAfterInPaise: {
      type:    Number,
      default: null,
    },

    failureCode: {
      type:    String,
      enum:    [...Object.values(WALLET_TXN_FAILURE_CODE), null],
      default: null,
    },
    failureReason: {
      type:      String,
      default:   null,
      maxlength: 300,
    },

    // Free-form extension bag — couponCode, adminId, refundReason,
    // bookingNumber, notes, etc. Keeps the schema future-proof
    // without a migration every time a new use case shows up.
    metadata: {
      type:    mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

//////////////////////////////////////////////////////////////
// 🚀 INDEXES
//////////////////////////////////////////////////////////////

// "Show this user's wallet history" — the primary query pattern
WalletTransactionSchema.index({ userId: 1, createdAt: -1 });

//////////////////////////////////////////////////////////////
// 🚀 EXPORT
//////////////////////////////////////////////////////////////

export default mongoose.models.WalletTransaction ||
  mongoose.model("WalletTransaction", WalletTransactionSchema);