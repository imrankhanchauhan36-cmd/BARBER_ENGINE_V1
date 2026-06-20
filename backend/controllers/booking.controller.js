import crypto from "crypto";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Salon from "../models/Salon.js";
import SalonEarnings from "../models/SalonEarnings.js";
import Service from "../models/Service.js";
import Transaction, {
  TRANSACTION_STATUS,
  TRANSACTION_TYPE,
} from "../models/Transaction.js";
import { getSmartSlots } from "../services/slotEngine.service.js";
import {
  BOOKING_STATUS,
  transitionBookingStatus,
  validateBookingTransition,
} from "../utils/bookingState.machine.js";
import { isSalonReadyForBooking } from "../utils/salonReady.guard.js";

//////////////////////////////////////////////////////////////
// 🔥 CONFIG
//////////////////////////////////////////////////////////////

const LOCK_DURATION           = 2 * 60 * 1000; // 2 minutes
const RAZORPAY_KEY_SECRET     = process.env.RAZORPAY_KEY_SECRET;
const MIN_PAYMENT_ID_LENGTH   = 10;
// OTP_SECRET: hard-fails in production if missing — a fallback secret in prod
// means every deployment with a missing env var silently uses the same known
// string, making all OTP hashes precomputable by anyone who reads this file.
// Dev/test environments get the fallback so local runs work without .env setup.
if (process.env.NODE_ENV === "production" && !process.env.OTP_SECRET) {
  throw new Error(
    "OTP_SECRET environment variable is required in production. " +
    "Set it to a random 32+ character string."
  );
}
const OTP_SECRET = process.env.OTP_SECRET || "otp-fallback-secret-change-in-prod";

