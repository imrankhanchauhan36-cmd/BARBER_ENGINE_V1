import mongoose from "mongoose";

//////////////////////////////////////////////////////
// DEVELOPER NOTES — READ BEFORE TOUCHING THIS FILE
//////////////////////////////////////////////////////
//
// FROZEN: v4 — CHAIR MODEL FINAL LOCK ✅ 10/10
//
// NOTE 1 — chairCode
//   Format: <salonId>-CHR-001
//   Scoped to salon — no global conflict
//   NOT globally unique — partial index on isDeleted:false
//
// NOTE 2 — photo
//   Future: Manage Chairs screen in Owner App
//
// NOTE 3 — type REMOVED
//   Was: NORMAL/VIP/PREMIUM — not useful for booking
//
// NOTE 4 — name
//   trim only — saves as "Chair 1", "Hair Spa Station"
//
// NOTE 5 — Partial Unique Indexes
//   All unique indexes use partialFilterExpression: { isDeleted: false }
//   This allows soft-delete + re-insert without conflicts
//
// NOTE 6 — onboarding
//   Owner sends: { chairCount: 3 }
//   Backend auto creates: Chair 1, Chair 2, Chair 3
//
// NOTE 7 — priority + totalBookingsToday + disabledUntil
//   Slot engine uses these — DO NOT REMOVE
//
//////////////////////////////////////////////////////

const ChairSchema = new mongoose.Schema(
  {
    //////////////////////////////////////////////////////////
    // SALON
    //////////////////////////////////////////////////////////
    salonId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "Salon",
      required: true,
      index:    true,
    },

    //////////////////////////////////////////////////////////
    // CHAIR CODE — salonId scoped, NOT globally unique
    // Format: <salonId>-CHR-001
    // See NOTE 1 + NOTE 5
    //////////////////////////////////////////////////////////
    chairCode: {
      type:    String,
      default: null,
    },

    //////////////////////////////////////////////////////////
    // NAME — trim only, NO lowercase
    // See NOTE 4
    //////////////////////////////////////////////////////////
    name: {
      type:      String,
      required:  true,
      trim:      true,
      maxlength: 50,
    },

    //////////////////////////////////////////////////////////
    // POSITION
    //////////////////////////////////////////////////////////
    position: {
      type:     Number,
      required: true,
      min:      1,
    },

    //////////////////////////////////////////////////////////
    // PHOTO — See NOTE 2
    //////////////////////////////////////////////////////////
    photo: {
      url:      { type: String, default: null },
      publicId: { type: String, default: null },
    },

    //////////////////////////////////////////////////////////
    // BARBER ASSIGNMENT
    //////////////////////////////////////////////////////////
    barberId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "User",
      default: null,
      index:   true,
    },

    //////////////////////////////////////////////////////////
    // SKILLS (SERVICE MAPPING)
    //////////////////////////////////////////////////////////
    skills: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref:  "Service",
      },
    ],

    //////////////////////////////////////////////////////////
    // STATUS
    //////////////////////////////////////////////////////////
    isActive: {
      type:    Boolean,
      default: true,
      index:   true,
    },

    //////////////////////////////////////////////////////////
    // SOFT DELETE
    //////////////////////////////////////////////////////////
    isDeleted: {
      type:    Boolean,
      default: false,
      index:   true,
    },

    //////////////////////////////////////////////////////////
    // TEMP DISABLE — See NOTE 7
    //////////////////////////////////////////////////////////
    disabledUntil: {
      type:    Date,
      default: null,
      index:   true,
    },

    //////////////////////////////////////////////////////////
    // LOAD TRACKING — See NOTE 7
    //////////////////////////////////////////////////////////
    totalBookingsToday: {
      type:    Number,
      default: 0,
      index:   true,
    },

    //////////////////////////////////////////////////////////
    // PRIORITY — See NOTE 7
    //////////////////////////////////////////////////////////
    priority: {
      type:    Number,
      default: 1,
      index:   true,
    },

    //////////////////////////////////////////////////////////
    // AUDIT
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
// INDEXES — All unique indexes use partial filter
// See NOTE 5 — allows soft delete + re-insert safely
//////////////////////////////////////////////////////////////

// Unique name per salon — active chairs only
ChairSchema.index(
  { salonId: 1, name: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
  }
);

// Unique position per salon — active chairs only
ChairSchema.index(
  { salonId: 1, position: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
  }
);

// Unique chairCode per salon — active chairs only
ChairSchema.index(
  { salonId: 1, chairCode: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { isDeleted: false },
  }
);

// Fast fetch
ChairSchema.index({ salonId: 1, isActive: 1 });

// Slot engine optimization
ChairSchema.index({ salonId: 1, isActive: 1, disabledUntil: 1 });

// Skill-based filtering
ChairSchema.index({ salonId: 1, skills: 1 });

// Load balancing
ChairSchema.index({ salonId: 1, totalBookingsToday: 1, priority: -1 });

//////////////////////////////////////////////////////////////
// HELPER: AVAILABILITY CHECK
//////////////////////////////////////////////////////////////
ChairSchema.methods.isAvailableNow = function (now = new Date()) {
  if (!this.isActive)  return false;
  if (this.isDeleted)  return false;
  if (this.disabledUntil && this.disabledUntil > now) return false;
  return true;
};

//////////////////////////////////////////////////////////////
// EXPORT
//////////////////////////////////////////////////////////////
export default mongoose.models.Chair || mongoose.model("Chair", ChairSchema);