import crypto from "crypto";
import mongoose from "mongoose";
import RefreshToken from "../models/RefreshToken.js";
import User from "../models/User.js";
import redis from "../config/redis.js";
import { generateAccessToken } from "./token.service.js";

const SESSION_PREFIX = "session:";
const USER_SESSION_PREFIX = "user_sessions:";
const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days

/* =======================================================
   HASH TOKEN
======================================================= */
const hashToken = (raw) =>
  crypto.createHash("sha256").update(raw).digest("hex");

/* =======================================================
   CREATE NEW SESSION
======================================================= */
export const createSession = async (user, req) => {
  const rawToken = crypto.randomBytes(64).toString("hex");
  const tokenHash = hashToken(rawToken);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL * 1000);
  const absoluteExpiresAt = new Date(
    now.getTime() + SESSION_TTL * 4 * 1000
  );

  const familyId = new mongoose.Types.ObjectId();

  const ipAddress =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.connection?.remoteAddress ||
    req.ip;

  await RefreshToken.create({
    userRef: user._id,
    tokenHash,
    familyId,
    tokenVersion: Number(user.tokenVersion) || 0,
    expiresAt,
    absoluteExpiresAt,
    ipAddress,
    userAgent: req.headers["user-agent"],
  });

  /* Redis session cache */
  try {
    await redis.set(
      SESSION_PREFIX + tokenHash,
      JSON.stringify({
        userId: user._id.toString(),
        tokenVersion: Number(user.tokenVersion) || 0,
      }),
      { EX: SESSION_TTL }
    );

    await redis.set(
      USER_SESSION_PREFIX + user._id.toString(),
      "active",
      { EX: SESSION_TTL }
    );
  } catch (err) {
    console.warn("⚠️ Redis session write failed:", err.message);
  }

  return rawToken;
};

/* =======================================================
   VERIFY SESSION (REDIS FAST PATH + DB VALIDATION)
======================================================= */
export const verifySession = async (rawToken) => {
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  /* ---------------------------
     REDIS FAST PATH
  --------------------------- */
  try {
    const cached = await redis.get(SESSION_PREFIX + tokenHash);

    if (cached) {
      const parsed = JSON.parse(cached);

      const user = await User.findById(parsed.userId).select(
        "_id role tokenVersion isActive isDeleted adminLevel stateRef cityRef"
      );

      if (!user) return null;
      if (!user.isActive || user.isDeleted) return null;
      if (Number(user.tokenVersion) !== Number(parsed.tokenVersion))
        return null;

      return { user, tokenHash, cached: true };
    }
  } catch (err) {
    console.warn("⚠️ Redis fast path failed, fallback to DB:", err.message);
  }

  /* ---------------------------
     DB FALLBACK
  --------------------------- */
  const tokenDoc = await RefreshToken.findOne({
    tokenHash,
    revokedAt: null,
  })
    .select(
      "_id userRef familyId tokenVersion expiresAt absoluteExpiresAt lastUsedAt isCompromised"
    )
    .lean();

  if (!tokenDoc) return null;
  if (tokenDoc.expiresAt < now) return null;
  if (tokenDoc.absoluteExpiresAt < now) return null;
  if (tokenDoc.isCompromised) return null;

  /* CHECK FAMILY COMPROMISE */
  const compromisedFamily = await RefreshToken.findOne({
    familyId: tokenDoc.familyId,
    isCompromised: true,
  }).lean();

  if (compromisedFamily) return null;

  const user = await User.findById(tokenDoc.userRef).select(
    "_id role tokenVersion isActive isDeleted adminLevel stateRef cityRef"
  );

  if (!user) return null;
  if (!user.isActive || user.isDeleted) return null;
  if (Number(user.tokenVersion) !== Number(tokenDoc.tokenVersion))
    return null;

  /* CACHE AFTER VALIDATION */
  try {
    await redis.set(
      SESSION_PREFIX + tokenHash,
      JSON.stringify({
        userId: user._id.toString(),
        tokenVersion: Number(user.tokenVersion),
      }),
      { EX: SESSION_TTL }
    );
  } catch (err) {
    console.warn("⚠️ Redis cache write failed:", err.message);
  }

  return { user, tokenDoc, tokenHash };
};

