///////////////////////////////////////////////////////////
// SALON LOCATION VALIDATOR — FINAL ENTERPRISE VERSION
///////////////////////////////////////////////////////////

import { createGeoPoint, normalizeCoordinates } from "../utils/geo.util.js";
import {
  isValidObjectId,
  toOptionalObjectId,
} from "../utils/objectId.util.js";

///////////////////////////////////////////////////////////
// SAFE STRING SANITIZER
///////////////////////////////////////////////////////////

const sanitizeString = (value, maxLength = 200) => {
  if (!value || typeof value !== "string") return null;

  const trimmed = value.trim();

  if (!trimmed) return null;

  return trimmed.slice(0, maxLength);
};

///////////////////////////////////////////////////////////
// MAIN VALIDATOR
///////////////////////////////////////////////////////////

export const validateSalonLocationInput = (body = {}) => {
  const errors = [];

  ///////////////////////////////////////////////////////
  // REQUIRED FIELD — cityName
  ///////////////////////////////////////////////////////

  const cityName = sanitizeString(body.cityName, 100);

  if (!cityName || cityName.length < 2) {
    errors.push("Valid cityName is required");
  }

  ///////////////////////////////////////////////////////
  // OPTIONAL FIELD — address
  ///////////////////////////////////////////////////////

  const address = sanitizeString(body.address, 300);

  ///////////////////////////////////////////////////////
  // GEO VALIDATION
  ///////////////////////////////////////////////////////

  let geo = undefined;

  if (body.coordinates !== undefined) {
    const normalized = normalizeCoordinates(body.coordinates);

    if (!normalized) {
      errors.push("Invalid coordinates format");
    } else {
      geo = createGeoPoint(normalized);
    }
  }

  ///////////////////////////////////////////////////////
  // REQUIRED TERRITORY FIELDS (ENTERPRISE HIERARCHY)
  ///////////////////////////////////////////////////////

  if (!body.countryRef) {
    errors.push("countryRef is required");
  }

  if (!body.stateRef) {
    errors.push("stateRef is required");
  }

  if (!body.cityRef) {
    errors.push("cityRef is required");
  }

  ///////////////////////////////////////////////////////
  // OBJECT ID FORMAT VALIDATION
  ///////////////////////////////////////////////////////

  const validateId = (value, field) => {
    if (value && !isValidObjectId(value)) {
      errors.push(`Invalid ${field}`);
    }
  };

  validateId(body.countryRef, "countryRef");
  validateId(body.stateRef, "stateRef");
  validateId(body.cityRef, "cityRef");
  validateId(body.areaRef, "areaRef");

  ///////////////////////////////////////////////////////
  // SAFE OBJECT ID CONVERSION
  ///////////////////////////////////////////////////////

  const countryRef = toOptionalObjectId(body.countryRef);
  const stateRef = toOptionalObjectId(body.stateRef);
  const cityRef = toOptionalObjectId(body.cityRef);
  const areaRef = toOptionalObjectId(body.areaRef);

  ///////////////////////////////////////////////////////
  // META VALIDATION
  ///////////////////////////////////////////////////////

  const safeMeta =
    body.meta && typeof body.meta === "object" && !Array.isArray(body.meta)
      ? body.meta
      : {};

  const metaState = sanitizeString(safeMeta.state, 100);
  const metaDistrict = sanitizeString(safeMeta.district, 100);
  const metaArea = sanitizeString(safeMeta.area, 100);
  const metaPincode = sanitizeString(safeMeta.pincode, 20);

  const meta =
    metaState || metaDistrict || metaArea || metaPincode
      ? {
          state: metaState,
          district: metaDistrict,
          area: metaArea,
          pincode: metaPincode,
        }
      : undefined;

  ///////////////////////////////////////////////////////
  // FINAL RESULT
  ///////////////////////////////////////////////////////

  return {
    isValid: errors.length === 0,

    errors,

    sanitized: {
      address,
      cityName,

      geo,

      territory: {
        countryRef,
        stateRef,
        cityRef,
        areaRef,
      },

      meta,
    },
  };
};