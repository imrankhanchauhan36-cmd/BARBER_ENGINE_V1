import mongoose from "mongoose";

//////////////////////////////////////////////////////////////
// 🇮🇳 DISTRICT SCHEMA — LOCKED (ENTERPRISE++) — 10/10 FINAL
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

    normalizedName: {
      type: String,
      required: true,
      lowercase: true,
    },

    // Manual BUSINESS code (e.g. "LKO", "AGR") — admin-entered at
    // creation, state-scoped, NOT auto-generated. Distinct from
    // adminCode below (external geo-mapping identifier).
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      minlength: 2,
      maxlength: 20,
    },

    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      immutable: true,
    },

    // Capital / HQ display name — matches State.js's `capital` field
    // exactly. Free-text, admin-entered, shown on District Detail
    // "Basic Information". This is the single source of truth for
    // the district's HQ display name (hqCityName removed — redundant
    // with this field; use hqCityRef below once an actual City
    // document needs to be linked).
    capital: {
      type: String,
      trim: true,
      default: null,
    },

    // Actual relational link to a City document, once one exists for
    // this district's HQ. Optional — a district can have a `capital`
    // display name before any City record is created for it.
    hqCityRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "City",
      default: null,
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
    // 🌐 EXTERNAL GEO-MAPPING IDENTIFIERS
    // These three fields exist to sync/dedupe against external geo
    // data providers (GeoNames, government ADM2 divisions, future
    // Google Maps/MapMyIndia/OSM imports) — per the Location
    // Architecture rule that business logic must never depend
    // directly on any one provider. They are NOT business codes
    // (see `code` above, which IS the business/display code).
    //////////////////////////////////////////////////////////

    geoNameCode: {
      type: String,
      default: null,
      index: true,
    },

    // Government ADM2 division code (GeoNames convention).
    admin2Code: {
      type: String,
      default: null,
      index: true,
    },

    // Composite/derived external admin identifier used by geo-import
    // scripts (see scripts/addAdmin2CodeToDistricts.js). Globally
    // unique by design — this tracks an external, country-wide
    // government coding system, not a state-scoped business code.
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

    // Operational rollout stage — DISTINCT responsibility from
    // isActive below. launchStatus = "where is this district in its
    // go-live lifecycle". isActive = "is this record currently a
    // live/valid record at all" (soft on/off switch, independent of
    // rollout stage — e.g. a LIVE district can still be temporarily
    // deactivated without changing its launch stage).
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

    // Manual territory override — same convention as State.js. When
    // set, takes precedence over the computed OPEN/PARTIAL/CLOSED
    // value in the controller. Null = auto-compute from coverage %.
    manualTerritoryOverride: {
      type: String,
      enum: ["OPEN", "PARTIAL", "CLOSED", null],
      default: null,
    },

      // Reason shown when manualTerritoryOverride === "CLOSED" (e.g. "Admin
      // Transfer", "Regulatory Hold"). Null/ignored for OPEN/PARTIAL/null
      // override values — only meaningful alongside a manual CLOSED override.
      closedReason: {
        type: String,
        trim: true,
        default: null,
        maxlength: 200,
      },

    //////////////////////////////////////////////////////////
    // 4️⃣ METRICS
    // Denormalized counters — updated by background jobs/hooks only.
    // Never trusted as source of truth for admin-facing reads; the
    // controller still does live aggregation for anything shown on
    // District Detail/Dashboard. These exist for fast internal
    // routing/load-balancing decisions (e.g. onboarding throttling),
    // not for display.
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
    // 5️⃣ CAPACITY / TARGETS
    //////////////////////////////////////////////////////////

    maxSalonCapacity: {
      type: Number,
      default: 1000,
      min: 1,
    },

    // Expansion targets — same as State.js. Used for coverage % and
    // health score calculation (District Edit "Targets" tab, and
    // District Dashboard health gauge).
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

    pincodesCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastOperationalReviewAt: {
      type: Date,
      default: null,
    },

    //////////////////////////////////////////////////////////
    // 6️⃣ ADMIN
    // One District = One District Admin. No backup/support admin
    // concept at district level (unlike State, which explicitly
    // supports a SUPPORT sub-role). supportAdminCount REMOVED — it
    // contradicted this locked rule and had no defined purpose.
    //////////////////////////////////////////////////////////

    primaryAdminRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    //////////////////////////////////////////////////////////
    // ⭐ GEO (optional — does not block district creation)
    //////////////////////////////////////////////////////////

    geo: {
      type: new mongoose.Schema(
        {
          type: {
            type: String,
            enum: ["Point"],
          },
          coordinates: {
            type: [Number],
            validate: {
              validator: function (val) {
                if (!val) return true; // absent = not yet pinned, allowed
                if (val.length !== 2) return false;
                const [lng, lat] = val;
                return (
                  typeof lng === "number" &&
                  typeof lat === "number" &&
                  lng >= -180 && lng <= 180 &&
                  lat >= -90  && lat <= 90
                );
              },
              message: "Invalid geo coordinates",
            },
          },
        },
        { _id: false }
      ),
      required: false,
    },
    notes: {
      type: String,
      trim: true,
      default: null,
      maxlength: 1000,
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

    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

//////////////////////////////////////////////////////////////
// 🔥 AUTO NORMALIZATION + SLUG + ALIASES (dedupe fixed)
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
    // FIX: dedupe after normalization. Previously "Lucknow",
    // "LUCKNOW", "lucknow" as three separate aliases would produce
    // three identical normalizedAliases entries — now collapsed to one.
    const normalized = this.aliases.map((a) =>
      a.toLowerCase().replace(/[^a-z0-9]/g, "")
    );
    this.normalizedAliases = [...new Set(normalized)];
  } else {
    this.normalizedAliases = [];
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
// 🔍 SEARCH INDEXES
//////////////////////////////////////////////////////////////

DistrictSchema.index(
  { name: "text", aliases: "text" },
  { weights: { name: 5, aliases: 2 } }
);

DistrictSchema.index({ stateRef: 1, normalizedName: 1 });

//////////////////////////////////////////////////////////////
// 🌍 GEO INDEX (sparse — geo is optional)
//////////////////////////////////////////////////////////////

DistrictSchema.index({ geo: "2dsphere" }, { sparse: true });

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