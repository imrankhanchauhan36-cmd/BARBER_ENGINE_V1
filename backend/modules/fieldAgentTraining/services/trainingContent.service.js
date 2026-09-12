/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTraining/services/trainingContent.service.js
 *
 * FA-3.3 — admin authoring + curriculum governance: draft version
 * creation, module/content CRUD (DRAFT versions only — mutation of a
 * PUBLISHED version's modules/content is refused here, not merely
 * discouraged), publish/retire, and read-only agent-progress/audit
 * inspection for admin tooling.
 */

import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import TrainingVersion from "../models/TrainingVersion.js";
import TrainingModule from "../models/TrainingModule.js";
import TrainingContent from "../models/TrainingContent.js";
import FieldAgentTraining from "../models/FieldAgentTraining.js";
import TrainingAuditEvent from "../models/TrainingAuditEvent.js";
import {
  TRAINING_VERSION_STATUS,
  MODULE_KEY,
  MODULE_KEY_ORDER,
  CONTENT_TYPE,
  TRAINING_AUDIT_ACTOR_TYPE,
  TRAINING_AUDIT_ACTION,
  TRAINING_AUDIT_ENTITY_TYPE,
} from "../constants/fieldAgentTraining.constants.js";

const GRADED_TYPES = [CONTENT_TYPE.KNOWLEDGE_CHECK, CONTENT_TYPE.PRACTICAL_SCENARIO];

const writeAudit = (fields, opts = {}) => TrainingAuditEvent.create([fields], opts).catch((err) => {
  console.error("❌ FA-3.3 TrainingAuditEvent write failed:", err.message || err);
});

const getVersionOrThrow = async (versionId) => {
  const version = await TrainingVersion.findById(versionId);
  if (!version) throw Errors.notFound("Training version not found");
  return version;
};

const assertDraft = (version) => {
  if (version.status !== TRAINING_VERSION_STATUS.DRAFT) {
    throw Errors.conflict(`Version ${version.versionNumber} is ${version.status}, not DRAFT — it is immutable`);
  }
};

// ─── VERSIONS ─────────────────────────────────────────────────────

export const createDraftVersion = async ({ adminId, notes }) => {
  const last = await TrainingVersion.findOne().sort({ versionNumber: -1 }).select("versionNumber").lean();
  const versionNumber = (last?.versionNumber ?? 0) + 1;

  const version = await TrainingVersion.create({ versionNumber, notes: notes ?? null, createdBy: adminId });

  await writeAudit({
    entityType: TRAINING_AUDIT_ENTITY_TYPE.TRAINING_VERSION,
    entityId: version._id,
    actorRef: adminId,
    actorType: TRAINING_AUDIT_ACTOR_TYPE.ADMIN,
    action: TRAINING_AUDIT_ACTION.VERSION_CREATED,
    newValue: { versionNumber },
  });

  return version;
};

export const listVersions = () => TrainingVersion.find().sort({ versionNumber: -1 }).lean();

export const getVersionDetail = async (versionId) => {
  const version = await getVersionOrThrow(versionId);
  const modules = await TrainingModule.find({ trainingVersion: versionId }).sort({ order: 1 }).lean();
  const content = await TrainingContent.find({ trainingVersion: versionId })
    .select("+grading")
    .sort({ order: 1 })
    .lean();

  const contentByModule = new Map();
  for (const c of content) {
    const key = String(c.trainingModule);
    if (!contentByModule.has(key)) contentByModule.set(key, []);
    contentByModule.get(key).push(c);
  }

  return {
    version,
    modules: modules.map((m) => ({ ...m, content: contentByModule.get(String(m._id)) ?? [] })),
  };
};

// ─── MODULES (DRAFT versions only) ────────────────────────────────

export const addModule = async ({ versionId, moduleKey, translations, adminId }) => {
  const version = await getVersionOrThrow(versionId);
  assertDraft(version);

  if (!Object.values(MODULE_KEY).includes(moduleKey)) {
    throw Errors.badRequest(`Unknown moduleKey: ${moduleKey}`);
  }
  const order = MODULE_KEY_ORDER.indexOf(moduleKey);

  let trainingModule;
  try {
    trainingModule = await TrainingModule.create({
      trainingVersion: versionId,
      moduleKey,
      order,
      translations: translations ?? [],
    });
  } catch (err) {
    if (err.code === 11000) {
      throw Errors.conflict(`Module ${moduleKey} already exists in version ${version.versionNumber}`);
    }
    throw err;
  }

  await writeAudit({
    entityType: TRAINING_AUDIT_ENTITY_TYPE.TRAINING_MODULE,
    entityId: trainingModule._id,
    actorRef: adminId,
    actorType: TRAINING_AUDIT_ACTOR_TYPE.ADMIN,
    action: TRAINING_AUDIT_ACTION.MODULE_CREATED,
    newValue: { moduleKey, order },
  });

  return trainingModule;
};

