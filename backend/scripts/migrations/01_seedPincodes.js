import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import fs from "fs";
import readline from "readline";
import mongoose from "mongoose";

import connectDB from "../../config/db.js";
import Pincode from "../../models/Pincode.js";
import District from "../../models/District.js";
import State from "../../models/State.js";
import City from "../../models/City.js";
import Country from "../../models/Country.js";

//////////////////////////////////////////////////////////////
// PATH SETUP
//////////////////////////////////////////////////////////////

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

//////////////////////////////////////////////////////////////
// CONFIG
//////////////////////////////////////////////////////////////

const FILE_PATH = path.resolve(__dirname, "../data/IN.txt");
const BATCH_SIZE = 500;

//////////////////////////////////////////////////////////////
// NORMALIZE
// IN.txt col 4 = state name: "Andaman & Nicobar Islands"
// DB state name: "ANDAMAN AND NICOBAR ISLANDS"
// After normalize both → "andamannicobarislands" ✅
//////////////////////////////////////////////////////////////

// District alias map — GeoNames name → DB normalized name
// Fixes all 83 known mismatches
const DISTRICT_ALIAS = {
  // Renamed districts
  "allahabad":          "prayagraj",
  "bengaluru":          "bangalore",
  "gurgaon":            "gurugram",
  "museabad":           "musaffarabad",
  "burdwan":            "purba bardhaman",
  "faizabad":           "ayodhya",
  "cuddapah":           "ysr",

  // State suffix removals (BH=Bihar, CGH=Chhattisgarh, HP=HimachalPradesh)
  "aurangabadbh":       "aurangabad",
  "bilaspurcgh":        "bilaspur",
  "bilaspurhp":         "bilaspur",
  "bijapurcgh":         "bijapur",
  "bijapurkar":         "vijayapura",
  "hamirpurhp":         "hamirpur",
  "hamirpurup":         "hamirpur",
  "practapgarhup":      "pratapgarh",

  // Remaining 17 — final batch
  "bilaspurhp":         "bilaspur",
  "eastsikkim":         "east sikkim",
  "gomti":              "gomati",
  "hamirpurhp":         "hamirpur",
  "jaribam":            "jiribam",
  "jayashankar":        "jayashankar bhupalpally",
  "kawardha":           "kabirdham",
  "medinipur":          "paschim medinipur",
  "nabarangapur":       "nabarangpur",
  "northsikkim":        "north sikkim",
  "raigarmh":           "raigad",
  "sainkheda":          "sainkheda",
  "santravidasnagar":   "sant ravidas nagar",
  "sonapur":            "subarnapur",
  "southdinajpur":      "dakshin dinajpur",
  "southsikkim":        "south sikkim",
  "westnimar":          "khandwa",
  "anantnag":           "anantnag",
  "bagpat":             "baghpat",
  "baleswar":           "baleshwar",
  "bandipur":           "bandipore",
  "bangalorerural":     "bangalore rural",
  "chamrajnagar":       "chamarajanagar",
  "dadranagarhaveli":   "dadra and nagar haveli",
  "darjiling":          "darjeeling",
  "davangere":          "davanagere",
  "debagarh":           "deogarh",
  "eastmidnapore":      "purba medinipur",
  "eastnimar":          "khandwa",
  "eastsikkim":         "east sikkim",
  "firozpur":           "ferozepur",
  "giridh":             "giridih",
  "gomti":              "gomati",
  "hazaribag":          "hazaribagh",
  "hoshangabad":        "narmadapuram",
  "kaimur":             "kaimur bhabua",
  "kangra":             "kangra",
  "koraput":            "koraput",
  "lakhimpur":          "lakhimpur kheri",
  "malkangiri":         "malkangiri",
  "medak":              "medak",
  "midnaporewest":      "paschim medinipur",
  "muzaffarnagar":      "muzaffarnagar",
  "nawadah":            "nawada",
  "northandmiddleandaman": "north and middle andaman",
  "northsikkim":        "north sikkim",
  "pashchimchamparan":  "west champaran",
  "purvachamparan":     "east champaran",
  "raigarhmh":          "raigad",
  "raigarhcgh":         "raigarh",
  "rohtas":             "rohtas",
  "sahibganj":          "sahibganj",
  "saraikela":          "saraikela kharsawan",
  "sibsagar":           "sivasagar",
  "singhbhum":          "east singhbhum",
  "southsikkim":        "south sikkim",
  "sundargarh":         "sundergarh",
  "supaul":             "supaul",
  "tinsukia":           "tinsukia",
  "visakhapatanam":     "visakhapatnam",
  "westsikkim":         "west sikkim",
  "yanam":              "yanam",
};

const normalize = (str) => {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/district/g, "")
    .replace(/city/g, "")
    .replace(/[^a-z0-9]/g, "");
};

//////////////////////////////////////////////////////////////
// BULK EXECUTOR
//////////////////////////////////////////////////////////////

const executeBulk = async (ops) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await Pincode.bulkWrite(ops, { ordered: false });
      return;
    } catch (err) {
      console.warn(`⚠️ Bulk retry ${attempt}/3`);
      if (attempt === 3) throw err;
    }
  }
};

