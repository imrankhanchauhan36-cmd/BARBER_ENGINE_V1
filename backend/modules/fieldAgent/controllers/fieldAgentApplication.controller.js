/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/fieldAgentApplication.controller.js
 *
 * FA-2 — thin controllers (DTO shaping only), matching the layering
 * already proven by modules/support/controllers/supportTicket.controller.js.
 * Business logic lives in fieldAgentApplication.service.js.
 *
 * Every handler derives identity exclusively from req.user._id (never
 * a client-supplied userRef) — matching the codebase's established
 * ownership-derivation convention. All errors flow through next(err)
 * into the globally-mounted errorHandler.js.
 */

import { successResponse } from "../../../utils/response.js";
import {
  createOrGetDraftApplication,
  getMyApplication,
  submitApplication,
  updateDraftApplication,
  withdrawApplication,
} from "../services/fieldAgentApplication.service.js";

export const getMyApplicationHandler = async (req, res, next) => {
  try {
    const application = await getMyApplication(req.user._id);
    return successResponse(res, {
      message: application ? "Application fetched successfully" : "No application found",
      data: { application },
    });
  } catch (err) {
    return next(err);
  }
};

export const createMyApplicationHandler = async (req, res, next) => {
  try {
    const { application, created } = await createOrGetDraftApplication({
      userId: req.user._id,
    });
    return successResponse(res, {
      statusCode: created ? 201 : 200,
      message: created ? "Application created successfully" : "Application already exists",
      data: { application },
    });
  } catch (err) {
    return next(err);
  }
};

export const updateMyDraftApplicationHandler = async (req, res, next) => {
  try {
    const application = await updateDraftApplication({
      userId: req.user._id,
      updates: req.body,
    });
    return successResponse(res, {
      message: "Application updated successfully",
      data: { application },
    });
  } catch (err) {
    return next(err);
  }
};

export const submitMyApplicationHandler = async (req, res, next) => {
  try {
    const application = await submitApplication({ userId: req.user._id });
    return successResponse(res, {
      message: "Application submitted successfully",
      data: { application },
    });
  } catch (err) {
    return next(err);
  }
};

export const withdrawMyApplicationHandler = async (req, res, next) => {
  try {
    const application = await withdrawApplication({
      userId: req.user._id,
      reason: req.body?.reason,
    });
    return successResponse(res, {
      message: "Application withdrawn successfully",
      data: { application },
    });
  } catch (err) {
    return next(err);
  }
};
