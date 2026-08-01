import mongoose from "mongoose";

//////////////////////////////////////////////////////////////
// 🔥 BOOKING STATUS ENUM
//////////////////////////////////////////////////////////////

export const BOOKING_STATUS = {
  HOLD:       "HOLD",        // Temporary slot lock — awaiting payment
  CONFIRMED:  "CONFIRMED",   // Payment received — OTP generated
  CHECKED_IN: "CHECKED_IN",  // Customer arrived — OTP verified
  ONGOING:    "ONGOING",     // Service in progress — timer running
  COMPLETED:  "COMPLETED",   // Service finished — wallet credited
  CANCELLED:  "CANCELLED",   // User or salon cancelled before service
  NO_SHOW:    "NO_SHOW",     // Customer did not arrive — chair freed
  EXPIRED:    "EXPIRED",     // HOLD timed out without payment — chair freed

  // ── EXTENSION GUIDE ─────────────────────────────────────
  // Add new statuses here AND update:
  //   1. bookingState.machine.js  — transition rules
  //   2. booking.controller.js    — any new HTTP handlers
  //   3. holdExpiry.job.js        — if new status needs automation
  //   4. socket.js                — if new status emits realtime events
  //
  // Reserved for future phases (DO NOT add until needed):
  //   LATE         — customer arrived after window (needs policy)
  //   OVERDUE      — service running past endTime (needs timer logic)
  //   RESCHEDULED  — moved to another slot (needs reschedule flow)
  //   REFUNDED     — payment reversed (needs Razorpay webhook)
  // ────────────────────────────────────────────────────────
};

//////////////////////////////////////////////////////////////
// 🔥 SCHEMA
//////////////////////////////////////////////////////////////

