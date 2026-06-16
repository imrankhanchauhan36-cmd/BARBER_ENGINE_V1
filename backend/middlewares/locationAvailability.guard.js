import Country from "../models/Country.js";
import State from "../models/State.js";
import City from "../models/City.js";
import Area from "../models/Area.js";

/**
 * Checks service availability based on location refs.
 * Non-breaking: if refs are missing, it allows flow (legacy support).
 */
export const checkServiceAvailability = async (req, res, next) => {
  try {
    const {
      countryRef,
      stateRef,
      cityRef,
      areaRef,
    } = req.body || {};

    // Legacy support: refs not provided yet
    if (!countryRef && !stateRef && !cityRef && !areaRef) {
      return next();
    }

    if (countryRef) {
      const country = await Country.findById(countryRef).select("isActive");
      if (!country || !country.isActive) {
        return res.status(403).json({
          message: "Service is not available in this country",
        });
      }
    }

    if (stateRef) {
      const state = await State.findById(stateRef).select("isActive");
      if (!state || !state.isActive) {
        return res.status(403).json({
          message: "Service is not available in this state",
        });
      }
    }

    if (cityRef) {
      const city = await City.findById(cityRef).select("isActive");
      if (!city || !city.isActive) {
        return res.status(403).json({
          message: "Service is not available in this city",
        });
      }
    }

    if (areaRef) {
      const area = await Area.findById(areaRef).select("isActive");
      if (!area || !area.isActive) {
        return res.status(403).json({
          message: "Service is not available in this area",
        });
      }
    }

    return next();
  } catch (err) {
    console.error("Location availability check failed:", err);
    return res.status(500).json({
      message: "Unable to verify service availability",
    });
  }
};
