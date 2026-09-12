/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTraining/services/fieldAgentTraining.service.js
 *
 * FA-3.3 — agent-facing training engine: lazy enrollment, translated
 * content delivery, server-authoritative progress/completion, and the
 * atomic handoff into FA-2's frozen state machine.
 *
 * FROZEN INTEGRATION POINT (the only one this module has): FA-2's
 * assertValidTransition/setApplicationStatus
 * (modules/fieldAgent/services/fieldAgentApplication.service.js) are
 * imported and called completely unmodified. This service NEVER
 * assigns FieldAgentApplication.status directly. trainingRef is
 * populated the exact same best-effort way FA-3.2 already established
 * for kycRef (see linkTrainingRefIfMissing below) — informational
 * pointer only, never the identity/eligibility boundary.
 *
 * Unlike FA-3.2's KYC sync (which needs a durable outbox because an
 * admin decision happens on a completely separate request, with a
 * real crash-recovery gap between decision and status write), a
 * training's final content submission and its resulting FA-2
 * transition happen inside ONE request. A single Mongo transaction
 * (already used elsewhere — see kyc.service.js, ratingSubmission.
 * service.js) is the right-sized tool here; building FA-3.2's outbox/
 * reconciliation machinery for a same-request transition would be
 * unapproved scope expansion.
 */

import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import FieldAgentApplication from "../../fieldAgent/models/FieldAgentApplication.js";
import {
  assertValidTransition,
  setApplicationStatus,
} from "../../fieldAgent/services/fieldAgentApplication.service.js";
import { APPLICATION_STATUS } from "../../fieldAgent/constants/fieldAgent.constants.js";

import TrainingVersion from "../models/TrainingVersion.js";
import TrainingModule from "../models/TrainingModule.js";
import TrainingContent from "../models/TrainingContent.js";
import FieldAgentTraining from "../models/FieldAgentTraining.js";
import TrainingAuditEvent from "../models/TrainingAuditEvent.js";
import { getSignedMediaUrl } from "./mediaDelivery.service.js";
import {
  TRAINING_VERSION_STATUS,
  CONTENT_TYPE,
  CONTENT_PROGRESS_STATUS,
  MODULE_PROGRESS_STATUS,
  FIELD_AGENT_TRAINING_STATUS,
  DEFAULT_LANGUAGE_CODE,
  TRAINING_AUDIT_ACTOR_TYPE,
  TRAINING_AUDIT_ACTION,
  TRAINING_AUDIT_ENTITY_TYPE,
} from "../constants/fieldAgentTraining.constants.js";

// Applications in either of these terminal-negative states are never
// eligible for training access, read or write, regardless of whether
// they already completed it — this is proprietary ZEMISH content and
// eligibility is re-checked on every single request, never cached.
const BLOCKED_APPLICATION_STATUSES = [APPLICATION_STATUS.WITHDRAWN, APPLICATION_STATUS.REJECTED];

const assertEligible = (application, { existingEnrollment, forWrite }) => {
  if (!application) {
    throw Errors.forbidden("No Field Agent application found for this account");
  }

  if (BLOCKED_APPLICATION_STATUSES.includes(application.status)) {
    throw Errors.forbidden(`Training access unavailable for application status ${application.status}`);
  }

  const alreadyCompleted = existingEnrollment?.status === FIELD_AGENT_TRAINING_STATUS.COMPLETED;

  // Read-only review of an already-completed training stays available
  // through later lifecycle stages (TEST_PENDING, TEST_FAILED,
  // ADMIN_REVIEW, APPROVED) — only WITHDRAWN/REJECTED block it, per
  // above. Any further WRITE (a new submission) after completion is
  // never meaningful, so forWrite still requires TRAINING_PENDING.
  if (alreadyCompleted && !forWrite) return;

  if (application.status !== APPLICATION_STATUS.TRAINING_PENDING) {
    throw Errors.forbidden(`Training is not currently active for application status ${application.status}`);
  }
};

