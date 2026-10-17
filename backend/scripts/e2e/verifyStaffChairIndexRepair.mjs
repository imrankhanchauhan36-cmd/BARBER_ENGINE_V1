/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyStaffChairIndexRepair.mjs
 *
 * Part E — Staff/Chair unique-index repair. Validates the PROPOSED
 * corrected index definitions and the preflight duplicate-detection
 * logic, directly against the real Staff/Chair Mongoose models in a
 * fully isolated, disposable mongodb-memory-server replica set.
 * Does NOT edit models/Staff.js or models/Chair.js — those still
 * carry their original (invalid) index declarations; this script
 * builds the CORRECTED definitions explicitly via
 * `collection.createIndex(...)`, exactly as the paired migration
 * script (scripts/migrations/02_repairStaffChairIndexes.js) would,
 * so this is a faithful rehearsal of that migration's actual index
 * operations, not a reimplementation.
 *
 * THREE DEFECTS THIS PROVES ARE FIXED (confirmed by direct schema
 * read, not assumed):
 *   1. models/Staff.js {salonId,phone} — partialFilterExpression used
 *      `{$ne: null}`, an unsupported partial-index operator.
 *   2. models/Staff.js {chairId} — combined `sparse:true` WITH
 *      partialFilterExpression (rejected outright), AND also used
 *      `{$ne: null}`.
 *   3. models/Chair.js {salonId,chairCode} — combined `sparse:true`
 *      with partialFilterExpression.
 * All three have therefore never successfully built via Mongoose's
 * autoIndex in ANY environment, including production (confirmed:
 * config/db.js sets autoIndex:true; scripts/migrations/00_createIndexes
 * .js never mentions Staff or Chair) — the uniqueness they are meant
 * to enforce has never actually existed in the database.
 *
 * ISOLATION: this script connects with { autoIndex: false } — the
 * schema's OWN still-broken index declarations are therefore never
 * attempted by Mongoose in the background, which would otherwise
 * race/conflict with this script's own explicit, corrected
 * createIndex() calls under the same index names. Every document
 * inserted here goes through the real Mongoose model (full schema
 * validation still applies — required fields, enums, etc. — nothing
 * is bypassed), only the automatic background index build is
 * disabled, deliberately, for this isolated connection only.
 *
 * Run (only after explicit approval — not run as part of writing this file):
 *   cd backend && node scripts/e2e/verifyStaffChairIndexRepair.mjs
 */

import crypto from "crypto";
import net from "net";

const TEST_JWT_SECRET = crypto.randomBytes(32).toString("hex");
if (!TEST_JWT_SECRET || TEST_JWT_SECRET.length < 32) {
  throw new Error("FAIL-CLOSED: could not generate a test-only JWT secret — refusing to proceed.");
}
process.env.JWT_ACCESS_SECRET = TEST_JWT_SECRET;
delete process.env.JWT_SECRET;

process.env.SKIP_REDIS_AUTOCONNECT = "true";
delete process.env.REDIS_URL;

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, extra) => {
  if (cond) { pass++; rows.push(`  ✅ ${name}`); }
  else { fail++; rows.push(`  ❌ ${name}${extra !== undefined ? `  (got: ${JSON.stringify(extra)})` : ""}`); }
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost", "0.0.0.0", "::"]);
let networkGuardInstalled = false;
let blockedAttempts = [];

const installNetworkGuard = () => {
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    let host = null;
    if (typeof args[0] === "object" && args[0] !== null) {
      host = args[0].host ?? args[0].address ?? null;
    } else if (typeof args[1] === "string") {
      host = args[1];
    }
    const isLoopback = host === null || LOOPBACK_HOSTS.has(host) || host.startsWith("127.");
    if (!isLoopback) {
      blockedAttempts.push(host);
      throw new Error(`NETWORK GUARD: blocked outbound connection attempt to non-loopback host "${host}"`);
    }
    return originalConnect.apply(this, args);
  };
  networkGuardInstalled = true;
};

