import mongoose from "mongoose";

const CountrySchema = new mongoose.Schema(
  {
    //////////////////////////////////////////////////////
    // 🌍 NAME
    //////////////////////////////////////////////////////
    name: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      minlength: 2,
      maxlength: 100,
    },

    //////////////////////////////////////////////////////
    // 🌐 ISO2 CODE
    //////////////////////////////////////////////////////
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      match: /^[A-Z]{2,3}$/,
    },

    //////////////////////////////////////////////////////
    // 🌐 ISO3 CODE (STRICT FIX ✅)
    //////////////////////////////////////////////////////
    iso3: {
      type: String,
      uppercase: true,
      trim: true,
      match: /^[A-Z]{3}$/, // ✅ STRICT VALIDATION
    },

    //////////////////////////////////////////////////////
    // 🔢 ISO NUMERIC
    //////////////////////////////////////////////////////
    isoNumeric: {
      type: Number,
      index: true,
    },

    //////////////////////////////////////////////////////
    // 📞 DIAL CODE (STRICT FIX ✅)
    //////////////////////////////////////////////////////
    dialCode: {
      type: String,
      required: true,
      trim: true,
      match: /^\+\d{1,4}$/, // ✅ +91, +1, +971
    },

    //////////////////////////////////////////////////////
    // 💱 CURRENCY
    //////////////////////////////////////////////////////
    currencyCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 3,
    },

    currencyPrecision: {
      type: Number,
      default: 2,
    },

    //////////////////////////////////////////////////////
    // 🕒 TIMEZONES
    //////////////////////////////////////////////////////
    timezones: {
      type: [String],
      required: true,
      validate: {
        validator: function (v) {
          return v.length > 0;
        },
        message: "At least one timezone required",
      },
    },

    //////////////////////////////////////////////////////
    // 📍 GEO CENTROID (ULTRA SAFE ✅)
    //////////////////////////////////////////////////////
    centroid: {
      type: {
        type: String,
        enum: ["Point"],
        required: true,
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: function (val) {
            if (val.length !== 2) return false;

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
          message: "Invalid geo coordinates [lng, lat]",
        },
      },
    },

    //////////////////////////////////////////////////////
    // 🌎 CONTINENT
    //////////////////////////////////////////////////////
    continent: {
      type: String,
      enum: [
        "ASIA",
        "EUROPE",
        "AFRICA",
        "NORTH_AMERICA",
        "SOUTH_AMERICA",
        "AUSTRALIA",
        "ANTARCTICA",
      ],
      default: "ASIA",
      index: true,
    },

    //////////////////////////////////////////////////////
    // 📊 COUNTERS
    //////////////////////////////////////////////////////
    activeStateCount: { type: Number, default: 0, min: 0 },
    activeDistrictCount: { type: Number, default: 0, min: 0 },
    activeCityCount: { type: Number, default: 0, min: 0 },
    activeSalonCount: { type: Number, default: 0, min: 0 },

    //////////////////////////////////////////////////////
    // 🚀 CONTROL
    //////////////////////////////////////////////////////
    priority: { type: Number, default: 0, index: true },

    launchStatus: {
      type: String,
      enum: ["PLANNED", "BETA", "LIVE", "SUSPENDED"],
      default: "PLANNED",
      index: true,
    },

    isActive: { type: Boolean, default: true, index: true },
    isDeleted: { type: Boolean, default: false, index: true },

    //////////////////////////////////////////////////////
    // 📝 NOTES
    //////////////////////////////////////////////////////
    notes: {
      type: String,
      default: null,
      maxlength: 500,
    },
  },
  {
    timestamps: true,
  }
);

//////////////////////////////////////////////////////
// 🔐 UNIQUE INDEXES (FULLY SAFE)
//////////////////////////////////////////////////////

// ISO2
CountrySchema.index(
  { code: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

// ISO3
CountrySchema.index(
  { iso3: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { isDeleted: false },
  }
);

// NAME (CASE-INSENSITIVE UNIQUE)
CountrySchema.index(
  { name: 1 },
  {
    unique: true,
    collation: { locale: "en", strength: 2 },
    partialFilterExpression: { isDeleted: false },
  }
);

// GEO
CountrySchema.index({ centroid: "2dsphere" });

//////////////////////////////////////////////////////
// 🚀 EXPORT
//////////////////////////////////////////////////////

export default mongoose.models.Country ||
  mongoose.model("Country", CountrySchema);