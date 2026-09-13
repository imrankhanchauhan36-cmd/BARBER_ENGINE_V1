/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyAreaDiscoveryMatching.js
 *
 * AREA-2.5.2 — LIVE, real-HTTP, real-DB verification for the
 * normalization/tokenization pure functions, the matching service,
 * and the match-preview admin endpoint. Same precedent as every
 * other verify script this session. All fixtures prefixed
 * "ZTEST_AREA252_" / phones 9999912xxx, hard-deleted in cleanup.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyAreaDiscoveryMatching.js
 */

import "dotenv/config";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import Country from "../models/Country.js";
import State from "../models/State.js";
import District from "../models/District.js";
import City from "../models/City.js";
import Area from "../models/Area.js";
import AreaDiscoveryCandidate from "../models/AreaDiscoveryCandidate.js";
import { generateAccessToken } from "../services/token.service.js";
import {
  normalizeForIdentity,
  tokenizeForTextMatch,
  TEXT_MATCH_STRIP_WORDS,
} from "../services/areaDiscoveryNormalization.service.js";
import { matchCandidateAgainstAreas } from "../services/areaDiscoveryMatching.service.js";

let pass = 0;
let fail = 0;
const results = [];
const check = (name, condition, detail) => {
  if (condition) { pass += 1; results.push(`✅ ${name}`); }
  else { fail += 1; results.push(`❌ ${name}${detail ? " — " + String(detail).slice(0, 300) : ""}`); }
};

const NAME_PREFIX = "ZTEST_AREA252_";
let phoneSeq = 0;
const nextPhone = () => `9999912${String(phoneSeq++).padStart(3, "0")}`;

