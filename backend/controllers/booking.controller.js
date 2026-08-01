import crypto from "crypto";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Salon from "../models/Salon.js";
import SalonEarnings from "../models/SalonEarnings.js";
import Service from "../models/Service.js";
import Transaction, {
  PAYMENT_METHOD,
  TRANSACTION_STATUS,
  TRANSACTION_TYPE,
} from "../models/Transaction.js";
import User from "../models/User.js";
import WalletTransaction, {
  WALLET_TXN_DIRECTION,
  WALLET_TXN_SOURCE,
  WALLET_TXN_STATUS,
  WALLET_TXN_TYPE,
} from "../models/WalletTransaction.js";
import CancellationPolicyService from "../services/CancellationPolicyService.js";
import CommissionService from "../services/CommissionService.js";
import NotificationService from "../services/NotificationService.js";
import { getSmartSlots, invalidateNextSlotCache } from "../services/slotEngine.service.js";
import WalletBalanceService from "../services/WalletBalanceService.js";
import {
  BOOKING_STATUS,
  transitionBookingStatus,
  validateBookingTransition,
} from "../utils/bookingState.machine.js";
import { toFriendlyId } from "../utils/friendlyId.js";
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
      const serviceAmountInPaise = selectedServices.reduce(
        (sum, s) => sum + Math.round(s.price * 100),
        0
      );

      //////////////////////////////////////////////////////////
      // 💰 COMMISSION IS CHARGED ON TOP OF THE SERVICE PRICE —
      // NOT deducted from it. totalAmountInPaise (what the user
      // actually pays via Razorpay) = service + commission. The
      // full serviceAmountInPaise goes to the salon on confirm;
      // the commission stays with the platform. Both are stored on
      // the booking (see Booking.js) so the split survives even if
      // the commission rate changes later.
      //////////////////////////////////////////////////////////
      const salonForCommission = await Salon.findById(salonId)
        .select("business.commissionRate")
        .session(lockSession)
        .lean();

      const { commissionInPaise } = await CommissionService.calculate({
        amountInPaise: serviceAmountInPaise,
        salon: salonForCommission,
      });

      const totalAmountInPaise = serviceAmountInPaise + commissionInPaise;

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
            serviceAmountInPaise,
            commissionAmountInPaise: commissionInPaise,
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
      // Amount breakdown — frontend must display and charge exactly
      // this (not recalculate its own total), since this is what
      // confirmBooking's Razorpay order will actually charge.
      serviceAmountInPaise:    booking.serviceAmountInPaise,
      commissionAmountInPaise: booking.commissionAmountInPaise,
      totalAmountInPaise:      booking.totalAmountInPaise,
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
      paymentMethod = "RAZORPAY", // "RAZORPAY" | "WALLET"
      paymentId,         // razorpay_payment_id — required only for RAZORPAY
      orderId,           // razorpay_order_id — required only for RAZORPAY
      razorpaySignature, // razorpay_signature — required only for RAZORPAY
    } = req.body;

    const isWalletPayment = paymentMethod === "WALLET";

    //////////////////////////////////////////////////////////
    // 💳 PAYMENT ID FORMAT GUARD (RAZORPAY only — wallet payments
    // have no Razorpay payment ID at all)
    //////////////////////////////////////////////////////////
  
    if (!isWalletPayment) {
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
    }

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
    // 💰 WALLET PAYMENT — synthetic paymentId (no real Razorpay
    // payment exists for a wallet-funded booking). Deterministic
    // per-booking so a retried confirmBooking call for the same
    // booking hits the same idempotency check below rather than
    // generating a new "payment" each time.
    //////////////////////////////////////////////////////////

    const effectivePaymentId = isWalletPayment
      ? `wallet_${booking._id}`
      : paymentId;

    //////////////////////////////////////////////////////////
    // 🔐 PAYMENT IDEMPOTENCY CHECK
    //////////////////////////////////////////////////////////
  
    const existingTxn = await Transaction.findOne({ paymentId: effectivePaymentId }).session(session);
    if (existingTxn) {
      throw Object.assign(new Error("Duplicate payment detected"), { status: 409 });
    }
  
    //////////////////////////////////////////////////////////
    // 💰 FINANCE SPLIT — commission was already calculated and
    // locked in at booking-creation time (lockSlot), not
    // re-derived here.
    //////////////////////////////////////////////////////////

    const amount        = booking.totalAmountInPaise;
    const commission    = booking.commissionAmountInPaise;
    const payoutAmount  = booking.serviceAmountInPaise;

    //////////////////////////////////////////////////////////
    // 💰 WALLET DEBIT — only for paymentMethod: "WALLET". Atomic
    // conditional $inc (filter requires sufficient balance) so two
    // concurrent confirm attempts for the same user can never both
    // succeed and drive the balance negative — same pattern as
    // WalletBalanceService.applyLedgerEntry for salon wallets.
    //////////////////////////////////////////////////////////

    if (isWalletPayment) {
      const amountRupees = amount / 100;
      const userBefore = await User.findOne({ _id: booking.userRef, isDeleted: false })
        .select("walletBalance")
        .session(session);
      if (!userBefore) {
        throw Object.assign(new Error("User not found"), { status: 404 });
      }
      const balanceBeforeInPaise = Math.round((userBefore.walletBalance || 0) * 100);

      if (balanceBeforeInPaise < amount) {
        throw Object.assign(
          new Error("Insufficient wallet balance"),
          { status: 400 }
        );
      }

      const updatedUser = await User.findOneAndUpdate(
        {
          _id: booking.userRef,
          isDeleted: false,
          walletBalance: { $gte: amountRupees }, // re-check atomically at write time
        },
        { $inc: { walletBalance: -amountRupees } },
        { new: true, session }
      ).select("walletBalance");

      if (!updatedUser) {
        // Balance changed between the read above and this write
        // (concurrent debit) — fail safe rather than overdraw.
        throw Object.assign(
          new Error("Insufficient wallet balance"),
          { status: 400 }
        );
      }

      await WalletTransaction.create(
        [{
          userId:        booking.userRef,
          bookingId:     booking._id,
          direction:     WALLET_TXN_DIRECTION.DEBIT,
          type:          WALLET_TXN_TYPE.BOOKING_PAYMENT,
          status:        WALLET_TXN_STATUS.SUCCESS,
          source:        WALLET_TXN_SOURCE.BOOKING,
          amountInPaise: amount,
          requestId:     `booking_payment:${booking._id}`,
          balanceBeforeInPaise,
          balanceAfterInPaise: Math.round(updatedUser.walletBalance * 100),
          metadata:      { bookingId: booking._id.toString() },
        }],
        { session }
      );
    }

    //////////////////////////////////////////////////////////
    // 💳 CREATE TRANSACTION
    //////////////////////////////////////////////////////////

    await Transaction.create(
      [
        {
          bookingId:  booking._id,
          userId:     booking.userRef,
          salonId:    booking.salonRef,
          resourceId: booking.chairRef,
          paymentId:  effectivePaymentId,
          orderId:    orderId || null,
          amount,
          commission,
          payoutAmount,
          status:     TRANSACTION_STATUS.PAID,
          type:       TRANSACTION_TYPE.BOOKING,
          paymentMethod: isWalletPayment ? PAYMENT_METHOD.WALLET : PAYMENT_METHOD.UPI,
        },
      ],
      { session }
    );


    //////////////////////////////////////////////////////////
    // 💰 WALLET CREDIT (PENDING) — via WalletBalanceService
    //////////////////////////////////////////////////////////
    await WalletBalanceService.creditPending({
      salonId:       booking.salonRef,
      amountInPaise: payoutAmount,
      action:        "BOOKING_SETTLEMENT",
      entityType:    "BOOKING",
      entityId:      booking._id,
      idempotencyKey: `booking:credit:${booking._id}`,
      session,
      triggeredBy:   "SYSTEM",
      remarks:       "Booking paid — held pending service delivery",
    });

    //////////////////////////////////////////////////////////
    // ✅ TRANSITION TO CONFIRMED
    //////////////////////////////////////////////////////////

    const otp       = Math.floor(1000 + Math.random() * 9000);
    const otpHashed = hashOtp(otp);

    await transitionBookingStatus({ booking, nextStatus: BOOKING_STATUS.CONFIRMED, session });
    booking.paymentStatus      = "PAID";
    booking.checkInOtp         = otpHashed;
    booking.lockUntil          = null;
    booking.checkInOtpEncrypted = encryptOtp(otp);

    booking.checkInOtpExpiresAt = new Date(
      booking.startTime.getTime() + 2 * 60 * 60 * 1000
    );

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
    // 🗑️ CACHE INVALIDATION
    //////////////////////////////////////////////////////////
    await invalidateNextSlotCache(
      booking.salonRef.toString(),
      booking.startTime.toISOString().split("T")[0]
    );

    //////////////////////////////////////////////////////////
    // 📡 REALTIME
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

    //////////////////////////////////////////////////////////
    // 📬 NOTIFICATION (non-blocking, after commit)
    //////////////////////////////////////////////////////////

    const bookingTimeStr = booking.startTime.toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
    });
    await NotificationService.send({
      recipientId:   booking.userRef,
      recipientType: "USER",
      title:         "Booking Confirmed",
      message:       `Your appointment is confirmed for today at ${bookingTimeStr}.`,
      type:          "BOOKING",
      priority:      "HIGH",
      actionType:    "OPEN_BOOKING",
      actionUrl:     `/bookings/${booking._id}`,
      meta:          { bookingId: booking._id, friendlyBookingId: toFriendlyId(booking._id, "BK") },
    });

    return res.status(200).json({
      success:    true,
      bookingId:  booking._id,
      checkInOtp: otp,
      message:    "Booking confirmed successfully",
      serviceAmountInPaise:    booking.serviceAmountInPaise,
      commissionAmountInPaise: booking.commissionAmountInPaise,
      totalAmountInPaise:      booking.totalAmountInPaise,
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();


    console.error("confirmBooking error:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Booking confirmation failed",
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
      const opensAtStr = opensAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
      return res.status(403).json({
        success: false,
        message: `Too early! Check-in opens at ${opensAtStr}`,
      });
    }

    if (diffMinutes > 30) {
      const bookingTimeStr = booking.startTime.toLocaleTimeString("en-IN", {
        hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
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

    await NotificationService.send({
      recipientId:   booking.userRef,
      recipientType: "USER",
      title:         "Checked In",
      message:       "You're checked in. The salon will start your service shortly.",
      type:          "BOOKING",
      priority:      "MEDIUM",
      actionType:    "OPEN_BOOKING",
      actionUrl:     `/bookings/${booking._id}`,
      meta:          { bookingId: booking._id, friendlyBookingId: toFriendlyId(booking._id, "BK") },
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

    await NotificationService.send({
      recipientId:   booking.userRef,
      recipientType: "USER",
      title:         "Service Started",
      message:       "Your service has started. Sit back and relax!",
      type:          "BOOKING",
      priority:      "MEDIUM",
      actionType:    "OPEN_BOOKING",
      actionUrl:     `/bookings/${booking._id}`,
      meta:          { bookingId: booking._id, friendlyBookingId: toFriendlyId(booking._id, "BK") },
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

    //////////////////////////////////////////////////////////
    // 💰 RELEASE PENDING → AVAILABLE
    // Service is genuinely done now — this is the moment the
    // salon earns the right to withdraw. Money sat in PENDING
    // since payment time; releasing it only here (not at payment
    // time) protects against paid-but-never-delivered scenarios.
    //////////////////////////////////////////////////////////

    await WalletBalanceService.releasePendingToAvailable({
      salonId:        booking.salonRef,
      amountInPaise:  paymentTxn.payoutAmount,
      entityType:     "BOOKING",   // ← "Transaction" se badla
      entityId:       paymentTxn._id,
      idempotencyKey: `booking:release:${booking._id}`,
      session,
      triggeredBy:    "SYSTEM",
      remarks:        "Service completed — funds released to available balance",
    });

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
    // 🗑️ CACHE INVALIDATION — next-slot label stale after completion
    //////////////////////////////////////////////////////////

    await invalidateNextSlotCache(
      booking.salonRef.toString(),
      booking.startTime.toISOString().split("T")[0]
    );

    //////////////////////////////////////////////////////////
    // 📬 NOTIFICATION (non-blocking, after commit)
    //////////////////////////////////////////////////////////

    await NotificationService.send({
      recipientId:   booking.salonRef,
      recipientType: "SALON",
      title:         "Service Completed ✅",
      message:       `Service completed. Chair is now free.`,
      type:          "BOOKING",
      priority:      "HIGH",
      meta:          { bookingId: booking._id, friendlyBookingId: toFriendlyId(booking._id, "BK") },
    });

    await NotificationService.send({
      recipientId:   booking.userRef,
      recipientType: "USER",
      title:         "Service Completed",
      message:       "Your service is complete. Thank you for booking with us!",
      type:          "BOOKING",
      priority:      "MEDIUM",
      actionType:    "OPEN_BOOKING",
      actionUrl:     `/bookings/${booking._id}`,
      meta:          { bookingId: booking._id, friendlyBookingId: toFriendlyId(booking._id, "BK") },
    });

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
        walletBalance: currentWallet?.availableBalanceInPaise ?? 0,
      },
    });

    return res.status(200).json({
      success:       true,
      bookingId:     booking._id,
      transactionId: paymentTxn._id,
      walletBalance: currentWallet?.availableBalanceInPaise ?? 0,
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
    // Based on how far before startTime cancellation happens.
    // Delegated to CancellationPolicyService — the single source
    // of truth for cancellation refund policy (pure calculation,
    // no side effects; this controller remains responsible for
    // executing the workflow using the returned values).
    //////////////////////////////////////////////////////////

    const now = new Date();

    const {
      refundPolicy,
      serviceRefundPaise,
      commissionRefundPaise,
      refundPaise,
      penaltyPaise,
    } = CancellationPolicyService.evaluate({ booking, now });

    //////////////////////////////////////////////////////////
    // 💰 WALLET ADJUSTMENT — deduct refund from salon wallet
    // Salon wallet was credited (serviceAmountInPaise, full amount)
    // at confirmBooking time. On refund, only the service-amount
    // portion is deducted from the salon — commission was never the
    // salon's money to begin with, so it's untouched here.
    //////////////////////////////////////////////////////////
    if (refundPaise > 0 && booking.status === BOOKING_STATUS.CONFIRMED) {
      // Salon only ever gets refunded FOR the service-amount portion
      // — commission was never the salon's money, so it's never
      // deducted from the salon's balance. serviceRefundPaise is
      // exactly what the salon's pending balance shrinks by.
      await SalonEarnings.findOneAndUpdate(
        { salonId: booking.salonRef },
        { $inc: { balanceInPaise: -serviceRefundPaise, totalEarningsInPaise: -serviceRefundPaise } },
        { session }
      );

      //////////////////////////////////////////////////////////
      // 💰 CREDIT REFUND TO USER'S WALLET
      // refundPaise = serviceRefundPaise + commissionRefundPaise —
      // the user gets back their full share of both the service
      // amount AND the commission they paid, proportional to the
      // refund policy. The salon only loses serviceRefundPaise
      // (deducted above); commissionRefundPaise was always the
      // platform's money, never the salon's, so it doesn't touch
      // SalonEarnings at all. Idempotency key ties this to the
      // booking so a retried/duplicate cancelBooking call can never
      // double-credit the same refund.
      //////////////////////////////////////////////////////////

      const userBefore = await User.findOne({ _id: booking.userRef, isDeleted: false })
        .select("walletBalance")
        .session(session);

      const refundRupees = refundPaise / 100;
      const balanceBeforeInPaise = Math.round((userBefore?.walletBalance || 0) * 100);

      const updatedUser = await User.findOneAndUpdate(
        { _id: booking.userRef, isDeleted: false },
        { $inc: { walletBalance: refundRupees } },
        { new: true, session }
      ).select("walletBalance");

      await WalletTransaction.create(
        [{
          userId:        booking.userRef,
          bookingId:     booking._id,
          direction:     WALLET_TXN_DIRECTION.CREDIT,
          type:          WALLET_TXN_TYPE.REFUND,
          status:        WALLET_TXN_STATUS.SUCCESS,
          source:        WALLET_TXN_SOURCE.BOOKING,
          amountInPaise: refundPaise,
          requestId:     `refund:${booking._id}`,
          balanceBeforeInPaise,
          balanceAfterInPaise: Math.round((updatedUser?.walletBalance || 0) * 100),
          metadata:      { refundPolicy, bookingId: booking._id.toString() },
        }],
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

    //////////////////////////////////////////////////////////
    // 🗑️ CACHE INVALIDATION — next-slot label stale after cancellation
    //////////////////////////////////////////////////////////

    await invalidateNextSlotCache(
      booking.salonRef.toString(),
      booking.startTime.toISOString().split("T")[0]
    );
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

    const refundMsg = refundPaise > 0
      ? ` ₹${Math.round(refundPaise / 100)} has been refunded to your wallet.`
      : "";
    await NotificationService.send({
      recipientId:   booking.userRef,
      recipientType: "USER",
      title:         "Booking Cancelled",
      message:       `Your booking has been cancelled.${refundMsg}`,
      type:          "BOOKING",
      priority:      "MEDIUM",
      actionType:    "OPEN_BOOKING",
      actionUrl:     `/bookings/${booking._id}`,
      meta:          { bookingId: booking._id, friendlyBookingId: toFriendlyId(booking._id, "BK"), refundAmountInPaise: refundPaise },
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

    await NotificationService.send({
      recipientId:   booking.userRef,
      recipientType: "USER",
      title:         "Marked as No-Show",
      message:       "You were marked as a no-show for your booking. Contact the salon if this is a mistake.",
      type:          "BOOKING",
      priority:      "HIGH",
      actionType:    "OPEN_BOOKING",
      actionUrl:     `/bookings/${booking._id}`,
      meta:          { bookingId: booking._id, friendlyBookingId: toFriendlyId(booking._id, "BK") },
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
      friendlyBookingId: toFriendlyId(b._id, "BK"),
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
      // HOLD deliberately excluded — a HOLD booking has no payment
      // yet (Razorpay or wallet). Showing it as "upcoming" makes an
      // unpaid, un-confirmed slot look like a real booking to the
      // user. HOLD bookings auto-expire via the HoldExpiryJob if the
      // user never completes payment — they should be invisible
      // here until confirmBooking() actually transitions them.
      status: {
        $in: [
          BOOKING_STATUS.CONFIRMED,
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
      friendlyBookingId: toFriendlyId(b._id, "BK"),
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

    const bookingsWithFriendlyId = bookings.map(b => ({
      ...b,
      friendlyBookingId: toFriendlyId(b._id, "BK"),
    }));

    return res.status(200).json({
      success: true,
      bookings: bookingsWithFriendlyId,
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
    await WalletBalanceService.releasePendingToAvailable({
      salonId:        booking.salonRef,
      amountInPaise:  paymentTxn.payoutAmount,
      entityType:     "BOOKING",   // ← "Transaction" se badla
      entityId:       paymentTxn._id,
      idempotencyKey: `booking:release:${booking._id}`,
      session,
      triggeredBy:    "SYSTEM",
      remarks:        "Service force-completed — funds released to available balance",
    });
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
    await invalidateNextSlotCache(
      booking.salonRef.toString(),
      booking.startTime.toISOString().split("T")[0]
    );
    emitBookingEvent(req, {
      event:   "booking:completed",
      salonId: booking.salonRef.toString(),
      userId:  booking.userRef.toString(),
      payload: { bookingId: booking._id, chairId: booking.chairRef, status: BOOKING_STATUS.COMPLETED, walletBalance: currentWallet?.availableBalanceInPaise ?? 0 },
    });
    await NotificationService.send({
      recipientId:   booking.userRef,
      recipientType: "USER",
      title:         "Service Completed",
      message:       "Your service is complete. Thank you for booking with us!",
      type:          "BOOKING",
      priority:      "MEDIUM",
      actionType:    "OPEN_BOOKING",
      actionUrl:     `/bookings/${booking._id}`,
      meta:          { bookingId: booking._id, friendlyBookingId: toFriendlyId(booking._id, "BK") },
    });
    return res.status(200).json({ success: true, bookingId: booking._id, transactionId: paymentTxn._id, walletBalance: currentWallet?.availableBalanceInPaise ?? 0, message: "Booking marked as completed" });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to force complete" });
  }
};

//////////////////////////////////////////////////////////////
// 🚀 PAYMENT HISTORY — all booking payments, regardless of method
// GET /v1/bookings/user/payment-history?page=1&limit=20
//
// Unlike getWalletTransactions (wallet-only ledger), this shows
// every booking Transaction — Razorpay AND wallet-funded — as the
// unified "how much have I paid for bookings" history. Separate
// screen from Wallet History since a Razorpay payment never touches
// the wallet at all.
//////////////////////////////////////////////////////////////

export const getPaymentHistory = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }

    const page  = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const skip  = (page - 1) * limit;

    const filter = { userId };

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .populate({ path: "salonId", select: "basicInfo.shopName" })
        .populate({ path: "bookingId", select: "serviceRefs startTime status", populate: { path: "serviceRefs", select: "name" } })
        .lean(),
      Transaction.countDocuments(filter),
    ]);

    const data = transactions.map((t) => ({
      _id:            t._id,
      friendlyTxnId:  toFriendlyId(t._id, "TXN"),
      bookingId:      t.bookingId?._id || null,
      friendlyBookingId: t.bookingId?._id ? toFriendlyId(t.bookingId._id, "BK") : null,
      amount:         t.amount,
      commission:     t.commission,
      payoutAmount:   t.payoutAmount,
      status:         t.status,
      type:           t.type,
      paymentId:      t.paymentId,
      paymentMethod:  t.paymentMethod || PAYMENT_METHOD.UNKNOWN,
      salonName:      t.salonId?.basicInfo?.shopName || null,
      serviceNames:   (t.bookingId?.serviceRefs || []).map((s) => s.name).filter(Boolean),
      bookingStartTime: t.bookingId?.startTime || null,
      bookingStatus:  t.bookingId?.status || null,
      createdAt:      t.createdAt,
    }));

    return res.json({
      success: true,
      data,
      pagination: { total, page, limit },
    });
  } catch (error) {
    console.error("getPaymentHistory error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch payment history" });
  }
};