// AES-256 encryption for OTP — allows user to see OTP in booking history
const OTP_ENCRYPT_KEY = process.env.OTP_ENCRYPT_KEY || "barber-engine-otp-key-32-chars!!"; // 32 chars
const encryptOtp = (otp) => {
  const iv     = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(OTP_ENCRYPT_KEY), iv);
  const encrypted = Buffer.concat([cipher.update(String(otp)), cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
};

const decryptOtp = (encrypted) => {
  const [ivHex, encHex] = encrypted.split(":");
  const iv      = Buffer.from(ivHex, "hex");
  const enc     = Buffer.from(encHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(OTP_ENCRYPT_KEY), iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString();
};


//////////////////////////////////////////////////////////////
// 🧠 HELPERS
//////////////////////////////////////////////////////////////

/** Returns true if two Date values are within 60 seconds of each other */
const isSameTime = (a, b) => Math.abs(a.getTime() - b.getTime()) < 60_000;

/** Safe pagination — page capped at 1000, limit capped at 50 */
const getPagination = (query) => {
  const page  = Math.min(Math.max(parseInt(query.page)  || 1, 1), 1000);
  const limit = Math.min(           parseInt(query.limit) || 10,   50);
  const skip  = (page - 1) * limit;
  return { page, limit, skip };
};

/** Shared populate config for user-facing booking queries */
const USER_BOOKING_POPULATE = [
  { path: "salonRef",    select: "basicInfo.shopName basicInfo.phone location.address location.geo" },
  { path: "serviceRefs", select: "name price duration", match: { isDeleted: false } },
];


/**
 * 🔐 OTP HASHING
 *
 * Check-in OTPs are hashed with HMAC-SHA256 before storage so a
 * database leak does not expose valid OTPs (4-digit codes are
 * trivially brute-forced if stored in plaintext).
 *
 * hashOtp(otp)       → hex string stored in booking.checkInOtp
 * verifyOtp(raw, stored) → boolean — use instead of === comparison
 *
 * Uses HMAC (not plain SHA) so the secret is required to reproduce
 * the hash — protects against offline rainbow-table attacks.
 */
const hashOtp = (otp) =>
  crypto
    .createHmac("sha256", OTP_SECRET)
    .update(String(otp))
    .digest("hex");

const verifyOtp = (rawOtp, storedHash) =>
  storedHash === hashOtp(rawOtp);

/**
 * 🔐 RAZORPAY SIGNATURE VERIFICATION
 *
 * Razorpay HMAC-SHA256 signature format:
 *   signature = HMAC_SHA256(razorpay_order_id + "|" + razorpay_payment_id, secret)
 *
 * Call BEFORE confirming any booking or recording any transaction.
 * Throws with { status } attached so the catch block can return the right HTTP code.
 */
const verifyRazorpaySignature = ({ orderId, paymentId, signature }) => {
  // ── DEV / TEST BYPASS ──────────────────────────────────────────────────────
  // When NODE_ENV is not "production", skip Razorpay verification entirely.
  // This lets you test the full booking lifecycle locally with fake paymentIds
  // without needing real Razorpay credentials.
  //
  // In production this block is never entered — real signature is verified.
  //
  // Your .env.development:
  //   NODE_ENV=development        ← bypass active
  //
  // Your .env.production:
  //   NODE_ENV=production         ← bypass skipped, real verification runs
  //   RAZORPAY_KEY_SECRET=rzp_live_xxxxx
  // ──────────────────────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      "[Razorpay] Signature verification SKIPPED — development mode. " +
      "Never disable this in production."
    );
    return; // bypass — no further checks
  }

  // ── PRODUCTION: full verification ─────────────────────────────────────────

  if (!RAZORPAY_KEY_SECRET) {
    throw Object.assign(
      new Error("Payment gateway not configured on server"),
      { status: 500 }
    );
  }

  if (!orderId || !paymentId || !signature) {
    throw Object.assign(
      new Error("orderId, paymentId, and razorpaySignature are all required"),
      { status: 400 }
    );
  }

  const expectedSignature = crypto
    .createHmac("sha256", RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  // Constant-time comparison prevents timing attacks.
  // Wrapped in try/catch — Buffer.from(hex) throws on malformed input.
  let isValid = false;
  try {
    isValid = crypto.timingSafeEqual(
      Buffer.from(expectedSignature, "hex"),
      Buffer.from(signature,         "hex")
    );
  } catch {
    // Malformed signature string — treat as invalid, never crash the request
    isValid = false;
  }

  if (!isValid) {
    throw Object.assign(
      new Error("Payment verification failed — invalid signature"),
      { status: 403 }
    );
  }
};

/**
 * 📡 EMIT SOCKET.IO EVENT
 *
 * Emits a booking lifecycle event to all relevant rooms:
 *   - salon:{salonId}  — owner dashboard / chair grid
 *   - user:{userId}    — customer app
 *
 * Requires req.app.get("io") to be set in server.js:
 *   app.set("io", io);
 *
 * Non-blocking — a socket failure never breaks the HTTP response.
 */
const emitBookingEvent = (req, { event, salonId, userId, payload }) => {
  try {
    const io = req.app.get("io");
    if (!io) return;

    if (salonId) io.to(`salon:${salonId}`).emit(event, payload);
    if (userId)  io.to(`user:${userId}`) .emit(event, payload);
  } catch (socketError) {
    console.warn(`Socket emit failed [${event}]:`, socketError.message);
  }
};

/**
 * 🔐 ASSERT SALON OWNERSHIP
 *
 * Reusable ownership guard for all salon-only operations:
 *   startService(), completeService(), markNoShow(),
 *   extendArrivalGrace(), releaseChairForNoShow() (future).
 *
 * Single atomic query — matches BOTH the booking's salon AND the
 * caller as its owner. Eliminates the TOCTOU gap present in a
 * two-step (find by owner → compare _id) approach.
 *
 * Throws with { status: 403 } if the caller is not the owner.
 * Must be called inside a try/catch that aborts the session on error.
 *
 * @param {ObjectId} salonRef  - booking.salonRef
 * @param {ObjectId} userId    - req.user._id
 * @param {object}   [session] - mongoose session (optional)
 */
const assertSalonOwnership = async (salonRef, userId, session = null) => {
  const query = Salon.findOne({
    _id:     salonRef,
    ownerId: userId,
  }).select("_id").lean();

  if (session) query.session(session);

  const salon = await query;

  if (!salon) {
    throw Object.assign(
      new Error("Unauthorized — only the salon owner can perform this action"),
      { status: 403 }
    );
  }
};

//////////////////////////////////////////////////////////////
// 🚀 1. LOCK SLOT (HOLD BOOKING)
//////////////////////////////////////////////////////////////

export const lockSlot = async (req, res) => {
  try {
    const {
      salonId,
      date,
      serviceDuration,
      bufferTime = 0,
      requestedTime,
      serviceRefs,
    } = req.body;

    const userId  = req.user._id;
    const reqTime = new Date(requestedTime);

    //////////////////////////////////////////////////////////
    // 🛑 PREVENT MULTIPLE ACTIVE HOLDS
    //////////////////////////////////////////////////////////

    const existingHold = await Booking.findOne({
      userRef:   userId,
      status:    BOOKING_STATUS.HOLD,
      lockUntil: { $gt: new Date() },
    });

    if (existingHold) {
      return res.status(400).json({
        success: false,
        message: "You already have an active booking hold",
      });
    }

    //////////////////////////////////////////////////////////
    // 🏪 SALON READINESS CHECK
    //////////////////////////////////////////////////////////

    const readiness = await isSalonReadyForBooking(salonId);
    if (!readiness.ready) {
      return res.status(403).json({
        success: false,
        message: "Salon is not ready for bookings",
        reason:  readiness.reason,
      });
    }

    //////////////////////////////////////////////////////////
    // 📊 FETCH AVAILABLE SLOTS
    //////////////////////////////////////////////////////////

    const dateStr = typeof date === 'string' ? date : new Date(date).toISOString().split('T')[0];
    const slots = await getSmartSlots({ salonId, date: dateStr, serviceDuration, bufferTime });

    const matchedSlot = slots.find((s) => isSameTime(s.start, reqTime));

    if (!matchedSlot) {
      return res.status(400).json({
        success: false,
        message: "Requested slot is not available",
      });
    }

    //////////////////////////////////////////////////////////
    // 🚫 HARD CONFLICT CHECK + 🔒 CREATE HOLD — ATOMIC SESSION
    //
    // Race condition without session:
    //   Two users hit lockSlot() simultaneously for the same slot.
    //   Both pass findOne() conflict check (neither HOLD exists yet),
    //   both call Booking.create() — double HOLD created.
    //
    // Fix:
    //   Wrap conflict check AND create inside one mongoose session.
    //   The session gives a consistent read snapshot so the second
    //   concurrent request sees the first HOLD and 409s correctly.
    //   A unique sparse compound index on (chairRef + startTime)
    //   acts as the final hard safety net if two slip through at the
    //   exact same millisecond (duplicate key → caught as 11000).
    //////////////////////////////////////////////////////////

    const lockSession = await mongoose.startSession();
    lockSession.startTransaction();

    let booking;

    try {
      const conflictingBooking = await Booking.findOne({
        chairRef: matchedSlot.chairId,
        $and: [
          {
            $or: [
              {
                status: {
                  $in: [
                    BOOKING_STATUS.CONFIRMED,
                    BOOKING_STATUS.CHECKED_IN,
                    BOOKING_STATUS.ONGOING,
                  ],
                },
              },
              {
                status:    BOOKING_STATUS.HOLD,
                lockUntil: { $gt: new Date() },
              },
            ],
          },
          {
            // Buffer-aware overlap check.
            //
            // A booking is considered occupied until (endTime + bufferTime).
            // Two bookings conflict when:
            //   existing.effectiveOccupiedUntil > incoming.start
            //   AND existing.start < incoming.effectiveOccupiedUntil
            //
            // The $lt side uses the incoming slot's effective end so a new
            // booking starting before an existing one's cleanup finishes
            // is correctly blocked.
            startTime: {
              $lt: new Date(
                matchedSlot.end.getTime() +
                bufferTime * 60 * 1000
              ),
            },
            // $expr computes the existing booking's effectiveOccupiedUntil
            // at query time — no extra field needed on the schema.
            $expr: {
              $gt: [
                {
                  $add: [
                    "$endTime",
                    { $multiply: ["$bufferTime", 60 * 1000] },
                  ],
                },
                matchedSlot.start,
              ],
            },
          },
        ],
      }).session(lockSession);

      if (conflictingBooking) {
        await lockSession.abortTransaction();
        lockSession.endSession();
        return res.status(409).json({
          success: false,
          message: "Slot already taken. Please try another time.",
        });
      }

      //////////////////////////////////////////////////////////
      // 🔒 CREATE HOLD BOOKING (inside session)
      //////////////////////////////////////////////////////////

      const lockUntil     = new Date(Date.now() + LOCK_DURATION);
      const holdExpiresAt = new Date(Date.now() + LOCK_DURATION);
      const bookingDate   = matchedSlot.start.toISOString().split("T")[0];

      //////////////////////////////////////////////////////////
      // 💰 CALCULATE TOTAL AMOUNT FROM SERVICE PRICES
      // Fetch selected services, sum their prices, convert to
      // paise (₹1 = 100 paise) to avoid floating-point errors.
      // This sets totalAmountInPaise which is required by
      // confirmBooking() for finance calculations.
      //////////////////////////////////////////////////////////

      const selectedServices = await Service
        .find({ _id: { $in: serviceRefs } })
        .select("price")
        .lean()
        .session(lockSession);

      const totalAmountInPaise = selectedServices.reduce(
        (sum, s) => sum + Math.round(s.price * 100),
        0
      );

      [booking] = await Booking.create(
        [
          {
            userRef:            userId,
            salonRef:           salonId,
            chairRef:           matchedSlot.chairId,
            serviceRefs,
            bookingDate,
            startTime:          matchedSlot.start,
            endTime:            matchedSlot.end,
            serviceDuration,
            bufferTime,
            lockUntil,
            holdExpiresAt,
            totalAmountInPaise,
            status:             BOOKING_STATUS.HOLD,
          },
        ],
        { session: lockSession }
      );

      await lockSession.commitTransaction();
      lockSession.endSession();

    } catch (lockError) {
      await lockSession.abortTransaction();
      lockSession.endSession();

      // Duplicate key = two concurrent requests hit at the exact same ms —
      // the unique sparse index caught what the session check missed.
      if (lockError.code === 11000) {
        return res.status(409).json({
          success: false,
          message: "Slot just taken by another user. Please try another time.",
        });
      }

      throw lockError; // unexpected — re-throw so outer catch returns 500
    }

    const { lockUntil } = booking;

    //////////////////////////////////////////////////////////
    // 📡 REALTIME — notify salon chair grid of new hold
    //////////////////////////////////////////////////////////

    emitBookingEvent(req, {
      event:   "booking:hold",
      salonId: salonId.toString(),
      userId:  userId.toString(),
      payload: {
        bookingId: booking._id,
        chairId:   matchedSlot.chairId,
        startTime: matchedSlot.start,
        endTime:   matchedSlot.end,
        lockUntil,
        status:    BOOKING_STATUS.HOLD,
      },
    });

    return res.status(200).json({
      success:   true,
      bookingId: booking._id,
      lockUntil,
    });

  } catch (error) {
    console.error("lockSlot error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to lock slot",
    });
  }
};

