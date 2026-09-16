/**
 * BARBER ENGINE V1
 * backend/services/areaPlatformFee.service.js
 *
 * Admin authoring (create/list/detail/publish/retire) for the area-wise
 * Platform Fee, plus the hot-path resolver (resolvePlatformFeeForArea)
 * lockSlot calls on every booking.
 *
 * PAN-INDIA FALLBACK (locked business decision): if a salon's area has
 * no PUBLISHED AreaPlatformFeePolicy, the resolver returns
 * { feeInPaise: 0 } — the booking is NEVER blocked for a missing fee
 * configuration. This is deterministic and server-side; the caller
 * never has to special-case a null/undefined result.
 *
 * No caching here (unlike gstPolicy.service.js) — the lookup is a
 * single indexed findOne keyed by areaRef (cardinality bounded by the
 * number of areas nationally, not the number of salons), already
 * O(1)-style per the scale requirement; adding a cache would be
 * unnecessary complexity for a lookup this cheap.
 */

import mongoose from "mongoose";
import { Errors } from "../utils/response.js";
import AreaPlatformFeePolicy, { AREA_PLATFORM_FEE_STATUS } from "../models/AreaPlatformFeePolicy.js";
import Area from "../models/Area.js";
import { logAdminAction } from "../utils/auditLog.js";

const isTransientConflict = (err) =>
  err.hasErrorLabel?.("TransientTransactionError") || err.code === 112 || err.codeName === "WriteConflict";

const getPolicyOrThrow = async (policyId) => {
  const policy = await AreaPlatformFeePolicy.findById(policyId);
  if (!policy) throw Errors.notFound("Area platform fee policy not found");
  return policy;
};

const assertDraft = (policy) => {
  if (policy.status !== AREA_PLATFORM_FEE_STATUS.DRAFT) {
    throw Errors.conflict(`Area platform fee policy is ${policy.status}, not DRAFT — it is immutable`);
  }
};

export const createDraftAreaPlatformFee = async ({ adminId, areaRef, feeInPaise, req }) => {
  const areaExists = await Area.exists({ _id: areaRef });
  if (!areaExists) throw Errors.badRequest("Area not found");

  const policy = await AreaPlatformFeePolicy.create({ areaRef, feeInPaise, createdBy: adminId });
  await logAdminAction({
    adminId,
    action: "AREA_PLATFORM_FEE_CREATED",
    targetType: "AREA_PLATFORM_FEE_POLICY",
    targetId: policy._id,
    meta: { areaRef: String(areaRef), feeInPaise },
    req,
  });
  return policy;
};

export const listAreaPlatformFees = ({ areaRef, page = 1, limit = 20 } = {}) => {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const safePage = Math.max(1, Number(page) || 1);
  const filter = areaRef ? { areaRef } : {};
  return AreaPlatformFeePolicy.find(filter)
    .sort({ createdAt: -1 })
    .skip((safePage - 1) * safeLimit)
    .limit(safeLimit)
    .lean();
};

export const getAreaPlatformFeeDetail = (policyId) => getPolicyOrThrow(policyId);

export const updateDraftAreaPlatformFee = async ({ policyId, adminId, feeInPaise, req }) => {
  const policy = await getPolicyOrThrow(policyId);
  assertDraft(policy);
  policy.feeInPaise = feeInPaise;
  await policy.save();
  await logAdminAction({
    adminId,
    action: "AREA_PLATFORM_FEE_UPDATED",
    targetType: "AREA_PLATFORM_FEE_POLICY",
    targetId: policy._id,
    meta: { feeInPaise },
    req,
  });
  return policy;
};

const MAX_PUBLISH_ATTEMPTS = 5;

export const publishAreaPlatformFee = async ({ policyId, adminId, req }) => {
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_PUBLISH_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const policy = await AreaPlatformFeePolicy.findById(policyId).session(session);
      if (!policy) throw Errors.notFound("Area platform fee policy not found");
      if (policy.status !== AREA_PLATFORM_FEE_STATUS.DRAFT) {
        throw Errors.conflict(`Area platform fee policy is ${policy.status}, not DRAFT`);
      }

      // Only retire the PUBLISHED fee for the SAME area — unlike GST
      // (global, exactly one PUBLISHED row total), this is scoped
      // per-areaRef.
      const currentlyPublished = await AreaPlatformFeePolicy.findOne({
        areaRef: policy.areaRef,
        status: AREA_PLATFORM_FEE_STATUS.PUBLISHED,
      }).session(session);

      if (currentlyPublished) {
        currentlyPublished.status = AREA_PLATFORM_FEE_STATUS.RETIRED;
        currentlyPublished.retiredAt = new Date();
        currentlyPublished.retiredBy = adminId;
        await currentlyPublished.save({ session });
      }

      policy.status = AREA_PLATFORM_FEE_STATUS.PUBLISHED;
      policy.publishedAt = new Date();
      policy.publishedBy = adminId;
      await policy.save({ session });

      await session.commitTransaction();

      await logAdminAction({
        adminId,
        action: "AREA_PLATFORM_FEE_PUBLISHED",
        targetType: "AREA_PLATFORM_FEE_POLICY",
        targetId: policy._id,
        meta: { areaRef: String(policy.areaRef), feeInPaise: policy.feeInPaise, retiredPolicyId: currentlyPublished?._id ?? null },
        req,
      });

      return policy;
    } catch (err) {
      if (session.inTransaction()) await session.abortTransaction();
      lastErr = err;
      if (isTransientConflict(err) && attempt < MAX_PUBLISH_ATTEMPTS - 1) {
        continue;
      }
      throw err;
    } finally {
      session.endSession();
    }
  }
  throw lastErr;
};

export const retireAreaPlatformFee = async ({ policyId, adminId, req }) => {
  const policy = await getPolicyOrThrow(policyId);
  if (policy.status !== AREA_PLATFORM_FEE_STATUS.PUBLISHED) {
    throw Errors.conflict(`Area platform fee policy is ${policy.status}, not PUBLISHED`);
  }
  policy.status = AREA_PLATFORM_FEE_STATUS.RETIRED;
  policy.retiredAt = new Date();
  policy.retiredBy = adminId;
  await policy.save();

  await logAdminAction({
    adminId,
    action: "AREA_PLATFORM_FEE_RETIRED",
    targetType: "AREA_PLATFORM_FEE_POLICY",
    targetId: policy._id,
    meta: {},
    req,
  });
  return policy;
};

/**
 * Hot-path resolver — called once per booking at lockSlot, keyed by
 * the salon's own authoritative areaRef (never client-supplied).
 * PAN-INDIA FALLBACK: returns { feeInPaise: 0 } when areaRef is
 * missing/null OR no PUBLISHED policy exists for it — the booking is
 * never blocked for a missing configuration.
 */
export const resolvePlatformFeeForArea = async (areaRef) => {
  if (!areaRef) return { feeInPaise: 0 };

  const published = await AreaPlatformFeePolicy.findOne({
    areaRef,
    status: AREA_PLATFORM_FEE_STATUS.PUBLISHED,
  })
    .select("feeInPaise")
    .lean();

  return { feeInPaise: published ? published.feeInPaise : 0 };
};