const getMyApplicationOrThrow = async (userId) => {
  const application = await FieldAgentApplication.findOne({ userRef: userId }).sort({ createdAt: -1 });
  return application;
};

const getPublishedVersionOrThrow = async () => {
  const version = await TrainingVersion.findOne({ status: TRAINING_VERSION_STATUS.PUBLISHED });
  if (!version) throw Errors.notFound("No published training version is currently available");
  return version;
};

// kycRef's exact precedent (fieldAgentKyc.service.js#linkKycRefIfMissing)
// — a denormalized, informational pointer only. FA-2 never reads or
// writes it, so a transient failure here must never fail enrollment.
// Unlike kycRef (one KYC record ever, so "set once if null" is
// correct), an agent can accumulate multiple historical
// FieldAgentTraining documents (see that model's file header) — this
// unconditionally overwrites, so the pointer always tracks whichever
// enrollment is CURRENT, never freezing on the agent's first-ever one.
const linkTrainingRef = async (userId, trainingId) => {
  try {
    await FieldAgentApplication.updateOne({ userRef: userId }, { $set: { trainingRef: trainingId } });
  } catch (err) {
    console.error(`❌ FA-3.3 trainingRef link failed for user ${userId}:`, err.message || err);
  }
};

const writeAudit = (fields, opts = {}) => TrainingAuditEvent.create([fields], opts).catch((err) => {
  console.error("❌ FA-3.3 TrainingAuditEvent write failed:", err.message || err);
});

// ─── ENROLLMENT ───────────────────────────────────────────────────

const buildModuleProgress = async (versionId) => {
  const modules = await TrainingModule.find({ trainingVersion: versionId }).sort({ order: 1 }).lean();
  return modules.map((m) => ({
    trainingModule: m._id,
    moduleKey: m.moduleKey,
    status: MODULE_PROGRESS_STATUS.IN_PROGRESS,
  }));
};

// Opens a brand-new ACTIVE enrollment for `version`, superseding
// `previousActive` (if given) by flipping ONLY its isActive flag —
// every other field on that historical document is left exactly as
// it was (requirement: a completed enrollment is never overwritten).
//
// The supersede-then-create pair MUST be one transaction: the partial
// unique index on {agentRef} (isActive:true) means a plain
// create-then-flip ordering would have the new insert collide with
// the still-active old document (11000), while a flip-then-create
// with no transaction would leave the agent with zero active
// enrollments for the gap between the two writes if the create step
// ever failed. A transaction removes both hazards — within it, the
// insert's uniqueness check already sees this same transaction's own
// flip of the old document, and any failure rolls back the flip too.
const openNewEnrollment = async ({ userId, application, version, previousActive }) => {
  const moduleProgress = await buildModuleProgress(version._id);

  let enrollment;
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    if (previousActive) {
      previousActive.isActive = false;
      await previousActive.save({ session });
    }

    [enrollment] = await FieldAgentTraining.create(
      [{ agentRef: userId, applicationRef: application._id, trainingVersion: version._id, moduleProgress }],
      { session }
    );

    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    if (err.code === 11000) {
      // Concurrent request already opened the new active enrollment
      // (or already claimed this exact {agent,version} pair) — the
      // aborted transaction rolled our own flip back too, so the
      // active enrollment is still whichever one legitimately won —
      // re-read it, never error, never create a duplicate.
      const existing = await FieldAgentTraining.findOne({ agentRef: userId, isActive: true });
      if (existing) return existing;
    }
    throw err;
  } finally {
    session.endSession();
  }

  if (previousActive) {
    await writeAudit({
      entityType: TRAINING_AUDIT_ENTITY_TYPE.FIELD_AGENT_TRAINING,
      entityId: previousActive._id,
      actorRef: userId,
      actorType: TRAINING_AUDIT_ACTOR_TYPE.AGENT,
      action: TRAINING_AUDIT_ACTION.ENROLLMENT_SUPERSEDED,
      oldValue: { trainingVersion: previousActive.trainingVersion },
      newValue: { supersededBy: enrollment._id, trainingVersion: version._id },
    });
  }

  await writeAudit({
    entityType: TRAINING_AUDIT_ENTITY_TYPE.FIELD_AGENT_TRAINING,
    entityId: enrollment._id,
    actorRef: userId,
    actorType: TRAINING_AUDIT_ACTOR_TYPE.AGENT,
    action: TRAINING_AUDIT_ACTION.ENROLLMENT_CREATED,
    newValue: { trainingVersion: version._id, versionNumber: version.versionNumber },
  });

  await linkTrainingRef(userId, enrollment._id);

  return enrollment;
};

