/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTest/services/testContent.service.js
 *
 * FA-3.4.1 — admin authoring + governance: draft version creation,
 * question CRUD/reorder (DRAFT versions only — mutation of a
 * PUBLISHED version's questions is refused here, not merely
 * discouraged), publish/retire, discard.
 *
 * Audit scope is deliberately narrower than FA-3.3's TrainingAuditEvent
 * granularity: FA-3.4 PLAN V2 locks exactly 4 audit actions
 * (TEST_STARTED, TEST_SUBMITTED, TEST_VERSION_PUBLISHED,
 * TEST_VERSION_RETIRED) as the only approved additive change to FA-2's
 * frozen AUDIT_ACTION enum. This phase (FA-3.4.1) only ever reaches
 * TEST_VERSION_PUBLISHED/TEST_VERSION_RETIRED — draft creation,
 * question authoring, reorder, and discard are NOT separately audited
 * here (no VERSION_CREATED/VERSION_DISCARDED/QUESTION_* action exists
 * in the locked set). Events are written into FA-2's own, frozen
 * FieldAgentAuditEvent collection — imported and used unmodified, per
 * the approved plan's explicit choice not to create a second, parallel
 * audit collection the way FA-3.3 did.
 */

import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import TestVersion from "../models/TestVersion.js";
import TestQuestion from "../models/TestQuestion.js";
import FieldAgentAuditEvent from "../../fieldAgent/models/FieldAgentAuditEvent.js";
import { AUDIT_ACTOR_TYPE, AUDIT_ACTION } from "../../fieldAgent/constants/fieldAgent.constants.js";
import {
  TEST_VERSION_STATUS,
  TEST_AUDIT_ENTITY_TYPE,
  GRADING_TYPE,
  PASSING_SCORE_MIN,
  PASSING_SCORE_MAX,
  MAX_ATTEMPTS_MIN,
  RETRY_COOLDOWN_MINUTES_MIN,
  MIN_PUBLISHABLE_QUESTIONS,
  MAX_LIST_LIMIT,
  DEFAULT_LIST_LIMIT,
  DEFAULT_PASSING_SCORE,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_RETRY_COOLDOWN_MINUTES,
} from "../constants/fieldAgentTest.constants.js";

// FA-3.4.1 — defensive backstop only; the Joi query schema
// (testContent.validator.js) is the primary defense and already
// rejects an out-of-range `limit` with a 400 before this runs.
const clampLimit = (limit, fallback) => {
  const n = Number(limit) || fallback;
  return Math.max(1, Math.min(n, MAX_LIST_LIMIT));
};

// ─── AUTHOR-TIME + PUBLISH-TIME SHARED VALIDATORS ──────────────────

// A translation with fewer than 2 options cannot meaningfully be a
// single-choice question.
const validateOptionCounts = (translations) => {
  for (const t of translations || []) {
    if (!Array.isArray(t.options) || t.options.length < 2) {
      throw Errors.badRequest(`Translation "${t.languageCode}" must have at least 2 options`);
    }
  }
};

// correctOptionIndex must be a valid index into every APPROVED
// translation's options array — not just English's — so a rubric
// that's valid against English but out-of-bounds against an approved
// Hindi option list is still rejected (same rule
// FA-3.3.2.1.B established for TrainingContent's grading rubric).
const validateGradingRubric = ({ grading, translations }) => {
  if (!grading || grading.type !== GRADING_TYPE.SINGLE_CHOICE) {
    throw Errors.badRequest(`grading.type must be ${GRADING_TYPE.SINGLE_CHOICE}`);
  }
  const idx = grading.correctOptionIndex;
  if (!Number.isInteger(idx) || idx < 0) {
    throw Errors.badRequest("grading.correctOptionIndex must be a non-negative integer");
  }

  const approvedOptionSets = (translations || [])
    .filter((t) => t.approved && Array.isArray(t.options))
    .map((t) => t.options);

  for (const options of approvedOptionSets) {
    if (idx >= options.length) {
      throw Errors.badRequest(
        `grading.correctOptionIndex (${idx}) is out of bounds for an approved translation with ${options.length} option(s)`
      );
    }
  }
};

