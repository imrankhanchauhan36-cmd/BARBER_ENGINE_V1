/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTest/services/fieldAgentTest.service.js
 *
 * FA-3.4.2 — TestAttempt lifecycle: start, question delivery, and
 * server-authoritative submission/scoring. Service layer only — no
 * HTTP controller/route wires to this yet (FA-3.4.3). Every ownership
 * check below takes `userId` as a plain parameter; the eventual
 * controller is responsible for deriving it from `req.user._id`
 * (never from client-supplied input), same identity-derivation
 * convention as every other module in this codebase.
 *
 * The one cross-module dependency is FA-2's own frozen
 * assertValidTransition/setApplicationStatus + APPLICATION_STATUS +
 * FieldAgentApplication — imported directly, never duplicated or
 * redesigned (same pattern fieldAgentTraining.service.js already
 * uses for its own TRAINING_PENDING -> TEST_PENDING handoff).
 *
 * FA-3.4.3 — TEST_STARTED/TEST_SUBMITTED audit events (approved,
 * PLAN V2 §17) are now written HERE, inside each function's own
 * existing transaction, never at the HTTP/controller layer — only
 * this layer holds the transaction session, and only this layer can
 * guarantee "one audit event per actual attempt creation/finalization,
 * never one per HTTP retry" (see the idempotency notes at each call
 * site below). This is an additive change only: no existing exported
 * function's signature, return shape, or business logic changed.
 * getTestStatus is a new, additive export for FA-3.4.3's status
 * endpoint — it reuses the same helpers/models, never duplicates
 * eligibility logic that already lives in startTestAttempt.
 */

import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import TestVersion from "../models/TestVersion.js";
import TestQuestion from "../models/TestQuestion.js";
import TestAttempt from "../models/TestAttempt.js";
import FieldAgentApplication from "../../fieldAgent/models/FieldAgentApplication.js";
import FieldAgentAuditEvent from "../../fieldAgent/models/FieldAgentAuditEvent.js";
import { assertValidTransition, setApplicationStatus } from "../../fieldAgent/services/fieldAgentApplication.service.js";
import { APPLICATION_STATUS, AUDIT_ACTOR_TYPE, AUDIT_ACTION } from "../../fieldAgent/constants/fieldAgent.constants.js";
import {
  TEST_VERSION_STATUS,
  TEST_ATTEMPT_STATUS,
  TEST_AUDIT_ENTITY_TYPE,
  MIN_PUBLISHABLE_QUESTIONS,
  SUBMISSION_CLAIM_STALE_MS,
} from "../constants/fieldAgentTest.constants.js";

const TESTABLE_APPLICATION_STATUSES = [APPLICATION_STATUS.TEST_PENDING, APPLICATION_STATUS.TEST_FAILED];

// ─── SHARED HELPERS ─────────────────────────────────────────────────

const getApplicationOrThrow = async (userId) => {
  // Most recent application for this user — same "sort + limit rather
  // than assume findOne returns the current one" convention as FA-2's
  // own getMyApplication and FA-3.3's getMyApplicationOrThrow.
  const application = await FieldAgentApplication.findOne({ userRef: userId }).sort({ createdAt: -1 });
  if (!application) throw Errors.notFound("No Field Agent application found for this user");
  return application;
};

const getPublishedTestVersionOrThrow = async () => {
  const version = await TestVersion.findOne({ status: TEST_VERSION_STATUS.PUBLISHED });
  if (!version) throw Errors.notFound("No published test version is currently available");
  return version;
};

// PLAN V2 Correction 4 — Mongo's `$in` does not preserve input array
// order. `questionRefs` is the sole authoritative sequence; every read
// site (delivery AND grading) reconstructs order from it explicitly,
// never from query result order. Also the fail-safe checkpoint for
// PLAN V2 §8 ("if questions are missing unexpectedly for a pinned
// attempt, fail safely") — a PUBLISHED TestQuestion can never
// legitimately go missing (assertDraft blocks delete on anything but
// DRAFT), so a gap here indicates data corruption, not a normal race,
// and is treated as a hard failure rather than silently scoring a
// partial set.
const loadQuestionsInAttemptOrder = async (questionRefs, { withGrading = false } = {}) => {
  let query = TestQuestion.find({ _id: { $in: questionRefs } });
  if (withGrading) query = query.select("+grading");
  const docs = await query.lean();

  const byId = new Map(docs.map((q) => [String(q._id), q]));
  const ordered = questionRefs.map((id) => byId.get(String(id)));

  if (ordered.some((q) => !q)) {
    throw Errors.conflict(
      "This attempt's pinned question set is incomplete — published questions are immutable and should never go missing"
    );
  }
  return ordered;
};

