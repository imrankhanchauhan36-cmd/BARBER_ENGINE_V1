import mongoose from "mongoose";

//////////////////////////////////////////////////////////////
// 🔥 TRANSACTION STATUS
//////////////////////////////////////////////////////////////

export const TRANSACTION_STATUS = {
  PENDING:  "PENDING",
  PAID:     "PAID",
  FAILED:   "FAILED",
  REFUNDED: "REFUNDED",
};

//////////////////////////////////////////////////////////////
// 🔥 TRANSACTION TYPES
//////////////////////////////////////////////////////////////

export const TRANSACTION_TYPE = {
  BOOKING: "BOOKING",
  REFUND:  "REFUND",
  PENALTY: "PENALTY",
};

//////////////////////////////////////////////////////////////
// 🔥 PAYMENT PROVIDERS
//////////////////////////////////////////////////////////////

export const PAYMENT_PROVIDER = {
  RAZORPAY: "RAZORPAY",
  CASHFREE: "CASHFREE",
  STRIPE:   "STRIPE",
  MANUAL:   "MANUAL",
};

//////////////////////////////////////////////////////////////
// 🔥 PAYMENT METHODS
//////////////////////////////////////////////////////////////

export const PAYMENT_METHOD = {
  UPI:         "UPI",
  CARD:        "CARD",
  NET_BANKING: "NET_BANKING",
  WALLET:      "WALLET",
  CASH:        "CASH",
  COD:         "COD",
  UNKNOWN:     "UNKNOWN",
};

//////////////////////////////////////////////////////////////
// 🔥 SCHEMA
//////////////////////////////////////////////////////////////

const TransactionSchema = new mongoose.Schema(
  {
    //////////////////////////////////////////////////////////
    // 🔗 BOOKING
    //////////////////////////////////////////////////////////
    bookingId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "Booking",
      required: true,
      unique:   true,
    },

    //////////////////////////////////////////////////////////
    // 👤 USER (customer who made the booking)
    //////////////////////////////////////////////////////////
    userId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "User",
      default: null,
      index:   true,
    },

    //////////////////////////////////////////////////////////
    // 🏪 SALON
    //////////////////////////////////////////////////////////
    salonId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "Salon",
      required: true,
      index:    true,
    },

    //////////////////////////////////////////////////////////
    // 🪑 CHAIR / RESOURCE
    //////////////////////////////////////////////////////////
    resourceId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "Chair",
      required: true,
      index:    true,
    },

    //////////////////////////////////////////////////////////
    // 💰 AMOUNTS (in paise — never rupees)
    //////////////////////////////////////////////////////////
    amount: {
      type:     Number,
      required: true,
      min:      0,
    },

    commission: {
      type:     Number,
      required: true,
      min:      0,
    },

    payoutAmount: {
      type:     Number,
      required: true,
      min:      0,
    },

    // Gateway processing fee (future — Razorpay charges ~2%)
    gatewayFee: {
      type:    Number,
      default: 0,
      min:     0,
    },

    // Refund amount (partial or full)
    refundAmount: {
      type:    Number,
      default: 0,
      min:     0,
    },

    //////////////////////////////////////////////////////////
    // 💱 CURRENCY
    // INR for now — future: USD, AED, SAR
    //////////////////////////////////////////////////////////
    currency: {
      type:      String,
      default:   "INR",
      maxlength: 10,
    },

    //////////////////////////////////////////////////////////
    // 💳 PAYMENT STATUS
    //////////////////////////////////////////////////////////
    status: {
      type:    String,
      enum:    Object.values(TRANSACTION_STATUS),
      default: TRANSACTION_STATUS.PENDING,
      index:   true,
    },

    //////////////////////////////////////////////////////////
    // 🏦 PAYMENT PROVIDER
    // MANUAL → test/dev mode
    // RAZORPAY → production (switch without UI change)
    //////////////////////////////////////////////////////////
    provider: {
      type:    String,
      enum:    Object.values(PAYMENT_PROVIDER),
      default: PAYMENT_PROVIDER.MANUAL,
      index:   true,
    },

    //////////////////////////////////////////////////////////
    // 💳 PAYMENT METHOD
    // Populated from Razorpay webhook in production
    //////////////////////////////////////////////////////////
    paymentMethod: {
      type:    String,
      enum:    Object.values(PAYMENT_METHOD),
      default: PAYMENT_METHOD.UNKNOWN,
      index:   true,
    },

    //////////////////////////////////////////////////////////
    // 🔐 GATEWAY IDs
    //////////////////////////////////////////////////////////
    paymentId: {
      type:    String,
      default: null,
      unique:  true,
      sparse:  true,
    },

    orderId: {
      type:    String,
      default: null,
      index:   true,
    },

    // Razorpay signature (stored for audit — never expose in API)
    gatewaySignature: {
      type:    String,
      default: null,
      select:  false, // never returned in queries
    },

    // Gateway settlement reference — Razorpay/Cashfree reconciliation
    // Links internal transaction to gateway settlement batch
    gatewaySettlementId: {
      type:    String,
      default: null,
    },

    // Idempotency key — prevents duplicate webhook processing
    // webhook retries or duplicate callbacks are safe no-ops
    idempotencyKey: {
      type:   String,
      
      unique:  true,
      sparse:  true,
    },

    //////////////////////////////////////////////////////////
    // 📊 TRANSACTION TYPE
    //////////////////////////////////////////////////////////
    type: {
      type:    String,
      enum:    Object.values(TRANSACTION_TYPE),
      default: TRANSACTION_TYPE.BOOKING,
      index:   true,
    },

    //////////////////////////////////////////////////////////
    // 📱 SOURCE
    //////////////////////////////////////////////////////////
    source: {
      type:    String,
      enum:    ["APP", "ADMIN", "SYSTEM"],
      default: "APP",
    },

    //////////////////////////////////////////////////////////
    // 📝 FAILURE REASON
    //////////////////////////////////////////////////////////
    failureReason: {
      type:      String,
      default:   null,
      maxlength: 500,
    },

    //////////////////////////////////////////////////////////
    // 🔁 REFUND META
    //////////////////////////////////////////////////////////
    refundedAt:  { type: Date, default: null },
    refundReason:{ type: String, default: null, maxlength: 300 },

    //////////////////////////////////////////////////////////
    // 📅 SETTLEMENT
    // When wallet was credited for this transaction
    //////////////////////////////////////////////////////////
    settledAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

//////////////////////////////////////////////////////////////
// 🚀 COMPOUND INDEXES
//////////////////////////////////////////////////////////////

TransactionSchema.index({ salonId:       1, createdAt: -1 });
TransactionSchema.index({ userId:        1, createdAt: -1 });
TransactionSchema.index({ status:        1, createdAt: -1 });
TransactionSchema.index({ type:          1, createdAt: -1 });
TransactionSchema.index({ provider:      1, createdAt: -1 });
TransactionSchema.index({ paymentMethod:      1, createdAt: -1 });
TransactionSchema.index({ gatewaySettlementId: 1 });

//////////////////////////////////////////////////////////////
// 🚀 EXPORT
//////////////////////////////////////////////////////////////

export default mongoose.models.Transaction ||
  mongoose.model("Transaction", TransactionSchema);