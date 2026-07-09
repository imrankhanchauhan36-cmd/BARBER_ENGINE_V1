/**
 * BARBER ENGINE V1
 * backend/utils/validate.js
 * Centralized Joi Validation Layer
 */

import Joi from "joi";
import { Errors } from "./response.js";

// ─── validate middleware factory ──────────────────────────────────
// Usage: router.post("/login", validate(schemas.adminLogin), controller)

export const validate = (schema, source = "body") => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly:   false,  // collect ALL errors, not just first
      stripUnknown: true,   // remove fields not in schema
      allowUnknown: false,
    });

    if (error) {
      const errors = Object.fromEntries(
        error.details.map((d) => [
          d.context?.key ?? d.path.join("."),
          d.message.replace(/['"]/g, ""),
        ])
      );
      return next(Errors.validation("Validation failed", errors));
    }

    req[source] = value; // replace with sanitized value
    next();
  };
};

// ─── Common field rules ───────────────────────────────────────────

const fields = {
  email:         Joi.string().email().lowercase().trim(),
  password:      Joi.string().min(8).max(64),
  phone:         Joi.string().pattern(/^[6-9]\d{9}$/).message("Invalid Indian phone number"),
  name:          Joi.string().min(2).max(100).trim(),
  adminKey:      Joi.string().min(8).max(128),
  mongoId:       Joi.string().pattern(/^[a-f\d]{24}$/i).message("Invalid ID"),
  page:          Joi.number().integer().min(1).default(1),
  limit:         Joi.number().integer().min(1).max(100).default(20),
  status:        Joi.string().valid("ACTIVE", "SUSPENDED", "BLOCKED"),
  adminLevel:    Joi.string().valid("INDIA", "STATE", "DISTRICT"),
};

// ─── Schemas ──────────────────────────────────────────────────────

export const schemas = {

  // Auth
  adminLogin: Joi.object({
    email:    fields.email.required(),
    password: fields.password.required(),
    adminKey: fields.adminKey.optional(),
  }),

  // Pagination + search query params
  listQuery: Joi.object({
    page:      fields.page,
    limit:     fields.limit,
    search:    Joi.string().max(100).trim().optional(),
    status:    fields.status.optional(),
    sortBy:    Joi.string().max(50).optional(),
    sortOrder: Joi.string().valid("asc", "desc").default("desc"),
    from:      Joi.date().iso().optional(),
    to:        Joi.date().iso().optional(),
  }),

  // Salon status update
  updateSalonStatus: Joi.object({
    status: Joi.string().valid("ACTIVE", "SUSPENDED", "CLOSED", "PENDING").required(),
    reason: Joi.string().max(500).optional(),
  }),

  // Create state
  createState: Joi.object({
    name:          fields.name.required(),
    code:          Joi.string().uppercase().min(2).max(5).required(),
    adminName:     fields.name.required(),
    adminEmail:    fields.email.required(),
    adminPhone:    fields.phone.required(),
    adminPassword: fields.password.required(),
  }),

  // Create district
  createDistrict: Joi.object({
    name:          fields.name.required(),
    stateRef:      fields.mongoId.required(),
    adminName:     fields.name.required(),
    adminEmail:    fields.email.required(),
    adminPhone:    fields.phone.required(),
    adminPassword: fields.password.required(),
  }),

  // Mongo ID param — validate :id in route
  mongoIdParam: Joi.object({
    id: fields.mongoId.required(),
  }),
};