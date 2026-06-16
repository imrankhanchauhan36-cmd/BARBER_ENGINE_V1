import { getSmartSlots } from "./slotEngine.service.js";
import Salon from "../models/Salon.js";

//////////////////////////////////////////////////////////////
// 🔥 CONFIG
//////////////////////////////////////////////////////////////

const SEARCH_RADIUS = 5000; // 5km
const MAX_NEARBY = 3;

//////////////////////////////////////////////////////////////
// 🧠 HELPER — SAFE TIME COMPARISON (CRITICAL FIX)
//////////////////////////////////////////////////////////////

const isSameTime = (a, b) =>
  Math.abs(a.getTime() - b.getTime()) < 60000; // 1 min tolerance

//////////////////////////////////////////////////////////////
// 🧠 GET SAME SALON ALTERNATIVES
//////////////////////////////////////////////////////////////

const getSameSalonAlternatives = async ({
  salonId,
  date,
  serviceDuration,
  bufferTime,
  requestedTime,
}) => {
  const reqTime = new Date(requestedTime);

  const slots = await getSmartSlots({
    salonId,
    date,
    serviceDuration,
    bufferTime,
  });

  return slots
    .filter((slot) => slot.start > reqTime)
    .slice(0, 5);
};

//////////////////////////////////////////////////////////////
// 📍 GET NEARBY SALONS (GEO SEARCH)
//////////////////////////////////////////////////////////////

const getNearbySalons = async ({ lat, lng, category }) => {
  return await Salon.aggregate([
    {
      $geoNear: {
        near: {
          type: "Point",
          coordinates: [lng, lat],
        },
        distanceField: "distance",
        maxDistance: SEARCH_RADIUS,
        spherical: true,
      },
    },
    {
      $match: {
        isActive: true,
        category: category,
      },
    },
    {
      $limit: MAX_NEARBY * 2, // extra fetch for filtering
    },
  ]);
};

//////////////////////////////////////////////////////////////
// 🧠 GET NEARBY SLOT OPTIONS (PARALLEL OPTIMIZED)
//////////////////////////////////////////////////////////////

const getNearbySalonSlots = async ({
  salons,
  date,
  serviceDuration,
  bufferTime,
  requestedTime,
}) => {
  const reqTime = new Date(requestedTime);

  const promises = salons.map(async (salon) => {
    const slots = await getSmartSlots({
      salonId: salon._id,
      date,
      serviceDuration,
      bufferTime,
    });

    const matchedSlot = slots.find((slot) =>
      isSameTime(slot.start, reqTime)
    );

    if (!matchedSlot) return null;

    return {
      salonId: salon._id,
      name: salon.name,
      distance: salon.distance,
      slot: matchedSlot,
    };
  });

  const results = (await Promise.all(promises)).filter(Boolean);

  return results
    .sort((a, b) => a.distance - b.distance) // nearest first
    .slice(0, MAX_NEARBY); // UX clean
};

//////////////////////////////////////////////////////////////
// 🚀 MAIN FUNCTION
//////////////////////////////////////////////////////////////

export const getSmartSuggestions = async ({
  salonId,
  date,
  serviceDuration,
  bufferTime = 0,
  requestedTime,
  lat,
  lng,
  category,
}) => {
  try {
    //////////////////////////////////////////////////////////
    // PREP
    //////////////////////////////////////////////////////////

    const reqTime = new Date(requestedTime);

    //////////////////////////////////////////////////////////
    // STEP 1: CHECK SAME SALON AVAILABILITY
    //////////////////////////////////////////////////////////

    const slots = await getSmartSlots({
      salonId,
      date,
      serviceDuration,
      bufferTime,
    });

    const matchedSlot = slots.find((s) =>
      isSameTime(s.start, reqTime)
    );

    //////////////////////////////////////////////////////////
    // IF AVAILABLE → RETURN DIRECT
    //////////////////////////////////////////////////////////

    if (matchedSlot) {
      return {
        available: true,
        slot: matchedSlot,
      };
    }

    //////////////////////////////////////////////////////////
    // STEP 2: SAME SALON ALTERNATIVES
    //////////////////////////////////////////////////////////

    const sameSalon = await getSameSalonAlternatives({
      salonId,
      date,
      serviceDuration,
      bufferTime,
      requestedTime: reqTime,
    });

    //////////////////////////////////////////////////////////
    // STEP 3: NEARBY SALONS
    //////////////////////////////////////////////////////////

    const nearbySalons = await getNearbySalons({
      lat,
      lng,
      category,
    });

    //////////////////////////////////////////////////////////
    // STEP 4: NEARBY SLOT MATCH
    //////////////////////////////////////////////////////////

    const nearby = await getNearbySalonSlots({
      salons: nearbySalons,
      date,
      serviceDuration,
      bufferTime,
      requestedTime: reqTime,
    });

    //////////////////////////////////////////////////////////
    // FINAL RESPONSE
    //////////////////////////////////////////////////////////

    return {
      available: false,
      requestedTime: reqTime,

      alternatives: {
        sameSalon,
        nearbySalons: nearby,
      },
    };

  } catch (error) {
    console.error("Smart suggestion error:", error);

    return {
      available: false,
      requestedTime: requestedTime,
      alternatives: {
        sameSalon: [],
        nearbySalons: [],
      },
    };
  }
};