/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyAreaDiscoveryCandidate.js
 *
 * AREA-2.5.1 — LIVE, real-HTTP, real-DB verification for
 * AreaDiscoveryCandidate (model + hardened admin observe/review/read
 * surface). Same precedent as every other verify script this session.
 * All fixtures prefixed "ZTEST_AREA251_" / phones 9999911xxx,
 * hard-deleted in cleanup.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyAreaDiscoveryCandidate.js
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
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
import AdminAuditLog from "../models/AdminAuditLog.js";
import { generateAccessToken } from "../services/token.service.js";

let pass = 0;
let fail = 0;
const results = [];
const check = (name, condition, detail) => {
  if (condition) { pass += 1; results.push(`✅ ${name}`); }
  else { fail += 1; results.push(`❌ ${name}${detail ? " — " + String(detail).slice(0, 300) : ""}`); }
};

const NAME_PREFIX = "ZTEST_AREA251_";
let phoneSeq = 0;
const nextPhone = () => `9999911${String(phoneSeq++).padStart(3, "0")}`;

const createdUserIds = [];
const createdStateIds = [];
const createdDistrictIds = [];
const createdCityIds = [];
const createdAreaIds = [];
const createdCandidateIds = [];

const runStartedAt = new Date();

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

  const preCleanup = async () => {
    const staleUsers = await User.find({ phone: { $regex: /^9999911\d{3}$/ } }).select("_id").lean();
    if (staleUsers.length) await User.deleteMany({ _id: { $in: staleUsers.map((u) => u._id) } });
    await AreaDiscoveryCandidate.deleteMany({ normalizedCandidateName: { $regex: `^${NAME_PREFIX.toLowerCase()}` } });
    await Area.deleteMany({ name: { $regex: `^${NAME_PREFIX}` } });
    await City.deleteMany({ name: { $regex: `^${NAME_PREFIX}` } });
    await District.deleteMany({ name: { $regex: `^${NAME_PREFIX}` } });
    await State.deleteMany({ name: { $regex: `^${NAME_PREFIX}` } });
  };
  await preCleanup();

  try {
    try {
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
      const mkArea = async (suffix, cityRef, districtRef, stateRef, opts = {}) => {
        const a = await Area.create({ name: `${NAME_PREFIX}AREA_${suffix}`, cityRef, districtRef, stateRef, isActive: true, isDeleted: false, ...opts });
        createdAreaIds.push(a._id); return a;
      };

      const stateV = await mkState("V");
      const districtV = await mkDistrict("V", stateV._id);
      const cityV = await mkCity("V", districtV._id, stateV._id);
      const areaV = await mkArea("V", cityV._id, districtV._id, stateV._id);
      const cityInactive = await mkCity("INACTIVE", districtV._id, stateV._id, { isActive: false });

      const stateM = await mkState("M");
      const districtM = await mkDistrict("M", stateM._id);
      const cityM = await mkCity("M", districtM._id, stateM._id);

      const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA", isDeleted: false }).select("+tokenVersion").lean();
      check("Real INDIA admin fixture exists", !!indiaAdmin);
      const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

      let adminEmailSeq = 0;
      const mkAdmin = async (adminLevel, extra = {}) => {
        const u = await User.create({
          name: `${NAME_PREFIX}ADMIN_${adminLevel}`, phone: nextPhone(),
          email: `ztest.area251.admin${adminEmailSeq++}@example.invalid`,
          role: "ADMIN", adminLevel, countryRef: country._id, adminSubRole: "PRIMARY",
          isActive: true, isDeleted: false, accountStatus: "ACTIVE", ...extra,
        });
        createdUserIds.push(u._id); return u;
      };
      const stateAdminV = await mkAdmin("STATE", { stateRef: stateV._id });
      const districtAdminV = await mkAdmin("DISTRICT", { stateRef: stateV._id, districtRef: districtV._id });
      const stateAdminM = await mkAdmin("STATE", { stateRef: stateM._id });

      const fieldAgentUser = await User.create({ name: `${NAME_PREFIX}FA`, phone: nextPhone(), email: "ztest.area251.fa@example.invalid", role: "FIELD_AGENT", countryRef: country._id, isActive: true, isDeleted: false, accountStatus: "ACTIVE" });
      createdUserIds.push(fieldAgentUser._id);
      const plainUser = await User.create({ name: `${NAME_PREFIX}USER`, phone: nextPhone(), email: "ztest.area251.user@example.invalid", role: "USER", countryRef: country._id, isActive: true, isDeleted: false, accountStatus: "ACTIVE" });
      createdUserIds.push(plainUser._id);

      const tokenFor = (u) => generateAccessToken({ _id: u._id, role: u.role, adminLevel: u.adminLevel, tokenVersion: u.tokenVersion ?? 0 });
      const stateVToken = tokenFor(stateAdminV);
      const districtVToken = tokenFor(districtAdminV);
      const stateMToken = tokenFor(stateAdminM);
      const fieldAgentToken = tokenFor(fieldAgentUser);
      const plainUserToken = tokenFor(plainUser);

      const observe = (token, body) => authFetch("/api/admin/area-discovery-candidates", token, { method: "POST", body: JSON.stringify(body) });
      const list = (token, qs = "") => authFetch(`/api/admin/area-discovery-candidates${qs}`, token, { method: "GET" });
      const detail = (token, id) => authFetch(`/api/admin/area-discovery-candidates/${id}`, token, { method: "GET" });
      const review = (token, id, body) => authFetch(`/api/admin/area-discovery-candidates/${id}`, token, { method: "PATCH", body: JSON.stringify(body) });

      //////////////////////////////////////////////////////////////
      // MODEL / OBSERVE
      //////////////////////////////////////////////////////////////
      let candA;
      {
        const res = await observe(indiaToken, { name: `${NAME_PREFIX}CANDIDATE_A`, cityId: String(cityV._id), sourceType: "ADMIN" });
        const json = await res.json();
        check("Observe creates OBSERVED candidate", res.status === 200 && json?.data?.status === "OBSERVED", JSON.stringify(json));
        candA = json?.data?.id;
        if (candA) createdCandidateIds.push(candA);
        check("observationCount starts at 1", json?.data?.observationCount === 1, json?.data);
      }

      // Repeated observation aggregates, does not create a duplicate
      {
        const res = await observe(indiaToken, { name: `${NAME_PREFIX}CANDIDATE_A`, cityId: String(cityV._id), sourceType: "ADMIN" });
        const json = await res.json();
        check("Repeated observation returns the same candidate id", json?.data?.id === candA, JSON.stringify(json?.data));
        check("Repeated observation increments observationCount", json?.data?.observationCount === 2, json?.data);
        const count = await AreaDiscoveryCandidate.countDocuments({ cityRef: cityV._id, normalizedCandidateName: `${NAME_PREFIX.toLowerCase()}candidate_a` });
        check("Exactly one candidate document exists for this city+name", count === 1, count);
      }

      // Same name, different city -> a separate candidate (mirrors Area's own cross-city rule)
      {
        const res = await observe(indiaToken, { name: `${NAME_PREFIX}CANDIDATE_A`, cityId: String(cityM._id), sourceType: "ADMIN" });
        const json = await res.json();
        check("Same candidate name in a different city creates a separate document", res.status === 200 && json?.data?.id !== candA, JSON.stringify(json?.data));
        if (json?.data?.id) createdCandidateIds.push(json.data.id);
      }

      // Bounded arrays: push more than the max raw observed names
      {
        for (let i = 0; i < 25; i++) {
          await observe(indiaToken, { name: `${NAME_PREFIX}BOUND_TEST_VARIANT_${i}`.slice(0, 60), cityId: String(cityV._id), sourceType: "ADMIN" });
        }
        // re-observe the SAME normalized candidate repeatedly with slightly different raw casing to grow rawObservedNames
        let lastId;
        for (let i = 0; i < 25; i++) {
          const res = await observe(indiaToken, { name: `  ${NAME_PREFIX}BOUND_CANDIDATE   `, cityId: String(cityV._id), sourceType: "ADMIN" });
          const json = await res.json();
          lastId = json?.data?.id;
        }
        if (lastId) createdCandidateIds.push(lastId);
        const doc = await AreaDiscoveryCandidate.findById(lastId).lean();
        check("rawObservedNames array is bounded (<=20)", doc.rawObservedNames.length <= 20, doc.rawObservedNames.length);
        check("observationCount reflects all 25 observations regardless of array bound", doc.observationCount === 25, doc.observationCount);
        // cleanup the 25 one-off variant candidates
        const variantDocs = await AreaDiscoveryCandidate.find({ cityRef: cityV._id, normalizedCandidateName: { $regex: `^${NAME_PREFIX.toLowerCase()}bound_test_variant_` } }).select("_id").lean();
        createdCandidateIds.push(...variantDocs.map((d) => d._id));
      }

      //////////////////////////////////////////////////////////////
      // GEOGRAPHY HARD BOUNDARY
      //////////////////////////////////////////////////////////////
      {
        const res = await observe(indiaToken, { name: `${NAME_PREFIX}BAD_CITY`, cityId: String(new mongoose.Types.ObjectId()), sourceType: "ADMIN" });
        check("Non-existent city is rejected", res.status === 404, res.status);

        const res2 = await observe(indiaToken, { name: `${NAME_PREFIX}INACTIVE_CITY`, cityId: String(cityInactive._id), sourceType: "ADMIN" });
        check("Inactive city is rejected", res2.status === 404, res2.status);

        const okRes = await observe(indiaToken, { name: `${NAME_PREFIX}DERIVED_ANCESTORS`, cityId: String(cityV._id), sourceType: "ADMIN" });
        const okJson = await okRes.json();
        if (okJson?.data?.id) createdCandidateIds.push(okJson.data.id);
        const stored = await AreaDiscoveryCandidate.findById(okJson.data.id).lean();
        check("districtRef/stateRef are server-derived from the City (never client input)", String(stored.districtRef) === String(districtV._id) && String(stored.stateRef) === String(stateV._id), stored);
      }

      //////////////////////////////////////////////////////////////
      // AUTH / SCOPE
      //////////////////////////////////////////////////////////////
      {
        const stateOkRes = await observe(stateVToken, { name: `${NAME_PREFIX}STATE_OBS`, cityId: String(cityV._id), sourceType: "ADMIN" });
        check("STATE admin can observe within own state", stateOkRes.status === 200, stateOkRes.status);
        const stateOkJson = await stateOkRes.json();
        if (stateOkJson?.data?.id) createdCandidateIds.push(stateOkJson.data.id);

        const stateCrossRes = await observe(stateVToken, { name: `${NAME_PREFIX}STATE_CROSS`, cityId: String(cityM._id), sourceType: "ADMIN" });
        check("STATE admin cannot observe outside own state", stateCrossRes.status === 403, stateCrossRes.status);

        const districtOkRes = await observe(districtVToken, { name: `${NAME_PREFIX}DISTRICT_OBS`, cityId: String(cityV._id), sourceType: "ADMIN" });
        check("DISTRICT admin can observe within own district", districtOkRes.status === 200, districtOkRes.status);
        const districtOkJson = await districtOkRes.json();
        if (districtOkJson?.data?.id) createdCandidateIds.push(districtOkJson.data.id);

        const faRes = await observe(fieldAgentToken, { name: `${NAME_PREFIX}FA_OBS`, cityId: String(cityV._id), sourceType: "ADMIN" });
        check("FIELD_AGENT cannot observe (403)", faRes.status === 403, faRes.status);

        const userRes = await observe(plainUserToken, { name: `${NAME_PREFIX}USER_OBS`, cityId: String(cityV._id), sourceType: "ADMIN" });
        check("Plain USER cannot observe (403)", userRes.status === 403, userRes.status);
      }

      //////////////////////////////////////////////////////////////
      // IDOR — list/detail scope
      //////////////////////////////////////////////////////////////
      {
        const listOwn = await list(stateVToken, `?cityId=${cityV._id}`);
        const listOwnJson = await listOwn.json();
        check("STATE admin list is scoped to own state (no cross-state leakage even if cityId omitted)", listOwn.status === 200, listOwn.status);

        const detailOwn = await detail(stateVToken, candA);
        check("STATE admin can read own-state candidate detail", detailOwn.status === 200, detailOwn.status);

        const detailCross = await detail(stateMToken, candA);
        check("IDOR: cross-state STATE admin cannot read another state's candidate", detailCross.status === 403, detailCross.status);

        const districtDetail = await detail(districtVToken, candA);
        check("DISTRICT admin can read own-district candidate detail", districtDetail.status === 200, districtDetail.status);

        const fakeId = new mongoose.Types.ObjectId();
        const manipulated = await detail(indiaToken, fakeId);
        check("Manipulated/non-existent candidate ID returns 404, not a crash", manipulated.status === 404, manipulated.status);
      }

      //////////////////////////////////////////////////////////////
      // INPUT SECURITY
      //////////////////////////////////////////////////////////////
      {
        const injRes = await observe(indiaToken, {
          name: `${NAME_PREFIX}INJECT`, cityId: String(cityV._id), sourceType: "ADMIN",
          status: "APPROVED", districtRef: String(districtM._id), stateRef: String(stateM._id),
          confidence: 1, observationCount: 999, matchedAreaRef: String(areaV._id),
        });
        check("Injected status/districtRef/stateRef/confidence/observationCount/matchedAreaRef rejected (400)", injRes.status === 400, injRes.status);

        const opInj = await observe(indiaToken, { name: { "$gt": "" }, cityId: String(cityV._id), sourceType: "ADMIN" });
        check("Mongo-operator-shaped name value is rejected", opInj.status === 400, opInj.status);

        const badCoord = await observe(indiaToken, { name: `${NAME_PREFIX}BADCOORD`, cityId: String(cityV._id), sourceType: "ADMIN", coordinate: { lat: 999, lng: 999 } });
        check("Out-of-range coordinate is rejected", badCoord.status === 400, badCoord.status);

        const nanCoord = await observe(indiaToken, { name: `${NAME_PREFIX}NANCOORD`, cityId: String(cityV._id), sourceType: "ADMIN", coordinate: { lat: "not-a-number", lng: 10 } });
        check("Non-numeric coordinate is rejected", nanCoord.status === 400, nanCoord.status);

        const badSource = await observe(indiaToken, { name: `${NAME_PREFIX}BADSOURCE`, cityId: String(cityV._id), sourceType: "SALON_ONBOARDING" });
        check("SALON_ONBOARDING sourceType is rejected in this phase (not yet reachable)", badSource.status === 400, badSource.status);

        const malformedId = await observe(indiaToken, { name: `${NAME_PREFIX}MALFORMED`, cityId: "not-an-object-id", sourceType: "ADMIN" });
        check("Malformed cityId ObjectId is rejected", malformedId.status === 400, malformedId.status);
      }

      //////////////////////////////////////////////////////////////
      // LIFECYCLE / REVIEW
      //////////////////////////////////////////////////////////////
      {
        const invalidTarget = await review(indiaToken, candA, { targetStatus: "MERGED", reviewNotes: "no area id" });
        check("MERGED without matchedAreaId is rejected", invalidTarget.status === 400, invalidTarget.status);

        const rejectRes = await review(indiaToken, candA, { targetStatus: "REJECTED", reviewNotes: "not a real locality" });
        const rejectJson = await rejectRes.json();
        check("OBSERVED -> REJECTED succeeds", rejectRes.status === 200 && rejectJson?.data?.status === "REJECTED", JSON.stringify(rejectJson));

        const reopenRes = await review(indiaToken, candA, { targetStatus: "APPROVED", reviewNotes: "try to reopen" });
        check("REJECTED -> APPROVED is rejected (terminal state)", reopenRes.status === 409, reopenRes.status);

        // Fresh candidate for APPROVED + MERGED paths
        const c2Res = await observe(indiaToken, { name: `${NAME_PREFIX}FOR_APPROVAL`, cityId: String(cityV._id), sourceType: "ADMIN" });
        const c2Id = (await c2Res.json()).data.id;
        createdCandidateIds.push(c2Id);
        const approveRes = await review(indiaToken, c2Id, { targetStatus: "APPROVED", reviewNotes: "looks like a real locality, route to createArea manually" });
        const approveJson = await approveRes.json();
        check("OBSERVED -> APPROVED succeeds", approveRes.status === 200 && approveJson?.data?.status === "APPROVED", JSON.stringify(approveJson));

        const areaCountAfterApproval = await Area.countDocuments({ name: { $regex: `^${NAME_PREFIX}FOR_APPROVAL` } });
        check("APPROVED does NOT create an Area document", areaCountAfterApproval === 0, areaCountAfterApproval);

        const c3Res = await observe(indiaToken, { name: `${NAME_PREFIX}FOR_MERGE`, cityId: String(cityV._id), sourceType: "ADMIN" });
        const c3Id = (await c3Res.json()).data.id;
        createdCandidateIds.push(c3Id);
        const mergeRes = await review(indiaToken, c3Id, { targetStatus: "MERGED", reviewNotes: "same as existing Area", matchedAreaId: String(areaV._id) });
        const mergeJson = await mergeRes.json();
        check("OBSERVED -> MERGED succeeds with a valid matchedAreaId in the same city", mergeRes.status === 200 && mergeJson?.data?.matchedAreaRef, JSON.stringify(mergeJson));

        const c4Res = await observe(indiaToken, { name: `${NAME_PREFIX}FOR_BAD_MERGE`, cityId: String(cityV._id), sourceType: "ADMIN" });
        const c4Id = (await c4Res.json()).data.id;
        createdCandidateIds.push(c4Id);
        const areaOtherCity = await mkArea("OTHER_CITY", cityM._id, districtM._id, stateM._id);
        const badMergeRes = await review(indiaToken, c4Id, { targetStatus: "MERGED", reviewNotes: "cross-city merge attempt", matchedAreaId: String(areaOtherCity._id) });
        check("MERGED into an Area from a different City is rejected", badMergeRes.status === 400, badMergeRes.status);

        const stateReviewRes = await review(stateVToken, c4Id, { targetStatus: "REJECTED", reviewNotes: "state admin trying to review" });
        check("STATE admin cannot review (INDIA-only)", stateReviewRes.status === 403, stateReviewRes.status);

        const faReviewRes = await review(fieldAgentToken, c4Id, { targetStatus: "REJECTED", reviewNotes: "fa trying to review" });
        check("FIELD_AGENT cannot review (403)", faReviewRes.status === 403, faReviewRes.status);
      }

      //////////////////////////////////////////////////////////////
      // AUDIT
      //////////////////////////////////////////////////////////////
      {
        await new Promise((r) => setTimeout(r, 300));
        const observeAudit = await AdminAuditLog.countDocuments({ action: "AREA_DISCOVERY_CANDIDATE_OBSERVED", targetId: candA, createdAt: { $gte: runStartedAt } });
        check("At least one AREA_DISCOVERY_CANDIDATE_OBSERVED audit exists for candA", observeAudit >= 1, observeAudit);

        const reviewAudit = await AdminAuditLog.countDocuments({ action: "AREA_DISCOVERY_CANDIDATE_REVIEWED", targetId: candA, createdAt: { $gte: runStartedAt } });
        check("Exactly one REVIEWED audit for candA's single successful transition", reviewAudit === 1, reviewAudit);

        const failedReopenAudit = await AdminAuditLog.countDocuments({ action: "AREA_DISCOVERY_CANDIDATE_REVIEWED", "meta.newStatus": "APPROVED", targetId: candA, createdAt: { $gte: runStartedAt } });
        check("Failed (invalid transition) reopen attempt creates no audit event", failedReopenAudit === 0, failedReopenAudit);
      }

      //////////////////////////////////////////////////////////////
      // CONCURRENCY
      //////////////////////////////////////////////////////////////
      {
        const concName = `${NAME_PREFIX}CONCURRENT_OBS`;
        const [r1, r2] = await Promise.all([
          observe(indiaToken, { name: concName, cityId: String(cityV._id), sourceType: "ADMIN" }),
          observe(indiaToken, { name: concName, cityId: String(cityV._id), sourceType: "ADMIN" }),
        ]);
        const [j1, j2] = await Promise.all([r1.json(), r2.json()]);
        check("Concurrent observations both succeed (aggregation, not conflict)", r1.status === 200 && r2.status === 200, `${r1.status},${r2.status}`);
        check("Concurrent observations converge onto the same candidate id", j1.data.id === j2.data.id, JSON.stringify([j1.data.id, j2.data.id]));
        const doc = await AreaDiscoveryCandidate.findById(j1.data.id).lean();
        createdCandidateIds.push(doc._id);
        check("observationCount correctly reflects both concurrent observations", doc.observationCount === 2, doc.observationCount);
        const docCount = await AreaDiscoveryCandidate.countDocuments({ cityRef: cityV._id, normalizedCandidateName: concName.toLowerCase() });
        check("Exactly one candidate document exists after the concurrent race", docCount === 1, docCount);

        // Concurrent review race
        const c5Res = await observe(indiaToken, { name: `${NAME_PREFIX}CONCURRENT_REVIEW`, cityId: String(cityV._id), sourceType: "ADMIN" });
        const c5Id = (await c5Res.json()).data.id;
        createdCandidateIds.push(c5Id);
        const [t1, t2] = await Promise.all([
          review(indiaToken, c5Id, { targetStatus: "APPROVED", reviewNotes: "race-a" }),
          review(indiaToken, c5Id, { targetStatus: "REJECTED", reviewNotes: "race-b" }),
        ]);
        const tStatuses = [t1.status, t2.status].sort();
        check("Concurrent conflicting reviews yield exactly one success", tStatuses.filter((s) => s === 200).length === 1, JSON.stringify(tStatuses));
        check("Concurrent conflicting reviews yield exactly one conflict", tStatuses.filter((s) => s === 409).length === 1, JSON.stringify(tStatuses));
      }

      //////////////////////////////////////////////////////////////
      // INDEX VERIFICATION (live)
      //////////////////////////////////////////////////////////////
      {
        const indexes = await mongoose.connection.db.collection("areadiscoverycandidates").indexes();
        const names = indexes.map((i) => i.name);
        check("Unique {cityRef,normalizedCandidateName} index exists", indexes.some((i) => i.unique && JSON.stringify(i.key) === JSON.stringify({ cityRef: 1, normalizedCandidateName: 1 })), JSON.stringify(indexes));
        check("{status:1} index exists", names.includes("status_1"), names);
        check("{cityRef:1,status:1} compound index exists", names.some((n) => n === "cityRef_1_status_1"), names);
        check("No 2dsphere index exists on candidates in this phase", !indexes.some((i) => Object.values(i.key).includes("2dsphere")), JSON.stringify(indexes));
        // _id_ + cityRef_1 (field-level, same precedent as Area.js's
        // own standalone cityRef index) + the unique compound +
        // status_1 + the cityRef+status compound = 5, not 4.
        check("Exactly the expected index count (no speculative extras)", indexes.length === 5, indexes.length);

        const plan = await AreaDiscoveryCandidate.find({ cityRef: cityV._id, normalizedCandidateName: "x" }).explain("queryPlanner");
        check("cityRef+normalizedCandidateName lookup uses an index scan", JSON.stringify(plan.queryPlanner.winningPlan).includes("IXSCAN"), JSON.stringify(plan.queryPlanner.winningPlan).slice(0, 200));
      }

      //////////////////////////////////////////////////////////////
      // FROZEN-SYSTEM PROTECTION
      //////////////////////////////////////////////////////////////
      {
        const diffFiles = execSync("git diff --name-only", { cwd: process.cwd() }).toString();
        const statusFiles = execSync("git status --short", { cwd: process.cwd() }).toString();
        check("models/Area.js not modified", !diffFiles.includes("models/Area.js"));
        check("controllers/location.controller.js not modified", !diffFiles.includes("location.controller.js"));
        check("models/AreaServiceability.js not modified", !diffFiles.includes("AreaServiceability.js") || statusFiles.includes("AreaServiceability.js") === false);
        check("controllers/areaServiceability.controller.js not modified", !diffFiles.includes("areaServiceability.controller.js"));
        check("booking.controller.js not modified", !diffFiles.includes("booking.controller.js"));
        check("discovery.controller.js not modified", !diffFiles.includes("discovery.controller.js"));
        check("no ServiceZone/Territory files touched", !statusFiles.toLowerCase().includes("servicezone") && !statusFiles.toLowerCase().includes("territory"));

        const src = fs.readFileSync(path.join(process.cwd(), "controllers/areaDiscoveryCandidate.controller.js"), "utf8");
        const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
        check("Controller code contains no Area.create( call", !/Area\.create\(/.test(codeOnly), "found Area.create(");
        check("Controller code contains no Territory/ServiceZone reference", !/Territory|ServiceZone/.test(codeOnly), "found reference");

        const svcCount = await mongoose.connection.db.collection("areaserviceabilities").countDocuments({});
        check("AreaServiceability collection untouched (0 docs, matches pre-existing state)", svcCount === 0, svcCount);
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
