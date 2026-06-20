import mongoose from "mongoose";

//////////////////////////////////////////////////////
// DEVELOPER NOTES — READ BEFORE TOUCHING THIS FILE
//////////////////////////////////////////////////////
//
// FROZEN: v2 — SERVICE MODEL FINAL LOCK ✅
//
// NOTE 1 — CATEGORY
//   Uppercase enums — match with frontend exactly.
//   Future me new category add karna ho to:
//   enum array me add karo + frontend dropdown update karo.
//   OLD: ["haircut","beard","facial","spa","color","other"]
//   NEW: See category field below — 21 categories.
//
// NOTE 2 — applicableFor (CRITICAL)
//   Home Screen MEN/WOMEN tab isi field se chalegi.
//   MEN    → beard, haircut (men), massage, etc.
//   WOMEN  → bridal, nail_art, pre_bridal, etc.
//   BOTH   → facial, haircut, hair_spa, etc.
//   NEVER remove this field.
//
// NOTE 3 — searchTags
//   Auto-generate from: name + category + applicableFor
//   Owner manually enter na kare — spam risk.
//   Controller me pre-save se generate karo.
//   Example: ["keratin", "hair smoothening", "anti frizz"]
//
// NOTE 4 — isFeatured
//   Admin sets this — Trending + Explore section me use hoga.
//   Future: isSponsored, isPremium bhi add ho sakta.
//
// NOTE 5 — thumbnailImage
//   Single image for Home/Search cards.
//   images[] gallery alag hai — detail page ke liye.
//   thumbnailImage = first image of gallery by default (API logic).
//
// NOTE 6 — buffer system
//   buffer + bufferMin + bufferMax — slot engine reads ye fields.
//   DO NOT REMOVE OR RENAME — booking engine depends on these.
//
// NOTE 7 — serviceTier (Future)
//   STANDARD / PREMIUM / LUXURY
//   Abhi optional hai — future me add kar sakte ho.
//   Luxury filter me kaam aayega.
//
//////////////////////////////////////////////////////

