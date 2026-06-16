import mongoose from "mongoose";

const adminAuditLogSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    action: {
      type: String,
      required: true,
    },
    targetType: {
      type: String, // SALON / ADMIN
      required: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    meta: {
      type: Object, // extra info (status, commission, etc.)
      default: {},
    },
  },
  { timestamps: true }
);

export default mongoose.model("AdminAuditLog", adminAuditLogSchema);
