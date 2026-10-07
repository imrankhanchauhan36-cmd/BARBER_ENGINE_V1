/**
 * BARBER ENGINE V1
 * backend/services/areaPlatformFee.service.js
 *
 * Admin authoring (create/list/detail/publish/retire) for the Platform
 * Fee, plus the two hot-path resolvers lockSlot calls on every booking.
 *
 * LAUNCH-PHASE SCOPE ADDITION (2026-10 — "Global Platform Fee"): see
 * ../models/AreaPlatformFeePolicy.js header for the `scope` discriminator
 * rationale. resolveGlobalPlatformFee() is the launch resolver — it is
 * deliberately NOT a silent-₹0 fallback (unlike the pre-existing
 * resolvePlatformFeeForArea below): it returns `null` when no GLOBAL
 * PUBLISHED policy exists, so the caller can refuse to lock the slot
 * rather than silently charging ₹0. resolvePlatformFeeForArea itself is
 * left completely unused by booking.controller.js as of launch, but is
 * kept byte-for-byte unchanged for a future area-override phase.
 *
 * No caching here (unlike gstPolicy.service.js) — the lookup is a
 * single indexed findOne (cardinality bounded by the number of
 * areas/one global row, not the number of salons), already O(1)-style
 * per the scale requirement; adding a cache would be unnecessary
 * complexity for a lookup this cheap.
 */

import mongoose from "mongoose";
import { Errors } from "../utils/response.js";
import AreaPlatformFeePolicy, {
  AREA_PLATFORM_FEE_STATUS,
  PLATFORM_FEE_SCOPE,
  PLATFORM_FEE_CALCULATION_TYPE,
} from "../models/AreaPlatformFeePolicy.js";
import Area from "../models/Area.js";
import { logAdminAction } from "../utils/auditLog.js";

/**
 * PRICING ENGINE EXPANSION — shared GLOBAL-scope config validator.
 * Used by createDraftAreaPlatformFee, updateDraftAreaPlatformFee, AND
 * publishAreaPlatformFee (defense-in-depth re-check right before a
 * policy goes live), so the three enforcement points can never drift
 * out of sync. Throws Errors.badRequest with a specific message on
 * any violation; returns the clean {calculationType, feeInPaise,
 * percentageRate, slabs} to persist (unused fields nulled out, never
 * left as stale leftovers from a previous edit of the same draft).
 *
 * Boundary semantics (locked — see AreaPlatformFeePolicy.js header):
 * both ends of a slab are inclusive; the lowest slab must start at 0;
 * exactly the highest slab must be unlimited (maxAmountInPaise:null);
 * every other slab must be finite; slabs must be perfectly gapless
 * and non-overlapping once sorted. This guarantees any non-negative
 * integer serviceAmountInPaise matches exactly one slab — never zero.
 */
