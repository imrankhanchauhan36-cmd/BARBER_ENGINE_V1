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
      trim: true,         // ✅ Fix 2 — removed toLowerCase setter, preserve original casing
      maxlength: 100,     // search uses $options: "i" in controller
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

    //////////////////////////////////////////////////////
    // 📋 STATUS HISTORY — immutable audit trail
    //////////////////////////////////////////////////////
    statusHistory: [
      {
        previousStatus: { type: Boolean, default: null }, // ✅ Fix 4
        currentStatus:  { type: Boolean },
        isActive:       { type: Boolean },
        changedAt:      { type: Date, default: Date.now },
        changedBy:      { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        adminLevel:     { type: String },
        reason:         { type: String, default: null, maxlength: 300 },
      },
    ],

    //////////////////////////////////////////////////////
    // 🚚 TRANSFER HISTORY — immutable audit trail
    //////////////////////////////////////////////////////
    transferHistory: [
      {
        fromSalonId:   { type: mongoose.Schema.Types.ObjectId, ref: "Salon" },
        toSalonId:     { type: mongoose.Schema.Types.ObjectId, ref: "Salon" },
        fromChairId:   { type: mongoose.Schema.Types.ObjectId, ref: "Chair", default: null }, // ✅ Fix 5
        toChairId:     { type: mongoose.Schema.Types.ObjectId, ref: "Chair", default: null }, // ✅ Fix 5
        transferredAt: { type: Date, default: Date.now },
        transferredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        adminLevel:    { type: String },
        reason:        { type: String, maxlength: 300 },
      },
    ],
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

//////////////////////////////////////////////////////////////
// 🚀 INDEXES (PERFORMANCE + SAFETY)
//////////////////////////////////////////////////////////////

// ✅ Fix 1 — UNIQUE PHONE PER SALON (isDeleted: false added)
StaffSchema.index(
  { salonId: 1, phone: 1 },
  {
    unique: true,
    partialFilterExpression: {
      phone:     { $ne: null },
      isDeleted: false,         // ✅ deleted staff ka phone reuse ho sake
    },
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

// ✅ Fix 3 — ONE CHAIR = ONE STAFF (uncommented + isDeleted: false)
StaffSchema.index(
  { chairId: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: {
      chairId:   { $ne: null },
      isDeleted: false,
    },
  }
);

// 🔥 LOAD BALANCING
StaffSchema.index({ salonId: 1, totalBookingsToday: 1 });

//////////////////////////////////////////////////////////////
// 🚀 EXPORT
//////////////////////////////////////////////////////////////

export default mongoose.models.Staff ||
  mongoose.model("Staff", StaffSchema);