export const getOrCreateEnrollment = async (userId) => {
  const application = await getMyApplicationOrThrow(userId);
  const activeEnrollment = await FieldAgentTraining.findOne({ agentRef: userId, isActive: true });

  assertEligible(application, { existingEnrollment: activeEnrollment, forWrite: false });

  if (!activeEnrollment) {
    const version = await getPublishedVersionOrThrow();
    return openNewEnrollment({ userId, application, version });
  }

  // FA-3.3.2.5 fix: getPublishedVersionOrThrow() is only ever needed
  // to decide whether a NEW enrollment should open — which itself
  // only happens when this enrollment is COMPLETED *and* the
  // application is independently eligible again. An IN_PROGRESS (or
  // any other non-COMPLETED) active enrollment is returned exactly as
  // it was pinned, unconditionally, with no dependency on what's
  // currently published — this is what "no silent migration" actually
  // requires, and it's also what keeps this enrollment (and therefore
  // /me) available even in the window where an admin has retired a
  // version without yet publishing a replacement. Same reasoning
  // extends to a COMPLETED enrollment that isn't currently eligible
  // for a new cycle (application.status !== TRAINING_PENDING) — that
  // branch was always going to return activeEnrollment unchanged too,
  // so it likewise never needs a published version to exist.
  if (activeEnrollment.status !== FIELD_AGENT_TRAINING_STATUS.COMPLETED) {
    return activeEnrollment;
  }
  if (application.status !== APPLICATION_STATUS.TRAINING_PENDING) {
    return activeEnrollment;
  }

  const version = await getPublishedVersionOrThrow();
  if (String(activeEnrollment.trainingVersion) === String(version._id)) {
    return activeEnrollment;
  }

  return openNewEnrollment({ userId, application, version, previousActive: activeEnrollment });
};

// ─── TRANSLATION RESOLUTION ───────────────────────────────────────
// Approved-only, requested language first, then DEFAULT_LANGUAGE_CODE
// fallback (approved even if requested language isn't) — a missing or
// unapproved translation must never block delivery, and must never
// silently serve unapproved text either.

export const resolveTranslation = (translations = [], languageCode) => {
  const approved = translations.filter((t) => t.approved);
  return (
    approved.find((t) => t.languageCode === languageCode) ||
    approved.find((t) => t.languageCode === DEFAULT_LANGUAGE_CODE) ||
    null
  );
};

// ─── READ: OVERVIEW ───────────────────────────────────────────────

export const getMyTrainingOverview = async (userId, languageCode) => {
  const enrollment = await getOrCreateEnrollment(userId);
  const version = await TrainingVersion.findById(enrollment.trainingVersion).lean();
  const modules = await TrainingModule.find({ trainingVersion: enrollment.trainingVersion })
    .sort({ order: 1 })
    .lean();

  const moduleProgressByModuleId = new Map(
    enrollment.moduleProgress.map((mp) => [String(mp.trainingModule), mp])
  );

  const shapedModules = modules.map((m) => {
    const translation = resolveTranslation(m.translations, languageCode);
    const progress = moduleProgressByModuleId.get(String(m._id));
    return {
      moduleKey: m.moduleKey,
      order: m.order,
      title: translation?.title ?? m.moduleKey,
      summary: translation?.summary ?? null,
      status: progress?.status ?? MODULE_PROGRESS_STATUS.IN_PROGRESS,
      completedAt: progress?.completedAt ?? null,
    };
  });

  return {
    trainingVersionNumber: version?.versionNumber ?? null,
    status: enrollment.status,
    startedAt: enrollment.startedAt,
    completedAt: enrollment.completedAt,
    modules: shapedModules,
  };
};