//////////////////////////////////////////////////////////////
// MAIN
//////////////////////////////////////////////////////////////

const run = async () => {
  try {
    console.log("🔗 Connecting to DB...");
    await connectDB();
    console.log("✅ DB Connected");

    //////////////////////////////////////////////////////////
    // PRELOAD INTO MEMORY
    //////////////////////////////////////////////////////////

    console.log("📦 Loading master data...");

    const country = await Country.findOne({ code: "IN" }).lean();
    if (!country) throw new Error("❌ Country IN not found");

    const states    = await State.find({ isDeleted: false }).lean();
    const districts = await District.find({ isDeleted: false }).lean();
    const cities    = await City.find({ isDeleted: false }).lean();

    //////////////////////////////////////////////////////////
    // STATE MAP — normalized name → state
    // Also build array for fuzzy fallback
    //////////////////////////////////////////////////////////

    const stateMap = new Map();
    states.forEach((s) => {
      stateMap.set(normalize(s.name), s);
    });

    //////////////////////////////////////////////////////////
    // DISTRICT MAP
    // PRIMARY: admin2Code_stateId (col[6] from IN.txt — exact match)
    // FALLBACK: normalizedName_stateId
    //////////////////////////////////////////////////////////

    const districtMap = new Map();     // admin2Code_stateId → district
    const districtNameMap = new Map(); // normalizedName_stateId → district

    districts.forEach((d) => {
      if (!d.stateRef) return;
      const stateId = d.stateRef.toString();

      if (d.admin2Code) {
        // strip leading zeros: "001" → "1", "638" → "638"
        const cleanCode = String(d.admin2Code).replace(/^0+/, "").trim();
        districtMap.set(`${cleanCode}_${stateId}`, d);
      }

      districtNameMap.set(`${normalize(d.name)}_${stateId}`, d);
    });

    //////////////////////////////////////////////////////////
    // CITY MAP — normalizedName_districtId → city
    //////////////////////////////////////////////////////////

    const cityMap = new Map();
    cities.forEach((c) => {
      if (!c.districtRef) return;
      const key = `${normalize(c.name)}_${c.districtRef.toString()}`;
      cityMap.set(key, c);
    });

    // HQ city map — districtId → HQ city (guaranteed fallback)
    const hqCityMap = new Map();
    cities.forEach((c) => {
      if (c.isDistrictHQ && c.districtRef) {
        hqCityMap.set(c.districtRef.toString(), c);
      }
    });

    console.log(`✅ States:    ${states.length}`);
    console.log(`✅ Districts: ${districts.length}`);
    console.log(`✅ Cities:    ${cities.length}`);
    console.log(`✅ HQ Cities: ${hqCityMap.size}`);

    //////////////////////////////////////////////////////////
    // FILE CHECK
    //////////////////////////////////////////////////////////

    if (!fs.existsSync(FILE_PATH)) {
      throw new Error(`❌ NOT FOUND: ${FILE_PATH}`);
    }

    console.log("📂 Streaming IN.txt...");

    // IN.txt column map (0-indexed after tab split):
    // 0=country 1=pincode 2=placeName 3=stateName 4=stateCode
    // 5=districtName 6=districtCode 7=subDistrict 8=subDistrictCode
    // 9=lat 10=lng 11=accuracy

    const rl = readline.createInterface({
      input: fs.createReadStream(FILE_PATH),
      crlfDelay: Infinity,
    });

    //////////////////////////////////////////////////////////
    // STATS
    //////////////////////////////////////////////////////////

    let bulkOps         = [];
    let processed       = 0;
    let skipped         = 0;
    let missingState    = 0;
    let missingDistrict = 0;
    let missingCity     = 0;
    let invalidGeo      = 0;

    //////////////////////////////////////////////////////////
    // PROCESS LINES
    //////////////////////////////////////////////////////////

    for await (const line of rl) {
      try {
        if (!line.trim()) continue;

        const cols = line.split("\t");
        if (cols.length < 10) { skipped++; continue; }

        const pincode      = cols[1]?.trim();
        const placeName    = cols[2]?.trim();
        const stateName    = cols[3]?.trim();   // "Andaman & Nicobar Islands"
        const districtName = cols[5]?.trim();   // "Nicobar"
        const lat          = parseFloat(cols[9]);
        const lng          = parseFloat(cols[10]);

        //////////////////////////////////////////////////////
        // PINCODE VALIDATION
        //////////////////////////////////////////////////////

        if (!pincode || pincode.length !== 6 || !/^[1-9][0-9]{5}$/.test(pincode)) {
          skipped++;
          continue;
        }

        //////////////////////////////////////////////////////
        // GEO VALIDATION
        //////////////////////////////////////////////////////

        if (
          isNaN(lat) || isNaN(lng) ||
          lat < -90  || lat > 90   ||
          lng < -180 || lng > 180  ||
          (lat === 0 && lng === 0)
        ) {
          invalidGeo++;
          skipped++;
          continue;
        }

        //////////////////////////////////////////////////////
        // STATE MATCH
        // Primary: exact normalized match
        // Fallback: partial match (handles abbreviations)
        //////////////////////////////////////////////////////

        const normStateName = normalize(stateName);
        let state = stateMap.get(normStateName);

        if (!state) {
          state = states.find((s) => {
            const ns = normalize(s.name);
            return ns.includes(normStateName) || normStateName.includes(ns);
          });
        }

        if (!state) {
          missingState++;
          skipped++;
          continue;
        }

        //////////////////////////////////////////////////////
        // DISTRICT MATCH — 3 level priority
        // 1. admin2Code exact (99% reliable)
        // 2. alias + normalized name exact (90%)
        // 3. partial name fallback
        //////////////////////////////////////////////////////

        const stateId = state._id.toString();

        // Step 1 — admin2Code PRIMARY (strip leading zeros to match DB)
        const districtCode = String(cols[6] || "").replace(/^0+/, "").trim();
        let district = districtMap.get(`${districtCode}_${stateId}`);

        // Step 2 — alias + exact name match
        if (!district) {
          const normDistRaw  = normalize(districtName);
          const normDistName = DISTRICT_ALIAS[normDistRaw]
            ? normalize(DISTRICT_ALIAS[normDistRaw])
            : normDistRaw;
          district = districtNameMap.get(`${normDistName}_${stateId}`);

          // Step 3 — partial name fallback
          if (!district) {
            district = districts.find((d) => {
              if (d.stateRef?.toString() !== stateId) return false;
              const nd = normalize(d.name);
              return nd.includes(normDistName) || normDistName.includes(nd);
            });
          }
        }

        if (!district) {
          missingDistrict++;
          skipped++;
          continue;
        }

        //////////////////////////////////////////////////////
        // CITY MATCH — 3 levels
        // L1: exact place name
        // L2: partial name match
        // L3: district HQ (guaranteed)
        //////////////////////////////////////////////////////

        const districtId = district._id.toString();
        const normPlace  = normalize(placeName);

        // Level 1 — exact normalized name match
        let city = cityMap.get(`${normPlace}_${districtId}`);

        // Level 2 — partial name match
        if (!city) {
          city = cities.find(
            (c) =>
              c.districtRef?.toString() === districtId &&
              normalize(c.name).includes(normPlace)
          );
        }

        // Level 3 — geo nearest city within district
        if (!city) {
          let minDist = Infinity;
          for (const c of cities) {
            if (c.districtRef?.toString() !== districtId) continue;
            if (!c.geo?.coordinates) continue;
            const [cLng, cLat] = c.geo.coordinates;
            const d = Math.sqrt((cLat - lat) ** 2 + (cLng - lng) ** 2);
            if (d < minDist) {
              minDist = d;
              city = c;
            }
          }
        }

        // Level 4 — district HQ fallback (guaranteed)
        if (!city) {
          city = hqCityMap.get(districtId);
        }

        if (!city) {
          missingCity++;
          skipped++;
          continue;
        }

        //////////////////////////////////////////////////////
        // BUILD BULK OP
        //////////////////////////////////////////////////////

        bulkOps.push({
          updateOne: {
            filter: { code: pincode },
            update: {
              $set: {
                name:        placeName,
                countryRef:  country._id,
                stateRef:    state._id,
                districtRef: district._id,
                cityRef:     city._id,
                geo: {
                  type:        "Point",
                  coordinates: [lng, lat],
                },
                isActive:  true,
                isDeleted: false,
                updatedAt: new Date(),
              },
              $setOnInsert: {
                code:      pincode,
                createdAt: new Date(),
              },
            },
            upsert: true,
          },
        });

        processed++;

        if (bulkOps.length >= BATCH_SIZE) {
          await executeBulk(bulkOps);
          bulkOps = [];
          console.log(`⚡ Processed: ${processed} | Skipped: ${skipped} | MissingDistrict: ${missingDistrict}`);
        }

      } catch (err) {
        console.error("❌ Row error:", err.message);
        skipped++;
      }
    }

    if (bulkOps.length > 0) await executeBulk(bulkOps);

    //////////////////////////////////////////////////////////
    // FINAL REPORT
    //////////////////////////////////////////////////////////

    const totalPincodes = await Pincode.countDocuments();

    console.log("\n🎉 PINCODE SEED COMPLETE");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`✅ Processed:        ${processed}`);
    console.log(`⏭️  Skipped:          ${skipped}`);
    console.log(`❌ Missing State:    ${missingState}`);
    console.log(`❌ Missing District: ${missingDistrict}`);
    console.log(`❌ Missing City:     ${missingCity}`);
    console.log(`❌ Invalid Geo:      ${invalidGeo}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`📦 Total in DB:      ${totalPincodes}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    await mongoose.connection.close();
    console.log("🔌 DB Disconnected");
    process.exit(0);

  } catch (err) {
    console.error("❌ SEED FAILED:", err.message);
    process.exit(1);
  }
};

run();