// ─── START ATTEMPT ──────────────────────────────────────────────────
// PLAN V2 Correction 1/6 — the DB-enforced partial unique index on
// TestAttempt ({applicationRef} unique where status:"IN_PROGRESS") is
// the actual concurrency guarantee, not the attemptCount read below
// (which is inherently approximate under a race — see the model's own
// header for why {applicationRef,attemptNumber} alone is
// insufficient). attemptCount is used only to pre-check maxAttempts
// as a fast-fail; the index is what makes it impossible for a race to
// ever create more attempts than maxAttempts actually allows,
// regardless of what any individual racer's stale read believed.
export const startTestAttempt = async ({ userId }) => {
  const application = await getApplicationOrThrow(userId);

  if (!TESTABLE_APPLICATION_STATUSES.includes(application.status)) {
    throw Errors.conflict(`Application status ${application.status} is not eligible to start a test`);
  }

  const attemptCount = await TestAttempt.countDocuments({ applicationRef: application._id });
  const currentVersion = await getPublishedTestVersionOrThrow();

  if (attemptCount >= currentVersion.maxAttempts) {
    throw Errors.conflict("Maximum test attempts reached for this application");
  }

  if (application.status === APPLICATION_STATUS.TEST_FAILED) {
    const lastFailed = await TestAttempt.findOne({
      applicationRef: application._id,
      status: TEST_ATTEMPT_STATUS.FAILED,
    }).sort({ submittedAt: -1 });

    if (lastFailed?.submittedAt) {
      const cooldownEndsAt = new Date(lastFailed.submittedAt.getTime() + currentVersion.retryCooldownMinutes * 60000);
      if (Date.now() < cooldownEndsAt.getTime()) {
        throw Errors.conflict("Retry cooldown has not elapsed", { retryAt: cooldownEndsAt.toISOString() });
      }
    }
  }

  // Deterministic, server-defined, fixed question set — no
  // randomization (locked V1 rule). Captured now and never
  // re-resolved later (see TestAttempt.js header on pinning).
  const activeQuestions = await TestQuestion.find({ testVersion: currentVersion._id, active: true })
    .sort({ order: 1 })
    .select("_id")
    .lean();
  if (activeQuestions.length < MIN_PUBLISHABLE_QUESTIONS) {
    throw Errors.conflict("Published test version does not have enough active questions to be tested against");
  }
  const questionRefs = activeQuestions.map((q) => q._id);

  // Bounded retry loop — two DISTINCT kinds of conflict can surface
  // here under real concurrent load against a real MongoDB replica
  // set, and they require different handling:
  //   1. A duplicate-key error (11000) on either TestAttempt index —
  //      another request has DEFINITELY already won; idempotent
  //      recovery (return its attempt), never a retry.
  //   2. A transient transaction conflict (MongoDB's own
  //      TransientTransactionError label, or a raw WriteConflict) —
  //      two transactions touched overlapping documents at the same
  //      moment and MongoDB itself asks the client to retry the WHOLE
  //      transaction (not just the commit) — this is the documented,
  //      expected behavior of multi-document transactions under
  //      genuine concurrency, not a bug; an unhandled instance of it
  //      is what actually crashed this function's very first
  //      concurrent-start test run (see FA-3.4.2 deliverable notes).
  const MAX_START_TX_ATTEMPTS = 5;
  let lastErr = null;

  for (let attemptNo = 1; attemptNo <= MAX_START_TX_ATTEMPTS; attemptNo++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      // Always re-read the application's LIVE status inside this
      // transaction's own snapshot — never decide the transition off
      // the `application` variable captured before the loop started.
      // That stale outer read is what a losing, RETRIED racer must
      // not trust: by the time its retry runs, a concurrent winner
      // may have already committed the exact TEST_FAILED ->
      // TEST_PENDING flip this racer was about to attempt again,
      // which would otherwise throw "Cannot transition ... TEST_PENDING
      // to TEST_PENDING" — a real bug this fixed, not a hypothetical
      // one (see FA-3.4.2 deliverable notes).
      const freshApplication = await FieldAgentApplication.findById(application._id).session(session);

      if (freshApplication.status === APPLICATION_STATUS.TEST_FAILED) {
        // Retry: the TEST_FAILED -> TEST_PENDING transition and the
        // new attempt's creation commit or abort together — an
        // application can never end up TEST_PENDING without a
        // corresponding attempt, or vice versa.
        assertValidTransition(freshApplication.status, APPLICATION_STATUS.TEST_PENDING);
        setApplicationStatus(freshApplication, APPLICATION_STATUS.TEST_PENDING);
        await freshApplication.save({ session });
      } else if (freshApplication.status !== APPLICATION_STATUS.TEST_PENDING) {
        // A concurrent winner already advanced this application past
        // TEST_PENDING (or something else entirely changed it) between
        // this call's initial eligibility check and this transaction —
        // fail closed rather than silently creating an attempt against
        // an unexpected state; the caller sees an accurate conflict.
        throw Errors.conflict(`Application status is ${freshApplication.status}, no longer eligible to start a test`);
      }
      // else: already TEST_PENDING — a concurrent winner's own
      // TEST_FAILED->TEST_PENDING transition already landed; proceed
      // straight to attempt creation below, where the unique indexes
      // correctly resolve the resulting collision via the existing
      // 11000 recovery path.

      const attemptNumber = attemptCount + 1;
      const created = await TestAttempt.create(
        [
          {
            applicationRef: application._id,
            agentRef: userId,
            testVersionRef: currentVersion._id,
            attemptNumber,
            questionRefs,
            startedAt: new Date(),
          },
        ],
        { session }
      );

      // TEST_STARTED — written in the SAME transaction as the attempt
      // itself, so the two either both commit or both abort together.
      // This line is reached ONLY on an actual new TestAttempt
      // document being created — never on the idempotent "return the
      // existing active attempt" recovery path below (11000 branch),
      // which is exactly the required idempotency rule: a client
      // retrying the same start request while one attempt is already
      // active produces no duplicate TEST_STARTED event, because it
      // never reaches this line at all.
      await FieldAgentAuditEvent.create(
        [
          {
            entityType: TEST_AUDIT_ENTITY_TYPE.TEST_ATTEMPT,
            entityId: created[0]._id,
            actorRef: userId,
            actorType: AUDIT_ACTOR_TYPE.AGENT,
            action: AUDIT_ACTION.TEST_STARTED,
            newValue: {
              applicationRef: application._id,
              testVersionRef: currentVersion._id,
              attemptNumber,
            },
          },
        ],
        { session }
      );

      await session.commitTransaction();
      return created[0];
    } catch (err) {
      await session.abortTransaction();
      lastErr = err;

      if (err.code === 11000) {
        // Another request already created (or is creating) the one
        // allowed active attempt for this application — idempotent
        // recovery for the loser of a legitimate race, never an
        // error (PLAN V2 Correction 1). Covers both the partial
        // single-active-attempt index and the {applicationRef,
        // attemptNumber} index — in either case the correct behavior
        // is identical: return the attempt that actually won.
        const existing = await TestAttempt.findOne({
          applicationRef: application._id,
          status: TEST_ATTEMPT_STATUS.IN_PROGRESS,
        });
        if (existing) return existing;
        // Duplicate key but no committed IN_PROGRESS attempt visible
        // yet (the winner's own commit hasn't landed this instant) —
        // retry; it will be visible within a retry or two.
        continue;
      }

      const isTransientConflict =
        err.hasErrorLabel?.("TransientTransactionError") || err.code === 112 || err.codeName === "WriteConflict";
      if (isTransientConflict) continue;

      throw err;
    } finally {
      session.endSession();
    }
  }

  throw lastErr;
};

