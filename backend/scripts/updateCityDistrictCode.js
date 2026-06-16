import fs from "fs";
import mongoose from "mongoose";
import dotenv from "dotenv";

import City from "../models/City.js";
import State from "../models/State.js";

dotenv.config();

/////////////////////////////////////////////////////
// CONNECT DB
/////////////////////////////////////////////////////
await mongoose.connect(process.env.MONGODB_URI);
console.log("✅ DB Connected");

/////////////////////////////////////////////////////
// NORMALIZE FUNCTION
/////////////////////////////////////////////////////
function normalize(str) {
  return str
    ?.toUpperCase()
    .trim()
    .replace(/[^A-Z0-9 ]/g, "")
    .replace(/\s+/g, " ");
}

/////////////////////////////////////////////////////
// LOAD MAP
/////////////////////////////////////////////////////
const map = JSON.parse(
  fs.readFileSync("data/cityCodeMap.json", "utf-8")
);

console.log("📦 Map Loaded:", Object.keys(map).length);

/////////////////////////////////////////////////////
// LOAD STATES
/////////////////////////////////////////////////////
const states = await State.find();

const stateCodeMap = {};
states.forEach((s) => {
  if (s.code) {
    stateCodeMap[s._id.toString()] = s.code.toUpperCase();
  }
});

/////////////////////////////////////////////////////
// LOAD CITIES
/////////////////////////////////////////////////////
const cities = await City.find();

let bulkOps = [];
let updated = 0;
let skipped = 0;

/////////////////////////////////////////////////////
// 🚀 FAST PROCESS (FINAL)
/////////////////////////////////////////////////////
for (const city of cities) {
  const stateCode = stateCodeMap[city.stateRef?.toString()];

  if (!stateCode) {
    skipped++;
    continue;
  }

  const base = normalize(city.name);

  const keys = [
    `${base}_${stateCode}`,
    `${base.replace(" CITY", "")}_${stateCode}`,
    `${base.replace(" DISTRICT", "")}_${stateCode}`,
    `${base.replace(" NAGAR", "")}_${stateCode}`,
    `${base.replace(" URBAN", "")}_${stateCode}`,
    `${base.replace(" RURAL", "")}_${stateCode}`,
  ];

  let code = null;

  ///////////////////////////////////////////////////
  // FAST MATCH (NO HEAVY LOOP)
  ///////////////////////////////////////////////////
  for (const key of keys) {
    if (map[key]) {
      code = map[key];
      break;
    }
  }

  if (!code) {
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
          admin2Code: String(code),
        },
      },
    },
  });

  updated++;

  ///////////////////////////////////////////////////
  // EXECUTE BATCH
  ///////////////////////////////////////////////////
  if (bulkOps.length === 1000) {
    await City.bulkWrite(bulkOps);
    console.log(`⚡ Updated: ${updated}`);
    bulkOps = [];
  }
}

/////////////////////////////////////////////////////
// FINAL EXECUTE
/////////////////////////////////////////////////////
if (bulkOps.length) {
  await City.bulkWrite(bulkOps);
}

/////////////////////////////////////////////////////
// RESULT
/////////////////////////////////////////////////////
console.log("🔥 TOTAL UPDATED:", updated);
console.log("⚠️ SKIPPED:", skipped);

await mongoose.connection.close();
console.log("🔌 DB Disconnected");