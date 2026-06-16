import mongoose from "mongoose";

const ResourceSchema = new mongoose.Schema(
  {
    // 🔗 Which salon this chair belongs to
    salonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Salon",
      required: true,
      index: true,
    },

    // 🪑 Chair / Stall name
    chairName: {
      type: String,
      required: true, // "Chair 1", "Chair 2"
    },

    // 👤 Assigned Barber (can change anytime)
    assignedBarberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null, // chair can exist without barber
    },

    // ✅ Chair active or not
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

// 🔐 One chair name must be unique per salon
ResourceSchema.index(
  { salonId: 1, chairName: 1 },
  { unique: true }
);

export default mongoose.models.Resource ||
  mongoose.model("Resource", ResourceSchema);
