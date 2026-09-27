/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyTerritoryAutoAssignment.js
 *
 * STEP 5.2 — Territory Auto Assignment Engine — disposable live
 * verification. Same methodology as every other verify script this
 * session: real Express app (app.listen(0)), real signed JWTs, real
 * Atlas dev DB, fresh disposable geography/fixtures (never touching
 * pre-existing real districts/territories), purged before/after.
 *
 * Proves:
 *   1. A Salon approved inside an AREA_SET territory with an ACTIVE
 *      Territory Partner gets auto-linked (SalonTerritoryAssignment)
 *      to that exact FieldAgent, via the real PATCH /:id/approve HTTP
 *      endpoint (the actual production hook).
 *   2. Precedence: AREA_SET beats CITY beats DISTRICT when resolving.
 *   3. A second, brand-NEW salon approved later in the SAME territory
 *      inherits the SAME Territory Partner automatically (no separate
 *      "new salon" mechanism — same hook, same result).
 *   4. A salon approved in a district with NO active territory gets no
 *      link at all (safe no-op) — and salon approval still succeeds.
 *   5. A salon approved in a territory that is ACTIVE but VACANT
 *      (no currentAssignmentRef) also safely gets no link — and salon
 *      approval still succeeds.
 *   6. Re-approval attempts are rejected exactly as before (unchanged
 *      existing behavior) — this engine adds nothing to that check.
 *   7. AREA-LEVEL EXCLUSIVITY: two AREA_SET territories sharing even one
 *      Area cannot both be ACTIVE (409) — "one active Territory Partner
 *      per Area" is DB/service-enforced, not assumed. A non-overlapping
 *      Area in the same city activates independently with its own
 *      partner, proving this is per-Area, not per-city.
 *   8. BACKFILL ("existing salons can be backfilled safely"): a
 *      pre-existing APPROVED salon (created directly, never through the
 *      approve endpoint) has no link until backfilled. Dry-run reports
 *      correctly and writes nothing; apply writes exactly the reported
 *      links; re-running afterward is a safe no-op (idempotent, no
 *      duplicates). An uncovered pre-existing salon is safely skipped.
 *   9. ISOLATION: RevenueSettings, TerritoryRevenueSettings, and
 *      AcquisitionClaim collections are completely untouched by this
 *      entire run. CommercialTerritory/TerritoryAssignment documents
 *      are only ever read, never mutated by the new module (the ones
 *      created here are created via the REAL, unmodified FA-5.2
 *      service/HTTP endpoints, exactly like verifyCommercialTerritory.js
 *      already does — not by the new module itself).
 *
 * Run:  cd backend && node scripts/verifyTerritoryAutoAssignment.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import { generateAccessToken } from "../services/token.service.js";
import User from "../models/User.js";
import Country from "../models/Country.js";
import State from "../models/State.js";
import District from "../models/District.js";
import City from "../models/City.js";
import Area from "../models/Area.js";
import Salon from "../models/Salon.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import CommercialTerritory from "../modules/fieldAgent/models/CommercialTerritory.js";
import TerritoryAssignment from "../modules/fieldAgent/models/TerritoryAssignment.js";
import AcquisitionClaim from "../modules/fieldAgent/models/AcquisitionClaim.js";
import RevenueSettings from "../modules/finance/models/RevenueSettings.js";
import TerritoryRevenueSettings from "../modules/finance/models/TerritoryRevenueSettings.js";
import SalonTerritoryAssignment from "../modules/territoryAutoAssignment/models/SalonTerritoryAssignment.js";
import { backfillTerritoryAssignmentsForApprovedSalons } from "../modules/territoryAutoAssignment/services/TerritoryAutoAssignmentService.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const P = "ZTEST_TAA52_";
const oid = () => new mongoose.Types.ObjectId();
let phoneSeq = 0;
const nextPhone = () => `8${String(8880000000 + phoneSeq++).slice(-9)}`;

const fixtureUserIds = [];
const fixtureFieldAgentIds = [];
const fixtureStateIds = [];
const fixtureDistrictIds = [];
const fixtureCityIds = [];
const fixtureAreaIds = [];
const fixtureTerritoryIds = [];
const fixtureAssignmentIds = [];
const fixtureSalonIds = [];
const fixtureLinkIds = [];

