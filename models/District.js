import mongoose from "mongoose";

//////////////////////////////////////////////////////////////
// 🇮🇳 DISTRICT SCHEMA — FINAL LOCKED (ENTERPRISE++)
//////////////////////////////////////////////////////////////

const DistrictSchema = new mongoose.Schema(
  {
    //////////////////////////////////////////////////////////
    // 1️⃣ IDENTITY
    //////////////////////////////////////////////////////////

    name: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      minlength: 2,
      maxlength: 80,
    },

    //////////////////////////////////////////////////////////
    // 🔥 NORMALIZED NAME (CRITICAL)
    //////////////////////////////////////////////////////////

    normalizedName: {
      type: String,
      required: true,
      lowercase: true,
    },

    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      minlength: 2,
      maxlength: 20,
    },

    //////////////////////////////////////////////////////////
    // 🔗 SLUG (SEO SAFE)
    //////////////////////////////////////////////////////////

    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      immutable: true,
    },

    //////////////////////////////////////////////////////////
    // ⭐ HQ CITY (VERY IMPORTANT)
    //////////////////////////////////////////////////////////

    hqCityName: {
      type: String,
      default: null,
    },

    // 🔥 ADD THIS (MISSING FIELD)
    hqCityRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "City",
    },

    aliases: {
      type: [String],
      default: [],
    },

    normalizedAliases: {
      type: [String],
      default: [],
    },
    

    //////////////////////////////////////////////////////////
    // 2️⃣ RELATIONS
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
      index: true,
    },

    //////////////////////////////////////////////////////////
    // 🌐 GEO MAPPING
    //////////////////////////////////////////////////////////

    geoNameCode: {
      type: String,
      default: null,
      index: true,
    },

    admin2Code: {
      type: String,
      default: null,
      index: true,
    },

    // 🔥 FINAL FIX (CRITICAL)
    adminCode: {
      type: String,
      index: true,
      unique: true,
      sparse: true,
    },

    regionClusterRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RegionCluster",
      default: null,
    },

    //////////////////////////////////////////////////////////
    // 3️⃣ BUSINESS CONTROL
    //////////////////////////////////////////////////////////

    launchStatus: {
      type: String,
      enum: ["PRE_LAUNCH", "SOFT_LAUNCH", "LIVE", "BLOCKED"],
      default: "PRE_LAUNCH",
    },

    onboardingEnabled: {
      type: Boolean,
      default: true,
    },

    serviceable: {
      type: Boolean,
      default: false,
    },

    priority: {
      type: Number,
      default: 0,
    },

    //////////////////////////////////////////////////////////
    // 4️⃣ METRICS
    //////////////////////////////////////////////////////////

    activeSalonCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    pendingApprovalCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    suspendedSalonCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    operationalLoadScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    //////////////////////////////////////////////////////////
    // 5️⃣ CAPACITY
    //////////////////////////////////////////////////////////

    maxSalonCapacity: {
      type: Number,
      default: 1000,
      min: 1,
    },

    lastOperationalReviewAt: {
      type: Date,
      default: null,
    },

    //////////////////////////////////////////////////////////
    // 6️⃣ ADMIN
    //////////////////////////////////////////////////////////

    primaryAdminRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    supportAdminCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    //////////////////////////////////////////////////////////
    // ⭐ GEO (STRICT)
    //////////////////////////////////////////////////////////

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

    //////////////////////////////////////////////////////////
    // 7️⃣ SYSTEM
    //////////////////////////////////////////////////////////

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
  },
  {
    timestamps: true,
  }
);

//////////////////////////////////////////////////////////////
// 🔥 AUTO NORMALIZATION + SLUG + ALIASES
//////////////////////////////////////////////////////////////

DistrictSchema.pre("validate", function (next) {
  if (this.name) {
    this.normalizedName = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    if (!this.slug) {
      this.slug = this.name
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^\w-]+/g, "");
    }
  }

  if (this.aliases && this.aliases.length > 0) {
    this.normalizedAliases = this.aliases.map((a) =>
      a.toLowerCase().replace(/[^a-z0-9]/g, "")
    );
  }

  next();
});

//////////////////////////////////////////////////////////////
// 🔐 UNIQUE INDEXES
//////////////////////////////////////////////////////////////

DistrictSchema.index(
  { name: 1, stateRef: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

DistrictSchema.index(
  { code: 1, stateRef: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

DistrictSchema.index(
  { slug: 1, stateRef: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

DistrictSchema.index(
  { normalizedName: 1, stateRef: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

DistrictSchema.index(
  { primaryAdminRef: 1 },
  {
    unique: true,
    partialFilterExpression: {
      primaryAdminRef: { $ne: null },
      isDeleted: false,
    },
  }
);

//////////////////////////////////////////////////////////////
// ⚡ PERFORMANCE INDEXES
//////////////////////////////////////////////////////////////

DistrictSchema.index({
  countryRef: 1,
  stateRef: 1,
  launchStatus: 1,
  onboardingEnabled: 1,
  isActive: 1,
  isDeleted: 1,
});

DistrictSchema.index({
  stateRef: 1,
  operationalLoadScore: -1,
  isActive: 1,
  isDeleted: 1,
});

DistrictSchema.index({
  stateRef: 1,
  priority: -1,
  isActive: 1,
});

DistrictSchema.index({
  stateRef: 1,
  isActive: 1,
  isDeleted: 1,
});


//////////////////////////////////////////////////////////////
// 🔍 SEARCH INDEXES (ADVANCED)
//////////////////////////////////////////////////////////////


// 🔥 TEXT SEARCH WITH WEIGHTS
DistrictSchema.index(
  {
    name: "text",
    aliases: "text",
    },
    {
      weights: {
        name: 5,
        aliases: 2,
      },
    }
  );

// 🔥 ADD THIS (COMPOUND INDEX)
DistrictSchema.index({
  stateRef: 1,
  normalizedName: 1,
});

//////////////////////////////////////////////////////////////
// 🌍 GEO INDEX
//////////////////////////////////////////////////////////////

DistrictSchema.index({ geo: "2dsphere" });

//////////////////////////////////////////////////////////////
// ⭐ ADMIN PANEL INDEX
//////////////////////////////////////////////////////////////

DistrictSchema.index({
  primaryAdminRef: 1,
  isActive: 1,
  isDeleted: 1,
});

//////////////////////////////////////////////////////////////
// 🚀 EXPORT
//////////////////////////////////////////////////////////////

export default mongoose.models.District ||
  mongoose.model("District", DistrictSchema);