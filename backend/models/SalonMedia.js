import mongoose from "mongoose";

//////////////////////////////////////////////////////////////
// 🔥 SCHEMA
//////////////////////////////////////////////////////////////

const SalonMediaSchema = new mongoose.Schema(
  {
    //////////////////////////////////////////////////////
    // 🏪 SALON
    //////////////////////////////////////////////////////
    salonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Salon",
      required: true,
    },

    //////////////////////////////////////////////////////
    // 🖼 IMAGE URL
    //////////////////////////////////////////////////////
    url: {
      type: String,
      required: true,
      trim: true,
      match: /^https?:\/\/.+\..+/, // ✅ improved validation
    },

    //////////////////////////////////////////////////////
    // 🎯 TYPE
    //////////////////////////////////////////////////////
    type: {
      type: String,
      enum: ["COVER", "SHOP", "WORK", "CERTIFICATE"],
      default: "SHOP",
    },

    //////////////////////////////////////////////////////
    // 🔢 ORDER (SORTING ONLY — NOT UNIQUE)
    //////////////////////////////////////////////////////
    order: {
      type: Number,
      default: 1,
      index: true,
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
    // 🗑 SOFT DELETE
    //////////////////////////////////////////////////////
    isDeleted: {
      type: Boolean,
      default: false,
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

// 🔥 FAST FETCH (ACTIVE MEDIA)
SalonMediaSchema.index({ salonId: 1, isActive: 1, isDeleted: 1 });

// 🔥 SORTING
SalonMediaSchema.index({ salonId: 1, order: 1 });


// 🔥 ONLY ONE COVER IMAGE
SalonMediaSchema.index(
  { salonId: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: "COVER",
      isDeleted: false,
    },
  }
);

// 🔥 UNIQUE URL (NO DUPLICATE IMAGE)
SalonMediaSchema.index(
  { salonId: 1, url: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
  }
);

// 🔥 UI OPTIMIZATION
SalonMediaSchema.index({ salonId: 1, isDeleted: 1, order: 1 });

//////////////////////////////////////////////////////////////
// 🧠 HELPER METHODS
//////////////////////////////////////////////////////////////

SalonMediaSchema.methods.isVisible = function () {
  return this.isActive && !this.isDeleted;
};

//////////////////////////////////////////////////////////////
// 🚀 EXPORT
//////////////////////////////////////////////////////////////

export default mongoose.models.SalonMedia ||
  mongoose.model("SalonMedia", SalonMediaSchema);