// ─── READ: ONE MODULE'S CONTENT ───────────────────────────────────

export const getModuleContent = async (userId, moduleKey, languageCode) => {
  const application = await getMyApplicationOrThrow(userId);
  const enrollment = await FieldAgentTraining.findOne({ agentRef: userId, isActive: true });
  assertEligible(application, { existingEnrollment: enrollment, forWrite: false });
  if (!enrollment) throw Errors.notFound("Training not yet started");

  const trainingModule = await TrainingModule.findOne({
    trainingVersion: enrollment.trainingVersion,
    moduleKey,
  }).lean();
  if (!trainingModule) throw Errors.notFound("Module not found in your training version");

  // `grading` is select:false by default — never fetched here.
  const items = await TrainingContent.find({ trainingModule: trainingModule._id }).sort({ order: 1 });

  const progressByContentId = new Map(
    enrollment.contentProgress.map((p) => [String(p.trainingContent), p])
  );

  if (enrollment.lastLanguageCode !== languageCode) {
    enrollment.lastLanguageCode = languageCode;
    await enrollment.save();
  }

  const shapedItems = items.map((item) => {
    const translation = resolveTranslation(item.translations, languageCode);
    const progress = progressByContentId.get(String(item._id));
    return {
      id: item._id,
      contentType: item.contentType,
      order: item.order,
      required: item.required,
      title: translation?.title ?? null,
      body: translation?.body ?? null,
      options: translation?.options ?? null,
      hasMedia: Boolean(item.media?.publicId),
      watchThresholdSeconds: item.watchThresholdSeconds,
      passingScore: item.passingScore,
      progress: progress
        ? {
            status: progress.status,
            attempts: progress.attempts,
            bestScore: progress.bestScore,
            maxWatchSeconds: progress.maxWatchSeconds,
            completedAt: progress.completedAt,
          }
        : { status: "NOT_STARTED", attempts: 0, bestScore: null, maxWatchSeconds: null, completedAt: null },
    };
  });

  const moduleTranslation = resolveTranslation(trainingModule.translations, languageCode);

  return {
    module: {
      moduleKey: trainingModule.moduleKey,
      title: moduleTranslation?.title ?? trainingModule.moduleKey,
      summary: moduleTranslation?.summary ?? null,
    },
    items: shapedItems,
  };
};

// ─── WRITE CONTEXT (shared by every progress-mutating endpoint) ──

const loadWriteContext = async (userId, contentId, allowedTypes) => {
  const application = await getMyApplicationOrThrow(userId);
  const enrollment = await FieldAgentTraining.findOne({ agentRef: userId, isActive: true });
  assertEligible(application, { existingEnrollment: enrollment, forWrite: true });
  if (!enrollment) throw Errors.notFound("Training not yet started");

  const content = await TrainingContent.findById(contentId).select("+grading");
  if (!content || String(content.trainingVersion) !== String(enrollment.trainingVersion)) {
    throw Errors.notFound("Content not found in your training version");
  }

  const allowed = Array.isArray(allowedTypes) ? allowedTypes : [allowedTypes];
  if (!allowed.includes(content.contentType)) {
    throw Errors.badRequest(`Content type ${content.contentType} does not support this action`);
  }

  return { application, enrollment, content };
};

const upsertContentProgress = (enrollment, contentId, patch) => {
  let entry = enrollment.contentProgress.find((p) => String(p.trainingContent) === String(contentId));
  if (!entry) {
    enrollment.contentProgress.push({ trainingContent: contentId, status: CONTENT_PROGRESS_STATUS.IN_PROGRESS });
    entry = enrollment.contentProgress[enrollment.contentProgress.length - 1];
  }
  Object.assign(entry, patch);
  enrollment.markModified("contentProgress");
  return entry;
};

