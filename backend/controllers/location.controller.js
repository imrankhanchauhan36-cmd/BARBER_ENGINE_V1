import geoService from "../services/geo.service.js";

//////////////////////////////////////////////////////////////
// 🧠 COMMON VALIDATION HELPER (IMPROVED)
//////////////////////////////////////////////////////////////

const validateLatLng = (lat, lng) => {
  const latitude = Number(lat);
  const longitude = Number(lng);

  if (
    isNaN(latitude) ||
    isNaN(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return { latitude, longitude };
};

//////////////////////////////////////////////////////////////
// 📍 DETECT LOCATION
//////////////////////////////////////////////////////////////

export const detectLocation = async (req, res) => {
  try {
    const { lat, lng } = req.body;

    //////////////////////////////////////////////////////////
    // VALIDATION
    //////////////////////////////////////////////////////////
    const coords = validateLatLng(lat, lng);

    if (!coords) {
      return res.status(400).json({
        success: false,
        message: "Invalid lat/lng",
      });
    }

    //////////////////////////////////////////////////////////
    // GEO SERVICE (USE PARSED VALUES)
    //////////////////////////////////////////////////////////
    const location = await geoService.detectLocation(
      coords.latitude,
      coords.longitude
    );

    if (!location) {
      return res.status(404).json({
        success: false,
        message: "Location not found",
      });
    }

    //////////////////////////////////////////////////////////
    // RESPONSE
    //////////////////////////////////////////////////////////
    return res.status(200).json({
      success: true,
      message: "Location detected successfully",
      data: location,
    });

  } catch (error) {
    console.error("DETECT_LOCATION_ERROR:", error.message);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

//////////////////////////////////////////////////////////////
// 📍 VALIDATE SERVICEABLE LOCATION
//////////////////////////////////////////////////////////////

export const validateServiceableLocation = async (req, res) => {
  try {
    const { lat, lng } = req.body;

    //////////////////////////////////////////////////////////
    // VALIDATION
    //////////////////////////////////////////////////////////
    const coords = validateLatLng(lat, lng);

    if (!coords) {
      return res.status(400).json({
        success: false,
        message: "Invalid lat/lng",
      });
    }

    //////////////////////////////////////////////////////////
    // GEO SERVICE
    //////////////////////////////////////////////////////////
    const location = await geoService.detectLocation(
      coords.latitude,
      coords.longitude
    );

    //////////////////////////////////////////////////////////
    // RESPONSE
    //////////////////////////////////////////////////////////
    return res.status(200).json({
      success: true,
      message: "Serviceability checked",
      data: {
        serviceable: !!location,
        location: location || null,
      },
    });

  } catch (error) {
    console.error("VALIDATE_LOCATION_ERROR:", error.message);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

//////////////////////////////////////////////////////////////
// 📍 GET LOCATION DETAILS (ONBOARDING)
//////////////////////////////////////////////////////////////

export const getLocationDetails = async (req, res) => {
  try {
    const { lat, lng } = req.query;

    //////////////////////////////////////////////////////////
    // VALIDATION
    //////////////////////////////////////////////////////////
    const coords = validateLatLng(lat, lng);

    if (!coords) {
      return res.status(400).json({
        success: false,
        message: "Invalid lat/lng",
      });
    }

    //////////////////////////////////////////////////////////
    // GEO SERVICE
    //////////////////////////////////////////////////////////
    const location = await geoService.detectLocation(
      coords.latitude,
      coords.longitude
    );

    if (!location) {
      return res.status(404).json({
        success: false,
        message: "Location not found",
      });
    }

    //////////////////////////////////////////////////////////
    // RESPONSE
    //////////////////////////////////////////////////////////
    return res.status(200).json({
      success: true,
      message: "Location details fetched successfully",
      data: location,
    });

  } catch (error) {
    console.error("GET_LOCATION_DETAILS_ERROR:", error.message);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};