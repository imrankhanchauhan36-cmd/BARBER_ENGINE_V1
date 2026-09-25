/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/fieldAgentE2EHelpers.js
 *
 * FA-16 Tier 1 — shared, reusable fixture/setup helpers for the
 * cross-module Field Agent E2E scripts (E2E-01/02/03). Real Mongo,
 * real HTTP, real JWT — same proven pattern as every other permanent
 * verification script in this repo (see scripts/verifyFieldAgent*.js).
 *
 * This file does NOT run any test itself — it exports pure setup
 * helpers only. Each E2E script owns its own pass/fail bookkeeping,
 * its own cleanup registry, and its own assertions.
 *
 * FIXTURE vs REAL TRANSITION — every helper below is labeled:
 *   [REAL API]      — calls a live, mounted HTTP route; this IS the
 *                      production transition being exercised.
 *   [VALID FIXTURE] — creates schema-valid DB state directly, used
 *                      only where the real path requires a frozen,
 *                      heavy, or external-network dependency (e.g.
 *                      Cloudinary document upload, PAN/Aadhaar live
 *                      verification providers, full Booking Engine
 *                      slot-lock/payment HTTP flow) that would make
 *                      Tier-1 setup disproportionate without testing
 *                      the actual boundary FA-16 cares about. Every
 *                      such fixture is documented at its call site
 *                      with exactly which real dependency it stands
 *                      in for.
 */

import mongoose from "mongoose";

export const NAME_PREFIX = "ZE2E_";

let phoneCounter = 0;
// Always exactly 10 digits, matching models/User.js's ^[6-9]\d{9}$.
export const nextPhone = (prefix) => `${prefix}${String(Date.now() % 10000000).padStart(7, "0")}${String(phoneCounter++).padStart(2, "0")}`;

/**
 * [VALID FIXTURE] Minimal Country/State/District/City/Area hierarchy.
 * Geo master data creation is not itself a Field Agent boundary —
 * mirrors the exact fixture pattern already proven and regression-
 * tested in scripts/verifyFieldAgentEarningEngine.js.
 */
const randLetters = () => Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");

/**
 * Exact fixture shape copied verbatim from scripts/verifyFieldAgentEarningEngine.js
 * (FA-9's own currently-passing, 85/85-regression-tested fixture code)
 * — not re-derived from raw schema inspection, to avoid drifting from
 * what is actually proven to validate against the live schema.
 */
export const makeGeoFixture = async ({ Country, State, District, City, Area }, label) => {
  // Country is real, pre-existing national reference data (not a
  // per-test fixture) — reused read-only, never created/modified/
  // deleted by this suite.
  const country = await Country.findOne({}).lean();
  if (!country) throw new Error("No Country document exists in the DB — cannot proceed");
  const state = await State.create({ name: `${NAME_PREFIX}STATE_${label}`, code: randLetters(), type: "STATE", countryRef: country._id, geo: { type: "Point", coordinates: [77, 28] }, isActive: true, isDeleted: false });
  const district = await District.create({ name: `${NAME_PREFIX}DISTRICT_${label}`, code: `ZD${label}${Date.now() % 100000}`, countryRef: country._id, stateRef: state._id, isActive: true, isDeleted: false });
  const city = await City.create({ name: `${NAME_PREFIX}CITY_${label}`, districtRef: district._id, stateRef: state._id, isActive: true, isDeleted: false });
  const area = await Area.create({ name: `${NAME_PREFIX}AREA_${label}`, cityRef: city._id, districtRef: district._id, stateRef: state._id, isActive: true, isDeleted: false });
  return { country, state, district, city, area };
};

/**
 * [VALID FIXTURE] A minimal APPROVED salon owned by a fresh OWNER
 * user. Salon Engine itself is frozen and out of FA-16 scope — this
 * only needs to exist so acquisition/claim/booking flows have a real
 * target document with the correct shape.
 */
export const makeSalonFixture = async ({ User, Salon }, geo, { registerUserId } = {}) => {
  const ownerPhone = nextPhone("7");
  const owner = await User.create({ name: `${NAME_PREFIX}OWNER`, phone: ownerPhone, role: "OWNER", accountStatus: "ACTIVE" });
  if (registerUserId) registerUserId(owner._id);
  const dayTiming = { open: "09:00", close: "20:00" };
  const timings = { monday: dayTiming, tuesday: dayTiming, wednesday: dayTiming, thursday: dayTiming, friday: dayTiming, saturday: dayTiming, sunday: dayTiming };
  const salon = await Salon.create({
    ownerId: owner._id,
    basicInfo: { shopName: `${NAME_PREFIX}SALON_${Date.now()}`, category: "UNISEX" },
    location: {
      address: `${NAME_PREFIX} address`,
      geo: { type: "Point", coordinates: [77, 28] },
      territory: { countryRef: geo.country._id, stateRef: geo.state._id, districtRef: geo.district._id, cityRef: geo.city._id, areaRef: geo.area._id },
    },
    timings,
    approval: { status: "APPROVED" },
    onboarding: { step: 2 },
    isDeleted: false,
  });
  return { owner, salon };
};

