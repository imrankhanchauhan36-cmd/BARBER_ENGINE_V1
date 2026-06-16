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
// 🔥 SCHEMA
//////////////////////////////////////////////////////////////

const TransactionSchema = new mongoose.Schema(
  {
    //////////////////////////////////////////////////////////
    // 🔗 BOOKING
    //
    // unique: true already creates a B-tree index in MongoDB.
    // Adding index: true on top creates a second identical
    // index → the Mongoose duplicate-index warning.
    // FIX: remove index: true — unique: true is sufficient.
    //////////////////////////////////////////////////////////
    bookingId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "Booking",
      required: true,
      unique:   true,       // ← this alone creates the index
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
    // 🔐 GATEWAY PAYMENT ID
    //
    // unique + sparse already creates the index.
    // index: true removed to avoid duplicate-index warning.
    //////////////////////////////////////////////////////////
    paymentId: {
      type:    String,
      default: null,
      unique:  true,
      sparse:  true,        // ← unique+sparse creates the index
    },

    //////////////////////////////////////////////////////////
    // 🔒 IDEMPOTENCY KEY
    //
    // Same as paymentId — unique + sparse creates the index.
    // index: true removed.
    //////////////////////////////////////////////////////////
   // idempotencyKey: {
    //  type:    String,
    //  default: null,
    //  unique:  true,
    //  sparse:  true,        // ← unique+sparse creates the index
    //},

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
    // 📝 OPTIONAL FAILURE REASON
    //////////////////////////////////////////////////////////
    failureReason: {
      type:      String,
      default:   null,
      maxlength: 500,
    },

    //////////////////////////////////////////////////////////
    // 🔁 REFUND META
    //////////////////////////////////////////////////////////
    refundedAt: {
      type:    Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

//////////////////////////////////////////////////////////////
// 🚀 COMPOUND INDEXES
//
// Only compound (multi-field) indexes go here.
// Single-field indexes are declared on the field itself above.
// The explicit TransactionSchema.index({ bookingId: 1 }) that
// was here is REMOVED — bookingId already has unique: true
// which creates that index. Keeping both caused the Mongoose
// duplicate-index warning.
//////////////////////////////////////////////////////////////

// Salon financial queries — most common dashboard query
TransactionSchema.index({ salonId: 1,  createdAt: -1 });

// Status reporting / reconciliation queries
TransactionSchema.index({ status: 1,   createdAt: -1 });

// Type-based queries (e.g. all REFUNDs)
TransactionSchema.index({ type: 1,     createdAt: -1 });

//////////////////////////////////////////////////////////////
// 🚀 EXPORT
//////////////////////////////////////////////////////////////

export default mongoose.models.Transaction ||
  mongoose.model("Transaction", TransactionSchema);