import mongoose from "mongoose";

//////////////////////////////////////////////////////////////
// 🇮🇳 PINCODE SCHEMA — FINAL LOCKED (CORE ENGINE 10/10)
//////////////////////////////////////////////////////////////

const PincodeSchema = new mongoose.Schema(
  {
    //////////////////////////////////////////////////////////
    // 1️⃣ PINCODE IDENTIFICATION
    //////////////////////////////////////////////////////////

    code: {
      type: String,
      required: true,
      trim: true,
      match: /^[1-9][0-9]{5}$/,
      index: true,
    },

    //////////////////////////////////////////////////////////
    // 2️⃣ TERRITORY RELATIONS (FIXED 🔥)
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

    //////////////////////////////////////////////////////////
    // 🔥 CRITICAL FIX — CITY LINK (MANDATORY)
    //////////////////////////////////////////////////////////

    cityRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "City",
      required: true,
    },

    //////////////////////////////////////////////////////////
    // ❌ ASSEMBLY REMOVED (NOT USED IN ARCHITECTURE)
    //////////////////////////////////////////////////////////
    // (kept out intentionally — reduces complexity)

    //////////////////////////////////////////////////////////
    // 3️⃣ OPTIONAL DISPLAY NAME
    //////////////////////////////////////////////////////////

    name: {
      type: String,
      default: null,
      trim: true,
      maxlength: 120,
      index: true,
    },

    //////////////////////////////////////////////////////////
    // 🔎 OPTIONAL NORMALIZED (FUTURE SEARCH)
    //////////////////////////////////////////////////////////

    normalizedName: {
      type: String,
      default: null,
      lowercase: true,
      index: true,
    },

    //////////////////////////////////////////////////////////
    // 4️⃣ GEO (STRICT — REQUIRED 🔥)
    //////////////////////////////////////////////////////////

    geo: {
      type: {
        type: String,
        enum: ["Point"],
        required: true,
      },
      coordinates: {
        type: [Number], // [lng, lat]
        required: true,
        validate: {
          validator: function (val) {
            if (!val || val.length !== 2) return false;

            const [lng, lat] = val;

            return (
              typeof lng === "number" &&
              typeof lat === "number" &&
              lng >= -180 &&
              lng <= 180 &&
              lat >= -90 &&
              lat <= 90
            );
          },
          message: "Invalid geo coordinates",
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
      maxlength: 500,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

//////////////////////////////////////////////////////////////
// 🔥 AUTO NORMALIZATION (OPTIONAL SAFE)
//////////////////////////////////////////////////////////////

PincodeSchema.pre("validate", function (next) {
  if (this.code) {
    this.normalizedName = this.code.toLowerCase();
  }
  next();
});


//////////////////////////////////////////////////////////////
// ⚡ FAST LOOKUP INDEXES
//////////////////////////////////////////////////////////////

PincodeSchema.index({
  stateRef: 1,
  cityRef: 1,
  isActive: 1,
  isDeleted: 1,
});

PincodeSchema.index({
  districtRef: 1,
  isActive: 1,
  isDeleted: 1,
});

//////////////////////////////////////////////////////////////
// 🔍 SEARCH INDEX (OPTIONAL)
//////////////////////////////////////////////////////////////

PincodeSchema.index({
  name: 1,
  stateRef: 1,
});

//////////////////////////////////////////////////////////////
// 🌍 GEO INDEX (STRICT)
//////////////////////////////////////////////////////////////

PincodeSchema.index({
  geo: "2dsphere",
});

//////////////////////////////////////////////////////////////
// 🚀 EXPORT
//////////////////////////////////////////////////////////////

export default mongoose.models.Pincode ||
  mongoose.model("Pincode", PincodeSchema);