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
import { deleteTrainingMedia } from "./mediaDelivery.service.js";
import {
  TRAINING_VERSION_STATUS,
  MODULE_KEY,
  MODULE_KEY_ORDER,
  CONTENT_TYPE,
  HELP_ELIGIBLE_MODULE_KEYS,
  PASSING_SCORE_MIN,
  PASSING_SCORE_MAX,
  WATCHABLE_MEDIA_RESOURCE_TYPES,
  MAX_LIST_LIMIT,
  DEFAULT_LIST_LIMIT,
  TRAINING_AUDIT_ACTOR_TYPE,
  TRAINING_AUDIT_ACTION,
  TRAINING_AUDIT_ENTITY_TYPE,
} from "../constants/fieldAgentTraining.constants.js";

const GRADED_TYPES = [CONTENT_TYPE.KNOWLEDGE_CHECK, CONTENT_TYPE.PRACTICAL_SCENARIO];

// FA-3.3.2.4 — defensive backstop only; the Joi query schemas
// (trainingContent.validator.js) are the primary defense and already
// reject an out-of-range `limit` with a 400 before any of these
// functions run. This clamp exists purely for any future internal
// caller that bypasses that route-level validation.
const clampLimit = (limit, fallback) => {
  const n = Number(limit) || fallback;
  return Math.max(1, Math.min(n, MAX_LIST_LIMIT));
};

// ─── FA-3.3.2.1 — AUTHOR-TIME + PUBLISH-TIME SHARED VALIDATORS ─────
// Each is a pure no-op for content types it doesn't apply to, so every
// call site can call all three unconditionally without a switch.

// SINGLE_CHOICE: correctOptionIndex must be a valid index into every
// approved translation's options array — not just English's — so a
// rubric that's valid against English but out-of-bounds against an
// approved Hindi option list is still rejected (approved plan: FA-3.3.2.1.B).
// CHECKLIST: correctKeys are index-position strings by convention
// (see fieldAgentTraining.service.js#gradeSubmission's own header) —
// every entry must be numeric and in-bounds against every approved
// translation's options; duplicates are REJECTED, never silently
// deduplicated, per the approved plan's explicit "prefer rejection".
const validateGradingRubric = ({ contentType, grading, translations }) => {
  if (!GRADED_TYPES.includes(contentType)) return;

  if (!grading || !grading.type) {
    throw Errors.badRequest(`${contentType} content requires a grading rubric`);
  }

  const approvedOptionSets = (translations || [])
    .filter((t) => t.approved && Array.isArray(t.options))
    .map((t) => t.options);

  if (grading.type === "SINGLE_CHOICE") {
    const idx = grading.correctOptionIndex;
    if (!Number.isInteger(idx) || idx < 0) {
      throw Errors.badRequest("grading.correctOptionIndex must be a non-negative integer");
    }
    for (const options of approvedOptionSets) {
      if (idx >= options.length) {
        throw Errors.badRequest(
          `grading.correctOptionIndex (${idx}) is out of bounds for an approved translation with ${options.length} option(s)`
        );
      }
    }
  } else if (grading.type === "CHECKLIST") {
    const keys = grading.correctKeys;
    if (!Array.isArray(keys) || keys.length === 0) {
      throw Errors.badRequest("grading.correctKeys must be a non-empty array");
    }
    const seen = new Set();
    for (const key of keys) {
      const keyStr = String(key);
      if (!/^\d+$/.test(keyStr)) {
        throw Errors.badRequest(`grading.correctKeys entry "${keyStr}" is not a valid option index`);
      }
      if (seen.has(keyStr)) {
        throw Errors.badRequest(`grading.correctKeys contains a duplicate entry "${keyStr}"`);
      }
      seen.add(keyStr);

      const numericIdx = Number(keyStr);
      for (const options of approvedOptionSets) {
        if (numericIdx >= options.length) {
          throw Errors.badRequest(
            `grading.correctKeys entry "${keyStr}" is out of bounds for an approved translation with ${options.length} option(s)`
          );
        }
      }
    }
  } else {
    throw Errors.badRequest(`Unknown grading rubric type "${grading.type}"`);
  }
};

// A passingScore of 0 would let any submission pass — see constants
// file header for the full rationale.
const validatePassingScore = ({ contentType, passingScore }) => {
  if (!GRADED_TYPES.includes(contentType)) return;
  if (passingScore == null || passingScore < PASSING_SCORE_MIN || passingScore > PASSING_SCORE_MAX) {
    throw Errors.badRequest(
      `passingScore must be between ${PASSING_SCORE_MIN} and ${PASSING_SCORE_MAX} for ${contentType} content`
    );
  }
};

