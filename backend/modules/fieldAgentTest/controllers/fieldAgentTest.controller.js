/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgentTest/controllers/fieldAgentTest.controller.js
 *
 * FA-3.4.3 — thin controllers only (DTO shaping, no business logic),
 * matching the exact layering already proven by
 * fieldAgentTraining.controller.js. Identity is always req.user._id —
 * never a client-supplied agent id. Every business rule, scoring
 * decision, and FA-2 transition lives in fieldAgentTest.service.js
 * (FA-3.4.2, unmodified in its contracts) — these handlers only
 * translate HTTP <-> service calls.
 */

import { successResponse } from "../../../utils/response.js";
import {
  getTestStatus,
  startTestAttempt,
  getAttemptQuestions,
  submitTestAttempt,
} from "../services/fieldAgentTest.service.js";

export const getTestStatusHandler = async (req, res, next) => {
  try {
    const status = await getTestStatus({ userId: req.user._id });
    return successResponse(res, { message: "Test status fetched", data: { status } });
  } catch (err) {
    return next(err);
  }
};

export const startTestAttemptHandler = async (req, res, next) => {
  try {
    const attempt = await startTestAttempt({ userId: req.user._id });
    // Same response whether this call created a brand-new attempt or
    // idempotently returned an already-active one — the client cannot
    // distinguish the two and does not need to; GET /attempts/:id is
    // the next call either way.
    return successResponse(res, {
      message: "Test attempt ready",
      data: {
        attempt: {
          attemptId: attempt._id,
          attemptNumber: attempt.attemptNumber,
          status: attempt.status,
          startedAt: attempt.startedAt,
          questionCount: attempt.questionRefs.length,
        },
      },
    });
  } catch (err) {
    return next(err);
  }
};

export const getAttemptQuestionsHandler = async (req, res, next) => {
  try {
    const result = await getAttemptQuestions({ userId: req.user._id, attemptId: req.params.attemptId });
    return successResponse(res, { message: "Attempt questions fetched", data: result });
  } catch (err) {
    return next(err);
  }
};

export const submitTestAttemptHandler = async (req, res, next) => {
  try {
    const result = await submitTestAttempt({
      userId: req.user._id,
      attemptId: req.params.attemptId,
      answers: req.body.answers,
    });
    return successResponse(res, {
      message: result.passed ? "Test passed — submitted for admin review" : "Test not passed — you may retry after the cooldown period",
      data: result,
    });
  } catch (err) {
    return next(err);
  }
};
