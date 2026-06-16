import mongoose from "mongoose";

//////////////////////////////////////////////////////////////
// 🇮🇳 AREA SCHEMA — FINAL ENTERPRISE VERSION
//////////////////////////////////////////////////////////////

const AreaSchema = new mongoose.Schema(
  {
    //////////////////////////////////////////////////////////
    // 1️⃣ AREA NAME
    //////////////////////////////////////////////////////////

    name: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      minlength: 2,
      maxlength: 120,
      index: true,
    },

    //////////////////////////////////////////////////////////
    // 2️⃣ OPTIONAL AREA CODE
    //////////////////////////////////////////////////////////

    code: {
      type: String,
      default: null,
      trim: true,
      uppercase: true,
      maxlength: 50,
      index: true,
    },

    //////////////////////////////////////////////////////////
    // ⭐ NEW: SLUG (SEO + ROUTING)
    //////////////////////////////////////////////////////////

    slug: {
      type: String,
      lowercase: true,
      trim: true,
      index: true,
    },

    //////////////////////////////////////////////////////////
    // 3️⃣ TERRITORY RELATIONS
    //////////////////////////////////////////////////////////

    countryRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Country",
      required: true,
      index: true,
    },

    stateRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "State",
      required: true,
      index: true,
    },

    districtRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "District",
      required: true,
      index: true,
    },

    assemblyRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Assembly",
      default: null,
      index: true,
    },

    pincodeRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pincode",
      required: true,
      index: true,
    },

    //////////////////////////////////////////////////////////
    // 4️⃣ GEO CENTER POINT
    //////////////////////////////////////////////////////////

    geo: {
      type: {
        type: String,
        enum: ["Point"],
        default: null,
      },
      coordinates: {
        type: [Number],
        default: null,
        validate: {
          validator: function (val) {
            if (!val) return true;
            return (
              val.length === 2 &&
              val[0] >= -180 &&
              val[0] <= 180 &&
              val[1] >= -90 &&
              val[1] <= 90
            );
          },
        },
      },
    },

    //////////////////////////////////////////////////////////
    // 5️⃣ SERVICE FLAGS
    //////////////////////////////////////////////////////////

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    //////////////////////////////////////////////////////////
    // 6️⃣ INTERNAL NOTES
    //////////////////////////////////////////////////////////

    notes: {
      type: String,
      default: null,
      trim: true,
      maxlength: 500,
    },
  },
  {
    timestamps: true,
  }
);

//////////////////////////////////////////////////////////////
// 🔐 UNIQUE CONSTRAINTS
//////////////////////////////////////////////////////////////

AreaSchema.index(
  { name: 1, pincodeRef: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
  }
);

AreaSchema.index(
  { code: 1, pincodeRef: 1 },
  {
    unique: true,
    partialFilterExpression: {
      code: { $ne: null }, // ⭐ FIXED
      isDeleted: false,
    },
  }
);

//////////////////////////////////////////////////////////////
// ⚡ SEARCH INDEXES
//////////////////////////////////////////////////////////////

AreaSchema.index({ name: 1, isActive: 1 });

AreaSchema.index({
  pincodeRef: 1,
  isActive: 1,
  isDeleted: 1,
});

AreaSchema.index({
  assemblyRef: 1,
  isActive: 1,
  isDeleted: 1,
});

//////////////////////////////////////////////////////////////
// 🚀 CORE TERRITORY ENGINE INDEX
//////////////////////////////////////////////////////////////

AreaSchema.index({
  countryRef: 1,
  stateRef: 1,
  districtRef: 1,
  assemblyRef: 1,
  pincodeRef: 1,
  isActive: 1,
  isDeleted: 1,
});

//////////////////////////////////////////////////////////////
// 🌍 GEO INDEX (ONLY ONE — FIXED)
//////////////////////////////////////////////////////////////

AreaSchema.index(
  { geo: "2dsphere" },
  {
    sparse: true,
    partialFilterExpression: {
      "geo.type": "Point",
      "geo.coordinates": { $exists: true },
    },
  }
);

//////////////////////////////////////////////////////////////
// ⭐ AUTO-GENERATE CODE + SLUG
//////////////////////////////////////////////////////////////

AreaSchema.pre("validate", function (next) {
  if (!this.code && this.name) {
    this.code = this.name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "_")
      .substring(0, 50);
  }

  if (!this.slug && this.name) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  next();
});

//////////////////////////////////////////////////////////////
// 🚀 SAFE EXPORT
//////////////////////////////////////////////////////////////

export default mongoose.models.Area ||
  mongoose.model("Area", AreaSchema);