// ─── QUESTION DELIVERY ──────────────────────────────────────────────

export const getAttemptQuestions = async ({ userId, attemptId }) => {
  const attempt = await TestAttempt.findById(attemptId).lean();
  // Never reveal existence to a non-owner — 404, not 403, same IDOR
  // convention as every other agent-facing ownership check in this
  // codebase.
  if (!attempt || String(attempt.agentRef) !== String(userId)) {
    throw Errors.notFound("Test attempt not found");
  }

  const questions = await loadQuestionsInAttemptOrder(attempt.questionRefs, { withGrading: false });

  return {
    attemptId: attempt._id,
    status: attempt.status,
    questions: questions.map((q) => ({
      _id: q._id,
      // Only approved translations, and only the fields an agent
      // needs to answer — no `grading` (excluded by not selecting
      // it), no `approved` flag, no `active` flag, no authoring
      // metadata.
      translations: (q.translations || [])
        .filter((t) => t.approved)
        .map((t) => ({ languageCode: t.languageCode, questionText: t.questionText, options: t.options })),
    })),
  };
};

// ─── SUBMISSION / SCORING ───────────────────────────────────────────
// PLAN V2 Correction 2 — submissionClaimedAt is a TECHNICAL mutex
// only; `status` never leaves {IN_PROGRESS,PASSED,FAILED}. The claim
// query's $or clause is the self-healing mechanism: a claim older
// than SUBMISSION_CLAIM_STALE_MS is treated as abandoned (e.g. a
// process crash between claiming and finalizing) and can be
// reacquired — no attempt can ever be permanently stranded.
export const submitTestAttempt = async ({ userId, attemptId, answers }) => {
  // 1-3: authenticate (by caller contract) + resolve ownership.
  const attempt = await TestAttempt.findById(attemptId);
  if (!attempt || String(attempt.agentRef) !== String(userId)) {
    throw Errors.notFound("Test attempt not found");
  }

  // 4: fast-fail before doing any work; the atomic claim below is the
  // actual enforcement under concurrency.
  if (attempt.status !== TEST_ATTEMPT_STATUS.IN_PROGRESS) {
    throw Errors.conflict("This attempt has already been finalized");
  }

  // 5: atomic submission claim — the entire mutex is this one
  // conditional update; MongoDB guarantees only one concurrent caller
  // can match-and-update a given document per operation.
  const staleCutoff = new Date(Date.now() - SUBMISSION_CLAIM_STALE_MS);
  const claimed = await TestAttempt.findOneAndUpdate(
    {
      _id: attemptId,
      agentRef: userId,
      status: TEST_ATTEMPT_STATUS.IN_PROGRESS,
      $or: [{ submissionClaimedAt: null }, { submissionClaimedAt: { $lt: staleCutoff } }],
    },
    { $set: { submissionClaimedAt: new Date() } },
    { new: true }
  );
  if (!claimed) {
    throw Errors.conflict("This attempt is already being submitted, or has already been finalized");
  }

  // Best-effort release, conditioned on matching the exact claim
  // timestamp this call itself set — never releases a different,
  // later claim if requests are out of order. Called on every
  // failure path after a successful claim so malformed input or a
  // downstream failure never permanently consumes the attempt.
  const releaseClaim = () =>
    TestAttempt.updateOne(
      { _id: claimed._id, submissionClaimedAt: claimed.submissionClaimedAt },
      { $set: { submissionClaimedAt: null } }
    ).catch(() => {});

  try {
    // 6: explicitly load the PINNED TestVersion — never the currently
    // published one (PLAN V2 Correction 3).
    const pinnedVersion = await TestVersion.findById(claimed.testVersionRef);
    if (!pinnedVersion) {
      throw Errors.conflict("This attempt's pinned test version no longer exists");
    }

    // 7: the attempt's own pinned question set, authoritative order,
    // WITH grading — this is the one trusted call site allowed to
    // read it.
    const pinnedQuestions = await loadQuestionsInAttemptOrder(claimed.questionRefs, { withGrading: true });

    // 8: validate submitted answer structure.
    if (!Array.isArray(answers)) {
      throw Errors.badRequest("answers must be an array");
    }
    for (const a of answers) {
      if (!a || typeof a !== "object" || a.questionId === undefined || a.questionId === null) {
        throw Errors.badRequest("Each answer must include a questionId");
      }
      if (a.selectedOptionIndex !== undefined && a.selectedOptionIndex !== null && !Number.isInteger(a.selectedOptionIndex)) {
        throw Errors.badRequest(`Invalid selectedOptionIndex for question ${a.questionId}`);
      }
    }

    // 9: reject unknown question ids — never silently ignored.
    const pinnedIdSet = new Set(claimed.questionRefs.map(String));
    for (const a of answers) {
      if (!pinnedIdSet.has(String(a.questionId))) {
        throw Errors.badRequest(`Unknown question id in submission: ${a.questionId}`);
      }
    }

    // 10: reject duplicate answer entries — never first/last-write-wins.
    const seenIds = new Set();
    for (const a of answers) {
      const key = String(a.questionId);
      if (seenIds.has(key)) {
        throw Errors.badRequest(`Duplicate answer for question ${a.questionId}`);
      }
      seenIds.add(key);
    }

    // 11/12: reject invalid option indices (bounds-checked against the
    // pinned question's own approved English options — English is
    // guaranteed present by the publish gate); a genuinely missing
    // answer is left for scoring to treat as incorrect, not rejected.
    const answerByQuestionId = new Map(answers.map((a) => [String(a.questionId), a]));
    for (const q of pinnedQuestions) {
      const submitted = answerByQuestionId.get(String(q._id));
      if (!submitted || submitted.selectedOptionIndex === undefined || submitted.selectedOptionIndex === null) continue;

      const enTranslation = (q.translations || []).find((t) => t.languageCode === "en");
      const optionCount = enTranslation?.options?.length ?? 0;
      if (submitted.selectedOptionIndex < 0 || submitted.selectedOptionIndex >= optionCount) {
        throw Errors.badRequest(`Invalid selectedOptionIndex for question ${q._id}`);
      }
    }

    // 13: calculate score server-side, from the trusted, pinned
    // TestQuestion.grading only — never client input.
    let correctCount = 0;
    const finalAnswers = pinnedQuestions.map((q) => {
      const submitted = answerByQuestionId.get(String(q._id));
      const selectedOptionIndex = submitted?.selectedOptionIndex ?? null;
      const isCorrect = selectedOptionIndex !== null && selectedOptionIndex === q.grading?.correctOptionIndex;
      if (isCorrect) correctCount += 1;
      return { questionRef: q._id, selectedOptionIndex, isCorrect };
    });

    const totalQuestions = pinnedQuestions.length;
    const score = Math.round((correctCount / totalQuestions) * 100);

    // 14: pass/fail against the PINNED version's passingScore —
    // never the currently published version's.
    const passed = score >= pinnedVersion.passingScore;
    const newStatus = passed ? TEST_ATTEMPT_STATUS.PASSED : TEST_ATTEMPT_STATUS.FAILED;

    // 15/16: finalize the attempt + apply the FA-2 transition in one
    // transaction — both commit or both abort together, so a failed
    // transition can never leave a PASSED/FAILED attempt pointing at
    // an application still sitting in TEST_PENDING (or vice versa).
    // The submission claim already serializes concurrent submits on
    // THIS attempt down to a single winner before this point is ever
    // reached, but a bounded retry on a transient MongoDB write
    // conflict is kept here too (same idiom as startTestAttempt's own
    // retry loop) as defense-in-depth against an unrelated concurrent
    // write on the same application/attempt document.
    const MAX_SUBMIT_TX_ATTEMPTS = 3;
    let submitLastErr = null;
    let finalized = false;

    for (let attemptNo = 1; attemptNo <= MAX_SUBMIT_TX_ATTEMPTS && !finalized; attemptNo++) {
      const session = await mongoose.startSession();
      try {
        session.startTransaction();

        const liveAttempt = await TestAttempt.findById(claimed._id).session(session);
        liveAttempt.status = newStatus;
        liveAttempt.answers = finalAnswers;
        liveAttempt.score = score;
        liveAttempt.passed = passed;
        liveAttempt.submittedAt = new Date();
        await liveAttempt.save({ session });

        const freshApplication = await FieldAgentApplication.findById(claimed.applicationRef).session(session);
        const targetAppStatus = passed ? APPLICATION_STATUS.ADMIN_REVIEW : APPLICATION_STATUS.TEST_FAILED;
        assertValidTransition(freshApplication.status, targetAppStatus);
        setApplicationStatus(freshApplication, targetAppStatus);
        await freshApplication.save({ session });

        // TEST_SUBMITTED — same transaction as the attempt finalize +
        // FA-2 handoff, so all three commit or abort together. Reached
        // only once per successful finalization: the submission claim
        // (above) already serializes concurrent submits on this
        // attempt to a single winner before this transaction is ever
        // entered, and this transaction itself never runs for a
        // validation failure (those throw before reaching this block)
        // or for an FA-2 transition failure (assertValidTransition
        // throws inside this same try, aborting before commit — see
        // the transaction-failure proof in FA-3.4.2's own regression).
        // Safe metadata only — score/passed/attemptNumber, never the
        // submitted answer payload or any grading/answer-key detail.
        await FieldAgentAuditEvent.create(
          [
            {
              entityType: TEST_AUDIT_ENTITY_TYPE.TEST_ATTEMPT,
              entityId: claimed._id,
              actorRef: userId,
              actorType: AUDIT_ACTOR_TYPE.AGENT,
              action: AUDIT_ACTION.TEST_SUBMITTED,
              newValue: {
                applicationRef: claimed.applicationRef,
                testVersionRef: claimed.testVersionRef,
                attemptNumber: claimed.attemptNumber,
                score,
                passed,
              },
            },
          ],
          { session }
        );

        await session.commitTransaction();
        finalized = true;
      } catch (err) {
        await session.abortTransaction();
        submitLastErr = err;

        const isTransientConflict =
          err.hasErrorLabel?.("TransientTransactionError") || err.code === 112 || err.codeName === "WriteConflict";
        if (!isTransientConflict) throw err;
      } finally {
        session.endSession();
      }
    }

    if (!finalized) throw submitLastErr;

    // 17: return only safe result data — never the answer key, never
    // per-question correctness detail.
    return { attemptId: claimed._id, score, passed, status: newStatus };
  } catch (err) {
    await releaseClaim();
    throw err;
  }
};

