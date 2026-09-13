/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/fieldAgentReview.service.js
 *
 * FA-4.3 — Admin Review Queue + Application Detail. Read-only
 * aggregation across already-frozen engines (KYC, Training, Test,
 * FA-4.1 profile) — no business logic is duplicated, only their
 * already-persisted, already-authoritative fields are read and
 * projected into a compact DTO. Nothing here ever writes to any of
 * those collections.
 *
 * Supersedes FA-4.2's own placeholder `listApplicationsInReview`/
 * `getApplicationForReview` (fieldAgentApproval.service.js) — those
 * were explicitly built as a minimum FA-4.2 capability, not the real
 * review surface; `approveApplication`/`rejectApplication` themselves
 * are entirely untouched by this file.
 *
 * KYC ACCESS BOUNDARY — inspected and reused, not invented: the
 * existing, frozen modules/kyc/controllers/adminKyc.controller.js
 * already enforces that a Field Agent's KYC record (applicantType
 * FIELD_AGENT) is INDIA-admin-only — its own `assertKYCInScope` throws
 * "Field Agent KYC scoping is not yet available at this admin level"
 * for STATE/DISTRICT, because Salon-based territory scoping (the only
 * scoping mechanism that exists today) cannot correctly resolve a
 * Field Agent (who owns no Salon) — that requires FA-5's zone
 * assignment, which does not exist yet. This file applies the exact
 * same boundary to the KYC section of its own response: an
 * INDIA-only restriction on Field Agent KYC status. This is not a new
 * policy invented here — it is the same one, applied consistently, so
 * this endpoint cannot become a side door around it. Training/test
 * summaries carry no such restriction, because their own frozen admin
 * endpoints (adminTraining.routes.js, adminTest.routes.js) already
 * grant INDIA/STATE/DISTRICT read access with no additional scoping.
 *
 * DECISION READINESS — presentational only, not a second approval
 * state machine. `eligibleForApproval`/`eligibleForRejection` mirror
 * EXACTLY the one gate fieldAgentApproval.service.js#approveApplication/
 * rejectApplication themselves check (`status === ADMIN_REVIEW`) —
 * nothing here independently re-derives eligibility from KYC/training/
 * test data, which would risk silently diverging from the real
 * enforcement. `blockingReasons` for a non-ADMIN_REVIEW application is
 * purely a human-readable restatement of the CURRENT status value
 * (a lookup table), never a new independent check.
 */

import User from "../../../models/User.js";
import { Errors } from "../../../utils/response.js";
import FieldAgent from "../models/FieldAgent.js";
import FieldAgentApplication from "../models/FieldAgentApplication.js";
import { APPLICATION_STATUS } from "../constants/fieldAgent.constants.js";
import KYC from "../../kyc/models/KYC.js";
import { APPLICANT_TYPE } from "../../kyc/constants/kyc.constants.js";
import FieldAgentTraining from "../../fieldAgentTraining/models/FieldAgentTraining.js";
import TrainingVersion from "../../fieldAgentTraining/models/TrainingVersion.js";
import TestAttempt from "../../fieldAgentTest/models/TestAttempt.js";
import TestVersion from "../../fieldAgentTest/models/TestVersion.js";

const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 20;
const MAX_SEARCH_LENGTH = 100;

const SORT_WHITELIST = ["createdAt", "updatedAt"];
const STATUS_WHITELIST = new Set(Object.values(APPLICATION_STATUS));

// STATE/DISTRICT admins never see Field Agent KYC detail — see file
// header. INDIA is the only level this section is ever built for.
const isKycVisible = (adminLevel) => adminLevel === "INDIA";