const BookingSchema = new mongoose.Schema(
  {
    //////////////////////////////////////////////////////////
    // 👤 USER
    //////////////////////////////////////////////////////////
    userRef: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "User",
      required: true,
      index:    true,
    },

    //////////////////////////////////////////////////////////
    // 🏪 SALON
    //////////////////////////////////////////////////////////
    salonRef: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "Salon",
      required: true,
      index:    true,
    },

    //////////////////////////////////////////////////////////
    // 🪑 CHAIR
    //////////////////////////////////////////////////////////
    chairRef: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "Chair",
      required: true,
      index:    true,
    },

    //////////////////////////////////////////////////////////
    // 💇 SERVICES
    //////////////////////////////////////////////////////////
    serviceRefs: [
      {
        type:     mongoose.Schema.Types.ObjectId,
        ref:      "Service",
        required: true,
      },
    ],

    //////////////////////////////////////////////////////////
    // ⏱ TIMING
    //////////////////////////////////////////////////////////

    bookingDate: {
      type:     String,   // "YYYY-MM-DD" — used for date-only queries
      required: true,
      index:    true,
    },

    startTime: {
      type:     Date,
      required: true,
      index:    true,
    },

    endTime: {
      type:     Date,
      required: true,
      index:    true,
    },

    serviceDuration: {
      type:     Number, // minutes
      required: true,
    },

    bufferTime: {
      type:    Number, // minutes
      default: 0,
    },

    //////////////////////////////////////////////////////////
    // 🔒 LOCK SYSTEM
    //
    // lockUntil     → slot visibility lock (UI countdown timer)
    // holdExpiresAt → payment timeout (background job expires HOLD)
    //
    // Kept separate so slot UI lock and payment window can have
    // different durations without affecting each other.
    //////////////////////////////////////////////////////////

    lockUntil: {
      type:    Date,
      default: null,
      index:   true,
    },

    // 🔥 HOLD AUTO EXPIRY
    // Set to (now + HOLD_EXPIRY_DURATION) when HOLD is created.
    // The holdExpiry.job.js worker queries on this field every 30s
    // to find and expire stale HOLDs — even if the user closes the app.
    holdExpiresAt: {
      type:    Date,
      default: null,
      index:   true,
    },

    //////////////////////////////////////////////////////////
    // 📊 STATUS
    //////////////////////////////////////////////////////////
    status: {
      type:    String,
      enum:    Object.values(BOOKING_STATUS),
      default: BOOKING_STATUS.HOLD,
      index:   true,
    },

    //////////////////////////////////////////////////////////
    // 💳 PAYMENT
    //
    // totalAmountInPaise  → authoritative amount used by finance engine
    // amount              → legacy / display field (rupees, optional)
    // paymentStatus       → tracks payment gateway state
    //////////////////////////////////////////////////////////
    paymentStatus: {
      type:    String,
      enum:    ["PENDING", "PAID", "FAILED", "REFUNDED"],
      default: "PENDING",
      index:   true,
    },

    // 🔥 FINANCE FIELD — used by confirmBooking + completeService
    // Stored in paise (₹1 = 100 paise) to avoid floating-point errors.
    // Controller reads booking.totalAmountInPaise for all calculations.
    // MUST be a non-negative integer — decimals (e.g. 100.5 paise) are
    // invalid finance state and rejected at the schema level.
    totalAmountInPaise: {
      type:     Number,
      default:  0,
      min:      [0, "Amount cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message:   "totalAmountInPaise must be a whole number (paise, not rupees)",
      },
    },

    // Breakdown of totalAmountInPaise — needed because commission
    // is now charged ON TOP of the service price (not deducted from
    // it): totalAmountInPaise = serviceAmountInPaise + commissionAmountInPaise.
    // The full serviceAmountInPaise goes to the salon on confirm;
    // the full commissionAmountInPaise stays with the platform.
    // Stored per-booking (rather than re-deriving from the current
    // commission rate at cancel time) so a later rate change never
    // alters the split for bookings made under the old rate.
    serviceAmountInPaise: {
      type:     Number,
      default:  0,
      min:      [0, "Amount cannot be negative"],
      validate: {
          validator: Number.isInteger,
        message:   "serviceAmountInPaise must be a whole number (paise, not rupees)",
      },
    },
    commissionAmountInPaise: {
      type:     Number,
      default:  0,
      min:      [0, "Amount cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message:   "commissionAmountInPaise must be a whole number (paise, not rupees)",
      },
    },

    // ⚠️  DISPLAY ONLY — NEVER use this for finance logic.
    // All authoritative calculations (commission, payout, wallet)
    // MUST use totalAmountInPaise above.
    // This field exists only for human-readable display (e.g. ₹500).
    amount: {
      type:    Number,
      default: 0,
    },

    currency: {
      type:    String,
      default: "INR",
    },

    //////////////////////////////////////////////////////////
    // 🔐 CHECK-IN OTP
    //
    // Stored as String — contains an HMAC-SHA256 hex digest.
    // Controller generates a 4-digit numeric OTP, hashes it
    // with hashOtp() before storing:
    //   checkInOtp = HMAC_SHA256(OTP_SECRET, rawOtp) → hex string
    //
    // The raw OTP is returned to the user once via the API
    // response and never stored. On check-in, the incoming
    // raw OTP is hashed again and compared against this field.
    //
    // Both fields are set to null after a successful check-in
    // (see checkInBooking in booking.controller.js) so they
    // don't linger on completed documents.
    //
    // checkInOtpExpiresAt enables future OTP expiry queries:
    //   { checkInOtp: { $exists: true }, checkInOtpExpiresAt: { $lt: now } }
    // A sparse index (defined below in INDEXES) keeps this fast
    // without indexing the majority of docs where OTP is null.
    //////////////////////////////////////////////////////////
    checkInOtp: {
      type: String,   // HMAC-SHA256 hex hash — never the raw 4-digit OTP
    },

    checkInOtpExpiresAt: {
      type: Date,
    },

    // Encrypted raw OTP — AES-256 encrypted, decryptable by server
    // Used for user-facing booking history OTP display
    checkInOtpEncrypted: {
      type:    String,
      default: null,
    },

    //////////////////////////////////////////////////////////
    // ⏱ OPERATIONAL TIMESTAMPS
    // One timestamp per lifecycle state — used by analytics,
    // audit trails, SLA monitoring, and the realtime engine.
    //////////////////////////////////////////////////////////

    checkedInAt: {
      type:    Date,
      default: null,
    },

    serviceStartedAt: {
      type:    Date,
      default: null,
    },

    completedAt: {
      type:    Date,
      default: null,
    },

    cancelledAt: {
      type:    Date,
      default: null,
    },

    expiredAt: {
      type:    Date,
      default: null,
    },

    noShowMarkedAt: {
      type:    Date,
      default: null,
    },

    //////////////////////////////////////////////////////////
    // 🚗 CUSTOMER ARRIVAL ENGINE
    //
    // These 4 fields power the grace period system that lets
    // salon owners make human decisions about late customers
    // rather than relying on rigid automatic NO_SHOW logic.
    //
    // Flow:
    //   CONFIRMED → startTime passes → arrivalGraceUntil window
    //   → customer still not CHECKED_IN → customerDelayedAt set
    //   → salon owner: WAIT (+10 min) | RELEASE (→ NO_SHOW)
    //////////////////////////////////////////////////////////

    // Absolute deadline for customer to arrive.
    // Set to (startTime + maxArrivalWaitMinutes) when booking
    // is CONFIRMED. Queried by customerArrival.job.js every minute.
    arrivalGraceUntil: {
      type:    Date,
      default: null,
      index:   true,        // ← job queries this field every 60s
    },

    // Timestamp when the customer was first flagged as delayed.
    // Null until arrivalGraceUntil passes without a CHECKED_IN.
    // Used for analytics (average delay, peak late-arrival times)
    // and for the salon dashboard "delayed" badge.
    customerDelayedAt: {
      type:    Date,
      default: null,
    },

    // How many times the salon owner extended the grace window.
    // Capped at MAX_GRACE_EXTENSIONS (defined in the controller)
    // to prevent infinite chair-blocking abuse — e.g. cap at 2
    // extensions so max total wait = 15 + 10 + 10 = 35 minutes.
    // Controller MUST enforce: if graceExtensionsUsed >= MAX, reject.
    graceExtensionsUsed: {
      type:    Number,
      default: 0,
      min:     0,
    },

    // Per-booking wait window (minutes). Default 15.
    //
    // MIGRATION NOTE: when Salon.settings is introduced in a
    // future phase, the lockSlot() controller should read the
    // salon's configured default and write it here at booking
    // creation time. Storing it per-booking (rather than always
    // reading from Salon.settings at runtime) means historical
    // bookings always reflect the policy that was active when
    // they were created — no retroactive policy changes.
    maxArrivalWaitMinutes: {
      type:    Number,
      default: 15,
      min:     0,
    },

    //////////////////////////////////////////////////////////
    // ⭐ RATING
    //////////////////////////////////////////////////////////
    rating: {
      type: Number,
      min:  1,
      max:  5,
    },

    //////////////////////////////////////////////////////////
    // 📊 CANCELLATION META
    //////////////////////////////////////////////////////////
    cancelledBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "User",
      default: null,
    },

    cancelReason: {
      type:      String,
      maxlength: 300,
    },

    // Set by cancelBooking (booking.controller.js) — one of
    // "NO_PAYMENT" | "FULL_REFUND" | "HALF_REFUND" | "NO_REFUND".
    // Previously written by the controller but silently dropped
    // (not declared in schema) — added here as additive-only.
    cancellationPolicy: {
      type:    String,
      default: null,
    },

    // Set by cancelBooking (booking.controller.js) — refund amount
    // in paise. Previously written but silently dropped.
    refundAmountInPaise: {
      type:    Number,
      default: null,
    },

    //////////////////////////////////////////////////////////
    // 🧾 AUDIT TRAIL
    // Every status transition is appended here automatically
    // by the pre-save hook below. Immutable event log.
    //////////////////////////////////////////////////////////
    statusHistory: [
      {
        status: {
          type: String,
          enum: Object.values(BOOKING_STATUS),
        },

        changedAt: {
          type:    Date,
          default: Date.now,
        },

        // null for SYSTEM-triggered transitions (cron jobs, expiry worker)
        changedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref:  "User",
        },

        // Freeform extra audit context (e.g. admin cancel reason,
        // performedByRole, source, ip — see adminBooking.controller.js).
        // Previously written but silently dropped (not declared in
        // schema) — added here as additive-only. Not every push sets it.
        meta: {
          type: mongoose.Schema.Types.Mixed,
        },
      },
    ],

    //////////////////////////////////////////////////////////
    // 🔍 LAST STATUS TRANSITION META
    //////////////////////////////////////////////////////////
    statusChangedAt: {
      type:    Date,
      default: null,
    },

    statusChangedBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "User",
      default: null,
    },

    // Set by forceComplete (booking.controller.js) when an operator
    // manually completes a booking outside the normal service-start
    // flow. Previously written but silently dropped (not declared
    // in schema) — added here as additive-only.
    forceCompleted: {
      type:    Boolean,
      default: false,
    },

    //////////////////////////////////////////////////////////
    // 🗑 SOFT DELETE
    //////////////////////////////////////////////////////////
    isDeleted: {
      type:    Boolean,
      default: false,
      index:   true,
    },

    //////////////////////////////////////////////////////////
    // 📊 SOURCE TRACKING
    //////////////////////////////////////////////////////////
    source: {
      type:    String,
      enum:    ["APP", "WEB", "ADMIN", "SYSTEM"],
      default: "APP",
    },
  },
  {
    timestamps: true,   // createdAt, updatedAt
    versionKey: false,
  }
);

