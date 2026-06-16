import mongoose from "mongoose";
import dotenv from "dotenv";
import Country from "../models/Country.js";

dotenv.config();

//////////////////////////////////////////////////////
// 🇮🇳 INDIA MASTER DATA (FINAL - PRODUCTION SAFE)
//////////////////////////////////////////////////////

const INDIA_DATA = {
  name: "INDIA",                 // ✅ clean format
  code: "IN",                   // ISO2
  iso3: "IND",                  // ISO3
  isoNumeric: 356,              // ISO numeric
  dialCode: "+91",
  currencyCode: "INR",
  currencyPrecision: 2,

  // ✅ FIXED (ARRAY)
  timezones: ["Asia/Kolkata"],

  // ✅ FIXED (REQUIRED + VALIDATED)
  centroid: {
    type: "Point",
    coordinates: [78.9629, 20.5937], // India center
  },

  continent: "ASIA",
  isActive: true,
  isDeleted: false,
};

//////////////////////////////////////////////////////
// 🚀 SEED SCRIPT (SAFE + IDEMPOTENT + UPDATE CAPABLE)
//////////////////////////////////////////////////////

const run = async () => {
  try {
    //--------------------------------------------------
    // ENV VALIDATION
    //--------------------------------------------------
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI not defined in environment");
    }

    //--------------------------------------------------
    // CONNECT DATABASE
    //--------------------------------------------------
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    });

    console.log("✅ Mongo Connected");

    //--------------------------------------------------
    // OPTIONAL: DEBUG CHECK (helps in production logs)
    //--------------------------------------------------
    const existing = await Country.findOne({ code: "IN", isDeleted: false });

    if (existing) {
      console.log("ℹ️ India already exists → updating");
    } else {
      console.log("➕ India not found → inserting");
    }

    //--------------------------------------------------
    // ✅ STRONG UPSERT (INSERT + UPDATE SAFE)
    //--------------------------------------------------
    await Country.updateOne(
      { code: "IN", isDeleted: false },
      { $set: INDIA_DATA }, // ✅ ensures fixes apply even if exists
      { upsert: true }
    );

    console.log("🔥 India seed completed successfully");

    //--------------------------------------------------
    // CLOSE CONNECTION
    //--------------------------------------------------
    await mongoose.connection.close();
    process.exit(0);

  } catch (err) {
    console.error("❌ Country Seed Failed:", err.message);

    try {
      await mongoose.connection.close();
    } catch (e) {}

    process.exit(1);
  }
};

run();