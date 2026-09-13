/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyFieldAgentCommercialPolicy.js
 *
 * FA-5.1 — LIVE, real-HTTP, real-DB verification for
 * CommercialPolicyVersion authoring/versioning AND the minimal
 * additive FA-4 extension (FieldAgent.commercialPath,
 * FIELD_AGENT_OPERATIONAL_STATUS.ACTIVE). Same precedent and style as
 * every other verification script in this repo — real Express app,
 * real signed JWTs, real MongoDB Atlas, no mocks.
 *
 * All User/FieldAgent fixtures (phones 9999908xxx) are hard-deleted in
 * cleanup. CommercialPolicyVersion fixtures are NOT user-linked, so
 * they are tagged with a distinctive obligations.key marker
 * ("FA-5.1-VERIFY-FIXTURE") and deleted by that marker instead —
 * including any that reached PUBLISHED/RETIRED during the run. This is
 * safe because CommercialPolicyVersion is a BRAND NEW collection this
 * phase creates: no other code path reads "the currently published
 * policy" yet (no pinning consumer exists until a later FA-5 phase),
 * so no production behavior depends on one surviving after this
 * script's cleanup. COMMERCIAL_POLICY_(CREATED/PUBLISHED/RETIRED) and
 * COMMERCIAL_MODEL_SELECTED audit events are preserved (append-only, same precedent as every
 * other audit collection in this codebase).
 *
 * SAFETY NOTE: if a real PUBLISHED CommercialPolicyVersion already
 * exists at the moment this script runs (e.g. genuine prior admin
 * authoring), this script's own publish tests will retire it as part
 * of proving the "at most one PUBLISHED" invariant — this is
 * documented, not silently done. See the FA-5.1 IMPLEMENTATION REPORT
 * for this run's own observed value.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyFieldAgentCommercialPolicy.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import CommercialPolicyVersion from "../modules/fieldAgent/models/CommercialPolicyVersion.js";
import FieldAgentAuditEvent from "../modules/fieldAgent/models/FieldAgentAuditEvent.js";
import { generateAccessToken } from "../services/token.service.js";

let pass = 0;
let fail = 0;
const results = [];