//////////////////////////////////////////////////////////////
// 🚀 INDEXES
//
// RULE: indexes here must match exactly the query patterns
// used in booking.controller.js and holdExpiry.job.js.
// Unused indexes waste write performance — every index listed
// below has a direct corresponding query in the codebase.
//////////////////////////////////////////////////////////////

// ── Salon dashboard queries ────────────────────────────────
BookingSchema.index({ salonRef: 1, startTime: 1, endTime: 1 });

// ── Chair overlap queries (conflict detection) ────────────
BookingSchema.index({ chairRef: 1, startTime: 1, endTime: 1 });

// ── HARD CONFLICT PROTECTION (query optimisation) ─────────
// Covers the $and overlap + status $in query in lockSlot()
// and confirmBooking(). Partial filter restricts index size
// to only active bookings.
BookingSchema.index(
  { chairRef: 1, startTime: 1, endTime: 1, status: 1 },
  {
    partialFilterExpression: {
      status: {
        $in: [
          BOOKING_STATUS.HOLD,
          BOOKING_STATUS.CONFIRMED,
          BOOKING_STATUS.CHECKED_IN,
          BOOKING_STATUS.ONGOING,
        ],
      },
    },
  }
);

// ── RACE CONDITION SAFETY NET — unique constraint ──────────
// This is the final hard guarantee that no two active bookings
// can occupy the same chair at the same startTime.
// Layer 1 (application): lockSlot session transaction
// Layer 2 (database):    this unique partial index
// If two requests slip through Layer 1 at the exact same ms,
// MongoDB's unique constraint catches it and returns code 11000,
// which lockSlot() handles as a clean 409 response.
BookingSchema.index(
  { chairRef: 1, startTime: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: {
      status: {
        $in: [
          BOOKING_STATUS.HOLD,
          BOOKING_STATUS.CONFIRMED,
          BOOKING_STATUS.CHECKED_IN,
          BOOKING_STATUS.ONGOING,
        ],
      },
    },
  }
);

