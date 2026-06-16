import mongoose from "mongoose";

//////////////////////////////////////////////////////////////
// 🗺 SERVICE ZONE — HYBRID ENGINE (FINAL 🔥)
//////////////////////////////////////////////////////////////

const ServiceZoneSchema = new mongoose.Schema(
  {
    //////////////////////////////////////////////////////////
    // BASIC INFO
    //////////////////////////////////////////////////////////

    name: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    slug: {
      type: String,
      trim: true,
      lowercase: true,
    },

    //////////////////////////////////////////////////////////
    // 🔥 SALON LINK
    //////////////////////////////////////////////////////////

    salonRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Salon",
      required: true,
      index: true,
    },

    //////////////////////////////////////////////////////////
    // TERRITORY
    //////////////////////////////////////////////////////////

    countryRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Country",
      required: true,
    },

    stateRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "State",
      required: true,
    },

    districtRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "District",
      required: true,
    },

    cityRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "City",
      required: true,
    },

    //////////////////////////////////////////////////////////
    // 🔥 GEO POINT (VALIDATED)
    //////////////////////////////////////////////////////////

    center: {
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
    // 🔥 RADIUS (SAFE LIMITS)
    //////////////////////////////////////////////////////////

    radiusKm: {
      type: Number,
      default: 5,
      min: 1,
      max: 50,
    },

    //////////////////////////////////////////////////////////
    // OPTIONAL POLYGON
    //////////////////////////////////////////////////////////

    geoPolygon: {
      type: {
        type: String,
        enum: ["Polygon", "MultiPolygon"],
        default: null,
      },
      coordinates: {
        type: Array,
        default: null,
      },
    },

    //////////////////////////////////////////////////////////
    // BUSINESS
    //////////////////////////////////////////////////////////

    serviceable: {
      type: Boolean,
      default: true,
      index: true,
    },

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
    // 🔥 PRIORITY (RANKING SYSTEM)
    //////////////////////////////////////////////////////////

    priority: {
      type: Number,
      default: 0,
    },

    //////////////////////////////////////////////////////////
    // CAPACITY
    //////////////////////////////////////////////////////////

    capacity: {
      maxBookings: {
        type: Number,
        default: 1000,
      },
      currentLoad: {
        type: Number,
        default: 0,
      },
    },
  },
  { timestamps: true }
);

//////////////////////////////////////////////////////////////
// 🔐 UNIQUE (SAFE)
//////////////////////////////////////////////////////////////

ServiceZoneSchema.index(
  { salonRef: 1, isDeleted: 1 },
  { unique: true }
);

//////////////////////////////////////////////////////////////
// ⚡ PERFORMANCE INDEXES
//////////////////////////////////////////////////////////////

// 🔥 GEO + FILTER (CRITICAL)
ServiceZoneSchema.index({
  center: "2dsphere",
  serviceable: 1,
  isActive: 1,
});

// 🔥 CITY SEARCH
ServiceZoneSchema.index({
  cityRef: 1,
  radiusKm: 1,
});

// 🔥 DISTRICT FILTER
ServiceZoneSchema.index({
  districtRef: 1,
  serviceable: 1,
  isActive: 1,
});

//////////////////////////////////////////////////////////////
// 🌍 GEO INDEX (POLYGON)
//////////////////////////////////////////////////////////////

ServiceZoneSchema.index(
  { geoPolygon: "2dsphere" },
  {
    partialFilterExpression: { geoPolygon: { $ne: null } },
  }
);

//////////////////////////////////////////////////////////////
// 🧠 AUTO SLUG
//////////////////////////////////////////////////////////////

ServiceZoneSchema.pre("validate", function (next) {
  if (!this.slug && this.name) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }
  next();
});

//////////////////////////////////////////////////////////////
// 🚀 EXPORT
//////////////////////////////////////////////////////////////

export default mongoose.models.ServiceZone ||
  mongoose.model("ServiceZone", ServiceZoneSchema);