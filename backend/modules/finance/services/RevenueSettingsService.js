/**
 * BARBER ENGINE V1
 * backend/modules/finance/services/RevenueSettingsService.js
 *
 * P0 Revenue Calculation Engine — Step 2 (admin authoring for
 * modules/finance/models/RevenueSettings.js).
 *
 * REUSES THE EXISTING COMMERCIAL-POLICY VERSIONING PATTERN VERBATIM —
 * this file's create/publish/retire/list/detail shape and its publish
 * transaction (re-read live state, retire the current PUBLISHED row,
 * publish the new one, bounded retry on a real MongoDB
 * TransientTransactionError) are the same idiom already proven by
 * services/gstPolicy.service.js and
 * modules/fieldAgent/services/commercialPolicy.service.js. No new
 * versioning pattern was invented.
 *
 * LOCKED rule ("existing bookings must never change"): publishing a new
 * version here only ever affects a RevenueSplit calculated AFTER that
 * publish (see RevenueCalculationService.js / RevenueSplit.js, Step 1).
 * This service never touches RevenueSplit, Booking, Wallet, Ledger,
 * Razorpay or Cashfree — it only manages RevenueSettings documents.
 *
 * "Save creates DRAFT. Publish retires previous PUBLISHED version."
 * (ticket's own wording) — createDraftRevenueSettings() is Save;
 * publishRevenueSettings() is the separate Publish action. They are
 * never combined into one call, matching gstPolicy.service.js's own
 * two-step shape (not the single-PATCH shortcut
 * modules/fieldAgent/services/revenueConfig.service.js happens to use
 * for a different, unrelated domain).
 */

import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import { logAdminAction } from "../../../utils/auditLog.js";
import RevenueSettings from "../models/RevenueSettings.js";
import { REVENUE_SETTINGS_STATUS } from "../constants/revenue.constants.js";

const isTransientConflict = (err) =>
  err.hasErrorLabel?.("TransientTransactionError") || err.code === 112 || err.codeName === "WriteConflict";

const getVersionOrThrow = async (versionId) => {
  const version = await RevenueSettings.findById(versionId);
  if (!version) throw Errors.notFound("Revenue settings version not found");
  return version;
};

const assertDraft = (version) => {
  if (version.status !== REVENUE_SETTINGS_STATUS.DRAFT) {
    throw Errors.conflict(`Revenue settings version is ${version.status}, not DRAFT — it is immutable`);
  }
};

const MAX_VERSION_NUMBER_ATTEMPTS = 5;

/**
 * "Save" — creates a new DRAFT. Never touches the currently PUBLISHED
 * version. version number = (highest existing version) + 1, resolved
 * fresh on every attempt with a bounded retry on the unique-index
 * collision — same idiom as commercialPolicy.service.js's own
 * createDraftPolicyVersion, proven against real concurrent-create races.
 */