// 0/null remain fully legal (instant-complete on view, unchanged) — a
// POSITIVE threshold requires media to exist AND be an actually
// watchable resource type (approved plan correction: presence of
// media.publicId alone is not sufficient — an image or PDF has no
// watch-time semantics).
const validateWatchThreshold = ({ contentType, watchThresholdSeconds, media }) => {
  if (contentType !== CONTENT_TYPE.LESSON) return;
  if (!watchThresholdSeconds || watchThresholdSeconds <= 0) return;

  if (!media?.publicId) {
    throw Errors.badRequest("watchThresholdSeconds > 0 requires media to be attached first");
  }
  if (!WATCHABLE_MEDIA_RESOURCE_TYPES.includes(media.resourceType)) {
    throw Errors.badRequest(
      `watchThresholdSeconds > 0 requires a watchable media type (${WATCHABLE_MEDIA_RESOURCE_TYPES.join(", ")}) — current media is "${media.resourceType}"`
    );
  }
};

// Every mandatory module must carry an approved English title —
// display-metadata completeness, checked only at publish (not at
// author-time, since a module is created before any content exists
// and forcing translation-first authoring order would be arbitrary).
const validateModuleTranslations = (modules) => {
  for (const m of modules) {
    const hasApprovedEnglish = (m.translations || []).some((t) => t.languageCode === "en" && t.approved);
    if (!hasApprovedEnglish) {
      throw Errors.conflict(`Module ${m.moduleKey} has no approved 'en' translation — cannot publish`);
    }
  }
};

// Non-blocking advisory only — per the approved plan, Help coverage is
// a warning, never a hard publish failure, and no new mandatory
// curriculum rule is introduced.
const computeHelpCoverageWarnings = async (versionId) => {
  const helpModules = await TrainingModule.find({
    trainingVersion: versionId,
    moduleKey: { $in: HELP_ELIGIBLE_MODULE_KEYS },
  })
    .select("_id")
    .lean();

  const helpEligibleCount = await TrainingContent.countDocuments({
    trainingModule: { $in: helpModules.map((m) => m._id) },
    helpEligible: true,
  });

  return helpEligibleCount === 0
    ? ["No helpEligible content exists in any Help-scoped module — Field Agent Help will be empty for this version."]
    : [];
};

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

