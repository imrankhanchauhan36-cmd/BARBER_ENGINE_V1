/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTest/controllers/adminTest.controller.js
 *
 * FA-3.4.1 — admin authoring + governance controllers. adminId is
 * always req.user._id (never client-supplied), matching the identity-
 * derivation convention used everywhere else in this codebase.
 */

import { successResponse } from "../../../utils/response.js";
import {
  createDraftVersion,
  listVersions,
  getVersionDetail,
  updateDraftVersion,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  reorderQuestions,
  publishVersion,
  retireVersion,
  discardDraftVersion,
} from "../services/testContent.service.js";

export const createDraftVersionHandler = async (req, res, next) => {
  try {
    const version = await createDraftVersion({ adminId: req.user._id, ...req.body });
    return successResponse(res, { statusCode: 201, message: "Draft test version created", data: { version } });
  } catch (err) {
    return next(err);
  }
};

export const listVersionsHandler = async (req, res, next) => {
  try {
    const versions = await listVersions({ page: req.query.page, limit: req.query.limit });
    return successResponse(res, { message: "Test versions fetched", data: { versions } });
  } catch (err) {
    return next(err);
  }
};

export const getVersionDetailHandler = async (req, res, next) => {
  try {
    const detail = await getVersionDetail(req.params.versionId);
    return successResponse(res, { message: "Test version detail fetched", data: detail });
  } catch (err) {
    return next(err);
  }
};

export const updateDraftVersionHandler = async (req, res, next) => {
  try {
    const version = await updateDraftVersion({ versionId: req.params.versionId, adminId: req.user._id, ...req.body });
    return successResponse(res, { message: "Draft test version updated", data: { version } });
  } catch (err) {
    return next(err);
  }
};

export const addQuestionHandler = async (req, res, next) => {
  try {
    const question = await addQuestion({
      versionId: req.params.versionId,
      translations: req.body.translations,
      grading: req.body.grading,
      adminId: req.user._id,
    });
    return successResponse(res, { statusCode: 201, message: "Question created", data: { question } });
  } catch (err) {
    return next(err);
  }
};

export const updateQuestionHandler = async (req, res, next) => {
  try {
    const question = await updateQuestion({ questionId: req.params.questionId, patch: req.body, adminId: req.user._id });
    return successResponse(res, { message: "Question updated", data: { question } });
  } catch (err) {
    return next(err);
  }
};

export const deleteQuestionHandler = async (req, res, next) => {
  try {
    await deleteQuestion({ questionId: req.params.questionId, adminId: req.user._id });
    return successResponse(res, { message: "Question deleted" });
  } catch (err) {
    return next(err);
  }
};

export const reorderQuestionsHandler = async (req, res, next) => {
  try {
    const questions = await reorderQuestions({
      versionId: req.params.versionId,
      orderedQuestionIds: req.body.orderedQuestionIds,
      adminId: req.user._id,
    });
    return successResponse(res, { message: "Questions reordered", data: { questions } });
  } catch (err) {
    return next(err);
  }
};

export const publishVersionHandler = async (req, res, next) => {
  try {
    const version = await publishVersion({ versionId: req.params.versionId, adminId: req.user._id });
    return successResponse(res, { message: "Test version published", data: { version } });
  } catch (err) {
    return next(err);
  }
};

export const retireVersionHandler = async (req, res, next) => {
  try {
    const version = await retireVersion({ versionId: req.params.versionId, adminId: req.user._id, reason: req.body.reason });
    return successResponse(res, { message: "Test version retired", data: { version } });
  } catch (err) {
    return next(err);
  }
};

export const discardDraftVersionHandler = async (req, res, next) => {
  try {
    const result = await discardDraftVersion({ versionId: req.params.versionId, adminId: req.user._id });
    return successResponse(res, { message: "Draft test version discarded", data: result });
  } catch (err) {
    return next(err);
  }
};