// A passingScore of 0 would let any submission (even a wrong one
// scoring 0) "pass" — same rationale as FA-3.3.2.1's per-content-item
// bound, applied here at the whole-version level.
const validateVersionBusinessRules = ({ passingScore, maxAttempts, retryCooldownMinutes }) => {
  if (passingScore == null || passingScore < PASSING_SCORE_MIN || passingScore > PASSING_SCORE_MAX) {
    throw Errors.badRequest(`passingScore must be between ${PASSING_SCORE_MIN} and ${PASSING_SCORE_MAX}`);
  }
  if (maxAttempts == null || !Number.isInteger(maxAttempts) || maxAttempts < MAX_ATTEMPTS_MIN) {
    throw Errors.badRequest(`maxAttempts must be an integer >= ${MAX_ATTEMPTS_MIN}`);
  }
  if (
    retryCooldownMinutes == null ||
    !Number.isInteger(retryCooldownMinutes) ||
    retryCooldownMinutes < RETRY_COOLDOWN_MINUTES_MIN
  ) {
    throw Errors.badRequest(`retryCooldownMinutes must be an integer >= ${RETRY_COOLDOWN_MINUTES_MIN}`);
  }
};

// Every question must carry an approved English translation —
// checked only at publish (English-mandatory, Hindi-optional gate).
const validateQuestionTranslations = (questions) => {
  for (const q of questions) {
    const hasApprovedEnglish = (q.translations || []).some((t) => t.languageCode === "en" && t.approved);
    if (!hasApprovedEnglish) {
      throw Errors.conflict(`Question ${q._id} has no approved 'en' translation — cannot publish`);
    }
  }
};

const getVersionOrThrow = async (versionId) => {
  const version = await TestVersion.findById(versionId);
  if (!version) throw Errors.notFound("Test version not found");
  return version;
};

const assertDraft = (version) => {
  if (version.status !== TEST_VERSION_STATUS.DRAFT) {
    throw Errors.conflict(`Version ${version.versionNumber} is ${version.status}, not DRAFT — it is immutable`);
  }
};

// ─── VERSIONS ─────────────────────────────────────────────────────

export const createDraftVersion = async ({ adminId, notes, passingScore, maxAttempts, retryCooldownMinutes }) => {
  // Falls back to the locked V1 defaults for any field the admin
  // didn't override.
  const withDefaults = {
    passingScore: passingScore ?? DEFAULT_PASSING_SCORE,
    maxAttempts: maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    retryCooldownMinutes: retryCooldownMinutes ?? DEFAULT_RETRY_COOLDOWN_MINUTES,
  };
  validateVersionBusinessRules(withDefaults);

  const last = await TestVersion.findOne().sort({ versionNumber: -1 }).select("versionNumber").lean();
  const versionNumber = (last?.versionNumber ?? 0) + 1;

  return TestVersion.create({
    versionNumber,
    notes: notes ?? null,
    ...withDefaults,
    createdBy: adminId,
  });
};

export const listVersions = ({ page = 1, limit = DEFAULT_LIST_LIMIT.VERSIONS } = {}) => {
  const safeLimit = clampLimit(limit, DEFAULT_LIST_LIMIT.VERSIONS);
  const safePage = Math.max(1, Number(page) || 1);
  return TestVersion.find()
    .sort({ versionNumber: -1 })
    .skip((safePage - 1) * safeLimit)
    .limit(safeLimit)
    .lean();
};

export const getVersionDetail = async (versionId) => {
  const version = await getVersionOrThrow(versionId);
  const questions = await TestQuestion.find({ testVersion: versionId })
    .select("+grading")
    .sort({ order: 1 })
    .lean();
  return { version, questions };
};

// DRAFT-only. Lets an admin tune whole-test settings while authoring,
// before publish freezes them permanently — TrainingVersion has no
// analogous need (its only top-level field is display-only `notes`).
export const updateDraftVersion = async ({ versionId, adminId, notes, passingScore, maxAttempts, retryCooldownMinutes }) => {
  const version = await getVersionOrThrow(versionId);
  assertDraft(version);

  const merged = {
    passingScore: passingScore ?? version.passingScore,
    maxAttempts: maxAttempts ?? version.maxAttempts,
    retryCooldownMinutes: retryCooldownMinutes ?? version.retryCooldownMinutes,
  };
  validateVersionBusinessRules(merged);

  version.passingScore = merged.passingScore;
  version.maxAttempts = merged.maxAttempts;
  version.retryCooldownMinutes = merged.retryCooldownMinutes;
  if (notes !== undefined) version.notes = notes;

  await version.save();
  return version;
};