const validateGlobalFeeConfig = ({ calculationType, feeInPaise, percentageRate, slabs }) => {
  if (!Object.values(PLATFORM_FEE_CALCULATION_TYPE).includes(calculationType)) {
    throw Errors.badRequest(`Unknown platform fee calculationType: ${calculationType}`);
  }

  if (calculationType === PLATFORM_FEE_CALCULATION_TYPE.FIXED) {
    if (!Number.isInteger(feeInPaise) || feeInPaise < 0) {
      throw Errors.badRequest("feeInPaise is required (non-negative integer paise) for FIXED calculation type");
    }
    return { calculationType, feeInPaise, percentageRate: null, slabs: undefined };
  }

  if (calculationType === PLATFORM_FEE_CALCULATION_TYPE.PERCENTAGE) {
    if (typeof percentageRate !== "number" || !Number.isFinite(percentageRate) || percentageRate < 0 || percentageRate > 100) {
      throw Errors.badRequest("percentageRate is required (0-100) for PERCENTAGE calculation type");
    }
    return { calculationType, feeInPaise: null, percentageRate, slabs: undefined };
  }

  // SLAB
  if (!Array.isArray(slabs) || slabs.length === 0) {
    throw Errors.badRequest("slabs must be a non-empty array for SLAB calculation type");
  }

  for (const s of slabs) {
    if (!Number.isInteger(s?.minAmountInPaise) || s.minAmountInPaise < 0) {
      throw Errors.badRequest("Every slab's minAmountInPaise must be a non-negative integer");
    }
    if (s.maxAmountInPaise != null && (!Number.isInteger(s.maxAmountInPaise) || s.maxAmountInPaise < 0)) {
      throw Errors.badRequest("Every slab's maxAmountInPaise must be a non-negative integer or null (unlimited)");
    }
    if (!Number.isInteger(s?.feeInPaise) || s.feeInPaise < 0) {
      throw Errors.badRequest("Every slab's feeInPaise must be a non-negative integer");
    }
    if (s.maxAmountInPaise != null && s.maxAmountInPaise < s.minAmountInPaise) {
      throw Errors.badRequest(`Invalid slab range: min ${s.minAmountInPaise} is greater than max ${s.maxAmountInPaise}`);
    }
  }

  const sorted = [...slabs].sort((a, b) => a.minAmountInPaise - b.minAmountInPaise);

  // Duplicate ranges.
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].minAmountInPaise === sorted[i - 1].minAmountInPaise && sorted[i].maxAmountInPaise === sorted[i - 1].maxAmountInPaise) {
      throw Errors.badRequest(`Duplicate slab range: ${sorted[i].minAmountInPaise}-${sorted[i].maxAmountInPaise ?? "∞"}`);
    }
  }

  // Overlap check — inclusive-both-ends semantics, null max treated as +Infinity.
  for (let i = 1; i < sorted.length; i++) {
    const prevMax = sorted[i - 1].maxAmountInPaise ?? Infinity;
    if (sorted[i].minAmountInPaise <= prevMax) {
      throw Errors.badRequest(
        `Overlapping slabs: ${sorted[i - 1].minAmountInPaise}-${sorted[i - 1].maxAmountInPaise ?? "∞"} and ${sorted[i].minAmountInPaise}-${sorted[i].maxAmountInPaise ?? "∞"}`
      );
    }
  }

  // Lower boundary — the lowest slab must start at 0 (see file header
  // rationale: safest launch choice, removes the "amount below every
  // slab" edge case entirely rather than deferring it).
  if (sorted[0].minAmountInPaise !== 0) {
    throw Errors.badRequest("The lowest slab must start at minAmountInPaise 0 — every booking amount must be covered");
  }

  // Upper boundary — exactly the highest slab must be unlimited, and
  // no other slab may be (see file header rationale: explicit
  // representation, never a magic huge integer, and guarantees full
  // coverage above the launch's highest finite breakpoint).
  const unlimitedSlabs = sorted.filter((s) => s.maxAmountInPaise == null);
  if (unlimitedSlabs.length !== 1) {
    throw Errors.badRequest("Exactly one slab — the highest — must be unlimited (maxAmountInPaise: null)");
  }
  if (sorted[sorted.length - 1].maxAmountInPaise != null) {
    throw Errors.badRequest("The highest slab (by minAmountInPaise) must be the unlimited one");
  }

  // Gapless coverage — for every slab except the last, the next
  // slab's min must be exactly this slab's max + 1 paise. Combined
  // with the no-overlap check above, this guarantees every
  // non-negative integer amount matches exactly one slab.
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1].minAmountInPaise !== sorted[i].maxAmountInPaise + 1) {
      throw Errors.badRequest(
        `Gap between slabs: ${sorted[i].minAmountInPaise}-${sorted[i].maxAmountInPaise} and ${sorted[i + 1].minAmountInPaise}-${sorted[i + 1].maxAmountInPaise ?? "∞"} — slabs must be contiguous with no gap`
      );
    }
  }

  return {
    calculationType,
    feeInPaise: null,
    percentageRate: null,
    slabs: sorted.map((s) => ({ minAmountInPaise: s.minAmountInPaise, maxAmountInPaise: s.maxAmountInPaise, feeInPaise: s.feeInPaise })),
  };
};

/**
 * PRICING ENGINE EXPANSION — the actual fee calculation, given an
 * already-PUBLISHED (therefore already validateGlobalFeeConfig-clean)
 * policy document and the booking's serviceAmountInPaise. Throws
 * Errors.internal rather than ever returning a silent 0 — this should
 * be structurally unreachable given publish-time validation, but the
 * "no silent ₹0" rule applies even to this should-never-happen case.
 */
export const calculatePlatformFeeInPaise = (policy, serviceAmountInPaise) => {
  if (policy.calculationType === PLATFORM_FEE_CALCULATION_TYPE.FIXED) {
    return policy.feeInPaise;
  }

  if (policy.calculationType === PLATFORM_FEE_CALCULATION_TYPE.PERCENTAGE) {
    // Same rounding convention as the existing GST calculation
    // (Math.round(base * rate / 100)) — chosen for consistency, not
    // reinvented here.
    return Math.round((serviceAmountInPaise * policy.percentageRate) / 100);
  }

  if (policy.calculationType === PLATFORM_FEE_CALCULATION_TYPE.SLAB) {
    const slab = (policy.slabs || []).find(
      (s) => serviceAmountInPaise >= s.minAmountInPaise && (s.maxAmountInPaise == null || serviceAmountInPaise <= s.maxAmountInPaise)
    );
    if (!slab) {
      throw Errors.internal("Platform Fee SLAB configuration does not cover this booking amount — please contact support.");
    }
    return slab.feeInPaise;
  }

  throw Errors.internal(`Platform Fee policy has an unknown calculationType: ${policy.calculationType}`);
};

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

