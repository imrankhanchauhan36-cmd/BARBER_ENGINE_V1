import mongoose from "mongoose";

//////////////////////////////////////////////////////////////
// 🔥 SCHEMA
//////////////////////////////////////////////////////////////

const StaffSchema = new mongoose.Schema(
  {
    //////////////////////////////////////////////////////
    // 🏪 SALON
    //////////////////////////////////////////////////////
    salonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Salon",
      required: true,
      index: true,
    },

    //////////////////////////////////////////////////////
    // 👤 BASIC INFO
    //////////////////////////////////////////////////////
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
      set: (v) => v.trim().toLowerCase(), // 🔥 normalized (UI can format)
    },

    phone: {
      type: String,
      trim: true,
      match: /^[6-9]\d{9}$/,
      default: null,
    },

    //////////////////////////////////////////////////////
    // 🎯 ROLE
    //////////////////////////////////////////////////////
    role: {
      type: String,
      enum: ["BARBER", "HELPER", "MANAGER"],
      default: "BARBER",
      index: true,
    },

    //////////////////////////////////////////////////////
    // 🎯 SKILLS
    //////////////////////////////////////////////////////
    skills: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Service",
      },
    ],

    //////////////////////////////////////////////////////
    // 🪑 CHAIR ASSIGNMENT
    //////////////////////////////////////////////////////
    chairId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chair",
      default: null,
    },

    //////////////////////////////////////////////////////
    // ⚙️ STATUS
    //////////////////////////////////////////////////////
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    //////////////////////////////////////////////////////
    // 👑 OWNER FLAG (IMPORTANT)
    //////////////////////////////////////////////////////
    isOwner: {
      type: Boolean,
      default: false,
      index: true,
    },

    //////////////////////////////////////////////////////
    // 🗑 SOFT DELETE
    //////////////////////////////////////////////////////
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    //////////////////////////////////////////////////////
    // 📊 LOAD TRACKING
    //////////////////////////////////////////////////////
    totalBookingsToday: {
      type: Number,
      default: 0,
      index: true,
    },

    //////////////////////////////////////////////////////
    // 👤 AUDIT
    //////////////////////////////////////////////////////
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

//////////////////////////////////////////////////////////////
// 🚀 INDEXES (PERFORMANCE + SAFETY)
//////////////////////////////////////////////////////////////

// 🔥 UNIQUE PHONE PER SALON
StaffSchema.index(
  { salonId: 1, phone: 1 },
  {
    unique: true,
    partialFilterExpression: { phone: { $ne: null } },
  }
);

// 🔥 UNIQUE NAME PER SALON (ACTIVE ONLY)
StaffSchema.index(
  { salonId: 1, name: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
  }
);

// 🔥 FAST ACTIVE FILTER (BOOKING ENGINE)
StaffSchema.index({ salonId: 1, isActive: 1, isDeleted: 1 });

// 🔥 SKILL FILTERING (MATCH SERVICE → STAFF)
StaffSchema.index({ salonId: 1, skills: 1 });

// 🔥 CHAIR LOOKUP
StaffSchema.index({ chairId: 1 });

// 🔥 OPTIONAL: ONE CHAIR = ONE STAFF (UNCOMMENT IF NEEDED)
/*
StaffSchema.index(
  { chairId: 1 },
  {
    unique: true,
    partialFilterExpression: { chairId: { $ne: null } },
  }
);
*/

// 🔥 LOAD BALANCING
StaffSchema.index({ salonId: 1, totalBookingsToday: 1 });

//////////////////////////////////////////////////////////////
// 🚀 EXPORT
//////////////////////////////////////////////////////////////

export default mongoose.models.Staff ||
  mongoose.model("Staff", StaffSchema);