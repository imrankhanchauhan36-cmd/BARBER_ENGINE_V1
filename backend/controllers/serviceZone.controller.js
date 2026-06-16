import ServiceZone from "../models/ServiceZone.js";
import City from "../models/City.js";
import District from "../models/District.js";

//////////////////////////////////////////////////////////////
// ⚙️ CONSTANTS
//////////////////////////////////////////////////////////////

const MAX_CITY_DISTANCE = 50000; // 50km
const NEARBY_RADIUS = 5000; // 5km

//////////////////////////////////////////////////////////////
// 🔥 CREATE SERVICE ZONE (SALON ONBOARDING)
//////////////////////////////////////////////////////////////

export const createServiceZone = async (req, res) => {
  try {
    const { salonId, lat, lng } = req.body;

    //////////////////////////////////////////////////////////
    // VALIDATION
    //////////////////////////////////////////////////////////

    const latNum = Number(lat);
    const lngNum = Number(lng);

    if (!salonId || isNaN(latNum) || isNaN(lngNum)) {
      return res.status(400).json({
        success: false,
        message: "Invalid input",
      });
    }

    //////////////////////////////////////////////////////////
    // FIND CITY (AUTO DETECT)
    //////////////////////////////////////////////////////////

    const city = await City.findOne({
      geo: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [lngNum, latNum],
          },
          $maxDistance: MAX_CITY_DISTANCE,
        },
      },
      isActive: true,
      isDeleted: false,
    })
      .select("_id name districtRef stateRef countryRef geo")
      .lean();

    if (!city || !city.geo) {
      return res.status(404).json({
        success: false,
        message: "City not found",
      });
    }

    //////////////////////////////////////////////////////////
    // FIND DISTRICT
    //////////////////////////////////////////////////////////

    const district = await District.findById(city.districtRef)
      .select("_id name stateRef")
      .lean();

    if (!district) {
      return res.status(404).json({
        success: false,
        message: "District not found",
      });
    }

    //////////////////////////////////////////////////////////
    // UPSERT SERVICE ZONE (NO DUPLICATES)
    //////////////////////////////////////////////////////////

    const zone = await ServiceZone.findOneAndUpdate(
      { salonRef: salonId, isDeleted: false },
      {
        $set: {
          name: `ZONE-${city.name}`,
          salonRef: salonId,
          countryRef: city.countryRef,
          stateRef: city.stateRef,
          districtRef: city.districtRef,
          cityRef: city._id,

          center: {
            type: "Point",
            coordinates: [lngNum, latNum],
          },

          radiusKm: 5,
        },
      },
      { new: true, upsert: true }
    );

    //////////////////////////////////////////////////////////
    // RESPONSE
    //////////////////////////////////////////////////////////

    return res.status(200).json({
      success: true,
      message: "Service zone created",
      data: zone,
    });

  } catch (error) {
    console.error("CREATE_ZONE_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

//////////////////////////////////////////////////////////////
// 🔥 GET NEARBY SALONS (CORE FEATURE)
//////////////////////////////////////////////////////////////

export const getNearbySalons = async (req, res) => {
  try {
    const { lat, lng } = req.query;

    const latNum = Number(lat);
    const lngNum = Number(lng);

    if (isNaN(latNum) || isNaN(lngNum)) {
      return res.status(400).json({
        success: false,
        message: "Invalid location",
      });
    }

    //////////////////////////////////////////////////////////
    // GEO SEARCH
    //////////////////////////////////////////////////////////

    const zones = await ServiceZone.find({
      center: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [lngNum, latNum],
          },
          $maxDistance: NEARBY_RADIUS,
        },
      },
      isActive: true,
      serviceable: true,
      isDeleted: false,
    })
      .populate("salonRef")
      .sort({ priority: -1 })
      .lean()
      .limit(50);

    //////////////////////////////////////////////////////////
    // RESPONSE
    //////////////////////////////////////////////////////////

    return res.status(200).json({
      success: true,
      count: zones.length,
      data: zones,
    });

  } catch (error) {
    console.error("NEARBY_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

//////////////////////////////////////////////////////////////
// 🔥 VALIDATE BOOKING (CRITICAL)
//////////////////////////////////////////////////////////////

export const validateBooking = async (req, res) => {
  try {
    const { salonId, lat, lng } = req.body;

    const latNum = Number(lat);
    const lngNum = Number(lng);

    if (!salonId || isNaN(latNum) || isNaN(lngNum)) {
      return res.status(400).json({
        success: false,
        message: "Invalid input",
      });
    }

    //////////////////////////////////////////////////////////
    // FIND ZONE
    //////////////////////////////////////////////////////////

    const zone = await ServiceZone.findOne({
      salonRef: salonId,
      isActive: true,
      serviceable: true,
      isDeleted: false,
    }).lean();

    if (!zone) {
      return res.status(404).json({
        success: false,
        message: "Service zone not found",
      });
    }

    //////////////////////////////////////////////////////////
    // DISTANCE CHECK
    //////////////////////////////////////////////////////////

    const distance = getDistanceKm(
      latNum,
      lngNum,
      zone.center.coordinates[1],
      zone.center.coordinates[0]
    );

    const allowed = distance <= zone.radiusKm;

    //////////////////////////////////////////////////////////
    // RESPONSE
    //////////////////////////////////////////////////////////

    return res.status(200).json({
      success: true,
      allowed,
      distance: Number(distance.toFixed(2))
    });

  } catch (error) {
    console.error("VALIDATE_BOOKING_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

//////////////////////////////////////////////////////////////
// 📏 DISTANCE FUNCTION (HAVERSINE)
//////////////////////////////////////////////////////////////

function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;

  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}