//////////////////////////////////////////////////////////////
// 🚀 2. CONFIRM BOOKING — FULLY ATOMIC + RAZORPAY VERIFIED
//////////////////////////////////////////////////////////////

export const confirmBooking = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      bookingId,
      paymentId,         // razorpay_payment_id
      orderId,           // razorpay_order_id
      razorpaySignature, // razorpay_signature
    } = req.body;

    //////////////////////////////////////////////////////////
    // 💳 PAYMENT ID FORMAT GUARD
    //////////////////////////////////////////////////////////

    if (!paymentId || paymentId.length < MIN_PAYMENT_ID_LENGTH) {
      throw Object.assign(
        new Error("Invalid payment ID — must be at least 10 characters"),
        { status: 400 }
      );
    }

    //////////////////////////////////////////////////////////
    // 🔐 RAZORPAY SIGNATURE VERIFICATION (server-side)
    //////////////////////////////////////////////////////////

    verifyRazorpaySignature({ orderId, paymentId, signature: razorpaySignature });

    //////////////////////////////////////////////////////////
    // 🔍 FETCH BOOKING (inside session)
    //////////////////////////////////////////////////////////

    const booking = await Booking.findById(bookingId).session(session);

    if (!booking) {
      throw Object.assign(new Error("Booking not found"), { status: 404 });
    }

    //////////////////////////////////////////////////////////
    // 🔐 USER OWNERSHIP CHECK
    //////////////////////////////////////////////////////////

    if (booking.userRef.toString() !== req.user._id.toString()) {
      throw Object.assign(new Error("Unauthorized"), { status: 403 });
    }

    //////////////////////////////////////////////////////////
    // 🔁 STATE MACHINE VALIDATION
    //////////////////////////////////////////////////////////

    if (!validateBookingTransition(booking.status, BOOKING_STATUS.CONFIRMED)) {
      throw Object.assign(new Error("Invalid booking state transition"), { status: 400 });
    }

    //////////////////////////////////////////////////////////
    // ⌛ HOLD EXPIRY CHECK
    //////////////////////////////////////////////////////////

    if (!booking.lockUntil || booking.lockUntil < new Date()) {
      await transitionBookingStatus({ booking, nextStatus: BOOKING_STATUS.EXPIRED, session });
      throw Object.assign(new Error("Booking hold has expired"), { status: 400 });
    }

    //////////////////////////////////////////////////////////
    // 🚫 DOUBLE-BOOKING OVERLAP CHECK
    //////////////////////////////////////////////////////////

    const conflicting = await Booking.findOne({
      _id:      { $ne: booking._id },
      chairRef: booking.chairRef,
      $and: [
        {
          $or: [
            {
              status: {
                $in: [
                  BOOKING_STATUS.CONFIRMED,
                  BOOKING_STATUS.CHECKED_IN,
                  BOOKING_STATUS.ONGOING,
                ],
              },
            },
            {
              status:    BOOKING_STATUS.HOLD,
              lockUntil: { $gt: new Date() },
            },
          ],
        },
        {
          // Buffer-aware overlap — same logic as lockSlot().
          // booking.endTime + booking.bufferTime = effective occupied until.
          startTime: {
            $lt: new Date(
              booking.endTime.getTime() +
              booking.bufferTime * 60 * 1000
            ),
          },
          $expr: {
            $gt: [
              {
                $add: [
                  "$endTime",
                  { $multiply: ["$bufferTime", 60 * 1000] },
                ],
              },
              booking.startTime,
            ],
          },
        },
      ],
    }).session(session);

    if (conflicting) {
      throw Object.assign(new Error("Slot already booked by another user"), { status: 409 });
    }

    //////////////////////////////////////////////////////////
    // 💰 BOOKING AMOUNT VALIDATION
    //////////////////////////////////////////////////////////

    if (!booking.totalAmountInPaise) {
      throw Object.assign(new Error("Booking amount is missing"), { status: 400 });
    }

    //////////////////////////////////////////////////////////
    // 🔐 PAYMENT IDEMPOTENCY CHECK
    //////////////////////////////////////////////////////////

    const existingTxn = await Transaction.findOne({ paymentId }).session(session);
    if (existingTxn) {
      throw Object.assign(new Error("Duplicate payment detected"), { status: 409 });
    }

    //////////////////////////////////////////////////////////
    // 💰 FINANCE CALCULATIONS
    //////////////////////////////////////////////////////////

    const amount       = booking.totalAmountInPaise;
    const commission   = Math.round(amount * 0.1);
    const payoutAmount = amount - commission;

    //////////////////////////////////////////////////////////
    // 💳 CREATE TRANSACTION
    //////////////////////////////////////////////////////////

    await Transaction.create(
      [
        {
          bookingId:  booking._id,
          salonId:    booking.salonRef,
          resourceId: booking.chairRef,
          paymentId,
          orderId,
          amount,
          commission,
          payoutAmount,
          status:     TRANSACTION_STATUS.PAID,
          type:       TRANSACTION_TYPE.BOOKING,
        },
      ],
      { session }
    );

    //////////////////////////////////////////////////////////
    // 💰 WALLET UPSERT (atomic $inc)
    //////////////////////////////////////////////////////////

    await SalonEarnings.findOneAndUpdate(
      { salonId: booking.salonRef },
      {
        $inc: {
          balanceInPaise:       payoutAmount,
          totalEarningsInPaise: payoutAmount,
          walletVersion:        1,
        },
        $set: {
          lastTransactionAt: new Date(),
        },
        $setOnInsert: {
          salonId: booking.salonRef,
        },
      },
      { upsert: true, new: true, session }
    );

    //////////////////////////////////////////////////////////
    // ✅ TRANSITION TO CONFIRMED
    //////////////////////////////////////////////////////////

    const otp       = Math.floor(1000 + Math.random() * 9000);
    const otpHashed = hashOtp(otp); // stored as hash — never plaintext in DB

    await transitionBookingStatus({ booking, nextStatus: BOOKING_STATUS.CONFIRMED, session });

    booking.paymentStatus      = "PAID";
    booking.checkInOtp         = otpHashed; // hashed — raw otp returned to user only
    booking.lockUntil          = null;
    booking.checkInOtpEncrypted = encryptOtp(otp); // AES encrypted — for booking history

    // OTP is valid for 2 hours after booking start time.
    // Gives the customer a generous window even if they arrive
    // close to the end of the grace period.
    // Cleared to null on successful check-in (checkInBooking).
    booking.checkInOtpExpiresAt = new Date(
      booking.startTime.getTime() + 2 * 60 * 60 * 1000
    );

    // 🚗 ARRIVAL ENGINE — set grace window deadline
    //
    // arrivalGraceUntil = startTime + maxArrivalWaitMinutes (default 15)
    //
    // The customerArrival.job.js worker queries this field every 60s:
    //   { status: CONFIRMED, arrivalGraceUntil: { $lt: now }, customerDelayedAt: null }
    //
    // If this field is null when the job runs, the booking is invisible
    // to the arrival engine — the customer can never be flagged as delayed.
    // Setting it here (inside the session) guarantees it is always present
    // on every CONFIRMED booking, atomically with the status transition.
    booking.arrivalGraceUntil = new Date(
      booking.startTime.getTime() +
      booking.maxArrivalWaitMinutes * 60 * 1000
    );

    await booking.save({ session });

    //////////////////////////////////////////////////////////
    // ✅ COMMIT
    //////////////////////////////////////////////////////////

    await session.commitTransaction();
    session.endSession();

    //////////////////////////////////////////////////////////
    // 📡 REALTIME — slot is now confirmed (update chair grid)
    //////////////////////////////////////////////////////////

    emitBookingEvent(req, {
      event:   "booking:confirmed",
      salonId: booking.salonRef.toString(),
      userId:  booking.userRef.toString(),
      payload: {
        bookingId: booking._id,
        chairId:   booking.chairRef,
        startTime: booking.startTime,
        endTime:   booking.endTime,
        status:    BOOKING_STATUS.CONFIRMED,
      },
    });

    return res.status(200).json({
      success:    true,
      bookingId:  booking._id,
      checkInOtp: otp,        // raw 4-digit OTP — shown to user once, never stored raw
      message:    "Booking confirmed successfully",
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("confirmBooking error:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to confirm booking",
    });
  }
};

