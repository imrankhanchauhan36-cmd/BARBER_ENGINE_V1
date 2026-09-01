import Joi from "joi";

//////////////////////////////////////////////////////////////
// 🔥 SHARED PRIMITIVES
//////////////////////////////////////////////////////////////

/** MongoDB ObjectId — 24-char hex string */
const objectId = Joi.string().hex().length(24);

/** Indian mobile number — same pattern already enforced by models/Staff.js */
const phoneField = Joi.string()
  .pattern(/^[6-9]\d{9}$/)
  .messages({ "string.pattern.base": "phone must be a valid 10-digit Indian mobile number" });

//////////////////////////////////////////////////////////////
// 🚀 PROFESSIONAL VALIDATORS (Phase 1 — foundation only)
//////////////////////////////////////////////////////////////

export const professionalSchemas = {

  //////////////////////////////////////////////////////////
  // 1. CREATE
  // POST /api/salon/owner/professionals
  //////////////////////////////////////////////////////////
  create: Joi.object({
    name: Joi.string().trim().max(100).required()
      .messages({ "any.required": "name is required" }),

    phone: phoneField.allow(null, ""),

    role: Joi.string().valid("BARBER", "HELPER", "MANAGER").default("BARBER"),

    profession: Joi.string().trim().max(60).allow(null, ""),

    photo: Joi.string().uri().allow(null, ""),

    experienceYears: Joi.number().min(0).max(80).allow(null),

    languages: Joi.array().items(Joi.string().trim().max(30)).default([]),

    bio: Joi.string().trim().max(500).allow(null, ""),

    skills: Joi.array().items(objectId).default([]),
  }).unknown(false),

  //////////////////////////////////////////////////////////
  // 2. LIST
  // GET /api/salon/owner/professionals?page=&limit=&status=
  //////////////////////////////////////////////////////////
  list: Joi.object({
    page:      Joi.number().integer().min(1).default(1),
    limit:     Joi.number().integer().min(1).max(100).default(20),
    status:    Joi.string().valid("ACTIVE", "INACTIVE", "ALL").default("ALL"),
    // Phase 2 — service eligibility filter. Read-only; does not touch
    // Chair/Slot/Booking. "Which active professionals can perform
    // this service" — the exact query future Chair Assignment/Slot
    // Integration phases will need, without building any of that
    // logic now.
    serviceId: objectId,
  }).unknown(false),

  //////////////////////////////////////////////////////////
  // 3. PROFESSIONAL ID (params) — get / update / status
  //////////////////////////////////////////////////////////
  professionalId: Joi.object({
    id: objectId.required().messages({ "any.required": "professional id is required" }),
  }).unknown(false),

  //////////////////////////////////////////////////////////
  // 4. UPDATE (partial)
  // PATCH /api/salon/owner/professionals/:id
  //////////////////////////////////////////////////////////
  update: Joi.object({
    name:            Joi.string().trim().max(100),
    phone:           phoneField.allow(null, ""),
    role:            Joi.string().valid("BARBER", "HELPER", "MANAGER"),
    profession:      Joi.string().trim().max(60).allow(null, ""),
    photo:           Joi.string().uri().allow(null, ""),
    experienceYears: Joi.number().min(0).max(80).allow(null),
    languages:       Joi.array().items(Joi.string().trim().max(30)),
    bio:             Joi.string().trim().max(500).allow(null, ""),
    skills:          Joi.array().items(objectId),
  })
    .unknown(false)
    .min(1)
    .messages({ "object.min": "At least one field is required to update" }),

  //////////////////////////////////////////////////////////
  // 5. STATUS (activate/deactivate — never a hard delete)
  // PATCH /api/salon/owner/professionals/:id/status
  //////////////////////////////////////////////////////////
  setStatus: Joi.object({
    isActive: Joi.boolean().required()
      .messages({ "any.required": "isActive is required" }),
    reason: Joi.string().trim().max(300).allow(null, ""),
  }).unknown(false),

};