// ─── TEST STATUS (FA-3.4.3, additive) ────────────────────────────────
// Read-only, derived entirely from server state (application status +
// live TestAttempt/TestVersion documents) — never from anything the
// client asserts. Deliberately does NOT re-implement startTestAttempt's
// own eligibility logic (max attempts / cooldown / testable states) —
// it reads the same underlying data those checks use and reports it,
// but the actual enforcement stays solely in startTestAttempt/
// submitTestAttempt, so there is exactly one place business rules can
// diverge from what this status reports.
export const getTestStatus = async ({ userId }) => {
  const application = await getApplicationOrThrow(userId);

  const activeAttempt = await TestAttempt.findOne({
    applicationRef: application._id,
    status: TEST_ATTEMPT_STATUS.IN_PROGRESS,
  }).lean();

  const attemptsUsed = await TestAttempt.countDocuments({ applicationRef: application._id });
  const currentVersion = await TestVersion.findOne({ status: TEST_VERSION_STATUS.PUBLISHED }).lean();

  let cooldownUntil = null;
  if (!activeAttempt && application.status === APPLICATION_STATUS.TEST_FAILED && currentVersion) {
    const lastFailed = await TestAttempt.findOne({
      applicationRef: application._id,
      status: TEST_ATTEMPT_STATUS.FAILED,
    })
      .sort({ submittedAt: -1 })
      .lean();
    if (lastFailed?.submittedAt) {
      const candidate = new Date(lastFailed.submittedAt.getTime() + currentVersion.retryCooldownMinutes * 60000);
      if (candidate.getTime() > Date.now()) cooldownUntil = candidate;
    }
  }

  const maxAttempts = currentVersion?.maxAttempts ?? null;
  const remainingAttempts = maxAttempts != null ? Math.max(0, maxAttempts - attemptsUsed) : null;

  const testingAvailable =
    !!activeAttempt ||
    (TESTABLE_APPLICATION_STATUSES.includes(application.status) &&
      !!currentVersion &&
      remainingAttempts > 0 &&
      !cooldownUntil);

  // Phase 4 (Test Module UI) — additive only, read-only display data for
  // the Test Overview screen (Total Questions / Passing Score). Reuses
  // `currentVersion`, already loaded above; no new eligibility/grading
  // logic, no change to any existing field this function already returns.
  const totalQuestions = currentVersion
    ? await TestQuestion.countDocuments({ testVersion: currentVersion._id, active: true })
    : null;

  return {
    applicationStatus: application.status,
    testingAvailable,
    activeAttempt: activeAttempt
      ? { attemptId: activeAttempt._id, attemptNumber: activeAttempt.attemptNumber, startedAt: activeAttempt.startedAt }
      : null,
    attemptNumber: activeAttempt?.attemptNumber ?? null,
    attemptsUsed,
    maxAttempts,
    remainingAttempts,
    cooldownUntil,
    passingScore: currentVersion?.passingScore ?? null,
    totalQuestions,
  };
};