//////////////////////////////////////////////////////////////
// 🚀 3. CHECK-IN
//////////////////////////////////////////////////////////////

export const checkInBooking = async (req, res) => {
  try {
    const { bookingId, otp } = req.body;

    if (!otp) {
      return res.status(400).json({
        success: false,
        message: "OTP is required",
      });
    }

    // OPTION-A: bookingId + otp both verified.
    //
    // Security improvement over OTP-only lookup:
    //   Without bookingId → attacker brute-forces 9000 OTP
    //     combinations across ALL CONFIRMED bookings.
    //   With bookingId → attacker must know the specific booking
    //     AND its OTP — two independent secrets required.
    //
    // Also tighter DB query: { _id, checkInOtp, status }
    // uses the _id index directly instead of scanning all
    // CONFIRMED bookings by OTP hash.
    const hashedOtp = hashOtp(otp);

    const booking = await Booking.findOne({
      _id:        bookingId,
      checkInOtp: hashedOtp,
      status:     BOOKING_STATUS.CONFIRMED,
    });

    if (!booking) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP or booking ID",
      });
    }

    //////////////////////////////////////////////////////////
    // ⏳ OTP EXPIRY CHECK
    //
    // checkInOtpExpiresAt is set to (startTime + 2 hours) in
    // confirmBooking(). If the customer tries to check in after
    // that window — e.g. a very late walk-in with a saved OTP —
    // reject before touching any state.
    //
    // Checked AFTER the findOne so we return "Invalid OTP" for
    // unknown OTPs and "OTP has expired" only for valid-but-stale
    // ones — avoids leaking which OTPs exist in the system.
    //////////////////////////////////////////////////////////

    if (
      booking.checkInOtpExpiresAt &&
      booking.checkInOtpExpiresAt < new Date()
    ) {
      return res.status(403).json({
        success: false,
        message: "OTP has expired. Please contact the salon to check in.",
      });
    }

    //////////////////////////////////////////////////////////
    // 🔁 STATE MACHINE VALIDATION
    //////////////////////////////////////////////////////////

    if (!validateBookingTransition(booking.status, BOOKING_STATUS.CHECKED_IN)) {
      return res.status(400).json({
        success: false,
        message: "Invalid state for check-in",
      });
    }

    //////////////////////////////////////////////////////////
    // ⏱ CHECK-IN TIME WINDOW (±30 minutes)
    //////////////////////////////////////////////////////////

    const now         = new Date();
    const diffMinutes = (now - booking.startTime) / (1000 * 60);

    if (diffMinutes < -30) {
      const opensAt    = new Date(booking.startTime.getTime() - 30 * 60 * 1000);
      const opensAtStr = opensAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
      return res.status(403).json({
        success: false,
        message: `Too early! Check-in opens at ${opensAtStr}`,
      });
    }

    if (diffMinutes > 30) {
      const bookingTimeStr = booking.startTime.toLocaleTimeString("en-IN", {
        hour: "2-digit", minute: "2-digit",
      });
      return res.status(403).json({
        success: false,
        message: `Check-in window closed. Booking was at ${bookingTimeStr}. Please contact the salon.`,
      });
    }

    //////////////////////////////////////////////////////////
    // ✅ TRANSITION TO CHECKED_IN — ATOMIC SESSION
    //
    // OTP fields are cleared on the in-memory document BEFORE
    // transitionBookingStatus() is called so that its internal
    // save persists the status change AND the OTP nullification
    // in one atomic write inside the same session.
    //////////////////////////////////////////////////////////

    const checkInSession = await mongoose.startSession();
    checkInSession.startTransaction();

    try {
      booking.checkInOtp          = null;
      booking.checkInOtpExpiresAt = null;

      // Clear delayed flag — customer did eventually arrive.
      // Without this, customerDelayedAt remains set even after
      // successful check-in, corrupting late-arrival analytics
      // (the booking would be counted as a delay even though the
      // customer showed up). Null here = "arrived within session".
      booking.customerDelayedAt   = null;

      // Clear grace window — customer has arrived, the arrival
      // timer is no longer relevant. Without this, the
      // customerArrival.job.js worker may match stale grace windows
      // on CHECKED_IN bookings if the status index update and job
      // query race at the same second, emitting a spurious
      // booking:customerDelayed event for a customer already inside.
      booking.arrivalGraceUntil   = null;

      await transitionBookingStatus({
        booking,
        nextStatus: BOOKING_STATUS.CHECKED_IN,
        session:    checkInSession,
      });

      await checkInSession.commitTransaction();
      checkInSession.endSession();

    } catch (checkInError) {
      await checkInSession.abortTransaction();
      checkInSession.endSession();
      throw checkInError;
    }

    //////////////////////////////////////////////////////////
    // 📡 REALTIME — customer is in the salon
    //////////////////////////////////////////////////////////

    emitBookingEvent(req, {
      event:   "booking:checkedIn",
      salonId: booking.salonRef.toString(),
      userId:  booking.userRef.toString(),
      payload: {
        bookingId: booking._id,
        chairId:   booking.chairRef,
        status:    BOOKING_STATUS.CHECKED_IN,
        checkedInAt: new Date(),
      },
    });

    return res.status(200).json({
      success:   true,
      bookingId: booking._id,
      message:   "Check-in successful",
    });

  } catch (error) {
    console.error("checkInBooking error:", error);
    return res.status(500).json({
      success: false,
      message: "Check-in failed",
    });
  }
};

