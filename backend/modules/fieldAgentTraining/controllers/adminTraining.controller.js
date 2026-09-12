/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTraining/controllers/adminTraining.controller.js
 *
 * FA-3.3 — admin authoring + governance controllers. adminId is
 * always req.user._id (never client-supplied), matching the identity-
 * derivation convention used everywhere else in this codebase.
 */

import { successResponse, Errors } from "../../../utils/response.js";
import {
  createDraftVersion,
  listVersions,
  getVersionDetail,
  addModule,
  updateModule,
  addContent,
  updateContent,
  setContentMedia,
  deleteContent,
  publishVersion,
  retireVersion,
  listAgentProgress,
  getAgentProgressDetail,
  listAgentTrainingHistory,
  listAuditEvents,
} from "../services/trainingContent.service.js";
import { adminOverrideContentCompletion } from "../services/fieldAgentTraining.service.js";
import { uploadTrainingMedia } from "../services/mediaDelivery.service.js";

export const createDraftVersionHandler = async (req, res, next) => {
  try {
    const version = await createDraftVersion({ adminId: req.user._id, notes: req.body.notes });
    return successResponse(res, { statusCode: 201, message: "Draft training version created", data: { version } });
  } catch (err) {
    return next(err);
  }
};

export const listVersionsHandler = async (req, res, next) => {
  try {
    const versions = await listVersions({ page: req.query.page, limit: req.query.limit });
    return successResponse(res, { message: "Training versions fetched", data: { versions } });
  } catch (err) {
    return next(err);
  }
};

export const getVersionDetailHandler = async (req, res, next) => {
  try {
    const detail = await getVersionDetail(req.params.versionId);
    return successResponse(res, { message: "Training version detail fetched", data: detail });
  } catch (err) {
    return next(err);
  }
};

export const addModuleHandler = async (req, res, next) => {
  try {
    const trainingModule = await addModule({
      versionId: req.params.versionId,
      moduleKey: req.body.moduleKey,
      translations: req.body.translations,
      adminId: req.user._id,
    });
    return successResponse(res, { statusCode: 201, message: "Module created", data: { module: trainingModule } });
  } catch (err) {
    return next(err);
  }
};

export const updateModuleHandler = async (req, res, next) => {
  try {
    const trainingModule = await updateModule({
      moduleId: req.params.moduleId,
      translations: req.body.translations,
      adminId: req.user._id,
    });
    return successResponse(res, { message: "Module updated", data: { module: trainingModule } });
  } catch (err) {
    return next(err);
  }
};

export const addContentHandler = async (req, res, next) => {
  try {
    const content = await addContent({ moduleId: req.params.moduleId, ...req.body, adminId: req.user._id });
    return successResponse(res, { statusCode: 201, message: "Content created", data: { content } });
  } catch (err) {
    return next(err);
  }
};

export const updateContentHandler = async (req, res, next) => {
  try {
    const content = await updateContent({ contentId: req.params.contentId, patch: req.body, adminId: req.user._id });
    return successResponse(res, { message: "Content updated", data: { content } });
  } catch (err) {
    return next(err);
  }
};

export const deleteContentHandler = async (req, res, next) => {
  try {
    await deleteContent({ contentId: req.params.contentId, adminId: req.user._id });
    return successResponse(res, { message: "Content deleted" });
  } catch (err) {
    return next(err);
  }
};

export const uploadContentMediaHandler = async (req, res, next) => {
  try {
    if (!req.file) return next(Errors.badRequest("No media file uploaded"));

    const { publicId, resourceType } = await uploadTrainingMedia({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      contentId: req.params.contentId,
    });

    // FA-3.3.2.3 — setContentMedia is the single media mutation choke
    // point (replaces the old generic updateContent({patch:{media}})
    // call, which is now a hard 400 for exactly this reason).
    const content = await setContentMedia({
      contentId: req.params.contentId,
      media: { publicId, resourceType },
      adminId: req.user._id,
    });

    return successResponse(res, { message: "Media uploaded", data: { content } });
  } catch (err) {
    return next(err);
  }
};

export const removeContentMediaHandler = async (req, res, next) => {
  try {
    const content = await setContentMedia({ contentId: req.params.contentId, media: null, adminId: req.user._id });
    return successResponse(res, { message: "Media removed", data: { content } });
  } catch (err) {
    return next(err);
  }
};

export const publishVersionHandler = async (req, res, next) => {
  try {
    const version = await publishVersion({ versionId: req.params.versionId, adminId: req.user._id });
    // FA-3.3.2.1 — warnings (e.g. zero Help-eligible content) are
    // advisory only, never a publish failure; surfaced here as a
    // sibling response key, not part of `version`'s own serialization.
    return successResponse(res, {
      message: "Training version published",
      data: { version, warnings: version._warnings ?? [] },
    });
  } catch (err) {
    return next(err);
  }
};

export const retireVersionHandler = async (req, res, next) => {
  try {
    const version = await retireVersion({
      versionId: req.params.versionId,
      adminId: req.user._id,
      reason: req.body.reason,
    });
    return successResponse(res, { message: "Training version retired", data: { version } });
  } catch (err) {
    return next(err);
  }
};

export const listAgentProgressHandler = async (req, res, next) => {
  try {
    const progress = await listAgentProgress({ page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 20 });
    return successResponse(res, { message: "Field Agent training progress fetched", data: { progress } });
  } catch (err) {
    return next(err);
  }
};

export const getAgentProgressDetailHandler = async (req, res, next) => {
  try {
    const detail = await getAgentProgressDetail(req.params.agentUserId);
    return successResponse(res, { message: "Field Agent training detail fetched", data: { training: detail } });
  } catch (err) {
    return next(err);
  }
};

export const listAgentTrainingHistoryHandler = async (req, res, next) => {
  try {
    const history = await listAgentTrainingHistory(req.params.agentUserId);
    return successResponse(res, { message: "Field Agent training history fetched", data: { history } });
  } catch (err) {
    return next(err);
  }
};

export const listAuditEventsHandler = async (req, res, next) => {
  try {
    const events = await listAuditEvents({
      entityType: req.query.entityType,
      entityId: req.query.entityId,
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 50,
    });
    return successResponse(res, { message: "Training audit events fetched", data: { events } });
  } catch (err) {
    return next(err);
  }
};

export const overrideCompletionHandler = async (req, res, next) => {
  try {
    const enrollment = await adminOverrideContentCompletion({
      adminId: req.user._id,
      agentUserId: req.body.agentUserId,
      contentId: req.body.contentId,
      overrideClass: req.body.overrideClass,
      reason: req.body.reason,
    });
    return successResponse(res, { message: "Progress override applied", data: { training: enrollment } });
  } catch (err) {
    return next(err);
  }
};
