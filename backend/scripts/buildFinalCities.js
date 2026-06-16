import fs from "fs";
import readline from "readline";
import path from "path";
import { fileURLToPath } from "url";

/////////////////////////////////////////////////////
// 📂 CONFIG
/////////////////////////////////////////////////////

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DISTRICTS_FILE = path.join(__dirname, "../seeds/data/districts.json"); // correct (already there)
const ADMIN2_FILE    = path.join(__dirname, "./data/admin2Codes.txt");       // FIXED
const GEO_FILE       = path.join(__dirname, "../data/IN.txt");               // FIXED
const OUTPUT_FILE    = path.join(__dirname, "../data/finalCities.json");     // FIXED

const MAX_CITIES_PER_DISTRICT = 6;

// Fix 1 — Lowered from 50000 to avoid dropping valid small district HQs
const MIN_POPULATION = 10000;

/////////////////////////////////////////////////////
// 🧠 HELPERS
/////////////////////////////////////////////////////

function normalize(str) {
  return str
    ?.toLowerCase()
    .replace(/district/g, "")
    .replace(/city/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/////////////////////////////////////////////////////
// 🌍 HAVERSINE DISTANCE
/////////////////////////////////////////////////////

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/////////////////////////////////////////////////////
// 📦 LOAD DISTRICTS
/////////////////////////////////////////////////////

const districts = JSON.parse(fs.readFileSync(DISTRICTS_FILE, "utf-8"));

console.log("✅ Districts Loaded:", districts.length);

/////////////////////////////////////////////////////
// 📦 BUILD DISTRICT INDEX
/////////////////////////////////////////////////////

const districtIndex = {};

districts.forEach((d) => {
  const key = normalize(d.name) + "_" + d.stateCode;
  districtIndex[key] = d;
});

/////////////////////////////////////////////////////
// 📦 LOAD ADMIN2
/////////////////////////////////////////////////////

const admin2Raw = fs.readFileSync(ADMIN2_FILE, "utf-8");
const admin2Map = {};

admin2Raw.split("\n").forEach((line) => {
  const parts = line.split("\t");
  const code = parts[0];
  const name = parts[1]?.trim();
  if (code?.startsWith("IN.") && name) {
    admin2Map[code] = name;
  }
});

console.log("✅ admin2 Loaded:", Object.keys(admin2Map).length);

/////////////////////////////////////////////////////
// 📦 STORAGE
/////////////////////////////////////////////////////

// districtId -> cities[]
const districtCityMap = {};

// districtId -> HQ city object
const districtHQMap = {};

// Fix 2 — REMOVED: globalResolvedCities (was silently dropping valid cities)

/////////////////////////////////////////////////////
// 🚀 STREAM GEO FILE
/////////////////////////////////////////////////////

const rl = readline.createInterface({
  input: fs.createReadStream(GEO_FILE),
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  if (!line) return;

  const parts = line.split("\t");
  if (parts.length < 15) return;

  ///////////////////////////////////////////////////
  // 🔥 BASIC FILTERS
  ///////////////////////////////////////////////////

  const countryCode = parts[8];
  const featureClass = parts[6];

  if (countryCode !== "IN") return;

  // Fix 2 — Feature code filter: only real populated places, no garbage
  const featureCode = parts[7];

  if (
    featureClass !== "P" ||
    !["PPL", "PPLA", "PPLA2", "PPLC"].includes(featureCode)
  ) {
    return;
  }

  const population = Number(parts[14]) || 0;

  ///////////////////////////////////////////////////
  // 🔥 CITY DATA
  ///////////////////////////////////////////////////

  const cityName = parts[1]?.trim();
  const latitude = parseFloat(parts[4]);
  const longitude = parseFloat(parts[5]);
  const stateCode = parts[10];

  ///////////////////////////////////////////////////
  // 🔥 STRICT GEO VALIDATION
  ///////////////////////////////////////////////////

  if (
    !cityName ||
    isNaN(latitude) ||
    isNaN(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    (latitude === 0 && longitude === 0)
  ) {
    return;
  }

  ///////////////////////////////////////////////////
  // 🔥 DISTRICT RESOLUTION
  ///////////////////////////////////////////////////

  const adminKey = `IN.${parts[10]}.${parts[11]}`;

  let districtName = admin2Map[adminKey];

  if (!districtName) {
    // fallback: use raw district column from GeoNames directly
    districtName = parts[11];
  }

  if (!districtName) return;

  districtName = districtName.trim();

  const districtKey = normalize(districtName) + "_" + stateCode;

  // Fix 3 — Fuzzy fallback for name mismatches (Prayagraj vs Allahabad etc.)
  let district = districtIndex[districtKey];

  if (!district) {
    const normalizedDist = normalize(districtName);
    district = Object.values(districtIndex).find(
      (d) =>
        d.stateCode === stateCode &&
        (normalize(d.name).includes(normalizedDist) ||
          normalizedDist.includes(normalize(d.name)))
    );
  }

  if (!district) return;

  ///////////////////////////////////////////////////
  // 🔥 DISTRICT ID
  ///////////////////////////////////////////////////

  // Stable districtId — no collision risk
  const districtId = normalize(district.name) + "_" + district.stateCode;

  ///////////////////////////////////////////////////
  // 🔥 INIT DISTRICT BUCKET
  ///////////////////////////////////////////////////

  if (!districtCityMap[districtId]) {
    districtCityMap[districtId] = [];
  }

  ///////////////////////////////////////////////////
  // Fix 2 — District-level duplicate protection only
  // Global dedup removed — same city can be valid in multiple districts
  ///////////////////////////////////////////////////

  const normalizedCityName = normalize(cityName);

  // Fix 2 — HQ detection: PPLA/PPLA2 (GeoNames flags) OR exact name match
  const isHQ =
    featureCode === "PPLA"  || // state capital
    featureCode === "PPLA2" || // district capital (most reliable)
    normalizedCityName === normalize(district.name);

  // Fix 4 — HQ never rejected by population; only non-HQ cities filtered
  if (!isHQ && population < MIN_POPULATION) return;

  // District-level duplicate protection
  const alreadyExists = districtCityMap[districtId].some(
    (c) => c.normalizedName === normalizedCityName
  );

  if (alreadyExists) return;

  const cityObject = {
    name: cityName,
    normalizedName: normalizedCityName,
    stateCode,
    latitude,
    longitude,
    population,
    isHQ,
  };

  ///////////////////////////////////////////////////
  // 🔥 STORE HQ
  ///////////////////////////////////////////////////

  if (isHQ) {
    districtHQMap[districtId] = cityObject;
  }

  ///////////////////////////////////////////////////
  // 🔥 STORE CITY
  ///////////////////////////////////////////////////

  districtCityMap[districtId].push(cityObject);
});

/////////////////////////////////////////////////////
// 🧠 FINAL ENGINE
/////////////////////////////////////////////////////

rl.on("close", () => {
  console.log("🔥 Building Final Output...");

  const finalOutput = [];

  ///////////////////////////////////////////////////
  // 🔥 PROCESS DISTRICTS
  ///////////////////////////////////////////////////

  districts.forEach((district) => {
    // Stable districtId — matches key used during streaming
    const districtId = normalize(district.name) + "_" + district.stateCode;

    const cities = districtCityMap[districtId] || [];

    if (!districtCityMap[districtId]) {
      console.log("⚠️ NO CITY FOUND:", district.name, district.stateCode);
    }

    ///////////////////////////////////////////////////
    // 🔥 HQ RESOLVE
    ///////////////////////////////////////////////////

    let HQ = districtHQMap[districtId];

    ///////////////////////////////////////////////////
    // 🔥 FALLBACK HQ (geo not found in GeoNames)
    ///////////////////////////////////////////////////

    if (!HQ) {
      HQ = {
        name: district.name,
        normalizedName: normalize(district.name),
        latitude: null,
        longitude: null,
        population: 999999999,
        isHQ: true,
      };
    }

    if (!HQ || HQ.latitude === null) {
      console.log("❌ HQ NOT FOUND:", district.name, district.stateCode);
    }

    ///////////////////////////////////////////////////
    // 🔥 REMOVE HQ FROM CANDIDATES
    ///////////////////////////////////////////////////

    let candidates = cities.filter(
      (c) => c.normalizedName !== HQ.normalizedName
    );

    ///////////////////////////////////////////////////
    // 🔥 SORT: distance from HQ (if HQ has coords) else population
    ///////////////////////////////////////////////////

    if (HQ.latitude != null && HQ.longitude != null) {
      candidates = candidates
        .map((c) => ({
          ...c,
          distance: getDistance(
            HQ.latitude,
            HQ.longitude,
            c.latitude,
            c.longitude
          ),
        }))
        .sort((a, b) => a.distance - b.distance)
        .filter((c) => c.distance <= 80); // nearby cities within district range
    } else {
      candidates.sort((a, b) => b.population - a.population);
    }

    ///////////////////////////////////////////////////
    // 🔥 REMOVE DUPLICATES WITHIN CANDIDATES
    ///////////////////////////////////////////////////

    const seen = new Set();

    candidates = candidates.filter((c) => {
      const key = c.normalizedName;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    ///////////////////////////////////////////////////
    // 🔥 LIMIT RESULTS (HQ already takes 1 slot)
    ///////////////////////////////////////////////////

    const selected = candidates.slice(0, MAX_CITIES_PER_DISTRICT - 1);

    ///////////////////////////////////////////////////
    // 🔥 FINAL CITIES — HQ always first
    ///////////////////////////////////////////////////

    const finalCities = [
      {
        name: HQ.name,
        isHQ: true,
        latitude: HQ.latitude,
        longitude: HQ.longitude,
      },
      ...selected.map((c) => ({
        name: c.name,
        isHQ: false,
        latitude: c.latitude,
        longitude: c.longitude,
      })),
    ];

    ///////////////////////////////////////////////////
    // 🔥 FINAL DISTRICT OBJECT
    ///////////////////////////////////////////////////

    finalOutput.push({
      districtName: district.name,
      stateCode: district.stateCode,
      cities: finalCities,
    });
  });

  ///////////////////////////////////////////////////
  // 💾 SAVE FILE
  ///////////////////////////////////////////////////

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalOutput, null, 2));

  console.log("✅ FINAL FILE GENERATED:", OUTPUT_FILE);
  console.log("✅ TOTAL DISTRICTS:", finalOutput.length);
});