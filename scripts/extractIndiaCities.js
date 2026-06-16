import fs from "fs";
import readline from "readline";
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";

import District from "../models/District.js";
import State from "../models/State.js";

dotenv.config();

await mongoose.connect(process.env.MONGODB_URI);
console.log("✅ DB Connected");

function normalize(str) {
  return str
    ?.toLowerCase()
    .replace(/district/g, "")
    .replace(/city/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

const aliasMap = {
  ahmedabad: ["amdavad"],
  bengaluru: ["bangalore"],
  mumbai: ["bombay"],
  kolkata: ["calcutta"],
  chennai: ["madras"],
  pune: ["poona"],
  varanasi: ["banaras", "kashi"],
  thiruvananthapuram: ["trivandrum"],
  kozhikode: ["calicut"],
  thrissur: ["trichur"],
};

const reverseAlias = {};
Object.entries(aliasMap).forEach(([canonical, aliases]) => {
  aliases.forEach((alias) => {
    reverseAlias[normalize(alias)] = normalize(canonical);
  });
});

function resolveAlias(normalizedName) {
  return reverseAlias[normalizedName] ?? normalizedName;
}

const states = await State.find({}).lean();
const stateMap = {};
const geoCodeToStateCode = {}; // GeoNames numeric → DB state code

states.forEach((s) => {
  stateMap[s._id.toString()] = s.code;
  // Use DB's geoNameCode — this is the authoritative mapping
  if (s.geoNameCode) {
    geoCodeToStateCode[s.geoNameCode] = s.code;
  }
});

console.log("✅ State map built:", Object.keys(stateMap).length);
console.log("✅ GeoCode map built:", Object.keys(geoCodeToStateCode).length);
console.log("✅ Sample:", JSON.stringify(geoCodeToStateCode));

const districts = await District.find({ isDeleted: false })
  .select("_id name stateRef")
  .lean();
console.log("✅ Districts Loaded:", districts.length);

const ROOT = process.cwd();
const admin2Path = path.join(ROOT, "scripts/data/admin2Codes.txt");
const geoPath = path.join(ROOT, "data/allCountries.txt");

if (!fs.existsSync(admin2Path)) {
  console.error("❌ admin2Codes.txt NOT FOUND:", admin2Path);
  process.exit(1);
}

const admin2Raw = fs.readFileSync(admin2Path, "utf-8");
const admin2Map = {};
admin2Raw.split("\n").forEach((line) => {
  const parts = line.split("\t");
  const code = parts[0];
  const name = parts[1]?.trim();
  if (code?.startsWith("IN.") && name) {
    admin2Map[code] = name;
  }
});
console.log("✅ admin2Codes loaded:", Object.keys(admin2Map).length);

const districtLookup = {};
districts.forEach((d) => {
  const stateCode = stateMap[d.stateRef?.toString()];
  if (!stateCode) return;
  const key = normalize(d.name) + "_" + stateCode;
  districtLookup[key] = { ...d, resolvedStateCode: stateCode };
});
console.log("✅ District lookup map built:", Object.keys(districtLookup).length);

if (!fs.existsSync(geoPath)) {
  console.error("❌ allCountries.txt NOT FOUND:", geoPath);
  process.exit(1);
}

const rl = readline.createInterface({
  input: fs.createReadStream(geoPath),
  crlfDelay: Infinity,
});

const tempDistrictMap = {};
const globalCityPool = {};

// FIX: Accept both P and A feature classes
// P = populated place (PPL, PPLA, PPLA2, PPLC)
// A = administrative area (ADM3 = taluk/tehsil level — covers Ballabgarh etc.)
const VALID_FEATURE_CLASSES = ["P", "A"];
const VALID_FEATURE_CODES = ["PPL", "PPLA", "PPLA2", "PPLC", "ADM3", "ADM2"];

rl.on("line", (line) => {
  const cols = line.split("\t");
  if (cols.length < 15) return;
  if (cols[8] !== "IN") return;

  const featureClass = cols[6];
  const featureCode = cols[7];

  if (
    !VALID_FEATURE_CLASSES.includes(featureClass) ||
    !VALID_FEATURE_CODES.includes(featureCode)
  ) {
    return;
  }

  const population = Number(cols[14]) || 0;
  const name = cols[1]?.trim();
  const lat = parseFloat(cols[4]);
  const lng = parseFloat(cols[5]);

  if (
    !name ||
    isNaN(lat) ||
    isNaN(lng) ||
    lat < -90 || lat > 90 ||
    lng < -180 || lng > 180 ||
    (lat === 0 && lng === 0)
  ) {
    return;
  }

  // ADM3 entries have cols[10] empty — columns shift:
  // P entries:   cols[10]=stateCode, cols[11]=districtCode
  // ADM3 entries: cols[10]="", cols[11]=stateCode, cols[12]=districtCode
  const geoStateCode = cols[10]?.trim() || cols[11]?.trim();
  const adminCode2   = cols[10]?.trim() ? cols[11]?.trim() : cols[12]?.trim();
  const adminKey     = `IN.${geoStateCode}.${adminCode2}`;

  let districtName = admin2Map[adminKey];
  if (!districtName) return;

  districtName = districtName.replace(/[0-9]/g, "").trim();
  const normalizedGeo = normalize(districtName);

  // Industry fix: convert GeoNames numeric state code → DB state code
  // e.g. GeoNames "10" (Haryana) → DB "HR"
  const resolvedStateCode = geoCodeToStateCode[geoStateCode] || geoStateCode;
  const lookupKey = normalizedGeo + "_" + resolvedStateCode;
  const district = districtLookup[lookupKey];
  if (!district) return;

  const isLikelyHQ =
    resolveAlias(normalize(name)) === resolveAlias(normalize(districtName)) ||
    featureCode === "PPLA2";

  // FIX: ADM3 entries never rejected by population (Ballabgarh fix)
  // PPL entries with pop=0 also kept if they are ADM3 matched
  const isAdminArea = featureClass === "A";
  if (!isLikelyHQ && !isAdminArea && population < 10000) return;

  const districtId = district._id.toString();
  const cityKey = resolveAlias(normalize(name)) + "_" + districtId;

  const isHQ =
    resolveAlias(normalize(name)) === resolveAlias(normalize(district.name)) ||
    featureCode === "PPLA2";

  if (!globalCityPool[cityKey]) {
    globalCityPool[cityKey] = [];
  }

  globalCityPool[cityKey].push({
    districtId,
    name,
    isHQ,
    population,
    geo: {
      type: "Point",
      coordinates: [lng, lat],
    },
  });
});

rl.on("close", async () => {
  console.log("🔥 Resolving Global Pool...");

  Object.values(globalCityPool).forEach((entries) => {
    entries.forEach((entry) => {
      const districtId = entry.districtId;
      if (!tempDistrictMap[districtId]) {
        tempDistrictMap[districtId] = [];
      }
      tempDistrictMap[districtId].push(entry);
    });
  });

  const finalOutput = [];

  districts.forEach((district) => {
    const districtId = district._id.toString();
    const stateCode = stateMap[district.stateRef?.toString()] || null;

    if (!stateCode) {
      console.error("❌ STATE NOT FOUND:", district.name, district.stateRef);
    }

    let cities = tempDistrictMap[districtId] || [];

    // Remove duplicates
    const seen = new Set();
    cities = cities.filter((c) => {
      const key = resolveAlias(normalize(c.name));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by population
    cities.sort((a, b) => b.population - a.population);

    // Ensure HQ exists
    const hasHQ = cities.some((c) => c.isHQ);
    if (!hasHQ) {
      cities.unshift({
        name: district.name,
        isHQ: true,
        population: 999999999,
        geo: null,
      });
    }

    // Limit to 5
    let finalCities = cities.slice(0, 5);

    // Ensure HQ in final 5
    if (!finalCities.some((c) => c.isHQ)) {
      const hq = cities.find((c) => c.isHQ);
      if (hq) finalCities[finalCities.length - 1] = hq;
    }

    finalOutput.push({
      districtName: district.name,
      stateCode,
      cities: finalCities.map((c) => ({
        name: c.name,
        isHQ: c.isHQ,
        latitude: c.geo?.coordinates?.[1] ?? null,
        longitude: c.geo?.coordinates?.[0] ?? null,
      })),
    });
  });

  // Validation
  const errors = [];
  finalOutput.forEach((district) => {
    if (!district.stateCode) errors.push(`Missing stateCode: ${district.districtName}`);
    district.cities.forEach((city) => {
      if (!city.name) errors.push(`Missing city name in ${district.districtName}`);
      if (city.latitude !== null && (city.latitude < -90 || city.latitude > 90))
        errors.push(`Invalid lat in ${city.name}`);
      if (city.longitude !== null && (city.longitude < -180 || city.longitude > 180))
        errors.push(`Invalid lng in ${city.name}`);
    });
  });

  if (errors.length > 0) {
    console.error("❌ VALIDATION FAILED");
    console.error(errors.slice(0, 20));
    process.exit(1);
  }
  console.log("✅ VALIDATION PASSED");

  // Cross-district duplicate check
  const cityMap = {};
  finalOutput.forEach((d) => {
    d.cities.forEach((c) => {
      const key = c.name.toLowerCase() + "_" + d.stateCode;
      if (!cityMap[key]) cityMap[key] = [];
      cityMap[key].push(d.districtName);
    });
  });

  let duplicateCount = 0;
  Object.entries(cityMap).forEach(([city, districtNames]) => {
    if (districtNames.length > 1) {
      duplicateCount++;
    }
  });

  if (duplicateCount === 0) {
    console.log("✅ ZERO CROSS-DISTRICT DUPLICATES");
  } else {
    console.warn(`⚠️ Cross-district duplicates: ${duplicateCount}`);
  }

  const outputPath = path.join(ROOT, "data/finalCities.json");
  fs.writeFileSync(outputPath, JSON.stringify(finalOutput, null, 2));

  console.log("✅ FINAL DISTRICTS:", finalOutput.length);
  console.log("✅ OUTPUT:", outputPath);

  await mongoose.disconnect();
  console.log("🔌 DB Disconnected");
});