import fs from "fs";

// ✅ FINAL FILE (UPDATED)
const FILE_PATH = "./data/finalCities.json";

const EXPECTED_DISTRICTS = 779;

/////////////////////////////////////////////////////
// LOAD FILE
/////////////////////////////////////////////////////
let raw;

try {
  raw = fs.readFileSync(FILE_PATH, "utf-8");
} catch (err) {
  console.error("❌ FILE NOT FOUND:", FILE_PATH);
  process.exit(1);
}

let data;

try {
  data = JSON.parse(raw);
} catch (err) {
  console.error("❌ INVALID JSON FORMAT");
  process.exit(1);
}

/////////////////////////////////////////////////////
// STORAGE
/////////////////////////////////////////////////////
let totalDistricts = 0;
let totalCities = 0;

let errorDistricts = [];
let duplicateCityMap = {};
let districtSet = new Set();

/////////////////////////////////////////////////////
// HELPERS
/////////////////////////////////////////////////////
function normalize(str) {
  return str?.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/////////////////////////////////////////////////////
// MAIN LOOP
/////////////////////////////////////////////////////
data.forEach((district) => {
  totalDistricts++;

  const dName = district.districtName;
  const dState = district.stateCode || "UNKNOWN";

  /////////////////////////////////////////////////////
  // ❌ Duplicate district
  /////////////////////////////////////////////////////

  const districtKey = dName + "_" + dState;

  if (districtSet.has(districtKey)) {
    errorDistricts.push({
      district: dName,
      state: dState,
      error: "Duplicate district entry",
    });
  }

  districtSet.add(districtKey);

  /////////////////////////////////////////////////////
  // ❌ No cities
  /////////////////////////////////////////////////////
  if (!district.cities || district.cities.length === 0) {
    errorDistricts.push({
      district: dName,
      error: "No cities",
    });
    return;
  }

  // Fix 2 — REMOVED: "More than 5 cities" block
  // India districts can have 50+ cities — this was a false error

  let hasHQ = false;
  let cityNames = new Set();

  district.cities.forEach((city) => {
    totalCities++;

    const nameKey = normalize(city.name);

    /////////////////////////////////////////////////////
    // HQ check
    /////////////////////////////////////////////////////
    if (city.isHQ === true) hasHQ = true;

    /////////////////////////////////////////////////////
    // ❌ Duplicate city inside district
    /////////////////////////////////////////////////////
    if (cityNames.has(nameKey)) {
      errorDistricts.push({
        district: dName,
        city: city.name,
        error: "Duplicate city in same district",
      });
    }
    cityNames.add(nameKey);

    /////////////////////////////////////////////////////
    // Fix 3 — Global duplicate tracking with stateCode
    // key = cityName + stateCode to avoid false cross-state clash
    /////////////////////////////////////////////////////
    const globalKey = nameKey + "_" + dState;
    if (!duplicateCityMap[globalKey]) {
      duplicateCityMap[globalKey] = [];
    }
    duplicateCityMap[globalKey].push(dName);

    /////////////////////////////////////////////////////
    // Fix 1 — Coordinate validation
    // null is ALLOWED for HQ fallback cities
    // only validate when value is present
    /////////////////////////////////////////////////////
    const lat = city.latitude;
    const lng = city.longitude;

    const isInvalidCoord =
      (lat !== null &&
        (typeof lat !== "number" || lat < -90 || lat > 90)) ||
      (lng !== null &&
        (typeof lng !== "number" || lng < -180 || lng > 180)) ||
      (lat === 0 && lng === 0); // 0,0 is always invalid

    if (isInvalidCoord) {
      errorDistricts.push({
        district: dName,
        city: city.name,
        error: "Invalid coordinates",
      });
    }
  });

  /////////////////////////////////////////////////////
  // ❌ HQ missing
  /////////////////////////////////////////////////////
  if (!hasHQ) {
    errorDistricts.push({
      district: dName,
      error: "HQ missing",
    });
  }
});

/////////////////////////////////////////////////////
// CROSS DISTRICT DUPLICATES (within same state)
/////////////////////////////////////////////////////
let crossDistrictDuplicates = [];

Object.keys(duplicateCityMap).forEach((key) => {
  if (duplicateCityMap[key].length > 1) {
    const [cityName, stateCode] = key.split("_");
    crossDistrictDuplicates.push({
      city: cityName,
      stateCode,
      districts: duplicateCityMap[key],
    });
  }
});

/////////////////////////////////////////////////////
// FINAL REPORT
/////////////////////////////////////////////////////
console.log("\n====== FINAL REPORT ======\n");

console.log("📊 Total Districts:", totalDistricts);
console.log("🎯 Expected Districts:", EXPECTED_DISTRICTS);

if (totalDistricts !== EXPECTED_DISTRICTS) {
  console.log("❌ MISSING DISTRICTS:", EXPECTED_DISTRICTS - totalDistricts);
} else {
  console.log("✅ All districts covered");
}

console.log("\n🏙️ Total Cities:", totalCities);

console.log("\n❌ Total Errors:", errorDistricts.length);

if (errorDistricts.length > 0) {
  console.log("\n--- ERROR LIST ---\n");
  console.log(JSON.stringify(errorDistricts.slice(0, 50), null, 2));
} else {
  console.log("✅ No structural errors");
}

console.log(
  "\n⚠️ Cross-District Duplicate Cities (same state):",
  crossDistrictDuplicates.length
);

if (crossDistrictDuplicates.length > 0) {
  console.log("\n--- DUPLICATES ---\n");
  console.log(JSON.stringify(crossDistrictDuplicates.slice(0, 20), null, 2));
}

console.log("\n====== END ======\n");