// ─── GRADING (KNOWLEDGE_CHECK / PRACTICAL_SCENARIO) ───────────────
// Two structured, generic rubric shapes only — never a bespoke engine
// per scenario (approved plan requirement). Authoring chooses one
// shape per item at creation time (see trainingContent.service.js).
//
//   { type: "SINGLE_CHOICE", correctOptionIndex }
//     — submission: { answerIndex }
//   { type: "CHECKLIST", correctKeys: string[] }
//     — submission: { selectedKeys: string[] }
//     — score = (correct picks - wrong picks) / total correct, floored at 0

const gradeSubmission = (content, submission) => {
  const rubric = content.grading;
  if (!rubric || !rubric.type) {
    throw Errors.internal(`Training content ${content._id} has no grading rubric configured`);
  }

  let score;

  if (rubric.type === "SINGLE_CHOICE") {
    score = Number(submission?.answerIndex) === Number(rubric.correctOptionIndex) ? 100 : 0;
  } else if (rubric.type === "CHECKLIST") {
    const correctKeys = new Set(rubric.correctKeys || []);
    const selectedKeys = new Set(Array.isArray(submission?.selectedKeys) ? submission.selectedKeys : []);
    let correctPicks = 0;
    let wrongPicks = 0;
    for (const key of selectedKeys) {
      if (correctKeys.has(key)) correctPicks += 1;
      else wrongPicks += 1;
    }
    const raw = correctKeys.size > 0 ? ((correctPicks - wrongPicks) / correctKeys.size) * 100 : 0;
    score = Math.max(0, Math.min(100, Math.round(raw)));
  } else {
    throw Errors.internal(`Unknown rubric type "${rubric.type}" on training content ${content._id}`);
  }

  const passingScore = content.passingScore ?? 100;
  return { score, passed: score >= passingScore };
};

// ─── COMPLETION RECOMPUTATION + FA-2 HANDOFF ─────────────────────

