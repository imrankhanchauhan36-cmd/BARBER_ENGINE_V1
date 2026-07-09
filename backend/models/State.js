import mongoose from "mongoose";

//////////////////////////////////////////////////////
// 🇮🇳 PAN INDIA STATE SCHEMA (FINAL LOCKED)
//////////////////////////////////////////////////////

const StateSchema = new mongoose.Schema(
  {
    //////////////////////////////////////////////////////
    // 📛 DISPLAY NAME
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
    // 🔎 NORMALIZED NAME (🔥 CRITICAL)
    //////////////////////////////////////////////////////
    normalizedName: {
      type: String,
      required: true,
      lowercase: true,
    },

    //////////////////////////////////////////////////////
    // 🏷 STATE CODE
    //////////////////////////////////////////////////////
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      match: /^[A-Z]{2,3}$/,
    },

    //////////////////////////////////////////////////////
    // 🔗 SLUG
    //////////////////////////////////////////////////////
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      immutable: true, // 🔥 ADD THIS
    },

    //////////////////////////////////////////////////////
    // 🏛 STATE TYPE
    //////////////////////////////////////////////////////
    type: {
      type: String,
      enum: ["STATE", "UT"],
      required: true,
    },

    //////////////////////////////////////////////////////
    // 🌐 GEO NAME CODE
    //////////////////////////////////////////////////////
    geoNameCode: {
      type: String,
      default: null,
      index: true,
    },

    //////////////////////////////////////////////////////
    // 🌍 COUNTRY REF
    //////////////////////////////////////////////////////
    countryRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Country",
      required: true,
    },

    //////////////////////////////////////////////////////
    // 🧠 ALIASES (RAW)
    //////////////////////////////////////////////////////
    aliases: {
      type: [String],
      default: [],
    },

    //////////////////////////////////////////////////////
    // 🧠 ALIASES NORMALIZED (🔥 FUTURE SEARCH BOOST)
    //////////////////////////////////////////////////////
    aliasesNormalized: {
      type: [String],
      default: [],
    },

    //////////////////////////////////////////////////////
    // 🚦 BUSINESS CONTROL
    //////////////////////////////////////////////////////
    launchStatus: {
      type: String,
      enum: ["PRE_LAUNCH", "SOFT_LAUNCH", "LIVE", "BLOCKED"],
      default: "PRE_LAUNCH",
    },

    serviceable: {
      type: Boolean,
      default: false,
    },

    priority: {
      type: Number,
      default: 0,
    },

    //////////////////////////////////////////////////////
    // 🆕 ADMIN REF
    //////////////////////////////////////////////////////
    primaryAdminRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    //////////////////////////////////////////////////////
    // 🏢 EXPANSION & CONTACT DETAILS
    //////////////////////////////////////////////////////
    capital: {
      type: String,
      trim: true,
      default: null,
    },

    zone: {
      type: String,
      enum: ["NORTH", "SOUTH", "EAST", "WEST", "CENTRAL", "NE", null],
      default: null,
    },

    timezone: {
      type: String,
      default: "IST (UTC+5:30)",
    },

    targetAreas: {
      type: Number,
      default: 0,
      min: 0,
    },

    targetSalons: {
      type: Number,
      default: 0,
      min: 0,
    },

    expectedDistrictCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    manualTerritoryOverride: {
      type: String,
      enum: ["OPEN", "PARTIAL", "CLOSED", null],
      default: null,
    },

    //////////////////////////////////////////////////////
    // ⭐ GEO (STRICT — NO FAKE DATA)
    geo: {
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

    //////////////////////////////////////////////////////
    // 📊 STATS
    //////////////////////////////////////////////////////
    stats: {
      totalDistricts: { type: Number, default: 0, min: 0 },
      totalCities: { type: Number, default: 0, min: 0 },
      totalSalons: { type: Number, default: 0, min: 0 },
    },

    //////////////////////////////////////////////////////
    // 📝 NOTES
    //////////////////////////////////////////////////////
    notes: {
      type: String,
      default: null,
      maxlength: 500,
    },

    //////////////////////////////////////////////////////
    // 🔐 GOVERNANCE
    //////////////////////////////////////////////////////
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    //////////////////////////////////////////////////////
    // 🚦 FLAGS
    //////////////////////////////////////////////////////
    isActive: {
      type: Boolean,
      default: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },

    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

//////////////////////////////////////////////////////
// 🔥 AUTO NORMALIZATION + SLUG + ALIASES
//////////////////////////////////////////////////////

StateSchema.pre("validate", function (next) {
  if (this.name) {
    // normalizedName
    this.normalizedName = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  // slug (only generate if not exists → SEO safe)
  if (!this.slug && this.name) {
    this.slug = this.name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^\w-]+/g, "");
  }

  // aliasesNormalized
  if (this.aliases && this.aliases.length > 0) {
    this.aliasesNormalized = this.aliases.map((a) =>
      a.toLowerCase().replace(/[^a-z0-9]/g, "")
    );
  }

  next();
});

//////////////////////////////////////////////////////
// 🔐 UNIQUE INDEXES
//////////////////////////////////////////////////////

StateSchema.index(
  { name: 1, countryRef: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

StateSchema.index(
  { code: 1, countryRef: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

StateSchema.index(
  { slug: 1, countryRef: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

// 🔥 NEW (duplicate-safe normalizedName)
StateSchema.index(
  { normalizedName: 1, countryRef: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

//////////////////////////////////////////////////////
// ⚡ PERFORMANCE INDEXES
//////////////////////////////////////////////////////

StateSchema.index({
  countryRef: 1,
  launchStatus: 1,
  serviceable: 1,
  isActive: 1,
  isDeleted: 1,
});

StateSchema.index({
  countryRef: 1,
  priority: -1,
  isActive: 1,
  isDeleted: 1,
});

StateSchema.index({
  countryRef: 1,
  isActive: 1,
});

//////////////////////////////////////////////////////
// 🔍 SEARCH INDEXES
//////////////////////////////////////////////////////

StateSchema.index({ normalizedName: 1 });
StateSchema.index({ aliasesNormalized: 1 });

// 🔥 ADD THIS (TEXT SEARCH)
StateSchema.index({
  name: "text",
  aliases: "text"
});

//////////////////////////////////////////////////////
// ⭐ GEO INDEX
//////////////////////////////////////////////////////

StateSchema.index({ geo: "2dsphere" });

//////////////////////////////////////////////////////
// ⭐ ADMIN INDEXES
//////////////////////////////////////////////////////

StateSchema.index(
  { primaryAdminRef: 1 },
  {
    unique: true,
    partialFilterExpression: {
      primaryAdminRef: { $ne: null },
      isDeleted: false,
    },
  }
);

StateSchema.index({
  primaryAdminRef: 1,
  isActive: 1,
  isDeleted: 1,
});

//////////////////////////////////////////////////////
// 🚀 EXPORT
//////////////////////////////////////////////////////

export default mongoose.models.State ||
  mongoose.model("State", StateSchema);