//////////////////////////////////////////////////////////////
// 🚀 4. START SERVICE
//////////////////////////////////////////////////////////////

export const startService = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { bookingId } = req.body;

    //////////////////////////////////////////////////////////
    // 🔍 FETCH BOOKING (inside session)
    //////////////////////////////////////////////////////////

    const booking = await Booking.findById(bookingId).session(session);

    if (!booking) {
      throw Object.assign(new Error("Booking not found"), { status: 404 });
    }

    //////////////////////////////////////////////////////////
    // 🔐 SALON OWNERSHIP CHECK
    //////////////////////////////////////////////////////////

    await assertSalonOwnership(booking.salonRef, req.user._id, session);

    //////////////////////////////////////////////////////////
    // 🔁 MUST BE CHECKED_IN → ONGOING
    //////////////////////////////////////////////////////////

    if (!validateBookingTransition(booking.status, BOOKING_STATUS.ONGOING)) {
      throw Object.assign(
        new Error("Booking must be in CHECKED_IN state to start service"),
        { status: 400 }
      );
    }

    await transitionBookingStatus({
      booking,
      nextStatus: BOOKING_STATUS.ONGOING,
      session,
    });

    await session.commitTransaction();
    session.endSession();

    //////////////////////////////////////////////////////////
    // 📡 REALTIME — service timer starts on customer screen
    //         (after commit — socket never blocks finance path)
    //////////////////////////////////////////////////////////

    emitBookingEvent(req, {
      event:   "booking:serviceStarted",
      salonId: booking.salonRef.toString(),
      userId:  booking.userRef.toString(),
      payload: {
        bookingId:        booking._id,
        chairId:          booking.chairRef,
        status:           BOOKING_STATUS.ONGOING,
        serviceStartedAt: booking.serviceStartedAt,
      },
    });

    return res.status(200).json({
      success:          true,
      bookingId:        booking._id,
      serviceStartedAt: booking.serviceStartedAt,
      message:          "Service started",
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("startService error:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to start service",
    });
  }
};

