/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyAreaCurationEngine.js
 *
 * AREA-2.2 — LIVE, real-HTTP, real-DB verification for
 * curateAreaAligarh.js. Same precedent as every other verify script:
 * real Express app, real signed JWTs, real MongoDB Atlas, no mocks.
 *
 * Most checks run against ISOLATED FIXTURE geography (prefixed
 * "ZTEST_AREA22_"), never the real Aligarh City — this proves the
 * engine's classification/import/concurrency/idempotency logic
 * without ever touching production Aligarh data. Exactly one section
 * exercises the real, locked Aligarh scope end-to-end (via the actual
 * CLI, --import --confirm, with obviously-fake ZTEST-prefixed names)
 * to prove the real path works — those Area documents (and nothing
 * else) are hard-deleted in cleanup. No pre-existing Area is ever
 * touched, and no real Aligarh locality name is ever created.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyAreaCurationEngine.js
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import Country from "../models/Country.js";
import State from "../models/State.js";
import District from "../models/District.js";
import City from "../models/City.js";
import Area from "../models/Area.js";
import AdminAuditLog from "../models/AdminAuditLog.js";
import { generateAccessToken } from "../services/token.service.js";
import {
  normalize,
  loadAndGateInput,
  resolveLockedScope,
  classifyRows,
  buildReport,
  importValidNew,
  ConfigError,
} from "./curateAreaAligarh.js";

const execFileAsync = promisify(execFile);

let pass = 0;
let fail = 0;
const results = [];
const check = (name, condition, detail) => {
  if (condition) { pass += 1; results.push(`✅ ${name}`); }
  else { fail += 1; results.push(`❌ ${name}${detail ? " — " + String(detail).slice(0, 300) : ""}`); }
};

let phoneSeq = 0;
const nextPhone = () => `9999909${String(phoneSeq++).padStart(3, "0")}`;
const NAME_PREFIX = "ZTEST_AREA22_";

const createdUserIds = [];
const createdStateIds = [];
const createdDistrictIds = [];
const createdCityIds = [];
const createdAreaIds = [];
const tmpFiles = [];