/**
 * [VALID FIXTURE] A published TestVersion + MIN_PUBLISHABLE_QUESTIONS
 * (10 — real, current constant, not guessed) TestQuestions, each with
 * a known correct answer. No published TestVersion exists in the live
 * DB today (confirmed by direct read-only inspection during FA-16
 * discovery) — this is genuinely new admin-authored reference data,
 * not a shortcut around FA-3.4's own real submission/grading logic
 * (which E2E-01 exercises for real via the actual test-taking API).
 */
export const makeMinimalTestVersionFixture = async ({ TestVersion, TestQuestion }, indiaAdminId, questionCount = 10) => {
  const version = await TestVersion.create({
    versionNumber: 900000 + Math.floor(Math.random() * 99999),
    status: "PUBLISHED",
    passingScore: 50,
    maxAttempts: 3,
    retryCooldownMinutes: 0,
    createdBy: indiaAdminId,
    publishedBy: indiaAdminId,
    publishedAt: new Date(),
  });
  const questions = [];
  for (let i = 0; i < questionCount; i++) {
    const question = await TestQuestion.create({
      testVersion: version._id,
      order: i,
      translations: [{ languageCode: "en", questionText: `${NAME_PREFIX} sample question ${i}`, options: ["A", "B", "C", "D"], approved: true }],
      grading: { correctOptionIndex: 1 },
      active: true,
    });
    questions.push(question);
  }
  return { version, questions };
};

/**
 * [VALID FIXTURE] An ACTIVE Field Agent identity, created directly
 * (bypassing the real onboarding chain E2E-01 already proves) —
 * exact pattern already used and proven in verifyFieldAgentE2E02.js.
 * Returns a real signed JWT for real HTTP calls.
 */
export const makeActiveFieldAgent = async ({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, label) => {
  const agentUser = await User.create({ name: `${NAME_PREFIX}AGENT_${label}`, phone: nextPhone("9"), role: "FIELD_AGENT", accountStatus: "ACTIVE" });
  const application = await FieldAgentApplication.create({ userRef: agentUser._id, phone: agentUser.phone, status: "APPROVED", nonTerminal: false });
  const fieldAgent = await FieldAgent.create({ userRef: agentUser._id, applicationRef: application._id, agentCode: `${NAME_PREFIX}${label}-${Date.now()}`, operationalStatus: "ACTIVE", commercialPath: "ACQUISITION_AGENT" });
  const token = generateAccessToken({ _id: agentUser._id, role: "FIELD_AGENT", tokenVersion: 0 });
  return { agentUser, application, fieldAgent, token };
};

/**
 * [VALID FIXTURE] A FieldAgentPayoutRequest, created directly rather
 * than through the real withdrawal-eligibility flow (which requires a
 * real completed earning + verified bank KYC — heavy, and already
 * covered end-to-end by FA-14's own frozen 82/82 suite and by
 * verifyFieldAgentE2E03.js's real earning chain). This fixture exists
 * ONLY to test the ownership/authorization boundary on read/cancel
 * routes — it never represents, and this suite never triggers, a real
 * money movement.
 */
export const makePayoutRequestFixture = async (FieldAgentPayoutRequest, fieldAgentId, amountInPaise = 20000) => {
  return FieldAgentPayoutRequest.create({
    fieldAgentRef: fieldAgentId,
    amountInPaise,
    bankSnapshot: { accountHolder: `${NAME_PREFIX}HOLDER`, maskedAccount: "XXXX1234", ifsc: "HDFC0001234", bankName: `${NAME_PREFIX}BANK` },
    idempotencyKey: `${NAME_PREFIX}${fieldAgentId}-${Date.now()}`,
  });
};

export const authFetch = (url, path, token, opts = {}) =>
  fetch(url(path), {
    ...opts,
    headers: {
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));

/**
 * Asserts a value exists and returns it, or throws immediately. Used
 * everywhere an ID must be captured from an HTTP response — never
 * silently optional-chained (the exact class of bug found and fixed
 * in the FA-15 C1 test script this same audit trail already caught
 * once).
 */
export const requireField = (obj, path, context) => {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) break;
    cur = cur[p];
  }
  if (cur === undefined || cur === null) {
    throw new Error(`Expected field "${path}" to be present in ${context} — got ${JSON.stringify(obj)}`);
  }
  return cur;
};

export const oid = () => new mongoose.Types.ObjectId();

/**
 * FA-16 Tier 4 — concurrency barrier. Every task function is CALLED
 * (not awaited) in the same synchronous loop before Promise.all is
 * reached, so all N requests are genuinely in flight together rather
 * than accidentally serialized by an await inside the loop. Records
 * wall-clock start/end and every outcome (fulfilled or rejected —
 * never swallowed). This is a race-timing aid only, never a lock: it
 * does not, and must not, serialize the underlying operations itself.
 */
export const runConcurrent = async (label, taskFns) => {
  const startedAt = Date.now();
  const promises = taskFns.map((fn) => fn()); // constructed synchronously, before any await
  const settled = await Promise.allSettled(promises);
  const endedAt = Date.now();
  const fulfilled = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
  const rejected = settled.filter((s) => s.status === "rejected").map((s) => s.reason);
  return { label, durationMs: endedAt - startedAt, settled, fulfilled, rejected };
};