//////////////////////////////////////////////////////////////
// 🚀 5. COMPLETE SERVICE — FULLY ATOMIC (mongoose session)
//////////////////////////////////////////////////////////////

export const completeService = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { bookingId } = req.body;

    //////////////////////////////////////////////////////////
    // 🔍 FETCH BOOKING (inside session)
    //////////////////////////////////////////////////////////

    const booking = await Booking.findById(bookingId).session(session);

    if (!booking) {
      throw Object.assign(new Error("Booking not found"), { status: 404 });
    }

    //////////////////////////////////////////////////////////
    // 🔐 SALON OWNERSHIP CHECK
    //////////////////////////////////////////////////////////

    await assertSalonOwnership(booking.salonRef, req.user._id, session);

    //////////////////////////////////////////////////////////
    // 🔁 STATE MACHINE VALIDATION
    //////////////////////////////////////////////////////////

    if (!validateBookingTransition(booking.status, BOOKING_STATUS.COMPLETED)) {
      throw Object.assign(
        new Error("Invalid state transition for service completion"),
        { status: 400 }
      );
    }

    //////////////////////////////////////////////////////////
    // ⏱ MINIMUM SERVICE TIME (1 minute)
    //////////////////////////////////////////////////////////

    const elapsedMinutes = (new Date() - booking.serviceStartedAt) / (1000 * 60);

    if (elapsedMinutes < 1) {
      throw Object.assign(
        new Error("Minimum service time has not been met"),
        { status: 403 }
      );
    }

    //////////////////////////////////////////////////////////
    // 💰 VERIFY PAYMENT TRANSACTION EXISTS
    //
    // FIX-3: completeService() must NOT create a new transaction.
    //
    // Industry-correct flow:
    //   confirmBooking()  → creates BOOKING transaction + credits wallet
    //   completeService() → verifies the transaction exists, transitions
    //                       status to COMPLETED, frees the chair
    //
    // Creating a second Transaction.create() here would:
    //   ❌ double-count revenue in SalonEarnings
    //   ❌ double-count commission in reporting
    //   ❌ create a phantom financial record
    //
    // The wallet was credited at payment time. Nothing to credit here.
    //////////////////////////////////////////////////////////

    const paymentTxn = await Transaction.findOne({
      bookingId: booking._id,
      type:      TRANSACTION_TYPE.BOOKING,
      status:    TRANSACTION_STATUS.PAID,
    }).session(session);

    if (!paymentTxn) {
      // Payment transaction missing — this booking was never properly
      // confirmed through the payment flow. Block completion.
      throw Object.assign(
        new Error("Payment record not found — booking cannot be completed"),
        { status: 409 }
      );
    }

    // Fetch current wallet balance for the response (read-only, no update)
    const currentWallet = await SalonEarnings.findOne({
      salonId: booking.salonRef,
    }).session(session);

    //////////////////////////////////////////////////////////
    // ✅ TRANSITION TO COMPLETED (inside session)
    //////////////////////////////////////////////////////////

    await transitionBookingStatus({ booking, nextStatus: BOOKING_STATUS.COMPLETED, session });

    //////////////////////////////////////////////////////////
    // 📈 SERVICE BOOKING COUNT
    //////////////////////////////////////////////////////////

    if (
      Array.isArray(booking.serviceRefs) &&
      booking.serviceRefs.length
    ) {
      await Service.updateMany(
        {
          _id: { $in: booking.serviceRefs }
        },
        {
          $inc: { bookingCount: 1 }
        },
        { session }
      );
    }

    //////////////////////////////////////////////////////////
    // ✅ COMMIT
    //////////////////////////////////////////////////////////

    await session.commitTransaction();
    session.endSession();

    //////////////////////////////////////////////////////////
    // 📬 NOTIFICATION (non-blocking, after commit)
    //////////////////////////////////////////////////////////

    try {
      const { createNotification } = await import("./notification.controller.js");
      await createNotification({
        recipientId:   booking.salonRef,
        recipientType: "SALON",
        title:         "Service Completed ✅",
        message:       `Service completed. Chair is now free.`,
        type:          "SERVICE",
        priority:      "HIGH",
        meta:          { bookingId: booking._id },
      });
    } catch (notifError) {
      console.warn("Notification failed (non-critical):", notifError.message);
    }

    //////////////////////////////////////////////////////////
    // 📡 REALTIME — chair freed (after commit)
    //////////////////////////////////////////////////////////

    emitBookingEvent(req, {
      event:   "booking:completed",
      salonId: booking.salonRef.toString(),
      userId:  booking.userRef.toString(),
      payload: {
        bookingId:     booking._id,
        chairId:       booking.chairRef,
        status:        BOOKING_STATUS.COMPLETED,
        walletBalance: currentWallet?.balanceInPaise ?? 0,
      },
    });

    return res.status(200).json({
      success:       true,
      bookingId:     booking._id,
      transactionId: paymentTxn._id,
      walletBalance: currentWallet?.balanceInPaise ?? 0,
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("completeService error:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Service completion failed",
    });
  }
};

