import jwt from "jsonwebtoken";
import { verifySession } from "../services/session.service.js";
import { generateAccessToken } from "../services/token.service.js";

export const protect = async (req, res, next) => {
  try {

    if (process.env.NODE_ENV !== "production") {
      console.log("🔐 PROTECT HIT:", req.method, req.originalUrl);
    }

    let token;

    const authHeader =
      req.headers.authorization || req.headers.Authorization;

    if (authHeader?.toLowerCase()?.startsWith("bearer ")) {
      token = authHeader.split(" ").pop().trim();
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not authorized. Token missing.",
      });
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
        return res.status(401).json({
          success: false,
          message: "Invalid token",
        });
      }

      //////////////////////////////////////////////////////
      // ACCESS TOKEN EXPIRED → VERIFY SESSION ONCE
      //////////////////////////////////////////////////////

      const refreshToken =
        req.cookies?.refreshToken ||
        req.headers["x-refresh-token"];

      if (!refreshToken) {
        return res.status(401).json({
          success: false,
          message: "Session expired",
        });
      }

      session = await verifySession(refreshToken);

      if (!session || !session.user || !session.tokenHash) {
        return res.status(401).json({
          success: false,
          message: "Session expired",
        });
      }

      //////////////////////////////////////////////////////
      // ISSUE NEW ACCESS TOKEN
      //////////////////////////////////////////////////////

      const newAccessToken = generateAccessToken(session.user);

      res.setHeader("x-access-token", newAccessToken);

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
      return res.status(401).json({
        success: false,
        message: "Invalid token payload",
      });
    }

    //////////////////////////////////////////////////////
    // VERIFY SESSION (ONLY IF NOT ALREADY VERIFIED)
    //////////////////////////////////////////////////////

    if (!session) {

      const refreshToken =
        req.cookies?.refreshToken ||
        req.headers["x-refresh-token"];

      if (!refreshToken) {
        return res.status(401).json({
          success: false,
          message: "Session missing",
        });
      }

      session = await verifySession(refreshToken);

      if (!session || !session.user || !session.tokenHash) {
        return res.status(401).json({
          success: false,
          message: "Session expired",
        });
      }
    }

    const user = session.user;

    //////////////////////////////////////////////////////
    // STRICT TOKEN BINDING
    //////////////////////////////////////////////////////

    if (decoded.id !== user._id.toString()) {
      return res.status(401).json({
        success: false,
        message: "Invalid session binding",
      });
    }

    //////////////////////////////////////////////////////
    // TOKEN VERSION KILL SWITCH
    //////////////////////////////////////////////////////

    if (
      Number(decoded.tokenVersion ?? 0) !==
      Number(user.tokenVersion ?? 0)
    ) {
      return res.status(401).json({
        success: false,
        message: "Session expired",
      });
    }

    //////////////////////////////////////////////////////
    // ACCOUNT STATUS CHECK
    //////////////////////////////////////////////////////

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account disabled",
      });
    }

    if (user.isDeleted) {
      return res.status(403).json({
        success: false,
        message: "Account removed",
      });
    }

    //////////////////////////////////////////////////////
    // ATTACH IMMUTABLE USER
    //////////////////////////////////////////////////////

    req.user = Object.freeze({
      _id: user._id,
      role: user.role,
      adminLevel: user.adminLevel || null,
      stateRef: user.stateRef || null,
      cityRef: user.cityRef || null,
      isTemp: false,
    });

    return next();

  } catch (error) {

    if (process.env.NODE_ENV !== "production") {
      console.error("Protect middleware error:", error);
    }

    return res.status(401).json({
      success: false,
      message: "Invalid session",
    });
  }
};