// ─── QUESTIONS (DRAFT versions only) ──────────────────────────────

export const addQuestion = async ({ versionId, translations, grading, adminId }) => {
  const version = await getVersionOrThrow(versionId);
  assertDraft(version);

  validateOptionCounts(translations);
  validateGradingRubric({ grading, translations });

  const existingCount = await TestQuestion.countDocuments({ testVersion: versionId });

  return TestQuestion.create({
    testVersion: versionId,
    order: existingCount,
    translations,
    grading,
  });
};

export const updateQuestion = async ({ questionId, patch, adminId }) => {
  const question = await TestQuestion.findById(questionId).select("+grading");
  if (!question) throw Errors.notFound("Test question not found");

  const version = await getVersionOrThrow(question.testVersion);
  assertDraft(version);

  const allowedFields = ["translations", "grading", "active"];
  for (const field of allowedFields) {
    if (patch[field] !== undefined) question[field] = patch[field];
  }

  validateOptionCounts(question.translations);
  validateGradingRubric({ grading: question.grading, translations: question.translations });

  await question.save();
  return question;
};

export const deleteQuestion = async ({ questionId, adminId }) => {
  const question = await TestQuestion.findById(questionId);
  if (!question) throw Errors.notFound("Test question not found");

  const version = await getVersionOrThrow(question.testVersion);
  assertDraft(version);

  await question.deleteOne();
};

// ─── QUESTION REORDER (DRAFT versions only) ───────────────────────
// Two-phase atomic reorder within one transaction — identical idiom
// to FA-3.3.2.2's reorderModuleContent: phase 1 moves every question
// to a temporary, guaranteed-unique NEGATIVE order (clearing the
// {testVersion,order} unique index's collision space), phase 2
// assigns the real, contiguous, 0-based target order. A naive
// single-pass reassignment would collide with whichever question
// currently holds the target order value.
const MAX_REORDER_ATTEMPTS = 3;

export const reorderQuestions = async ({ versionId, orderedQuestionIds, adminId }) => {
  const version = await getVersionOrThrow(versionId);
  assertDraft(version);

  const existing = await TestQuestion.find({ testVersion: versionId }).select("_id order").lean();
  const existingIds = existing.map((q) => String(q._id));
  const requestedIds = orderedQuestionIds.map(String);

  const isExactPermutation =
    requestedIds.length === existingIds.length &&
    new Set(requestedIds).size === requestedIds.length &&
    existingIds.every((id) => requestedIds.includes(id));
  if (!isExactPermutation) {
    throw Errors.badRequest(
      "orderedQuestionIds must be exactly a permutation of this version's existing question ids — no missing, extra, or duplicate entries"
    );
  }

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_REORDER_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      for (let i = 0; i < requestedIds.length; i++) {
        await TestQuestion.updateOne(
          { _id: requestedIds[i], testVersion: versionId },
          { $set: { order: -(i + 1) } },
          { session }
        );
      }
      for (let i = 0; i < requestedIds.length; i++) {
        await TestQuestion.updateOne(
          { _id: requestedIds[i], testVersion: versionId },
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
      throw Errors.conflict("Reorder could not complete due to a concurrent update on this version — refetch and retry");
    }
    throw lastErr;
  }

  return TestQuestion.find({ testVersion: versionId }).sort({ order: 1 }).lean();
};

// ─── PUBLISH / RETIRE ─────────────────────────────────────────────