//////////////////////////////////////////////////////////////
// 🚀 6. CANCEL BOOKING — WITH REFUND/PENALTY LOGIC
//////////////////////////////////////////////////////////////

export const cancelBooking = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { bookingId } = req.body;

    const booking = await Booking.findById(bookingId).session(session);
    if (!booking) throw Object.assign(new Error("Booking not found"), { status: 404 });

    // USER OWNERSHIP CHECK
    if (booking.userRef.toString() !== req.user._id.toString()) {
      throw Object.assign(new Error("Unauthorized"), { status: 403 });
    }

    // STATE MACHINE VALIDATION
    if (!validateBookingTransition(booking.status, BOOKING_STATUS.CANCELLED)) {
      throw Object.assign(new Error("This booking cannot be cancelled"), { status: 400 });
    }

    //////////////////////////////////////////////////////////
    // 💰 REFUND/PENALTY CALCULATION
    // Based on how far before startTime cancellation happens
    //////////////////////////////////////////////////////////

    const now          = new Date();
    const startTime    = new Date(booking.startTime);
    const minsUntil    = (startTime - now) / (1000 * 60);
    const totalPaise   = booking.totalAmountInPaise || 0;

    let refundPaise    = 0;
    let penaltyPaise   = 0;
    let refundPolicy   = "";

    if (booking.status === BOOKING_STATUS.HOLD) {
      // HOLD — no payment captured yet, no refund needed
      refundPaise  = 0;
      penaltyPaise = 0;
      refundPolicy = "NO_PAYMENT";
    } else if (minsUntil >= 120) {
      // 2+ hours before → 100% refund
      refundPaise  = totalPaise;
      penaltyPaise = 0;
      refundPolicy = "FULL_REFUND";
    } else if (minsUntil >= 30) {
      // 30min - 2hr before → 50% refund
      refundPaise  = Math.round(totalPaise * 0.5);
      penaltyPaise = totalPaise - refundPaise;
      refundPolicy = "HALF_REFUND";
    } else {
      // Less than 30 min → 0% refund
      refundPaise  = 0;
      penaltyPaise = totalPaise;
      refundPolicy = "NO_REFUND";
    }

    //////////////////////////////////////////////////////////
    // 💰 WALLET ADJUSTMENT — deduct refund from salon wallet
    // Salon wallet was credited at confirmBooking time
    // Commission (10%) was already deducted then
    // So we only adjust the payoutAmount portion
    //////////////////////////////////////////////////////////

    if (refundPaise > 0 && booking.status === BOOKING_STATUS.CONFIRMED) {
      const commission     = Math.round(totalPaise * 0.1);
      const payoutTotal    = totalPaise - commission;
      const refundNet      = Math.round(refundPaise * 0.9); // deduct commission portion

      await SalonEarnings.findOneAndUpdate(
        { salonId: booking.salonRef },
        { $inc: { balanceInPaise: -refundNet, totalEarningsInPaise: -refundNet } },
        { session }
      );
    }

    // Store cancellation details on booking
    booking.cancellationPolicy  = refundPolicy;
    booking.refundAmountInPaise = refundPaise;
    booking.cancelledAt         = now;

    await transitionBookingStatus({
      booking,
      nextStatus: BOOKING_STATUS.CANCELLED,
      session,
    });

    await session.commitTransaction();
    session.endSession();

    emitBookingEvent(req, {
      event:   "booking:cancelled",
      salonId: booking.salonRef.toString(),
      userId:  booking.userRef.toString(),
      payload: {
        bookingId: booking._id,
        chairId:   booking.chairRef,
        startTime: booking.startTime,
        endTime:   booking.endTime,
        status:    BOOKING_STATUS.CANCELLED,
      },
    });

    return res.status(200).json({
      success:            true,
      bookingId:          booking._id,
      refundPolicy,
      refundAmountInPaise: refundPaise,
      refundAmountRupees:  Math.round(refundPaise / 100),
      message:            "Booking cancelled successfully",
    });

    } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("cancelBooking error:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to cancel booking",
    });
  }
};


//////////////////////////////////////////////////////////////
// 🚀 7. MARK NO-SHOW
//////////////////////////////////////////////////////////////

export const markNoShow = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { bookingId } = req.body;

    //////////////////////////////////////////////////////////
    // 🔍 FETCH BOOKING (inside session)
    //////////////////////////////////////////////////////////

    const booking = await Booking.findById(bookingId).session(session);

    if (!booking) {
      throw Object.assign(new Error("Booking not found"), { status: 404 });
    }

    //////////////////////////////////////////////////////////
    // 🔐 SALON OWNERSHIP CHECK
    //////////////////////////////////////////////////////////

    await assertSalonOwnership(booking.salonRef, req.user._id, session);

    //////////////////////////////////////////////////////////
    // 🔁 STATE MACHINE VALIDATION
    //////////////////////////////////////////////////////////

    if (![BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.CHECKED_IN].includes(booking.status)) {
      throw Object.assign(
        new Error("Only CONFIRMED or CHECKED_IN bookings can be marked as no-show"),
        { status: 400 }
      );
    }

    await transitionBookingStatus({
      booking,
      nextStatus: BOOKING_STATUS.NO_SHOW,
      session,
    });

    await session.commitTransaction();
    session.endSession();

    //////////////////////////////////////////////////////////
    // 📡 REALTIME — chair freed immediately
    //         (after commit — socket never blocks the write)
    //////////////////////////////////////////////////////////

    emitBookingEvent(req, {
      event:   "booking:noShow",
      salonId: booking.salonRef.toString(),
      userId:  booking.userRef.toString(),
      payload: {
        bookingId: booking._id,
        chairId:   booking.chairRef,
        startTime: booking.startTime,
        endTime:   booking.endTime,
        status:    BOOKING_STATUS.NO_SHOW,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Marked as no-show. Chair is now free.",
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("markNoShow error:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to mark no-show",
    });
  }
};

//////////////////////////////////////////////////////////////
// 🚀 8. GET MY BOOKINGS (ALL — paginated)
//////////////////////////////////////////////////////////////

