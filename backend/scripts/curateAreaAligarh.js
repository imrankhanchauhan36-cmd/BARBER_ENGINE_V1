/**
 * BARBER_ENGINE_V1
 * backend/scripts/curateAreaAligarh.js
 *
 * AREA-2.2 — Aligarh Assisted Area Curation Engine.
 *
 * This is an ORCHESTRATION layer around the existing, already-hardened
 * POST /api/admin/areas endpoint (AREA-2.1) — it never inserts an Area
 * document directly and never duplicates createArea's validation
 * logic. Every actual creation goes through the real HTTP path, so
 * ancestor validation, the client-input whitelist, MANUAL provenance,
 * AREA_CREATED audit, and the {cityRef,normalizedName} unique index
 * all remain centralized in controllers/location.controller.js.
 *
 * Rollout scope (AREA-1.2, locked) is Aligarh City / Aligarh District
 * / Uttar Pradesh ONLY. The input file may never specify geography —
 * cityRef/districtRef/stateRef come exclusively from resolving the
 * real live State→District→City chain by name, verified active/
 * non-deleted/correctly-chained before anything else runs.
 *
 * Normalization reuses Area.js's own algorithm verbatim:
 *   normalizedName = name.toLowerCase().trim().replace(/\s+/g, " ")
 * No second normalization algorithm is introduced.
 *
 * Usage:
 *   node scripts/curateAreaAligarh.js --dry-run       --input=./data.json
 *   node scripts/curateAreaAligarh.js --validate-only --input=./data.json
 *   node scripts/curateAreaAligarh.js --import --confirm --input=./data.json
 *
 * Exactly one mode flag is required. --import additionally requires
 * --confirm — a deliberate, separate flag (not NODE_ENV) because this
 * tool is meant to run against the real production Atlas cluster
 * (there is no separate staging DB in this project); dry-run/
 * validate-only are non-mutating by construction regardless of flags.
 *
 * Allowed input fields: name (required), pincode (optional,
 * informational — same contract as createArea's own pincode field).
 * Any other key on any row — including cityRef/districtRef/stateRef/
 * sourceType/isActive/isDeleted/deletedAt/__proto__/constructor/
 * prototype/anything else — fails the file at the structural-gate
 * stage, before any row is classified. This is the "no cross-city
 * injection, no lifecycle/provenance injection" guarantee.
 */

import "dotenv/config";
import fs from "fs";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import State from "../models/State.js";
import District from "../models/District.js";
import City from "../models/City.js";
import Area from "../models/Area.js";
import AdminAuditLog from "../models/AdminAuditLog.js";
import { generateAccessToken } from "../services/token.service.js";

//////////////////////////////////////////////////////////////////////
// CLI ARGS
//////////////////////////////////////////////////////////////////////

const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const getOpt = (name) => {
  const prefix = `--${name}=`;
  const hit = argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
};

const MODE_FLAGS = ["--dry-run", "--validate-only", "--import"];
const modesPresent = MODE_FLAGS.filter((f) => hasFlag(f));

const MAX_INPUT_ROWS = 2000;
const ALLOWED_ROW_KEYS = new Set(["name", "pincode"]);
const FORBIDDEN_KEY_NAMES = new Set(["__proto__", "constructor", "prototype"]);
const PINCODE_RE = /^\d{6}$/;

// Reused verbatim from Area.js's own pre("save") hook — no second
// normalization algorithm.
const normalize = (name) => name.toLowerCase().trim().replace(/\s+/g, " ");

//////////////////////////////////////////////////////////////////////
// STRUCTURAL INPUT GATE — whole-file, fatal on failure, zero
// processing if it fails. Runs before any row is classified.
//////////////////////////////////////////////////////////////////////

function loadAndGateInput(path) {
  let raw;
  try {
    raw = fs.readFileSync(path, "utf8");
  } catch (err) {
    throw new ConfigError(`Cannot read input file "${path}": ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`Input file is not valid JSON: ${err.message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new ConfigError("Input file must be a JSON array at the top level.");
  }
  if (parsed.length === 0) {
    throw new ConfigError("Input file contains zero rows.");
  }
  if (parsed.length > MAX_INPUT_ROWS) {
    throw new ConfigError(`Input file has ${parsed.length} rows — exceeds the bounded limit of ${MAX_INPUT_ROWS}.`);
  }

  parsed.forEach((row, i) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      throw new ConfigError(`Row ${i} is not a plain object.`);
    }
    for (const key of Object.keys(row)) {
      if (FORBIDDEN_KEY_NAMES.has(key)) {
        throw new ConfigError(`Row ${i} contains a forbidden key "${key}".`);
      }
      if (!ALLOWED_ROW_KEYS.has(key)) {
        throw new ConfigError(`Row ${i} contains a disallowed field "${key}". Allowed fields: name, pincode.`);
      }
    }
  });

  return parsed;
}