export const createDraftRevenueSettings = async ({
  adminId, platformFeeInPaise, gstRate, gstEnabled, minimumPayoutInPaise, autoPayoutEnabled, req,
}) => {
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_VERSION_NUMBER_ATTEMPTS; attempt++) {
    const last = await RevenueSettings.findOne().sort({ version: -1 }).select("version").lean();
    const version = (last?.version ?? 0) + 1;
    try {
      const doc = await RevenueSettings.create({
        platformFeeInPaise,
        gstRate,
        gstEnabled,
        minimumPayoutInPaise,
        autoPayoutEnabled,
        version,
        createdBy: adminId,
      });

      await logAdminAction({
        adminId,
        action: "REVENUE_SETTINGS_CREATED",
        targetType: "REVENUE_SETTINGS",
        targetId: doc._id,
        meta: { version, platformFeeInPaise, gstRate, gstEnabled, minimumPayoutInPaise, autoPayoutEnabled },
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

export const listRevenueSettings = ({ page = 1, limit = 20 } = {}) => {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const safePage = Math.max(1, Number(page) || 1);
  return RevenueSettings.find()
    .sort({ version: -1 })
    .skip((safePage - 1) * safeLimit)
    .limit(safeLimit)
    .lean();
};

export const getRevenueSettingsDetail = (versionId) => getVersionOrThrow(versionId);

/** The currently PUBLISHED version, or null if none exists yet. Read-only. */
export const getPublishedRevenueSettings = () =>
  RevenueSettings.findOne({ status: REVENUE_SETTINGS_STATUS.PUBLISHED }).lean();

export const updateDraftRevenueSettings = async ({
  versionId, adminId, platformFeeInPaise, gstRate, gstEnabled, minimumPayoutInPaise, autoPayoutEnabled, req,
}) => {
  const version = await getVersionOrThrow(versionId);
  assertDraft(version);

  if (platformFeeInPaise !== undefined) version.platformFeeInPaise = platformFeeInPaise;
  if (gstRate !== undefined) version.gstRate = gstRate;
  if (gstEnabled !== undefined) version.gstEnabled = gstEnabled;
  if (minimumPayoutInPaise !== undefined) version.minimumPayoutInPaise = minimumPayoutInPaise;
  if (autoPayoutEnabled !== undefined) version.autoPayoutEnabled = autoPayoutEnabled;
  await version.save();

  await logAdminAction({
    adminId,
    action: "REVENUE_SETTINGS_UPDATED",
    targetType: "REVENUE_SETTINGS",
    targetId: version._id,
    meta: { platformFeeInPaise, gstRate, gstEnabled, minimumPayoutInPaise, autoPayoutEnabled },
    req,
  });

  return version;
};

const MAX_PUBLISH_ATTEMPTS = 5;

/**
 * "Publish" — retires whichever version is currently PUBLISHED (if any)
 * and publishes this DRAFT, atomically, in one transaction. Bounded
 * retry on a genuine transient write conflict, re-reading live state on
 * every attempt — identical to gstPolicy.service.js's own
 * publishGstPolicy, the exact pattern this step is required to reuse.
 *
 * DB-ENFORCED, not just this transaction: RevenueSettings' own partial
 * unique index on {status: PUBLISHED} means even a bypassed code path
 * could never create a second PUBLISHED row.
 */
export const publishRevenueSettings = async ({ versionId, adminId, req }) => {
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_PUBLISH_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const version = await RevenueSettings.findById(versionId).session(session);
      if (!version) throw Errors.notFound("Revenue settings version not found");
      if (version.status !== REVENUE_SETTINGS_STATUS.DRAFT) {
        throw Errors.conflict(`Revenue settings version is ${version.status}, not DRAFT`);
      }

      const currentlyPublished = await RevenueSettings.findOne({ status: REVENUE_SETTINGS_STATUS.PUBLISHED }).session(session);
      if (currentlyPublished) {
        currentlyPublished.status = REVENUE_SETTINGS_STATUS.RETIRED;
        currentlyPublished.retiredAt = new Date();
        currentlyPublished.retiredBy = adminId;
        await currentlyPublished.save({ session });
      }

      version.status = REVENUE_SETTINGS_STATUS.PUBLISHED;
      version.publishedAt = new Date();
      version.publishedBy = adminId;
      await version.save({ session });

      await session.commitTransaction();

      await logAdminAction({
        adminId,
        action: "REVENUE_SETTINGS_PUBLISHED",
        targetType: "REVENUE_SETTINGS",
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

export const retireRevenueSettings = async ({ versionId, adminId, req }) => {
  const version = await getVersionOrThrow(versionId);
  if (version.status !== REVENUE_SETTINGS_STATUS.PUBLISHED) {
    throw Errors.conflict(`Revenue settings version is ${version.status}, not PUBLISHED`);
  }
  version.status = REVENUE_SETTINGS_STATUS.RETIRED;
  version.retiredAt = new Date();
  version.retiredBy = adminId;
  await version.save();

  await logAdminAction({
    adminId,
    action: "REVENUE_SETTINGS_RETIRED",
    targetType: "REVENUE_SETTINGS",
    targetId: version._id,
    meta: { version: version.version },
    req,
  });

  return version;
};
