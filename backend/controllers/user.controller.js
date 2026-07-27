import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import mongoose from "mongoose";
import validator from "validator";

import User from "../models/User.js";

//////////////////////////////////////////////////////
// CONSTANTS
//////////////////////////////////////////////////////

const SAFE_USER_FIELDS =
  "name phone email dateOfBirth gender profilePhoto walletBalance rewardPoints isPhoneVerified isEmailVerified accountStatus createdAt updatedAt";

const BLOCKED_STATUSES = ["SUSPENDED", "BLOCKED"];

//////////////////////////////////////////////////////
// FIX 3 — RATE LIMITER (exported for use in routes)
//////////////////////////////////////////////////////

export const updateProfileLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `update_profile_${ipKeyGenerator(req)}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many update attempts. Try again later.",
  },
});

//////////////////////////////////////////////////////
// HELPERS
//////////////////////////////////////////////////////

const isBlockedAccount = (status) =>
  BLOCKED_STATUSES.includes(status);

// FIX 2 — Name regex: English + Hindi/Devanagari + safe chars
const isValidName = (name) =>
  /^[a-zA-Z\u0900-\u097F\s.'-]+$/.test(name);

//////////////////////////////////////////////////////
// GET /api/user/me
//////////////////////////////////////////////////////

export const getMe = async (req, res) => {
  try {

    if (!mongoose.Types.ObjectId.isValid(req.user?._id)) {
      return res.status(401).json({
        success: false,
        message: "Invalid user session",
      });
    }

    const user = await User.findOne({
      _id: req.user._id,
      isDeleted: false,
    })
      .select(SAFE_USER_FIELDS)
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (isBlockedAccount(user.accountStatus)) {
      return res.status(403).json({
        success: false,
        message: "Account is not active",
      });
    }

    return res.status(200).json({
      success: true,
      user,
    });

  } catch (error) {
    console.error("getMe error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

//////////////////////////////////////////////////////
// PUT /api/user/me
//////////////////////////////////////////////////////

export const updateMe = async (req, res) => {
  try {

    if (!mongoose.Types.ObjectId.isValid(req.user?._id)) {
      return res.status(401).json({
        success: false,
        message: "Invalid user session",
      });
    }

    const currentUser = await User.findOne({
      _id: req.user._id,
      isDeleted: false,
    })
      .select("_id accountStatus email")
      .lean();

    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (isBlockedAccount(currentUser.accountStatus)) {
      return res.status(403).json({
        success: false,
        message: "Account is not active",
      });
    }

    //////////////////////////////////////////////////////
    // SAFE INPUT EXTRACTION
    //////////////////////////////////////////////////////

    let name;
    let email;
    let dateOfBirth;
    let gender;

    if (typeof req.body.name === "string") {
      name = req.body.name.trim();
    }

    if (typeof req.body.email === "string") {
      email = req.body.email.toLowerCase().trim();
    }

    if (typeof req.body.email === "string") {
      email = req.body.email.toLowerCase().trim();
    }

    if (req.body.dateOfBirth !== undefined) {
      dateOfBirth = req.body.dateOfBirth; // validated below — null clears it, invalid rejected
    }

    if (typeof req.body.gender === "string") {
      gender = req.body.gender.toUpperCase().trim();
    }

    if (!name && !email && dateOfBirth === undefined && !gender) {
      return res.status(400).json({
        success: false,
        message: "Nothing to update",
      });
    }

    const updates = {};
    //////////////////////////////////////////////////////
    // DATE OF BIRTH VALIDATION
    //////////////////////////////////////////////////////
    if (dateOfBirth !== undefined) {
      if (dateOfBirth === null) {
        updates.dateOfBirth = null;
      } else {
        const parsed = new Date(dateOfBirth);
        const isValidDate = !isNaN(parsed.getTime());
        const isNotFuture = parsed <= new Date();
        const isReasonableAge = parsed >= new Date("1900-01-01");

        if (!isValidDate || !isNotFuture || !isReasonableAge) {
          return res.status(400).json({
            success: false,
            message: "Invalid date of birth",
          });
        }
        updates.dateOfBirth = parsed;
      }
    }
    //////////////////////////////////////////////////////
    // GENDER VALIDATION
    //////////////////////////////////////////////////////
    if (gender) {
      const validGenders = ["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"];
      if (!validGenders.includes(gender)) {
        return res.status(400).json({
          success: false,
          message: "Invalid gender value",
        });
      }
      updates.gender = gender;
    }

    //////////////////////////////////////////////////////
    // NAME VALIDATION — FIX 2
    //////////////////////////////////////////////////////

    if (name) {
      if (name.length < 2 || name.length > 60) {
        return res.status(400).json({
          success: false,
          message: "Name must be between 2 and 60 characters",
        });
      }

      if (!isValidName(name)) {
        return res.status(400).json({
          success: false,
          message: "Name contains invalid characters",
        });
      }

      updates.name = name;
    }

    //////////////////////////////////////////////////////
    // EMAIL VALIDATION — FIX 1
    //////////////////////////////////////////////////////

    if (email) {

      if (!validator.isEmail(email)) {
        return res.status(400).json({
          success: false,
          message: "Invalid email format",
        });
      }

      // FIX 1 — null/undefined safe same-email check
      if (
        email &&
        currentUser.email &&
        email === currentUser.email
      ) {
        return res.status(400).json({
          success: false,
          message: "New email cannot be same as current email",
        });
      }

      const existingUser = await User.findOne({
        email,
        isDeleted: false,
        _id: { $ne: req.user._id },
      })
        .select("_id")
        .lean();

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: "Email already in use",
        });
      }

      updates.email = email;
      updates.isEmailVerified = false;
    }

    //////////////////////////////////////////////////////
    // UPDATE
    //////////////////////////////////////////////////////

    const updatedUser = await User.findOneAndUpdate(
      { _id: req.user._id, isDeleted: false },
      { $set: updates },
      { new: true, runValidators: true }
    )
      .select(SAFE_USER_FIELDS)
      .lean();

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      user: updatedUser,
    });

  } catch (error) {

    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Email already exists",
      });
    }

    console.error("updateMe error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

//////////////////////////////////////////////////////
// POST /api/user/me/photo — Upload Profile Photo
//////////////////////////////////////////////////////

export const uploadProfilePhoto = async (req, res) => {
  try {
    console.log("📸 req.file:", req.file);   // ← ADD
    console.log("📸 req.body:", req.body);   // ← ADD

    if (!mongoose.Types.ObjectId.isValid(req.user?._id)) {
      return res.status(401).json({ success: false, message: "Invalid session" });
    }

    // memoryStorage() (see routes/user.routes.js) never sets
    // req.file.path — only req.file.buffer. The real signal that an
    // upload happened is req.cloudinaryUrl, set by the middleware
    // right before this controller runs after the Cloudinary upload
    // completes.
    if (!req.file || !req.cloudinaryUrl) {
      return res.status(400).json({ success: false, message: "No image uploaded" });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { profilePhoto: req.cloudinaryUrl },
      { new: true }
    ).select(SAFE_USER_FIELDS).lean();

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Profile photo updated",
      profilePhoto: req.cloudinaryUrl,
      user,
    });

  } catch (error) {
    console.error("uploadProfilePhoto error:", error);
    return res.status(500).json({ success: false, message: "Upload failed" });
  }
};
