/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTraining/controllers/fieldAgentTraining.controller.js
 *
 * FA-3.3 — thin controllers (DTO shaping only), matching the exact
 * layering already proven by
 * modules/fieldAgent/controllers/fieldAgentApplication.controller.js.
 * Identity is always req.user._id — never a client-supplied agent id.
 */

import { successResponse } from "../../../utils/response.js";
import {
  getMyTrainingOverview,
  getModuleContent,
  recordLessonProgress,
  submitGradedContent,
  getMediaAccessUrl,
} from "../services/fieldAgentTraining.service.js";

export const getMyTrainingOverviewHandler = async (req, res, next) => {
  try {
    const overview = await getMyTrainingOverview(req.user._id, req.query.lang);
    return successResponse(res, { message: "Training overview fetched successfully", data: { training: overview } });
  } catch (err) {
    return next(err);
  }
};

export const getModuleContentHandler = async (req, res, next) => {
  try {
    const moduleContent = await getModuleContent(req.user._id, req.params.moduleKey, req.query.lang);
    return successResponse(res, { message: "Module content fetched successfully", data: moduleContent });
  } catch (err) {
    return next(err);
  }
};

export const recordLessonProgressHandler = async (req, res, next) => {
  try {
    const result = await recordLessonProgress({
      userId: req.user._id,
      contentId: req.params.contentId,
      watchedSeconds: req.body.watchedSeconds,
    });
    return successResponse(res, {
      message: result.completed ? "Content marked complete" : "Progress recorded",
      data: { completed: result.completed, training: { status: result.enrollment.status } },
    });
  } catch (err) {
    return next(err);
  }
};

export const submitGradedContentHandler = async (req, res, next) => {
  try {
    const result = await submitGradedContent({
      userId: req.user._id,
      contentId: req.params.contentId,
      submission: req.body,
    });
    return successResponse(res, {
      message: result.passed ? "Submission passed" : "Submission did not pass — you may retry",
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};

export const getMediaAccessUrlHandler = async (req, res, next) => {
  try {
    const media = await getMediaAccessUrl(req.user._id, req.params.contentId);
    return successResponse(res, { message: "Signed media URL issued", data: media });
  } catch (err) {
    return next(err);
  }
};
