/**
 * BARBER ENGINE V1
 * backend/services/gstPolicy.service.js
 *
 * Admin authoring (create/list/detail/publish/retire) + the hot-path
 * resolver (getPublishedGstPolicy) lockSlot calls on every booking.
 * DRAFT/PUBLISHED/RETIRED discipline mirrors
 * modules/fieldAgent/services/commercialPolicy.service.js exactly:
 * published/retired versions never mutate; a rate change is always a
 * new DRAFT, then a publish (which atomically retires the prior
 * PUBLISHED row in the same transaction, with bounded retry on a real
 * MongoDB TransientTransactionError).
 *
 * getPublishedGstPolicy() short-lived in-memory cache mirrors
 * CommissionService.js's own getGlobalDefaultRate() pattern exactly
 * (same 5-minute TTL) — GST is read on every single booking lock, so
 * caching avoids a DB round-trip per booking without introducing a new
 * caching idiom. clearCache() exists for the same reason
 * CommissionService.clearCache() does: an admin publishing a new rate
 * should not have to wait out the TTL in tests/urgent corrections.
 */

import mongoose from "mongoose";
import { Errors } from "../utils/response.js";
import GstPolicyVersion, { GST_POLICY_STATUS } from "../models/GstPolicyVersion.js";
import { logAdminAction } from "../utils/auditLog.js";

const isTransientConflict = (err) =>
  err.hasErrorLabel?.("TransientTransactionError") || err.code === 112 || err.codeName === "WriteConflict";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — same TTL as CommissionService's own cache
// cached=false means "nothing cached yet" — distinct from a cached
// `policy: null` result (genuinely "no PUBLISHED GST policy exists"),
// which must still be served from cache until the TTL expires instead
// of hitting the DB on every call.
const cache = { cached: false, policy: null, expiresAt: 0 };

const getVersionOrThrow = async (versionId) => {
  const version = await GstPolicyVersion.findById(versionId);
  if (!version) throw Errors.notFound("GST policy version not found");
  return version;
};

const assertDraft = (version) => {
  if (version.status !== GST_POLICY_STATUS.DRAFT) {
    throw Errors.conflict(`GST policy version is ${version.status}, not DRAFT — it is immutable`);
  }
};

export const createDraftGstPolicy = async ({ adminId, ratePercent, req }) => {
  const version = await GstPolicyVersion.create({ ratePercent, createdBy: adminId });
  await logAdminAction({
    adminId,
    action: "GST_POLICY_CREATED",
    targetType: "GST_POLICY_VERSION",
    targetId: version._id,
    meta: { ratePercent },
    req,
  });
  return version;
};

export const listGstPolicies = ({ page = 1, limit = 20 } = {}) => {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const safePage = Math.max(1, Number(page) || 1);
  return GstPolicyVersion.find()
    .sort({ createdAt: -1 })
    .skip((safePage - 1) * safeLimit)
    .limit(safeLimit)
    .lean();
};

export const getGstPolicyDetail = (versionId) => getVersionOrThrow(versionId);

export const updateDraftGstPolicy = async ({ versionId, adminId, ratePercent, req }) => {
  const version = await getVersionOrThrow(versionId);
  assertDraft(version);
  version.ratePercent = ratePercent;
  await version.save();
  await logAdminAction({
    adminId,
    action: "GST_POLICY_UPDATED",
    targetType: "GST_POLICY_VERSION",
    targetId: version._id,
    meta: { ratePercent },
    req,
  });
  return version;
};

const MAX_PUBLISH_ATTEMPTS = 5;

export const publishGstPolicy = async ({ versionId, adminId, req }) => {
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_PUBLISH_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      // Always re-read live state inside this transaction's own
      // snapshot — same discipline as commercialPolicy.service.js's
      // publishPolicyVersion, proven against real concurrency defects.
      const version = await GstPolicyVersion.findById(versionId).session(session);
      if (!version) throw Errors.notFound("GST policy version not found");
      if (version.status !== GST_POLICY_STATUS.DRAFT) {
        throw Errors.conflict(`GST policy version is ${version.status}, not DRAFT`);
      }

      const currentlyPublished = await GstPolicyVersion.findOne({ status: GST_POLICY_STATUS.PUBLISHED }).session(session);
      if (currentlyPublished) {
        currentlyPublished.status = GST_POLICY_STATUS.RETIRED;
        currentlyPublished.retiredAt = new Date();
        currentlyPublished.retiredBy = adminId;
        await currentlyPublished.save({ session });
      }

      version.status = GST_POLICY_STATUS.PUBLISHED;
      version.publishedAt = new Date();
      version.publishedBy = adminId;
      await version.save({ session });

      await session.commitTransaction();

      clearGstPolicyCache();

      await logAdminAction({
        adminId,
        action: "GST_POLICY_PUBLISHED",
        targetType: "GST_POLICY_VERSION",
        targetId: version._id,
        meta: { ratePercent: version.ratePercent, retiredVersionId: currentlyPublished?._id ?? null },
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

export const retireGstPolicy = async ({ versionId, adminId, req }) => {
  const version = await getVersionOrThrow(versionId);
  if (version.status !== GST_POLICY_STATUS.PUBLISHED) {
    throw Errors.conflict(`GST policy version is ${version.status}, not PUBLISHED`);
  }
  version.status = GST_POLICY_STATUS.RETIRED;
  version.retiredAt = new Date();
  version.retiredBy = adminId;
  await version.save();

  clearGstPolicyCache();

  await logAdminAction({
    adminId,
    action: "GST_POLICY_RETIRED",
    targetType: "GST_POLICY_VERSION",
    targetId: version._id,
    meta: {},
    req,
  });
  return version;
};

/**
 * Hot-path resolver — called once per booking at lockSlot. Returns
 * { ratePercent } for the currently PUBLISHED policy, or null if none
 * has ever been published (never invents a rate — booking.controller.js
 * treats a null return as "no GST applies", storing null snapshot
 * fields, exactly like a legacy pre-feature booking).
 */
export const getPublishedGstPolicy = async () => {
  const now = Date.now();
  if (cache.cached && now < cache.expiresAt) {
    return cache.policy;
  }

  const published = await GstPolicyVersion.findOne({ status: GST_POLICY_STATUS.PUBLISHED })
    .select("ratePercent")
    .lean();

  cache.cached = true;
  cache.policy = published ? { ratePercent: published.ratePercent } : null;
  cache.expiresAt = now + CACHE_TTL_MS;
  return cache.policy;
};

export const clearGstPolicyCache = () => {
  cache.cached = false;
  cache.policy = null;
  cache.expiresAt = 0;
};
