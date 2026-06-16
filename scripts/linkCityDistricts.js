import fs from "fs";
import mongoose from "mongoose";
import dotenv from "dotenv";

import City from "../models/City.js";
import District from "../models/District.js";

dotenv.config();

/////////////////////////////////////////////////////
// CONNECT DB
/////////////////////////////////////////////////////
await mongoose.connect(process.env.MONGODB_URI);
console.log("✅ DB Connected");

/////////////////////////////////////////////////////
// LOAD GEO DATA
/////////////////////////////////////////////////////
const raw = fs.readFileSync("data/IN.txt", "utf-8");
const lines = raw.split("\n");

const geoData = [];

for (const line of lines) {
  const parts = line.split("\t");

  if (parts.length < 12) continue;

  const admin2Code = parts[11];
  if (!admin2Code) continue;

  geoData.push({
    lat: parseFloat(parts[4]),
    lng: parseFloat(parts[5]),
    admin2Code,
    population: parseInt(parts[14] || "0"),
  });
}

console.log("📦 Total Geo Loaded:", geoData.length);

/////////////////////////////////////////////////////
// HELPER: DISTANCE (KM)
/////////////////////////////////////////////////////
function getDistance(lat1, lng1, lat2, lng2) {
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

/////////////////////////////////////////////////////
// LOAD DISTRICTS MAP (🔥 FAST LOOKUP)
/////////////////////////////////////////////////////
const districts = await District.find().lean();

const districtMap = {};

districts.forEach((d) => {
  if (d.admin2Code && d.stateRef) {
    const key = `${d.admin2Code}_${d.stateRef.toString()}`;
    districtMap[key] = d._id;
  }
});

console.log("🏙 Districts Loaded:", districts.length);

/////////////////////////////////////////////////////
// LOAD CITIES
/////////////////////////////////////////////////////
const cities = await City.find().lean();

console.log("🌆 Cities Loaded:", cities.length);

let bulkOps = [];
let updated = 0;
let skipped = 0;
let processed = 0;

/////////////////////////////////////////////////////
// PROCESS
/////////////////////////////////////////////////////
for (const city of cities) {
  processed++;

  if (processed % 100 === 0) {
    console.log(`🔄 Processed: ${processed}`);
  }

  ///////////////////////////////////////////////////
  // SAFETY CHECK
  ///////////////////////////////////////////////////
  if (!city.geo || !city.geo.coordinates) {
    skipped++;
    continue;
  }

  const [lng, lat] = city.geo.coordinates;

  let best = null;
  let minDist = Infinity;

  ///////////////////////////////////////////////////
  // 🔥 FAST GEO MATCH
  ///////////////////////////////////////////////////
  for (const geo of geoData) {
    if (Math.abs(geo.lat - lat) > 2) continue;
    if (Math.abs(geo.lng - lng) > 2) continue;

    const dist = getDistance(lat, lng, geo.lat, geo.lng);

    // ⚡ SUPER CLOSE → DIRECT PICK
    if (dist < 3) {
      best = geo;
      minDist = dist;
      break;
    }

    if (
      dist < minDist ||
      (dist === minDist && geo.population > (best?.population || 0))
    ) {
      minDist = dist;
      best = geo;
    }
  }

  ///////////////////////////////////////////////////
  // VALIDATION
  ///////////////////////////////////////////////////
  if (!best || minDist > 50) {
    skipped++;
    continue;
  }

  ///////////////////////////////////////////////////
  // 🔥 CORRECT DISTRICT MATCH (STATE SAFE)
  ///////////////////////////////////////////////////
  const stateId = city.stateRef?.toString();

  if (!stateId) {
    skipped++;
    continue;
  }

  const key = `${best.admin2Code}_${stateId}`;
  const districtId = districtMap[key];

  if (!districtId) {
    console.log("❌ No district match for:", key);
    skipped++;
    continue;
  }

  ///////////////////////////////////////////////////
  // BULK UPDATE
  ///////////////////////////////////////////////////
  bulkOps.push({
    updateOne: {
      filter: { _id: city._id },
      update: {
        $set: {
          admin2Code: best.admin2Code,
          districtRef: districtId,
        },
      },
    },
  });

  updated++;

  ///////////////////////////////////////////////////
  // EXECUTE BATCH
  ///////////////////////////////////////////////////
  if (bulkOps.length === 500) {
    await City.bulkWrite(bulkOps);
    console.log(`⚡ Updated Batch: ${updated}`);
    bulkOps = [];
  }
}

/////////////////////////////////////////////////////
// FINAL WRITE
/////////////////////////////////////////////////////
if (bulkOps.length) {
  await City.bulkWrite(bulkOps);
}

/////////////////////////////////////////////////////
// RESULT
/////////////////////////////////////////////////////
console.log("=================================");
console.log("🔥 FINAL RESULT");
console.log("✅ TOTAL UPDATED:", updated);
console.log("⚠️ TOTAL SKIPPED:", skipped);
console.log("=================================");

await mongoose.connection.close();
console.log("🔌 DB Disconnected");