/**
 * BARBER ENGINE V1
 * backend/modules/finance/services/TerritoryRevenueSettingsService.js
 *
 * STEP 5.1 — Territory Revenue Settings Engine.
 *
 * REUSES THE EXISTING REVENUE-SETTINGS VERSIONING PATTERN VERBATIM —
 * this file's create/publish/retire/list shape and its publish
 * transaction (re-read live state, retire the current PUBLISHED row,
 * publish the new one, bounded retry on a real MongoDB
 * TransientTransactionError) are the same idiom already proven by
 * RevenueSettingsService.js, gstPolicy.service.js and
 * commercialPolicy.service.js. No new versioning pattern was invented.
 *
 * ISOLATION (LOCKED): this service never imports or touches
 * RevenueSettings, RevenueSplit, GstLedger, Razorpay, Refund,
 * CommercialPolicyVersion/Override, Wallet, WalletLedger or Booking. It
 * only manages TerritoryRevenueSettings documents.
 *
 * "Save creates DRAFT. Publish retires previous PUBLISHED version" —
 * createDraftTerritoryRevenueSettings() is Save; publish/retire are
 * separate actions, never combined into one call.
 */

import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import { logAdminAction } from "../../../utils/auditLog.js";
import TerritoryRevenueSettings from "../models/TerritoryRevenueSettings.js";
import { TERRITORY_REVENUE_STATUS } from "../constants/territoryRevenue.constants.js";

const isTransientConflict = (err) =>
  err.hasErrorLabel?.("TransientTransactionError") || err.code === 112 || err.codeName === "WriteConflict";

const getVersionOrThrow = async (versionId) => {
  const version = await TerritoryRevenueSettings.findById(versionId);
  if (!version) throw Errors.notFound("Territory revenue settings version not found");
  return version;
};

const assertDraft = (version) => {
  if (version.status !== TERRITORY_REVENUE_STATUS.DRAFT) {
    throw Errors.conflict(`Territory revenue settings version is ${version.status}, not DRAFT — it is immutable`);
  }
};

const MAX_VERSION_NUMBER_ATTEMPTS = 5;

/**
 * "Save" — creates a new DRAFT. Never touches the currently PUBLISHED
 * version. version number = (highest existing version) + 1, resolved
 * fresh on every attempt with a bounded retry on the unique-index
 * collision — same idiom as RevenueSettingsService's own
 * createDraftRevenueSettings, proven against real concurrent-create races.
 */
export const createDraftTerritoryRevenueSettings = async ({
  adminId, territoryCommissionPercent, minimumPayoutInPaise, req,
}) => {
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_VERSION_NUMBER_ATTEMPTS; attempt++) {
    const last = await TerritoryRevenueSettings.findOne().sort({ version: -1 }).select("version").lean();
    const version = (last?.version ?? 0) + 1;
    try {
      const doc = await TerritoryRevenueSettings.create({
        territoryCommissionPercent,
        minimumPayoutInPaise,
        version,
        createdBy: adminId,
      });

      await logAdminAction({
        adminId,
        action: "TERRITORY_REVENUE_SETTINGS_CREATED",
        targetType: "TERRITORY_REVENUE_SETTINGS",
        targetId: doc._id,
        meta: { version, territoryCommissionPercent, minimumPayoutInPaise },
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

export const listTerritoryRevenueSettings = ({ page = 1, limit = 20 } = {}) => {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const safePage = Math.max(1, Number(page) || 1);
  return TerritoryRevenueSettings.find()
    .sort({ version: -1 })
    .skip((safePage - 1) * safeLimit)
    .limit(safeLimit)
    .lean();
};

/** The currently PUBLISHED version, or null if none exists yet. Read-only. */
export const getPublishedTerritoryRevenueSettings = () =>
  TerritoryRevenueSettings.findOne({ status: TERRITORY_REVENUE_STATUS.PUBLISHED }).lean();

export const updateDraftTerritoryRevenueSettings = async ({
  versionId, adminId, territoryCommissionPercent, minimumPayoutInPaise, req,
}) => {
  const version = await getVersionOrThrow(versionId);
  assertDraft(version);

  if (territoryCommissionPercent !== undefined) version.territoryCommissionPercent = territoryCommissionPercent;
  if (minimumPayoutInPaise !== undefined) version.minimumPayoutInPaise = minimumPayoutInPaise;
  await version.save();

  await logAdminAction({
    adminId,
    action: "TERRITORY_REVENUE_SETTINGS_UPDATED",
    targetType: "TERRITORY_REVENUE_SETTINGS",
    targetId: version._id,
    meta: { territoryCommissionPercent, minimumPayoutInPaise },
    req,
  });

  return version;
};

const MAX_PUBLISH_ATTEMPTS = 5;

/**
 * "Publish" — retires whichever version is currently PUBLISHED (if any)
 * and publishes this DRAFT, atomically, in one transaction. Bounded
 * retry on a genuine transient write conflict, re-reading live state on
 * every attempt — identical to RevenueSettingsService's own
 * publishRevenueSettings, the exact pattern this step is required to reuse.
 *
 * DB-ENFORCED, not just this transaction: TerritoryRevenueSettings' own
 * partial unique index on {status: PUBLISHED} means even a bypassed
 * code path could never create a second PUBLISHED row.
 */
export const publishTerritoryRevenueSettings = async ({ versionId, adminId, req }) => {
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_PUBLISH_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const version = await TerritoryRevenueSettings.findById(versionId).session(session);
      if (!version) throw Errors.notFound("Territory revenue settings version not found");
      if (version.status !== TERRITORY_REVENUE_STATUS.DRAFT) {
        throw Errors.conflict(`Territory revenue settings version is ${version.status}, not DRAFT`);
      }

      const currentlyPublished = await TerritoryRevenueSettings.findOne({ status: TERRITORY_REVENUE_STATUS.PUBLISHED }).session(session);
      if (currentlyPublished) {
        currentlyPublished.status = TERRITORY_REVENUE_STATUS.RETIRED;
        currentlyPublished.retiredAt = new Date();
        currentlyPublished.retiredBy = adminId;
        await currentlyPublished.save({ session });
      }

      version.status = TERRITORY_REVENUE_STATUS.PUBLISHED;
      version.publishedAt = new Date();
      version.publishedBy = adminId;
      await version.save({ session });

      await session.commitTransaction();

      await logAdminAction({
        adminId,
        action: "TERRITORY_REVENUE_SETTINGS_PUBLISHED",
        targetType: "TERRITORY_REVENUE_SETTINGS",
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

export const retireTerritoryRevenueSettings = async ({ versionId, adminId, req }) => {
  const version = await getVersionOrThrow(versionId);
  if (version.status !== TERRITORY_REVENUE_STATUS.PUBLISHED) {
    throw Errors.conflict(`Territory revenue settings version is ${version.status}, not PUBLISHED`);
  }
  version.status = TERRITORY_REVENUE_STATUS.RETIRED;
  version.retiredAt = new Date();
  version.retiredBy = adminId;
  await version.save();

  await logAdminAction({
    adminId,
    action: "TERRITORY_REVENUE_SETTINGS_RETIRED",
    targetType: "TERRITORY_REVENUE_SETTINGS",
    targetId: version._id,
    meta: { version: version.version },
    req,
  });

  return version;
};