class ConfigError extends Error {}

//////////////////////////////////////////////////////////////////////
// LOCKED ALIGARH SCOPE RESOLUTION — resolved from live DB by name,
// never hard-coded ObjectIds, fully ancestor-verified before any
// processing proceeds.
//////////////////////////////////////////////////////////////////////

// Names default to the AREA-1.2 locked rollout scope. Accepting them
// as parameters (rather than hard-coding the regex inline) lets the
// verification script exercise this exact validation logic against
// safe fixture geography — never against real Aligarh/UP records —
// while the CLI's own invocation always uses the defaults below.
async function resolveLockedScope({ stateName = "UTTAR PRADESH", districtName = "ALIGARH", cityName = "ALIGARH" } = {}) {
  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const state = await State.findOne({ name: new RegExp(`^${escapeRegex(stateName)}$`, "i"), isDeleted: false }).lean();
  if (!state || !state.isActive) {
    throw new ConfigError(`Locked State (${stateName}) could not be resolved as active/non-deleted.`);
  }

  const district = await District.findOne({ name: new RegExp(`^${escapeRegex(districtName)}$`, "i"), isDeleted: false }).lean();
  if (!district || !district.isActive) {
    throw new ConfigError(`Locked District (${districtName}) could not be resolved as active/non-deleted.`);
  }
  if (String(district.stateRef) !== String(state._id)) {
    throw new ConfigError(`Locked District (${districtName}) does not belong to the locked State (${stateName}).`);
  }

  const city = await City.findOne({ name: new RegExp(`^${escapeRegex(cityName)}$`, "i"), isDeleted: false }).lean();
  if (!city || !city.isActive) {
    throw new ConfigError(`Locked City (${cityName}) could not be resolved as active/non-deleted.`);
  }
  if (String(city.districtRef) !== String(district._id)) {
    throw new ConfigError(`Locked City (${cityName}) does not belong to the locked District (${districtName}).`);
  }

  return { state, district, city };
}

//////////////////////////////////////////////////////////////////////
// CLASSIFICATION
//////////////////////////////////////////////////////////////////////

async function classifyRows(rows, scope) {
  const seenNormalized = new Set();
  const results = [];

  for (const row of rows) {
    const rawName = row.name;

    if (typeof rawName !== "string" || rawName.trim().length === 0) {
      results.push({ input: row, classification: "INVALID_NAME", reason: "missing/blank/non-string name" });
      continue;
    }

    const normalizedName = normalize(rawName);

    if (seenNormalized.has(normalizedName)) {
      results.push({ input: row, normalizedName, classification: "DUPLICATE_IN_INPUT", reason: "another row in this file normalizes to the same name" });
      continue;
    }

    const existing = await Area.findOne({ cityRef: scope.city._id, normalizedName }).select("_id").lean();
    if (existing) {
      seenNormalized.add(normalizedName);
      results.push({ input: row, normalizedName, classification: "ALREADY_EXISTS", reason: `live Area ${existing._id} already exists`, existingAreaId: String(existing._id) });
      continue;
    }

    seenNormalized.add(normalizedName);
    results.push({ input: row, normalizedName, classification: "VALID_NEW" });
  }

  return results;
}

//////////////////////////////////////////////////////////////////////
// IMPORT — drives the real, hardened POST /api/admin/areas over real
// HTTP. Sequential, one row at a time (conservative bounded
// processing for Aligarh's expected scale — see AREA-2.2 architecture
// report §K). Each row is isolated: one row's failure never aborts
// the run or corrupts the report.
//////////////////////////////////////////////////////////////////////

