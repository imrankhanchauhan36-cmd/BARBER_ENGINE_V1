import dotenv from "dotenv";
import connectDB from "../../config/db.js";
import Pincode from "../../models/Pincode.js";

dotenv.config();

//////////////////////////////////////////////////////////////
// 🔒 SAFE INDEX CREATOR (IDEMPOTENT)
//////////////////////////////////////////////////////////////

const createIndexSafe = async (keys, options = {}) => {
  const existingIndexes = await Pincode.collection.indexes();

  const exists = existingIndexes.some(
    (idx) => JSON.stringify(idx.key) === JSON.stringify(keys)
  );

  if (exists) {
    console.log("⚠️ Skip:", keys);
    return;
  }

  await Pincode.collection.createIndex(keys, options);
  console.log("✅ Created:", keys);
};

//////////////////////////////////////////////////////////////
// 🚀 MAIN RUNNER
//////////////////////////////////////////////////////////////

const run = async () => {
  try {
    await connectDB();

    console.log("🚀 Index sync started...");
    const start = Date.now();

    //////////////////////////////////////////////////////////
    // 🔒 UNIQUE PINCODE
    //////////////////////////////////////////////////////////
    await createIndexSafe(
      { code: 1 },
      { unique: true, name: "uniq_pincode_code" }
    );

    //////////////////////////////////////////////////////////
    // 🌍 GEO INDEX
    //////////////////////////////////////////////////////////
    await createIndexSafe(
      { geo: "2dsphere" },
      { name: "geo_index" }
    );

    //////////////////////////////////////////////////////////
    // 📊 COMPOUND INDEXES (CORE PERFORMANCE)
    //////////////////////////////////////////////////////////

    // 🔥 State + City queries
    await createIndexSafe(
      { stateRef: 1, cityRef: 1, isActive: 1, isDeleted: 1 },
      { name: "idx_state_city_active" }
    );

    // 🔥 District queries
    await createIndexSafe(
      { districtRef: 1, isActive: 1, isDeleted: 1 },
      { name: "idx_district_active" }
    );

    //////////////////////////////////////////////////////////
    // 📊 FINAL LOG
    //////////////////////////////////////////////////////////
    const indexes = await Pincode.collection.indexes();

    console.log("\n📦 FINAL INDEXES:");
    indexes.forEach((idx) => {
      console.log(`• ${idx.name} =>`, idx.key);
    });

    console.log(
      "\n⏱ Time:",
      ((Date.now() - start) / 1000).toFixed(2),
      "sec"
    );

    process.exit(0);

  } catch (err) {
    console.error("❌ Index sync failed:", err.message);
    process.exit(1);
  }
};

run();