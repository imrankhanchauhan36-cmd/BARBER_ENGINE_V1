/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyAreaDiscoveryResolution.js
 *
 * AREA-2.5.3 — LIVE, real-HTTP, real-DB verification for Controlled
 * Candidate -> Salon Area Resolution. Same precedent as every other
 * verify script this session. All fixtures prefixed
 * "ZTEST_AREA253_" / phones 9999913xxx, hard-deleted in cleanup by
 * exact tracked _id only — never a broad destructive deletion.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyAreaDiscoveryResolution.js
 */

import "dotenv/config";
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
import Salon from "../models/Salon.js";
import AdminAuditLog from "../models/AdminAuditLog.js";
import { generateAccessToken } from "../services/token.service.js";

let pass = 0;
let fail = 0;
const results = [];
const check = (name, condition, detail) => {
  if (condition) { pass += 1; results.push(`✅ ${name}`); }
  else { fail += 1; results.push(`❌ ${name}${detail ? " — " + String(detail).slice(0, 300) : ""}`); }
};

const NAME_PREFIX = "ZTEST_AREA253_";
let phoneSeq = 0;
const nextPhone = () => `9999913${String(phoneSeq++).padStart(3, "0")}`;

// Ownership-safe cleanup — only ever by exact tracked _id.
const createdUserIds = [];
const createdStateIds = [];
const createdDistrictIds = [];
const createdCityIds = [];
const createdAreaIds = [];
const createdCandidateIds = [];
const createdSalonIds = [];

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
        const a = await Area.create({ name: `Area ${suffix}`, cityRef, districtRef, stateRef, isActive: true, isDeleted: false, ...opts });
        createdAreaIds.push(a._id); return a;
      };
      const mkCandidate = async (cityRef, districtRef, stateRef, matchedAreaRef, status = "MERGED", opts = {}) => {
        const c = await AreaDiscoveryCandidate.create({
          normalizedCandidateName: `candidate ${new mongoose.Types.ObjectId()}`,
          rawObservedNames: ["Test Candidate"],
          cityRef, districtRef, stateRef,
          sourceType: "ADMIN",
          status,
          matchedAreaRef,
          reviewedBy: new mongoose.Types.ObjectId(),
          reviewedAt: status !== "OBSERVED" ? new Date() : null,
          reviewNotes: status !== "OBSERVED" ? "test review" : null,
          ...opts,
        });
        createdCandidateIds.push(c._id); return c;
      };
      const dayTiming = { open: "09:00", close: "20:00" };
      const timings = {
        monday: dayTiming, tuesday: dayTiming, wednesday: dayTiming, thursday: dayTiming,
        friday: dayTiming, saturday: dayTiming, sunday: dayTiming,
      };
      const mkSalon = async (suffix, cityRef, districtRef, stateRef, opts = {}) => {
        const territory = { cityRef, districtRef, stateRef, areaRef: null, ...opts };
        const s = await Salon.create({
          ownerId: new mongoose.Types.ObjectId(),
          basicInfo: { shopName: `${NAME_PREFIX}SALON_${suffix}`, category: "UNISEX" },
          location: { address: `${NAME_PREFIX} address ${suffix}`, geo: { type: "Point", coordinates: [77, 28] }, territory },
          timings,
          isDeleted: false,
        });
        createdSalonIds.push(s._id); return s;
      };

      const stateV = await mkState("V");
      const districtV = await mkDistrict("V", stateV._id);
      const cityV = await mkCity("V", districtV._id, stateV._id);

      const stateM = await mkState("M");
      const districtM = await mkDistrict("M", stateM._id);
      const cityM = await mkCity("M", districtM._id, stateM._id);
      const districtM2 = await mkDistrict("M2", stateV._id);
      const cityM2 = await mkCity("M2", districtM2._id, stateV._id);

      const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA", isDeleted: false }).select("+tokenVersion").lean();
      check("Real INDIA admin fixture exists", !!indiaAdmin);
      const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

      let adminEmailSeq = 0;
      const mkAdmin = async (adminLevel, extra = {}) => {
        const u = await User.create({
          name: `${NAME_PREFIX}ADMIN_${adminLevel}`, phone: nextPhone(),
          email: `ztest.area253.admin${adminEmailSeq++}@example.invalid`,
          role: "ADMIN", adminLevel, countryRef: country._id, adminSubRole: "PRIMARY",
          isActive: true, isDeleted: false, accountStatus: "ACTIVE", ...extra,
        });
        createdUserIds.push(u._id); return u;
      };
      const stateAdminV = await mkAdmin("STATE", { stateRef: stateV._id });
      const districtAdminV = await mkAdmin("DISTRICT", { stateRef: stateV._id, districtRef: districtV._id });

      const fieldAgentUser = await User.create({ name: `${NAME_PREFIX}FA`, phone: nextPhone(), email: "ztest.area253.fa@example.invalid", role: "FIELD_AGENT", countryRef: country._id, isActive: true, isDeleted: false, accountStatus: "ACTIVE" });
      createdUserIds.push(fieldAgentUser._id);
      const plainUser = await User.create({ name: `${NAME_PREFIX}USER`, phone: nextPhone(), email: "ztest.area253.user@example.invalid", role: "USER", countryRef: country._id, isActive: true, isDeleted: false, accountStatus: "ACTIVE" });
      createdUserIds.push(plainUser._id);

      const tokenFor = (u) => generateAccessToken({ _id: u._id, role: u.role, adminLevel: u.adminLevel, tokenVersion: u.tokenVersion ?? 0 });
      const stateVToken = tokenFor(stateAdminV);
      const districtVToken = tokenFor(districtAdminV);
      const fieldAgentToken = tokenFor(fieldAgentUser);
      const plainUserToken = tokenFor(plainUser);

      const resolve = (token, candidateId, body) =>
        authFetch(`/api/admin/area-discovery-candidates/${candidateId}/resolve-salon`, token, { method: "POST", body: JSON.stringify(body) });

      const geo = { cityRef: cityV._id, districtRef: districtV._id, stateRef: stateV._id };

      // ── 1. Happy path ────────────────────────────────────────────
      let happySalonId;
      {
        const area = await mkArea("HAPPY", geo.cityRef, geo.districtRef, geo.stateRef);
        const candidate = await mkCandidate(geo.cityRef, geo.districtRef, geo.stateRef, area._id);
        const salon = await mkSalon("HAPPY", geo.cityRef, geo.districtRef, geo.stateRef);
        happySalonId = salon._id;

        const res = await resolve(indiaToken, candidate._id, { salonId: String(salon._id) });
        const json = await res.json();
        check("1. MERGED + valid Area + same geography => success", res.status === 200, JSON.stringify(json));

        const updated = await Salon.findById(salon._id).lean();
        check("1. Salon.areaRef is now set to the candidate's matchedAreaRef", String(updated.location.territory.areaRef) === String(area._id), updated.location.territory.areaRef);
      }

      // ── 2. Missing Area ──────────────────────────────────────────
      {
        const fakeAreaId = new mongoose.Types.ObjectId();
        const candidate = await mkCandidate(geo.cityRef, geo.districtRef, geo.stateRef, fakeAreaId);
        const salon = await mkSalon("MISSING_AREA", geo.cityRef, geo.districtRef, geo.stateRef);
        const before = await Salon.findById(salon._id).lean();
        const res = await resolve(indiaToken, candidate._id, { salonId: String(salon._id) });
        check("2. missing Area => reject", res.status === 404, res.status);
        const after = await Salon.findById(salon._id).lean();
        check("2. Salon unchanged", JSON.stringify(before) === JSON.stringify(after));
      }

      // ── 3. Inactive Area ─────────────────────────────────────────
      {
        const area = await mkArea("INACTIVE", geo.cityRef, geo.districtRef, geo.stateRef, { isActive: false });
        const candidate = await mkCandidate(geo.cityRef, geo.districtRef, geo.stateRef, area._id);
        const salon = await mkSalon("INACTIVE_AREA", geo.cityRef, geo.districtRef, geo.stateRef);
        const before = await Salon.findById(salon._id).lean();
        const res = await resolve(indiaToken, candidate._id, { salonId: String(salon._id) });
        check("3. inactive Area => reject", res.status === 409, res.status);
        const after = await Salon.findById(salon._id).lean();
        check("3. Salon unchanged", JSON.stringify(before) === JSON.stringify(after));
      }

      // ── 4. Deleted Area ──────────────────────────────────────────
      {
        const area = await mkArea("DELETED", geo.cityRef, geo.districtRef, geo.stateRef, { isDeleted: true });
        const candidate = await mkCandidate(geo.cityRef, geo.districtRef, geo.stateRef, area._id);
        const salon = await mkSalon("DELETED_AREA", geo.cityRef, geo.districtRef, geo.stateRef);
        const before = await Salon.findById(salon._id).lean();
        const res = await resolve(indiaToken, candidate._id, { salonId: String(salon._id) });
        check("4. deleted Area => reject", res.status === 409, res.status);
        const after = await Salon.findById(salon._id).lean();
        check("4. Salon unchanged", JSON.stringify(before) === JSON.stringify(after));
      }

      // ── 5/6/7. Area wrong city/district/state ────────────────────
      {
        const areaWrongCity = await mkArea("WRONGCITY", cityM._id, districtM._id, stateM._id);
        const c5 = await mkCandidate(geo.cityRef, geo.districtRef, geo.stateRef, areaWrongCity._id);
        const s5 = await mkSalon("WRONG_CITY_AREA", geo.cityRef, geo.districtRef, geo.stateRef);
        const before5 = await Salon.findById(s5._id).lean();
        const r5 = await resolve(indiaToken, c5._id, { salonId: String(s5._id) });
        check("5. Area wrong City => reject", r5.status === 409, r5.status);
        check("5. Salon unchanged", JSON.stringify(before5) === JSON.stringify(await Salon.findById(s5._id).lean()));

        // wrong district, same city is structurally impossible (district derives city);
        // simulate by an Area whose stored districtRef differs from candidate's while cityRef coincidentally matches is not natural,
        // so we test via a candidate/Area pair in districtM2 (same state, different district) vs geo's district.
        const areaWrongDistrict = await mkArea("WRONGDISTRICT", cityM2._id, districtM2._id, stateV._id);
        const c6 = await mkCandidate(geo.cityRef, geo.districtRef, geo.stateRef, areaWrongDistrict._id);
        const s6 = await mkSalon("WRONG_DISTRICT_AREA", geo.cityRef, geo.districtRef, geo.stateRef);
        const before6 = await Salon.findById(s6._id).lean();
        const r6 = await resolve(indiaToken, c6._id, { salonId: String(s6._id) });
        check("6. Area wrong District => reject", r6.status === 409, r6.status);
        check("6. Salon unchanged", JSON.stringify(before6) === JSON.stringify(await Salon.findById(s6._id).lean()));

        const areaWrongState = await mkArea("WRONGSTATE", cityM._id, districtM._id, stateM._id);
        const c7 = await mkCandidate(geo.cityRef, geo.districtRef, geo.stateRef, areaWrongState._id);
        const s7 = await mkSalon("WRONG_STATE_AREA", geo.cityRef, geo.districtRef, geo.stateRef);
        const before7 = await Salon.findById(s7._id).lean();
        const r7 = await resolve(indiaToken, c7._id, { salonId: String(s7._id) });
        check("7. Area wrong State => reject", r7.status === 409, r7.status);
        check("7. Salon unchanged", JSON.stringify(before7) === JSON.stringify(await Salon.findById(s7._id).lean()));
      }

      // ── 8/9/10. Salon wrong city/district/state ──────────────────
      {
        const area = await mkArea("SALONSCOPE", geo.cityRef, geo.districtRef, geo.stateRef);

        const c8 = await mkCandidate(geo.cityRef, geo.districtRef, geo.stateRef, area._id);
        const s8 = await mkSalon("SALON_WRONG_CITY", cityM._id, districtM._id, stateM._id);
        const before8 = await Salon.findById(s8._id).lean();
        const r8 = await resolve(indiaToken, c8._id, { salonId: String(s8._id) });
        check("8. Salon wrong City => reject", r8.status === 409, r8.status);
        check("8. Salon unchanged", JSON.stringify(before8) === JSON.stringify(await Salon.findById(s8._id).lean()));

        const c9 = await mkCandidate(geo.cityRef, geo.districtRef, geo.stateRef, area._id);
        const s9 = await mkSalon("SALON_WRONG_DISTRICT", cityM2._id, districtM2._id, stateV._id);
        const before9 = await Salon.findById(s9._id).lean();
        const r9 = await resolve(indiaToken, c9._id, { salonId: String(s9._id) });
        check("9. Salon wrong District => reject", r9.status === 409, r9.status);
        check("9. Salon unchanged", JSON.stringify(before9) === JSON.stringify(await Salon.findById(s9._id).lean()));

        const c10 = await mkCandidate(geo.cityRef, geo.districtRef, geo.stateRef, area._id);
        const s10 = await mkSalon("SALON_WRONG_STATE", cityM._id, districtM._id, stateM._id);
        const before10 = await Salon.findById(s10._id).lean();
        const r10 = await resolve(indiaToken, c10._id, { salonId: String(s10._id) });
        check("10. Salon wrong State => reject", r10.status === 409, r10.status);
        check("10. Salon unchanged", JSON.stringify(before10) === JSON.stringify(await Salon.findById(s10._id).lean()));
      }

      // ── 11. Salon already has areaRef ────────────────────────────
      {
        const area = await mkArea("ALREADYSET", geo.cityRef, geo.districtRef, geo.stateRef);
        const otherArea = await mkArea("ALREADYSET_OTHER", geo.cityRef, geo.districtRef, geo.stateRef);
        const candidate = await mkCandidate(geo.cityRef, geo.districtRef, geo.stateRef, area._id);
        const salon = await mkSalon("ALREADY_HAS_AREA", geo.cityRef, geo.districtRef, geo.stateRef, { areaRef: otherArea._id });
        const before = await Salon.findById(salon._id).lean();
        const res = await resolve(indiaToken, candidate._id, { salonId: String(salon._id) });
        check("11. Salon already has areaRef => reject", res.status === 409, res.status);
        const after = await Salon.findById(salon._id).lean();
        check("11. Salon unchanged (still points to the original Area)", String(after.location.territory.areaRef) === String(otherArea._id));
      }

      // ── 12/13/14/15. Candidate status/matchedAreaRef gates ────────
      {
        const area = await mkArea("STATUSGATE", geo.cityRef, geo.districtRef, geo.stateRef);

        const cObs = await mkCandidate(geo.cityRef, geo.districtRef, geo.stateRef, null, "OBSERVED");
        const sObs = await mkSalon("STATUS_OBSERVED", geo.cityRef, geo.districtRef, geo.stateRef);
        const rObs = await resolve(indiaToken, cObs._id, { salonId: String(sObs._id) });
        check("12. OBSERVED candidate => reject", rObs.status === 409, rObs.status);

        const cRej = await mkCandidate(geo.cityRef, geo.districtRef, geo.stateRef, null, "REJECTED");
        const sRej = await mkSalon("STATUS_REJECTED", geo.cityRef, geo.districtRef, geo.stateRef);
        const rRej = await resolve(indiaToken, cRej._id, { salonId: String(sRej._id) });
        check("13. REJECTED candidate => reject", rRej.status === 409, rRej.status);

        const cApp = await mkCandidate(geo.cityRef, geo.districtRef, geo.stateRef, null, "APPROVED");
        const sApp = await mkSalon("STATUS_APPROVED", geo.cityRef, geo.districtRef, geo.stateRef);
        const rApp = await resolve(indiaToken, cApp._id, { salonId: String(sApp._id) });
        check("14. APPROVED candidate => reject", rApp.status === 409, rApp.status);

        const cNullArea = await mkCandidate(geo.cityRef, geo.districtRef, geo.stateRef, null, "MERGED");
        const sNullArea = await mkSalon("STATUS_MERGED_NULL_AREA", geo.cityRef, geo.districtRef, geo.stateRef);
        const rNullArea = await resolve(indiaToken, cNullArea._id, { salonId: String(sNullArea._id) });
        check("15. MERGED candidate with null matchedAreaRef => reject", rNullArea.status === 409, rNullArea.status);
      }

      // ── 16-25. Input validation ───────────────────────────────────
      {
        const area = await mkArea("INPUTVALID", geo.cityRef, geo.districtRef, geo.stateRef);
        const candidate = await mkCandidate(geo.cityRef, geo.districtRef, geo.stateRef, area._id);
        const salon = await mkSalon("INPUT_VALID_TARGET", geo.cityRef, geo.districtRef, geo.stateRef);

        const r16 = await resolve(indiaToken, "not-an-object-id", { salonId: String(salon._id) });
        check("16. malformed candidateId => 400", r16.status === 400, r16.status);

        const r17 = await resolve(indiaToken, candidate._id, { salonId: "not-an-object-id" });
        check("17. malformed salonId => 400", r17.status === 400, r17.status);

        const r18 = await resolve(indiaToken, candidate._id, {});
        check("18. missing salonId => 400", r18.status === 400, r18.status);

        const r19 = await resolve(indiaToken, candidate._id, { salonId: String(salon._id), unexpectedField: "x" });
        check("19. unknown body field => 400", r19.status === 400, r19.status);

        const r20 = await resolve(indiaToken, candidate._id, { salonId: String(salon._id), areaId: String(area._id) });
        check("20. areaId supplied => 400", r20.status === 400, r20.status);

        const r21 = await resolve(indiaToken, candidate._id, { salonId: String(salon._id), cityRef: String(cityM._id) });
        check("21. cityRef supplied => 400", r21.status === 400, r21.status);

        const r22 = await resolve(indiaToken, candidate._id, { salonId: String(salon._id), districtRef: String(districtM._id) });
        check("22. districtRef supplied => 400", r22.status === 400, r22.status);

        const r23 = await resolve(indiaToken, candidate._id, { salonId: String(salon._id), stateRef: String(stateM._id) });
        check("23. stateRef supplied => 400", r23.status === 400, r23.status);

        const r24 = await resolve(indiaToken, candidate._id, { salonId: String(salon._id), status: "APPROVED" });
        check("24. status supplied => 400", r24.status === 400, r24.status);

        const r25 = await resolve(indiaToken, candidate._id, { salonId: String(salon._id), matchedAreaRef: String(area._id) });
        check("25. matchedAreaRef supplied => 400", r25.status === 400, r25.status);

        // confirm the valid combination still works after all the negative input tests
        const rValid = await resolve(indiaToken, candidate._id, { salonId: String(salon._id) });
        check("Input-validation section: valid body still succeeds", rValid.status === 200, rValid.status);
      }

      // ── 26-30. Authorization / IDOR ───────────────────────────────
      {
        const area = await mkArea("AUTHZ", geo.cityRef, geo.districtRef, geo.stateRef);
        const candidate = await mkCandidate(geo.cityRef, geo.districtRef, geo.stateRef, area._id);
        const salon = await mkSalon("AUTHZ_TARGET", geo.cityRef, geo.districtRef, geo.stateRef);

        const rState = await resolve(stateVToken, candidate._id, { salonId: String(salon._id) });
        check("27. STATE admin => 403", rState.status === 403, rState.status);

        const rDistrict = await resolve(districtVToken, candidate._id, { salonId: String(salon._id) });
        check("28. DISTRICT admin => 403", rDistrict.status === 403, rDistrict.status);

        const rFA = await resolve(fieldAgentToken, candidate._id, { salonId: String(salon._id) });
        check("29. FIELD_AGENT => 403", rFA.status === 403, rFA.status);

        const rUser = await resolve(plainUserToken, candidate._id, { salonId: String(salon._id) });
        check("30. USER => 403", rUser.status === 403, rUser.status);

        // 26. cross-scope/IDOR — a STATE admin from an unrelated state also 403 (already covered by 27's generic INDIA-only gate;
        // additionally confirm the salon truly remains untouched by all of the above rejected attempts)
        const untouched = await Salon.findById(salon._id).lean();
        check("26. IDOR/authorization: Salon remains unassigned after all rejected attempts", untouched.location.territory.areaRef === null);

        // confirm INDIA can still succeed on this same fixture
        const rIndia = await resolve(indiaToken, candidate._id, { salonId: String(salon._id) });
        check("Authorization section: INDIA admin succeeds", rIndia.status === 200, rIndia.status);
      }

      // ── 31. Concurrency ────────────────────────────────────────────
      {
        const area = await mkArea("CONCURRENT", geo.cityRef, geo.districtRef, geo.stateRef);
        const candidate = await mkCandidate(geo.cityRef, geo.districtRef, geo.stateRef, area._id);
        const salon = await mkSalon("CONCURRENT_TARGET", geo.cityRef, geo.districtRef, geo.stateRef);

        const [r1, r2] = await Promise.all([
          resolve(indiaToken, candidate._id, { salonId: String(salon._id) }),
          resolve(indiaToken, candidate._id, { salonId: String(salon._id) }),
        ]);
        const statuses = [r1.status, r2.status].sort();
        check("31. Concurrent same-salon resolution: exactly one success", statuses.filter((s) => s === 200).length === 1, JSON.stringify(statuses));
        check("31. Concurrent same-salon resolution: exactly one deterministic conflict", statuses.filter((s) => s === 409).length === 1, JSON.stringify(statuses));

        const finalSalon = await Salon.findById(salon._id).lean();
        check("31. Final Salon has exactly one areaRef (the matched Area)", String(finalSalon.location.territory.areaRef) === String(area._id));
      }

      // ── 32/33. Audit ───────────────────────────────────────────────
      {
        const area = await mkArea("AUDIT", geo.cityRef, geo.districtRef, geo.stateRef);
        const candidate = await mkCandidate(geo.cityRef, geo.districtRef, geo.stateRef, area._id);
        const salon = await mkSalon("AUDIT_TARGET", geo.cityRef, geo.districtRef, geo.stateRef);

        const res = await resolve(indiaToken, candidate._id, { salonId: String(salon._id) });
        check("Audit fixture: resolution succeeds", res.status === 200, res.status);

        await new Promise((r) => setTimeout(r, 300));
        const auditCount = await AdminAuditLog.countDocuments({ action: "SALON_AREA_RESOLVED", targetId: salon._id, createdAt: { $gte: runStartedAt } });
        check("32. Successful resolution => exactly one SALON_AREA_RESOLVED audit event", auditCount === 1, auditCount);

        const auditDoc = await AdminAuditLog.findOne({ action: "SALON_AREA_RESOLVED", targetId: salon._id }).lean();
        check("32. Audit meta contains salonId/candidateId/areaId", auditDoc?.meta?.salonId === String(salon._id) && auditDoc?.meta?.candidateId === String(candidate._id) && auditDoc?.meta?.areaId === String(area._id), JSON.stringify(auditDoc?.meta));

        // 33. failed resolution => zero successful-resolution audit events
        const failRes = await resolve(indiaToken, candidate._id, { salonId: String(salon._id) }); // already has areaRef now -> reject
        check("Audit fixture: repeat resolution correctly rejected", failRes.status === 409, failRes.status);
        const auditCountAfterFail = await AdminAuditLog.countDocuments({ action: "SALON_AREA_RESOLVED", targetId: salon._id, createdAt: { $gte: runStartedAt } });
        check("33. Failed resolution creates no additional audit event", auditCountAfterFail === 1, auditCountAfterFail);
      }

      // ── 34. Repeated resolution after success => conflict ─────────
      {
        const area = await mkArea("REPEATED", geo.cityRef, geo.districtRef, geo.stateRef);
        const candidate = await mkCandidate(geo.cityRef, geo.districtRef, geo.stateRef, area._id);
        const salon = await mkSalon("REPEATED_TARGET", geo.cityRef, geo.districtRef, geo.stateRef);

        const first = await resolve(indiaToken, candidate._id, { salonId: String(salon._id) });
        check("34. First resolution succeeds", first.status === 200, first.status);
        const second = await resolve(indiaToken, candidate._id, { salonId: String(salon._id) });
        check("34. Repeated resolution after success => conflict", second.status === 409, second.status);
      }

      // ── 35. Frozen/production safety spot-checks ──────────────────
      {
        const { execSync } = await import("child_process");
        const diffFiles = execSync("git diff --name-only", { cwd: process.cwd() }).toString();
        check("35. models/Area.js not modified", !diffFiles.includes("models/Area.js"));
        check("35. models/AreaDiscoveryCandidate.js not modified", !diffFiles.includes("models/AreaDiscoveryCandidate.js"));
        check("35. models/Salon.js not modified", !diffFiles.includes("models/Salon.js"));
        check("35. controllers/areaDiscoveryCandidate.controller.js not modified", !diffFiles.includes("controllers/areaDiscoveryCandidate.controller.js"));
        check("35. validators/areaDiscoveryCandidate.validator.js not modified", !diffFiles.includes("validators/areaDiscoveryCandidate.validator.js"));
        check("35. services/areaDiscoveryNormalization.service.js not modified", !diffFiles.includes("areaDiscoveryNormalization.service.js"));
        check("35. services/areaDiscoveryMatching.service.js not modified", !diffFiles.includes("areaDiscoveryMatching.service.js"));
        check("35. controllers/areaDiscoveryMatch.controller.js not modified", !diffFiles.includes("controllers/areaDiscoveryMatch.controller.js"));
        check("35. services/geo.service.js not modified", !diffFiles.includes("geo.service.js"));
        check("35. services/salon.onboarding.service.js not modified", !diffFiles.includes("salon.onboarding.service.js"));

        const src = (await import("fs")).readFileSync(
          (await import("path")).join(process.cwd(), "controllers/areaDiscoveryResolution.controller.js"), "utf8"
        );
        const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
        check("35. Controller writes only Salon (no Area/Candidate/Territory write calls)", !/(Area|AreaDiscoveryCandidate)\.(create|updateOne|updateMany|deleteOne|deleteMany|findOneAndUpdate|findOneAndDelete|save)\(/.test(codeOnly), "found a write to Area/Candidate");
        // Precise check: no IMPORT of any Territory/AcquisitionClaim/
        // Commission/FieldAgent model, and no capitalized model-style
        // usage (e.g. "Territory."). A blanket substring match would
        // false-positive on the legitimate local variable
        // `salonTerritory` (derived from Salon's own existing
        // `location.territory` field), which has nothing to do with
        // the FA-5.2 Commercial Territory concept.
        const importBlock = codeOnly.split("\n").filter((l) => /^\s*import /.test(l)).join("\n");
        check("35. Controller imports no Territory/AcquisitionClaim/Commission/FieldAgent model", !/Territory|AcquisitionClaim|Commission|FieldAgent/.test(importBlock), importBlock);
        check("35. Controller contains no Territory/AcquisitionClaim/Commission/FieldAgent model-style usage", !/\b(Territory|AcquisitionClaim|Commission|FieldAgent)\./.test(codeOnly));
      }

    } catch (innerErr) {
      console.error("TEST BODY ERROR:", innerErr);
      check("Test body completed without throwing", false, innerErr.message);
    }
  } finally {
    if (createdSalonIds.length) await Salon.deleteMany({ _id: { $in: createdSalonIds } });
    if (createdCandidateIds.length) await AreaDiscoveryCandidate.deleteMany({ _id: { $in: createdCandidateIds } });
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
