import jwt from "jsonwebtoken";
import { verifySession } from "../services/session.service.js";
import { generateAccessToken } from "../services/token.service.js";
import logger from "../utils/logger.js";
import { Errors } from "../utils/response.js";

export const protect = async (req, res, next) => {
  try {
    logger.debug("Protect middleware hit", {
      method: req.method,
      url: req.originalUrl,
    });

    let token;

    const authHeader =
      req.headers.authorization || req.headers.Authorization;

    if (authHeader?.toLowerCase()?.startsWith("bearer ")) {
      token = authHeader.split(" ").pop().trim();
    }

    if (!token) {
      return next(Errors.unauthorized("Not authorized. Token missing."));
    }

    //////////////////////////////////////////////////////
    // 🔐 VERIFY ACCESS TOKEN (OR HANDLE EXPIRED)
    //////////////////////////////////////////////////////

    let decoded;
    let session; // <-- SINGLE session instance reused

    try {
      decoded = jwt.verify(
        token,
        process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET,
        { algorithms: ["HS256"] }
      );
    } catch (err) {
      if (err.name !== "TokenExpiredError") {
        return next(Errors.unauthorized("Invalid token"));
      }

      //////////////////////////////////////////////////////
      // ACCESS TOKEN EXPIRED → VERIFY SESSION ONCE
      //////////////////////////////////////////////////////

      const refreshToken =
        req.cookies?.refreshToken || req.headers["x-refresh-token"];

      if (!refreshToken) {
        return next(Errors.unauthorized("Session expired"));
      }

      session = await verifySession(refreshToken);

      if (!session || !session.user || !session.tokenHash) {
        return next(Errors.unauthorized("Session expired"));
      }

      //////////////////////////////////////////////////////
      // ISSUE NEW ACCESS TOKEN
      //////////////////////////////////////////////////////

      const newAccessToken = generateAccessToken(session.user);

      res.setHeader("x-access-token", newAccessToken);
      req.newAccessToken = newAccessToken;

      logger.debug("Access token re-issued after expiry", {
        userId: session.user._id.toString(),
      });

      decoded = jwt.verify(
        newAccessToken,
        process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET,
        { algorithms: ["HS256"] }
      );
    }

    //////////////////////////////////////////////////////
    // TEMP OWNER SUPPORT
    //////////////////////////////////////////////////////

    if (decoded.tempOwner === true) {
      req.user = Object.freeze({
        phone: decoded.phone,
        role: decoded.role || "OWNER",
        isTemp: true,
      });
      return next();
    }

    if (!decoded.id) {
      return next(Errors.unauthorized("Invalid token payload"));
    }

    //////////////////////////////////////////////////////
    // VERIFY SESSION (ONLY IF NOT ALREADY VERIFIED)
    //////////////////////////////////////////////////////

    if (!session) {
      const refreshToken =
        req.cookies?.refreshToken || req.headers["x-refresh-token"];

      if (!refreshToken) {
        return next(Errors.unauthorized("Session missing"));
      }

      session = await verifySession(refreshToken);

      if (!session || !session.user || !session.tokenHash) {
        return next(Errors.unauthorized("Session expired"));
      }
    }

    const user = session.user;

    //////////////////////////////////////////////////////
    // STRICT TOKEN BINDING
    //////////////////////////////////////////////////////

    if (decoded.id !== user._id.toString()) {
      return next(Errors.unauthorized("Invalid session binding"));
    }

    //////////////////////////////////////////////////////
    // TOKEN VERSION KILL SWITCH
    //////////////////////////////////////////////////////

    if (
      Number(decoded.tokenVersion ?? 0) !== Number(user.tokenVersion ?? 0)
    ) {
      return next(Errors.unauthorized("Session expired"));
    }

    //////////////////////////////////////////////////////
    // ACCOUNT STATUS CHECK
    //////////////////////////////////////////////////////

    if (!user.isActive) {
      logger.warn("Blocked request from disabled account", {
        userId: user._id.toString(),
      });
      return next(Errors.forbidden("Account disabled"));
    }

    if (user.isDeleted) {
      logger.warn("Blocked request from deleted account", {
        userId: user._id.toString(),
      });
      return next(Errors.forbidden("Account removed"));
    }

    //////////////////////////////////////////////////////
    // ATTACH IMMUTABLE USER
    //////////////////////////////////////////////////////

    req.user = Object.freeze({
      id: user._id,
      _id: user._id,
      role: user.role,
      adminLevel: user.adminLevel || null,
      tokenVersion: Number(user.tokenVersion ?? 0),
      countryRef: user.countryRef || null,
      stateRef: user.stateRef || null,
      districtRef: user.districtRef || null,
      cityRef: user.cityRef || null,
      isTemp: false,
    });

    return next();
  } catch (error) {
    logger.error("Protect middleware error", {
      message: error.message,
      stack: error.stack,
    });

    return next(Errors.unauthorized("Invalid session"));
  }
};

// OPTIONAL AUTH — for public routes that want to personalize output
// (e.g. discovery's wishlist.isWishlisted) WITHOUT requiring login.
//
// Unlike protect(), this NEVER blocks the request:
//   - No token           → req.userId stays undefined, continue
//   - Invalid token       → req.userId stays undefined, continue
//   - Expired token       → req.userId stays undefined, continue
//     (no refresh-token dance here — this is a soft, read-only
//     personalization hook, not a session boundary. A user whose
//     access token just expired simply sees isWishlisted:false
//     until their next real authenticated call refreshes it.)
//   - Valid token         → req.userId = decoded.id, continue
//
// Deliberately does NOT verify the session/tokenVersion/account
// status like protect() does — those checks matter for routes that
// mutate data or expose private data. Here we're only using the
// userId to look up which salons THIS browser already wishlisted;
// worst case of a stale/edge-case token is a wrong isWishlisted
// flag on a public listing, not a security issue.
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;

    if (!authHeader?.toLowerCase()?.startsWith("bearer ")) {
      return next(); // no token — proceed as anonymous
    }

    const token = authHeader.split(" ").pop().trim();

    const decoded = jwt.verify(
      token,
      process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET,
      { algorithms: ["HS256"] }
    );

    if (decoded?.id) {
      req.userId = decoded.id;
    }
  } catch (_) {
    // any failure (expired/invalid/malformed) — just proceed anonymous
  }

  return next();
};