// Purely presentational restatement of the CURRENT status — never an
// independently-derived gate. See file header.
const BLOCKING_REASON_BY_STATUS = {
  [APPLICATION_STATUS.DRAFT]: "Applicant has not yet submitted the application.",
  [APPLICATION_STATUS.SUBMITTED]: "Application submitted — awaiting KYC to begin.",
  [APPLICATION_STATUS.KYC_PENDING]: "Application is still awaiting KYC verification.",
  [APPLICATION_STATUS.KYC_REJECTED]: "KYC was rejected — applicant must resubmit KYC.",
  [APPLICATION_STATUS.TRAINING_PENDING]: "Application is still in the mandatory training.",
  [APPLICATION_STATUS.TEST_PENDING]: "Application is still awaiting the mandatory test.",
  [APPLICATION_STATUS.TEST_FAILED]: "Applicant failed the mandatory test and is in the retry/cooldown cycle.",
  [APPLICATION_STATUS.APPROVED]: "Application has already been approved.",
  [APPLICATION_STATUS.REJECTED]: "Application has already been rejected.",
  [APPLICATION_STATUS.WITHDRAWN]: "Application was withdrawn by the applicant.",
};

const clampLimit = (limit) => Math.max(1, Math.min(Number(limit) || DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT));

// ─── DTOs — explicit projection only, never a raw document ─────────

const userRowDTO = (user) => (user ? { id: user._id, name: user.name ?? null, phone: user.phone ?? null } : null);

const queueRowDTO = (application, { user, kycStatus, trainingStatus, testStatus, agentCode }) => ({
  applicationId: application._id,
  user: userRowDTO(user),
  status: application.status,
  createdAt: application.createdAt,
  updatedAt: application.updatedAt,
  kycStatus: kycStatus ?? null,
  trainingStatus: trainingStatus ?? null,
  testStatus: testStatus ?? null,
  agentCode: agentCode ?? null,
  rejectionReason: application.rejectionReason ?? null,
});

const kycSummaryDTO = (kyc) => {
  if (!kyc) return null;
  return {
    status: kyc.status ?? null,
    verificationLevel: kyc.verificationLevel ?? 0,
    verified: {
      pan: kyc.verification?.pan?.verified ?? false,
      aadhaar: kyc.verification?.aadhaar?.verified ?? false,
      bank: kyc.verification?.bank?.verified ?? false,
    },
    rejectReason: kyc.review?.rejectReason ?? null,
    submittedAt: kyc.submittedAt ?? null,
    approvedAt: kyc.approvedAt ?? null,
    rejectedAt: kyc.rejectedAt ?? null,
  };
};

const trainingSummaryDTO = (enrollment, versionNumber) => {
  if (!enrollment) return null;
  const totalModules = enrollment.moduleProgress?.length ?? 0;
  const completedModules = (enrollment.moduleProgress || []).filter((m) => m.status === "COMPLETED").length;
  return {
    status: enrollment.status ?? null,
    pinnedVersionNumber: versionNumber ?? null,
    completedModules,
    totalModules,
    completedAt: enrollment.completedAt ?? null,
  };
};

const testSummaryDTO = (attempt, versionNumber) => {
  if (!attempt) return null;
  return {
    attemptId: attempt._id,
    attemptNumber: attempt.attemptNumber ?? null,
    status: attempt.status ?? null,
    score: attempt.score ?? null,
    passed: attempt.passed ?? null,
    submittedAt: attempt.submittedAt ?? null,
    versionNumber: versionNumber ?? null,
    // NEVER: grading, correctOptionIndex, per-question answers/rubric.
  };
};

const fieldAgentSummaryDTO = (profile) => {
  if (!profile) return null;
  return {
    agentCode: profile.agentCode,
    operationalStatus: profile.operationalStatus,
    approvedBy: profile.approvedBy ?? null,
    approvedAt: profile.approvedAt ?? null,
  };
};

const decisionReadinessDTO = (application) => {
  const eligible = application.status === APPLICATION_STATUS.ADMIN_REVIEW;
  return {
    eligibleForApproval: eligible,
    eligibleForRejection: eligible,
    blockingReasons: eligible ? [] : [BLOCKING_REASON_BY_STATUS[application.status] ?? `Application status is ${application.status}.`],
  };
};

