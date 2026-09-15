/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/performancePolicy.service.js
 *
 * FA-11.1 — PerformancePolicyVersion authoring/versioning ONLY. Mirrors
 * commercialPolicy.service.js's DRAFT/PUBLISHED/RETIRED discipline
 * exactly, including its two deliberate strengthenings (bounded-retry
 * versionNumber generation on a duplicate-key collision; publish
 * retries on a real MongoDB TransientTransactionError/WriteConflict).
 *
 * This file does NOT compute or persist any FieldAgentPerformanceSnapshot
 * — that aggregation is FA-11.2 scope. This is domain-foundation
 * lifecycle management only.
 */

import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import PerformancePolicyVersion from "../models/PerformancePolicyVersion.js";
import FieldAgentAuditEvent from "../models/FieldAgentAuditEvent.js";
import { AUDIT_ACTOR_TYPE, AUDIT_ACTION, AUDIT_ENTITY_TYPE } from "../constants/fieldAgent.constants.js";
import { PERFORMANCE_POLICY_STATUS } from "../constants/performance.constants.js";

const getVersionOrThrow = async (versionId) => {
  const version = await PerformancePolicyVersion.findById(versionId);
  if (!version) throw Errors.notFound("Performance policy version not found");
  return version;
};

const isTransientConflict = (err) =>
  err.hasErrorLabel?.("TransientTransactionError") || err.code === 112 || err.codeName === "WriteConflict";

// ─── CREATE (bounded retry on versionNumber collision) ──────────────
const MAX_VERSION_NUMBER_ATTEMPTS = 5;

export const createDraftPerformancePolicyVersion = async ({ adminId, rollingWindowDays, dimensionsEnabled }) => {
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_VERSION_NUMBER_ATTEMPTS; attempt++) {
    const last = await PerformancePolicyVersion.findOne().sort({ versionNumber: -1 }).select("versionNumber").lean();
    const versionNumber = (last?.versionNumber ?? 0) + 1;
    try {
      const version = await PerformancePolicyVersion.create({
        versionNumber,
        createdBy: adminId,
        rollingWindowDays,
        dimensionsEnabled: dimensionsEnabled ?? [],
      });

      await FieldAgentAuditEvent.create([
        {
          entityType: AUDIT_ENTITY_TYPE.PERFORMANCE_POLICY_VERSION,
          entityId: version._id,
          actorRef: adminId,
          actorType: AUDIT_ACTOR_TYPE.ADMIN,
          action: AUDIT_ACTION.PERFORMANCE_POLICY_CREATED,
          newValue: { versionNumber },
        },
      ]).catch((err) => {
        console.error("❌ FA-11.1 FieldAgentAuditEvent write failed:", err.message || err);
      });

      return version;
    } catch (err) {
      lastErr = err;
      const isDuplicateVersionNumber = err.code === 11000 && err.keyPattern?.versionNumber;
      if (isDuplicateVersionNumber && attempt < MAX_VERSION_NUMBER_ATTEMPTS - 1) {
        continue; // recompute max and retry, bounded
      }
      throw err;
    }
  }
  throw lastErr;
};

export const getPerformancePolicyVersionDetail = (versionId) => getVersionOrThrow(versionId);

// ─── PUBLISH / RETIRE ─────────────────────────────────────────────
const MAX_PUBLISH_ATTEMPTS = 5;

export const publishPerformancePolicyVersion = async ({ versionId, adminId }) => {
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_PUBLISH_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      // Always re-read live state inside this transaction's own
      // snapshot — never trust a read taken before the loop started.
      const version = await PerformancePolicyVersion.findById(versionId).session(session);
      if (!version) throw Errors.notFound("Performance policy version not found");
      if (version.status !== PERFORMANCE_POLICY_STATUS.DRAFT) {
        throw Errors.conflict(`Policy version ${version.versionNumber} is ${version.status}, not DRAFT`);
      }

      const currentlyPublished = await PerformancePolicyVersion.findOne({ status: PERFORMANCE_POLICY_STATUS.PUBLISHED }).session(
        session
      );
      if (currentlyPublished) {
        currentlyPublished.status = PERFORMANCE_POLICY_STATUS.RETIRED;
        currentlyPublished.retiredAt = new Date();
        currentlyPublished.retiredBy = adminId;
        await currentlyPublished.save({ session });

        await FieldAgentAuditEvent.create(
          [
            {
              entityType: AUDIT_ENTITY_TYPE.PERFORMANCE_POLICY_VERSION,
              entityId: currentlyPublished._id,
              actorRef: adminId,
              actorType: AUDIT_ACTOR_TYPE.ADMIN,
              action: AUDIT_ACTION.PERFORMANCE_POLICY_RETIRED,
              reason: `Superseded by version ${version.versionNumber}`,
            },
          ],
          { session }
        );
      }

      version.status = PERFORMANCE_POLICY_STATUS.PUBLISHED;
      version.publishedAt = new Date();
      version.publishedBy = adminId;
      await version.save({ session });

      await FieldAgentAuditEvent.create(
        [
          {
            entityType: AUDIT_ENTITY_TYPE.PERFORMANCE_POLICY_VERSION,
            entityId: version._id,
            actorRef: adminId,
            actorType: AUDIT_ACTOR_TYPE.ADMIN,
            action: AUDIT_ACTION.PERFORMANCE_POLICY_PUBLISHED,
            newValue: { versionNumber: version.versionNumber },
          },
        ],
        { session }
      );

      await session.commitTransaction();
      return version;
    } catch (err) {
      await session.abortTransaction();
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

export const retirePerformancePolicyVersion = async ({ versionId, adminId, reason }) => {
  const version = await getVersionOrThrow(versionId);
  if (version.status !== PERFORMANCE_POLICY_STATUS.PUBLISHED) {
    throw Errors.conflict(`Policy version ${version.versionNumber} is ${version.status}, not PUBLISHED`);
  }

  version.status = PERFORMANCE_POLICY_STATUS.RETIRED;
  version.retiredAt = new Date();
  version.retiredBy = adminId;
  await version.save();

  await FieldAgentAuditEvent.create([
    {
      entityType: AUDIT_ENTITY_TYPE.PERFORMANCE_POLICY_VERSION,
      entityId: version._id,
      actorRef: adminId,
      actorType: AUDIT_ACTOR_TYPE.ADMIN,
      action: AUDIT_ACTION.PERFORMANCE_POLICY_RETIRED,
      reason: reason ?? "Manually retired by admin",
    },
  ]).catch((err) => {
    console.error("❌ FA-11.1 FieldAgentAuditEvent write failed:", err.message || err);
  });

  return version;
};