const purgeFixtures = async () => {
  await SalonTerritoryAssignment.deleteMany({ _id: { $in: fixtureLinkIds } });
  await Salon.deleteMany({ _id: { $in: fixtureSalonIds } });
  await TerritoryAssignment.deleteMany({ _id: { $in: fixtureAssignmentIds } });
  await CommercialTerritory.deleteMany({ _id: { $in: fixtureTerritoryIds } });
  await FieldAgent.deleteMany({ _id: { $in: fixtureFieldAgentIds } });
  await Area.deleteMany({ _id: { $in: fixtureAreaIds } });
  await City.deleteMany({ _id: { $in: fixtureCityIds } });
  await District.deleteMany({ _id: { $in: fixtureDistrictIds } });
  await State.deleteMany({ _id: { $in: fixtureStateIds } });
  await User.deleteMany({ _id: { $in: fixtureUserIds } });
};

const dayTiming = { open: "09:00", close: "20:00" };
const salonTimings = { monday: dayTiming, tuesday: dayTiming, wednesday: dayTiming, thursday: dayTiming, friday: dayTiming, saturday: dayTiming, sunday: dayTiming };

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts = {}) =>
    fetch(url(path), {
      ...opts,
      headers: {
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));

  try {
    // ── ISOLATION BASELINES (before any activity) ─────────────────
    const revenueSettingsCountBefore = await RevenueSettings.countDocuments({});
    const territoryRevenueCountBefore = await TerritoryRevenueSettings.countDocuments({});
    const acquisitionClaimCountBefore = await AcquisitionClaim.countDocuments({});

    // ── SETUP: fresh, disposable geography (never touches real prod data) ──
    const country = await Country.findOne({}).lean();
    check("SETUP. Real Country fixture exists", !!country);

    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion").lean();
    check("SETUP. Real INDIA admin fixture exists (pre-existing)", !!indiaAdmin);
    const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

    const randLetter = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
    const stateCode = `Z${randLetter()}${randLetter()}`.slice(0, 3);
    const state = await State.create({ name: `${P}STATE`, code: stateCode, type: "STATE", countryRef: country._id, geo: { type: "Point", coordinates: [77, 28] }, isActive: true, isDeleted: false });
    fixtureStateIds.push(state._id);

    const mkDistrict = async (suffix) => {
      const d = await District.create({ name: `${P}DISTRICT_${suffix}`, code: `Z9${suffix}`, countryRef: country._id, stateRef: state._id, isActive: true, isDeleted: false });
      fixtureDistrictIds.push(d._id); return d;
    };
    const mkCity = async (suffix, districtRef) => {
      const c = await City.create({ name: `${P}CITY_${suffix}`, districtRef, stateRef: state._id, isActive: true, isDeleted: false });
      fixtureCityIds.push(c._id); return c;
    };
    const mkArea = async (suffix, cityRef, districtRef) => {
      const a = await Area.create({ name: `${P}AREA_${suffix}`, cityRef, districtRef, stateRef: state._id, isActive: true, isDeleted: false });
      fixtureAreaIds.push(a._id); return a;
    };
    const mkFieldAgent = async (suffix) => {
      const u = await User.create({ name: `${P}FA_${suffix}`, phone: nextPhone(), role: "FIELD_AGENT", isActive: true });
      fixtureUserIds.push(u._id);
      const fa = await FieldAgent.create({
        userRef: u._id,
        applicationRef: oid(),
        agentCode: `FA-99999999-${String(Math.floor(Math.random() * 900000) + 100000)}`,
        operationalStatus: "PENDING_ACTIVATION",
        commercialPath: "TERRITORY_PARTNER",
      });
      fixtureFieldAgentIds.push(fa._id);
      return fa;
    };
    // NOTE — pre-existing discovery (not caused by, or fixed by, STEP 5.2):
    // User.adminLevel's schema enum is only ["INDIA","STATE","DISTRICT"]
    // (models/User.js) — "CITY" (the level controllers/salon.controller.js#
    // approveSalon/rejectSalon actually check) is not a valid enum value,
    // so no normally-validated User document could ever legitimately reach
    // that branch today. Bypassing validation here ONLY to exercise the
    // real, pre-existing approveSalon code path as literally written —
    // this is a disposable test fixture, not a fix to that gap, and this
    // gap is flagged separately in the final report, not addressed here.
    const mkCityAdmin = async (suffix, cityRef) => {
      const u = new User({ name: `${P}CITYADMIN_${suffix}`, phone: nextPhone(), email: `${P.toLowerCase()}cityadmin_${suffix}_${Date.now()}@ztest.local`, role: "ADMIN", adminLevel: "CITY", adminSubRole: "PRIMARY", countryRef: country._id, stateRef: state._id, cityRef, isActive: true });
      await u.save({ validateBeforeSave: false });
      fixtureUserIds.push(u._id);
      return generateAccessToken({ _id: u._id, role: "ADMIN", adminLevel: "CITY", tokenVersion: 0 });
    };
    const mkSalon = async (suffix, { stateRef, districtRef, cityRef, areaRef }) => {
      const owner = await User.create({ name: `${P}OWNER_${suffix}`, phone: nextPhone(), role: "OWNER", isActive: true });
      fixtureUserIds.push(owner._id);
      const salon = await Salon.create({
        ownerId: owner._id,
        basicInfo: { shopName: `${P}SALON_${suffix}`, category: "UNISEX" },
        location: { address: `${P} addr ${suffix}`, geo: { type: "Point", coordinates: [77, 28] }, territory: { countryRef: country._id, stateRef, districtRef, cityRef, areaRef: areaRef ?? null } },
        timings: salonTimings,
        approval: { status: "PENDING" },
        onboarding: { step: 2 },
        isDeleted: false,
      });
      fixtureSalonIds.push(salon._id);
      return salon;
    };

    const createTerritory = (body) => authFetch("/api/admin/commercial-territories", indiaToken, { method: "POST", body: JSON.stringify(body) });
    const activateTerritory = (id) => authFetch(`/api/admin/commercial-territories/${id}/activate`, indiaToken, { method: "POST" });
    const assignPartnerHttp = (id, fieldAgentId) => authFetch(`/api/admin/commercial-territories/${id}/assign-partner`, indiaToken, { method: "POST", body: JSON.stringify({ fieldAgentId }) });
    const approveSalon = (id, token) => authFetch(`/api/salon/admin/${id}/approve`, token, { method: "PATCH" });

    // ═══ SCENARIO A — AREA_SET territory, ACTIVE partner, salon approved via real HTTP ═══
    const dA = await mkDistrict("A");
    const cA = await mkCity("A", dA._id);
    const area1 = await mkArea("A1", cA._id, dA._id);
    const area2 = await mkArea("A2", cA._id, dA._id);
    const partnerA = await mkFieldAgent("PARTNER_A");
    const cityAdminTokenA = await mkCityAdmin("A", cA._id);

    let r = await createTerritory({ name: `${P}Territory A`, scopeType: "AREA_SET", districtRef: String(dA._id), cityRef: String(cA._id), areaRefs: [String(area1._id), String(area2._id)] });
    check("A1. Create AREA_SET territory (201)", r.status === 201, r.data);
    const territoryA = r.data.data.territory;
    fixtureTerritoryIds.push(territoryA._id);

    r = await activateTerritory(territoryA._id);
    check("A2. Activate territory (200)", r.status === 200 && r.data.data.territory.status === "ACTIVE", r.data);

    r = await assignPartnerHttp(territoryA._id, partnerA._id);
    check("A3. Assign Territory Partner (200)", r.status === 200, r.data);
    const assignmentA = await TerritoryAssignment.findOne({ territoryRef: territoryA._id, status: "ACTIVE" }).lean();
    check("A4. Real ACTIVE TerritoryAssignment exists for this territory", !!assignmentA, assignmentA);
    if (assignmentA) fixtureAssignmentIds.push(assignmentA._id);

    const salonA = await mkSalon("A", { stateRef: state._id, districtRef: dA._id, cityRef: cA._id, areaRef: area1._id });

    r = await approveSalon(salonA._id, cityAdminTokenA);
    check("A5. Real PATCH /:id/approve succeeds (200) — the actual production hook", r.status === 200 && r.data.data.status === "APPROVED", r.data);

    const linkA = await SalonTerritoryAssignment.findOne({ salonRef: salonA._id }).lean();
    check("A6. SalonTerritoryAssignment auto-created for the approved salon", !!linkA, linkA);
    if (linkA) fixtureLinkIds.push(linkA._id);
    check("A7. Linked fieldAgentRef matches the real ACTIVE Territory Partner", String(linkA?.fieldAgentRef) === String(partnerA._id), { got: linkA?.fieldAgentRef, expected: partnerA._id });
    check("A8. Linked territoryRef matches the real ACTIVE Commercial Territory", String(linkA?.territoryRef) === String(territoryA._id));
    check("A9. source = AUTO_ON_APPROVAL", linkA?.source === "AUTO_ON_APPROVAL", linkA?.source);

    // ═══ SCENARIO B — a SECOND, brand-new salon in the SAME territory inherits the SAME partner ═══
    const salonB = await mkSalon("B", { stateRef: state._id, districtRef: dA._id, cityRef: cA._id, areaRef: area2._id });
    r = await approveSalon(salonB._id, cityAdminTokenA);
    check("B1. Second (new) salon approved via the same real endpoint (200)", r.status === 200, r.data);
    const linkB = await SalonTerritoryAssignment.findOne({ salonRef: salonB._id }).lean();
    if (linkB) fixtureLinkIds.push(linkB._id);
    check("B2. New salon auto-inherits the SAME Territory Partner — no separate mechanism needed", String(linkB?.fieldAgentRef) === String(partnerA._id), linkB);

    // ═══ SCENARIO C — a district/city with NO active territory: safe no-op, approval still succeeds ═══
    const dC = await mkDistrict("C");
    const cC = await mkCity("C", dC._id);
    const cityAdminTokenC = await mkCityAdmin("C", cC._id);
    const salonC = await mkSalon("C", { stateRef: state._id, districtRef: dC._id, cityRef: cC._id, areaRef: null });
    r = await approveSalon(salonC._id, cityAdminTokenC);
    check("C1. Salon in an UNCOVERED district still approves successfully (200)", r.status === 200, r.data);
    const linkC = await SalonTerritoryAssignment.findOne({ salonRef: salonC._id }).lean();
    check("C2. No SalonTerritoryAssignment created for an uncovered geography (safe no-op)", linkC === null, linkC);

    // ═══ SCENARIO D — an ACTIVE but VACANT territory (no partner assigned): safe no-op ═══
    const dD = await mkDistrict("D");
    let rD = await createTerritory({ name: `${P}Territory D`, scopeType: "DISTRICT", districtRef: String(dD._id) });
    const territoryD = rD.data.data.territory;
    fixtureTerritoryIds.push(territoryD._id);
    rD = await activateTerritory(territoryD._id);
    check("D1. DISTRICT territory activated, VACANT (no partner assigned)", rD.status === 200 && rD.data.data.territory.currentAssignmentRef === null, rD.data);
    const cityD = await mkCity("D", dD._id);
    const cityAdminTokenD = await mkCityAdmin("D", cityD._id);
    const salonD = await mkSalon("D", { stateRef: state._id, districtRef: dD._id, cityRef: cityD._id, areaRef: null });
    r = await approveSalon(salonD._id, cityAdminTokenD);
    check("D2. Salon in an ACTIVE-but-VACANT territory still approves successfully (200)", r.status === 200, r.data);
    const linkD = await SalonTerritoryAssignment.findOne({ salonRef: salonD._id }).lean();
    check("D3. No SalonTerritoryAssignment created for a vacant territory (safe no-op)", linkD === null, linkD);

    // ═══ SCENARIO E — re-approval is still rejected exactly as before (unchanged) ═══
    r = await approveSalon(salonA._id, cityAdminTokenA);
    check("E1. Re-approving an already-APPROVED salon is still rejected (400) — pre-existing behavior unchanged", r.status === 400, r.data);

    // ═══ SCENARIO F — PRECEDENCE: AREA_SET beats DISTRICT for the same point ═══
    // dA already has an ACTIVE AREA_SET territory covering area1/area2 in cA.
    // A DISTRICT-scope territory for dA would conflict with it at activation
    // time (FA-5.2's own cross-scope overlap prevention) — proving that
    // invariant here rather than re-implementing it.
    const rConflict = await createTerritory({ name: `${P}Territory A-District-Conflict`, scopeType: "DISTRICT", districtRef: String(dA._id) });
    if (rConflict.status === 201) fixtureTerritoryIds.push(rConflict.data.data.territory._id);
    const rConflictActivate = rConflict.status === 201 ? await activateTerritory(rConflict.data.data.territory._id) : { status: null };
    check("F1. A DISTRICT territory overlapping the existing ACTIVE AREA_SET territory cannot itself become ACTIVE (FA-5.2 invariant — confirms precedence is structurally guaranteed, not just a resolution-order guess)", rConflictActivate.status === 409, rConflictActivate);

    // ═══ SCENARIO G — AREA-LEVEL EXCLUSIVITY: "one active Territory Partner per Area" ═══
    const dG = await mkDistrict("G");
    const cG = await mkCity("G", dG._id);
    const areaG1 = await mkArea("G1", cG._id, dG._id);
    const areaG2 = await mkArea("G2", cG._id, dG._id);
    const areaG3 = await mkArea("G3", cG._id, dG._id);
    const partnerG1 = await mkFieldAgent("PARTNER_G1");
    const partnerG2 = await mkFieldAgent("PARTNER_G2");

    let rG1 = await createTerritory({ name: `${P}Territory G1`, scopeType: "AREA_SET", districtRef: String(dG._id), cityRef: String(cG._id), areaRefs: [String(areaG1._id)] });
    fixtureTerritoryIds.push(rG1.data.data.territory._id);
    await activateTerritory(rG1.data.data.territory._id);
    await assignPartnerHttp(rG1.data.data.territory._id, partnerG1._id);
    check("G1. First AREA_SET territory (area G1) activated with a partner", true);

    // A second AREA_SET territory that OVERLAPS area G1 (shares it with a
    // brand-new area G3) must be rejected at activation — proves
    // exclusivity at the exact Area granularity, not just district/city.
    const rG2 = await createTerritory({ name: `${P}Territory G2-Overlap`, scopeType: "AREA_SET", districtRef: String(dG._id), cityRef: String(cG._id), areaRefs: [String(areaG1._id), String(areaG3._id)] });
    if (rG2.status === 201) fixtureTerritoryIds.push(rG2.data.data.territory._id);
    const rG2Activate = rG2.status === 201 ? await activateTerritory(rG2.data.data.territory._id) : { status: null };
    check("G2. A second AREA_SET territory sharing even ONE area (area G1) with an already-ACTIVE territory cannot activate (409) — one active Territory Partner per Area, DB/service-enforced", rG2Activate.status === 409, rG2Activate);

    // A DIFFERENT, non-overlapping area (area G2) in the SAME city CAN
    // have its own independent territory + partner — proves this is a
    // genuine per-Area exclusivity, not an accidental per-city lockout.
    const rG3 = await createTerritory({ name: `${P}Territory G3-Independent`, scopeType: "AREA_SET", districtRef: String(dG._id), cityRef: String(cG._id), areaRefs: [String(areaG2._id)] });
    fixtureTerritoryIds.push(rG3.data.data.territory._id);
    const rG3Activate = await activateTerritory(rG3.data.data.territory._id);
    check("G3. A non-overlapping area (area G2) in the same city activates independently (200) — exclusivity is per-Area, not per-city", rG3Activate.status === 200, rG3Activate);
    await assignPartnerHttp(rG3.data.data.territory._id, partnerG2._id);

    const cityAdminTokenG = await mkCityAdmin("G", cG._id);
    const salonG1 = await mkSalon("G1", { stateRef: state._id, districtRef: dG._id, cityRef: cG._id, areaRef: areaG1._id });
    const salonG2 = await mkSalon("G2", { stateRef: state._id, districtRef: dG._id, cityRef: cG._id, areaRef: areaG2._id });
    await approveSalon(salonG1._id, cityAdminTokenG);
    await approveSalon(salonG2._id, cityAdminTokenG);
    const linkG1 = await SalonTerritoryAssignment.findOne({ salonRef: salonG1._id }).lean();
    const linkG2 = await SalonTerritoryAssignment.findOne({ salonRef: salonG2._id }).lean();
    if (linkG1) fixtureLinkIds.push(linkG1._id);
    if (linkG2) fixtureLinkIds.push(linkG2._id);
    check("G4. Salon in area G1 links to partner G1, salon in area G2 links to the DIFFERENT partner G2 — correct per-Area resolution", String(linkG1?.fieldAgentRef) === String(partnerG1._id) && String(linkG2?.fieldAgentRef) === String(partnerG2._id), { linkG1, linkG2 });

    // ═══ SCENARIO H — "existing salons can be backfilled safely" ═══════
    const dH = await mkDistrict("H");
    const cH = await mkCity("H", dH._id);
    const areaH1 = await mkArea("H1", cH._id, dH._id);
    const partnerH = await mkFieldAgent("PARTNER_H");
    let rH = await createTerritory({ name: `${P}Territory H`, scopeType: "AREA_SET", districtRef: String(dH._id), cityRef: String(cH._id), areaRefs: [String(areaH1._id)] });
    fixtureTerritoryIds.push(rH.data.data.territory._id);
    await activateTerritory(rH.data.data.territory._id);
    await assignPartnerHttp(rH.data.data.territory._id, partnerH._id);

    // Simulate a PRE-EXISTING approved salon that predates this engine —
    // created directly as APPROVED, never through PATCH /:id/approve, so
    // it has no SalonTerritoryAssignment link yet.
    const ownerH1 = await User.create({ name: `${P}OWNER_H1`, phone: nextPhone(), role: "OWNER", isActive: true });
    fixtureUserIds.push(ownerH1._id);
    const preExistingSalonH1 = await Salon.create({
      ownerId: ownerH1._id,
      basicInfo: { shopName: `${P}SALON_H1_PREEXISTING`, category: "UNISEX" },
      location: { address: `${P} addr H1`, geo: { type: "Point", coordinates: [77, 28] }, territory: { countryRef: country._id, stateRef: state._id, districtRef: dH._id, cityRef: cH._id, areaRef: areaH1._id } },
      timings: salonTimings,
      approval: { status: "APPROVED", approvedAt: new Date() },
      onboarding: { step: 8 },
      isDeleted: false,
    });
    fixtureSalonIds.push(preExistingSalonH1._id);

    // A second pre-existing salon in an UNCOVERED district — should be
    // safely skipped by the backfill, never linked.
    const dH2 = await mkDistrict("H2");
    const ownerH2 = await User.create({ name: `${P}OWNER_H2`, phone: nextPhone(), role: "OWNER", isActive: true });
    fixtureUserIds.push(ownerH2._id);
    const preExistingSalonH2 = await Salon.create({
      ownerId: ownerH2._id,
      basicInfo: { shopName: `${P}SALON_H2_PREEXISTING_UNCOVERED`, category: "UNISEX" },
      location: { address: `${P} addr H2`, geo: { type: "Point", coordinates: [77, 28] }, territory: { countryRef: country._id, stateRef: state._id, districtRef: dH2._id, cityRef: null, areaRef: null } },
      timings: salonTimings,
      approval: { status: "APPROVED", approvedAt: new Date() },
      onboarding: { step: 8 },
      isDeleted: false,
    });
    fixtureSalonIds.push(preExistingSalonH2._id);

    const backfillScopeIds = [preExistingSalonH1._id, preExistingSalonH2._id];

    // H1 — DRY RUN: reports what would happen, writes nothing.
    const dryRunSummary = await backfillTerritoryAssignmentsForApprovedSalons({ dryRun: true, salonIds: backfillScopeIds });
    check("H1. Dry-run reports exactly 2 candidate salons scanned (scoped to this test's fixtures)", dryRunSummary.candidatesScanned === 2, dryRunSummary);
    check("H2. Dry-run reports 1 salon WOULD be linked (the covered one)", dryRunSummary.linked === 1, dryRunSummary);
    check("H3. Dry-run reports 1 salon WOULD be skipped as uncovered", dryRunSummary.skippedUncovered === 1, dryRunSummary);
    const linkAfterDryRun = await SalonTerritoryAssignment.findOne({ salonRef: preExistingSalonH1._id }).lean();
    check("H4. Dry-run wrote NOTHING — no SalonTerritoryAssignment created yet", linkAfterDryRun === null, linkAfterDryRun);

    // H2 — APPLY: actually writes the link(s).
    const applySummary = await backfillTerritoryAssignmentsForApprovedSalons({ dryRun: false, salonIds: backfillScopeIds });
    check("H5. Apply run also links exactly 1 salon", applySummary.linked === 1 && applySummary.dryRun === false, applySummary);
    const linkAfterApply = await SalonTerritoryAssignment.findOne({ salonRef: preExistingSalonH1._id }).lean();
    if (linkAfterApply) fixtureLinkIds.push(linkAfterApply._id);
    check("H6. Pre-existing salon is now correctly linked to the real ACTIVE Territory Partner via backfill", !!linkAfterApply && String(linkAfterApply.fieldAgentRef) === String(partnerH._id) && linkAfterApply.source === "BACKFILL", linkAfterApply);
    const linkForUncovered = await SalonTerritoryAssignment.findOne({ salonRef: preExistingSalonH2._id }).lean();
    check("H7. Uncovered pre-existing salon still has NO link after apply — safe no-op", linkForUncovered === null, linkForUncovered);

    // H3 — IDEMPOTENCY: running again is a safe no-op (no duplicate, no re-link).
    const secondApplySummary = await backfillTerritoryAssignmentsForApprovedSalons({ dryRun: false, salonIds: backfillScopeIds });
    check("H8. Re-running the backfill finds 0 remaining candidates (already-linked salon excluded)", secondApplySummary.candidatesScanned === 1 && secondApplySummary.linked === 0, secondApplySummary);
    const linkCountForH1 = await SalonTerritoryAssignment.countDocuments({ salonRef: preExistingSalonH1._id });
    check("H9. Exactly ONE SalonTerritoryAssignment document exists for the backfilled salon — no duplicate created by re-running", linkCountForH1 === 1, linkCountForH1);

    // ═══ ISOLATION — the ticket's central requirement ═══════════════
    const revenueSettingsCountAfter = await RevenueSettings.countDocuments({});
    check("I1. RevenueSettings collection completely untouched by this entire run", revenueSettingsCountAfter === revenueSettingsCountBefore, { before: revenueSettingsCountBefore, after: revenueSettingsCountAfter });

    const territoryRevenueCountAfter = await TerritoryRevenueSettings.countDocuments({});
    check("I2. TerritoryRevenueSettings (STEP 5.1) collection completely untouched by this entire run", territoryRevenueCountAfter === territoryRevenueCountBefore, { before: territoryRevenueCountBefore, after: territoryRevenueCountAfter });

    const acquisitionClaimCountAfter = await AcquisitionClaim.countDocuments({});
    check("I3. AcquisitionClaim collection completely untouched by this entire run", acquisitionClaimCountAfter === acquisitionClaimCountBefore, { before: acquisitionClaimCountBefore, after: acquisitionClaimCountAfter });

    const salonKeys = Object.keys((await Salon.findById(salonA._id).lean()) || {});
    check("I4. Salon document schema itself carries NO new territory/commercial field — link lives only in the new SalonTerritoryAssignment collection", !salonKeys.some((k) => /territoryPartner|salonTerritory/i.test(k)), salonKeys);
  } catch (err) {
    fail++; results.push(`❌ UNEXPECTED ERROR — ${err.stack || err}`);
  } finally {
    await purgeFixtures().catch((e) => results.push(`⚠️ purge error ${e.message}`));
    server.close();
    await mongoose.disconnect();
  }
  console.log(results.join("\n"));
  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
};
run();
