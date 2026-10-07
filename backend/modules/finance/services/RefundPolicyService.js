/**
 * BARBER ENGINE V1
 * backend/modules/finance/services/RefundPolicyService.js
 *
 * Global Refund & Cancellation Policy — admin authoring
 * (create/list/detail/update/publish/retire) plus the one hot-path
 * resolver CancellationPolicyService.evaluate() depends on.
 *
 * REUSES THE EXISTING VERSIONING PATTERN VERBATIM — this file's
 * create/publish/retire/list shape and its publish transaction (re-read
 * live state, retire the current PUBLISHED row, publish the new one,
 * bounded retry on a real MongoDB TransientTransactionError) are the
 * same idiom already proven by TerritoryRevenueSettingsService.js /
 * commercialPolicy.service.js / areaPlatformFee.service.js. No new
 * versioning pattern invented.
 *
 * ISOLATION (LOCKED): this file never imports or touches
 * CommercialPolicyVersion, AreaPlatformFeePolicy, GstPolicyVersion,
 * TerritoryRevenueSettings, RevenueSplit, GSTLedger, Wallet, Booking.
 * It only manages RefundPolicyVersion documents.
 *
 * "Save creates DRAFT. Publish retires previous PUBLISHED version" —
 * createDraftRefundPolicy() is Save; publish/retire are separate
 * actions, never combined into one call.
 */

import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import { logAdminAction } from "../../../utils/auditLog.js";
import RefundPolicyVersion from "../models/RefundPolicyVersion.js";
import { REFUND_POLICY_STATUS, REFUND_POLICY_MAX_RULES, CANCELLATION_PERCENT_MIN, CANCELLATION_PERCENT_MAX } from "../constants/refundPolicy.constants.js";

const isTransientConflict = (err) =>
  err.hasErrorLabel?.("TransientTransactionError") || err.code === 112 || err.codeName === "WriteConflict";

/**
 * Shared rule-array validator. Used by createDraftRefundPolicy,
 * updateDraftRefundPolicy, AND publishRefundPolicy (defense-in-depth
 * re-check right before a policy goes live), so the three enforcement
 * points can never drift out of sync.
 *
 * Boundary semantics (LOCKED): minMinutes is INCLUSIVE on its lower
 * bound; rules must be ascending by minMinutes once sorted; gapless
 * and non-overlapping; the lowest rule MUST start at minMinutes:0;
 * exactly the highest rule MUST be unlimited (maxMinutes:null); every
 * other rule must be finite. This guarantees any non-negative
 * minutes-until-start value matches exactly one rule — never zero.
 *
 * cancellationPercent is the CANCELLATION/RETENTION percentage (what
 * is forfeited), NOT the customer refund percentage — see
 * RefundPolicyVersion.js's own header. Reproduces the pre-existing
 * hardcoded customer-refund thresholds (>=120min -> 100% refund,
 * >=30min -> 50% refund, else -> 0% refund) via the INVERTED
 * cancellationPercent values [{0,29,100},{30,119,50},{120,null,0}]:
 * exactly 30 minutes falls in the second rule (50% cancellation = 50%
 * refund), exactly 120 minutes falls in the third rule (0%
 * cancellation = 100% refund).
 */
const validateRefundPolicyRules = (rules) => {
  if (!Array.isArray(rules) || rules.length === 0) {
    throw Errors.badRequest("rules must be a non-empty array");
  }
  if (rules.length > REFUND_POLICY_MAX_RULES) {
    throw Errors.badRequest(`rules cannot contain more than ${REFUND_POLICY_MAX_RULES} entries`);
  }

  for (const r of rules) {
    if (!Number.isInteger(r?.minMinutes) || r.minMinutes < 0) {
      throw Errors.badRequest("Every rule's minMinutes must be a non-negative integer");
    }
    if (r.maxMinutes != null && (!Number.isInteger(r.maxMinutes) || r.maxMinutes < 0)) {
      throw Errors.badRequest("Every rule's maxMinutes must be a non-negative integer or null (unlimited)");
    }
    if (!Number.isInteger(r?.cancellationPercent) || r.cancellationPercent < CANCELLATION_PERCENT_MIN || r.cancellationPercent > CANCELLATION_PERCENT_MAX) {
      throw Errors.badRequest("Every rule's cancellationPercent must be a non-negative integer between 0 and 100");
    }
    if (r.maxMinutes != null && r.maxMinutes < r.minMinutes) {
      throw Errors.badRequest(`Invalid rule range: min ${r.minMinutes} is greater than max ${r.maxMinutes}`);
    }
  }

  const sorted = [...rules].sort((a, b) => a.minMinutes - b.minMinutes);

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].minMinutes === sorted[i - 1].minMinutes && sorted[i].maxMinutes === sorted[i - 1].maxMinutes) {
      throw Errors.badRequest(`Duplicate rule range: ${sorted[i].minMinutes}-${sorted[i].maxMinutes ?? "∞"}`);
    }
  }

  // Overlap check — minMinutes inclusive, null max treated as +Infinity.
  for (let i = 1; i < sorted.length; i++) {
    const prevMax = sorted[i - 1].maxMinutes ?? Infinity;
    if (sorted[i].minMinutes <= prevMax) {
      throw Errors.badRequest(
        `Overlapping rules: ${sorted[i - 1].minMinutes}-${sorted[i - 1].maxMinutes ?? "∞"} and ${sorted[i].minMinutes}-${sorted[i].maxMinutes ?? "∞"}`
      );
    }
  }

  if (sorted[0].minMinutes !== 0) {
    throw Errors.badRequest("The lowest rule must start at minMinutes 0 — every cancellation must be covered");
  }

  const unlimitedRules = sorted.filter((r) => r.maxMinutes == null);
  if (unlimitedRules.length !== 1) {
    throw Errors.badRequest("Exactly one rule — the highest — must be unlimited (maxMinutes: null)");
  }
  if (sorted[sorted.length - 1].maxMinutes != null) {
    throw Errors.badRequest("The highest rule (by minMinutes) must be the unlimited one");
  }

  // Gapless coverage — for every rule except the last, the next rule's
  // min must be exactly this rule's max + 1 minute.
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1].minMinutes !== sorted[i].maxMinutes + 1) {
      throw Errors.badRequest(
        `Gap between rules: ${sorted[i].minMinutes}-${sorted[i].maxMinutes} and ${sorted[i + 1].minMinutes}-${sorted[i + 1].maxMinutes ?? "∞"} — rules must be contiguous with no gap`
      );
    }
  }

  return sorted.map((r) => ({ minMinutes: r.minMinutes, maxMinutes: r.maxMinutes, cancellationPercent: r.cancellationPercent }));
};

