import mongoose from "mongoose";
import dotenv from "dotenv";

import District from "../models/District.js";
import City from "../models/City.js";

dotenv.config();

//////////////////////////////////////////////////////////////
// NORMALIZE
//////////////////////////////////////////////////////////////

const normalize = (str) =>
  str?.toLowerCase().replace(/[^a-z0-9]/g, "") || "";

//////////////////////////////////////////////////////////////
// MANUAL ALIAS MAP (IMPORTANT FOR INDIA)
//////////////////////////////////////////////////////////////

const aliasMap = {
  "north goa": ["northgoa", "n goa"],
  "south goa": ["southgoa", "s goa"],
  "dadra and nagar haveli": ["dn havel i", "dadra nagar haveli"],
  "north and middle andaman": ["north middle andaman"],
  "south andaman": ["southandaman"],
};

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

const updateDistrictMeta = async () => {
  try {
    const districts = await District.find({ isDeleted: false });

    let updated = 0;
    let missingHQ = 0;

    for (const district of districts) {
      const name = district.name?.trim();

      if (!name) continue;

      ////////////////////////////////////////////////////////
      // NORMALIZED NAME
      ////////////////////////////////////////////////////////

      const normalized = normalize(name);

      ////////////////////////////////////////////////////////
      // BUILD ALIASES
      ////////////////////////////////////////////////////////

      let aliases = [];
      let normalizedAliases = [];

      // manual aliases
      if (aliasMap[normalized]) {
        aliases = aliasMap[normalized];
      }

      normalizedAliases = aliases.map((a) => normalize(a));

      ////////////////////////////////////////////////////////
      // FIND HQ CITY
      ////////////////////////////////////////////////////////

      const hqCity = await City.findOne({
        districtRef: district._id,
        isDistrictHQ: true,
      });

      if (!hqCity) {
        console.log(`⚠️ HQ NOT FOUND: ${name}`);
        missingHQ++;
        continue;
      }

      ////////////////////////////////////////////////////////
      // UPDATE
      ////////////////////////////////////////////////////////

      await District.updateOne(
        { _id: district._id },
        {
          $set: {
            aliases,
            normalizedAliases,
            hqCityName: hqCity.name,
          },
        }
      );

      console.log(`✅ UPDATED: ${name} → HQ: ${hqCity.name}`);
      updated++;
    }

    //////////////////////////////////////////////////////////
    // FINAL LOG
    //////////////////////////////////////////////////////////

    console.log("\n========================");
    console.log(`✅ Updated: ${updated}`);
    console.log(`⚠️ Missing HQ: ${missingHQ}`);
    console.log("========================\n");

  } catch (error) {
    console.error("❌ ERROR:", error);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 DB Disconnected");
  }
};

//////////////////////////////////////////////////////////////
// RUN
//////////////////////////////////////////////////////////////

connectDB().then(updateDistrictMeta);