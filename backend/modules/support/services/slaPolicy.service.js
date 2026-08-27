/**
 * BARBER ENGINE V1
 * backend/modules/support/services/slaPolicy.service.js
 *
 * Phase G Step 1 — SLA Policy CRUD only. No SLA runtime calculation,
 * no ticket integration, no scanner — those are later slices per the
 * approved implementation order. This file's only job is validating
 * and persisting SupportSlaPolicy documents.
 */

import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import SupportCategory from "../models/SupportCategory.js";
import SupportSlaPolicy from "../models/SupportSlaPolicy.js";

async function assertCategoryExists(categoryRef) {
  if (!categoryRef) return; // null = global default, nothing to check
  const category = await SupportCategory.findOne({ _id: categoryRef, isDeleted: false }).select("_id").lean();
  if (!category) throw Errors.badRequest("categoryRef does not reference an existing category");
}

async function assertNoDuplicate(categoryRef, excludeId = null) {
  const filter = { categoryRef, isDeleted: false };
  if (excludeId) filter._id = { $ne: excludeId };
  const existing = await SupportSlaPolicy.findOne(filter).select("_id").lean();
  if (existing) {
    throw Errors.conflict(
      categoryRef ? "An SLA policy already exists for this category" : "A global default SLA policy already exists"
    );
  }
}

export async function createSlaPolicy({ categoryRef, targetsByPriority, warningThresholdPercent, isActive, actorId }) {
  await assertCategoryExists(categoryRef);
  await assertNoDuplicate(categoryRef);

  try {
    return await SupportSlaPolicy.create({
      categoryRef,
      targetsByPriority,
      warningThresholdPercent,
      isActive,
      createdBy: actorId,
      updatedBy: actorId,
    });
  } catch (err) {
    // Race-condition-safe fallback — the unique index on categoryRef
    // is the authoritative guard; the pre-check above is only for a
    // friendly error message under normal (non-racing) conditions.
    if (err.code === 11000) {
      throw Errors.conflict(
        categoryRef ? "An SLA policy already exists for this category" : "A global default SLA policy already exists"
      );
    }
    throw err;
  }
}

export async function listSlaPolicies({ query = {} } = {}) {
  const filter = { isDeleted: false };
  if (query.isActive === "true") filter.isActive = true;
  if (query.isActive === "false") filter.isActive = false;

  return SupportSlaPolicy.find(filter).sort({ categoryRef: 1 }).lean();
}

export async function getSlaPolicyById(id) {
  if (!mongoose.isValidObjectId(id)) throw Errors.notFound("SLA policy not found");
  const policy = await SupportSlaPolicy.findOne({ _id: id, isDeleted: false }).lean();
  if (!policy) throw Errors.notFound("SLA policy not found");
  return policy;
}

export async function updateSlaPolicy(id, updates, actorId) {
  if (!mongoose.isValidObjectId(id)) throw Errors.notFound("SLA policy not found");
  const policy = await SupportSlaPolicy.findOne({ _id: id, isDeleted: false });
  if (!policy) throw Errors.notFound("SLA policy not found");

  // categoryRef may be omitted (unchanged) — only re-validate
  // existence/uniqueness when it's actually being changed.
  const categoryRefChanging = Object.prototype.hasOwnProperty.call(updates, "categoryRef")
    && String(updates.categoryRef) !== String(policy.categoryRef);

  if (categoryRefChanging) {
    await assertCategoryExists(updates.categoryRef);
    await assertNoDuplicate(updates.categoryRef, policy._id);
  }

  Object.assign(policy, updates, { updatedBy: actorId });

  try {
    await policy.save();
  } catch (err) {
    if (err.code === 11000) {
      throw Errors.conflict(
        policy.categoryRef ? "An SLA policy already exists for this category" : "A global default SLA policy already exists"
      );
    }
    throw err;
  }

  return policy;
}

export async function updateSlaPolicyStatus(id, isActive, actorId) {
  return updateSlaPolicy(id, { isActive }, actorId);
}

/**
 * Phase G Step 2 — the smallest reusable policy-resolution helper,
 * kept isolated from the CRUD functions above (none of which are
 * modified by this addition) so later phases can reuse it without
 * re-deriving the precedence rule. Category-specific active,
 * non-deleted policy wins; otherwise the active, non-deleted global
 * default (categoryRef: null); otherwise null — callers must treat
 * null as "no policy available" and handle it explicitly (this
 * function invents no fallback SLA values itself).
 */
export async function resolveEffectiveSlaPolicy({ categoryRef }) {
  if (categoryRef) {
    const categoryPolicy = await SupportSlaPolicy.findOne({
      categoryRef,
      isActive: true,
      isDeleted: false,
    }).lean();
    if (categoryPolicy) return categoryPolicy;
  }

  const globalPolicy = await SupportSlaPolicy.findOne({
    categoryRef: null,
    isActive: true,
    isDeleted: false,
  }).lean();

  return globalPolicy || null;
}

// Soft-delete only — matches the isDeleted convention already used
// by every other Support configuration model (SupportCategory,
// SupportTeam, SupportQueue). Never a hard Mongo delete.
export async function deleteSlaPolicy(id, actorId) {
  if (!mongoose.isValidObjectId(id)) throw Errors.notFound("SLA policy not found");
  const policy = await SupportSlaPolicy.findOne({ _id: id, isDeleted: false });
  if (!policy) throw Errors.notFound("SLA policy not found");

  policy.isDeleted = true;
  policy.updatedBy = actorId;
  await policy.save();

  return policy;
}
