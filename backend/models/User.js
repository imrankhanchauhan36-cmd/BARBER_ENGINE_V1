import mongoose from "mongoose";

/////////////////////////////////////////////////////
// USER SCHEMA — FINAL ENTERPRISE SAFE
/////////////////////////////////////////////////////

const UserSchema = new mongoose.Schema(
  {
    /////////////////////////////////////////////////
    // BASIC INFO
    /////////////////////////////////////////////////

    name: {
      type: String,
      required: true,
      trim: true,
    },

    /////////////////////////////////////////////////
    // 🔐 IDENTITY
    /////////////////////////////////////////////////

    phone: {
      type: String,
      trim: true,
      default: null,
      match: /^[6-9]\d{9}$/, // ✅ FIXED (India format)
    },

    email: {
      type: String,
      lowercase: true,
      trim: true,
      default: null,
      match: /^\S+@\S+\.\S+$/, // ✅ FIXED
    },

    /////////////////////////////////////////////////
    // 🔒 AUTH FIELDS
    /////////////////////////////////////////////////

    password: {
      type: String,
      select: false,
    },

    loginAttempts: {
      type: Number,
      default: 0,
      select: false,
    },

    lockUntil: {
      type: Date,
      default: null,
      select: false,
    },

    tokenVersion: {
      type: Number,
      default: 0,
      select: false,
    },

    otpCode: {
      type: String,
      select: false,
    },

    otpExpiresAt: {
      type: Date,
      select: false,
    },

    /////////////////////////////////////////////////
    // ROLE SYSTEM
    /////////////////////////////////////////////////

    role: {
      type: String,
      enum: ["USER", "OWNER", "BARBER", "ADMIN", "FIELD_STAFF"],
      default: "USER",
      required: true,
      // ❌ removed index (duplicate issue fix)
    },

    /////////////////////////////////////////////////
    // ADMIN HIERARCHY
    /////////////////////////////////////////////////

    adminLevel: {
      type: String,
      enum: ["INDIA", "STATE", "DISTRICT"],
      default: null,
      // ❌ removed index
    },

    adminSubRole: {
      type: String,
      enum: ["PRIMARY", "SUPPORT"],
      default: null,
    },

    /////////////////////////////////////////////////
    // GEO REFERENCES
    /////////////////////////////////////////////////

    countryRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Country",
      default: null,
      required: false,
    },

    stateRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "State",
      default: null,
      // ❌ removed index
    },

    districtRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "District",
      default: null,
      // ❌ removed index
    },

    cityRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "City",
      default: null,
    },

    /////////////////////////////////////////////////
    // ADMIN SECURITY
    /////////////////////////////////////////////////

    permissions: {
      type: [String],
      default: [],
    },

    mustChangePassword: {
      type: Boolean,
      default: false,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },

    // 🔥 NEW FIELD (ADMIN LOAD BALANCING)
    lastAssignedAt: {
      type: Date,
      default: null,
      index: true,
    },

    isEmailVerified: {
      type: Boolean,
      default: false,
    },

    isPhoneVerified: {
      type: Boolean,
      default: false,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    /////////////////////////////////////////////////
    // ACCOUNT CONTROL
    /////////////////////////////////////////////////

    accountStatus: {
      type: String,
      enum: ["ACTIVE", "SUSPENDED", "BLOCKED"],
      default: "ACTIVE",
      index: true,
    },

    status: {
      type: String,
      enum: ["ACTIVE", "SUSPENDED", "BLOCKED"],
      default: "ACTIVE",
    },

    /////////////////////////////////////////////////
    // STATUS AUDIT
    /////////////////////////////////////////////////

    statusUpdatedBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "User",
      default: null,
    },
  
    statusUpdatedAt: {
      type:    Date,
      default: null,
    },
  
    statusUpdateReason: {
      type:      String,
      default:   null,
      maxlength: 300,
    },
    

    /////////////////////////////////////////////////
    // 👤 PROFILE
    /////////////////////////////////////////////////

    profilePhoto: {
      type:    String,
      default: null,
    },

    /////////////////////////////////////////////////
    // 💰 WALLET
    /////////////////////////////////////////////////

    walletBalance: {
      type:    Number,
      default: 0,
      min:     0,
    },

    /////////////////////////////////////////////////
    // 🎁 REWARD POINTS
    /////////////////////////////////////////////////

    rewardPoints: {
      type:    Number,
      default: 0,
      min:     0,
    },

    /////////////////////////////////////////////////
    // SYSTEM FLAGS
    /////////////////////////////////////////////////

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
      select: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    strict: true,
  }
);

