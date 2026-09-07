import Joi from "joi";
import { RATING_TYPE } from "../models/ServiceRating.js";

//////////////////////////////////////////////////////////////
// 🔥 SHARED PRIMITIVES — same convention as
// validators/professionalChairAssignment.validator.js
//////////////////////////////////////////////////////////////

const objectId = Joi.string().hex().length(24);

//////////////////////////////////////////////////////////////
// 🚀 RATING & REVIEW ENGINE VALIDATORS — Phase 2
//////////////////////////////////////////////////////////////

export const serviceRatingSchemas = {
  eligibleParams: Joi.object({
    bookingId: objectId.required(),
  }).unknown(false),

  submit: Joi.object({
    bookingId: objectId.required().messages({ "any.required": "bookingId is required" }),

    // One or many dimensions per request — Phase 1 Decision 4
    // (partial/resumable rating). The backend re-validates every
    // targetId against the actual booking; the client's job here is
    // only to say which dimension + how many stars (+ optional
    // review, meaningful only on SALON).
    ratings: Joi.array()
      .items(
        Joi.object({
          type: Joi.string().valid(...Object.values(RATING_TYPE)).required(),
          targetId: objectId.required(),
          stars: Joi.number().integer().min(1).max(5).required(),
          review: Joi.string().trim().max(500).allow("", null),
        }).unknown(false)
      )
      .min(1)
      .required()
      .messages({ "array.min": "At least one rating dimension is required" }),
  }).unknown(false),

  salonIdParam: Joi.object({
    salonId: objectId.required(),
  }).unknown(false),

  serviceIdParam: Joi.object({
    serviceId: objectId.required(),
  }).unknown(false),

  professionalIdParam: Joi.object({
    professionalId: objectId.required(),
  }).unknown(false),

  paginationQuery: Joi.object({
    cursor: Joi.string().optional(),
    limit: Joi.number().integer().min(1).max(50).default(20),
  }).unknown(false),

  hide: Joi.object({
    ratingId: objectId.required(),
    reason: Joi.string().trim().max(300).allow("", null),
  }).unknown(false),

  unhide: Joi.object({
    ratingId: objectId.required(),
  }).unknown(false),
};
