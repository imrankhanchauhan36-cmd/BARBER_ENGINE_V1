/**
 * mergeCitiesToMaster.js
 *
 * Reads finalCities.json (GeoNames extracted cities)
 * and merges NEW non-HQ cities into cities.master.json
 *
 * Rules:
 * - HQ cities are NEVER added (already in master)
 * - Only non-HQ cities that don't exist in master are added
 * - Existing master data is NEVER modified
 * - Output: updated cities.master.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const MASTER_FILE = path.join(__dirname, "../data/cities.master.json");
const FINAL_FILE  = path.join(__dirname, "../data/finalCities.json");

//////////////////////////////////////////////////////////////
// NORMALIZE
//////////////////////////////////////////////////////////////

const normalize = (str) =>
  str?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";

//////////////////////////////////////////////////////////////
// LOAD FILES
//////////////////////////////////////////////////////////////

const master = JSON.parse(fs.readFileSync(MASTER_FILE, "utf-8"));
const final  = JSON.parse(fs.readFileSync(FINAL_FILE,  "utf-8"));

console.log(`✅ Master loaded: ${master.length} districts`);
console.log(`✅ Final loaded:  ${final.length} districts`);

//////////////////////////////////////////////////////////////
// BUILD MASTER INDEX
// key: normalizedDistrictName_stateCode → master entry
//////////////////////////////////////////////////////////////

const masterIndex = new Map();

master.forEach((entry) => {
  const key = normalize(entry.districtName) + "_" + entry.stateCode?.toUpperCase();
  masterIndex.set(key, entry);
});

//////////////////////////////////////////////////////////////
// MERGE
//////////////////////////////////////////////////////////////

let addedTotal   = 0;
let skippedTotal = 0;

final.forEach((finalEntry) => {
  const distKey = normalize(finalEntry.districtName) + "_" + finalEntry.stateCode?.toUpperCase();
  const masterEntry = masterIndex.get(distKey);

  if (!masterEntry) {
    // District not in master — skip entirely (safety)
    skippedTotal++;
    return;
  }

  // Build set of existing city names in master
  const existingNames = new Set(
    masterEntry.cities.map((c) => normalize(c.name))
  );

  // Add only non-HQ cities that don't exist yet
  finalEntry.cities.forEach((city) => {
    // Skip HQ cities — already in master
    if (city.isHQ) return;

    // Skip if no coordinates
    if (city.latitude === null || city.longitude === null) return;

    // Skip if already exists
    if (existingNames.has(normalize(city.name))) return;

    // Add to master entry
    masterEntry.cities.push({
      name: city.name,
      isDistrictHQ: false,
      isServiceable: false,
      aliases: [],
      geo: {
        type: "Point",
        coordinates: [city.longitude, city.latitude],
      },
    });

    existingNames.add(normalize(city.name));
    addedTotal++;
  });
});

//////////////////////////////////////////////////////////////
// SAVE UPDATED MASTER
//////////////////////////////////////////////////////////////

fs.writeFileSync(MASTER_FILE, JSON.stringify(master, null, 2));

console.log("\n🎉 MERGE COMPLETE");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`✅ Cities added:   ${addedTotal}`);
console.log(`⏭️  Districts skip: ${skippedTotal}`);
console.log(`📦 Output:         ${MASTER_FILE}`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("✅ Now run: node scripts/seedCities.js");