// ─── QUEUE ──────────────────────────────────────────────────────────
// Filters operate ONLY on FieldAgentApplication's own persisted,
// indexed fields (status, createdAt, updatedAt, userRef via a bounded
// User sub-lookup) — never an arbitrary Mongo operator from the
// client, never a filter requiring a join on the FILTER path itself.
// Per-row KYC/training/test/profile enrichment is a SEPARATE, BATCHED
// step over this page's own ids only — never a per-row query.
export const listApplicationsForReview = async ({
  page = 1,
  limit = DEFAULT_LIST_LIMIT,
  status,
  search,
  sortBy = "createdAt",
  sortOrder = "desc",
  createdFrom,
  createdTo,
  updatedFrom,
  updatedTo,
  applicationId,
  adminLevel,
}) => {
  const safeLimit = clampLimit(limit);
  const safePage = Math.max(1, Number(page) || 1);

  // Exact-id fast path — bypasses pagination/filtering entirely.
  if (applicationId) {
    const application = await FieldAgentApplication.findById(applicationId).lean();
    const flatRows = application ? await enrichRows([application], adminLevel) : [];
    return { applications: flatRows, pagination: { page: 1, limit: safeLimit, total: flatRows.length, totalPages: flatRows.length ? 1 : 0 } };
  }

  const filter = {};
  filter.status = status && STATUS_WHITELIST.has(status) ? status : APPLICATION_STATUS.ADMIN_REVIEW;

  if (createdFrom || createdTo) {
    filter.createdAt = {};
    if (createdFrom) filter.createdAt.$gte = new Date(createdFrom);
    if (createdTo) filter.createdAt.$lte = new Date(createdTo);
  }
  if (updatedFrom || updatedTo) {
    filter.updatedAt = {};
    if (updatedFrom) filter.updatedAt.$gte = new Date(updatedFrom);
    if (updatedTo) filter.updatedAt.$lte = new Date(updatedTo);
  }

  if (search) {
    const trimmed = String(search).trim().slice(0, MAX_SEARCH_LENGTH);
    if (trimmed) {
      // Bounded, indexed-field search against User first (same
      // established pattern as adminKyc.controller.js#listKYCForAdmin)
      // — never an unbounded regex against FieldAgentApplication
      // itself.
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matchedUsers = await User.find({
        role: "FIELD_AGENT",
        $or: [{ name: { $regex: escaped, $options: "i" } }, { phone: { $regex: escaped, $options: "i" } }],
      })
        .select("_id")
        .limit(500) // bounded — this is a narrowing sub-lookup, not the final result set
        .lean();
      filter.userRef = { $in: matchedUsers.map((u) => u._id) };
    }
  }

  const sortField = SORT_WHITELIST.includes(sortBy) ? sortBy : "createdAt";
  const sortDir = sortOrder === "asc" ? 1 : -1;
  // Deterministic — stable tie-breaker on _id, same direction as the
  // primary sort field, so paginated pages never overlap/skip rows
  // that share an identical createdAt/updatedAt timestamp.
  const sort = { [sortField]: sortDir, _id: sortDir };

  const [applications, total] = await Promise.all([
    FieldAgentApplication.find(filter)
      .sort(sort)
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    FieldAgentApplication.countDocuments(filter),
  ]);

  const rows = await enrichRows(applications, adminLevel);

  return {
    applications: rows,
    pagination: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) || 1 },
  };
};