const getVersionOrThrow = async (versionId) => {
  const version = await RefundPolicyVersion.findById(versionId);
  if (!version) throw Errors.notFound("Refund policy version not found");
  return version;
};

const assertDraft = (version) => {
  if (version.status !== REFUND_POLICY_STATUS.DRAFT) {
    throw Errors.conflict(`Refund policy version is ${version.status}, not DRAFT — it is immutable`);
  }
};

const MAX_VERSION_NUMBER_ATTEMPTS = 5;

/**
 * "Save" — creates a new DRAFT. Never touches the currently PUBLISHED
 * version. version number = (highest existing version) + 1, resolved
 * fresh on every attempt with a bounded retry on the unique-index
 * collision — same idiom as every sibling *Settings/*PolicyVersion
 * service's own createDraft.
 */
export const createDraftRefundPolicy = async ({ adminId, rules, req }) => {
  const cleanRules = validateRefundPolicyRules(rules);

  let lastErr = null;
  for (let attempt = 0; attempt < MAX_VERSION_NUMBER_ATTEMPTS; attempt++) {
    const last = await RefundPolicyVersion.findOne().sort({ version: -1 }).select("version").lean();
    const version = (last?.version ?? 0) + 1;
    try {
      const doc = await RefundPolicyVersion.create({ rules: cleanRules, version, createdBy: adminId });

      await logAdminAction({
        adminId,
        action: "REFUND_POLICY_CREATED",
        targetType: "REFUND_POLICY_VERSION",
        targetId: doc._id,
        meta: { version, rules: cleanRules },
        req,
      });

      return doc;
    } catch (err) {
      lastErr = err;
      if (err?.code === 11000 && attempt < MAX_VERSION_NUMBER_ATTEMPTS - 1) continue; // version collided with a concurrent create — retry with a fresh number
      throw err;
    }
  }
  throw lastErr;
};

export const listRefundPolicyVersions = ({ page = 1, limit = 20 } = {}) => {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const safePage = Math.max(1, Number(page) || 1);
  return RefundPolicyVersion.find()
    .sort({ version: -1 })
    .skip((safePage - 1) * safeLimit)
    .limit(safeLimit)
    .lean();
};

export const getRefundPolicyDetail = async (versionId) => {
  const version = await RefundPolicyVersion.findById(versionId).lean();
  if (!version) throw Errors.notFound("Refund policy version not found");
  return version;
};

/** The currently PUBLISHED version, or null if none exists yet. Read-only. */
export const getPublishedRefundPolicy = () =>
  RefundPolicyVersion.findOne({ status: REFUND_POLICY_STATUS.PUBLISHED }).lean();

export const updateDraftRefundPolicy = async ({ versionId, adminId, rules, req }) => {
  const version = await getVersionOrThrow(versionId);
  assertDraft(version);

  const cleanRules = validateRefundPolicyRules(rules);

  version.rules = cleanRules;
  version.markModified("rules");
  await version.save();

  await logAdminAction({
    adminId,
    action: "REFUND_POLICY_UPDATED",
    targetType: "REFUND_POLICY_VERSION",
    targetId: version._id,
    meta: { rules: cleanRules },
    req,
  });

  return version;
};

const MAX_PUBLISH_ATTEMPTS = 5;

/**
 * "Publish" — retires whichever version is currently PUBLISHED (if
 * any) and publishes this DRAFT, atomically, in one transaction.
 * Bounded retry on a genuine transient write conflict, re-reading live
 * state on every attempt.
 *
 * DB-ENFORCED, not just this transaction: RefundPolicyVersion's own
 * partial unique index on {status: PUBLISHED} means even a bypassed
 * code path could never create a second PUBLISHED row.
 */
