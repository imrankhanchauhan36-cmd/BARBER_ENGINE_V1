import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import Country from "../models/Country.js";
import State from "../models/State.js";
import District from "../models/District.js";
import Assembly from "../models/Assembly.js";
import Pincode from "../models/Pincode.js";

//////////////////////////////////////////////////////
// LOAD ENV (ESM SAFE)
//////////////////////////////////////////////////////

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.resolve(__dirname, "../.env"),
});

//////////////////////////////////////////////////////
// VALIDATE ENV
//////////////////////////////////////////////////////

if (!process.env.MONGODB_URI) {
  console.error("❌ MONGODB_URI is missing in backend/.env file");
  process.exit(1);
}

//////////////////////////////////////////////////////
// CONNECT DATABASE
//////////////////////////////////////////////////////

await mongoose.connect(process.env.MONGODB_URI);

console.log("✅ MongoDB connected");

//////////////////////////////////////////////////////

const run = async () => {
  try {

    //////////////////////////////////////////////////////
    // 1️⃣ LOAD BASE HIERARCHY (SAFE)
    //////////////////////////////////////////////////////

    const country = await Country.findOne({
      name: { $regex: "^india$", $options: "i" },
      isDeleted: false,
    });

    if (!country) {
      console.log("❌ Country not found");
      process.exit(1);
    }

    const state = await State.findOne({
      name: { $regex: "^uttar pradesh$", $options: "i" },
      countryRef: country._id,
      isDeleted: false,
    });

    if (!state) {
      console.log("❌ State not found");
      process.exit(1);
    }

    const district = await District.findOne({
      name: { $regex: "^gautam buddha nagar$", $options: "i" },
      stateRef: state._id,
      countryRef: country._id,
      isDeleted: false,
    });

    if (!district) {
      console.log("❌ District not found");
      process.exit(1);
    }

    //////////////////////////////////////////////////////
    // 2️⃣ UPSERT ASSEMBLY
    //////////////////////////////////////////////////////

    const assembly = await Assembly.findOneAndUpdate(
      {
        name: "NOIDA",
        districtRef: district._id,
      },
      {
        $set: {
          code: "UP-NOIDA",
          countryRef: country._id,
          stateRef: state._id,
          districtRef: district._id,
          geo: {
            type: "Point",
            coordinates: [77.3910, 28.5355], // [lng, lat]
          },
          isActive: true,
          isDeleted: false,
        },
      },
      {
        new: true,
        upsert: true,
      }
    );

    console.log("✅ Assembly ready:", assembly.name);

    //////////////////////////////////////////////////////
    // 3️⃣ UPSERT PINCODE
    //////////////////////////////////////////////////////

    const pincode = await Pincode.findOneAndUpdate(
      { code: "201301" },
      {
        $set: {
          countryRef: country._id,
          stateRef: state._id,
          districtRef: district._id,
          assemblyRef: assembly._id,
          isActive: true,
          isDeleted: false,
        },
      },
      {
        new: true,
        upsert: true,
      }
    );

    console.log("✅ Pincode ready:", pincode.code);

    //////////////////////////////////////////////////////
    // DONE
    //////////////////////////////////////////////////////

    console.log("🎉 Seed completed successfully");
    process.exit(0);

  } catch (error) {
    console.error("❌ Seed error:", error);
    process.exit(1);
  }
};

run();