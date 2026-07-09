import mongoose from "mongoose";

//////////////////////////////////////////////////////
// DEVELOPER NOTES — READ BEFORE TOUCHING THIS FILE
//////////////////////////////////////////////////////
//
// FROZEN: v2 — 9.8/10 — DO NOT MODIFY WITHOUT REVIEW
//
// NOTE 1 — BRAND/FRANCHISE SUPPORT (Future)
//   brandName + branchCode abhi basic hai.
//   Future me jab Naturals / Jawed Habib / Looks jaisi
//   chains onboard hongi, ek alag "Brand" collection
//   banana hoga. Tab ownerId → brandId link karega.
//   Abhi brandName/branchCode string hi rakho.
//
// NOTE 2 — GALLERY LIMIT
//   Schema me gallery unlimited hai.
//   API level pe max 30 images ka validation lagana.
//   Controller me check karo: gallery.length <= 30
//
// NOTE 3 — SEARCH TAGS (Auto Generate)
//   searchTags owner manually enter na kare.
//   Pre-save hook ya controller me auto-generate karo:
//   shopName + specializations + city + tier se.
//   Isse spam/wrong tags ka risk nahi hoga.
//   Example: ["the glam house", "BRIDAL", "bengaluru", "PREMIUM"]
//
// NOTE 4 — isFeatured
//   Admin panel se set hoga.
//   Home Explore section: "Featured Salons" me use hoga.
//   Future: isPremiumPartner, isSponsored bhi add ho sakta.
//
// NOTE 5 — averageRating
//   Virtual hai — DB me persist mat karna kabhi bhi.
//   rating.count + rating.total se calculate hota hai.
//
//////////////////////////////////////////////////////

const TimeRangeSchema = new mongoose.Schema(
  {
    start: { type: String, required: true, match: /^([01]\d|2[0-3]):([0-5]\d)$/ },
    end:   { type: String, required: true, match: /^([01]\d|2[0-3]):([0-5]\d)$/ },
  },
  { _id: false }
);

const DayScheduleSchema = new mongoose.Schema(
  {
    open:     { type: String, match: /^([01]\d|2[0-3]):([0-5]\d)$/ },
    close:    { type: String, match: /^([01]\d|2[0-3]):([0-5]\d)$/ },
    isClosed: { type: Boolean, default: false },
    breaks:   { type: [TimeRangeSchema], default: [] },
  },
  { _id: false }
);

DayScheduleSchema.pre("validate", function (next) {
  if (!this.isClosed) {
    if (!this.open || !this.close) return next(new Error("Open and close time required"));
    if (this.open >= this.close)   return next(new Error("Open time must be before close time"));
    for (const b of this.breaks) {
      if (b.start >= b.end)                          return next(new Error("Invalid break time"));
      if (b.start < this.open || b.end > this.close) return next(new Error("Break must be within working hours"));
    }
  }
  next();
});