/////////////////////////////////////////////////////
// 🔐 VALIDATION LOGIC (FINAL)
/////////////////////////////////////////////////////

UserSchema.pre("validate", function (next) {

  //////////////////////////////////////////////////
  // EMAIL REQUIRED FOR ADMIN (CRITICAL FIX ✅)
  //////////////////////////////////////////////////

  if (this.role === "ADMIN" && !this.email) {
    return next(new Error("Email required for admin"));
  }

  //////////////////////////////////////////////////
  // PHONE REQUIRED FOR NON-ADMIN
  //////////////////////////////////////////////////

  if (this.role !== "ADMIN" && !this.phone) {
    return next(new Error("Phone required for this role"));
  }

  //////////////////////////////////////////////////
  // NON-ADMIN CLEANUP
  //////////////////////////////////////////////////

  if (this.role !== "ADMIN") {
    this.adminLevel = null;
    this.adminSubRole = null;
    this.countryRef = null;
    return next();
  }

  //////////////////////////////////////////////////
  // ADMIN VALIDATION
  //////////////////////////////////////////////////

  if (!this.adminLevel)
    return next(new Error("adminLevel required"));

  if (!this.countryRef || !mongoose.Types.ObjectId.isValid(this.countryRef)) {
    return next(new Error("Valid countryRef required"));
  }

  // INDIA ADMIN
  if (this.adminLevel === "INDIA") {
    this.stateRef = null;
    this.districtRef = null;
    this.adminSubRole = null;
    return next();
  }

  // STATE ADMIN
  if (this.adminLevel === "STATE") {
    if (!this.stateRef)
      return next(new Error("stateRef required"));

    this.districtRef = null;
    if (!this.adminSubRole)
      return next(new Error("adminSubRole required"));


    return next();
  }


  // DISTRICT ADMIN
  if (this.adminLevel === "DISTRICT") {
    if (!this.stateRef || !this.districtRef)
      return next(new Error("stateRef and districtRef required"));

    if (!this.adminSubRole)
      return next(new Error("adminSubRole required"));

    return next();
  }

  return next();
});

/////////////////////////////////////////////////////
// 🔐 SECURITY (PRO LEVEL FIX ✅)
/////////////////////////////////////////////////////

UserSchema.set("toJSON", {
  transform: function (doc, ret) {
    delete ret.password;
    delete ret.otpCode;
    delete ret.loginAttempts;
    delete ret.lockUntil;
    delete ret.tokenVersion;
    return ret;
  },
});

/////////////////////////////////////////////////////
// ⭐ INDEXES (CLEAN + NO DUPLICATE)
/////////////////////////////////////////////////////

// Unique phone
UserSchema.index(
  { phone: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: {
      isDeleted: false,
      phone: { $type: "string" },
    },
  }
);

// Unique email
UserSchema.index(
  { email: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: {
      isDeleted: false,
      email: { $type: "string" },
    },
  }
);

// ONE INDIA ADMIN
UserSchema.index(
  { role: 1, adminLevel: 1 },
  {
    unique: true,
    partialFilterExpression: {
      role: "ADMIN",
      adminLevel: "INDIA",
      isDeleted: false,
    },
  }
);

// ONE PRIMARY STATE ADMIN (SUPPORT/backup admins are NOT limited to
// one — same rule DISTRICT already uses below)
UserSchema.index(
  { stateRef: 1, adminSubRole: 1 },
  {
    unique: true,
    partialFilterExpression: {
      role: "ADMIN",
      adminLevel: "STATE",
      isDeleted: false,
    },
  }
);


// ONE PRIMARY DISTRICT ADMIN
UserSchema.index(
  { districtRef: 1, adminSubRole: 1 },
  {
    unique: true,
    partialFilterExpression: {
      role: "ADMIN",
      adminLevel: "DISTRICT",
      adminSubRole: "PRIMARY",
      isDeleted: false,
    },
  }
);

//////////////////////////////////////////////////////////////
// 🚀 ADMIN ASSIGN OPTIMIZATION INDEXES
//////////////////////////////////////////////////////////////

// 🔥 District-level admin lookup
UserSchema.index({
  role: 1,
  adminLevel: 1, // ✅ FIXED
  districtRef: 1,
  lastAssignedAt: 1,
});

// 🔥 State-level admin lookup
UserSchema.index({
  role: 1,
  adminLevel: 1,
  stateRef: 1,
  lastAssignedAt: 1,
});

/////////////////////////////////////////////////////
// EXPORT
/////////////////////////////////////////////////////

export default mongoose.models.User ||
  mongoose.model("User", UserSchema);