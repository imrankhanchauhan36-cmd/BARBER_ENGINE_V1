/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyCommercialPolicyHardening.js
 *
 * FA-8 — LIVE, real-HTTP, real-DB verification for the two new
 * CommercialPolicyVersion fields (acquisitionAgentCommissionPercent,
 * acquisitionEarningTargetInPaise) and the relaxation of
 * acquisitionIncentiveAmountInPaise to optional. Same precedent and
 * style as scripts/verifyFieldAgentCommercialPolicy.js (FA-5.1) — real
 * Express app, real signed JWTs, real MongoDB Atlas, no mocks.
 *
 * FA-8 does NOT touch the DRAFT/PUBLISHED/RETIRED lifecycle,
 * concurrency, or authorization mechanics themselves — those remain
 * exactly as FA-5.1 built and proved them (re-verified here only to
 * confirm the new fields don't disturb them, not to re-derive them).
 *
 * Fixtures use the same phone/marker conventions as FA-5.1's own
 * script to stay clearly disposable and easy to distinguish in a
 * shared database. All test values below (percentages, paise amounts)
 * are disposable test values only — never production business
 * numbers.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyCommercialPolicyHardening.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import CommercialPolicyVersion from "../modules/fieldAgent/models/CommercialPolicyVersion.js";
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
const nextPhone = () => `9999909${String(phoneSeq++).padStart(3, "0")}`;

const FIXTURE_MARKER = "FA-8-VERIFY-FIXTURE";
const validPolicyBody = (overrides = {}) => ({
  acquisitionAgentCommissionPercent: 10,
  acquisitionEarningTargetInPaise: 100000,
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
    const staleUsers = await User.find({ phone: { $regex: /^9999909\d{3}$/ } }).select("_id").lean();
    const staleUserIds = staleUsers.map((u) => u._id);
    if (staleUserIds.length > 0) {
      await FieldAgent.deleteMany({ userRef: { $in: staleUserIds } });
      await User.deleteMany({ _id: { $in: staleUserIds } });
    }
    await CommercialPolicyVersion.deleteMany({ "obligations.key": FIXTURE_MARKER });
  }

  const publishedBeforeThisScript = await CommercialPolicyVersion.countDocuments({ status: "PUBLISHED" });
  if (publishedBeforeThisScript > 0) {
    console.warn(
      `⚠️  ${publishedBeforeThisScript} PUBLISHED CommercialPolicyVersion(s) already exist — this run's own publish tests will retire any currently PUBLISHED version, exactly like FA-5.1's own script. See that script's header for why this is safe.`
    );
  }

  // ── FIXTURES ───────────────────────────────────────────────────────
  const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion");
  check("INDIA admin fixture exists (real, pre-existing account)", !!indiaAdmin);
  const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

  const makeFieldAgentFixture = async (name) => {
    const phone = nextPhone();
    const user = await User.create({ name, phone, role: "FIELD_AGENT", isActive: true });
    fixtureUserIds.push(user._id);
    const fieldAgent = await FieldAgent.create({
      userRef: user._id,
      applicationRef: new mongoose.Types.ObjectId(),
      agentCode: `FA-99999999-${String(Math.floor(Math.random() * 900000) + 100000)}`,
      operationalStatus: "PENDING_ACTIVATION",
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
  const createdPolicyIds = [];

  // ── A — new fields accepted on CREATE ─────────────────────────────
  let draftVersion;
  {
    const res = await authFetch(POLICY_API, indiaToken, { method: "POST", body: JSON.stringify(validPolicyBody()) });
    const json = await res.json();
    check("A: create with new fields -> 201", res.status === 201, res.status);
    check("A: acquisitionAgentCommissionPercent persisted", json.data?.version?.acquisitionAgentCommissionPercent === 10, json.data?.version?.acquisitionAgentCommissionPercent);
    check("A: acquisitionEarningTargetInPaise persisted", json.data?.version?.acquisitionEarningTargetInPaise === 100000, json.data?.version?.acquisitionEarningTargetInPaise);
    draftVersion = json.data?.version;
    if (draftVersion?._id) createdPolicyIds.push(draftVersion._id);
  }

  // ── B — acquisitionAgentCommissionPercent boundaries ──────────────
  {
    const zero = await authFetch(POLICY_API, indiaToken, { method: "POST", body: JSON.stringify(validPolicyBody({ acquisitionAgentCommissionPercent: 0 })) });
    const zeroJson = await zero.json();
    check("B: acquisitionAgentCommissionPercent = 0 accepted -> 201", zero.status === 201, zero.status);
    if (zeroJson.data?.version?._id) createdPolicyIds.push(zeroJson.data.version._id);

    const hundred = await authFetch(POLICY_API, indiaToken, { method: "POST", body: JSON.stringify(validPolicyBody({ acquisitionAgentCommissionPercent: 100 })) });
    const hundredJson = await hundred.json();
    check("B: acquisitionAgentCommissionPercent = 100 accepted -> 201", hundred.status === 201, hundred.status);
    if (hundredJson.data?.version?._id) createdPolicyIds.push(hundredJson.data.version._id);

    const decimal = await authFetch(POLICY_API, indiaToken, { method: "POST", body: JSON.stringify(validPolicyBody({ acquisitionAgentCommissionPercent: 12.5 })) });
    const decimalJson = await decimal.json();
    check("B: acquisitionAgentCommissionPercent = 12.5 (decimal) accepted -> 201", decimal.status === 201, decimal.status);
    check("B: decimal value persisted exactly", decimalJson.data?.version?.acquisitionAgentCommissionPercent === 12.5, decimalJson.data?.version?.acquisitionAgentCommissionPercent);
    if (decimalJson.data?.version?._id) createdPolicyIds.push(decimalJson.data.version._id);

    const negative = await authFetch(POLICY_API, indiaToken, { method: "POST", body: JSON.stringify(validPolicyBody({ acquisitionAgentCommissionPercent: -1 })) });
    check("B: acquisitionAgentCommissionPercent = -1 rejected -> 400", negative.status === 400, negative.status);

    const over = await authFetch(POLICY_API, indiaToken, { method: "POST", body: JSON.stringify(validPolicyBody({ acquisitionAgentCommissionPercent: 101 })) });
    check("B: acquisitionAgentCommissionPercent = 101 rejected -> 400", over.status === 400, over.status);
  }

  // ── C — acquisitionEarningTargetInPaise boundaries ────────────────
  {
    const zero = await authFetch(POLICY_API, indiaToken, { method: "POST", body: JSON.stringify(validPolicyBody({ acquisitionEarningTargetInPaise: 0 })) });
    const zeroJson = await zero.json();
    check("C: acquisitionEarningTargetInPaise = 0 accepted -> 201", zero.status === 201, zero.status);
    if (zeroJson.data?.version?._id) createdPolicyIds.push(zeroJson.data.version._id);

    const positive = await authFetch(POLICY_API, indiaToken, { method: "POST", body: JSON.stringify(validPolicyBody({ acquisitionEarningTargetInPaise: 500000 })) });
    const positiveJson = await positive.json();
    check("C: positive integer accepted -> 201", positive.status === 201, positive.status);
    if (positiveJson.data?.version?._id) createdPolicyIds.push(positiveJson.data.version._id);

    const nonInteger = await authFetch(POLICY_API, indiaToken, { method: "POST", body: JSON.stringify(validPolicyBody({ acquisitionEarningTargetInPaise: 100.5 })) });
    check("C: non-integer rejected -> 400", nonInteger.status === 400, nonInteger.status);

    const negative = await authFetch(POLICY_API, indiaToken, { method: "POST", body: JSON.stringify(validPolicyBody({ acquisitionEarningTargetInPaise: -1 })) });
    check("C: negative rejected -> 400", negative.status === 400, negative.status);
  }

  // ── D — missing required fields on CREATE ─────────────────────────
  {
    const missingPercent = await authFetch(POLICY_API, indiaToken, {
      method: "POST",
      body: JSON.stringify((() => {
        const b = validPolicyBody();
        delete b.acquisitionAgentCommissionPercent;
        return b;
      })()),
    });
    check("D: missing acquisitionAgentCommissionPercent rejected -> 400", missingPercent.status === 400, missingPercent.status);

    const missingTarget = await authFetch(POLICY_API, indiaToken, {
      method: "POST",
      body: JSON.stringify((() => {
        const b = validPolicyBody();
        delete b.acquisitionEarningTargetInPaise;
        return b;
      })()),
    });
    check("D: missing acquisitionEarningTargetInPaise rejected -> 400", missingTarget.status === 400, missingTarget.status);
  }

  // ── E — new fields editable while DRAFT ───────────────────────────
  {
    const patchRes = await authFetch(`${POLICY_API}/${draftVersion._id}`, indiaToken, {
      method: "PATCH",
      body: JSON.stringify({ acquisitionAgentCommissionPercent: 25, acquisitionEarningTargetInPaise: 250000 }),
    });
    const patchJson = await patchRes.json();
    check("E: update DRAFT with new fields -> 200", patchRes.status === 200, patchRes.status);
    check("E: acquisitionAgentCommissionPercent updated", patchJson.data?.version?.acquisitionAgentCommissionPercent === 25, patchJson.data?.version?.acquisitionAgentCommissionPercent);
    check("E: acquisitionEarningTargetInPaise updated", patchJson.data?.version?.acquisitionEarningTargetInPaise === 250000, patchJson.data?.version?.acquisitionEarningTargetInPaise);
  }

  // ── F/G — PUBLISHED and RETIRED immutability for the new fields ───
  let publishedOne;
  {
    const publishRes = await authFetch(`${POLICY_API}/${draftVersion._id}/publish`, indiaToken, { method: "POST" });
    const publishJson = await publishRes.json();
    check("F: publish -> 200", publishRes.status === 200, publishRes.status);
    publishedOne = publishJson.data?.version;

    const editPublished = await authFetch(`${POLICY_API}/${publishedOne._id}`, indiaToken, {
      method: "PATCH",
      body: JSON.stringify({ acquisitionAgentCommissionPercent: 99 }),
    });
    check("F: editing new fields on a PUBLISHED version rejected -> 409", editPublished.status === 409, editPublished.status);

    const stillPublished = await CommercialPolicyVersion.findById(publishedOne._id).lean();
    check("F: PUBLISHED version's new-field values unchanged after the rejected edit attempt", stillPublished.acquisitionAgentCommissionPercent === 25, stillPublished.acquisitionAgentCommissionPercent);
  }

  // K — historical version resolution: two published-then-retired versions retain independent values.
  {
    const v2Create = await authFetch(POLICY_API, indiaToken, {
      method: "POST",
      body: JSON.stringify(validPolicyBody({ acquisitionAgentCommissionPercent: 40, acquisitionEarningTargetInPaise: 400000 })),
    });
    const v2Json = await v2Create.json();
    const draftTwo = v2Json.data?.version;

    const publishTwo = await authFetch(`${POLICY_API}/${draftTwo._id}/publish`, indiaToken, { method: "POST" });
    check("K: publish version two -> 200", publishTwo.status === 200, publishTwo.status);

    const oneAfter = await CommercialPolicyVersion.findById(publishedOne._id).lean();
    check("K: version one is now RETIRED (auto-retired by version two's publish)", oneAfter.status === "RETIRED", oneAfter.status);
    check("K: version one retains its OWN acquisitionAgentCommissionPercent (25) after being retired", oneAfter.acquisitionAgentCommissionPercent === 25, oneAfter.acquisitionAgentCommissionPercent);
    check("K: version one retains its OWN acquisitionEarningTargetInPaise (250000) after being retired", oneAfter.acquisitionEarningTargetInPaise === 250000, oneAfter.acquisitionEarningTargetInPaise);

    const twoAfter = await CommercialPolicyVersion.findById(draftTwo._id).lean();
    check("K: version two has its OWN, independent acquisitionAgentCommissionPercent (40)", twoAfter.acquisitionAgentCommissionPercent === 40, twoAfter.acquisitionAgentCommissionPercent);
    check("K: version two has its OWN, independent acquisitionEarningTargetInPaise (400000)", twoAfter.acquisitionEarningTargetInPaise === 400000, twoAfter.acquisitionEarningTargetInPaise);

    // G — RETIRED immutability for the new fields.
    const editRetired = await authFetch(`${POLICY_API}/${publishedOne._id}`, indiaToken, {
      method: "PATCH",
      body: JSON.stringify({ acquisitionAgentCommissionPercent: 1 }),
    });
    check("G: editing new fields on a RETIRED version rejected -> 409", editRetired.status === 409, editRetired.status);

    // Clean this section's own published version back to a known state.
    await authFetch(`${POLICY_API}/${draftTwo._id}/retire`, indiaToken, { method: "POST", body: JSON.stringify({}) });
  }

  // ── H — exactly one PUBLISHED invariant still intact ──────────────
  {
    const publishedCount = await CommercialPolicyVersion.countDocuments({ status: "PUBLISHED" });
    check("H: zero PUBLISHED versions after this script's own manual retire (invariant intact)", publishedCount === 0, publishedCount);
  }

  // ── I — concurrent publish still safe with the new required fields ──
  {
    const c1 = await authFetch(POLICY_API, indiaToken, { method: "POST", body: JSON.stringify(validPolicyBody()) });
    const c2 = await authFetch(POLICY_API, indiaToken, { method: "POST", body: JSON.stringify(validPolicyBody()) });
    const [j1, j2] = await Promise.all([c1.json(), c2.json()]);
    if (j1.data?.version?._id) createdPolicyIds.push(j1.data.version._id);
    if (j2.data?.version?._id) createdPolicyIds.push(j2.data.version._id);

    const [p1, p2] = await Promise.all([
      authFetch(`${POLICY_API}/${j1.data.version._id}/publish`, indiaToken, { method: "POST" }),
      authFetch(`${POLICY_API}/${j2.data.version._id}/publish`, indiaToken, { method: "POST" }),
    ]);
    check("I: concurrent publish never 500s (200 or 409 only)", [p1.status, p2.status].every((s) => s === 200 || s === 409), [p1.status, p2.status]);

    const publishedCount = await CommercialPolicyVersion.countDocuments({ status: "PUBLISHED" });
    check("I: exactly one PUBLISHED version survives the concurrent publish race", publishedCount === 1, publishedCount);

    const winner = await CommercialPolicyVersion.findOne({ status: "PUBLISHED" }).lean();
    check("I: the surviving PUBLISHED version has valid new-field values", winner.acquisitionAgentCommissionPercent === 10 && winner.acquisitionEarningTargetInPaise === 100000, winner);

    // Clean back to a known state for the rest of the run.
    if (winner) {
      await authFetch(`${POLICY_API}/${winner._id}/retire`, indiaToken, { method: "POST", body: JSON.stringify({}) });
    }
  }

  // ── J — publish transaction/retry behavior unaffected ─────────────
  {
    // The retry-on-transient-conflict path lives entirely inside
    // publishPolicyVersion (untouched by FA-8) and was already
    // exercised by section I's real concurrent race above (two
    // simultaneous publishes against the single-PUBLISHED invariant
    // necessarily drive at least one attempt through that retry
    // path). Re-confirm here that a normal, uncontended publish still
    // behaves identically with the new required fields present.
    const create = await authFetch(POLICY_API, indiaToken, { method: "POST", body: JSON.stringify(validPolicyBody()) });
    const createJson = await create.json();
    if (createJson.data?.version?._id) createdPolicyIds.push(createJson.data.version._id);

    const publish = await authFetch(`${POLICY_API}/${createJson.data.version._id}/publish`, indiaToken, { method: "POST" });
    check("J: normal uncontended publish still -> 200 with new required fields present", publish.status === 200, publish.status);

    await authFetch(`${POLICY_API}/${createJson.data.version._id}/retire`, indiaToken, { method: "POST", body: JSON.stringify({}) });
  }

  // ── L — unknown field rejection ────────────────────────────────────
  {
    const unknown = await authFetch(POLICY_API, indiaToken, {
      method: "POST",
      body: JSON.stringify(validPolicyBody({ someRandomUnknownField: 123 })),
    });
    check("L: unknown field rejected -> 400", unknown.status === 400, unknown.status);
  }

  // ── M — server-controlled field injection still rejected ──────────
  {
    const rigged = await authFetch(POLICY_API, indiaToken, {
      method: "POST",
      body: JSON.stringify(validPolicyBody({ versionNumber: 999999, status: "PUBLISHED", publishedAt: new Date().toISOString() })),
    });
    check("M: server-controlled fields in create body rejected -> 400", rigged.status === 400, rigged.status);

    const riggedUpdate = await authFetch(`${POLICY_API}/${draftVersion._id}`, indiaToken, {
      method: "PATCH",
      body: JSON.stringify({ status: "PUBLISHED", createdBy: "bogus" }),
    });
    check("M: server-controlled fields in update body rejected -> 400", riggedUpdate.status === 400, riggedUpdate.status);
  }

  // ── N — FIELD_AGENT cannot access admin policy endpoints ──────────
  {
    const { user } = await makeFieldAgentFixture("FA-8 AuthZ FieldAgent Actor");
    const faToken = generateAccessToken({ _id: user._id, role: "FIELD_AGENT", tokenVersion: user.tokenVersion ?? 0 });
    const faCreate = await authFetch(POLICY_API, faToken, { method: "POST", body: JSON.stringify(validPolicyBody()) });
    check("N: FIELD_AGENT cannot create a policy version -> 403", faCreate.status === 403, faCreate.status);
  }

  // ── O — USER cannot access admin policy endpoints ─────────────────
  {
    const { token: userToken } = await makePlainUser("FA-8 AuthZ Plain User");
    const userList = await authFetch(POLICY_API, userToken);
    check("O: USER cannot list policy versions -> 403", userList.status === 403, userList.status);
  }

  // ── P — unauthenticated request rejected ──────────────────────────
  {
    const noToken = await authFetch(POLICY_API, null);
    check("P: unauthenticated request rejected -> 401", noToken.status === 401, noToken.status);
  }

  // ── Q — INDIA admin retains authorized access ─────────────────────
  {
    const indiaList = await authFetch(POLICY_API, indiaToken);
    check("Q: INDIA admin retains authorized list access -> 200", indiaList.status === 200, indiaList.status);
  }

  // ── R — acquisitionIncentiveAmountInPaise now optional ────────────
  {
    const withoutIncentive = await authFetch(POLICY_API, indiaToken, {
      method: "POST",
      body: JSON.stringify((() => {
        const b = validPolicyBody();
        delete b.acquisitionIncentiveAmountInPaise; // was never set by validPolicyBody() anyway — explicit for clarity
        return b;
      })()),
    });
    const withoutIncentiveJson = await withoutIncentive.json();
    check("R: create WITHOUT acquisitionIncentiveAmountInPaise -> 201 (now optional)", withoutIncentive.status === 201, withoutIncentive.status);
    check("R: acquisitionIncentiveAmountInPaise absent/undefined on the created document", withoutIncentiveJson.data?.version?.acquisitionIncentiveAmountInPaise === undefined, withoutIncentiveJson.data?.version?.acquisitionIncentiveAmountInPaise);
    if (withoutIncentiveJson.data?.version?._id) createdPolicyIds.push(withoutIncentiveJson.data.version._id);

    const withIncentive = await authFetch(POLICY_API, indiaToken, {
      method: "POST",
      body: JSON.stringify(validPolicyBody({ acquisitionIncentiveAmountInPaise: 50000 })),
    });
    const withIncentiveJson = await withIncentive.json();
    check("R: create WITH acquisitionIncentiveAmountInPaise still -> 201 (still accepted, still validated)", withIncentive.status === 201, withIncentive.status);
    check("R: acquisitionIncentiveAmountInPaise persisted when supplied", withIncentiveJson.data?.version?.acquisitionIncentiveAmountInPaise === 50000, withIncentiveJson.data?.version?.acquisitionIncentiveAmountInPaise);
    if (withIncentiveJson.data?.version?._id) createdPolicyIds.push(withIncentiveJson.data.version._id);

    const negativeIncentiveStillRejected = await authFetch(POLICY_API, indiaToken, {
      method: "POST",
      body: JSON.stringify(validPolicyBody({ acquisitionIncentiveAmountInPaise: -1 })),
    });
    check("R: acquisitionIncentiveAmountInPaise = -1 still rejected -> 400 (validation intact when supplied)", negativeIncentiveStillRejected.status === 400, negativeIncentiveStillRejected.status);
  }

  // ── T — no new index was created on CommercialPolicyVersion ──────
  {
    const indexes = await CommercialPolicyVersion.collection.indexes();
    check("T: exactly the 3 pre-existing indexes remain (_id_, versionNumber_1, partial status_1) — no new index", indexes.length === 3, indexes.map((i) => i.name));
  }

  // ── FINAL DATA INTEGRITY (this run's own fixtures) ────────────────
  {
    const fixturePolicies = await CommercialPolicyVersion.find({ "obligations.key": FIXTURE_MARKER }).lean();
    const versionNumbers = fixturePolicies.map((v) => v.versionNumber);
    check("no duplicate versionNumber among this run's own created policy versions", new Set(versionNumbers).size === versionNumbers.length, versionNumbers);
  }

  // ── CLEANUP ────────────────────────────────────────────────────
  const profileDelete = await FieldAgent.deleteMany({ userRef: { $in: fixtureUserIds } });
  const userDelete = await User.deleteMany({ _id: { $in: fixtureUserIds } });
  const policyDelete = await CommercialPolicyVersion.deleteMany({ "obligations.key": FIXTURE_MARKER });

  const remainingProfiles = await FieldAgent.countDocuments({ userRef: { $in: fixtureUserIds } });
  check("zero FA-8 FieldAgent fixtures remain (no residue)", remainingProfiles === 0, remainingProfiles);
  const remainingUsers = await User.countDocuments({ _id: { $in: fixtureUserIds } });
  check("zero FA-8 User fixtures remain (no residue)", remainingUsers === 0, remainingUsers);
  const remainingPolicies = await CommercialPolicyVersion.countDocuments({ "obligations.key": FIXTURE_MARKER });
  check("zero FA-8 CommercialPolicyVersion fixtures remain (no residue)", remainingPolicies === 0, remainingPolicies);

  server.close();

  console.log("\n" + results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
  console.log(
    `\n🧹 Cleanup: removed ${userDelete.deletedCount} user(s), ${profileDelete.deletedCount} FieldAgent profile(s) (phones 9999909xxx), ${policyDelete.deletedCount} CommercialPolicyVersion fixture(s) (marker "${FIXTURE_MARKER}"). Audit events preserved.`
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
