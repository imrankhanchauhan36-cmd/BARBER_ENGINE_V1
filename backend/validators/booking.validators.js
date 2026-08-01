import Joi from "joi";

//////////////////////////////////////////////////////////////
// 🔥 SHARED PRIMITIVES
//////////////////////////////////////////////////////////////

/** MongoDB ObjectId — 24-char hex string */
const objectId = Joi.string().hex().length(24);

/** 4-digit numeric OTP — always a string from req.body */
const otpField = Joi.string()
  .length(4)
  .pattern(/^[0-9]+$/)
  .required()
  .messages({
    "string.length":  "OTP must be exactly 4 digits",
    "string.pattern": "OTP must contain only digits",
  });

//////////////////////////////////////////////////////////////
// 🚀 BOOKING VALIDATORS
//////////////////////////////////////////////////////////////

export const bookingSchemas = {

  //////////////////////////////////////////////////////////
  // 1. LOCK SLOT
  // POST /v1/bookings/user/lock
  //
  // Example body:
  // {
  //   "salonId":         "64a1b2c3d4e5f6a7b8c9d0e1",
  //   "date":            "2024-08-15",
  //   "serviceDuration": 30,
  //   "bufferTime":      10,
  //   "requestedTime":   "2024-08-15T10:00:00.000Z",
  //   "serviceRefs":     ["64a1b2c3d4e5f6a7b8c9d0e2"]
  // }
  //////////////////////////////////////////////////////////
  lock: Joi.object({
    salonId: objectId
      .required()
      .messages({ "any.required": "salonId is required" }),

    date: Joi.date()
      .iso()
      .required()
      .messages({ "any.required": "date is required (YYYY-MM-DD)" }),

    serviceDuration: Joi.number()
      .positive()
      .required()
      .messages({ "any.required": "serviceDuration is required (minutes)" }),

    bufferTime: Joi.number()
      .min(0)
      .default(0),

    requestedTime: Joi.date()
      .iso()
      .greater("now")
      .required()
      .messages({
        "any.required":  "requestedTime is required (ISO datetime)",
        "date.greater":  "requestedTime must be in the future",
      }),

    // .unique() rejects the same serviceRef repeated in one request.
    // The real client can never produce this (service selection is a
    // toggle, not an add-only list — re-tapping a selected service
    // removes it), and the previous behavior for a duplicate was
    // already wrong: the stored serviceRefs array kept both entries
    // while MongoDB's $in de-duplicated the lookup, so the booking
    // priced/allocated only one instance while claiming two.
    serviceRefs: Joi.array()
      .items(objectId)
      .unique()
      .min(1)
      .required()
      .messages({
        "any.required":  "at least one serviceRef is required",
        "array.unique":   "Duplicate service selected — each service must be listed only once",
      }),

  }).unknown(false),

  //////////////////////////////////////////////////////////
  // 2. CONFIRM BOOKING
  // POST /v1/bookings/user/confirm
  // paymentMethod: "RAZORPAY" (default) or "WALLET".
  //   RAZORPAY → paymentId, orderId, razorpaySignature all required.
  //   WALLET   → none of those three are sent at all (no Razorpay
  //              payment exists for a wallet-funded booking); the
  //              controller generates its own synthetic paymentId.
  // Example body (Razorpay):
  // {
  //   "bookingId":         "64a1b2c3d4e5f6a7b8c9d0e1",
  //   "paymentMethod":     "RAZORPAY",
  //   "paymentId":         "pay_OFh27vVXrGEz3k",
  //   "orderId":           "order_OFh27vVXrGEz3k",
  //   "razorpaySignature": "abc123...hex"
  // }
  // Example body (Wallet):
  // {
  //   "bookingId":     "64a1b2c3d4e5f6a7b8c9d0e1",
  //   "paymentMethod": "WALLET"
  // }
  //////////////////////////////////////////////////////////
    confirm: Joi.object({
    bookingId: objectId
      .required()
      .messages({ "any.required": "bookingId is required" }),

    paymentMethod: Joi.string()
      .valid("RAZORPAY", "WALLET")
      .default("RAZORPAY"),

    // Required only when paymentMethod is RAZORPAY (or omitted,
    // since it defaults to RAZORPAY) — Joi's `is`/`then` reads the
    // sibling field via context, evaluated after defaults apply.
    paymentId: Joi.string()
      .min(10)
      .when("paymentMethod", {
        is: "WALLET",
        then: Joi.forbidden(),
        otherwise: Joi.required(),
      })
      .messages({
        "any.required":  "paymentId (razorpay_payment_id) is required",
        "string.min":    "paymentId must be at least 10 characters",
      }),

    orderId: Joi.string()
      .when("paymentMethod", {
        is: "WALLET",
        then: Joi.forbidden(),
        otherwise: Joi.required(),
      })
      .messages({ "any.required": "orderId (razorpay_order_id) is required" }),

    razorpaySignature: Joi.string()
      .when("paymentMethod", {
        is: "WALLET",
        then: Joi.forbidden(),
        otherwise: Joi.required(),
      })
      .messages({ "any.required": "razorpaySignature (razorpay_signature) is required" }),

  }).unknown(false),

  //////////////////////////////////////////////////////////
  // 3. CANCEL BOOKING
  // POST /v1/bookings/user/cancel
  //
  // Example body:
  // { "bookingId": "64a1b2c3d4e5f6a7b8c9d0e1" }
  //////////////////////////////////////////////////////////
  cancel: Joi.object({
    bookingId: objectId
      .required()
      .messages({ "any.required": "bookingId is required" }),

  }).unknown(false),

  //////////////////////////////////////////////////////////
  // 4. CHECK-IN
  // POST /v1/bookings/user/check-in
  //
  // ISSUE-2 FIX: OPTION-A chosen —
  // bookingId + otp both required.
  //
  // Why OPTION-A is better:
  //   Without bookingId, an OTP brute-force attempt only needs
  //   to try 9000 combinations against ALL CONFIRMED bookings.
  //   With bookingId, the attacker must know the specific
  //   booking AND its OTP — significantly harder.
  //   Also lets the controller do a tighter DB query:
  //   { _id: bookingId, checkInOtp: hashedOtp }
  //   instead of scanning all CONFIRMED bookings by OTP hash.
  //
  // Example body:
  // {
  //   "bookingId": "64a1b2c3d4e5f6a7b8c9d0e1",
  //   "otp":       "4827"
  // }
  //////////////////////////////////////////////////////////
  checkIn: Joi.object({
    bookingId: objectId
      .required()
      .messages({ "any.required": "bookingId is required" }),

    otp: otpField,

  }).unknown(false),

  //////////////////////////////////////////////////////////
  // 5. COMPLETE SERVICE
  // POST /v1/bookings/admin/complete
  //
  // Example body:
  // { "bookingId": "64a1b2c3d4e5f6a7b8c9d0e1" }
  //////////////////////////////////////////////////////////
  complete: Joi.object({
    bookingId: objectId
      .required()
      .messages({ "any.required": "bookingId is required" }),

  }).unknown(false),

  //////////////////////////////////////////////////////////
  // 6. START SERVICE
  // POST /v1/bookings/admin/start-service
  //
  // Separate schema (not reusing "complete") so the intent
  // is explicit — if start-service ever needs extra fields
  // (e.g. assignedStaffId) they can be added here independently.
  //
  // Example body:
  // { "bookingId": "64a1b2c3d4e5f6a7b8c9d0e1" }
  //////////////////////////////////////////////////////////
  startService: Joi.object({
    bookingId: objectId
      .required()
      .messages({ "any.required": "bookingId is required" }),

  }).unknown(false),

  //////////////////////////////////////////////////////////
  // 7. NO-SHOW
  // POST /v1/bookings/admin/no-show
  //
  // ISSUE-3 FIX: dedicated noShow schema added.
  // Previously the route used bookingSchemas.cancel as fallback.
  // Functionally identical now, but having a dedicated schema
  // lets you add noShow-specific fields later (e.g. reason)
  // without touching the cancel schema.
  //
  // Example body:
  // { "bookingId": "64a1b2c3d4e5f6a7b8c9d0e1" }
  //////////////////////////////////////////////////////////
  noShow: Joi.object({
    bookingId: objectId
      .required()
      .messages({ "any.required": "bookingId is required" }),
    }).unknown(false),

    forceComplete: Joi.object({
      bookingId: objectId
        .required()
        .messages({ "any.required": "bookingId is required" }),
      actualDurationMinutes: Joi.number()
        .integer()
        .min(5)
        .max(300)
        .required()
        .messages({
          "number.min": "Minimum 5 minutes",
          "number.max": "Maximum 300 minutes",
          "any.required": "actualDurationMinutes is required",
        }),
    }).unknown(false),
  
  };
