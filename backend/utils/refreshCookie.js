/**
 * BARBER ENGINE V1 | backend/utils/refreshCookie.js
 *
 * Single source of truth for the `refreshToken` cookie's options.
 * Previously duplicated across auth.controller.js, auth.routes.js and
 * adminAuth.controller.js with drifted `path` values (some "/", one
 * "/api/auth/refresh") — since all three set/clear a cookie with the
 * SAME name, a mismatched path meant a new Set-Cookie never replaced
 * an older one, leaving stale/rotated refresh tokens sitting in the
 * client's cookie jar alongside the current one. `path: "/"` is
 * required here (not just a default) because `protect()` middleware
 * expects a resolvable refresh-token cookie on every authenticated
 * request, not only when the access token has expired.
 */

export const REFRESH_COOKIE_NAME = "refreshToken";

const isProduction = () => process.env.NODE_ENV === "production";

export const getRefreshCookieOptions = () => ({
  httpOnly: true,
  secure: isProduction(),
  sameSite: isProduction() ? "none" : "lax",
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
});

export const getClearRefreshCookieOptions = () => ({
  httpOnly: true,
  secure: isProduction(),
  sameSite: isProduction() ? "none" : "lax",
  path: "/",
  maxAge: 0,
});