const createdUserIds = [];
const createdStateIds = [];
const createdDistrictIds = [];
const createdCityIds = [];
const createdAreaIds = [];
const createdCandidateIds = [];

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path_, token, opts = {}) =>
    fetch(url(path_), {
      ...opts,
      headers: {
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers || {}),
      },
    });

  // Test isolation relies on uniquely-prefixed FIXTURE CITIES (not on
  // the Area/candidate name itself carrying any prefix) — Area.name
  // and AreaDiscoveryCandidate.normalizedCandidateName must be clean,
  // realistic names for tokenization to behave as the approved
  // examples intend. Precise per-run cleanup uses the tracked _id
  // arrays (below); this preCleanup only recovers from a prior crash,
  // cascading from stale prefixed cities down to their Areas/Candidates.
  const preCleanup = async () => {
    const staleUsers = await User.find({ phone: { $regex: /^9999912\d{3}$/ } }).select("_id").lean();
    if (staleUsers.length) await User.deleteMany({ _id: { $in: staleUsers.map((u) => u._id) } });
    const staleCities = await City.find({ name: { $regex: `^${NAME_PREFIX}` } }).select("_id").lean();
    if (staleCities.length) {
      const cityIds = staleCities.map((c) => c._id);
      await AreaDiscoveryCandidate.deleteMany({ cityRef: { $in: cityIds } });
      await Area.deleteMany({ cityRef: { $in: cityIds } });
    }
    await City.deleteMany({ name: { $regex: `^${NAME_PREFIX}` } });
    await District.deleteMany({ name: { $regex: `^${NAME_PREFIX}` } });
    await State.deleteMany({ name: { $regex: `^${NAME_PREFIX}` } });
  };
  await preCleanup();

  try {
    try {
      //////////////////////////////////////////////////////////////
      // NORMALIZATION / TOKENIZATION (pure, no DB)
      //////////////////////////////////////////////////////////////
      check("lowercase", normalizeForIdentity("CIVIL LINES") === "civil lines");
      check("trim", normalizeForIdentity("  Civil Lines  ") === "civil lines");
      check("whitespace collapse", normalizeForIdentity("Civil    Lines") === "civil lines");
      check("punctuation preserved at identity tier", normalizeForIdentity("Civil-Lines") === "civil-lines");
      check("empty input handled", normalizeForIdentity("") === "");
      check("invalid/null input handled without throwing", normalizeForIdentity(null) === "");
      check("deterministic repeatability", normalizeForIdentity("Civil Lines") === normalizeForIdentity("Civil Lines"));
      check("no destructive over-normalization (hyphen survives identity tier)", normalizeForIdentity("St. John's") === "st. john's");

      check("road stripped", !tokenizeForTextMatch("Civil Lines Road").has("road"));
      check("rd stripped", !tokenizeForTextMatch("Civil Lines Rd").has("rd"));
      check("marg stripped", !tokenizeForTextMatch("MG Marg").has("marg"));
      check("street stripped", !tokenizeForTextMatch("Main Street").has("street"));
      check("st retained", tokenizeForTextMatch("St John").has("st"));
      check("hospital retained", tokenizeForTextMatch("Hospital Road").has("hospital"));
      check("college retained", tokenizeForTextMatch("College Road").has("college"));
      check("school retained", tokenizeForTextMatch("School Road").has("school"));
      check("chowk retained", tokenizeForTextMatch("Manik Chowk").has("chowk"));
      check("period removed (not a separator)", [...tokenizeForTextMatch("St. John's")].join(",") === "st,johns");
      check("apostrophe removed (not a separator)", tokenizeForTextMatch("St. John's").has("johns"));
      check("comma splitting", [...tokenizeForTextMatch("Civil, Lines")].sort().join(",") === "civil,lines");
      check("hyphen splitting", [...tokenizeForTextMatch("Civil-Lines")].sort().join(",") === "civil,lines");
      check("empty-token removal (no stray blanks from repeated separators)", ![...tokenizeForTextMatch("Civil   -,  Lines")].includes(""));
      check("strip list is exactly the approved closed set", JSON.stringify(TEXT_MATCH_STRIP_WORDS) === JSON.stringify(["road", "rd", "marg", "street"]));

      //////////////////////////////////////////////////////////////
      // FIXTURES
      //////////////////////////////////////////////////////////////
      const country = await Country.findOne({}).lean();
      check("Real Country fixture exists", !!country);

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
      // Deliberately NOT prefixed — Area.name/candidate name are the
      // exact strings tokenized by the algorithm under test, so they
      // must be clean, realistic names ("Civil Lines", "School", ...)
      // for the approved examples to produce their specified token
      // structure. Isolation comes from the uniquely-prefixed fixture
      // City each is created under (cityRef is a hard scope gate),
      // plus precise _id-tracked cleanup below.
      const mkArea = async (name, cityRef, districtRef, stateRef, opts = {}) => {
        const a = await Area.create({ name, cityRef, districtRef, stateRef, isActive: true, isDeleted: false, ...opts });
        createdAreaIds.push(a._id); return a;
      };
      const mkCandidate = async (name, cityRef, districtRef, stateRef) => {
        const c = await AreaDiscoveryCandidate.create({
          normalizedCandidateName: normalizeForIdentity(name),
          rawObservedNames: [name],
          cityRef, districtRef, stateRef,
          sourceType: "ADMIN",
        });
        createdCandidateIds.push(c._id); return c;
      };

      const stateV = await mkState("V");
      const districtV = await mkDistrict("V", stateV._id);
      const cityV = await mkCity("V", districtV._id, stateV._id);

      const stateM = await mkState("M");
      const districtM = await mkDistrict("M", stateM._id);
      const cityM = await mkCity("M", districtM._id, stateM._id);
      const districtM2 = await mkDistrict("M2", stateV._id); // same state as V, different district
      const cityM2 = await mkCity("M2", districtM2._id, stateV._id);

      const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA", isDeleted: false }).select("+tokenVersion").lean();
      check("Real INDIA admin fixture exists", !!indiaAdmin);
      const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

      let adminEmailSeq = 0;
      const mkAdmin = async (adminLevel, extra = {}) => {
        const u = await User.create({
          name: `${NAME_PREFIX}ADMIN_${adminLevel}`, phone: nextPhone(),
          email: `ztest.area252.admin${adminEmailSeq++}@example.invalid`,
          role: "ADMIN", adminLevel, countryRef: country._id, adminSubRole: "PRIMARY",
          isActive: true, isDeleted: false, accountStatus: "ACTIVE", ...extra,
        });
        createdUserIds.push(u._id); return u;
      };
      const stateAdminV = await mkAdmin("STATE", { stateRef: stateV._id });
      const districtAdminV = await mkAdmin("DISTRICT", { stateRef: stateV._id, districtRef: districtV._id });
      const stateAdminM = await mkAdmin("STATE", { stateRef: stateM._id });

      const fieldAgentUser = await User.create({ name: `${NAME_PREFIX}FA`, phone: nextPhone(), email: "ztest.area252.fa@example.invalid", role: "FIELD_AGENT", countryRef: country._id, isActive: true, isDeleted: false, accountStatus: "ACTIVE" });
      createdUserIds.push(fieldAgentUser._id);
      const plainUser = await User.create({ name: `${NAME_PREFIX}USER`, phone: nextPhone(), email: "ztest.area252.user@example.invalid", role: "USER", countryRef: country._id, isActive: true, isDeleted: false, accountStatus: "ACTIVE" });
      createdUserIds.push(plainUser._id);

      const tokenFor = (u) => generateAccessToken({ _id: u._id, role: u.role, adminLevel: u.adminLevel, tokenVersion: u.tokenVersion ?? 0 });
      const stateVToken = tokenFor(stateAdminV);
      const districtVToken = tokenFor(districtAdminV);
      const stateMToken = tokenFor(stateAdminM);
      const fieldAgentToken = tokenFor(fieldAgentUser);
      const plainUserToken = tokenFor(plainUser);

      const preview = (token, candidateId) => authFetch(`/api/admin/area-discovery-candidates/${candidateId}/match-preview`, token, { method: "GET" });

      const geo = { cityRef: cityV._id, districtRef: districtV._id, stateRef: stateV._id };

      //////////////////////////////////////////////////////////////
      // 14 APPROVED WORKED EXAMPLES (service-level, direct calls)
      //////////////////////////////////////////////////////////////
      {
        const areaCivilLines = await mkArea("Civil Lines", geo.cityRef, geo.districtRef, geo.stateRef);
        const r1 = await matchCandidateAgainstAreas({ ...geo, normalizedCandidateName: normalizeForIdentity("Civil Lines") });
        check("Example 1: Civil Lines vs Civil Lines => HIGH", r1.classification === "HIGH", JSON.stringify(r1));

        const r2 = await matchCandidateAgainstAreas({ ...geo, normalizedCandidateName: normalizeForIdentity("Civil Lines Road") });
        check("Example 2: Civil Lines Road vs Civil Lines => MEDIUM", r2.classification === "MEDIUM", JSON.stringify(r2));

        const cityEx3 = await mkCity("EX3", districtV._id, stateV._id);
        const areaCivilLinesRoad = await mkArea("Civil Lines Road", cityEx3._id, districtV._id, stateV._id);
        const r3 = await matchCandidateAgainstAreas({ cityRef: cityEx3._id, districtRef: districtV._id, stateRef: stateV._id, normalizedCandidateName: normalizeForIdentity("Civil Lines Road") });
        check("Example 3: Civil Lines Road vs Civil Lines Road => HIGH", r3.classification === "HIGH", JSON.stringify(r3));
      }

      {
        const cityEx4 = await mkCity("EX4", districtV._id, stateV._id);
        const areaSchool = await mkArea("School", cityEx4._id, districtV._id, stateV._id);
        const r4 = await matchCandidateAgainstAreas({ cityRef: cityEx4._id, districtRef: districtV._id, stateRef: stateV._id, normalizedCandidateName: normalizeForIdentity("School Road") });
        check("Example 4: School Road vs School => LOW", r4.classification === "LOW", JSON.stringify(r4));
      }

      {
        const cityEx5 = await mkCity("EX5", districtM2._id, stateV._id);
        const areaKhair = await mkArea("Khair", cityEx5._id, districtM2._id, stateV._id);
        const r5 = await matchCandidateAgainstAreas({ cityRef: cityEx5._id, districtRef: districtM2._id, stateRef: stateV._id, normalizedCandidateName: normalizeForIdentity("Khair") });
        check("Example 5: Khair vs Khair => HIGH", r5.classification === "HIGH", JSON.stringify(r5));

        const r6 = await matchCandidateAgainstAreas({ cityRef: cityEx5._id, districtRef: districtM2._id, stateRef: stateV._id, normalizedCandidateName: normalizeForIdentity("Khair Road") });
        check("Example 6: Khair Road vs Khair => LOW", r6.classification === "LOW", JSON.stringify(r6));
      }

      {
        const cityJ = await mkCity("JATTARI", districtV._id, stateV._id);
        const areaJattari = await mkArea("Jattari", cityJ._id, districtV._id, stateV._id);
        const r7 = await matchCandidateAgainstAreas({ cityRef: cityJ._id, districtRef: districtV._id, stateRef: stateV._id, normalizedCandidateName: normalizeForIdentity("Jattari") });
        check("Example 7: Jattari vs Jattari => HIGH", r7.classification === "HIGH", JSON.stringify(r7));

        const citySh = await mkCity("SHAJAPUR", districtV._id, stateV._id);
        const areaShajapur = await mkArea("Shajapur", citySh._id, districtV._id, stateV._id);
        const r8 = await matchCandidateAgainstAreas({ cityRef: citySh._id, districtRef: districtV._id, stateRef: stateV._id, normalizedCandidateName: normalizeForIdentity("Shajapur") });
        check("Example 8: Shajapur vs Shajapur => HIGH", r8.classification === "HIGH", JSON.stringify(r8));
      }

      {
        const r9 = await matchCandidateAgainstAreas({ ...geo, normalizedCandidateName: normalizeForIdentity("Road") });
        check("Example 9: Road vs any Area => NO_MATCH", r9.classification === "NO_MATCH", JSON.stringify(r9));
      }

      {
        const cityH = await mkCity("HOSP", districtV._id, stateV._id);
        const areaHospital = await mkArea("Hospital", cityH._id, districtV._id, stateV._id);
        const r10 = await matchCandidateAgainstAreas({ cityRef: cityH._id, districtRef: districtV._id, stateRef: stateV._id, normalizedCandidateName: normalizeForIdentity("Hospital Road") });
        check("Example 10: Hospital Road vs Hospital => LOW", r10.classification === "LOW", JSON.stringify(r10));
      }

      {
        const cityTie = await mkCity("TIE", districtV._id, stateV._id);
        const areaA = await mkArea("New Civil Lines", cityTie._id, districtV._id, stateV._id);
        const areaB = await mkArea("Civil Lines Extension", cityTie._id, districtV._id, stateV._id);
        const r11 = await matchCandidateAgainstAreas({ cityRef: cityTie._id, districtRef: districtV._id, stateRef: stateV._id, normalizedCandidateName: normalizeForIdentity("Civil Lines") });
        check("Example 11: tie between two Areas => LOW", r11.classification === "LOW", JSON.stringify(r11));
        check("Example 11: LOW returns both tied Areas", r11.matches.length === 2, JSON.stringify(r11.matches));
      }

      {
        const cityShort = await mkCity("SHORT", districtV._id, stateV._id);
        const areaExt = await mkArea("Civil Lines Extension", cityShort._id, districtV._id, stateV._id);
        const areaShort = await mkArea("Civil Lines", cityShort._id, districtV._id, stateV._id);
        const r12 = await matchCandidateAgainstAreas({ cityRef: cityShort._id, districtRef: districtV._id, stateRef: stateV._id, normalizedCandidateName: normalizeForIdentity("Civil Lines Extension") });
        check("Example 12: exact identity short-circuits => HIGH", r12.classification === "HIGH", JSON.stringify(r12));
        check("Example 12: matched only to the exact Area (A), not B", r12.matches.length === 1 && r12.matches[0].areaId === String(areaExt._id), JSON.stringify(r12));
      }

      {
        const cityP = await mkCity("PUNCT", districtV._id, stateV._id);
        const areaCL = await mkArea("Civil Lines", cityP._id, districtV._id, stateV._id);
        const r13 = await matchCandidateAgainstAreas({ cityRef: cityP._id, districtRef: districtV._id, stateRef: stateV._id, normalizedCandidateName: normalizeForIdentity("Civil-Lines") });
        check("Example 13: Civil-Lines vs Civil Lines => MEDIUM (not HIGH)", r13.classification === "MEDIUM", JSON.stringify(r13));

        const cityQ = await mkCity("QUOTE", districtV._id, stateV._id);
        const areaSJ = await mkArea("St Johns", cityQ._id, districtV._id, stateV._id);
        const r14 = await matchCandidateAgainstAreas({ cityRef: cityQ._id, districtRef: districtV._id, stateRef: stateV._id, normalizedCandidateName: normalizeForIdentity("St. John's") });
        check("Example 14: St. John's vs St Johns => MEDIUM (not HIGH)", r14.classification === "MEDIUM", JSON.stringify(r14));
      }

      //////////////////////////////////////////////////////////////
      // EXACT — ancestor scoping
      //////////////////////////////////////////////////////////////
      {
        const cityScope = await mkCity("SCOPE", districtV._id, stateV._id);
        const areaScope = await mkArea("Scopearea", cityScope._id, districtV._id, stateV._id);
        const sameCity = await matchCandidateAgainstAreas({ cityRef: cityScope._id, districtRef: districtV._id, stateRef: stateV._id, normalizedCandidateName: normalizeForIdentity("Scopearea") });
        check("EXACT: same City => HIGH", sameCity.classification === "HIGH");

        const diffCity = await matchCandidateAgainstAreas({ cityRef: cityM._id, districtRef: districtM._id, stateRef: stateM._id, normalizedCandidateName: normalizeForIdentity("Scopearea") });
        check("EXACT: identical name, different City => never matched (NO_MATCH)", diffCity.classification === "NO_MATCH", JSON.stringify(diffCity));

        const diffDistrict = await matchCandidateAgainstAreas({ cityRef: cityM2._id, districtRef: districtM2._id, stateRef: stateV._id, normalizedCandidateName: normalizeForIdentity("Scopearea") });
        check("EXACT: identical name, different District (same State) => never matched", diffDistrict.classification === "NO_MATCH", JSON.stringify(diffDistrict));

        const diffState = await matchCandidateAgainstAreas({ cityRef: cityM._id, districtRef: districtM._id, stateRef: stateM._id, normalizedCandidateName: normalizeForIdentity("Scopearea") });
        check("EXACT: identical name, different State => never matched", diffState.classification === "NO_MATCH", JSON.stringify(diffState));
      }

      //////////////////////////////////////////////////////////////
      // Text-can-never-produce-HIGH (structural proof)
      //////////////////////////////////////////////////////////////
      {
        const cityT = await mkCity("NOHIGH", districtV._id, stateV._id);
        const areaT = await mkArea("Partial Overlap Area Tokens", cityT._id, districtV._id, stateV._id);
        const r = await matchCandidateAgainstAreas({ cityRef: cityT._id, districtRef: districtV._id, stateRef: stateV._id, normalizedCandidateName: normalizeForIdentity("Partial Overlap Only") });
        check("Text-tier result is never HIGH even with high overlap", r.classification !== "HIGH", JSON.stringify(r));
      }

      //////////////////////////////////////////////////////////////
      // PREVIEW ENDPOINT — real HTTP, response contract
      //////////////////////////////////////////////////////////////
      let previewCandidateId;
      {
        const areaPrev = await mkArea("PREVIEWAREA", cityV._id, districtV._id, stateV._id);
        const candidate = await mkCandidate("PREVIEWAREA", cityV._id, districtV._id, stateV._id);
        previewCandidateId = candidate._id;

        const res = await preview(indiaToken, candidate._id);
        const json = await res.json();
        check("Preview endpoint returns 200", res.status === 200, res.status);
        check("Preview response has classification HIGH", json?.data?.classification === "HIGH", JSON.stringify(json));
        check("HIGH response has exactly 1 match", json?.data?.matches?.length === 1);
        check("HIGH response signal is EXACT", json?.data?.matches?.[0]?.signal === "EXACT");
        check("HIGH response overlapCount is null", json?.data?.matches?.[0]?.overlapCount === null);
        check("Response does not expose raw token arrays", !JSON.stringify(json).includes("candidateTokens") && !JSON.stringify(json).includes("areaTokens"));
      }

      //////////////////////////////////////////////////////////////
      // AUTH / IDOR
      //////////////////////////////////////////////////////////////
      {
        const okState = await preview(stateVToken, previewCandidateId);
        check("STATE admin can preview within own state", okState.status === 200, okState.status);

        const crossState = await preview(stateMToken, previewCandidateId);
        check("IDOR: cross-state STATE admin cannot preview another state's candidate", crossState.status === 403, crossState.status);

        const okDistrict = await preview(districtVToken, previewCandidateId);
        check("DISTRICT admin can preview within own district", okDistrict.status === 200, okDistrict.status);

        const faRes = await preview(fieldAgentToken, previewCandidateId);
        check("FIELD_AGENT cannot preview (403)", faRes.status === 403, faRes.status);

        const userRes = await preview(plainUserToken, previewCandidateId);
        check("Plain USER cannot preview (403)", userRes.status === 403, userRes.status);

        const malformed = await preview(indiaToken, "not-an-object-id");
        check("Malformed candidateId is rejected (400)", malformed.status === 400, malformed.status);

        const fakeId = new mongoose.Types.ObjectId();
        const notFound = await preview(indiaToken, fakeId);
        check("Non-existent candidateId returns 404", notFound.status === 404, notFound.status);
      }

      //////////////////////////////////////////////////////////////
      // NO WRITES / NO SIDE EFFECTS
      //////////////////////////////////////////////////////////////
      {
        const before = await AreaDiscoveryCandidate.findById(previewCandidateId).lean();
        await preview(indiaToken, previewCandidateId);
        await preview(indiaToken, previewCandidateId);
        const after = await AreaDiscoveryCandidate.findById(previewCandidateId).lean();
        check("Repeated preview calls do not modify the candidate document", JSON.stringify(before) === JSON.stringify(after));
        check("matchedAreaRef is never set by preview", after.matchedAreaRef === null);
      }

      //////////////////////////////////////////////////////////////
      // DETERMINISM
      //////////////////////////////////////////////////////////////
      {
        const r1 = await matchCandidateAgainstAreas({ ...geo, normalizedCandidateName: normalizeForIdentity("Civil Lines") });
        const r2 = await matchCandidateAgainstAreas({ ...geo, normalizedCandidateName: normalizeForIdentity("Civil Lines") });
        check("Repeated matching calls produce identical results", JSON.stringify(r1) === JSON.stringify(r2));
      }

      //////////////////////////////////////////////////////////////
      // QUERY PLAN / PERFORMANCE
      //////////////////////////////////////////////////////////////
      {
        const exactPlan = await Area.find({ cityRef: cityV._id, districtRef: districtV._id, stateRef: stateV._id, normalizedName: "x", isActive: true, isDeleted: false }).explain("queryPlanner");
        check("EXACT query uses an index scan (not COLLSCAN)", JSON.stringify(exactPlan.queryPlanner.winningPlan).includes("IXSCAN"), JSON.stringify(exactPlan.queryPlanner.winningPlan).slice(0, 300));

        const textPlan = await Area.find({ cityRef: cityV._id, districtRef: districtV._id, stateRef: stateV._id, isActive: true, isDeleted: false }).explain("queryPlanner");
        check("TEXT query uses an index scan (not COLLSCAN)", JSON.stringify(textPlan.queryPlanner.winningPlan).includes("IXSCAN"), JSON.stringify(textPlan.queryPlanner.winningPlan).slice(0, 300));
      }

      //////////////////////////////////////////////////////////////
      // FROZEN-SYSTEM PROTECTION
      //////////////////////////////////////////////////////////////
      {
        const diffFiles = execSync("git diff --name-only", { cwd: process.cwd() }).toString();
        check("models/Area.js not modified", !diffFiles.includes("models/Area.js"));
        check("models/AreaDiscoveryCandidate.js not modified", !diffFiles.includes("AreaDiscoveryCandidate.js"));
        check("controllers/areaDiscoveryCandidate.controller.js not modified", !diffFiles.includes("controllers/areaDiscoveryCandidate.controller.js"));
        check("validators/areaDiscoveryCandidate.validator.js not modified", !diffFiles.includes("validators/areaDiscoveryCandidate.validator.js"));
        check("services/geo.service.js not modified", !diffFiles.includes("geo.service.js"));
        check("only routes/admin.routes.js modified among tracked files", diffFiles.trim().split("\n").filter(Boolean).every((f) => f.includes("admin.routes.js")), diffFiles);

        const src = fs.readFileSync(path.join(process.cwd(), "services/areaDiscoveryMatching.service.js"), "utf8");
        const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
        check("Matching service contains no write operation (create/update/delete/save)", !/\.(create|updateOne|updateMany|deleteOne|deleteMany|findOneAndUpdate|findOneAndDelete|save)\(/.test(codeOnly), "found a write call");
      }

    } catch (innerErr) {
      console.error("TEST BODY ERROR:", innerErr);
      check("Test body completed without throwing", false, innerErr.message);
    }
  } finally {
    if (createdCandidateIds.length) await AreaDiscoveryCandidate.deleteMany({ _id: { $in: createdCandidateIds } });
    await AreaDiscoveryCandidate.deleteMany({ normalizedCandidateName: { $regex: `^${NAME_PREFIX.toLowerCase()}` } });
    if (createdAreaIds.length) await Area.deleteMany({ _id: { $in: createdAreaIds } });
    if (createdCityIds.length) await City.deleteMany({ _id: { $in: createdCityIds } });
    if (createdDistrictIds.length) await District.deleteMany({ _id: { $in: createdDistrictIds } });
    if (createdStateIds.length) await State.deleteMany({ _id: { $in: createdStateIds } });
    if (createdUserIds.length) await User.deleteMany({ _id: { $in: createdUserIds } });

    console.log("\n" + results.join("\n"));
    console.log(`\n${pass} passed, ${fail} failed`);
    console.log("\nCONCURRENCY: no write-concurrency test is included — matchCandidateAgainstAreas and the match-preview endpoint perform zero writes (verified above via the static write-call scan and the repeated-call no-mutation check), so there is no shared mutable state to race on.");

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
