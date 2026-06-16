import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

import City from "../models/City.js";
import State from "../models/State.js";
import District from "../models/District.js";

/////////////////////////////////////////////////////
// PATH SETUP
/////////////////////////////////////////////////////
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const citiesData = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../data/cities.master.json"),
    "utf-8"
  )
);

/////////////////////////////////////////////////////
// ENV VALIDATION
/////////////////////////////////////////////////////
if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI missing");
if (!process.env.INDIA_COUNTRY_ID) throw new Error("INDIA_COUNTRY_ID missing");

/////////////////////////////////////////////////////
// DB CONNECT
/////////////////////////////////////////////////////
await mongoose.connect(process.env.MONGODB_URI);
console.log("✅ DB Connected");

/////////////////////////////////////////////////////
// LOAD STATES & DISTRICTS
/////////////////////////////////////////////////////
const [states, districts] = await Promise.all([
  State.find({ isDeleted: false }),
  District.find({ isDeleted: false }),
]);

/////////////////////////////////////////////////////
// STATE MAP
/////////////////////////////////////////////////////
const stateMap = {};
states.forEach((s) => {
  if (s.code) stateMap[s.code.toUpperCase()] = s;
});

/////////////////////////////////////////////////////
// DISTRICT MAP
/////////////////////////////////////////////////////
const districtMap = {};
districts.forEach((d) => {
  const key = d.stateRef.toString();
  if (!districtMap[key]) districtMap[key] = [];
  districtMap[key].push(d);
});

/////////////////////////////////////////////////////
// NORMALIZE
/////////////////////////////////////////////////////
const normalize = (str) =>
  str?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";

/////////////////////////////////////////////////////
// PROCESS
/////////////////////////////////////////////////////
let processed = 0;
let skipped = 0;

for (const entry of citiesData) {
  try {
    ///////////////////////////////////////////////////
    // STATE MATCH
    ///////////////////////////////////////////////////
    const state = stateMap[entry.stateCode];
    if (!state) {
      console.log("❌ STATE NOT FOUND:", entry.stateCode);
      skipped++;
      continue;
    }

    ///////////////////////////////////////////////////
    // DISTRICT MATCH (ROBUST)
    ///////////////////////////////////////////////////
    const normDistrict = normalize(entry.districtName);

    const district = districtMap[state._id.toString()]?.find((d) => {
      const nameNorm = normalize(d.name);

      return (
        nameNorm === normDistrict ||
        d.normalizedAliases?.includes(normDistrict) ||
        (normDistrict.length >= 5 &&
          (nameNorm.startsWith(normDistrict) ||
            normDistrict.startsWith(nameNorm)))
      );
    });

    if (!district) {
      console.log("⚠️ DISTRICT NOT FOUND:", entry.districtName);
      skipped++;
      continue;
    }

    ///////////////////////////////////////////////////
    // BULK OPS
    ///////////////////////////////////////////////////
    const bulkOps = [];

    let hqCount = 0;
    let hqCityName = null;

    ///////////////////////////////////////////////////
    // LOOP CITIES
    ///////////////////////////////////////////////////
    for (const city of entry.cities) {
      if (
        !city.geo ||
        !Array.isArray(city.geo.coordinates) ||
        city.geo.coordinates.length !== 2
      ) {
        console.log("⚠️ INVALID GEO:", city.name);
        skipped++;
        continue;
      }

      const [lng, lat] = city.geo.coordinates;

      if (
        typeof lng !== "number" ||
        typeof lat !== "number" ||
        lng < -180 || lng > 180 ||
        lat < -90 || lat > 90
      ) {
        console.log("⚠️ INVALID GEO RANGE:", city.name);
        skipped++;
        continue;
      }

      if (!city.name || typeof city.name !== "string") {
        console.log("⚠️ INVALID NAME");
        skipped++;
        continue;
      }

      const name = city.name.trim();
      const normalizedName = normalize(name);

      const safeAliases = Array.isArray(city.aliases)
        ? city.aliases
        : [];

      const normalizedAliases = [
        ...new Set(safeAliases.map((a) => normalize(a))),
      ];

      ///////////////////////////////////////////////////
      // HQ TRACK
      ///////////////////////////////////////////////////
      if (city.isDistrictHQ) {
        hqCount++;
        hqCityName = name;
      }

      ///////////////////////////////////////////////////
      // BULK UPSERT
      ///////////////////////////////////////////////////
      bulkOps.push({
        updateOne: {
          filter: {
            normalizedName,
            districtRef: district._id,
          },
          update: {
            $set: {
              name,
              normalizedName,

              stateRef: state._id,
              districtRef: district._id,
              countryRef: new mongoose.Types.ObjectId(
                process.env.INDIA_COUNTRY_ID
              ),

              geo: city.geo,

              aliases: safeAliases,
              normalizedAliases,

              isDistrictHQ: city.isDistrictHQ || false,
              isServiceable: city.isServiceable ?? false,

              isAutoGenerated: false,

              launchStatus: "PRE_LAUNCH",
              onboardingEnabled: true,

              isActive: true,
              isDeleted: false,
            },
          },
          upsert: true,
        },
      });

      processed++;
    }

    ///////////////////////////////////////////////////
    // MULTIPLE HQ SAFETY
    ///////////////////////////////////////////////////
    if (hqCount > 1) {
      console.log("🚨 MULTIPLE HQ DETECTED:", entry.districtName);
      continue;
    }

    ///////////////////////////////////////////////////
    // EXECUTE BULK
    ///////////////////////////////////////////////////
    if (bulkOps.length > 0) {
      await City.bulkWrite(bulkOps);
    }

    ///////////////////////////////////////////////////
    // UPDATE DISTRICT HQ
    ///////////////////////////////////////////////////
    if (hqCityName) {
      const hqCity = await City.findOne({
        districtRef: district._id,
        normalizedName: normalize(hqCityName),
      });

      if (hqCity) {
        await District.updateOne(
          { _id: district._id },
          { $set: { hqCityRef: hqCity._id } }
        );
      }
    }

  } catch (err) {
    console.error("❌ ERROR:", err.message);
    skipped++;
  }
}

/////////////////////////////////////////////////////
// RESULT
/////////////////////////////////////////////////////
console.log("✅ Processed:", processed);
console.log("⚠️ Skipped:", skipped);

/////////////////////////////////////////////////////
// CLOSE
/////////////////////////////////////////////////////
await mongoose.connection.close();
console.log("🔌 DB Disconnected");