export const createDraftAreaPlatformFee = async ({
  adminId,
  scope,
  areaRef,
  feeInPaise,
  calculationType,
  percentageRate,
  slabs,
  req,
}) => {
  // Conditional-required enforcement lives here, not in the schema —
  // see AreaPlatformFeePolicy.js header (AREA-2.4.1 lesson precedent).
  let cleanConfig = { feeInPaise, percentageRate: null, slabs: undefined, calculationType: PLATFORM_FEE_CALCULATION_TYPE.FIXED };
  if (scope === PLATFORM_FEE_SCOPE.GLOBAL) {
    if (areaRef) throw Errors.badRequest("areaRef must not be provided for a GLOBAL platform fee");
    areaRef = null;
    // Pricing Engine Expansion — GLOBAL scope only; AREA scope keeps
    // its pre-existing flat feeInPaise-only shape untouched below.
    cleanConfig = validateGlobalFeeConfig({ calculationType, feeInPaise, percentageRate, slabs });
  } else if (scope === PLATFORM_FEE_SCOPE.AREA) {
    if (!areaRef) throw Errors.badRequest("areaRef is required for an AREA platform fee");
    const areaExists = await Area.exists({ _id: areaRef });
    if (!areaExists) throw Errors.badRequest("Area not found");
    if (!Number.isInteger(feeInPaise) || feeInPaise < 0) {
      throw Errors.badRequest("feeInPaise is required (non-negative integer paise) for an AREA platform fee");
    }
    cleanConfig.feeInPaise = feeInPaise;
  } else {
    throw Errors.badRequest(`Unknown platform fee scope: ${scope}`);
  }

  const policy = await AreaPlatformFeePolicy.create({ scope, areaRef, createdBy: adminId, ...cleanConfig });
  await logAdminAction({
    adminId,
    action: "AREA_PLATFORM_FEE_CREATED",
    targetType: "AREA_PLATFORM_FEE_POLICY",
    targetId: policy._id,
    meta: { scope, areaRef: areaRef ? String(areaRef) : null, ...cleanConfig },
    req,
  });
  return policy;
};

// Populates createdBy/publishedBy/retiredBy with just {_id, name} —
// additive audit-trail display only, never read for any dollar
// calculation or authorization decision.
const ACTOR_POPULATE = ["createdBy", "publishedBy", "retiredBy"].map((path) => ({ path, select: "name" }));

export const listAreaPlatformFees = ({ areaRef, scope, page = 1, limit = 20 } = {}) => {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const safePage = Math.max(1, Number(page) || 1);
  const filter = {};
  if (areaRef) filter.areaRef = areaRef;
  if (scope) filter.scope = scope;
  return AreaPlatformFeePolicy.find(filter)
    .sort({ createdAt: -1 })
    .skip((safePage - 1) * safeLimit)
    .limit(safeLimit)
    .populate(ACTOR_POPULATE)
    .lean();
};

export const getAreaPlatformFeeDetail = async (policyId) => {
  const policy = await AreaPlatformFeePolicy.findById(policyId).populate(ACTOR_POPULATE);
  if (!policy) throw Errors.notFound("Area platform fee policy not found");
  return policy;
};