const recomputeAndMaybeAdvance = async (enrollment, application) => {
  const requiredContent = await TrainingContent.find({
    trainingVersion: enrollment.trainingVersion,
    required: true,
  })
    .select("_id trainingModule")
    .lean();

  const requiredIdsByModule = new Map();
  for (const c of requiredContent) {
    const key = String(c.trainingModule);
    if (!requiredIdsByModule.has(key)) requiredIdsByModule.set(key, []);
    requiredIdsByModule.get(key).push(String(c._id));
  }

  const progressStatusById = new Map(
    enrollment.contentProgress.map((p) => [String(p.trainingContent), p.status])
  );

  let allModulesComplete = true;
  const newlyCompletedModules = [];

  for (const mp of enrollment.moduleProgress) {
    const requiredIds = requiredIdsByModule.get(String(mp.trainingModule)) || [];
    const allDone = requiredIds.every((id) => progressStatusById.get(id) === CONTENT_PROGRESS_STATUS.COMPLETED);

    if (allDone && mp.status !== MODULE_PROGRESS_STATUS.COMPLETED) {
      mp.status = MODULE_PROGRESS_STATUS.COMPLETED;
      mp.completedAt = new Date();
      newlyCompletedModules.push(mp);
    }
    if (!allDone) allModulesComplete = false;
  }
  if (newlyCompletedModules.length > 0) enrollment.markModified("moduleProgress");

  for (const mp of newlyCompletedModules) {
    await writeAudit({
      entityType: TRAINING_AUDIT_ENTITY_TYPE.FIELD_AGENT_TRAINING,
      entityId: enrollment._id,
      actorRef: enrollment.agentRef,
      actorType: TRAINING_AUDIT_ACTOR_TYPE.AGENT,
      action: TRAINING_AUDIT_ACTION.MODULE_COMPLETED,
      newValue: { moduleKey: mp.moduleKey },
    });
  }

  if (!allModulesComplete || enrollment.status === FIELD_AGENT_TRAINING_STATUS.COMPLETED) {
    await enrollment.save();
    return enrollment;
  }

  // Full training completion — atomic with the FA-2 handoff, single
  // request, single transaction (see file header).
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    enrollment.status = FIELD_AGENT_TRAINING_STATUS.COMPLETED;
    enrollment.completedAt = new Date();
    await enrollment.save({ session });

    const freshApplication = await FieldAgentApplication.findById(application._id).session(session);
    assertValidTransition(freshApplication.status, APPLICATION_STATUS.TEST_PENDING);
    setApplicationStatus(freshApplication, APPLICATION_STATUS.TEST_PENDING);
    await freshApplication.save({ session });

    await TrainingAuditEvent.create(
      [
        {
          entityType: TRAINING_AUDIT_ENTITY_TYPE.FIELD_AGENT_TRAINING,
          entityId: enrollment._id,
          actorRef: enrollment.agentRef,
          actorType: TRAINING_AUDIT_ACTOR_TYPE.AGENT,
          action: TRAINING_AUDIT_ACTION.TRAINING_COMPLETED,
          newValue: { trainingVersion: enrollment.trainingVersion, applicationStatus: APPLICATION_STATUS.TEST_PENDING },
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

  return enrollment;
};

// ─── PUBLIC WRITE ENDPOINTS ───────────────────────────────────────

export const recordLessonProgress = async ({ userId, contentId, watchedSeconds }) => {
  const { application, enrollment, content } = await loadWriteContext(userId, contentId, [
    CONTENT_TYPE.LESSON,
    CONTENT_TYPE.REFERENCE,
  ]);

  const existing = enrollment.contentProgress.find((p) => String(p.trainingContent) === String(contentId));
  const previousMax = existing?.maxWatchSeconds ?? 0;
  const newMax = Math.max(previousMax, Number(watchedSeconds) || 0);

  const threshold = content.watchThresholdSeconds;
  const completed = threshold == null ? true : newMax >= threshold;

  const wasAlreadyCompleted = existing?.status === CONTENT_PROGRESS_STATUS.COMPLETED;

  upsertContentProgress(enrollment, contentId, {
    maxWatchSeconds: newMax,
    status: completed ? CONTENT_PROGRESS_STATUS.COMPLETED : CONTENT_PROGRESS_STATUS.IN_PROGRESS,
    completedAt: completed ? existing?.completedAt ?? new Date() : null,
  });

  if (completed && !wasAlreadyCompleted) {
    await writeAudit({
      entityType: TRAINING_AUDIT_ENTITY_TYPE.FIELD_AGENT_TRAINING,
      entityId: enrollment._id,
      actorRef: userId,
      actorType: TRAINING_AUDIT_ACTOR_TYPE.AGENT,
      action: TRAINING_AUDIT_ACTION.CONTENT_COMPLETED,
      newValue: { contentId, contentType: content.contentType },
    });
  }

  const finalEnrollment = await recomputeAndMaybeAdvance(enrollment, application);
  return { completed, enrollment: finalEnrollment };
};

export const submitGradedContent = async ({ userId, contentId, submission }) => {
  const { application, enrollment, content } = await loadWriteContext(userId, contentId, [
    CONTENT_TYPE.KNOWLEDGE_CHECK,
    CONTENT_TYPE.PRACTICAL_SCENARIO,
  ]);

  const existing = enrollment.contentProgress.find((p) => String(p.trainingContent) === String(contentId));
  if (existing?.status === CONTENT_PROGRESS_STATUS.COMPLETED) {
    return { passed: true, score: existing.bestScore, attempts: existing.attempts, alreadyCompleted: true };
  }

  const { score, passed } = gradeSubmission(content, submission);
  const attempts = (existing?.attempts ?? 0) + 1;
  const bestScore = Math.max(existing?.bestScore ?? 0, score);

  upsertContentProgress(enrollment, contentId, {
    attempts,
    bestScore,
    status: passed ? CONTENT_PROGRESS_STATUS.COMPLETED : CONTENT_PROGRESS_STATUS.IN_PROGRESS,
    completedAt: passed ? new Date() : null,
  });

  if (passed) {
    await writeAudit({
      entityType: TRAINING_AUDIT_ENTITY_TYPE.FIELD_AGENT_TRAINING,
      entityId: enrollment._id,
      actorRef: userId,
      actorType: TRAINING_AUDIT_ACTOR_TYPE.AGENT,
      action: TRAINING_AUDIT_ACTION.CONTENT_COMPLETED,
      newValue: { contentId, contentType: content.contentType, score },
    });
  }

  await recomputeAndMaybeAdvance(enrollment, application);

  return { passed, score, attempts };
};

// ─── ADMIN OVERRIDE (RECOMMENDED / REQUIRES_APPROVAL) ─────────────
// Force-completes exactly one content item for one agent, then
// recomputes through the identical module/training completion +
// FA-2 handoff path used by real submissions — no separate override
// state machine. Every call MUST carry overrideClass + reason
// (validated at the controller/validator layer).

export const adminOverrideContentCompletion = async ({ adminId, agentUserId, contentId, overrideClass, reason }) => {
  const application = await getMyApplicationOrThrow(agentUserId);
  const enrollment = await FieldAgentTraining.findOne({ agentRef: agentUserId, isActive: true });
  if (!enrollment) throw Errors.notFound("Field Agent has no training enrollment");

  const content = await TrainingContent.findById(contentId);
  if (!content || String(content.trainingVersion) !== String(enrollment.trainingVersion)) {
    throw Errors.notFound("Content not found in this agent's training version");
  }

  const existing = enrollment.contentProgress.find((p) => String(p.trainingContent) === String(contentId));
  const oldValue = existing ? { status: existing.status } : { status: "NOT_STARTED" };

  upsertContentProgress(enrollment, contentId, {
    status: CONTENT_PROGRESS_STATUS.COMPLETED,
    completedAt: new Date(),
  });

  await writeAudit({
    entityType: TRAINING_AUDIT_ENTITY_TYPE.FIELD_AGENT_TRAINING,
    entityId: enrollment._id,
    actorRef: adminId,
    actorType: TRAINING_AUDIT_ACTOR_TYPE.ADMIN,
    action: TRAINING_AUDIT_ACTION.ADMIN_PROGRESS_OVERRIDE,
    oldValue,
    newValue: { contentId, status: CONTENT_PROGRESS_STATUS.COMPLETED, overrideClass },
    reason,
  });

  return recomputeAndMaybeAdvance(enrollment, application);
};

// ─── SIGNED MEDIA ACCESS ───────────────────────────────────────────

export const getMediaAccessUrl = async (userId, contentId) => {
  const application = await getMyApplicationOrThrow(userId);
  const enrollment = await FieldAgentTraining.findOne({ agentRef: userId, isActive: true });
  assertEligible(application, { existingEnrollment: enrollment, forWrite: false });
  if (!enrollment) throw Errors.notFound("Training not yet started");

  const content = await TrainingContent.findById(contentId);
  if (!content || String(content.trainingVersion) !== String(enrollment.trainingVersion)) {
    throw Errors.notFound("Content not found in your training version");
  }
  if (!content.media?.publicId) throw Errors.notFound("This content has no media");

  const { url, expiresAt } = getSignedMediaUrl({
    publicId: content.media.publicId,
    resourceType: content.media.resourceType,
  });

  await writeAudit({
    entityType: TRAINING_AUDIT_ENTITY_TYPE.TRAINING_CONTENT,
    entityId: content._id,
    actorRef: userId,
    actorType: TRAINING_AUDIT_ACTOR_TYPE.AGENT,
    action: TRAINING_AUDIT_ACTION.MEDIA_ACCESS_GRANTED,
    newValue: { expiresAt },
  });

  return { url, expiresAt };
};

export { assertEligible, getPublishedVersionOrThrow };
