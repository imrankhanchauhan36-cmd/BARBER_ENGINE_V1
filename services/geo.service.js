import Pincode from "../models/Pincode.js";
import redis from "../config/redis.js";

//////////////////////////////////////////////////////////////
// ⚙️ RADIUS CONFIG (GLOBAL — EASY CONTROL)
//////////////////////////////////////////////////////////////

const RADIUS = {
  primary: 5000,    // 5 km
  fallback1: 15000, // 15 km
  fallback2: 50000, // 50 km
};

//////////////////////////////////////////////////////////////
// 🌍 GEO SERVICE — FINAL (REDIS + ZOMATO GRADE)
//////////////////////////////////////////////////////////////

const geoService = {
  //////////////////////////////////////////////////////////
  // 📍 DETECT FULL LOCATION FROM LAT/LNG
  //////////////////////////////////////////////////////////
  async detectLocation(lat, lng) {
    try {
      //////////////////////////////////////////////////////
      // 1️⃣ TYPE CONVERSION
      //////////////////////////////////////////////////////
      const latitude = Number(lat);
      const longitude = Number(lng);

      //////////////////////////////////////////////////////
      // 2️⃣ VALIDATION
      //////////////////////////////////////////////////////
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

      //////////////////////////////////////////////////////
      // 🧠 REDIS CACHE KEY
      //////////////////////////////////////////////////////
      const cacheKey = `geo:${latitude.toFixed(5)}:${longitude.toFixed(5)}`;

      //////////////////////////////////////////////////////
      // ⚡ CACHE CHECK FIRST
      //////////////////////////////////////////////////////
      try {
        const cached = await redis.get(cacheKey);

        if (cached) {
          return JSON.parse(cached);
        }
      } catch (err) {
        console.warn("⚠️ Redis read failed, fallback to DB");
      }

      //////////////////////////////////////////////////////
      // 🧠 DYNAMIC RADIUS LOGIC
      //////////////////////////////////////////////////////
      let primaryRadius = RADIUS.primary;
      let fallback1 = RADIUS.fallback1;
      let fallback2 = RADIUS.fallback2;

      // 🔥 rural-heavy zones
      if (latitude < 20) {
        primaryRadius = 8000;
        fallback1 = 20000;
      }

      // 🔥 dense metro zones (example)
      if (latitude > 25 && latitude < 29) {
        primaryRadius = 4000;
        fallback1 = 12000;
      }

      //////////////////////////////////////////////////////
      // 🔍 INTERNAL FIND FUNCTION
      //////////////////////////////////////////////////////
      const findPincode = async (distance) => {
        return await Pincode.findOne({
          geo: {
            $near: {
              $geometry: {
                type: "Point",
                coordinates: [longitude, latitude],
              },
              $maxDistance: distance,
            },
          },
          isActive: true,
          isDeleted: false,
        })
          .select("_id countryRef stateRef districtRef cityRef")
          .lean()
          .maxTimeMS(200)
          .hint({ geo: "2dsphere" });
      };

      //////////////////////////////////////////////////////
      // 🔥 STEP 1: PRIMARY SEARCH
      //////////////////////////////////////////////////////
      let pincode = await findPincode(primaryRadius);
      let confidence = 0.95;

      //////////////////////////////////////////////////////
      // 🔥 STEP 2: FALLBACK 1
      //////////////////////////////////////////////////////
      if (!pincode) {
        pincode = await findPincode(fallback1);
        confidence = 0.85;
      }

      //////////////////////////////////////////////////////
      // 🔥 STEP 3: FALLBACK 2
      //////////////////////////////////////////////////////
      if (!pincode) {
        pincode = await findPincode(fallback2);
        confidence = 0.7;
      }

      //////////////////////////////////////////////////////
      // ❌ NO RESULT
      //////////////////////////////////////////////////////
      if (!pincode) {
        console.warn("⚠️ No pincode found for location:", {
          lat: latitude,
          lng: longitude,
        });
        return null;
      }

      //////////////////////////////////////////////////////
      // ✅ FINAL RESULT
      //////////////////////////////////////////////////////
      const result = {
        pincodeRef: pincode._id,
        cityRef: pincode.cityRef,
        districtRef: pincode.districtRef,
        stateRef: pincode.stateRef,
        countryRef: pincode.countryRef,
        lat: latitude,
        lng: longitude,
        confidence,
      };

      //////////////////////////////////////////////////////
      // ⚡ SAVE TO REDIS (TTL: 5 MIN)
      //////////////////////////////////////////////////////
      try {
        await redis.set(cacheKey, JSON.stringify(result), "EX", 300);
      } catch (err) {
        console.warn("⚠️ Redis write failed");
      }

      //////////////////////////////////////////////////////
      // RETURN
      //////////////////////////////////////////////////////
      return result;

    } catch (error) {
      console.error("❌ Geo detect error:", error.message);
      return null;
    }
  },
};

//////////////////////////////////////////////////////////////
// 🚀 EXPORT
//////////////////////////////////////////////////////////////

export default geoService;