export const publishRefundPolicy = async ({ versionId, adminId, req }) => {
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_PUBLISH_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const version = await RefundPolicyVersion.findById(versionId).session(session);
      if (!version) throw Errors.notFound("Refund policy version not found");
      if (version.status !== REFUND_POLICY_STATUS.DRAFT) {
        throw Errors.conflict(`Refund policy version is ${version.status}, not DRAFT`);
      }

      // Defense-in-depth re-check — createDraft/updateDraft already
      // validated this exact document; this guarantees the invariant
      // even against a hypothetical future write path that bypasses
      // those two.
      validateRefundPolicyRules(version.rules);

      const currentlyPublished = await RefundPolicyVersion.findOne({ status: REFUND_POLICY_STATUS.PUBLISHED }).session(session);
      if (currentlyPublished) {
        currentlyPublished.status = REFUND_POLICY_STATUS.RETIRED;
        currentlyPublished.retiredAt = new Date();
        currentlyPublished.retiredBy = adminId;
        await currentlyPublished.save({ session });
      }

      version.status = REFUND_POLICY_STATUS.PUBLISHED;
      version.publishedAt = new Date();
      version.publishedBy = adminId;
      await version.save({ session });

      await session.commitTransaction();

      await logAdminAction({
        adminId,
        action: "REFUND_POLICY_PUBLISHED",
        targetType: "REFUND_POLICY_VERSION",
        targetId: version._id,
        meta: { version: version.version, retiredVersionId: currentlyPublished?._id ?? null },
        req,
      });

      return version;
    } catch (err) {
      if (session.inTransaction()) await session.abortTransaction();
      lastErr = err;
      if (isTransientConflict(err) && attempt < MAX_PUBLISH_ATTEMPTS - 1) {
        continue; // retry the WHOLE transaction, re-reading live state
      }
      throw err;
    } finally {
      session.endSession();
    }
  }
  throw lastErr;
};

export const retireRefundPolicy = async ({ versionId, adminId, req }) => {
  const version = await getVersionOrThrow(versionId);
  if (version.status !== REFUND_POLICY_STATUS.PUBLISHED) {
    throw Errors.conflict(`Refund policy version is ${version.status}, not PUBLISHED`);
  }
  version.status = REFUND_POLICY_STATUS.RETIRED;
  version.retiredAt = new Date();
  version.retiredBy = adminId;
  await version.save();

  await logAdminAction({
    adminId,
    action: "REFUND_POLICY_RETIRED",
    targetType: "REFUND_POLICY_VERSION",
    targetId: version._id,
    meta: { version: version.version },
    req,
  });

  return version;
};

/**
 * Hot-path resolver — CancellationPolicyService.evaluate()'s caller
 * (cancelBooking/ownerCancelBooking) fetches the published policy once
 * and passes its `rules` in. Given minutesUntilStart (can be negative
 * — a booking being cancelled after its own startTime — clamped to 0,
 * same "less than 30 min -> 100% cancellation hit" behavior the
 * hardcoded version always had), returns the CANCELLATION/RETENTION
 * percentage (NOT the customer refund percentage — see
 * RefundPolicyVersion.js's own header; the caller derives
 * refundPercent as `100 - cancellationPercent`) for the FIRST rule
 * whose [minMinutes, maxMinutes] (inclusive lower bound, inclusive
 * upper bound, null = unlimited) contains it.
 *
 * FLOORED before matching, not matched as a raw real number — rule
 * boundaries are whole minutes (minMinutes/maxMinutes are both
 * integers), but minutesUntilStart is continuous (derived from a
 * millisecond timestamp difference). Without flooring, a value like
 * 119.5 would match neither a rule ending at maxMinutes:119 nor one
 * starting at minMinutes:120 — a real gap despite the rules
 * themselves being gapless over the integers. floor(x) >= N is
 * mathematically equivalent to x >= N for every integer N and every
 * real x >= 0, so this exactly reproduces the original hardcoded
 * `minsUntil >= 120` / `minsUntil >= 30` comparisons (continuous,
 * never floored) for every input — not an approximation.
 *
 * Throws if no rule matches — structurally unreachable given
 * publish-time validation (rules are always gapless, 0-covered,
 * unlimited-topped over the integers), but the "no silent default"
 * rule applies even to this should-never-happen case.
 */
export const resolveCancellationPercentForMinutes = (policy, minutesUntilStart) => {
  if (!policy || !Array.isArray(policy.rules) || policy.rules.length === 0) {
    throw Errors.internal("Refund policy has no rules configured — please contact support.");
  }
  const flooredMinutes = Math.floor(Math.max(0, minutesUntilStart));
  const rule = policy.rules.find((r) => flooredMinutes >= r.minMinutes && (r.maxMinutes == null || flooredMinutes <= r.maxMinutes));
  if (!rule) {
    throw Errors.internal("Refund policy configuration does not cover this cancellation timing — please contact support.");
  }
  return rule.cancellationPercent;
};