const SalonSchema = new mongoose.Schema(
  {
    // 1. OWNER — Multi Salon Support
    // NOTE: 1 owner → multiple salons allowed
    // Future: Add ownerRef → Brand collection link
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // 2. BASIC INFO
    basicInfo: {
      shopName: { type: String, required: true, trim: true, maxlength: 120 },

      // Salon Type — used for Home Tab filtering
      // MEN_ONLY   → Men tab
      // WOMEN_ONLY → Women tab
      // UNISEX     → Both tabs
      category: {
        type: String,
        enum: ["MEN_ONLY", "WOMEN_ONLY", "UNISEX"],
        required: true,
      },

      tagline:    { type: String, default: null, trim: true, maxlength: 200 },
      since:      { type: Number, default: null, min: 1950, max: new Date().getFullYear() },
      experience: { type: String, default: null, enum: ["LESS_THAN_1", "1_TO_3", "3_TO_5", "5_PLUS", "10_PLUS", null] },
      whatsapp:   { type: String, default: null, trim: true, maxlength: 15 },
      phone:    { type: String, default: null, trim: true, maxlength: 15 },


      // Tier — used for Premium/Luxury filters + ranking
      tier: {
        type: String,
        enum: ["STANDARD", "PREMIUM", "LUXURY"],
        default: "STANDARD",
        index: true,
      },

      setupType:    { type: String, enum: ["PROPER_SHOP", "OPEN_SETUP"], default: "PROPER_SHOP" },
      privacySetup: { type: String, enum: ["SEPARATE", "MIXED"],         default: "MIXED" },

      amenities: {
        hasAC:       { type: Boolean, default: false },
        hasParking:  { type: Boolean, default: false },
        hasWifi:     { type: Boolean, default: false },
        waitingArea: { type: Boolean, default: false },
        restroom:    { type: Boolean, default: false },
      },

      // Brand/Franchise — Future: link to Brand collection
      // See NOTE 1 above
      brandName:  { type: String, default: null, trim: true, maxlength: 100 },
      branchCode: { type: String, default: null, trim: true, maxlength: 30  },
    },

    // 3. SPECIALIZATIONS
    // Used for: Collections, Recommendations, Search, Filters
    specializations: {
      type: [{ type: String, enum: ["BRIDAL", "GROOMING", "LUXURY", "NAIL_STUDIO", "MAKEUP_STUDIO", "SKIN_CLINIC", "BARBER_SHOP"] }],
      default: [],
    },

    // 4. CAPABILITIES
    // HOME_SERVICE: future → Bridal/Makeup at Home
    capabilities: {
      type: [{ type: String, enum: ["HOME_SERVICE"] }],
      default: [],
    },

    // 5. MEDIA
    // API level: gallery max 30 images — See NOTE 2
    media: {
      logo: {
        url:      { type: String, default: null },
        publicId: { type: String, default: null },
      },
      coverImage: {
        url:      { type: String, default: null },
        publicId: { type: String, default: null },
      },
      gallery: {
        type: [{
          url:      { type: String, required: true },
          publicId: { type: String, default: null },
          caption:  { type: String, default: null },
        }],
        default: [],
      },
    },

    // 6. SEARCH TAGS
    // Auto-generate from: shopName + specializations + city + tier
    // See NOTE 3 — never let owner manually enter
    searchTags: {
      type: [String],
      default: [],
    },

    // 7. FEATURED
    // Admin sets this — used in Home Explore section
    // Future: isPremiumPartner, isSponsored — See NOTE 4
    isFeatured: {
      type: Boolean,
      default: false,
      index: true,
    },

    // 8. LOCATION
    location: {
      address: { type: String, default: null, maxlength: 300 },
      geo: {
        type:        { type: String, enum: ["Point"], default: null },
        coordinates: {
          type: [Number], default: null,
          validate: {
            validator: function (val) {
              if (!val) return true;
              return val.length === 2 && val[0] >= -180 && val[0] <= 180 && val[1] >= -90 && val[1] <= 90;
            },
          },
        },
      },
      territory: {
        countryRef:  { type: mongoose.Schema.Types.ObjectId, ref: "Country",  default: null },
        stateRef:    { type: mongoose.Schema.Types.ObjectId, ref: "State",    default: null },
        districtRef: { type: mongoose.Schema.Types.ObjectId, ref: "District", default: null },
        assemblyRef: { type: mongoose.Schema.Types.ObjectId, ref: "Assembly", default: null },
        cityRef:     { type: mongoose.Schema.Types.ObjectId, ref: "City",     default: null, index: true },
        areaRef:     { type: mongoose.Schema.Types.ObjectId, ref: "Area",     default: null },
      },
    },

    // 9. MANAGER
    manager: {
      name:  { type: String, default: null, trim: true },
      phone: { type: String, default: null, match: /^[6-9]\d{9}$/, sparse: true, index: true },
    },

    // 10. STAFF
    staff: {
      count: { type: Number, default: 0, min: 0 },
      genderSupport: {
        male:   { type: Boolean, default: false },
        female: { type: Boolean, default: false },
      },
    },

    // 11. TIMINGS
    timings: {
      monday:    { type: DayScheduleSchema, default: () => ({}) },
      tuesday:   { type: DayScheduleSchema, default: () => ({}) },
      wednesday: { type: DayScheduleSchema, default: () => ({}) },
      thursday:  { type: DayScheduleSchema, default: () => ({}) },
      friday:    { type: DayScheduleSchema, default: () => ({}) },
      saturday:  { type: DayScheduleSchema, default: () => ({}) },
      sunday:    { type: DayScheduleSchema, default: () => ({}) },
    },

    // 12. BUSINESS
    business: {
      commissionRate: {
        type:    Number,
        default: null,
        min:     0,
        max:     50,
      },

      isShopOpen: {
        type:    Boolean,
        default: false,
      },
    
      isForceClosed: {
        type:    Boolean,
        default: false,
        index:   true,
      },
    
      isSuspended: {
        type:    Boolean,
        default: false,
        index: true,
      },
    
      suspendedReason: {
        type:      String,
        default:   null,
        maxlength: 300,
      },
    
      suspendedAt: {
        type:    Date,
        default: null,
      },
    },
  

    // 13. APPROVAL
    approval: {
      status: {
        type: String,
        enum: ["DRAFT", "PENDING", "APPROVED", "REJECTED"],
        default: "DRAFT",
        index: true,
      },
      approvedBy:      { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      approvedAt:      { type: Date, default: null },
      rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      rejectedAt: { type: Date, default: null },
      rejectionReason: { type: String, default: null, maxlength: 300 },
    },

    // 14. ONBOARDING
    onboarding: {
      step:      { type: Number, default: 1, min: 1, max: 10, index: true },
      completed: { type: Boolean, default: false },
    },

    // 15. ADMIN ASSIGNMENT
    assignedAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    // 16. RATING
    // averageRating is VIRTUAL — never persist — See NOTE 5
    rating: {
      count: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },

    // 17. CHAIR COUNT — stored during onboarding for analytics
    chairCount: { type: Number, default: 0, min: 0 },

    // 18. SOFT DELETE
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

// VIRTUAL — See NOTE 5
SalonSchema.virtual("averageRating").get(function () {
  if (!this.rating.count) return 0;
  return Number((this.rating.total / this.rating.count).toFixed(1));
});

// INDEXES
SalonSchema.index({ ownerId: 1 },                        { background: true });
SalonSchema.index({ ownerId: 1, "approval.status": 1 }, { background: true });
SalonSchema.index(
  { "location.geo": "2dsphere" },
  { partialFilterExpression: { "location.geo.type": "Point", "location.geo.coordinates": { $exists: true } } }
);
SalonSchema.index({ "location.territory.cityRef": 1,     "approval.status": 1 });
SalonSchema.index({ "location.territory.districtRef": 1, "approval.status": 1, "business.isForceClosed": 1 });
SalonSchema.index({ "location.territory.stateRef": 1,    "approval.status": 1 });
SalonSchema.index({ "location.territory.assemblyRef": 1 }, { sparse: true });
SalonSchema.index({ "location.territory.areaRef": 1 });
SalonSchema.index({ specializations: 1 });
SalonSchema.index({ capabilities: 1 });
SalonSchema.index({ "basicInfo.tier": 1,     "approval.status": 1 });
SalonSchema.index({ "basicInfo.category": 1, "approval.status": 1 });
SalonSchema.index({ searchTags: 1 });
SalonSchema.index({ isFeatured: 1, "approval.status": 1 });

export default mongoose.models.Salon || mongoose.model("Salon", SalonSchema);