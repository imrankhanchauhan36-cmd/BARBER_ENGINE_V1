/**
 * BARBER_ENGINE_V1
 * backend/scripts/migrations/01_createFraudDetectionIndexes.js
 *
 * FA-7.2 — standalone, manually-run, idempotent index migration.
 * Follows the exact established precedent of
 * scripts/migrations/00_createIndexes.js: creates an index directly
 * against the target collection via `Model.collection.createIndex()`,
 * entirely independent of that model's own Mongoose schema
 * declarations. This is the mechanism that lets FA-7.2 add the one
 * index its REFERRAL_VELOCITY detector needs WITHOUT modifying the
 * frozen backend/modules/fieldAgent/models/AcquisitionReferral.js —
 * AcquisitionReferral is imported here ONLY to obtain a handle on its
 * underlying MongoDB collection, never to change its schema.
 *
 * Per the FA-7.2 index-boundary investigation: {createdAt:1} alone is
 * the correct index — a compound {createdAt:1,fieldAgentRef:1} was
 * evaluated and rejected (the detector's $match filters only on
 * createdAt; grouping by fieldAgentRef in the $group stage gets no
 * benefit from a second index key, since the index's sort order
 * doesn't align with the grouping key either way).
 *
 * NOT wired into server.js startup — run manually, once, before
 * enabling the detection job in an environment.
 *
 * Run:
 *   cd backend
 *   node scripts/migrations/01_createFraudDetectionIndexes.js
 */

import dotenv from "dotenv";
import connectDB from "../../config/db.js";
import AcquisitionReferral from "../../modules/fieldAgent/models/AcquisitionReferral.js";

dotenv.config();

const INDEX_NAME = "idx_createdAt_fa72";

//////////////////////////////////////////////////////////////
// 🔒 SAFE INDEX CREATOR (IDEMPOTENT) — mirrors 00_createIndexes.js
//////////////////////////////////////////////////////////////

const createIndexSafe = async (keys, options = {}) => {
  const existingIndexes = await AcquisitionReferral.collection.indexes();

  const exists = existingIndexes.some(
    (idx) => JSON.stringify(idx.key) === JSON.stringify(keys)
  );

  if (exists) {
    console.log("⚠️ Skip (equivalent key shape already exists):", keys);
    return;
  }

  await AcquisitionReferral.collection.createIndex(keys, options);
  console.log("✅ Created:", keys, options);
};

//////////////////////////////////////////////////////////////
// 🚀 MAIN RUNNER
//////////////////////////////////////////////////////////////

const run = async () => {
  try {
    await connectDB();

    console.log("🚀 FA-7.2 index migration started...");
    const start = Date.now();

    //////////////////////////////////////////////////////////
    // ⚡ REFERRAL_VELOCITY DETECTOR SUPPORT INDEX
    //////////////////////////////////////////////////////////
    await createIndexSafe(
      { createdAt: 1 },
      { name: INDEX_NAME }
    );

    //////////////////////////////////////////////////////////
    // 📊 FINAL LOG
    //////////////////////////////////////////////////////////
    const indexes = await AcquisitionReferral.collection.indexes();

    console.log("\n📦 FINAL INDEXES on AcquisitionReferral:");
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
    console.error("❌ Index migration failed:", err.message);
    process.exit(1);
  }
};

run();