const assertVersionPublishable = async (version) => {
  validateVersionBusinessRules({
    passingScore: version.passingScore,
    maxAttempts: version.maxAttempts,
    retryCooldownMinutes: version.retryCooldownMinutes,
  });

  const questions = await TestQuestion.find({ testVersion: version._id, active: true })
    .select("+grading")
    .sort({ order: 1 })
    .lean();

  if (questions.length < MIN_PUBLISHABLE_QUESTIONS) {
    throw Errors.conflict(
      `Version has ${questions.length}/${MIN_PUBLISHABLE_QUESTIONS} minimum active questions — cannot publish`
    );
  }

  validateQuestionTranslations(questions);

  for (const q of questions) {
    try {
      validateOptionCounts(q.translations);
      validateGradingRubric({ grading: q.grading, translations: q.translations });
    } catch (err) {
      throw Errors.conflict(`Question ${q._id}: ${err.message}`);
    }
  }
};

export const publishVersion = async ({ versionId, adminId }) => {
  const version = await getVersionOrThrow(versionId);
  assertDraft(version);
  await assertVersionPublishable(version);

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const currentlyPublished = await TestVersion.findOne({ status: TEST_VERSION_STATUS.PUBLISHED }).session(session);
    if (currentlyPublished) {
      currentlyPublished.status = TEST_VERSION_STATUS.RETIRED;
      currentlyPublished.retiredAt = new Date();
      currentlyPublished.retiredBy = adminId;
      await currentlyPublished.save({ session });

      await FieldAgentAuditEvent.create(
        [
          {
            entityType: TEST_AUDIT_ENTITY_TYPE.TEST_VERSION,
            entityId: currentlyPublished._id,
            actorRef: adminId,
            actorType: AUDIT_ACTOR_TYPE.ADMIN,
            action: AUDIT_ACTION.TEST_VERSION_RETIRED,
            reason: `Superseded by version ${version.versionNumber}`,
          },
        ],
        { session }
      );
    }

    version.status = TEST_VERSION_STATUS.PUBLISHED;
    version.publishedAt = new Date();
    version.publishedBy = adminId;
    await version.save({ session });

    await FieldAgentAuditEvent.create(
      [
        {
          entityType: TEST_AUDIT_ENTITY_TYPE.TEST_VERSION,
          entityId: version._id,
          actorRef: adminId,
          actorType: AUDIT_ACTOR_TYPE.ADMIN,
          action: AUDIT_ACTION.TEST_VERSION_PUBLISHED,
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
  if (version.status !== TEST_VERSION_STATUS.PUBLISHED) {
    throw Errors.conflict(`Version ${version.versionNumber} is ${version.status}, not PUBLISHED`);
  }

  version.status = TEST_VERSION_STATUS.RETIRED;
  version.retiredAt = new Date();
  version.retiredBy = adminId;
  await version.save();

  await FieldAgentAuditEvent.create([
    {
      entityType: TEST_AUDIT_ENTITY_TYPE.TEST_VERSION,
      entityId: version._id,
      actorRef: adminId,
      actorType: AUDIT_ACTOR_TYPE.ADMIN,
      action: AUDIT_ACTION.TEST_VERSION_RETIRED,
      reason: reason ?? "Manually retired by admin",
    },
  ]).catch((err) => {
    console.error("❌ FA-3.4 FieldAgentAuditEvent write failed:", err.message || err);
  });

  return version;
};

// ─── DRAFT DISCARD (DRAFT versions only) ──────────────────────────
// Permanently deletes a DRAFT version and every TestQuestion under
// it — one all-or-nothing transaction, so no partial deletion is
// possible even on crash and no orphan TestQuestion can ever result.
// No media cleanup phase needed (test questions carry no media in
// V1, unlike TrainingContent). Idempotent: re-invoking after a
// successful discard returns 404 — the correct "safe to call again"
// behavior for a destructive operation.
export const discardDraftVersion = async ({ versionId, adminId }) => {
  const version = await getVersionOrThrow(versionId);
  if (version.status !== TEST_VERSION_STATUS.DRAFT) {
    throw Errors.conflict(`Version ${version.versionNumber} is ${version.status}, not DRAFT — it cannot be discarded`);
  }

  const versionNumber = version.versionNumber;
  const questionCount = await TestQuestion.countDocuments({ testVersion: versionId });

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    await TestQuestion.deleteMany({ testVersion: versionId }, { session });
    await TestVersion.deleteOne({ _id: versionId }, { session });
    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }

  return { versionNumber, questionCount };
};