async function importValidNew(results, scope, { url, token }) {
  for (const r of results) {
    if (r.classification !== "VALID_NEW") continue;

    try {
      const res = await fetch(url("/api/admin/areas"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: r.input.name,
          cityId: String(scope.city._id),
          districtId: String(scope.district._id),
          stateId: String(scope.state._id),
          ...(r.input.pincode !== undefined ? { pincode: r.input.pincode } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (res.status === 200 || res.status === 201) {
        r.outcome = "created";
        r.areaId = json?.data?.id ?? null;
      } else if (res.status === 409) {
        r.outcome = "conflict";
        r.classification = "CONFLICT";
      } else {
        r.outcome = "failed";
        r.failureDetail = `HTTP ${res.status}: ${json?.message ?? "unknown error"}`;
      }
    } catch (err) {
      r.outcome = "failed";
      r.failureDetail = err.message;
    }
  }
}

//////////////////////////////////////////////////////////////////////
// REPORT
//////////////////////////////////////////////////////////////////////

function buildReport(results) {
  const count = (cls) => results.filter((r) => r.classification === cls).length;
  const report = {
    totalInput: results.length,
    validNew: count("VALID_NEW"),
    alreadyExists: count("ALREADY_EXISTS"),
    duplicateInInput: count("DUPLICATE_IN_INPUT"),
    invalidParent: count("INVALID_PARENT"),
    invalidName: count("INVALID_NAME"),
    invalidScope: count("INVALID_SCOPE"),
    conflicts: count("CONFLICT"),
    created: results.filter((r) => r.outcome === "created").length,
    failed: results.filter((r) => r.outcome === "failed").length,
    // Never sent to the API at all: not VALID_NEW (already-exists/
    // duplicate/invalid), or VALID_NEW but not yet attempted (the
    // dry-run/validate-only case, where nothing is ever sent).
    skipped: results.filter((r) => r.classification !== "VALID_NEW" && r.classification !== "CONFLICT").length
      + results.filter((r) => r.classification === "VALID_NEW" && !r.outcome).length,
    rows: results.map((r) => ({
      name: r.input?.name ?? null,
      classification: r.classification,
      outcome: r.outcome ?? null,
      reason: r.reason ?? r.failureDetail ?? null,
      areaId: r.areaId ?? null,
    })),
  };
  return report;
}

//////////////////////////////////////////////////////////////////////
// MAIN
//////////////////////////////////////////////////////////////////////

const run = async () => {
  if (modesPresent.length !== 1) {
    throw new ConfigError(`Exactly one mode flag is required (${MODE_FLAGS.join(", ")}). Got: ${modesPresent.join(", ") || "none"}.`);
  }
  const mode = modesPresent[0];

  if (mode === "--import" && !hasFlag("--confirm")) {
    throw new ConfigError("--import requires an explicit --confirm flag. Refusing to run without it.");
  }

  const inputPath = getOpt("input");
  if (!inputPath) {
    throw new ConfigError("Missing required --input=<path> argument.");
  }

  const rawRows = loadAndGateInput(inputPath);

  await connectDB();

  let scope;
  try {
    scope = await resolveLockedScope();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error("\nCONFIGURATION/SCOPE ERROR — aborting before any processing. Zero Area writes performed.");
      console.error(err.message);
      const report = buildReport(rawRows.map((row) => ({ input: row, classification: "INVALID_PARENT", reason: err.message })));
      console.log("\n" + JSON.stringify(report, null, 2));
      await mongoose.disconnect();
      process.exit(1);
    }
    throw err;
  }

  console.log(`Locked scope resolved: State=${scope.state.name} (${scope.state._id}) District=${scope.district.name} (${scope.district._id}) City=${scope.city.name} (${scope.city._id})`);

  const results = await classifyRows(rawRows, scope);

  if (mode === "--dry-run" || mode === "--validate-only") {
    const report = buildReport(results);
    console.log(`\n=== ${mode === "--dry-run" ? "DRY RUN" : "VALIDATE ONLY"} REPORT (zero writes) ===`);
    console.log(JSON.stringify(report, null, 2));
    await mongoose.disconnect();
    process.exit(0);
  }

  // --import
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;

  const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA", isDeleted: false }).select("+tokenVersion").lean();
  if (!indiaAdmin) {
    console.error("No INDIA admin account exists — cannot authenticate the import path. Aborting. Zero Area writes performed.");
    await new Promise((r) => server.close(r));
    await mongoose.disconnect();
    process.exit(1);
  }
  const token = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

  await importValidNew(results, scope, { url, token });

  const report = buildReport(results);
  console.log("\n=== IMPORT REPORT ===");
  console.log(JSON.stringify(report, null, 2));

  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  process.exit(0);
};

// Guarded so the verification script can import the pure helpers
// below (normalize/loadAndGateInput/classifyRows/buildReport) without
// triggering the CLI flow as a side effect of the import itself.
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  run().catch(async (err) => {
    if (err instanceof ConfigError) {
      console.error("\nCONFIGURATION ERROR:", err.message);
    } else {
      console.error("\nFATAL:", err);
    }
    try { await mongoose.disconnect(); } catch (_) {}
    process.exit(1);
  });
}

export { normalize, loadAndGateInput, resolveLockedScope, classifyRows, buildReport, importValidNew, ConfigError };
