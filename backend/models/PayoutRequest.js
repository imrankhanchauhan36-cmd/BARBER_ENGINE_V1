import mongoose from "mongoose";

const PayoutRequestSchema = new mongoose.Schema(
  {
    salonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Salon",
      required: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: ["REQUESTED", "PAID", "REJECTED"],
      default: "REQUESTED",
      immutable: true, // 🔒 DAY-20: once set, cannot be changed
    },

    // 🧾 DAY-20: admin audit fields
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },

    approvedAt: {
      type: Date,
    },

    adminNote: {
      type: String,
    },
  },
  { timestamps: true }
);

export default mongoose.models.PayoutRequest ||
  mongoose.model("PayoutRequest", PayoutRequestSchema);
