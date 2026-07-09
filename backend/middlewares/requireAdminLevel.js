/**
 * BARBER ENGINE V1
 * backend/middlewares/requireAdminLevel.js — FINAL
 */

import { Errors } from "../utils/response.js";

export const requireAdminLevel = (...allowedLevels) => {
  return (req, res, next) => {
    const admin = req.user;

    if (!admin || admin.role !== "ADMIN") {
      return next(Errors.forbidden("Admin access required"));
    }

    if (!admin.adminLevel) {
      return next(Errors.forbidden("Admin level not configured"));
    }

    const currentLevel      = String(admin.adminLevel).toUpperCase();
    const normalizedAllowed = allowedLevels.map((l) => String(l).toUpperCase());

    if (!normalizedAllowed.includes(currentLevel)) {
      return next(Errors.forbidden("Insufficient admin privileges"));
    }

    next();
  };
};