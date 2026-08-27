/**
 * BARBER ENGINE V1
 * backend/modules/support/controllers/supportTicket.controller.js
 *
 * Phase C — customer/salon-owner-facing ticket endpoints. Thin
 * controllers (DTO shaping only), matching ownerKyc.controller.js's
 * layering — business logic lives in supportTicket.service.js.
 *
 * Every handler derives identity exclusively from req.user._id/role
 * (never a client-supplied requesterRef/agentRef/ownerId/userId),
 * matching the codebase's established ownership-derivation
 * convention confirmed across customer.controller.js, payout.
 * controller.js, booking.controller.js, notification.controller.js.
 *
 * All errors flow through `next(err)` into the globally-mounted
 * errorHandler.js — no inline res.json({success:false,...}) anywhere.
 */

import { successResponse } from "../../../utils/response.js";
import {
  addCustomerMessage,
  createTicket,
  getMyTicketDetail,
  listActiveCategories,
  listMyTickets,
  reopenTicket,
} from "../services/supportTicket.service.js";

// Phase S.1 — read-only, no req.query/req.body inputs at all: every
// authenticated USER/OWNER sees the exact same admin-curated list,
// matching createTicket()'s own unscoped categoryRef validation.
export const listCategoriesHandler = async (req, res, next) => {
  try {
    const categories = await listActiveCategories();

    return successResponse(res, {
      message: "Categories fetched successfully",
      data: { categories },
    });
  } catch (err) {
    return next(err);
  }
};

export const createMyTicket = async (req, res, next) => {
  try {
    const requesterId = req.user._id;
    const role = req.user.role;

    const ticket = await createTicket({
      requesterId,
      role,
      categoryRef: req.body.categoryRef,
      subject: req.body.subject,
      body: req.body.body,
      priority: req.body.priority,
      language: req.body.language,
      relatedSalonRef: req.body.relatedSalonRef,
      relatedBookingRef: req.body.relatedBookingRef,
      io: req.app.get("io"),
    });

    return successResponse(res, {
      statusCode: 201,
      message: "Ticket created successfully",
      data: { ticket },
    });
  } catch (err) {
    return next(err);
  }
};

export const listMyTicketsHandler = async (req, res, next) => {
  try {
    const requesterId = req.user._id;
    const { docs, meta } = await listMyTickets({ requesterId, query: req.query });

    return successResponse(res, {
      message: "Tickets fetched successfully",
      data: { tickets: docs },
      pagination: meta,
    });
  } catch (err) {
    return next(err);
  }
};

export const getMyTicketHandler = async (req, res, next) => {
  try {
    const requesterId = req.user._id;
    const { ticket, messages, messagesPagination } = await getMyTicketDetail({
      requesterId,
      ticketId: req.params.id,
      query: req.query,
    });

    return successResponse(res, {
      message: "Ticket fetched successfully",
      data: { ticket, messages },
      pagination: messagesPagination,
    });
  } catch (err) {
    return next(err);
  }
};

export const addMyTicketMessage = async (req, res, next) => {
  try {
    const requesterId = req.user._id;
    const message = await addCustomerMessage({
      requesterId,
      ticketId: req.params.id,
      body: req.body.body,
      attachments: req.body.attachments,
      io: req.app.get("io"),
    });

    return successResponse(res, {
      statusCode: 201,
      message: "Reply added successfully",
      data: { message },
    });
  } catch (err) {
    return next(err);
  }
};

export const reopenMyTicket = async (req, res, next) => {
  try {
    const requesterId = req.user._id;
    const ticket = await reopenTicket({
      requesterId,
      ticketId: req.params.id,
      reason: req.body.reason,
      io: req.app.get("io"),
    });

    return successResponse(res, {
      message: "Ticket reopened successfully",
      data: { ticket },
    });
  } catch (err) {
    return next(err);
  }
};