/* =======================================================
   ROTATE SESSION (ATOMIC + REUSE SAFE)
======================================================= */
export const rotateSession = async (rawToken, req) => {
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const existingToken = await RefreshToken.findOne({ tokenHash })
    .select(
      "_id userRef familyId tokenVersion expiresAt absoluteExpiresAt revokedAt lastUsedAt isCompromised"
    )
    .lean();

  if (!existingToken) return null;
  if (existingToken.revokedAt) return null;
  if (existingToken.expiresAt < now) return null;
  if (existingToken.absoluteExpiresAt < now) return null;
  if (existingToken.isCompromised) return null;

  const user = await User.findById(existingToken.userRef).select(
    "_id role tokenVersion isActive isDeleted adminLevel stateRef cityRef"
  );

  if (!user) return null;
  if (!user.isActive || user.isDeleted) return null;
  if (Number(user.tokenVersion) !== Number(existingToken.tokenVersion))
    return null;

  /* ATOMIC ROTATION */
  const updateResult = await RefreshToken.updateOne(
    {
      _id: existingToken._id,
      revokedAt: null,
    },
    {
      $set: {
        lastUsedAt: now,
        revokedAt: now,
        revokedReason: "rotated",
      },
    }
  );

  if (updateResult.modifiedCount === 0) {
    /* REUSE DETECTED */
    await RefreshToken.updateMany(
      { familyId: existingToken.familyId },
      {
        $set: {
          revokedAt: now,
          isCompromised: true,
          revokedReason: "reuse_detected",
        },
      }
    );

    try {
      await redis.del(SESSION_PREFIX + tokenHash);
      await redis.del(SESSION_PREFIX + existingToken.familyId.toString());
    } catch (err) {
      console.warn("⚠️ Redis del failed:", err.message);
    }

    return null;
  }

  /* CREATE NEW TOKEN */
  const newRawToken = crypto.randomBytes(64).toString("hex");
  const newHash = hashToken(newRawToken);

  const newExpiresAt = new Date(now.getTime() + SESSION_TTL * 1000);

  await RefreshToken.create({
    userRef: user._id,
    tokenHash: newHash,
    familyId: existingToken.familyId,
    rotatedFrom: existingToken._id,
    tokenVersion: Number(user.tokenVersion) || 0,
    expiresAt: newExpiresAt,
    absoluteExpiresAt: existingToken.absoluteExpiresAt,
    ipAddress:
      req.headers["x-forwarded-for"]?.split(",")[0] ||
      req.connection?.remoteAddress ||
      req.ip,
    userAgent: req.headers["user-agent"],
  });

  try {
    await redis.del(SESSION_PREFIX + tokenHash);

    await redis.set(
      SESSION_PREFIX + newHash,
      JSON.stringify({
        userId: user._id.toString(),
        tokenVersion: Number(user.tokenVersion),
      }),
      { EX: SESSION_TTL }
    );
  } catch (err) {
    console.warn("⚠️ Redis rotate write failed:", err.message);
  }

  const accessToken = generateAccessToken(user);

  return {
    accessToken,
    refreshToken: newRawToken,
  };
};

/* =======================================================
   LOGOUT SESSION
======================================================= */
export const revokeSession = async (rawToken) => {
  const tokenHash = hashToken(rawToken);

  await RefreshToken.updateOne(
    { tokenHash, revokedAt: null },
    {
      revokedAt: new Date(),
      revokedReason: "logout",
    }
  );

  try {
    await redis.del(SESSION_PREFIX + tokenHash);
  } catch (err) {
    console.warn("⚠️ Redis del failed:", err.message);
  }
};

/* =======================================================
   LOGOUT ALL DEVICES
======================================================= */
export const revokeAllSessions = async (userId) => {
  await RefreshToken.updateMany(
    { userRef: userId, revokedAt: null },
    {
      revokedAt: new Date(),
      revokedReason: "logout_all",
    }
  );

  await User.updateOne(
    { _id: userId },
    { $inc: { tokenVersion: 1 } }
  );

  // Redis auto invalidated via tokenVersion mismatch
};