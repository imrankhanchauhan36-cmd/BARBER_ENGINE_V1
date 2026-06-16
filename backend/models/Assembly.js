import mongoose from "mongoose";

//////////////////////////////////////////////////////////////
// 🇮🇳 ASSEMBLY SCHEMA — GLOBAL MAP COMPATIBLE
//////////////////////////////////////////////////////////////

const AssemblySchema = new mongoose.Schema(
  {
    //////////////////////////////////////////////////////////
    // 1️⃣ BASIC IDENTIFICATION
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

    // ⭐ FIX: made optional (auto-generation safe)
    code: {
      type: String,
      required: false,
      trim: true,
      uppercase: true,
      minlength: 2,
      maxlength: 50,
      index: true,
    },

    assemblyNumber: {
      type: Number,
      default: null,
      index: true,
    },

    assemblyType: {
      type: String,
      enum: ["VIDHAN_SABHA", "METRO", "SPECIAL"],
      default: "VIDHAN_SABHA",
      index: true,
    },

    //////////////////////////////////////////////////////////
    // 2️⃣ TERRITORY RELATIONS
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
    // 3️⃣ GEO (OPTIONAL — CORRECT)
    //////////////////////////////////////////////////////////

    geo: {
      type: {
        type: String,
        enum: ["Point"],
        default: null,
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: null,
        validate: {
          validator: function (val) {
            if (!val) return true;

            return (
              val.length === 2 &&
              val[0] >= -180 && val[0] <= 180 &&
              val[1] >= -90 && val[1] <= 90
            );
          },
          message: "Invalid geo coordinates",
        },
      },
    },

    //////////////////////////////////////////////////////////
    // 4️⃣ SYSTEM FLAGS
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
    // 5️⃣ INTERNAL NOTES
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
// 🔐 UNIQUE CONSTRAINTS
//////////////////////////////////////////////////////////////

AssemblySchema.index(
  { name: 1, districtRef: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
  }
);

AssemblySchema.index(
  { code: 1, districtRef: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
  }
);

AssemblySchema.index(
  { assemblyNumber: 1, stateRef: 1 },
  {
    unique: true,
    partialFilterExpression: {
      assemblyNumber: { $type: "number" },
      isDeleted: false,
    },
  }
);

//////////////////////////////////////////////////////////////
// ⚡ PERFORMANCE INDEXES
//////////////////////////////////////////////////////////////

AssemblySchema.index({
  districtRef: 1,
  isActive: 1,
  isDeleted: 1,
});

AssemblySchema.index({
  stateRef: 1,
  districtRef: 1,
  isActive: 1,
  isDeleted: 1,
});

AssemblySchema.index({
  countryRef: 1,
  stateRef: 1,
  districtRef: 1,
  isActive: 1,
});

AssemblySchema.index({
  code: 1,
  stateRef: 1,
  isActive: 1,
});

//////////////////////////////////////////////////////////////
// 🌍 GEO INDEX
//////////////////////////////////////////////////////////////

AssemblySchema.index(
  { geo: "2dsphere" },
  {
    partialFilterExpression: {
      "geo.type": "Point",
      "geo.coordinates": { $exists: true },
    },
  }
);

//////////////////////////////////////////////////////////////
// 🚀 TERRITORY ENGINE CORE INDEX
//////////////////////////////////////////////////////////////

AssemblySchema.index({
  countryRef: 1,
  stateRef: 1,
  districtRef: 1,
  isActive: 1,
  isDeleted: 1,
});

//////////////////////////////////////////////////////////////
// ⭐ OPTIONAL PRO INDEX (FAST LOOKUP)
//////////////////////////////////////////////////////////////

AssemblySchema.index({
  stateRef: 1,
  assemblyNumber: 1,
});

//////////////////////////////////////////////////////////////
// ⭐ AUTO-GENERATE CODE (NOW WORKS CORRECTLY)
//////////////////////////////////////////////////////////////

AssemblySchema.pre("validate", function (next) {
  if (!this.code && this.name) {
    this.code = this.name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "_")
      .substring(0, 50);
  }
  next();
});

//////////////////////////////////////////////////////////////
// 🚀 SAFE EXPORT
//////////////////////////////////////////////////////////////

export default mongoose.models.Assembly ||
  mongoose.model("Assembly", AssemblySchema);