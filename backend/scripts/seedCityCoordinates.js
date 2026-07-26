//////////////////////////////////////////////////////////////
// SEED SCRIPT — sets latitude/longitude on serviceable cities.
// Safe to re-run: only updates cities matched by name, only sets
// the two coordinate fields (never touches isServiceable or any
// other city data).
//
// Run from inside backend/ directory:
//     node scripts/seedCityCoordinates.js
//////////////////////////////////////////////////////////////

import "dotenv/config";
import mongoose from "mongoose";
import City from "../models/City.js";

// City-center coordinates — approximate, good enough as a "browse
// nearby in this city" starting point for the manual city-picker
// (ChooseCityModal). Add a new entry here whenever a new city is
// marked isServiceable: true in the database.
const CITY_COORDINATES = [
  { name: "Ahmednagar",    latitude: 19.0952, longitude: 74.7496 },
  { name: "Shrirampur",    latitude: 19.6197, longitude: 74.6604 },
  { name: "Sangamner",     latitude: 19.5686, longitude: 74.2100 },
  { name: "Lucknow",       latitude: 26.8467, longitude: 80.9462 },
  { name: "Noida",         latitude: 28.5355, longitude: 77.3910 },
  { name: "Greater Noida", latitude: 28.4744, longitude: 77.5040 },
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ Connected to MongoDB");

  for (const city of CITY_COORDINATES) {
    const result = await City.updateOne(
      { name: city.name },
      { $set: { latitude: city.latitude, longitude: city.longitude } }
    );
    if (result.matchedCount === 0) {
      console.log(`⚠️  Skipped (not found in DB): ${city.name}`);
    } else if (result.modifiedCount > 0) {
      console.log(`✅ Updated: ${city.name} → (${city.latitude}, ${city.longitude})`);
    } else {
      console.log(`⏭️  Already up to date: ${city.name}`);
    }
  }

  // Sanity check — flag any isServiceable city still missing
  // coordinates, so a future new serviceable city is never silently
  // left out of CITY_COORDINATES above.
  const missing = await City.find(
    { isServiceable: true, $or: [{ latitude: null }, { longitude: null }] },
    { name: 1 }
  ).lean();
  if (missing.length > 0) {
    console.log("⚠️  Serviceable cities still missing coordinates:", missing.map((c) => c.name).join(", "));
  }

  await mongoose.disconnect();
  console.log("✅ Done");
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});