export const updateModule = async ({ moduleId, translations, adminId }) => {
  const trainingModule = await TrainingModule.findById(moduleId);
  if (!trainingModule) throw Errors.notFound("Training module not found");

  const version = await getVersionOrThrow(trainingModule.trainingVersion);
  assertDraft(version);

  const oldValue = { translations: trainingModule.translations };
  trainingModule.translations = translations ?? trainingModule.translations;
  await trainingModule.save();

  await writeAudit({
    entityType: TRAINING_AUDIT_ENTITY_TYPE.TRAINING_MODULE,
    entityId: trainingModule._id,
    actorRef: adminId,
    actorType: TRAINING_AUDIT_ACTOR_TYPE.ADMIN,
    action: TRAINING_AUDIT_ACTION.MODULE_UPDATED,
    oldValue,
    newValue: { translations: trainingModule.translations },
  });

  return trainingModule;
};

// ─── CONTENT (DRAFT versions only) ────────────────────────────────

export const addContent = async ({
  moduleId,
  contentType,
  translations,
  media,
  watchThresholdSeconds,
  grading,
  passingScore,
  required,
  helpEligible,
  adminId,
}) => {
  const trainingModule = await TrainingModule.findById(moduleId);
  if (!trainingModule) throw Errors.notFound("Training module not found");

  const version = await getVersionOrThrow(trainingModule.trainingVersion);
  assertDraft(version);

  if (GRADED_TYPES.includes(contentType) && (!grading || !grading.type)) {
    throw Errors.badRequest(`${contentType} content requires a grading rubric`);
  }

  const existingCount = await TrainingContent.countDocuments({ trainingModule: moduleId });
  const resolvedRequired = required ?? contentType !== CONTENT_TYPE.REFERENCE;

  const content = await TrainingContent.create({
    trainingVersion: trainingModule.trainingVersion,
    trainingModule: moduleId,
    contentType,
    order: existingCount,
    required: resolvedRequired,
    translations: translations ?? [],
    media: media ?? {},
    watchThresholdSeconds: watchThresholdSeconds ?? null,
    grading: grading ?? null,
    passingScore: passingScore ?? (GRADED_TYPES.includes(contentType) ? 100 : null),
    helpEligible: Boolean(helpEligible),
  });

  await writeAudit({
    entityType: TRAINING_AUDIT_ENTITY_TYPE.TRAINING_CONTENT,
    entityId: content._id,
    actorRef: adminId,
    actorType: TRAINING_AUDIT_ACTOR_TYPE.ADMIN,
    action: TRAINING_AUDIT_ACTION.CONTENT_CREATED,
    newValue: { contentType, moduleId },
  });

  return content;
};

export const updateContent = async ({ contentId, patch, adminId }) => {
  const content = await TrainingContent.findById(contentId).select("+grading");
  if (!content) throw Errors.notFound("Training content not found");

  const version = await getVersionOrThrow(content.trainingVersion);
  assertDraft(version);

  const oldValue = content.toObject();

  const allowedFields = [
    "translations",
    "media",
    "watchThresholdSeconds",
    "grading",
    "passingScore",
    "required",
    "helpEligible",
  ];
  for (const field of allowedFields) {
    if (patch[field] !== undefined) content[field] = patch[field];
  }

  await content.save();

  await writeAudit({
    entityType: TRAINING_AUDIT_ENTITY_TYPE.TRAINING_CONTENT,
    entityId: content._id,
    actorRef: adminId,
    actorType: TRAINING_AUDIT_ACTOR_TYPE.ADMIN,
    action: TRAINING_AUDIT_ACTION.CONTENT_UPDATED,
    oldValue,
    newValue: content.toObject(),
  });

  return content;
};

export const deleteContent = async ({ contentId, adminId }) => {
  const content = await TrainingContent.findById(contentId);
  if (!content) throw Errors.notFound("Training content not found");

  const version = await getVersionOrThrow(content.trainingVersion);
  assertDraft(version);

  await content.deleteOne();

  await writeAudit({
    entityType: TRAINING_AUDIT_ENTITY_TYPE.TRAINING_CONTENT,
    entityId: content._id,
    actorRef: adminId,
    actorType: TRAINING_AUDIT_ACTOR_TYPE.ADMIN,
    action: TRAINING_AUDIT_ACTION.CONTENT_DELETED,
    oldValue: { contentType: content.contentType, trainingModule: content.trainingModule },
  });
};

// ─── PUBLISH / RETIRE ─────────────────────────────────────────────