export const getMyBookings = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.user?._id)) {
      return res.status(401).json({
        success: false,
        message: "Invalid session",
      });
    }

    const userId             = req.user._id;
    const { page, limit, skip } = getPagination(req.query);

    const filter = {
      userRef:   userId,
      isDeleted: false,
    };

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate(USER_BOOKING_POPULATE)
        .lean(),
      Booking.countDocuments(filter),
    ]);

    const bookingsWithOtp = bookings.map(b => ({
      ...b,
      checkInOtp: b.checkInOtpEncrypted ? decryptOtp(b.checkInOtpEncrypted) : null,
      checkInOtpEncrypted: undefined,
    }));

    return res.status(200).json({
      success:  true,
      bookings: bookingsWithOtp,
      pagination: {
        page,
        limit,
        total,
        pages:   Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    });

  } catch (error) {
    console.error("getMyBookings error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch bookings",
    });
  }
};

//////////////////////////////////////////////////////////////
// 🚀 9. GET UPCOMING BOOKINGS
//////////////////////////////////////////////////////////////

export const getUpcomingBookings = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.user?._id)) {
      return res.status(401).json({
        success: false,
        message: "Invalid session",
      });
    }

    const userId   = req.user._id;

    const bookings = await Booking.find({
      userRef:   userId,
      isDeleted: false,
      status: {
        $in: [
          BOOKING_STATUS.CONFIRMED,
          BOOKING_STATUS.HOLD,
          BOOKING_STATUS.CHECKED_IN,
        ],
      },
      startTime: { $gte: new Date() },
    })
      .sort({ startTime: 1 })
      .limit(20)
      .populate(USER_BOOKING_POPULATE)
      .lean();

    const bookingsWithOtp = bookings.map(b => ({
      ...b,
      checkInOtp: b.checkInOtpEncrypted ? decryptOtp(b.checkInOtpEncrypted) : null,
      checkInOtpEncrypted: undefined,
    }));

    return res.status(200).json({
      success:  true,
      bookings: bookingsWithOtp,
    });

  } catch (error) {
    console.error("getUpcomingBookings error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch upcoming bookings",
    });
  }
};

//////////////////////////////////////////////////////////////
// 🚀 10. GET COMPLETED BOOKINGS (paginated)
//////////////////////////////////////////////////////////////

export const getCompletedBookings = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.user?._id)) {
      return res.status(401).json({
        success: false,
        message: "Invalid session",
      });
    }

    const userId             = req.user._id;
    const { page, limit, skip } = getPagination(req.query);

    const filter = {
      userRef:   userId,
      isDeleted: false,
      status:    BOOKING_STATUS.COMPLETED,
    };

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate(USER_BOOKING_POPULATE)
        .lean(),
      Booking.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      bookings,
      pagination: {
        page,
        limit,
        total,
        pages:   Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    });

  } catch (error) {
    console.error("getCompletedBookings error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch completed bookings",
    });
  }
};

//////////////////////////////////////////////////////////////
// 🚀 11. GET SALON BOOKINGS (OWNER VIEW — paginated)
//////////////////////////////////////////////////////////////

export const getSalonBookings = async (req, res) => {
  try {
    const ownerId            = req.user._id;
    const { status }         = req.query;
    const { page, limit, skip } = getPagination(req.query);

    const salon = await Salon.findOne({ ownerId }).select("_id").lean();

    if (!salon) {
      return res.status(404).json({
        success: false,
        message: "Salon not found",
      });
    }

    const filter = { salonRef: salon._id };
    if (status) filter.status = status;

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("userRef",     "name phone")
        .populate("serviceRefs", "name price duration")
        .populate("chairRef",    "name")
        .lean(),
      Booking.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      bookings,
      pagination: {
        page,
        limit,
        total,
        pages:   Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    });

  } catch (error) {
    console.error("getSalonBookings error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch salon bookings",
    });
  }
};

//////////////////////////////////////////////////////////////
// 🚀 12. FORCE COMPLETE (Already Served — barber forgot)
// CHECKED_IN → COMPLETED directly
// body: { bookingId, actualDurationMinutes }
//////////////////////////////////////////////////////////////

export const forceComplete = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { bookingId, actualDurationMinutes } = req.body;
    const booking = await Booking.findById(bookingId).session(session);
    if (!booking) throw Object.assign(new Error("Booking not found"), { status: 404 });
    await assertSalonOwnership(booking.salonRef, req.user._id, session);
    if (booking.status !== BOOKING_STATUS.CHECKED_IN) {
      throw Object.assign(new Error("Only CHECKED_IN bookings can be force completed"), { status: 400 });
    }
    const paymentTxn = await Transaction.findOne({
      bookingId: booking._id,
      type:      TRANSACTION_TYPE.BOOKING,
      status:    TRANSACTION_STATUS.PAID,
    }).session(session);
    if (!paymentTxn) throw Object.assign(new Error("Payment record not found"), { status: 409 });
    const now        = new Date();
    const durationMs = (actualDurationMinutes || 30) * 60 * 1000;
    booking.serviceStartedAt = new Date(now.getTime() - durationMs);
    booking.status           = BOOKING_STATUS.COMPLETED;
    booking.completedAt      = now;
    booking.statusChangedAt  = now;
    booking.forceCompleted   = true;
    await booking.save({ session });
    const currentWallet = await SalonEarnings.findOne({ salonId: booking.salonRef }).session(session);
    await session.commitTransaction();
    session.endSession();
    emitBookingEvent(req, {
      event:   "booking:completed",
      salonId: booking.salonRef.toString(),
      userId:  booking.userRef.toString(),
      payload: { bookingId: booking._id, chairId: booking.chairRef, status: BOOKING_STATUS.COMPLETED, walletBalance: currentWallet?.balanceInPaise ?? 0 },
    });
    return res.status(200).json({ success: true, bookingId: booking._id, transactionId: paymentTxn._id, walletBalance: currentWallet?.balanceInPaise ?? 0, message: "Booking marked as completed" });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to force complete" });
  }
};