// Batched enrichment — exactly 4 additional queries total (User, KYC,
// FieldAgentTraining, TestAttempt, FieldAgent — each a single `$in`
// over this page's own ids), never one query per row.
const enrichRows = async (applications, adminLevel) => {
  if (applications.length === 0) return [];

  const appIds = applications.map((a) => a._id);
  const userIds = applications.map((a) => a.userRef);
  const kycVisible = isKycVisible(adminLevel);

  const [users, kycs, trainings, attempts, profiles] = await Promise.all([
    User.find({ _id: { $in: userIds } }).select("name phone").lean(),
    kycVisible
      ? KYC.find({ ownerId: { $in: userIds }, applicantType: APPLICANT_TYPE.FIELD_AGENT }).select("ownerId status").lean()
      : Promise.resolve([]),
    FieldAgentTraining.find({ applicationRef: { $in: appIds } }).select("applicationRef status").lean(),
    TestAttempt.find({ applicationRef: { $in: appIds } }).select("applicationRef status attemptNumber").lean(),
    FieldAgent.find({ applicationRef: { $in: appIds } }).select("applicationRef agentCode").lean(),
  ]);

  const userById = new Map(users.map((u) => [String(u._id), u]));
  const kycByUserId = new Map(kycs.map((k) => [String(k.ownerId), k]));
  const trainingByAppId = new Map(trainings.map((t) => [String(t.applicationRef), t]));
  const agentByAppId = new Map(profiles.map((p) => [String(p.applicationRef), p]));

  // Most recent attempt per application (attempts are capped at
  // maxAttempts, a handful per application — bounded in-memory group).
  const attemptByAppId = new Map();
  for (const a of attempts) {
    const key = String(a.applicationRef);
    const existing = attemptByAppId.get(key);
    if (!existing || (a.attemptNumber ?? 0) > (existing.attemptNumber ?? 0)) attemptByAppId.set(key, a);
  }

  return applications.map((application) => {
    const user = userById.get(String(application.userRef));
    const kyc = kycByUserId.get(String(application.userRef));
    const training = trainingByAppId.get(String(application._id));
    const attempt = attemptByAppId.get(String(application._id));
    const profile = agentByAppId.get(String(application._id));

    return queueRowDTO(application, {
      user,
      kycStatus: kycVisible ? kyc?.status ?? null : null,
      trainingStatus: training?.status ?? null,
      testStatus: attempt?.status ?? null,
      agentCode: profile?.agentCode ?? null,
    });
  });
};

// ─── DETAIL ─────────────────────────────────────────────────────────
export const getApplicationReviewDetail = async ({ applicationId, adminLevel }) => {
  const application = await FieldAgentApplication.findById(applicationId).lean();
  if (!application) throw Errors.notFound("Field Agent application not found");

  const kycVisible = isKycVisible(adminLevel);

  const [kyc, training, attempt, profile] = await Promise.all([
    kycVisible ? KYC.findOne({ ownerId: application.userRef, applicantType: APPLICANT_TYPE.FIELD_AGENT }).lean() : Promise.resolve(null),
    FieldAgentTraining.findOne({ applicationRef: application._id }).lean(),
    TestAttempt.findOne({ applicationRef: application._id }).sort({ attemptNumber: -1 }).lean(),
    FieldAgent.findOne({ applicationRef: application._id }).lean(),
  ]);

  const [trainingVersionDoc, testVersionDoc] = await Promise.all([
    training?.trainingVersion ? TrainingVersion.findById(training.trainingVersion).select("versionNumber").lean() : Promise.resolve(null),
    attempt?.testVersionRef ? TestVersion.findById(attempt.testVersionRef).select("versionNumber").lean() : Promise.resolve(null),
  ]);

  return {
    application: {
      id: application._id,
      userRef: application.userRef,
      status: application.status,
      createdAt: application.createdAt,
      updatedAt: application.updatedAt,
      reviewedBy: application.reviewedBy ?? null,
      reviewedAt: application.reviewedAt ?? null,
      rejectionReason: application.rejectionReason ?? null,
    },
    kyc: kycVisible ? kycSummaryDTO(kyc) : { restricted: true, reason: "Field Agent KYC detail is not yet available at this admin level" },
    training: trainingSummaryDTO(training, trainingVersionDoc?.versionNumber),
    test: testSummaryDTO(attempt, testVersionDoc?.versionNumber),
    fieldAgent: fieldAgentSummaryDTO(profile),
    decisionReadiness: decisionReadinessDTO(application),
  };
};