// ── HOLD EXPIRY — used by holdExpiry.job.js every 30s ─────
// Queries: { status: "HOLD", holdExpiresAt: { $lt: now } }
// Partial filter limits the index to HOLD-only documents —
// keeps it tiny even with millions of completed bookings.
BookingSchema.index(
  { status: 1, holdExpiresAt: 1 },
  {
    partialFilterExpression: {
      status: BOOKING_STATUS.HOLD,
    },
  }
);

// ── Payment queries ────────────────────────────────────────
BookingSchema.index({ paymentStatus: 1, createdAt: -1 });

// ── Soft delete queries ────────────────────────────────────
BookingSchema.index({ isDeleted: 1, createdAt: -1 });

// ── User booking history ───────────────────────────────────
BookingSchema.index({ userRef: 1, createdAt: -1 });

// ── User upcoming bookings ─────────────────────────────────
BookingSchema.index({ userRef: 1, status: 1, startTime: 1 });

// ── Rating queries (sparse — most bookings have no rating) ─
BookingSchema.index(
  { salonRef: 1, rating: 1 },
  { sparse: true }
);

// ── OTP expiry queries (sparse — only CONFIRMED bookings have OTP) ─
// Used by future OTP cleanup worker:
//   { checkInOtp: { $exists: true }, checkInOtpExpiresAt: { $lt: now } }
// Sparse keeps index tiny — null OTP fields are excluded.
BookingSchema.index(
  { checkInOtpExpiresAt: 1 },
  { sparse: true }
);

// ── CUSTOMER ARRIVAL ENGINE — used by customerArrival.job.js ──
// Exact query the worker runs every 60s:
//   { status: CONFIRMED, arrivalGraceUntil: { $lt: now }, customerDelayedAt: null }
//
// customerDelayedAt added to the index so MongoDB can satisfy
// the full query from the index alone (covered query) without
// fetching the document. At current scale the difference is
// negligible — included now so the index is migration-safe
// when booking volume grows.
//
// Partial filter restricts to CONFIRMED-only — keeps the index
// tiny since most bookings are COMPLETED/CANCELLED/EXPIRED.
BookingSchema.index(
  { status: 1, arrivalGraceUntil: 1, customerDelayedAt: 1 },
  {
    sparse: true,
    partialFilterExpression: {
      status: BOOKING_STATUS.CONFIRMED,
    },
  }
);

//////////////////////////////////////////////////////////////
// 🔥 PRE-SAVE: AUTO STATUS HISTORY TRACKING
//
// Fires on every save() where status changed.
// Appends an immutable entry to statusHistory[].
// changedBy is null for SYSTEM-triggered transitions.
//////////////////////////////////////////////////////////////

BookingSchema.pre("save", function (next) {
  if (this.isModified("status")) {
    this.statusHistory.push({
      status:    this.status,
      changedAt: new Date(),
      changedBy: this.statusChangedBy || null,
    });
  }
  next();
});

//////////////////////////////////////////////////////////////
// 🚀 EXPORT
//////////////////////////////////////////////////////////////

export default mongoose.models.Booking ||
  mongoose.model("Booking", BookingSchema);