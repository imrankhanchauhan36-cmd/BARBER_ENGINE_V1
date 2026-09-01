/**
 * BARBER ENGINE V1
 * backend/utils/response.js
 */

const API_VERSION = process.env.API_VERSION || "v1";

// ─── SUCCESS ──────────────────────────────────────────────────────

export const successResponse = (res, {
  statusCode = 200,
  message    = "Success",
  data       = null,
  pagination = null,
  meta       = null,
} = {}) => {
  const body = {
    success:   true,
    version:   API_VERSION,
    requestId: res.req?.requestId ?? null,
    timestamp: new Date().toISOString(),
    message,
    data,
  };

  if (pagination) body.pagination = pagination;
  if (meta)       body.meta       = meta;

  return res.status(statusCode).json(body);
};

// ─── ERROR ────────────────────────────────────────────────────────

export const errorResponse = (res, {
  statusCode = 500,
  message    = "Something went wrong",
  errors     = null,
  code       = null,
  stack      = null,
  meta       = null,
} = {}) => {
  const body = {
    success:   false,
    version:   API_VERSION,
    requestId: res.req?.requestId ?? null,
    timestamp: new Date().toISOString(),
    message,
    code,
  };

  if (errors) body.errors = errors;
  if (meta)   body.meta   = meta;

  if (stack && process.env.NODE_ENV === "development") {
    body.stack = stack;
  }

  return res.status(statusCode).json(body);
};

// ─── APP ERROR ────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(message, statusCode = 500, code = null, errors = null) {
    super(message);
    this.statusCode    = statusCode;
    this.code          = code;
    this.errors        = errors;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

// ─── FACTORIES ────────────────────────────────────────────────────

export const Errors = Object.freeze({
  badRequest:   (msg = "Bad request", errors = null)       => new AppError(msg, 400, "BAD_REQUEST",      errors),
  unauthorized: (msg = "Unauthorized")                     => new AppError(msg, 401, "UNAUTHORIZED"),
  forbidden:    (msg = "Forbidden")                        => new AppError(msg, 403, "FORBIDDEN"),
  notFound:     (msg = "Not found")                        => new AppError(msg, 404, "NOT_FOUND"),
  conflict:     (msg = "Conflict", errors = null)          => new AppError(msg, 409, "CONFLICT",      errors),
  validation:   (msg = "Validation failed", errors = null) => new AppError(msg, 422, "VALIDATION_ERROR", errors),
  tooMany:      (msg = "Too many requests")                => new AppError(msg, 429, "RATE_LIMITED"),
  internal:     (msg = "Internal server error")            => new AppError(msg, 500, "SERVER_ERROR"),
});