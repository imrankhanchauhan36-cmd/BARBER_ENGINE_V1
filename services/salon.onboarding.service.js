///////////////////////////////////////////////////////////
// SALON ONBOARDING SERVICE — FINAL (ZOMATO GRADE 10/10)
///////////////////////////////////////////////////////////

import Salon from "../models/Salon.js";
import geoService from "./geo.service.js";
import { assignAdminByDistrict } from "./adminAssign.service.js";


///////////////////////////////////////////////////////////

export const saveSalonLocationService = async ({
  ownerId,
  locationData,
}) => {
  try {
    ///////////////////////////////////////////////////////
    // SAFE UPDATE PAYLOAD
    ///////////////////////////////////////////////////////
    const updatePayload = {};

    ///////////////////////////////////////////////////////
    // ADDRESS
    ///////////////////////////////////////////////////////
    if (locationData.address !== undefined) {
      updatePayload["location.address"] = locationData.address;
    }

    ///////////////////////////////////////////////////////
    // CITY NAME (DISPLAY ONLY)
    ///////////////////////////////////////////////////////
    if (locationData.cityName !== undefined) {
      updatePayload["location.cityName"] = locationData.cityName;
    }

    ///////////////////////////////////////////////////////
    // GEO VALIDATION (STRICT)
    ///////////////////////////////////////////////////////
    let latitude = null;
    let longitude = null;

    if (locationData.geo) {
      const { type, coordinates } = locationData.geo;

      if (
        type === "Point" &&
        Array.isArray(coordinates) &&
        coordinates.length === 2 &&
        typeof coordinates[0] === "number" &&
        typeof coordinates[1] === "number" &&
        coordinates[0] >= -180 &&
        coordinates[0] <= 180 &&
        coordinates[1] >= -90 &&
        coordinates[1] <= 90
      ) {
        updatePayload["location.geo"] = {
          type: "Point",
          coordinates,
        };

        longitude = coordinates[0];
        latitude = coordinates[1];
      }
    }

    ///////////////////////////////////////////////////////
    // LOCATION REQUIRED
    ///////////////////////////////////////////////////////
    if (latitude === null || longitude === null) {
      return {
        success: false,
        code: "LOCATION_REQUIRED",
        message: "Map location is required",
      };
    }

    ///////////////////////////////////////////////////////
    // META (OPTIONAL DISPLAY DATA)
    ///////////////////////////////////////////////////////
    if (locationData.meta) {
      if (locationData.meta.state !== undefined) {
        updatePayload["location.meta.state"] =
          locationData.meta.state;
      }

      if (locationData.meta.district !== undefined) {
        updatePayload["location.meta.district"] =
          locationData.meta.district;
      }

      if (locationData.meta.area !== undefined) {
        updatePayload["location.meta.area"] =
          locationData.meta.area;
      }

      if (locationData.meta.pincode !== undefined) {
        updatePayload["location.meta.pincode"] =
          locationData.meta.pincode;
      }
    }

    ///////////////////////////////////////////////////////
    // 🔥 GEO DETECTION (NEW CORE ENGINE)
    ///////////////////////////////////////////////////////
    const location = await geoService.detectLocation(
      latitude,
      longitude
    );

    ///////////////////////////////////////////////////////
    // LOCATION NOT FOUND
    ///////////////////////////////////////////////////////
    if (!location) {
      return {
        success: false,
        code: "LOCATION_NOT_FOUND",
        message:
          "Unable to detect location. Please select correct map location.",
      };
    }

    ///////////////////////////////////////////////////////
    // 🔥 ADMIN ASSIGN (CRITICAL)
    ///////////////////////////////////////////////////////
    const adminRef = await assignAdminByDistrict({
      districtRef: location.districtRef,
      stateRef: location.stateRef,
    });

    ///////////////////////////////////////////////////////
    // 🔥 FINAL TERRITORY ASSIGNMENT (CORRECT FLOW)
    ///////////////////////////////////////////////////////
    updatePayload["location.territory.countryRef"] =
      location.countryRef;

    updatePayload["location.territory.stateRef"] =
      location.stateRef;

    updatePayload["location.territory.districtRef"] =
      location.districtRef;

    updatePayload["location.territory.cityRef"] =
      location.cityRef;

    updatePayload["location.territory.pincodeRef"] =
      location.pincodeRef;

    ///////////////////////////////////////////////////////
    // 🔥 ADMIN LINK
    ///////////////////////////////////////////////////////
    updatePayload["adminRef"] = adminRef;

    ///////////////////////////////////////////////////////
    // ATOMIC UPDATE
    ///////////////////////////////////////////////////////
    const updatedSalon = await Salon.findOneAndUpdate(
      { ownerId },
      {
        $set: updatePayload,
        $max: { "onboarding.step": 2 },
      },
      {
        new: true,
        runValidators: true,
        projection: {
          _id: 1,
          location: 1,
          onboarding: 1,
          adminRef: 1,
        },
      }
    );

    ///////////////////////////////////////////////////////
    // NOT FOUND
    ///////////////////////////////////////////////////////
    if (!updatedSalon) {
      return {
        success: false,
        code: "SALON_NOT_FOUND",
        message: "Complete Step-1 Basic Info first",
      };
    }

    ///////////////////////////////////////////////////////
    // SUCCESS
    ///////////////////////////////////////////////////////
    return {
      success: true,
      data: {
        salonId: updatedSalon._id,
        onboardingStep: updatedSalon.onboarding?.step,
        location: updatedSalon.location,
        adminRef: updatedSalon.adminRef,
      },
    };

  } catch (error) {
    console.error("❌ saveSalonLocationService error:", error);

    return {
      success: false,
      code: "LOCATION_UPDATE_FAILED",
      message: "Unable to save location",
    };
  }
};