const assertVersionPublishable = async (versionId) => {
  const modules = await TrainingModule.find({ trainingVersion: versionId }).sort({ order: 1 }).lean();

  if (modules.length !== MODULE_KEY_ORDER.length) {
    throw Errors.conflict(
      `Version has ${modules.length}/${MODULE_KEY_ORDER.length} required modules — cannot publish`
    );
  }
  for (let i = 0; i < MODULE_KEY_ORDER.length; i++) {
    if (modules[i].moduleKey !== MODULE_KEY_ORDER[i] || modules[i].order !== i) {
      throw Errors.conflict(`Module ordering is invalid at position ${i} (expected ${MODULE_KEY_ORDER[i]})`);
    }
  }

  const content = await TrainingContent.find({ trainingVersion: versionId }).select("+grading").lean();
  const contentByModule = new Map();
  for (const c of content) {
    const key = String(c.trainingModule);
    if (!contentByModule.has(key)) contentByModule.set(key, []);
    contentByModule.get(key).push(c);
  }

  for (const m of modules) {
    const items = contentByModule.get(String(m._id)) ?? [];
    const hasRequired = items.some((c) => c.required);
    if (!hasRequired) {
      throw Errors.conflict(`Module ${m.moduleKey} has no required content — cannot publish`);
    }
    for (const c of items) {
      const hasApprovedDefault = (c.translations || []).some((t) => t.languageCode === "en" && t.approved);
      if (!hasApprovedDefault) {
        throw Errors.conflict(`Content ${c._id} in module ${m.moduleKey} has no approved 'en' translation`);
      }
      if (GRADED_TYPES.includes(c.contentType) && (!c.grading || !c.grading.type)) {
        throw Errors.conflict(`Content ${c._id} in module ${m.moduleKey} is missing a grading rubric`);
      }
    }
  }
};

export const publishVersion = async ({ versionId, adminId }) => {
  const version = await getVersionOrThrow(versionId);
  assertDraft(version);
  await assertVersionPublishable(versionId);

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const currentlyPublished = await TrainingVersion.findOne({ status: TRAINING_VERSION_STATUS.PUBLISHED }).session(session);
    if (currentlyPublished) {
      currentlyPublished.status = TRAINING_VERSION_STATUS.RETIRED;
      currentlyPublished.retiredAt = new Date();
      currentlyPublished.retiredBy = adminId;
      await currentlyPublished.save({ session });

      await TrainingAuditEvent.create(
        [
          {
            entityType: TRAINING_AUDIT_ENTITY_TYPE.TRAINING_VERSION,
            entityId: currentlyPublished._id,
            actorRef: adminId,
            actorType: TRAINING_AUDIT_ACTOR_TYPE.ADMIN,
            action: TRAINING_AUDIT_ACTION.VERSION_RETIRED,
            reason: `Superseded by version ${version.versionNumber}`,
          },
        ],
        { session }
      );
    }

    version.status = TRAINING_VERSION_STATUS.PUBLISHED;
    version.publishedAt = new Date();
    version.publishedBy = adminId;
    await version.save({ session });

    await TrainingAuditEvent.create(
      [
        {
          entityType: TRAINING_AUDIT_ENTITY_TYPE.TRAINING_VERSION,
          entityId: version._id,
          actorRef: adminId,
          actorType: TRAINING_AUDIT_ACTOR_TYPE.ADMIN,
          action: TRAINING_AUDIT_ACTION.VERSION_PUBLISHED,
          newValue: { versionNumber: version.versionNumber },
        },
      ],
      { session }
    );

    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }

  return version;
};

export const retireVersion = async ({ versionId, adminId, reason }) => {
  const version = await getVersionOrThrow(versionId);
  if (version.status !== TRAINING_VERSION_STATUS.PUBLISHED) {
    throw Errors.conflict(`Version ${version.versionNumber} is ${version.status}, not PUBLISHED`);
  }

  version.status = TRAINING_VERSION_STATUS.RETIRED;
  version.retiredAt = new Date();
  version.retiredBy = adminId;
  await version.save();

  await writeAudit({
    entityType: TRAINING_AUDIT_ENTITY_TYPE.TRAINING_VERSION,
    entityId: version._id,
    actorRef: adminId,
    actorType: TRAINING_AUDIT_ACTOR_TYPE.ADMIN,
    action: TRAINING_AUDIT_ACTION.VERSION_RETIRED,
    reason: reason ?? "Manually retired by admin",
  });

  return version;
};

// ─── ADMIN READ: AGENT PROGRESS / AUDIT ───────────────────────────

export const listAgentProgress = ({ page = 1, limit = 20 } = {}) =>
  FieldAgentTraining.find()
    .populate("agentRef", "name phone role")
    .sort({ updatedAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

// The agent's CURRENT enrollment only — for the (common) case of one
// lifetime enrollment this is the whole story; for an agent who has
// been through more than one training cycle, see
// listAgentTrainingHistory below for every historical record.
export const getAgentProgressDetail = async (agentUserId) => {
  const enrollment = await FieldAgentTraining.findOne({ agentRef: agentUserId, isActive: true })
    .populate("agentRef", "name phone role")
    .lean();
  if (!enrollment) throw Errors.notFound("No active training enrollment for this Field Agent");
  return enrollment;
};

// Every FieldAgentTraining document this agent has ever had — active
// and superseded — newest first. Superseded (historical) enrollments
// are never deleted or overwritten (see that model's file header), so
// this is a plain, unfiltered query, not a special "history" store.
export const listAgentTrainingHistory = async (agentUserId) =>
  FieldAgentTraining.find({ agentRef: agentUserId })
    .populate("agentRef", "name phone role")
    .sort({ createdAt: -1 })
    .lean();

export const listAuditEvents = ({ entityType, entityId, page = 1, limit = 50 } = {}) => {
  const filter = {};
  if (entityType) filter.entityType = entityType;
  if (entityId) filter.entityId = entityId;

  return TrainingAuditEvent.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();
};