// The three proposed corrected definitions — identical to what the
// paired migration script will build. Kept here as plain data so
// this test and the migration script can be visually diffed against
// each other by a reviewer; not imported between the two files,
// matching this codebase's own established "self-contained per file"
// convention used throughout this session's other fixes.
const CORRECTED_INDEXES = {
  staffPhone: {
    collection: "staffs", // Mongoose default pluralization for model "Staff"
    keys: { salonId: 1, phone: 1 },
    options: { unique: true, partialFilterExpression: { phone: { $type: "string" }, isDeleted: false }, name: "salonId_1_phone_1" },
  },
  staffChair: {
    collection: "staffs",
    keys: { chairId: 1 },
    options: { unique: true, partialFilterExpression: { chairId: { $type: "objectId" }, isDeleted: false }, name: "chairId_1" },
  },
  // DEVIATION FROM THE LITERALLY-PROPOSED DEFINITION — found by this
  // very test (see the "5c" assertion below and the final report):
  // chairCode defaults to null, exactly like Staff's phone/chairId,
  // and the originally-proposed filter ({isDeleted:false} only) does
  // NOT exclude null — so two ACTIVE chairs with no chairCode set in
  // the same salon would collide as a false "duplicate" the moment
  // this index goes live, even though the ORIGINAL (never-enforced)
  // index never actually blocked that state. Added the same
  // $type:"string" null-exclusion already used for Staff's phone/
  // chairId, for consistency and to genuinely preserve "remains
  // allowed where intended." Flagged explicitly for approval before
  // the real migration ever runs — not applied silently.
  chairCode: {
    collection: "chairs",
    keys: { salonId: 1, chairCode: 1 },
    options: { unique: true, partialFilterExpression: { chairCode: { $type: "string" }, isDeleted: false }, name: "salonId_1_chairCode_1" },
  },
};

