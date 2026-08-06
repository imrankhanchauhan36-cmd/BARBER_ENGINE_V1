/**
 * BARBER ENGINE V1
 * backend/middlewares/errorHandler.js
 *
 * Central Express error middleware.
 * Handles: AppError, Joi, Mongoose, JWT, unknown crashes.
 */

import mongoose from "mongoose";
import logger from "../utils/logger.js";
import { AppError, errorResponse } from "../utils/response.js";


export const errorHandler = (err, req, res, next) => {

  // ── Safety: response already sent ───────────────────────────────
  if (res.headersSent) return next(err);

  // ── Log context (console.error — Winston Step 3 me replace hoga) ─
  const logCtx = {
    requestId: req.requestId ?? null,
    method:    req.method,
    url:       req.originalUrl,
    userId:    req.user?._id ?? null,
    error:     err.message,
    stack:     err.stack,
  };

  if (!(err instanceof AppError)) {
    // Unknown crash — always log
    logger.error(logCtx);
  } else if (process.env.NODE_ENV === "development") {
    // Operational — log only in dev
    logger.error(logCtx);
  }

  // ── 1. Mongoose Validation ───────────────────────────────────────
  if (err instanceof mongoose.Error.ValidationError) {
    const errors = Object.fromEntries(
      Object.entries(err.errors).map(([field, e]) => [field, e.message])
    );
    return errorResponse(res, {
      statusCode: 422,
      message:    "Validation failed",
      code:       "VALIDATION_ERROR",
      errors,
    });
  }

  // ── 2. Mongoose Duplicate Key ────────────────────────────────────
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern ?? {})[0] ?? "field";
    return errorResponse(res, {
      statusCode: 409,
      message:    `${field} already exists`,
      code:       "CONFLICT",
    });
  }

  // ── 2b. MongoDB Transient Transaction / Write Conflict ───────────
  // Two concurrent transactions racing on the same document (e.g.
  // two simultaneous withdrawal requests both writing the same
  // SalonEarnings doc inside WalletBalanceService.hold()) — the
  // storage engine correctly aborts the losing transaction rather
  // than corrupting data (code 112 "WriteConflict", labeled
  // "TransientTransactionError" by the driver). Same underlying
  // class of error as the duplicate-key case above, different
  // MongoDB-level shape — must not leak the raw driver error to the
  // client. Same detection already used locally in
  // booking.controller.js (lockSlot/cancelBooking); centralized here
  // so every next(err) caller gets it for free.
  if (typeof err.hasErrorLabel === "function" && err.hasErrorLabel("TransientTransactionError")) {
    return errorResponse(res, {
      statusCode: 409,
      message:    "This request conflicted with another in-flight operation. Please try again.",
      code:       "CONFLICT",
    });
  }

  // ── 3. Mongoose Cast Error ───────────────────────────────────────
  if (err instanceof mongoose.Error.CastError) {
    return errorResponse(res, {
      statusCode: 400,
      message:    `Invalid value for ${err.path}`,
      code:       "BAD_REQUEST",
    });
  }

  // ── 4. JWT Errors ────────────────────────────────────────────────
  if (err.name === "JsonWebTokenError") {
    return errorResponse(res, {
      statusCode: 401,
      message:    "Invalid token",
      code:       "UNAUTHORIZED",
    });
  }

  if (err.name === "TokenExpiredError") {
    return errorResponse(res, {
      statusCode: 401,
      message:    "Token expired",
      code:       "TOKEN_EXPIRED",
    });
  }

  // ── 5. Joi Validation ────────────────────────────────────────────
  if (err.isJoi) {
    const errors = Object.fromEntries(
      err.details.map((d) => [d.context?.key ?? "field", d.message])
    );
    return errorResponse(res, {
      statusCode: 422,
      message:    "Validation failed",
      code:       "VALIDATION_ERROR",
      errors,
    });
  }

  // ── 6. Operational AppError ──────────────────────────────────────
  if (err instanceof AppError) {
    return errorResponse(res, {
      statusCode: err.statusCode,
      message:    err.message,
      code:       err.code,
      errors:     err.errors,
      stack:      err.stack,
    });
  }

  // ── 7. Unknown Crash ─────────────────────────────────────────────
  return errorResponse(res, {
    statusCode: 500,
    message:    "Internal server error",
    code:       "SERVER_ERROR",
  });
};