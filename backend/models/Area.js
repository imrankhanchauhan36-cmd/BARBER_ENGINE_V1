/**
 * BARBER ENGINE V1
 * backend/models/Area.js
 * Area Model — Location Module — 10/10 FROZEN
 */

import mongoose from "mongoose";

//////////////////////////////////////////////////////////////
// 🔥 ENUMS
//////////////////////////////////////////////////////////////

export const AREA_TYPE = {
  RESIDENTIAL: "RESIDENTIAL",
  COMMERCIAL:  "COMMERCIAL",
  INDUSTRIAL:  "INDUSTRIAL",
  MIXED:       "MIXED",
};

export const AREA_TIER = {
  TIER_1: "TIER_1",
  TIER_2: "TIER_2",
  TIER_3: "TIER_3",
  RURAL:  "RURAL",
};

//////////////////////////////////////////////////////////////
// 🔥 SCHEMA
//////////////////////////////////////////////////////////////

const AreaSchema = new mongoose.Schema(
  {
    //////////////////////////////////////////////////////////
    // 📝 BASIC INFO
    //////////////////////////////////////////////////////////
    name: {
      type:      String,
      required:  true,
      trim:      true,
      maxlength: 100,
    },

    // ✅ Normalized name — case-insensitive uniqueness
    normalizedName: {
      type:  String,
      trim:  true,
      index: false,
    },

    slug: {
      type:      String,
      trim:      true,
      lowercase: true,
      default:   null,
    },

    description: {
      type:      String,
      trim:      true,
      maxlength: 500,
      default:   null,
    },

    type: {
      type:    String,
      enum:    Object.values(AREA_TYPE),
      default: AREA_TYPE.MIXED,
      index:   true,
    },

    tier: {
      type:    String,
      enum:    Object.values(AREA_TIER),
      default: AREA_TIER.TIER_3,
      index:   true,
    },

    //////////////////////////////////////////////////////////
    // 📮 PINCODE
    //////////////////////////////////////////////////////////
    pincode: {
      type:    String,
      default: null,
      trim:    true,
      match:   [/^\d{6}$/, "Pincode must be exactly 6 digits"],
    },

    // Multiple pincodes for large areas
    pincodeRange: {
      type:    [String],
      default: [],
    },

    //////////////////////////////////////////////////////////
    // 📍 GEO COORDINATES
    //////////////////////////////////////////////////////////
    coordinates: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },

    // GeoJSON boundaries for geo-fencing
    boundaries: {
      type: {
        type:    String,
        enum:    ["Polygon"],
        default: null,
      },
      coordinates: {
        type:    [[[Number]]],
        default: null,
      },
    },

    //////////////////////////////////////////////////////////
    // 🔗 REFERENCES
    //////////////////////////////////////////////////////////
    cityRef: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "City",
      required: true,
      index:    true,
    },

    districtRef: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "District",
      required: true,
      index:    true,
    },

    stateRef: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "State",
      required: true,
      index:    true,
    },

    countryRef: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "Country",
      default: null,
      index:   true,
    },

    //////////////////////////////////////////////////////////
    // 🛵 SERVICE FLAGS
    //////////////////////////////////////////////////////////
    isServiceable: {
      type:    Boolean,
      default: true,
      index:   true,
    },

    serviceRadius: {
      type:    Number, // in km
      default: 5,
      min:     0,
    },

    deliveryAvailable: {
      type:    Boolean,
      default: false,
    },

    //////////////////////////////////////////////////////////
    // 📊 DEMOGRAPHICS
    //////////////////////////////////////////////////////////
    population: {
      type:    Number,
      default: null,
      min:     0,
    },

    landmarks: {
      type:    [String],
      default: [],
    },

    //////////////////////////////////////////////////////////
    // 📈 METADATA (denormalized for performance)
    // Updated by background jobs — never in request cycle
    //////////////////////////////////////////////////////////
    metadata: {
      totalSalons:  { type: Number, default: 0, min: 0 },
      activeSalons: { type: Number, default: 0, min: 0 },
      totalBookings:{ type: Number, default: 0, min: 0 },
      avgRating:    { type: Number, default: 0, min: 0, max: 5 },
      lastUpdated:  { type: Date,   default: null },
    },

    //////////////////////////////////////////////////////////
    // 🔒 STATUS
    //////////////////////////////////////////////////////////
    isActive: {
      type:    Boolean,
      default: true,
      index:   true,
    },

    isDeleted: {
      type:    Boolean,
      default: false,
      index:   true,
    },

    deletedAt: {
      type:    Date,
      default: null,
    },

    //////////////////////////////////////////////////////////
    // 👤 AUDIT
    //////////////////////////////////////////////////////////
    createdBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "User",
      default: null,
    },

    updatedBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "User",
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

//////////////////////////////////////////////////////////////
// 🚀 INDEXES
//////////////////////////////////////////////////////////////

// ✅ Case-insensitive uniqueness — sparse for existing data
AreaSchema.index({ cityRef: 1, normalizedName: 1 }, { unique: true, sparse: true });
AreaSchema.index({ districtRef: 1, isActive: 1 });
AreaSchema.index({ stateRef: 1, isActive: 1 });
AreaSchema.index({ pincode: 1 }, { sparse: true });
AreaSchema.index({ isServiceable: 1, isActive: 1 });
AreaSchema.index({ tier: 1, isActive: 1 });
AreaSchema.index({ "coordinates.lat": 1, "coordinates.lng": 1 });

//////////////////////////////////////////////////////////////
// 🔧 HOOKS
//////////////////////////////////////////////////////////////

// ✅ Auto-normalize name + auto-slug
AreaSchema.pre("save", function(next) {
  if (this.isModified("name")) {
    this.normalizedName = this.name.toLowerCase().trim().replace(/\s+/g, " ");
    if (!this.slug) {
      this.slug = this.name.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    }
  }
  next();
});

AreaSchema.pre("findOneAndUpdate", function(next) {
  const update = this.getUpdate();
  if (update?.$set?.name) {
    update.$set.normalizedName = update.$set.name.toLowerCase().trim().replace(/\s+/g, " ");
    update.$set.slug = update.$set.name.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  }
  next();
});

//////////////////////////////////////////////////////////////
// 🚀 EXPORT
//////////////////////////////////////////////////////////////

export default mongoose.models.Area || mongoose.model("Area", AreaSchema);