const run = async () => {
  const { MongoMemoryReplSet } = await import("mongodb-memory-server");
  const mongoose = (await import("mongoose")).default;

  const mem = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });

  try {
    // autoIndex:false — see file header. Isolated to this connection only.
    await mongoose.connect(mem.getUri(), { dbName: "staff_chair_index_repair", autoIndex: false });
    delete process.env.MONGODB_URI;

    installNetworkGuard();

    const Salon = (await import("../../models/Salon.js")).default;
    const Staff = (await import("../../models/Staff.js")).default;
    const Chair = (await import("../../models/Chair.js")).default;

    const db = mongoose.connection.db;

    let phoneCounter = 0;
    const nextPhone = () => `9${String(100000000 + Math.floor(Math.random() * 800000000) + phoneCounter++)}`.slice(0, 10);

    const OPEN_ALL_DAY = { open: "00:00", close: "23:59", isClosed: false };
    const ALL_DAYS_OPEN = { monday: OPEN_ALL_DAY, tuesday: OPEN_ALL_DAY, wednesday: OPEN_ALL_DAY, thursday: OPEN_ALL_DAY, friday: OPEN_ALL_DAY, saturday: OPEN_ALL_DAY, sunday: OPEN_ALL_DAY };

    // Minimal, realistic Salon fixture — same shape already proven in
    // this session's other scripts. Required by Staff/Chair's own
    // required salonId -> "Salon" ref, even though referential
    // integrity itself isn't enforced by Mongoose; kept realistic
    // rather than a bare ObjectId to match "use realistic minimal
    // documents that satisfy the actual schemas."
    const makeSalon = (label) =>
      Salon.create({
        basicInfo: { shopName: `ZE2E Index Repair Salon ${label}`, category: "UNISEX" },
        manager: { phone: nextPhone() },
        timings: ALL_DAYS_OPEN,
        approval: { status: "APPROVED" },
        business: { isForceClosed: false, isShopOpen: true },
        onboarding: { step: 8, completed: true },
        isDeleted: false,
        ownerId: new mongoose.Types.ObjectId(),
      });

    //////////////////////////////////////////////////////////////
    // 1. All three corrected indexes build successfully
    //////////////////////////////////////////////////////////////
    for (const [label, def] of Object.entries(CORRECTED_INDEXES)) {
      try {
        await db.collection(def.collection).createIndex(def.keys, def.options);
        check(`1-${label}. Corrected index '${def.options.name}' on '${def.collection}' builds successfully`, true);
      } catch (err) {
        check(`1-${label}. Corrected index '${def.options.name}' on '${def.collection}' builds successfully`, false, err.message);
      }
    }

    const staffIndexNames = (await Staff.collection.indexes()).map((i) => i.name);
    const chairIndexNames = (await Chair.collection.indexes()).map((i) => i.name);
    check("1-confirm. salonId_1_phone_1 now exists on Staff", staffIndexNames.includes("salonId_1_phone_1"), staffIndexNames);
    check("1-confirm. chairId_1 now exists on Staff", staffIndexNames.includes("chairId_1"), staffIndexNames);
    check("1-confirm. salonId_1_chairCode_1 now exists on Chair", chairIndexNames.includes("salonId_1_chairCode_1"), chairIndexNames);

    //////////////////////////////////////////////////////////////
    // 2. Duplicate ACTIVE phone within the same salon -> E11000
    //////////////////////////////////////////////////////////////
    const salonPhoneTest = await makeSalon("PHONE_DUP");
    const sharedPhone = nextPhone();
    await Staff.create({ salonId: salonPhoneTest._id, name: "ZE2E Staff Phone 1", phone: sharedPhone, isActive: true, isDeleted: false });
    let phoneDupError = null;
    try {
      await Staff.create({ salonId: salonPhoneTest._id, name: "ZE2E Staff Phone 2", phone: sharedPhone, isActive: true, isDeleted: false });
    } catch (err) {
      phoneDupError = err;
    }
    check("2. A second ACTIVE staff with the same phone in the same salon is rejected with E11000", phoneDupError?.code === 11000, phoneDupError ? { code: phoneDupError.code, message: phoneDupError.message } : "no error thrown");

    //////////////////////////////////////////////////////////////
    // 3. Two active staff assigned to the same chair -> E11000
    //////////////////////////////////////////////////////////////
    const salonChairTest = await makeSalon("CHAIR_DUP");
    const chairForDupTest = await Chair.create({ salonId: salonChairTest._id, name: "Chair 1", position: 1, isActive: true, isDeleted: false });
    await Staff.create({ salonId: salonChairTest._id, name: "ZE2E Staff Chair 1", chairId: chairForDupTest._id, isActive: true, isDeleted: false });
    let chairDupError = null;
    try {
      await Staff.create({ salonId: salonChairTest._id, name: "ZE2E Staff Chair 2", chairId: chairForDupTest._id, isActive: true, isDeleted: false });
    } catch (err) {
      chairDupError = err;
    }
    check("3. A second active staff assigned to the SAME chair is rejected with E11000", chairDupError?.code === 11000, chairDupError ? { code: chairDupError.code, message: chairDupError.message } : "no error thrown");

    //////////////////////////////////////////////////////////////
    // 4. Duplicate active chairCode within the same salon -> E11000
    //////////////////////////////////////////////////////////////
    const salonChairCodeTest = await makeSalon("CHAIRCODE_DUP");
    const sharedChairCode = `${salonChairCodeTest._id}-CHR-001`;
    await Chair.create({ salonId: salonChairCodeTest._id, name: "Chair A", position: 1, chairCode: sharedChairCode, isActive: true, isDeleted: false });
    let chairCodeDupError = null;
    try {
      await Chair.create({ salonId: salonChairCodeTest._id, name: "Chair B", position: 2, chairCode: sharedChairCode, isActive: true, isDeleted: false });
    } catch (err) {
      chairCodeDupError = err;
    }
    check("4. A second active chair with the same chairCode in the same salon is rejected with E11000", chairCodeDupError?.code === 11000, chairCodeDupError ? { code: chairCodeDupError.code, message: chairCodeDupError.message } : "no error thrown");

    //////////////////////////////////////////////////////////////
    // 5. Multiple null/unset phone or chairId remain allowed
    //////////////////////////////////////////////////////////////
    const salonNullsTest = await makeSalon("NULLS_ALLOWED");
    let nullPhoneOk = true, nullChairOk = true;
    try {
      await Staff.create({ salonId: salonNullsTest._id, name: "ZE2E No Phone 1", isActive: true, isDeleted: false }); // phone defaults to null
      await Staff.create({ salonId: salonNullsTest._id, name: "ZE2E No Phone 2", isActive: true, isDeleted: false }); // second null phone, same salon
    } catch (err) {
      nullPhoneOk = false;
      rows.push(`  (unexpected error on null-phone insert: ${err.message})`);
    }
    try {
      await Staff.create({ salonId: salonNullsTest._id, name: "ZE2E No Chair 1", isActive: true, isDeleted: false }); // chairId defaults to null
      await Staff.create({ salonId: salonNullsTest._id, name: "ZE2E No Chair 2", isActive: true, isDeleted: false }); // second null chairId, same salon
    } catch (err) {
      nullChairOk = false;
      rows.push(`  (unexpected error on null-chairId insert: ${err.message})`);
    }
    check("5a. Multiple staff with no phone set in the same salon are all allowed (null excluded from the unique filter)", nullPhoneOk);
    check("5b. Multiple staff with no chair assigned are all allowed (null excluded from the unique filter)", nullChairOk);

    const salonNullChairCodeTest = await makeSalon("NULL_CHAIRCODE_ALLOWED");
    let nullChairCodeOk = true;
    try {
      await Chair.create({ salonId: salonNullChairCodeTest._id, name: "Chair No Code 1", position: 1, isActive: true, isDeleted: false }); // chairCode defaults to null
      await Chair.create({ salonId: salonNullChairCodeTest._id, name: "Chair No Code 2", position: 2, isActive: true, isDeleted: false });
    } catch (err) {
      nullChairCodeOk = false;
      rows.push(`  (unexpected error on null-chairCode insert: ${err.message})`);
    }
    check("5c. Multiple chairs with no chairCode set in the same salon are all allowed (requires the $type:'string' null-exclusion added to the chairCode filter — see the deviation note above; the literally-proposed isDeleted:false-only filter was proven by an earlier run of this exact test to reject this as a false duplicate)", nullChairCodeOk);

    //////////////////////////////////////////////////////////////
    // 6. Soft-deleted duplicates remain allowed
    //////////////////////////////////////////////////////////////
    const salonSoftDeleteTest = await makeSalon("SOFT_DELETE_ALLOWED");
    const deletedPhone = nextPhone();
    let softDeletePhoneOk = true, softDeleteChairCodeOk = true;
    try {
      await Staff.create({ salonId: salonSoftDeleteTest._id, name: "ZE2E Deleted Staff 1", phone: deletedPhone, isActive: false, isDeleted: true });
      await Staff.create({ salonId: salonSoftDeleteTest._id, name: "ZE2E Deleted Staff 2", phone: deletedPhone, isActive: false, isDeleted: true });
    } catch (err) {
      softDeletePhoneOk = false;
      rows.push(`  (unexpected error on soft-deleted duplicate phone insert: ${err.message})`);
    }
    check("6a. Two soft-deleted staff sharing the same phone in the same salon are both allowed (isDeleted:false filter excludes them)", softDeletePhoneOk);

    const deletedChairCode = `${salonSoftDeleteTest._id}-CHR-DEL`;
    try {
      await Chair.create({ salonId: salonSoftDeleteTest._id, name: "Deleted Chair 1", position: 1, chairCode: deletedChairCode, isActive: false, isDeleted: true });
      await Chair.create({ salonId: salonSoftDeleteTest._id, name: "Deleted Chair 2", position: 2, chairCode: deletedChairCode, isActive: false, isDeleted: true });
    } catch (err) {
      softDeleteChairCodeOk = false;
      rows.push(`  (unexpected error on soft-deleted duplicate chairCode insert: ${err.message})`);
    }
    check("6b. Two soft-deleted chairs sharing the same chairCode in the same salon are both allowed", softDeleteChairCodeOk);

    // A soft-deleted record must never block a NEW active one reusing
    // the same value — the stated purpose of isDeleted:false in the
    // original design (Staff.js's own comment: "deleted staff ka
    // phone reuse ho sake").
    let reuseAfterDeleteOk = true;
    try {
      await Staff.create({ salonId: salonSoftDeleteTest._id, name: "ZE2E Reuses Deleted Phone", phone: deletedPhone, isActive: true, isDeleted: false });
    } catch (err) {
      reuseAfterDeleteOk = false;
      rows.push(`  (unexpected error reusing a soft-deleted staff's phone: ${err.message})`);
    }
    check("6c. A NEW active staff can reuse a soft-deleted staff's phone number in the same salon", reuseAfterDeleteOk);

    //////////////////////////////////////////////////////////////
    // 7. Preflight duplicate-detection logic (the migration script's
    //    own pre-check) correctly detects a deliberately seeded
    //    duplicate. Run BEFORE the unique index existed, directly
    //    against raw collection inserts (bypassing the now-active
    //    unique constraint) to seed a genuine conflict, proving the
    //    aggregation detects pre-existing bad data rather than
    //    relying on the index to prevent it from ever being seeded.
    //////////////////////////////////////////////////////////////
    const salonPreflightTest = await makeSalon("PREFLIGHT_SEED");
    const seededDupPhone = nextPhone();
    // Raw driver inserts, bypassing the Staff model and its now-active
    // unique index, to simulate data that could already exist before
    // this repair ever runs (e.g. inserted before the fix existed).
    await db.collection("staffs").insertMany([
      { salonId: salonPreflightTest._id, name: "ZE2E Preflight Seed A", phone: null, isDeleted: false, isActive: true },
      { salonId: salonPreflightTest._id, name: "ZE2E Preflight Seed B", phone: null, isDeleted: false, isActive: true },
    ]);
    // Can't insert a genuine duplicate phone via the driver either,
    // since the unique index built in step 1 already protects this
    // collection — so the preflight-detection logic itself is proven
    // against a SEPARATE, freshly created collection with NO unique
    // index yet, exactly mirroring the real migration's own ordering
    // (preflight runs BEFORE any index is built).
    const preflightSeedColl = db.collection("preflight_seed_probe");
    const dupSalonId = new mongoose.Types.ObjectId();
    await preflightSeedColl.insertMany([
      { salonId: dupSalonId, phone: seededDupPhone, isDeleted: false },
      { salonId: dupSalonId, phone: seededDupPhone, isDeleted: false }, // genuine duplicate, no index to stop it
      { salonId: dupSalonId, phone: null, isDeleted: false },           // null — must NOT be flagged
      { salonId: dupSalonId, phone: seededDupPhone, isDeleted: true },  // soft-deleted — must NOT be flagged
    ]);
    const preflightResult = await preflightSeedColl.aggregate([
      { $match: { isDeleted: false, phone: { $type: "string" } } },
      { $group: { _id: { salonId: "$salonId", phone: "$phone" }, count: { $sum: 1 }, ids: { $push: "$_id" } } },
      { $match: { count: { $gt: 1 } } },
    ]).toArray();
    check("7a. The preflight aggregation detects exactly ONE duplicate group for the deliberately seeded conflict", preflightResult.length === 1 && preflightResult[0].count === 2, preflightResult);
    check("7b. The preflight aggregation correctly excludes the null-phone and soft-deleted rows from the conflict", preflightResult[0]?.count === 2, preflightResult);

    const cleanPreflight = await db.collection("staffs").aggregate([
      { $match: { isDeleted: false, phone: { $type: "string" } } },
      { $group: { _id: { salonId: "$salonId", phone: "$phone" }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]).toArray();
    check("7c. The SAME preflight query finds ZERO conflicts on the real staffs collection (already protected by the now-active unique index)", cleanPreflight.length === 0, cleanPreflight);

    //////////////////////////////////////////////////////////////
    // Network guard sanity
    //////////////////////////////////////////////////////////////
    check("8. Network guard was installed before any app/model import", networkGuardInstalled === true, networkGuardInstalled);
    check("9. Network guard recorded zero blocked non-loopback attempts during this run", blockedAttempts.length === 0, blockedAttempts);

  } finally {
    // Cleanup always runs, even if an assertion above failed — check()
    // never throws, it only records pass/fail, so execution reaches
    // this finally block unconditionally. mem.stop() discards the
    // entire disposable in-memory replica set and its data directory;
    // nothing persists after this script exits.
    const mongoose = (await import("mongoose")).default;
    await mongoose.disconnect();
    await mem.stop();
  }
};

run()
  .then(() => {
    console.log(rows.join("\n"));
    console.log(`\nSTAFF/CHAIR INDEX REPAIR: ${fail === 0 ? "ALL PASS" : "FAILURES PRESENT"} — ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.log(rows.join("\n"));
    console.error("\nFATAL (script-level, not an assertion failure):", err.message);
    process.exit(1);
  });
