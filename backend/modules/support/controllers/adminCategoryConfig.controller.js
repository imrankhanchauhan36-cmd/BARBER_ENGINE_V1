/**
 * BARBER ENGINE V1
 * backend/modules/support/controllers/adminCategoryConfig.controller.js
 *
 * Phase H Step 8 (Step 2) — Support Configuration Management:
 * Categories. Thin controllers, same layering as adminTeamConfig.
 * controller.js. SUPPORT_ADMIN/India-Admin-only, enforced at the
 * route level via requireSupportAccess, not re-checked here.
 */

import { successResponse } from "../../../utils/response.js";
import {
  createCategory,
  listCategoriesForAdmin,
  updateCategory,
  updateCategoryStatus,
} from "../services/supportCategoryConfig.service.js";

export const createCategoryHandler = async (req, res, next) => {
  try {
    const category = await createCategory({
      name: req.body.name,
      code: req.body.code,
      description: req.body.description,
      parentCategoryRef: req.body.parentCategoryRef,
      businessDomain: req.body.businessDomain,
      actorId: req.user._id,
    });

    return successResponse(res, {
      statusCode: 201,
      message: "Category created successfully",
      data: { category },
    });
  } catch (err) {
    return next(err);
  }
};

export const listCategoriesForAdminHandler = async (req, res, next) => {
  try {
    const categories = await listCategoriesForAdmin();

    return successResponse(res, {
      message: "Categories fetched successfully",
      data: { categories },
    });
  } catch (err) {
    return next(err);
  }
};

export const updateCategoryHandler = async (req, res, next) => {
  try {
    const category = await updateCategory(req.params.id, req.body, req.user._id);

    return successResponse(res, {
      message: "Category updated successfully",
      data: { category },
    });
  } catch (err) {
    return next(err);
  }
};

export const updateCategoryStatusHandler = async (req, res, next) => {
  try {
    const category = await updateCategoryStatus(req.params.id, req.body.isActive, req.user._id);

    return successResponse(res, {
      message: "Category status updated successfully",
      data: { category },
    });
  } catch (err) {
    return next(err);
  }
};
