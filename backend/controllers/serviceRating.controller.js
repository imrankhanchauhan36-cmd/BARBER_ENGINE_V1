//////////////////////////////////////////////////////////////
// RATING & REVIEW ENGINE — CUSTOMER-FACING CONTROLLER (Phase 2)
//
// Thin HTTP layer only — business logic lives in
// services/ratingEligibility.service.js and
// services/ratingSubmission.service.js. Mirrors
// controllers/professionalChairAssignment.controller.js's pattern.
//////////////////////////////////////////////////////////////

import mongoose from "mongoose";

import ServiceRating, { RATING_TYPE } from "../models/ServiceRating.js";
import Service from "../models/Service.js";
import Staff from "../models/Staff.js";
import User from "../models/User.js";
import { getRatingEligibility } from "../services/ratingEligibility.service.js";
import { submitRatings } from "../services/ratingSubmission.service.js";
import {
  getSalonSummary,
  getServiceSummary,
  getProfessionalSummary,
} from "../services/ratingAggregate.service.js";
import {
  toEligibilityDTO,
  toSubmissionResultDTO,
  toReviewListItemDTO,
  toMyRatingDTO,
  toSummaryDTO,
} from "../dto/serviceRating.dto.js";
import { successResponse, Errors } from "../utils/response.js";

const REASON_STATUS = {
  BOOKING_NOT_FOUND: 404,
  NOT_BOOKING_OWNER: 403,
  BOOKING_NOT_COMPLETED: 400,
};

const REASON_MESSAGE = {
  BOOKING_NOT_FOUND: "Booking not found",
  NOT_BOOKING_OWNER: "This booking does not belong to you",
  BOOKING_NOT_COMPLETED: "Booking is not eligible for rating",
};

///////////////////////////////////////////////////////////
// R3.3-C: shared reviewer-name enrichment for public review-list
// endpoints (salon/service/professional) — one batched User lookup
// per page, never one query per row.
///////////////////////////////////////////////////////////
async function enrichReviewRows(rows) {
  const distinctCustomerIds = [...new Set(rows.map((r) => r.customerId.toString()))];
  const users = await User.find({ _id: { $in: distinctCustomerIds } }).select("name").lean();
  const nameById = new Map(users.map((u) => [u._id.toString(), u.name]));
  return rows.map((row) => toReviewListItemDTO(row, nameById));
}

///////////////////////////////////////////////////////////
// GET /api/ratings/eligible/:bookingId
///////////////////////////////////////////////////////////
export const getEligibilityHandler = async (req, res) => {
  const customerId = req.user?._id;
  if (!customerId) throw Errors.unauthorized("Authentication required");

  const result = await getRatingEligibility({ bookingId: req.params.bookingId, customerId });

  if (!result.ok) {
    const status = REASON_STATUS[result.reason] || 400;
    const message = REASON_MESSAGE[result.reason] || "Unable to resolve rating eligibility";
    if (status === 404) throw Errors.notFound(message);
    if (status === 403) throw Errors.forbidden(message);
    throw Errors.badRequest(message);
  }

  return successResponse(res, {
    message: "Rating eligibility resolved",
    data: toEligibilityDTO(result),
  });
};

///////////////////////////////////////////////////////////
// POST /api/ratings
///////////////////////////////////////////////////////////
export const submitRatingsHandler = async (req, res) => {
  const customerId = req.user?._id;
  if (!customerId) throw Errors.unauthorized("Authentication required");

  const { bookingId, ratings } = req.body;

  const result = await submitRatings({ bookingId, customerId, ratings });

  if (!result.success) {
    const status = result.status || 400;
    if (status === 404) throw Errors.notFound(result.message);
    if (status === 403) throw Errors.forbidden(result.message);
    throw Errors.badRequest(result.message);
  }

  return successResponse(res, {
    statusCode: 201,
    message: "Rating submission processed",
    data: { results: toSubmissionResultDTO(result.results) },
  });
};

///////////////////////////////////////////////////////////
// GET /api/ratings/my
///////////////////////////////////////////////////////////
export const getMyRatingsHandler = async (req, res) => {
  const customerId = req.user?._id;
  if (!customerId) throw Errors.unauthorized("Authentication required");

  const { cursor, limit } = req.query;
  const filter = { customerId };
  if (cursor && mongoose.isValidObjectId(cursor)) {
    filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
  }

  const rows = await ServiceRating.find(filter)
    .sort({ _id: -1 })
    .limit(limit)
    .lean();

  return successResponse(res, {
    message: "Your ratings fetched",
    data: {
      items: rows.map(toMyRatingDTO),
      nextCursor: rows.length === limit ? rows[rows.length - 1]._id.toString() : null,
    },
  });
};