const writeTmpJson = (data) => {
  const p = path.join(os.tmpdir(), `area22_test_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(data));
  tmpFiles.push(p);
  return p;
};

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;

  const preCleanup = async () => {
    const staleUsers = await User.find({ phone: { $regex: /^9999909\d{3}$/ } }).select("_id").lean();
    if (staleUsers.length) await User.deleteMany({ _id: { $in: staleUsers.map((u) => u._id) } });
    await Area.deleteMany({ name: { $regex: `^${NAME_PREFIX}` } });
    await City.deleteMany({ name: { $regex: `^${NAME_PREFIX}` } });
    await District.deleteMany({ name: { $regex: `^${NAME_PREFIX}` } });
    await State.deleteMany({ name: { $regex: `^${NAME_PREFIX}` } });
  };
  await preCleanup();

  try {
    try {
      const country = await Country.findOne({}).lean();
      check("Real Country fixture exists to anchor test States", !!country);

      let stateCodeSeq = 0;
      const nextStateCode = () => {
        let n = stateCodeSeq++, code = "";
        do { code = String.fromCharCode(65 + (n % 26)) + code; n = Math.floor(n / 26) - 1; } while (n >= 0);
        return ("ZZ" + code).slice(-2);
      };
      const mkState = async (suffix, opts = {}) => {
        const s = await State.create({ name: `${NAME_PREFIX}STATE_${suffix}`, code: nextStateCode(), type: "STATE", countryRef: country._id, geo: { type: "Point", coordinates: [77, 28] }, isActive: true, isDeleted: false, ...opts });
        createdStateIds.push(s._id); return s;
      };
      let districtCodeSeq = 0;
      const mkDistrict = async (suffix, stateRef, opts = {}) => {
        const d = await District.create({ name: `${NAME_PREFIX}DISTRICT_${suffix}`, code: `ZD${districtCodeSeq++}`, countryRef: country._id, stateRef, isActive: true, isDeleted: false, ...opts });
        createdDistrictIds.push(d._id); return d;
      };
      const mkCity = async (suffix, districtRef, stateRef, opts = {}) => {
        const c = await City.create({ name: `${NAME_PREFIX}CITY_${suffix}`, districtRef, stateRef, isActive: true, isDeleted: false, ...opts });
        createdCityIds.push(c._id); return c;
      };

      // Fixture World V (primary, fully valid) and World M (secondary, for cross-city control)
      const stateV = await mkState("V");
      const districtV = await mkDistrict("V", stateV._id);
      const cityV = await mkCity("V", districtV._id, stateV._id);
      const scopeV = { state: stateV, district: districtV, city: cityV };

      const stateM = await mkState("M");
      const districtM = await mkDistrict("M", stateM._id);
      const cityM = await mkCity("M", districtM._id, stateM._id);
      const scopeM = { state: stateM, district: districtM, city: cityM };

      // Broken-chain fixture worlds for resolveLockedScope negative paths
      const stateInactive = await mkState("INACTIVE", { isActive: false });
      const districtUnderInactiveState = await mkDistrict("UNDER_INACTIVE_STATE", stateInactive._id);
      await mkCity("UNDER_INACTIVE_STATE", districtUnderInactiveState._id, stateInactive._id);

      const stateForInactiveDistrict = await mkState("FOR_INACTIVE_DISTRICT");
      const districtInactive = await mkDistrict("INACTIVE", stateForInactiveDistrict._id, { isActive: false });
      await mkCity("UNDER_INACTIVE_DISTRICT", districtInactive._id, stateForInactiveDistrict._id);

      const stateForMismatch = await mkState("FOR_MISMATCH");
      const districtForMismatch = await mkDistrict("FOR_MISMATCH", stateM._id); // wrong state on purpose

      const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA", isDeleted: false }).select("+tokenVersion").lean();
      check("Real INDIA admin fixture exists (pre-existing account)", !!indiaAdmin);
      const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

      const fieldAgentUser = await User.create({ name: `${NAME_PREFIX}FA`, phone: nextPhone(), email: `ztest.area22.fa@example.invalid`, role: "FIELD_AGENT", countryRef: country._id, isActive: true, isDeleted: false, accountStatus: "ACTIVE" });
      createdUserIds.push(fieldAgentUser._id);
      const fieldAgentToken = generateAccessToken({ _id: fieldAgentUser._id, role: "FIELD_AGENT", tokenVersion: 0 });

      //////////////////////////////////////////////////////////////
      // 1/3/4. Classification — valid, blank, whitespace name
      //////////////////////////////////////////////////////////////
      {
        const res = await classifyRows([{ name: `${NAME_PREFIX}VALID_ROW` }], scopeV);
        check("1. Valid candidate classifies VALID_NEW", res[0].classification === "VALID_NEW", res[0].classification);

        const res2 = await classifyRows([{ name: "" }], scopeV);
        check("3. Empty name classifies INVALID_NAME", res2[0].classification === "INVALID_NAME", res2[0].classification);

        const res3 = await classifyRows([{ name: "   " }], scopeV);
        check("4. Whitespace-only name classifies INVALID_NAME", res3[0].classification === "INVALID_NAME", res3[0].classification);
      }

      //////////////////////////////////////////////////////////////
      // 2/5. Malformed input — non-object row
      //////////////////////////////////////////////////////////////
      {
        let threw = false;
        try { loadAndGateInput(writeTmpJson(["not an object"])); } catch (e) { threw = e instanceof ConfigError; }
        check("2/5. Non-object row is rejected at the structural gate", threw);
      }

      //////////////////////////////////////////////////////////////
      // 6/7. Unexpected field / scope-injection rejection
      //////////////////////////////////////////////////////////////
      {
        let threw = false;
        try { loadAndGateInput(writeTmpJson([{ name: "X", cityRef: "somewhere" }])); } catch (e) { threw = e instanceof ConfigError; }
        check("6/7. Row with injected cityRef is rejected at the structural gate (scope injection)", threw);

        let threw2 = false;
        try { loadAndGateInput(writeTmpJson([{ name: "X", sourceType: "COMMERCIAL" }])); } catch (e) { threw2 = e instanceof ConfigError; }
        check("Row with injected sourceType is rejected at the structural gate", threw2);

        let threw3 = false;
        // Written as raw JSON text, not a JS object literal — a JS
        // literal's `__proto__: ...` sets the prototype rather than
        // creating an own property, so it would never reach the file.
        // JSON.parse has no such special-casing: it creates a genuine
        // own enumerable "__proto__" key, which is exactly what
        // FORBIDDEN_KEY_NAMES must catch.
        const protoPath = path.join(os.tmpdir(), `area22_test_proto_${Date.now()}.json`);
        fs.writeFileSync(protoPath, '[{"name":"X","__proto__":{"polluted":true}}]');
        tmpFiles.push(protoPath);
        try { loadAndGateInput(protoPath); } catch (e) { threw3 = e instanceof ConfigError; }
        check("Row with __proto__ key is rejected at the structural gate", threw3);

        let threwOversized = false;
        const big = Array.from({ length: 2001 }, (_, i) => ({ name: `Row ${i}` }));
        try { loadAndGateInput(writeTmpJson(big)); } catch (e) { threwOversized = e instanceof ConfigError; }
        check("Oversized input (>2000 rows) is rejected", threwOversized);
      }

      //////////////////////////////////////////////////////////////
      // 8/9/10. Locked geography verification — happy path (real
      // Aligarh) + negative paths (fixture broken chains)
      //////////////////////////////////////////////////////////////
      {
        const real = await resolveLockedScope();
        check("8. Real locked Aligarh scope resolves (State/District/City chain)", !!(real.state && real.district && real.city));

        let threwInactiveState = false;
        try { await resolveLockedScope({ stateName: stateInactive.name, districtName: districtUnderInactiveState.name, cityName: `${NAME_PREFIX}CITY_UNDER_INACTIVE_STATE` }); }
        catch (e) { threwInactiveState = e instanceof ConfigError; }
        check("9. Inactive State is rejected by resolveLockedScope", threwInactiveState);

        let threwInactiveDistrict = false;
        try { await resolveLockedScope({ stateName: stateForInactiveDistrict.name, districtName: districtInactive.name, cityName: `${NAME_PREFIX}CITY_UNDER_INACTIVE_DISTRICT` }); }
        catch (e) { threwInactiveDistrict = e instanceof ConfigError; }
        check("9. Inactive District is rejected by resolveLockedScope", threwInactiveDistrict);

        let threwMismatch = false;
        try { await resolveLockedScope({ stateName: stateForMismatch.name, districtName: districtForMismatch.name, cityName: cityM.name }); }
        catch (e) { threwMismatch = e instanceof ConfigError; }
        check("10. District/State ancestor mismatch is rejected by resolveLockedScope", threwMismatch);
      }

      //////////////////////////////////////////////////////////////
      // 11. Duplicate within input
      //////////////////////////////////////////////////////////////
      {
        const res = await classifyRows([{ name: "Same Name" }, { name: "same   name" }], scopeV);
        check("11. Second identical-normalized row classifies DUPLICATE_IN_INPUT", res[1].classification === "DUPLICATE_IN_INPUT", res[1].classification);
      }

      //////////////////////////////////////////////////////////////
      // 12/13/16. Already-existing / same-city duplicate / idempotent
      // re-import — via importValidNew against fixture scope V
      //////////////////////////////////////////////////////////////
      {
        const rowName = `${NAME_PREFIX}IDEMPOTENT_ROW`;
        const first = await classifyRows([{ name: rowName }], scopeV);
        await importValidNew(first, scopeV, { url, token: indiaToken });
        check("First import of a new row succeeds", first[0].outcome === "created", JSON.stringify(first[0]));
        if (first[0].areaId) createdAreaIds.push(first[0].areaId);

        const second = await classifyRows([{ name: rowName }], scopeV);
        check("12. Re-classifying the same row now yields ALREADY_EXISTS", second[0].classification === "ALREADY_EXISTS", second[0].classification);

        await importValidNew(second, scopeV, { url, token: indiaToken });
        check("13/16. ALREADY_EXISTS row is never sent to the API (no outcome set)", second[0].outcome === undefined, second[0].outcome);

        const docCount = await Area.countDocuments({ cityRef: cityV._id, normalizedName: normalize(rowName) });
        check("16. Idempotent re-import creates zero duplicate Areas", docCount === 1, docCount);

        await new Promise((r) => setTimeout(r, 300));
        const auditCount = await AdminAuditLog.countDocuments({ action: "AREA_CREATED", targetId: first[0].areaId });
        check("16. Idempotent re-import creates zero duplicate audit events", auditCount === 1, auditCount);
      }

      //////////////////////////////////////////////////////////////
      // 14. Cross-city same-name control
      //////////////////////////////////////////////////////////////
      {
        const crossName = `${NAME_PREFIX}CROSS_CITY_ROW`;
        const rV = await classifyRows([{ name: crossName }], scopeV);
        await importValidNew(rV, scopeV, { url, token: indiaToken });
        const rM = await classifyRows([{ name: crossName }], scopeM);
        await importValidNew(rM, scopeM, { url, token: indiaToken });
        if (rV[0].areaId) createdAreaIds.push(rV[0].areaId);
        if (rM[0].areaId) createdAreaIds.push(rM[0].areaId);
        check("14. Same name in two different fixture cities both succeed", rV[0].outcome === "created" && rM[0].outcome === "created", `${rV[0].outcome} / ${rM[0].outcome}`);
      }

      //////////////////////////////////////////////////////////////
      // 15. Concurrent same Area creation
      //////////////////////////////////////////////////////////////
      {
        const concurrentName = `${NAME_PREFIX}CONCURRENT_ROW`;
        const rows = [{ input: { name: concurrentName }, classification: "VALID_NEW" }, { input: { name: concurrentName }, classification: "VALID_NEW" }];
        await Promise.all([
          importValidNew([rows[0]], scopeV, { url, token: indiaToken }),
          importValidNew([rows[1]], scopeV, { url, token: indiaToken }),
        ]);
        const outcomes = rows.map((r) => r.outcome).sort();
        check("15. Concurrent same-Area creation yields exactly one success", outcomes.filter((o) => o === "created").length === 1, JSON.stringify(outcomes));
        check("15. Concurrent same-Area creation yields exactly one conflict", rows.filter((r) => r.classification === "CONFLICT").length === 1, JSON.stringify(rows.map((r) => r.classification)));
        const winner = rows.find((r) => r.areaId)?.areaId;
        if (winner) createdAreaIds.push(winner);
        const docCount = await Area.countDocuments({ cityRef: cityV._id, normalizedName: normalize(concurrentName) });
        check("15. Exactly one Area document exists after the race", docCount === 1, docCount);
      }

      //////////////////////////////////////////////////////////////
      // 17/18. dry-run / validate-only produce zero writes
      //////////////////////////////////////////////////////////////
      {
        const beforeCount = await Area.countDocuments({});
        const inputPath = writeTmpJson([{ name: `${NAME_PREFIX}DRYRUN_ROW` }]);
        await execFileAsync(process.execPath, ["scripts/curateAreaAligarh.js", "--dry-run", `--input=${inputPath}`], { cwd: process.cwd() });
        const afterDry = await Area.countDocuments({});
        check("17. --dry-run performs zero Area writes", afterDry === beforeCount, `${beforeCount} -> ${afterDry}`);

        await execFileAsync(process.execPath, ["scripts/curateAreaAligarh.js", "--validate-only", `--input=${inputPath}`], { cwd: process.cwd() });
        const afterValidate = await Area.countDocuments({});
        check("18. --validate-only performs zero Area writes", afterValidate === beforeCount, `${beforeCount} -> ${afterValidate}`);
      }

      //////////////////////////////////////////////////////////////
      // 19/20. import creates Area + exactly one AREA_CREATED audit
      // (via the real CLI, against the REAL locked Aligarh scope,
      // using an obviously-fake ZTEST name — cleaned up below)
      //////////////////////////////////////////////////////////////
      {
        const aligarhTestName = `${NAME_PREFIX}REAL_ALIGARH_ROW`;
        const inputPath = writeTmpJson([{ name: aligarhTestName }]);
        const { stdout } = await execFileAsync(process.execPath, ["scripts/curateAreaAligarh.js", "--import", "--confirm", `--input=${inputPath}`], { cwd: process.cwd() });
        const reportMatch = stdout.match(/=== IMPORT REPORT ===\n([\s\S]*)/);
        const report = reportMatch ? JSON.parse(reportMatch[1]) : null;
        check("19. Real CLI --import --confirm against locked Aligarh scope creates the Area", report?.created === 1, stdout.slice(-500));

        const created = await Area.findOne({ name: aligarhTestName }).lean();
        check("19. Created Area is scoped to the real Aligarh City", !!created && String(created.cityRef) !== String(cityV._id), created?.cityRef);
        if (created) createdAreaIds.push(String(created._id));

        await new Promise((r) => setTimeout(r, 300));
        const auditCount = created ? await AdminAuditLog.countDocuments({ action: "AREA_CREATED", targetId: created._id }) : 0;
        check("20. Exactly one AREA_CREATED audit exists for the real-Aligarh test Area", auditCount === 1, auditCount);
        check("Provenance is MANUAL on the real-Aligarh test Area", created?.sourceType === "MANUAL", created?.sourceType);
      }

      //////////////////////////////////////////////////////////////
      // 21. Failed creation produces no partial Area/audit
      //////////////////////////////////////////////////////////////
      {
        const row = { input: { name: `${NAME_PREFIX}BAD_PINCODE_ROW`, pincode: "not-6-digits" }, classification: "VALID_NEW" };
        await importValidNew([row], scopeV, { url, token: indiaToken });
        check("21. A row rejected by createArea (bad pincode) is reported failed, not created", row.outcome === "failed", JSON.stringify(row));
        const exists = await Area.findOne({ cityRef: cityV._id, normalizedName: normalize(row.input.name) }).lean();
        check("21. No partial Area document was created for the failed row", !exists);
        await new Promise((r) => setTimeout(r, 200));
        const auditCount = await AdminAuditLog.countDocuments({ action: "AREA_CREATED", "meta.name": row.input.name });
        check("21. No audit event was created for the failed row", auditCount === 0, auditCount);
      }

      //////////////////////////////////////////////////////////////
      // 22. --confirm production guard
      //////////////////////////////////////////////////////////////
      {
        const inputPath = writeTmpJson([{ name: `${NAME_PREFIX}SHOULD_NOT_RUN` }]);
        let refused = false;
        try {
          await execFileAsync(process.execPath, ["scripts/curateAreaAligarh.js", "--import", `--input=${inputPath}`], { cwd: process.cwd() });
        } catch (e) {
          refused = e.code === 1 && /--confirm/.test(e.stderr || "");
        }
        check("22. --import without --confirm refuses to run", refused);
        const created = await Area.findOne({ name: `${NAME_PREFIX}SHOULD_NOT_RUN` }).lean();
        check("22. No Area was created by the refused run", !created);
      }

      //////////////////////////////////////////////////////////////
      // 23. No delete/update/deactivate path exists in the engine
      //////////////////////////////////////////////////////////////
      {
        const src = fs.readFileSync(path.join(process.cwd(), "scripts/curateAreaAligarh.js"), "utf8");
        const forbidden = ["deleteOne(", "deleteMany(", "findOneAndDelete(", "updateOne(", "updateMany(", "findOneAndUpdate(", "dropIndex", "syncIndexes"];
        const found = forbidden.filter((f) => src.includes(f));
        check("23. Engine source contains no delete/update/deactivate/index-mutation calls", found.length === 0, JSON.stringify(found));
      }

      //////////////////////////////////////////////////////////////
      // 24. Authorization remains inherited from POST /api/admin/areas
      //////////////////////////////////////////////////////////////
      {
        const row = { input: { name: `${NAME_PREFIX}UNAUTHORIZED_ROW` }, classification: "VALID_NEW" };
        await importValidNew([row], scopeV, { url, token: fieldAgentToken });
        check("24. Orchestration layer inherits authorization — FIELD_AGENT token is rejected (not created)", row.outcome === "failed" && /403|401/.test(row.failureDetail || ""), JSON.stringify(row));
        const exists = await Area.findOne({ name: `${NAME_PREFIX}UNAUTHORIZED_ROW` }).lean();
        check("24. No Area created via an unauthorized token", !exists);
      }

      //////////////////////////////////////////////////////////////
      // 25/26. Query-plan sanity + no stale indexes recreated
      //////////////////////////////////////////////////////////////
      {
        const plan = await Area.find({ cityRef: cityV._id, normalizedName: "x" }).explain("queryPlanner");
        const usesIndex = JSON.stringify(plan.queryPlanner.winningPlan).includes("IXSCAN");
        check("25. cityRef+normalizedName lookup still uses an index scan (not COLLSCAN)", usesIndex);

        const liveIndexes = await mongoose.connection.db.collection("areas").indexes();
        check("26. Exactly 17 indexes remain on `areas` (no stale index recreated)", liveIndexes.length === 17, liveIndexes.length);
        const staleNames = ["name_1", "code_1", "slug_1", "assemblyRef_1", "pincodeRef_1", "name_1_pincodeRef_1", "name_1_isActive_1", "pincodeRef_1_isActive_1_isDeleted_1", "assemblyRef_1_isActive_1_isDeleted_1"];
        const anyStale = liveIndexes.some((i) => staleNames.includes(i.name));
        check("26. None of the 9 previously-removed stale index names are present", !anyStale);
      }

    } catch (innerErr) {
      console.error("TEST BODY ERROR:", innerErr);
      check("Test body completed without throwing", false, innerErr.message);
    }
  } finally {
    // ── CLEANUP ──────────────────────────────────────────────────
    if (createdAreaIds.length) await Area.deleteMany({ _id: { $in: createdAreaIds } });
    await Area.deleteMany({ name: { $regex: `^${NAME_PREFIX}` } });
    if (createdCityIds.length) await City.deleteMany({ _id: { $in: createdCityIds } });
    if (createdDistrictIds.length) await District.deleteMany({ _id: { $in: createdDistrictIds } });
    if (createdStateIds.length) await State.deleteMany({ _id: { $in: createdStateIds } });
    if (createdUserIds.length) await User.deleteMany({ _id: { $in: createdUserIds } });
    for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (_) {} }

    console.log("\n" + results.join("\n"));
    console.log(`\n${pass} passed, ${fail} failed`);

    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    process.exit(fail > 0 ? 1 : 0);
  }
};

run().catch(async (err) => {
  console.error("FATAL:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