export const listVersions = ({ page = 1, limit = DEFAULT_LIST_LIMIT.VERSIONS } = {}) => {
  const safeLimit = clampLimit(limit, DEFAULT_LIST_LIMIT.VERSIONS);
  const safePage = Math.max(1, Number(page) || 1);
  return TrainingVersion.find()
    .sort({ versionNumber: -1 })
    .skip((safePage - 1) * safeLimit)
    .limit(safeLimit)
    .lean();
};

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

  const resolvedTranslations = translations ?? [];
  const resolvedMedia = media ?? {};
  const resolvedWatchThreshold = watchThresholdSeconds ?? null;
  const resolvedGrading = grading ?? null;
  const resolvedPassingScore = passingScore ?? (GRADED_TYPES.includes(contentType) ? 100 : null);
  const resolvedRequired = required ?? contentType !== CONTENT_TYPE.REFERENCE;

  // FA-3.3.2.1 — author-time parity with the publish gate: fail here,
  // not only at publish, so an admin gets immediate feedback.
  validateGradingRubric({ contentType, grading: resolvedGrading, translations: resolvedTranslations });
  validatePassingScore({ contentType, passingScore: resolvedPassingScore });
  validateWatchThreshold({ contentType, watchThresholdSeconds: resolvedWatchThreshold, media: resolvedMedia });

  const existingCount = await TrainingContent.countDocuments({ trainingModule: moduleId });

  const content = await TrainingContent.create({
    trainingVersion: trainingModule.trainingVersion,
    trainingModule: moduleId,
    contentType,
    order: existingCount,
    required: resolvedRequired,
    translations: resolvedTranslations,
    media: resolvedMedia,
    watchThresholdSeconds: resolvedWatchThreshold,
    grading: resolvedGrading,
    passingScore: resolvedPassingScore,
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

// FA-3.3.2.3 — the ADMIN HTTP API's generic `PATCH /content/:contentId`
// rejects a `media` field with 400 at the Joi layer (see
// trainingContent.validator.js's `.forbidden()`) — that is the actual
// enforcement of "generic media mutation must be explicitly rejected,
// not silently ignored," since a 400 is inherently an HTTP-facing
// concept. This function is also called directly, bypassing HTTP/Joi
// entirely, by two already-frozen internal scripts
// (seedFieldAgentTrainingV1.js, verifyFieldAgentTraining.js) that
// predate this hardening and must keep working unmodified. Rather
// than throw for those trusted internal callers (which would break
// them) or silently reapply the old unsafe direct-assignment (which
// would reopen the exact integrity gap this subphase closes), a
// supplied `media` field here is routed through the IDENTICAL
// reference-checked, Cloudinary-safe logic setContentMedia uses
// (`applyMediaMutation` below) — there is still exactly one
// implementation of "how media may be safely mutated," reachable from
// two entry points instead of duplicated or bypassed.
export const updateContent = async ({ contentId, patch, adminId }) => {
  const content = await TrainingContent.findById(contentId).select("+grading");
  if (!content) throw Errors.notFound("Training content not found");

  const version = await getVersionOrThrow(content.trainingVersion);
  assertDraft(version);

  const oldValue = content.toObject();

  const allowedFields = [
    "translations",
    "watchThresholdSeconds",
    "grading",
    "passingScore",
    "required",
    "helpEligible",
  ];
  for (const field of allowedFields) {
    if (patch[field] !== undefined) content[field] = patch[field];
  }

  const oldMedia = content.media?.publicId ? { publicId: content.media.publicId, resourceType: content.media.resourceType } : null;
  const mediaSupplied = patch.media !== undefined;
  if (mediaSupplied) {
    content.media = patch.media ?? { publicId: null, resourceType: null };
  }

  // FA-3.3.2.1 — validate the FINAL merged state (contentType is
  // immutable, never in allowedFields, so it's always the original).
  validateGradingRubric({ contentType: content.contentType, grading: content.grading, translations: content.translations });
  validatePassingScore({ contentType: content.contentType, passingScore: content.passingScore });
  validateWatchThreshold({ contentType: content.contentType, watchThresholdSeconds: content.watchThresholdSeconds, media: content.media });

  // MongoDB write FIRST — authoritative.
  await content.save();

  const cloudinaryCleanup = mediaSupplied ? await applyMediaCleanup({ contentId: content._id, oldMedia, newMedia: content.media }) : null;

  await writeAudit({
    entityType: TRAINING_AUDIT_ENTITY_TYPE.TRAINING_CONTENT,
    entityId: content._id,
    actorRef: adminId,
    actorType: TRAINING_AUDIT_ACTOR_TYPE.ADMIN,
    action: TRAINING_AUDIT_ACTION.CONTENT_UPDATED,
    oldValue,
    newValue: cloudinaryCleanup ? { ...content.toObject(), cloudinaryCleanup } : content.toObject(),
  });

  return content;
};

// ─── MEDIA — SINGLE MUTATION CHOKE POINT (DRAFT versions only) ────
// FA-3.3.2.3. Every media set/replace/remove flows through here, and
// only here — closing the FA-3.3.2 audit's own flagged risk that a
// raw JSON `updateContent` could set an arbitrary, never-uploaded
// `publicId` (that path is now a hard 400 — see updateContent above
// and the Joi schema).
//
// Distributed-consistency rule (approved plan, non-negotiable):
//   1. MongoDB is authoritative — the DB write always happens first.
//   2. Cloudinary cleanup happens strictly AFTER that write succeeds,
//      never before, never inside a transaction with it (Cloudinary
//      cannot participate in Mongo's two-phase commit).
//   3. A Cloudinary failure NEVER rolls back or fails this request —
//      the DB state is already correct and committed by that point.
//   4. Every cleanup attempt (success, skip, or failure) is recorded
//      in the same CONTENT_UPDATED audit event's newValue — no new
//      audit action is introduced for this.
//   5. Before ever destroying an old publicId, verify no OTHER
//      TrainingContent document still references it — if one does,
//      the delete is skipped, never attempted, and the skip is itself
//      audited with its reason. This is defense-in-depth: normal
//      operation never produces a shared publicId (each Cloudinary
//      upload gets a fresh, auto-generated id scoped to its own
//      content folder), especially now that the only path that could
//      previously set an arbitrary reused publicId (raw JSON
//      updateContent) is closed — but the check costs one cheap
//      countDocuments query and removes any doubt.
const isPublicIdReferencedElsewhere = async (publicId, excludeQuery) => {
  const count = await TrainingContent.countDocuments({ "media.publicId": publicId, ...excludeQuery });
  return count > 0;
};

// Called strictly AFTER the DB has already been updated to stop
// referencing `oldMedia` — decides whether the now-superseded/removed
// asset is safe to destroy, and returns the cleanup outcome for the
// caller to fold into its own audit event. The single implementation
// of "how a superseded media asset may be safely cleaned up," shared
// by setContentMedia and updateContent (see that function's own
// header for why it also needs this).
const applyMediaCleanup = async ({ contentId, oldMedia, newMedia }) => {
  if (!oldMedia?.publicId || oldMedia.publicId === newMedia?.publicId) return null;

  const stillReferenced = await isPublicIdReferencedElsewhere(oldMedia.publicId, { _id: { $ne: contentId } });
  if (stillReferenced) {
    return { status: "skipped", reason: "publicId still referenced by another TrainingContent document" };
  }
  const result = await deleteTrainingMedia(oldMedia);
  return result.success ? { status: "success" } : { status: "failed", error: result.error };
};

// `media` is `{publicId, resourceType}` to set/replace, or `null`/
// omitted to remove. Reused by both the upload handler (replace) and
// the remove handler — see adminTraining.controller.js.
export const setContentMedia = async ({ contentId, media, adminId }) => {
  const content = await TrainingContent.findById(contentId).select("+grading");
  if (!content) throw Errors.notFound("Training content not found");

  const version = await getVersionOrThrow(content.trainingVersion);
  assertDraft(version);

  const oldValue = content.toObject();
  const oldMedia = content.media?.publicId ? { publicId: content.media.publicId, resourceType: content.media.resourceType } : null;
  const newMedia = media ?? { publicId: null, resourceType: null };

  content.media = newMedia;

  // FA-3.3.2.1's frozen rule, reused unmodified: removing/replacing
  // media on a LESSON must never silently leave a positive
  // watchThresholdSeconds pointing at no watchable media.
  validateWatchThreshold({ contentType: content.contentType, watchThresholdSeconds: content.watchThresholdSeconds, media: content.media });

  // MongoDB write FIRST — authoritative, and the only thing that
  // determines what the system believes exists.
  await content.save();

  const cloudinaryCleanup = await applyMediaCleanup({ contentId: content._id, oldMedia, newMedia });

  await writeAudit({
    entityType: TRAINING_AUDIT_ENTITY_TYPE.TRAINING_CONTENT,
    entityId: content._id,
    actorRef: adminId,
    actorType: TRAINING_AUDIT_ACTOR_TYPE.ADMIN,
    action: TRAINING_AUDIT_ACTION.CONTENT_UPDATED,
    oldValue,
    newValue: cloudinaryCleanup ? { ...content.toObject(), cloudinaryCleanup } : content.toObject(),
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

// ─── CONTENT REORDER (DRAFT versions only) ────────────────────────
// FA-3.3.2.2. Two-phase atomic reorder within one transaction: phase
// 1 moves every item in the module to a temporary, guaranteed-unique
// NEGATIVE order (clearing the {trainingModule,order} unique index's
// collision space); phase 2 assigns the real, contiguous, 0-based
// target order. This is the same "flip inside a transaction so the
// unique index never sees a collision" idiom already proven for
// FieldAgentTraining.isActive during FA-3.3.1's own correction round
// — a naive single-pass reassignment would collide with whichever
// item currently holds the target order value.
//
// Concurrency: a write conflict from a second, overlapping reorder on
// the same module is retried with a fresh transaction (bounded, 3
// attempts) before surfacing 409 asking the caller to refetch and
// retry — MongoDB transactions serialize conflicting writes to the
// same documents, they don't silently corrupt them.
const MAX_REORDER_ATTEMPTS = 3;

export const reorderModuleContent = async ({ moduleId, orderedContentIds, adminId }) => {
  const trainingModule = await TrainingModule.findById(moduleId);
  if (!trainingModule) throw Errors.notFound("Training module not found");

  const version = await getVersionOrThrow(trainingModule.trainingVersion);
  assertDraft(version);

  const existing = await TrainingContent.find({ trainingModule: moduleId }).select("_id order").lean();
  const existingIds = existing.map((c) => String(c._id));
  const requestedIds = orderedContentIds.map(String);

  const isExactPermutation =
    requestedIds.length === existingIds.length &&
    new Set(requestedIds).size === requestedIds.length &&
    existingIds.every((id) => requestedIds.includes(id));
  if (!isExactPermutation) {
    throw Errors.badRequest(
      "orderedContentIds must be exactly a permutation of this module's existing content ids — no missing, extra, or duplicate entries"
    );
  }

  const oldOrder = Object.fromEntries(existing.map((c) => [String(c._id), c.order]));

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_REORDER_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      for (let i = 0; i < requestedIds.length; i++) {
        await TrainingContent.updateOne(
          { _id: requestedIds[i], trainingModule: moduleId },
          { $set: { order: -(i + 1) } },
          { session }
        );
      }
      for (let i = 0; i < requestedIds.length; i++) {
        await TrainingContent.updateOne(
          { _id: requestedIds[i], trainingModule: moduleId },
          { $set: { order: i } },
          { session }
        );
      }

      await session.commitTransaction();
      lastErr = null;
      break;
    } catch (err) {
      await session.abortTransaction();
      lastErr = err;
      const isWriteConflict = err.code === 112 || err.codeName === "WriteConflict";
      if (!isWriteConflict) break;
    } finally {
      session.endSession();
    }
  }

  if (lastErr) {
    if (lastErr.code === 112 || lastErr.codeName === "WriteConflict") {
      throw Errors.conflict("Reorder could not complete due to a concurrent update on this module — refetch and retry");
    }
    throw lastErr;
  }

  const newOrder = Object.fromEntries(requestedIds.map((id, i) => [id, i]));

  await writeAudit({
    entityType: TRAINING_AUDIT_ENTITY_TYPE.TRAINING_MODULE,
    entityId: moduleId,
    actorRef: adminId,
    actorType: TRAINING_AUDIT_ACTOR_TYPE.ADMIN,
    action: TRAINING_AUDIT_ACTION.MODULE_UPDATED,
    oldValue: { contentOrder: oldOrder },
    newValue: { contentOrder: newOrder },
  });

  return TrainingContent.find({ trainingModule: moduleId }).sort({ order: 1 }).lean();
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

  // FA-3.3.2.1.A — module-level translation completeness (Hindi
  // stays optional; only an approved English title is mandatory).
  validateModuleTranslations(modules);

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
      // FA-3.3.2.1.B/C/D — full rubric-bounds, passing-score, and
      // watch-threshold/media-type validation, redundant with (but
      // not weaker than) the author-time checks in addContent/
      // updateContent — this is the defense-in-depth backstop, e.g.
      // against a future media-removal path (FA-3.3.2.3) leaving a
      // stale positive threshold with no watchable media attached.
      try {
        validateGradingRubric({ contentType: c.contentType, grading: c.grading, translations: c.translations });
        validatePassingScore({ contentType: c.contentType, passingScore: c.passingScore });
        validateWatchThreshold({ contentType: c.contentType, watchThresholdSeconds: c.watchThresholdSeconds, media: c.media });
      } catch (err) {
        throw Errors.conflict(`Content ${c._id} in module ${m.moduleKey}: ${err.message}`);
      }
    }
  }

  // FA-3.3.2.1.E — advisory only, never blocks publish.
  const warnings = await computeHelpCoverageWarnings(versionId);
  return { warnings };
};

export const publishVersion = async ({ versionId, adminId }) => {
  const version = await getVersionOrThrow(versionId);
  assertDraft(version);
  const { warnings } = await assertVersionPublishable(versionId);

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
          newValue: { versionNumber: version.versionNumber, warnings },
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

  // Backward-compatible return contract: `version` itself, exactly as
  // before FA-3.3.2.1 — the frozen seedFieldAgentTrainingV1.js calls
  // this function directly and reads `published.versionNumber`, and
  // must keep working completely unmodified. `warnings` is attached
  // as a plain, non-schema property for in-process callers only (it
  // is never part of `version`'s own JSON/toObject serialization,
  // which mongoose derives strictly from schema paths) —
  // publishVersionHandler reads `version._warnings` directly and
  // places it as a sibling key in its own response payload; nothing
  // downstream ever relies on this document's own serialized form to
  // carry it.
  version._warnings = warnings;
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

// ─── DRAFT DISCARD (DRAFT versions only) ──────────────────────────
// FA-3.3.2.2. Permanently deletes a DRAFT version and everything
// under it — genuinely destructive, unlike retire (status flip,
// preserves data). The single status check below, read from the live
// document (never inferred from the id alone), is what makes
// "PUBLISHED cannot be discarded" and "RETIRED cannot be discarded"
// structurally true.
//
// The three deletes are one all-or-nothing transaction — no partial
// deletion is possible even on crash, so no orphan TrainingModule/
// TrainingContent row can ever result from this. Cloudinary cleanup
// happens strictly AFTER that transaction commits (same distributed-
// consistency rule as setContentMedia/FA-3.3.2.3: MongoDB
// authoritative, Cloudinary best-effort, a cleanup failure never
// reopens or fails the discard), reusing the exact same
// isPublicIdReferencedElsewhere/deleteTrainingMedia machinery —
// scoped to "does any OTHER version's content still reference this
// asset", since everything that referenced it FROM this version was
// just deleted together.
//
// Idempotency: re-invoking with the same versionId after a successful
// discard returns 404 (the resource is genuinely gone) — the correct,
// expected "safe to call again" behavior for a destructive operation.
//
// TrainingAuditEvent rows referencing this version are never deleted
// — audit logs legitimately outlive the entities they describe.
export const discardDraftVersion = async ({ versionId, adminId }) => {
  const version = await getVersionOrThrow(versionId);
  if (version.status !== TRAINING_VERSION_STATUS.DRAFT) {
    throw Errors.conflict(`Version ${version.versionNumber} is ${version.status}, not DRAFT — it cannot be discarded`);
  }

  const versionNumber = version.versionNumber;
  const contentSnapshot = await TrainingContent.find({ trainingVersion: versionId }).select("media").lean();
  const moduleCount = await TrainingModule.countDocuments({ trainingVersion: versionId });
  const contentCount = contentSnapshot.length;

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    await TrainingContent.deleteMany({ trainingVersion: versionId }, { session });
    await TrainingModule.deleteMany({ trainingVersion: versionId }, { session });
    await TrainingVersion.deleteOne({ _id: versionId }, { session });
    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }

  const distinctMedia = new Map();
  for (const c of contentSnapshot) {
    if (c.media?.publicId) distinctMedia.set(c.media.publicId, c.media);
  }

  const mediaCleanup = [];
  for (const media of distinctMedia.values()) {
    const stillReferenced = await isPublicIdReferencedElsewhere(media.publicId, { trainingVersion: { $ne: versionId } });
    if (stillReferenced) {
      mediaCleanup.push({ publicId: media.publicId, status: "skipped", reason: "publicId still referenced by another TrainingContent document" });
      continue;
    }
    const result = await deleteTrainingMedia(media);
    mediaCleanup.push({ publicId: media.publicId, status: result.success ? "success" : "failed", error: result.error ?? null });
  }

  await writeAudit({
    entityType: TRAINING_AUDIT_ENTITY_TYPE.TRAINING_VERSION,
    entityId: versionId,
    actorRef: adminId,
    actorType: TRAINING_AUDIT_ACTOR_TYPE.ADMIN,
    action: TRAINING_AUDIT_ACTION.VERSION_DISCARDED,
    oldValue: { versionNumber, moduleCount, contentCount },
    newValue: { mediaCleanup },
  });

  return { versionNumber, moduleCount, contentCount, mediaCleanup };
};

// ─── ADMIN READ: AGENT PROGRESS / AUDIT ───────────────────────────

export const listAgentProgress = ({ page = 1, limit = DEFAULT_LIST_LIMIT.PROGRESS } = {}) => {
  const safeLimit = clampLimit(limit, DEFAULT_LIST_LIMIT.PROGRESS);
  const safePage = Math.max(1, Number(page) || 1);
  return FieldAgentTraining.find()
    .populate("agentRef", "name phone role")
    .sort({ updatedAt: -1 })
    .skip((safePage - 1) * safeLimit)
    .limit(safeLimit)
    .lean();
};

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

export const listAuditEvents = ({ entityType, entityId, page = 1, limit = DEFAULT_LIST_LIMIT.AUDIT } = {}) => {
  const filter = {};
  if (entityType) filter.entityType = entityType;
  if (entityId) filter.entityId = entityId;

  const safeLimit = clampLimit(limit, DEFAULT_LIST_LIMIT.AUDIT);
  const safePage = Math.max(1, Number(page) || 1);

  return TrainingAuditEvent.find(filter)
    .sort({ createdAt: -1 })
    .skip((safePage - 1) * safeLimit)
    .limit(safeLimit)
    .lean();
};