export const updateDraftAreaPlatformFee = async ({ policyId, adminId, feeInPaise, calculationType, percentageRate, slabs, req }) => {
  const policy = await getPolicyOrThrow(policyId);
  assertDraft(policy);

  // scope/areaRef are immutable after creation (see createDraft) — an
  // update can only change the fee configuration, never the scope.
  let cleanConfig;
  if (policy.scope === PLATFORM_FEE_SCOPE.GLOBAL) {
    cleanConfig = validateGlobalFeeConfig({
      calculationType: calculationType ?? policy.calculationType,
      feeInPaise,
      percentageRate,
      slabs,
    });
  } else {
    if (!Number.isInteger(feeInPaise) || feeInPaise < 0) {
      throw Errors.badRequest("feeInPaise is required (non-negative integer paise) for an AREA platform fee");
    }
    cleanConfig = { calculationType: PLATFORM_FEE_CALCULATION_TYPE.FIXED, feeInPaise, percentageRate: null, slabs: undefined };
  }

  // Explicit set + markModified for every field, including the ones
  // being cleared to null/undefined when the mode changes (e.g.
  // SLAB -> FIXED must actually drop the stale slabs array, not just
  // leave it dangling) — Mongoose's undefined-assignment unset
  // behavior on array paths is easy to get wrong silently, so this
  // does not rely on it.
  policy.calculationType = cleanConfig.calculationType;
  policy.markModified("calculationType");
  policy.feeInPaise = cleanConfig.feeInPaise;
  policy.markModified("feeInPaise");
  policy.percentageRate = cleanConfig.percentageRate;
  policy.markModified("percentageRate");
  policy.slabs = cleanConfig.slabs;
  policy.markModified("slabs");
  await policy.save();
  await logAdminAction({
    adminId,
    action: "AREA_PLATFORM_FEE_UPDATED",
    targetType: "AREA_PLATFORM_FEE_POLICY",
    targetId: policy._id,
    meta: cleanConfig,
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

      // Defense-in-depth re-check — "impossible to publish if the
      // configuration is invalid" per the Pricing Engine Expansion
      // requirement. createDraft/updateDraft already validated this
      // exact document, so this should never actually throw; it is
      // here only to guarantee the invariant even against a
      // hypothetical future write path that bypasses those two.
      if (policy.scope === PLATFORM_FEE_SCOPE.GLOBAL) {
        validateGlobalFeeConfig({
          calculationType: policy.calculationType,
          feeInPaise: policy.feeInPaise,
          percentageRate: policy.percentageRate,
          slabs: policy.slabs,
        });
      }

      // Retire the currently-PUBLISHED fee in the SAME scope: for
      // scope:"AREA" that means the same areaRef (pre-existing
      // behavior, unchanged); for scope:"GLOBAL" there is at most one
      // PUBLISHED row total (DB-enforced, see model's partial-unique
      // {scope,status} index) — matched by scope, not by areaRef.
      const currentlyPublished = await AreaPlatformFeePolicy.findOne(
        policy.scope === PLATFORM_FEE_SCOPE.GLOBAL
          ? { scope: PLATFORM_FEE_SCOPE.GLOBAL, status: AREA_PLATFORM_FEE_STATUS.PUBLISHED }
          : { areaRef: policy.areaRef, status: AREA_PLATFORM_FEE_STATUS.PUBLISHED }
      ).session(session);

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
        meta: {
          scope: policy.scope,
          areaRef: policy.areaRef ? String(policy.areaRef) : null,
          feeInPaise: policy.feeInPaise,
          retiredPolicyId: currentlyPublished?._id ?? null,
        },
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
 * PAN-INDIA FALLBACK: returns { feeInPaise: 0, policyId: null } when
 * areaRef is missing/null OR no PUBLISHED policy exists for it — the
 * booking is never blocked for a missing configuration.
 *
 * STEP 8.2 (policy version follow-up) — also returns the resolved
 * policy's own _id (policyId), so the caller (booking.controller.js)
 * can snapshot it onto the booking for audit traceability. `_id` is
 * projected implicitly (Mongoose includes it by default unless
 * explicitly excluded) — no query shape change, no extra DB round
 * trip. feeInPaise's own meaning/value is completely unchanged; this
 * is purely an additive field on the returned object.
 */
export const resolvePlatformFeeForArea = async (areaRef) => {
  if (!areaRef) return { feeInPaise: 0, policyId: null };

  const published = await AreaPlatformFeePolicy.findOne({
    areaRef,
    status: AREA_PLATFORM_FEE_STATUS.PUBLISHED,
  })
    .select("feeInPaise")
    .lean();

  return {
    feeInPaise: published ? published.feeInPaise : 0,
    policyId: published ? published._id : null,
  };
};

/**
 * LAUNCH RESOLVER — Global Platform Fee.
 *
 * Deliberately NOT a silent-₹0 fallback: returns `null` when no
 * scope:"GLOBAL" PUBLISHED policy exists, so booking.controller.js can
 * refuse to lock the slot with an explicit, controlled error instead
 * of charging an unconfigured ₹0 fee. No areaRef/districtRef/stateRef
 * input — the caller no longer needs to resolve the salon's area at
 * all for Platform Fee purposes.
 *
 * PRICING ENGINE EXPANSION — now takes `serviceAmountInPaise` (the
 * booking's own service total, resolved BEFORE Platform Fee and
 * BEFORE GST per the locked calculation order), and selects the full
 * published document (not just feeInPaise) so
 * calculatePlatformFeeInPaise can read calculationType/percentageRate/
 * slabs. For FIXED-type policies this returns exactly what it always
 * returned; PERCENTAGE/SLAB policies are new, additive behavior.
 */
export const resolveGlobalPlatformFee = async (serviceAmountInPaise) => {
  const published = await AreaPlatformFeePolicy.findOne({
    scope: PLATFORM_FEE_SCOPE.GLOBAL,
    status: AREA_PLATFORM_FEE_STATUS.PUBLISHED,
  }).lean();

  if (!published) return null;

  return { feeInPaise: calculatePlatformFeeInPaise(published, serviceAmountInPaise), policyId: published._id };
};
