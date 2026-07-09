/**
 * BARBER ENGINE V1
 * backend/middlewares/role.middleware.js — FINAL
 */

import { Errors } from "../utils/response.js";

export const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    const user = req.user;

    if (!user) return next(Errors.unauthorized("Not authorized"));

    const normalizedAllowed = allowedRoles.map((r) => String(r).toUpperCase());
    const userRole = String(user.role).toUpperCase();

    if (!normalizedAllowed.includes(userRole)) {
      return next(Errors.forbidden("Access denied"));
    }

    next();
  };
};