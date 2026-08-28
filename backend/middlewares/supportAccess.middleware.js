/**
 * BARBER ENGINE V1
 * backend/middlewares/supportAccess.middleware.js
 *
 * Support-module authorization gate. Same shape and behavior as
 * requireRole(...roles) (role.middleware.js) — which is left untouched
 * since it's used broadly across the whole app — plus exactly one
 * additional, narrowly-scoped acceptance path: the single, DB-uniquely-
 * constrained India-level Admin account (role:"ADMIN",
 * adminLevel:"INDIA" — see User.js's partial unique index on
 * {role,adminLevel}), so the main Admin Console's top-tier operator can
 * reach Support Admin APIs using their existing main-console session,
 * with no second login and no new token/cookie system.
 *
 * STATE/DISTRICT admins (role:"ADMIN", any other adminLevel) are NOT
 * granted access — only adminLevel === "INDIA" qualifies. AGENT/
 * SUPPORT_ADMIN behavior is completely unchanged: whatever baseRoles a
 * call site passes in works exactly as requireRole would.
 */

import { Errors } from "../utils/response.js";

export const requireSupportAccess = (...baseRoles) => {
  const normalizedBaseRoles = baseRoles.map((r) => String(r).toUpperCase());

  return (req, res, next) => {
    const user = req.user;

    if (!user) return next(Errors.unauthorized("Not authorized"));

    const userRole = String(user.role).toUpperCase();

    if (normalizedBaseRoles.includes(userRole)) return next();

    if (userRole === "ADMIN" && user.adminLevel === "INDIA") return next();

    return next(Errors.forbidden("Access denied"));
  };
};