const ServiceSchema = new mongoose.Schema(
  {
    //////////////////////////////////////////////////////////
    // SALON RELATION
    //////////////////////////////////////////////////////////
    salonId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "Salon",
      required: true,
      index:    true,
    },

    //////////////////////////////////////////////////////////
    // SERVICE NAME (NORMALIZED)
    //////////////////////////////////////////////////////////
    name: {
      type:      String,
      required:  true,
      trim:      true,
      lowercase: true,
      maxlength: 100,
      set:       (v) => v.trim().toLowerCase(),
    },

    //////////////////////////////////////////////////////////
    // CATEGORY — EXPANDED v2 ✅
    // OLD: ["haircut","beard","facial","spa","color","other"]
    // NEW: 21 marketplace-grade categories
    // See NOTE 1
    //////////////////////////////////////////////////////////
    category: {
      type:    String,
      enum: [
        "HAIRCUT",
        "BEARD",
        "HAIR_COLOR",
        "HAIR_SPA",
        "FACIAL",
        "CLEANUP",
        "MAKEUP",
        "BRIDAL",
        "PRE_BRIDAL",
        "NAIL_ART",
        "MANICURE",
        "PEDICURE",
        "WAXING",
        "THREADING",
        "MASSAGE",
        "SKIN_TREATMENT",
        "HAIR_TREATMENT",
        "KERATIN",
        "SMOOTHENING",
        "REBONDING",
        "OTHER",
      ],
      default: "OTHER",
      index:   true,
    },

    //////////////////////////////////////////////////////////
    // APPLICABLE FOR — NEW ✅
    // CRITICAL: Home Screen MEN/WOMEN tab filtering
    // See NOTE 2
    //////////////////////////////////////////////////////////
    applicableFor: {
      type:    String,
      enum:    ["MEN", "WOMEN", "BOTH"],
      default: "BOTH",
      index:   true,
    },

    //////////////////////////////////////////////////////////
    // PRICE
    //////////////////////////////////////////////////////////
    price: {
      type:     Number,
      required: true,
      min:      1,
      set:      (v) => Math.round(v),
    },

    //////////////////////////////////////////////////////////
    // DURATION (MINUTES)
    // READ BY: slot engine, booking controller, timeline engine
    // DO NOT REMOVE OR RENAME — See NOTE 6
    //////////////////////////////////////////////////////////
    duration: {
      type:     Number,
      required: true,
      min:      5,
      max:      300,
    },

    //////////////////////////////////////////////////////////
    // BUFFER SYSTEM
    // READ BY: slot engine overlap check, generateSlotsFromGap()
    // DO NOT REMOVE OR RENAME — See NOTE 6
    //////////////////////////////////////////////////////////
    buffer: {
      type:    Number,
      default: 5,
      min:     0,
      max:     60,
    },

    bufferMin: {
      type:    Number,
      default: 5,
      min:     0,
      max:     60,
    },

    bufferMax: {
      type:    Number,
      default: 15,
      min:     0,
      max:     120,
    },

    //////////////////////////////////////////////////////////
    // THUMBNAIL IMAGE — NEW ✅
    // Single image for Home/Search/Trending cards
    // See NOTE 5 — gallery (images[]) is separate
    //////////////////////////////////////////////////////////
    thumbnailImage: {
      type:    String,
      default: null,
    },

    //////////////////////////////////////////////////////////
    // SEARCH TAGS — NEW ✅
    // Auto-generate from name + category + applicableFor
    // See NOTE 3 — never let owner manually enter
    //////////////////////////////////////////////////////////
    searchTags: {
      type:    [String],
      default: [],
    },

    //////////////////////////////////////////////////////////
    // FEATURED — NEW ✅
    // Admin sets — Trending + Explore section
    // See NOTE 4
    //////////////////////////////////////////////////////////
    isFeatured: {
      type:    Boolean,
      default: false,
      index:   true,
    },

    //////////////////////////////////////////////////////////
    // BOOKING COUNT
    // Discovery + Ranking + Top Services
    //////////////////////////////////////////////////////////
    bookingCount: {
      type: Number,
      default: 0,
      min: 0,
      index: true,
    },

    //////////////////////////////////////////////////////////
    // STATUS FLAGS
    // READ BY: booking controller, slot engine, service listing
    // DO NOT REMOVE OR RENAME
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

    //////////////////////////////////////////////////////////
    // AUDIT
    //////////////////////////////////////////////////////////
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "User",
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "User",
    },

    //==========================================================
    // SERVICE EXPERIENCE LAYER
    // DISPLAY + TRUST layer only.
    // NEVER read by booking/slot/timeline/payment engine.
    // All fields optional — owners fill gradually.
    //==========================================================

    // Short description on service card
    description: {
      type:      String,
      trim:      true,
      maxlength: 500,
      default:   "",
    },

    // Gallery images — detail page horizontal scroll
    // API level: max 8 images
    images: {
      type:    [String],
      default: [],
    },

    // Short intro video URL — autoplay muted on detail page
    introVideo: {
      type:    String,
      default: null,
    },

    // Benefit pills — Example: ["Anti-Frizz", "Shine Boost"]
    benefits: {
      type:    [String],
      default: [],
    },

    // Hair/skin type tags — Example: ["Dry Hair", "Curly Hair"]
    suitableFor: {
      type:    [String],
      default: [],
    },

    // Brands used — trust builder — Example: ["L'Oréal", "Wella"]
    brandsUsed: {
      type:    [String],
      default: [],
    },

    // Service steps — numbered list on detail page
    steps: {
      type:    [String],
      default: [],
    },

    // Result duration text — Example: "Results last 10-15 days"
    resultsDurationText: {
      type:      String,
      trim:      true,
      maxlength: 200,
      default:   "",
    },

    // Before/After images — strongest conversion driver
    beforeAfterImages: {
      type: [
        {
          before: { type: String, required: true },
          after:  { type: String, required: true },
          _id:    false,
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

//////////////////////////////////////////////////////////////
// INDEXES
//////////////////////////////////////////////////////////////

// Unique service name per salon (active only)
ServiceSchema.index(
  { salonId: 1, name: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

// Fast listing
ServiceSchema.index({ salonId: 1, isActive: 1 });

// Sorted listing
ServiceSchema.index({ salonId: 1, createdAt: -1 });

// Slot engine query
ServiceSchema.index({ salonId: 1, isActive: 1, duration: 1 });

// Soft-delete aware
ServiceSchema.index({ salonId: 1, isActive: 1, isDeleted: 1 });

// Home tab filtering — MEN/WOMEN tabs
ServiceSchema.index({ salonId: 1, applicableFor: 1, isActive: 1 });

// Category filtering
ServiceSchema.index({ category: 1, applicableFor: 1, isActive: 1 });

// Search tags
ServiceSchema.index({ searchTags: 1 });

// Featured services
ServiceSchema.index({ isFeatured: 1, isActive: 1 });

//////////////////////////////////////////////////////////////
// VALIDATIONS
//////////////////////////////////////////////////////////////

ServiceSchema.pre("save", function (next) {
  if (this.bufferMin > this.bufferMax) {
    return next(new Error("bufferMin cannot be greater than bufferMax"));
  }
  next();
});

ServiceSchema.pre("findOneAndUpdate", function (next) {
  const update = this.getUpdate();
  const bufferMin = update.bufferMin ?? update.$set?.bufferMin;
  const bufferMax = update.bufferMax ?? update.$set?.bufferMax;
  if (bufferMin !== undefined && bufferMax !== undefined && bufferMin > bufferMax) {
    return next(new Error("bufferMin cannot be greater than bufferMax"));
  }
  next();
});

//////////////////////////////////////////////////////////////
// EXPORT
//////////////////////////////////////////////////////////////

export default mongoose.models.Service || mongoose.model("Service", ServiceSchema);