///////////////////////////////////////////////////////////
// GET /api/ratings/salon/:salonId  — public paginated review list
// (SALON-type rows only — the "overall experience" reviews, the
// only dimension that ever carries written text — see Decision 2)
///////////////////////////////////////////////////////////
export const getSalonReviewsHandler = async (req, res) => {
  const { salonId } = req.params;
  const { cursor, limit } = req.query;

  const filter = { salonId, type: RATING_TYPE.SALON, isHidden: false };
  if (cursor && mongoose.isValidObjectId(cursor)) {
    filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
  }

  const rows = await ServiceRating.find(filter)
    .sort({ _id: -1 })
    .limit(limit)
    .lean();

  return successResponse(res, {
    message: "Salon reviews fetched",
    data: {
      items: await enrichReviewRows(rows),
      nextCursor: rows.length === limit ? rows[rows.length - 1]._id.toString() : null,
    },
  });
};

///////////////////////////////////////////////////////////
// GET /api/ratings/salon/:salonId/summary
///////////////////////////////////////////////////////////
export const getSalonSummaryHandler = async (req, res) => {
  const summary = await getSalonSummary(req.params.salonId);
  return successResponse(res, { message: "Salon rating summary fetched", data: toSummaryDTO(summary) });
};

///////////////////////////////////////////////////////////
// GET /api/ratings/service/:serviceId/summary
///////////////////////////////////////////////////////////
export const getServiceSummaryHandler = async (req, res) => {
  const { serviceId } = req.params;

  const service = await Service.findById(serviceId).select("salonId").lean();
  if (!service) throw Errors.notFound("Service not found");

  const summary = await getServiceSummary({ salonId: service.salonId, serviceId });
  return successResponse(res, { message: "Service rating summary fetched", data: toSummaryDTO(summary) });
};

///////////////////////////////////////////////////////////
// GET /api/ratings/service/:serviceId  — public paginated review list
// (SERVICE-type rows only). salonId is never trusted from the
// client — it is derived from the authoritative Service document,
// exactly like getServiceSummaryHandler above.
///////////////////////////////////////////////////////////
export const getServiceReviewsHandler = async (req, res) => {
  const { serviceId } = req.params;
  const { cursor, limit } = req.query;

  const service = await Service.findById(serviceId).select("name salonId").lean();
  if (!service) throw Errors.notFound("Service not found");

  const filter = { salonId: service.salonId, type: RATING_TYPE.SERVICE, targetId: service._id, isHidden: false };
  if (cursor && mongoose.isValidObjectId(cursor)) {
    filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
  }

  const rows = await ServiceRating.find(filter)
    .sort({ _id: -1 })
    .limit(limit)
    .lean();

  return successResponse(res, {
    message: "Service reviews fetched",
    data: {
      items: await enrichReviewRows(rows),
      nextCursor: rows.length === limit ? rows[rows.length - 1]._id.toString() : null,
    },
  });
};

///////////////////////////////////////////////////////////
// GET /api/ratings/professional/:professionalId/summary
///////////////////////////////////////////////////////////
export const getProfessionalSummaryHandler = async (req, res) => {
  const { professionalId } = req.params;

  const professional = await Staff.findById(professionalId).select("salonId").lean();
  if (!professional) throw Errors.notFound("Professional not found");

  const summary = await getProfessionalSummary({ salonId: professional.salonId, professionalId });
  return successResponse(res, { message: "Professional rating summary fetched", data: toSummaryDTO(summary) });
};

///////////////////////////////////////////////////////////
// GET /api/ratings/professional/:professionalId  — public paginated
// review list (PROFESSIONAL-type rows only). salonId is never trusted
// from the client — derived from the authoritative Staff document,
// exactly like getProfessionalSummaryHandler above.
///////////////////////////////////////////////////////////
export const getProfessionalReviewsHandler = async (req, res) => {
  const { professionalId } = req.params;
  const { cursor, limit } = req.query;

  const professional = await Staff.findById(professionalId).select("name photo salonId").lean();
  if (!professional) throw Errors.notFound("Professional not found");

  const filter = { salonId: professional.salonId, type: RATING_TYPE.PROFESSIONAL, targetId: professional._id, isHidden: false };
  if (cursor && mongoose.isValidObjectId(cursor)) {
    filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
  }

  const rows = await ServiceRating.find(filter)
    .sort({ _id: -1 })
    .limit(limit)
    .lean();

  return successResponse(res, {
    message: "Professional reviews fetched",
    data: {
      items: await enrichReviewRows(rows),
      nextCursor: rows.length === limit ? rows[rows.length - 1]._id.toString() : null,
    },
  });
};
