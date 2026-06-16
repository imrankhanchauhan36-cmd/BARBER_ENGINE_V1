///////////////////////////////////////////////////////////
// GEO UTILS — ENTERPRISE SAFE GEO HANDLER
///////////////////////////////////////////////////////////

/**
 * Validate coordinate array safely
 * Required format: [lng, lat]
 */
export const isValidCoordinate = (coordinates) => {
  if (!Array.isArray(coordinates)) return false;
  if (coordinates.length !== 2) return false;

  const [lng, lat] = coordinates;

  if (typeof lng !== "number" || typeof lat !== "number") return false;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;

  if (lng < -180 || lng > 180) return false;
  if (lat < -90 || lat > 90) return false;

  return true;
};

///////////////////////////////////////////////////////////

/**
 * Normalize coordinates input
 * Accepts string or number input
 * Returns clean [lng, lat] or null
 */
export const normalizeCoordinates = (coordinates) => {
  if (!Array.isArray(coordinates)) return null;
  if (coordinates.length !== 2) return null;

  const lng = Number(coordinates[0]);
  const lat = Number(coordinates[1]);

  if (!isValidCoordinate([lng, lat])) return null;

  return [lng, lat];
};

///////////////////////////////////////////////////////////

/**
 * Create GeoJSON Point safely
 */
export const createGeoPoint = (coordinates) => {
  const normalized = normalizeCoordinates(coordinates);
  if (!normalized) return null;

  return {
    type: "Point",
    coordinates: normalized,
  };
};