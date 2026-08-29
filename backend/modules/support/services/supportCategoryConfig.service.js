/**
 * BARBER ENGINE V1
 * backend/modules/support/services/supportCategoryConfig.service.js
 *
 * Phase H Step 8 (Step 2) — Support Configuration Management:
 * Categories. Full admin CRUD over SupportCategory, deliberately
 * SEPARATE from supportTicket.service.js's own listActiveCategories()
 * (the customer ticket-creation picker AND the existing admin
 * dropdown reused by SlaPolicyPage/SupportAgentsPage: active-only,
 * {_id,name,code,description,parentCategoryRef} projection) — that
 * function and its two routes (GET /api/support/customer/categories,
 * GET /api/support/admin/categories) are left completely unchanged.
 * This file's listCategoriesForAdmin() is a distinct function for the
 * new management view (all non-deleted categories, active or
 * inactive, full fields) reached via a separate route
 * (GET /api/support/admin/categories/manage).
 *
 * createdBy/updatedBy (already on SupportCategory.js) are reused as
 * the audit mechanism, same as Teams — SupportAuditEvent is not used
 * here since its schema requires a ticketRef.
 *
 * SupportCategory.code has a NON-partial unique index (see the
 * model's own comment: a soft-deleted category's code stays
 * permanently reserved) — this is an EXISTING constraint, preserved
 * as-is, not weakened or worked around here.
 */

import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import SupportCategory from "../models/SupportCategory.js";

/////////////////////////////////////////////////////////////
// 🔍 VALIDATION — parentCategoryRef must reference a real, non-deleted
// category, and must never point at itself (would create a
// self-referential cycle the schema itself does not guard against).
/////////////////////////////////////////////////////////////

async function assertParentCategoryValid(parentCategoryRef, selfId = null) {
  if (!parentCategoryRef) return;
  if (selfId && String(parentCategoryRef) === String(selfId)) {
    throw Errors.badRequest("A category cannot be its own parent");
  }
  const parent = await SupportCategory.findOne({ _id: parentCategoryRef, isDeleted: false }).select("_id").lean();
  if (!parent) {
    throw Errors.badRequest("parentCategoryRef must reference an existing category");
  }
}

function toPublicCategory(category) {
  return {
    id: category._id,
    name: category.name,
    code: category.code,
    description: category.description,
    parentCategoryRef: category.parentCategoryRef,
    businessDomain: category.businessDomain,
    isActive: category.isActive,
    createdBy: category.createdBy,
    updatedBy: category.updatedBy,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}

/////////////////////////////////////////////////////////////
// 🚀 CREATE
/////////////////////////////////////////////////////////////

export async function createCategory({ name, code, description = null, parentCategoryRef = null, businessDomain = null, actorId }) {
  await assertParentCategoryValid(parentCategoryRef);

  try {
    const category = await SupportCategory.create({
      name,
      code,
      description,
      parentCategoryRef,
      businessDomain,
      isActive: true,
      isDeleted: false,
      createdBy: actorId,
      updatedBy: actorId,
    });
    return toPublicCategory(category);
  } catch (err) {
    if (err.code === 11000) {
      throw Errors.conflict("A category with this code already exists");
    }
    throw err;
  }
}

/////////////////////////////////////////////////////////////
// 📋 LIST — management view. All non-deleted categories (active AND
// inactive), full fields.
/////////////////////////////////////////////////////////////

export async function listCategoriesForAdmin() {
  const categories = await SupportCategory.find({ isDeleted: false })
    .sort({ name: 1 })
    .lean();
  return categories.map(toPublicCategory);
}

/////////////////////////////////////////////////////////////
// ✏️ UPDATE — single-document write, no transaction needed (matches
// the Teams config service).
/////////////////////////////////////////////////////////////

export async function updateCategory(id, updates, actorId) {
  if (!mongoose.isValidObjectId(id)) throw Errors.notFound("Category not found");

  const category = await SupportCategory.findOne({ _id: id, isDeleted: false });
  if (!category) throw Errors.notFound("Category not found");

  if (Object.prototype.hasOwnProperty.call(updates, "parentCategoryRef")) {
    await assertParentCategoryValid(updates.parentCategoryRef, id);
  }

  Object.assign(category, updates, { updatedBy: actorId });

  try {
    await category.save();
  } catch (err) {
    if (err.code === 11000) {
      throw Errors.conflict("A category with this code already exists");
    }
    throw err;
  }

  return toPublicCategory(category);
}

/////////////////////////////////////////////////////////////
// 🔌 STATUS — activate/deactivate. Deactivating a category does not
// cascade to any ticket, queue, routing rule, or coverage row that
// references it — none of those engines are modified by this change,
// and an already-referenced categoryRef on an existing ticket/config
// row remains exactly as it was (matching the codebase-wide idiom of
// never retroactively rewriting historical/config references).
/////////////////////////////////////////////////////////////

export async function updateCategoryStatus(id, isActive, actorId) {
  return updateCategory(id, { isActive }, actorId);
}
