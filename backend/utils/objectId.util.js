///////////////////////////////////////////////////////////
// OBJECT ID UTILS — TRUE ENTERPRISE HARDENED VERSION
///////////////////////////////////////////////////////////

import mongoose from "mongoose";

///////////////////////////////////////////////////////////

/**
 * Strict ObjectId validation
 * Supports both string and ObjectId instance
 * Prevents false positives and malformed IDs
 */
export const isValidObjectId = (value) => {
  if (!value) return false;

  // Already ObjectId instance
  if (value instanceof mongoose.Types.ObjectId) {
    return true;
  }

  // Must be string
  if (typeof value !== "string") return false;

  // Strict 24-character hex string only
  const hexRegex = /^[a-fA-F0-9]{24}$/;

  if (!hexRegex.test(value)) return false;

  return mongoose.Types.ObjectId.isValid(value);
};

///////////////////////////////////////////////////////////

/**
 * Convert value to ObjectId safely
 * Returns ObjectId or null
 */
export const toObjectId = (value) => {
  if (!value) return null;

  // Already ObjectId instance
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  if (!isValidObjectId(value)) return null;

  return new mongoose.Types.ObjectId(value);
};

///////////////////////////////////////////////////////////

/**
 * Convert value to ObjectId safely (optional fields)
 * Returns ObjectId or undefined
 */
export const toOptionalObjectId = (value) => {
  if (!value) return undefined;

  // Already ObjectId instance
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  if (!isValidObjectId(value)) return undefined;

  return new mongoose.Types.ObjectId(value);
};

///////////////////////////////////////////////////////////

/**
 * Safely compare two ObjectIds
 */
export const objectIdEquals = (id1, id2) => {
  if (!id1 || !id2) return false;

  return id1.toString() === id2.toString();
};

///////////////////////////////////////////////////////////

/**
 * Convert ObjectId or string to normalized 24-char string
 * Always returns:
 *   string (normalized)
 *   OR null
 */
export const objectIdToString = (value) => {
  if (!value) return null;

  // ObjectId instance
  if (value instanceof mongoose.Types.ObjectId) {
    return value.toString();
  }

  // Valid ObjectId string
  if (isValidObjectId(value)) {
    return new mongoose.Types.ObjectId(value).toString();
  }

  return null;
};