const check = (name, condition, detail) => {
  if (condition) {
    pass += 1;
    results.push(`✅ ${name}`);
  } else {
    fail += 1;
    results.push(`❌ ${name}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
};

let phoneSeq = 0;
const fixtureUserIds = [];
const nextPhone = () => `9999908${String(phoneSeq++).padStart(3, "0")}`;

const FIXTURE_MARKER = "FA-5.1-VERIFY-FIXTURE";
const validPolicyBody = (overrides = {}) => ({
  acquisitionIncentiveAmountInPaise: 50000,
  territoryPartnerCommissionPercent: 12.5,
  licenseTermMonths: 12,
  claimExpiryDays: 30,
  obligations: [{ key: FIXTURE_MARKER, description: "Verification fixture marker — safe to delete." }],
  performanceFactors: [],
  coverageRules: [],
  ...overrides,
});

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
        ...(opts.headers || {}),
      },
    });

  // ── Pre-flight cleanup ────────────────────────────────────────────
  {
    const staleUsers = await User.find({ phone: { $regex: /^9999908\d{3}$/ } }).select("_id").lean();
    const staleUserIds = staleUsers.map((u) => u._id);
    if (staleUserIds.length > 0) {
      await FieldAgent.deleteMany({ userRef: { $in: staleUserIds } });
      await User.deleteMany({ _id: { $in: staleUserIds } });
    }
    await CommercialPolicyVersion.deleteMany({ "obligations.key": FIXTURE_MARKER });
  }

  const preExistingPublished = await CommercialPolicyVersion.findOne({ status: "PUBLISHED" }).lean();
  if (preExistingPublished) {
    console.warn(
      `⚠️  A PUBLISHED CommercialPolicyVersion already exists (versionNumber ${preExistingPublished.versionNumber}) — this run's own publish tests will retire it. See script header.`
    );
  }

  // ── FIXTURES ───────────────────────────────────────────────────────
  const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion");
  check("INDIA admin fixture exists (real, pre-existing account)", !!indiaAdmin);
  const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

  const districtAdmin = await User.findOne({
    role: "ADMIN",
    adminLevel: { $in: ["STATE", "DISTRICT"] },
    isActive: true,
    accountStatus: "ACTIVE",
  })
    .select("+tokenVersion")
    .lean();
  check("a real STATE/DISTRICT admin fixture exists (pre-existing location-hierarchy data)", !!districtAdmin);
  const districtToken = districtAdmin
    ? generateAccessToken({ _id: districtAdmin._id, role: "ADMIN", adminLevel: districtAdmin.adminLevel, tokenVersion: districtAdmin.tokenVersion ?? 0 })
    : null;

  const makeFieldAgentFixture = async (name, { operationalStatus = "PENDING_ACTIVATION" } = {}) => {
    const phone = nextPhone();
    const user = await User.create({ name, phone, role: "FIELD_AGENT", isActive: true });
    fixtureUserIds.push(user._id);
    const fieldAgent = await FieldAgent.create({
      userRef: user._id,
      applicationRef: new mongoose.Types.ObjectId(),
      agentCode: `FA-99999999-${String(Math.floor(Math.random() * 900000) + 100000)}`,
      operationalStatus,
      approvedBy: indiaAdmin._id,
      approvedAt: new Date(),
    });
    return { user, fieldAgent };
  };

  const makePlainUser = async (name) => {
    const phone = nextPhone();
    const user = await User.create({ name, phone, role: "USER", isActive: true });
    fixtureUserIds.push(user._id);
    return { user, token: generateAccessToken({ _id: user._id, role: "USER", tokenVersion: user.tokenVersion ?? 0 }) };
  };

  const POLICY_API = "/api/admin/commercial-policies";
  const FIELD_AGENTS_API = "/api/admin/field-agents";

  // ── A — CREATE DRAFT (happy path) ─────────────────────────────────
  let draftVersion;
  {
    const auditBefore = await FieldAgentAuditEvent.countDocuments({ action: "COMMERCIAL_POLICY_CREATED" });
    const res = await authFetch(POLICY_API, indiaToken, { method: "POST", body: JSON.stringify(validPolicyBody()) });
    const json = await res.json();
    check("A: create draft policy version -> 201", res.status === 201, res.status);
    check("A: status is DRAFT", json.data?.version?.status === "DRAFT", json.data?.version?.status);
    check("A: versionNumber is a positive integer", Number.isInteger(json.data?.version?.versionNumber) && json.data.version.versionNumber > 0, json.data?.version?.versionNumber);
    check("A: createdBy is the authenticated admin", String(json.data?.version?.createdBy) === String(indiaAdmin._id), json.data?.version?.createdBy);
    draftVersion = json.data?.version;

    const auditAfter = await FieldAgentAuditEvent.countDocuments({ action: "COMMERCIAL_POLICY_CREATED" });
    check("A: exactly one COMMERCIAL_POLICY_CREATED audit event", auditAfter - auditBefore === 1, auditAfter - auditBefore);
  }

  // ── B — FIELD VALIDATION BOUNDS ───────────────────────────────────
  {
    const negativeIncentive = await authFetch(POLICY_API, indiaToken, { method: "POST", body: JSON.stringify(validPolicyBody({ acquisitionIncentiveAmountInPaise: -1 })) });
    check("B: negative acquisitionIncentiveAmountInPaise rejected -> 400", negativeIncentive.status === 400, negativeIncentive.status);

    const overPercent = await authFetch(POLICY_API, indiaToken, { method: "POST", body: JSON.stringify(validPolicyBody({ territoryPartnerCommissionPercent: 101 })) });
    check("B: territoryPartnerCommissionPercent > 100 rejected -> 400", overPercent.status === 400, overPercent.status);

    const negativePercent = await authFetch(POLICY_API, indiaToken, { method: "POST", body: JSON.stringify(validPolicyBody({ territoryPartnerCommissionPercent: -1 })) });
    check("B: negative territoryPartnerCommissionPercent rejected -> 400", negativePercent.status === 400, negativePercent.status);

    const zeroLicenseTerm = await authFetch(POLICY_API, indiaToken, { method: "POST", body: JSON.stringify(validPolicyBody({ licenseTermMonths: 0 })) });
    check("B: licenseTermMonths < 1 rejected -> 400", zeroLicenseTerm.status === 400, zeroLicenseTerm.status);

    const zeroClaimExpiry = await authFetch(POLICY_API, indiaToken, { method: "POST", body: JSON.stringify(validPolicyBody({ claimExpiryDays: 0 })) });
    check("B: claimExpiryDays < 1 rejected -> 400", zeroClaimExpiry.status === 400, zeroClaimExpiry.status);

    const missingField = await authFetch(POLICY_API, indiaToken, { method: "POST", body: JSON.stringify({ acquisitionIncentiveAmountInPaise: 1000 }) });
    check("B: missing required fields rejected -> 400", missingField.status === 400, missingField.status);

    const oversizedItemList = await authFetch(
      POLICY_API,
      indiaToken,
      { method: "POST", body: JSON.stringify(validPolicyBody({ obligations: Array.from({ length: 51 }, (_, i) => ({ key: `k${i}`, description: "d" })) })) }
    );
    check("B: obligations list over MAX_POLICY_ITEMS_PER_LIST (51) rejected -> 400", oversizedItemList.status === 400, oversizedItemList.status);
  }

  // ── C — FORBIDDEN SERVER-CONTROLLED FIELD INJECTION ───────────────
  {
    const rigged = await authFetch(POLICY_API, indiaToken, {
      method: "POST",
      body: JSON.stringify(validPolicyBody({ versionNumber: 999999, status: "PUBLISHED", createdBy: "bogus" })),
    });
    check("C: create body with server-controlled fields rejected -> 400", rigged.status === 400, rigged.status);

    const riggedUpdate = await authFetch(`${POLICY_API}/${draftVersion._id}`, indiaToken, {
      method: "PATCH",
      body: JSON.stringify({ status: "PUBLISHED", publishedAt: new Date().toISOString() }),
    });
    check("C: update body with server-controlled fields rejected -> 400", riggedUpdate.status === 400, riggedUpdate.status);
  }

  // ── D — LIST / DETAIL READ ────────────────────────────────────────
  {
    const listRes = await authFetch(`${POLICY_API}?limit=10`, indiaToken);
    const listJson = await listRes.json();
    check("D: list versions -> 200", listRes.status === 200, listRes.status);
    check("D: list includes the fixture draft", listJson.data?.versions?.some((v) => v._id === draftVersion._id), listJson.data?.versions?.length);

    const detailRes = await authFetch(`${POLICY_API}/${draftVersion._id}`, indiaToken);
    const detailJson = await detailRes.json();
    check("D: detail fetch -> 200", detailRes.status === 200, detailRes.status);
    check("D: detail matches created version", detailJson.data?.version?._id === draftVersion._id, detailJson.data?.version?._id);

    const notFoundRes = await authFetch(`${POLICY_API}/${new mongoose.Types.ObjectId()}`, indiaToken);
    check("D: detail for nonexistent version -> 404", notFoundRes.status === 404, notFoundRes.status);
  }

  // ── E — UPDATE DRAFT (happy path) ─────────────────────────────────
  {
    const patchRes = await authFetch(`${POLICY_API}/${draftVersion._id}`, indiaToken, {
      method: "PATCH",
      body: JSON.stringify({ licenseTermMonths: 24 }),
    });
    const patchJson = await patchRes.json();
    check("E: update draft -> 200", patchRes.status === 200, patchRes.status);
    check("E: licenseTermMonths updated to 24", patchJson.data?.version?.licenseTermMonths === 24, patchJson.data?.version?.licenseTermMonths);
    check("E: versionNumber unchanged by update", patchJson.data?.version?.versionNumber === draftVersion.versionNumber, patchJson.data?.version?.versionNumber);
  }

  // ── F/G/H/I — PUBLISH / IMMUTABILITY / SINGLE-PUBLISHED / RETIRE ──
  let publishedVersionOne;
  {
    const publishRes = await authFetch(`${POLICY_API}/${draftVersion._id}/publish`, indiaToken, { method: "POST" });
    const publishJson = await publishRes.json();
    check("G: publish draft -> 200", publishRes.status === 200, publishRes.status);
    check("G: status is PUBLISHED", publishJson.data?.version?.status === "PUBLISHED", publishJson.data?.version?.status);
    check("G: publishedBy is the authenticated admin", String(publishJson.data?.version?.publishedBy) === String(indiaAdmin._id), publishJson.data?.version?.publishedBy);
    check("G: publishedAt is populated", !!publishJson.data?.version?.publishedAt, publishJson.data?.version?.publishedAt);
    publishedVersionOne = publishJson.data?.version;

    // F — published version is immutable.
    const editPublished = await authFetch(`${POLICY_API}/${publishedVersionOne._id}`, indiaToken, {
      method: "PATCH",
      body: JSON.stringify({ licenseTermMonths: 36 }),
    });
    check("F: editing a PUBLISHED version is rejected -> 409", editPublished.status === 409, editPublished.status);

    const republish = await authFetch(`${POLICY_API}/${publishedVersionOne._id}/publish`, indiaToken, { method: "POST" });
    check("F: re-publishing an already-PUBLISHED version is rejected -> 409", republish.status === 409, republish.status);

    const retireNonPublished = await authFetch(`${POLICY_API}/${new mongoose.Types.ObjectId()}/retire`, indiaToken, { method: "POST", body: JSON.stringify({}) });
    check("J: retiring a nonexistent version -> 404", retireNonPublished.status === 404, retireNonPublished.status);
  }

  // H — publishing a SECOND draft auto-retires the first PUBLISHED one.
  let publishedVersionTwo;
  {
    const createRes = await authFetch(POLICY_API, indiaToken, { method: "POST", body: JSON.stringify(validPolicyBody({ licenseTermMonths: 18 })) });
    const createJson = await createRes.json();
    const draftTwo = createJson.data?.version;

    const auditRetiredBefore = await FieldAgentAuditEvent.countDocuments({ action: "COMMERCIAL_POLICY_RETIRED", entityId: publishedVersionOne._id });
    const publishRes = await authFetch(`${POLICY_API}/${draftTwo._id}/publish`, indiaToken, { method: "POST" });
    const publishJson = await publishRes.json();
    check("H: publishing a second draft -> 200", publishRes.status === 200, publishRes.status);
    publishedVersionTwo = publishJson.data?.version;

    const firstAfter = await CommercialPolicyVersion.findById(publishedVersionOne._id).lean();
    check("H: the previously PUBLISHED version is now RETIRED", firstAfter.status === "RETIRED", firstAfter.status);
    check("H: the previously PUBLISHED version has retiredAt/retiredBy set", !!firstAfter.retiredAt && String(firstAfter.retiredBy) === String(indiaAdmin._id), firstAfter);

    const auditRetiredAfter = await FieldAgentAuditEvent.countDocuments({ action: "COMMERCIAL_POLICY_RETIRED", entityId: publishedVersionOne._id });
    check("H: exactly one COMMERCIAL_POLICY_RETIRED audit event for the superseded version", auditRetiredAfter - auditRetiredBefore === 1, auditRetiredAfter - auditRetiredBefore);

    const publishedCount = await CommercialPolicyVersion.countDocuments({ status: "PUBLISHED" });
    check("U: at most one PUBLISHED CommercialPolicyVersion exists at a time (DB-level invariant)", publishedCount <= 1, publishedCount);
  }

  // I — manual retire of the currently-published version.
  {
    const retireRes = await authFetch(`${POLICY_API}/${publishedVersionTwo._id}/retire`, indiaToken, {
      method: "POST",
      body: JSON.stringify({ reason: "FA-5.1 verification — manual retire" }),
    });
    const retireJson = await retireRes.json();
    check("I: retire the currently-published version -> 200", retireRes.status === 200, retireRes.status);
    check("I: status is RETIRED", retireJson.data?.version?.status === "RETIRED", retireJson.data?.version?.status);

    const rePublish = await authFetch(`${POLICY_API}/${publishedVersionTwo._id}/publish`, indiaToken, { method: "POST" });
    check("F: re-publishing a RETIRED version is rejected -> 409", rePublish.status === 409, rePublish.status);

    const doubleRetire = await authFetch(`${POLICY_API}/${publishedVersionTwo._id}/retire`, indiaToken, { method: "POST", body: JSON.stringify({}) });
    check("J: retiring an already-RETIRED version is rejected -> 409", doubleRetire.status === 409, doubleRetire.status);

    const publishedCountAfter = await CommercialPolicyVersion.countDocuments({ status: "PUBLISHED" });
    check("U: zero PUBLISHED versions after manual retire (invariant still holds)", publishedCountAfter === 0, publishedCountAfter);
  }

  // ── K — CONCURRENT CREATE (versionNumber generation, real races) ──
  {
    const bodies = Array.from({ length: 5 }, () => validPolicyBody());
    const responses = await Promise.all(bodies.map((b) => authFetch(POLICY_API, indiaToken, { method: "POST", body: JSON.stringify(b) })));
    check("K: all 5 concurrent create requests succeed -> 201", responses.every((r) => r.status === 201), responses.map((r) => r.status));
    const jsons = await Promise.all(responses.map((r) => r.json()));
    const versionNumbers = jsons.map((j) => j.data?.version?.versionNumber);
    check("K: all 5 concurrently-created versionNumbers are unique", new Set(versionNumbers).size === 5, versionNumbers);
  }

  // ── L — CONCURRENT PUBLISH (real races against the single-published invariant) ──
  {
    const createOne = await authFetch(POLICY_API, indiaToken, { method: "POST", body: JSON.stringify(validPolicyBody()) });
    const createTwo = await authFetch(POLICY_API, indiaToken, { method: "POST", body: JSON.stringify(validPolicyBody()) });
    const [v1, v2] = await Promise.all([createOne.json(), createTwo.json()]);

    const [p1, p2] = await Promise.all([
      authFetch(`${POLICY_API}/${v1.data.version._id}/publish`, indiaToken, { method: "POST" }),
      authFetch(`${POLICY_API}/${v2.data.version._id}/publish`, indiaToken, { method: "POST" }),
    ]);
    check("L: both concurrent publish requests complete without crashing (200 or 409, never 500)", [p1.status, p2.status].every((s) => s === 200 || s === 409), [p1.status, p2.status]);

    const publishedCount = await CommercialPolicyVersion.countDocuments({ status: "PUBLISHED" });
    check("L: exactly one PUBLISHED version survives the concurrent publish race", publishedCount === 1, publishedCount);

    // Clean this race's own resulting published version back to a known state for the rest of the run.
    const stillPublished = await CommercialPolicyVersion.findOne({ status: "PUBLISHED" }).lean();
    if (stillPublished) {
      await authFetch(`${POLICY_API}/${stillPublished._id}/retire`, indiaToken, { method: "POST", body: JSON.stringify({}) });
    }
  }

  // ── M — AUTHORIZATION MATRIX (policy endpoints are INDIA-only for BOTH read and write) ──
  {
    const { token: fieldAgentToken } = await makeFieldAgentFixture("FA-5.1 AuthZ FieldAgent Actor").then((r) => ({
      token: generateAccessToken({ _id: r.user._id, role: "FIELD_AGENT", tokenVersion: r.user.tokenVersion ?? 0 }),
    }));
    const { token: plainUserToken } = await makePlainUser("FA-5.1 AuthZ Plain User");

    const faCreate = await authFetch(POLICY_API, fieldAgentToken, { method: "POST", body: JSON.stringify(validPolicyBody()) });
    check("M: FIELD_AGENT token cannot create a policy version -> 403", faCreate.status === 403, faCreate.status);

    const userList = await authFetch(POLICY_API, plainUserToken);
    check("M: USER token cannot list policy versions -> 403", userList.status === 403, userList.status);

    const noTokenList = await authFetch(POLICY_API, null);
    check("M: unauthenticated request cannot list policy versions -> 401", noTokenList.status === 401, noTokenList.status);

    if (districtToken) {
      const districtList = await authFetch(POLICY_API, districtToken);
      check(`M: ${districtAdmin.adminLevel} admin CANNOT read policy versions (INDIA-only, stricter than approval queue) -> 403`, districtList.status === 403, districtList.status);

      const districtCreate = await authFetch(POLICY_API, districtToken, { method: "POST", body: JSON.stringify(validPolicyBody()) });
      check(`M: ${districtAdmin.adminLevel} admin CANNOT create a policy version -> 403`, districtCreate.status === 403, districtCreate.status);
    }

    const indiaList = await authFetch(POLICY_API, indiaToken);
    check("M: INDIA admin CAN list policy versions", indiaList.status === 200, indiaList.status);
  }

  // ── N — AUDIT TRAIL SANITY (entityType correctness) ───────────────
  {
    const events = await FieldAgentAuditEvent.find({ entityId: publishedVersionTwo._id }).lean();
    check("N: every COMMERCIAL_POLICY_* event for this version has entityType COMMERCIAL_POLICY_VERSION", events.every((e) => e.entityType === "COMMERCIAL_POLICY_VERSION"), events.map((e) => e.entityType));
    check("N: every event's actorType is ADMIN", events.every((e) => e.actorType === "ADMIN"), events.map((e) => e.actorType));
  }

  // ── O — selectCommercialPath: ACQUISITION_AGENT -> ACTIVE ─────────
  {
    const { fieldAgent } = await makeFieldAgentFixture("FA-5.1 Acquisition Path Agent");
    check("O: fixture FieldAgent starts with commercialPath null", fieldAgent.commercialPath === null, fieldAgent.commercialPath);
    check("O: fixture FieldAgent starts PENDING_ACTIVATION", fieldAgent.operationalStatus === "PENDING_ACTIVATION", fieldAgent.operationalStatus);

    const auditBefore = await FieldAgentAuditEvent.countDocuments({ action: "COMMERCIAL_MODEL_SELECTED", entityId: fieldAgent._id });
    const res = await authFetch(`${FIELD_AGENTS_API}/${fieldAgent._id}/commercial-model`, indiaToken, {
      method: "POST",
      body: JSON.stringify({ commercialPath: "ACQUISITION_AGENT" }),
    });
    const json = await res.json();
    check("O: select ACQUISITION_AGENT -> 200", res.status === 200, res.status);
    check("O: commercialPath is ACQUISITION_AGENT", json.data?.fieldAgent?.commercialPath === "ACQUISITION_AGENT", json.data?.fieldAgent?.commercialPath);
    check("O: operationalStatus becomes ACTIVE in the SAME transaction", json.data?.fieldAgent?.operationalStatus === "ACTIVE", json.data?.fieldAgent?.operationalStatus);

    const auditAfter = await FieldAgentAuditEvent.countDocuments({ action: "COMMERCIAL_MODEL_SELECTED", entityId: fieldAgent._id });
    check("O: exactly one COMMERCIAL_MODEL_SELECTED audit event", auditAfter - auditBefore === 1, auditAfter - auditBefore);
  }

  // ── P — selectCommercialPath: TERRITORY_PARTNER stays PENDING_ACTIVATION ──
  {
    const { fieldAgent } = await makeFieldAgentFixture("FA-5.1 Territory Path Agent");
    const res = await authFetch(`${FIELD_AGENTS_API}/${fieldAgent._id}/commercial-model`, indiaToken, {
      method: "POST",
      body: JSON.stringify({ commercialPath: "TERRITORY_PARTNER" }),
    });
    const json = await res.json();
    check("P: select TERRITORY_PARTNER -> 200", res.status === 200, res.status);
    check("P: commercialPath is TERRITORY_PARTNER", json.data?.fieldAgent?.commercialPath === "TERRITORY_PARTNER", json.data?.fieldAgent?.commercialPath);
    check("P: operationalStatus remains PENDING_ACTIVATION (no License/Territory exists yet)", json.data?.fieldAgent?.operationalStatus === "PENDING_ACTIVATION", json.data?.fieldAgent?.operationalStatus);
  }

  // ── Q — ONE-TIME-ONLY: second selection is rejected ───────────────
  {
    const { fieldAgent } = await makeFieldAgentFixture("FA-5.1 One-Time-Only Agent");
    const first = await authFetch(`${FIELD_AGENTS_API}/${fieldAgent._id}/commercial-model`, indiaToken, {
      method: "POST",
      body: JSON.stringify({ commercialPath: "ACQUISITION_AGENT" }),
    });
    check("Q: first selection -> 200", first.status === 200, first.status);

    const second = await authFetch(`${FIELD_AGENTS_API}/${fieldAgent._id}/commercial-model`, indiaToken, {
      method: "POST",
      body: JSON.stringify({ commercialPath: "TERRITORY_PARTNER" }),
    });
    check("Q: second selection on the same FieldAgent is rejected -> 409", second.status === 409, second.status);

    const finalDoc = await FieldAgent.findById(fieldAgent._id).lean();
    check("Q: commercialPath remains the FIRST value chosen, never overwritten", finalDoc.commercialPath === "ACQUISITION_AGENT", finalDoc.commercialPath);
  }

  // ── R — FORBIDDEN FIELD INJECTION / AUTHORIZATION for commercial-model ──
  {
    const { fieldAgent } = await makeFieldAgentFixture("FA-5.1 Rigged Commercial Model Agent");
    const rigged = await authFetch(`${FIELD_AGENTS_API}/${fieldAgent._id}/commercial-model`, indiaToken, {
      method: "POST",
      body: JSON.stringify({ commercialPath: "ACQUISITION_AGENT", operationalStatus: "ACTIVE", approvedBy: "bogus" }),
    });
    check("R: commercial-model body with server-controlled fields rejected -> 400", rigged.status === 400, rigged.status);

    const invalidEnum = await authFetch(`${FIELD_AGENTS_API}/${fieldAgent._id}/commercial-model`, indiaToken, {
      method: "POST",
      body: JSON.stringify({ commercialPath: "SOMETHING_ELSE" }),
    });
    check("R: invalid commercialPath enum value rejected -> 400", invalidEnum.status === 400, invalidEnum.status);

    if (districtToken) {
      const districtSelect = await authFetch(`${FIELD_AGENTS_API}/${fieldAgent._id}/commercial-model`, districtToken, {
        method: "POST",
        body: JSON.stringify({ commercialPath: "ACQUISITION_AGENT" }),
      });
      check(`R: ${districtAdmin.adminLevel} admin CANNOT select a commercial path (INDIA-only) -> 403`, districtSelect.status === 403, districtSelect.status);
    }

    const noTokenSelect = await authFetch(`${FIELD_AGENTS_API}/${fieldAgent._id}/commercial-model`, null, {
      method: "POST",
      body: JSON.stringify({ commercialPath: "ACQUISITION_AGENT" }),
    });
    check("R: unauthenticated request cannot select a commercial path -> 401", noTokenSelect.status === 401, noTokenSelect.status);

    const unknownAgent = await authFetch(`${FIELD_AGENTS_API}/${new mongoose.Types.ObjectId()}/commercial-model`, indiaToken, {
      method: "POST",
      body: JSON.stringify({ commercialPath: "ACQUISITION_AGENT" }),
    });
    check("R: selecting for a nonexistent FieldAgent -> 404", unknownAgent.status === 404, unknownAgent.status);
  }

  // ── S — CONCURRENT selectCommercialPath RACE ──────────────────────
  {
    const { fieldAgent } = await makeFieldAgentFixture("FA-5.1 Concurrent Selection Agent");
    const [r1, r2, r3] = await Promise.all([
      authFetch(`${FIELD_AGENTS_API}/${fieldAgent._id}/commercial-model`, indiaToken, { method: "POST", body: JSON.stringify({ commercialPath: "ACQUISITION_AGENT" }) }),
      authFetch(`${FIELD_AGENTS_API}/${fieldAgent._id}/commercial-model`, indiaToken, { method: "POST", body: JSON.stringify({ commercialPath: "TERRITORY_PARTNER" }) }),
      authFetch(`${FIELD_AGENTS_API}/${fieldAgent._id}/commercial-model`, indiaToken, { method: "POST", body: JSON.stringify({ commercialPath: "ACQUISITION_AGENT" }) }),
    ]);
    const statuses = [r1.status, r2.status, r3.status].sort();
    check("S: exactly one of 3 concurrent selections succeeds (200), the other two are rejected (409)", statuses[0] === 200 && statuses[1] === 409 && statuses[2] === 409, [r1.status, r2.status, r3.status]);

    const finalDoc = await FieldAgent.findById(fieldAgent._id).lean();
    check("S: exactly one coherent final commercialPath (never null, never overwritten twice)", finalDoc.commercialPath === "ACQUISITION_AGENT" || finalDoc.commercialPath === "TERRITORY_PARTNER", finalDoc.commercialPath);

    const auditCount = await FieldAgentAuditEvent.countDocuments({ action: "COMMERCIAL_MODEL_SELECTED", entityId: fieldAgent._id });
    check("S: exactly one COMMERCIAL_MODEL_SELECTED audit event, no duplicates from the race", auditCount === 1, auditCount);
  }

  // ── FINAL DATA INTEGRITY (this run's own fixtures) ────────────────
  {
    const fixturePolicies = await CommercialPolicyVersion.find({ "obligations.key": FIXTURE_MARKER }).lean();
    const versionNumbers = fixturePolicies.map((v) => v.versionNumber);
    check("no duplicate versionNumber among this run's own created policy versions", new Set(versionNumbers).size === versionNumbers.length, versionNumbers);

    const fixtureAgents = await FieldAgent.find({ userRef: { $in: fixtureUserIds } }).lean();
    const noFinancialFields = fixtureAgents.every((a) => {
      const keys = Object.keys(a);
      return keys.every((k) => !/commission|payout|ledger|booking/i.test(k));
    });
    check("no commission/payout/ledger/booking fields anywhere on FieldAgent (financial boundary intact)", noFinancialFields, "fields present");
  }

  // ── CLEANUP ────────────────────────────────────────────────────
  const profileDelete = await FieldAgent.deleteMany({ userRef: { $in: fixtureUserIds } });
  const userDelete = await User.deleteMany({ _id: { $in: fixtureUserIds } });
  const policyDelete = await CommercialPolicyVersion.deleteMany({ "obligations.key": FIXTURE_MARKER });

  const remainingProfiles = await FieldAgent.countDocuments({ userRef: { $in: fixtureUserIds } });
  check("zero FA-5.1 FieldAgent fixtures remain (no residue)", remainingProfiles === 0, remainingProfiles);
  const remainingUsers = await User.countDocuments({ _id: { $in: fixtureUserIds } });
  check("zero FA-5.1 User fixtures remain (no residue)", remainingUsers === 0, remainingUsers);
  const remainingPolicies = await CommercialPolicyVersion.countDocuments({ "obligations.key": FIXTURE_MARKER });
  check("zero FA-5.1 CommercialPolicyVersion fixtures remain (no residue)", remainingPolicies === 0, remainingPolicies);

  server.close();

  console.log("\n" + results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
  console.log(
    `\n🧹 Cleanup: removed ${userDelete.deletedCount} user(s), ${profileDelete.deletedCount} FieldAgent profile(s) (phones 9999908xxx), ${policyDelete.deletedCount} CommercialPolicyVersion fixture(s) (marker "${FIXTURE_MARKER}"). Audit events preserved.`
  );

  await mongoose.connection.close();
  process.exit(fail > 0 ? 1 : 0);
};

run().catch(async (err) => {
  console.error("❌ Verification script crashed:", err.message);
  console.error(err.stack);
  try {
    await mongoose.connection.close();
  } catch (_) {}
  process.exit(1);
});
