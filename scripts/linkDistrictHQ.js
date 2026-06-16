import mongoose from "mongoose";
import dotenv from "dotenv";

import District from "../models/District.js";
import City from "../models/City.js";

dotenv.config();

//////////////////////////////////////////////////////////////
// DB CONNECT
//////////////////////////////////////////////////////////////

const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ DB Connected");
};

//////////////////////////////////////////////////////////////
// MAIN
//////////////////////////////////////////////////////////////

const linkDistrictHQ = async () => {
  try {
    //////////////////////////////////////////////////////////
    // 1️⃣ FETCH ALL DATA (NO N+1)
    //////////////////////////////////////////////////////////

    const [districts, hqCities] = await Promise.all([
      District.find({
        isDeleted: false,
        stateRef: { $exists: true },
      }),

      City.find({
        isDistrictHQ: true,
        isDeleted: false,
      }),
    ]);

    //////////////////////////////////////////////////////////
    // 2️⃣ BUILD HQ MAP + MULTI HQ DETECTION
    //////////////////////////////////////////////////////////

    const hqMap = {}; // districtId -> city
    const multiHQDistricts = new Set();

    for (const city of hqCities) {
      const key = city.districtRef?.toString();

      if (!key) continue;

      if (hqMap[key]) {
        // 🚨 MULTIPLE HQ DETECTED
        multiHQDistricts.add(key);
      } else {
        hqMap[key] = city;
      }
    }

    //////////////////////////////////////////////////////////
    // 3️⃣ PROCESS DISTRICTS (BULK MODE)
    //////////////////////////////////////////////////////////

    const bulkOps = [];

    let updated = 0;
    let skipped = 0;
    let missingHQ = 0;
    let alreadyLinked = 0;

    for (const district of districts) {
      const districtId = district._id.toString();

      ////////////////////////////////////////////////////////
      // 🚨 MULTI HQ HARD BLOCK
      ////////////////////////////////////////////////////////

      if (multiHQDistricts.has(districtId)) {
        console.log(`🚨 MULTIPLE HQ DETECTED: ${district.name}`);
        continue;
      }

      ////////////////////////////////////////////////////////
      // 🔍 GET HQ
      ////////////////////////////////////////////////////////

      const hqCity = hqMap[districtId];

      if (!hqCity || !hqCity._id) {
        console.log(`⚠️ NO HQ CITY: ${district.name}`);
        missingHQ++;
        continue;
      }

      ////////////////////////////////////////////////////////
      // 🧠 CONSISTENCY CHECK
      ////////////////////////////////////////////////////////

      if (hqCity.districtRef.toString() !== districtId) {
        console.log(
          `❌ DATA MISMATCH: ${district.name} → ${hqCity.name}`
        );
        skipped++;
        continue;
      }

      ////////////////////////////////////////////////////////
      // ⏭️ ALREADY LINKED
      ////////////////////////////////////////////////////////

      if (
        district.hqCityRef &&
        district.hqCityRef.toString() === hqCity._id.toString()
      ) {
        alreadyLinked++;
        continue;
      }

      ////////////////////////////////////////////////////////
      // 🧱 BULK UPDATE PUSH
      ////////////////////////////////////////////////////////

      bulkOps.push({
        updateOne: {
          filter: { _id: district._id },
          update: {
            $set: {
              hqCityRef: hqCity._id,
            },
          },
        },
      });

      console.log(
        `🔗 LINK READY: ${district.name} → ${hqCity.name}`
      );

      updated++;
    }

    //////////////////////////////////////////////////////////
    // 4️⃣ EXECUTE BULK UPDATE
    //////////////////////////////////////////////////////////

    if (bulkOps.length > 0) {
      const result = await District.bulkWrite(bulkOps);

      console.log("\n🚀 BULK RESULT");
      console.log("Matched:", result.matchedCount);
      console.log("Modified:", result.modifiedCount);
    }

    //////////////////////////////////////////////////////////
    // 5️⃣ FINAL REPORT
    //////////////////////////////////////////////////////////

    console.log("\n==============================");
    console.log(`✅ Updated (Prepared): ${updated}`);
    console.log(`⏭️ Already Linked: ${alreadyLinked}`);
    console.log(`⚠️ Missing HQ: ${missingHQ}`);
    console.log(`❌ Skipped (Mismatch): ${skipped}`);
    console.log(
      `🚨 Multi HQ Districts: ${multiHQDistricts.size}`
    );
    console.log("==============================\n");

  } catch (error) {
    console.error("❌ ERROR:", error);
  } finally {
    //////////////////////////////////////////////////////////
    // 6️⃣ SAFE DISCONNECT
    //////////////////////////////////////////////////////////

    await mongoose.disconnect();
    console.log("🔌 DB Disconnected");
  }
};

//////////////////////////////////////////////////////////////
// RUN
//////////////////////////////////////////////////////////////

connectDB().then(linkDistrictHQ);