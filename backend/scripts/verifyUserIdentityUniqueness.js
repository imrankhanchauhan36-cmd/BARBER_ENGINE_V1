/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyUserIdentityUniqueness.js
 *
 * FA-17 F3 REMEDIATION — permanent regression suite for the shared
 * User.phone/User.email identity-uniqueness fix.
 *
 * ROOT CAUSE (confirmed live, not assumed): models/User.js previously
 * declared both the `phone` and `email` indexes combining
 * `sparse: true` with `partialFilterExpression` — a combination
 * MongoDB rejects outright (error 67, "cannot mix partialFilterExpression
 * and sparse options"). Because the index could never actually be
 * built, the live collection ran on a stale, NON-UNIQUE legacy index
 * instead (`{phone:1,isDeleted:1}` and `{email:1}` sparse-only) —
 * phone/email uniqueness was not enforced in production at all.
 *
 * OFFICIAL V1 IDENTITY POLICY (explicit product decision, now LOCKED —
 * see the FA-17 F3 Cross-Role Identity Decision Report for the full
 * analysis this decision was based on):
 *
 *   ZEMISH V1 IS MODEL B — ROLE-SCOPED IDENTITY.
 *   "Active phone/email uniqueness is enforced PER IMMUTABLE User
 *   role. Cross-role reuse of the same verified phone/email is
 *   INTENTIONALLY ALLOWED in V1."
 *
 *   - SAME ROLE  -> DB-unique, mandatory (phone X + OWNER can back at
 *     most one active User document; likewise for USER/FIELD_AGENT/
 *     ADMIN/etc.).
 *   - CROSS ROLE -> intentionally allowed (phone X + USER and phone X
 *     + OWNER may both exist as two separate, independent identities).
 *
 * A live query of the ACTIVE User collection found 11 real,
 * currently-in-use accounts already relying on the cross-role half of
 * this policy today (predominantly OWNER+USER — the same person
 * booking as a customer and separately owning a salon), several with
 * substantial real production history (bookings, salons, KYC records).
 * These are GRANDFATHERED, VALID V1 DATA under the now-explicit
 * policy — not corruption, not remediation debt, and this suite must
 * never treat them as something to merge, migrate, or delete (F3-03/
 * F3-04 below assert this behavior is CORRECT, not merely "not yet
 * fixed"). A live query also found ZERO same-role phone duplicates and
 * ZERO email duplicates of any kind, and every actual
 * application-level uniqueness check already in this codebase
 * (createOrFindUser in utils/otp.helpers.js — see that function's own
 * policy documentation; the ADMIN-provisioning checks in
 * controllers/state.controller.js and controllers/district.controller.js)
 * scopes its own lookup by {phone/email, role}, matching this policy
 * exactly, never globally.
 *
 * A future Model A (one global, multi-role identity) is explicitly
 * NOT part of V1. If ever desired, it requires a dedicated identity
 * migration project (schema redesign, a rewrite of every User creation
 * path, and a reconciliation plan for the 11+ existing cross-role
 * accounts) — it must never be approximated by a simple unique-index
 * change, and this suite's PASS result must never be read as
 * "cross-role identity is fixed/closed" — it is closed BY POLICY, not
 * by a pending technical fix.
 *
 * Real MongoDB Atlas, real HTTP (app.listen(0)), real JWTs — same
 * proven pattern as every other permanent verification script in this
 * repo. No mocked uniqueness, no fake index assertions.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyUserIdentityUniqueness.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import Country from "../models/Country.js";
import State from "../models/State.js";
import { createOrFindUser } from "../utils/otp.helpers.js";

const NAME_PREFIX = "ZE2E_F3_";
let phoneCounter = 0;
const nextPhone = () => `${NAME_PREFIX ? "9" : "9"}${String(Date.now() % 10000000).padStart(7, "0")}${String(phoneCounter++).padStart(2, "0")}`;

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 400) : ""}`); }
};
const na = (name, reason) => { results.push(`⬜ NOT APPLICABLE / OPEN (not this remediation's scope) — ${name} (${reason})`); };

const authFetch = (url, path, body) =>
  fetch(url(path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));

const createdIds = { users: [], states: [] };
let stateCounter = 0;
const randLetters = () => Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");
// Each ADMIN fixture below uses its OWN fresh State (adminLevel:STATE,
// adminSubRole:SUPPORT) so the pre-existing "one PRIMARY STATE ADMIN
// per state" and "one INDIA ADMIN" exclusivity indexes (unrelated to
// F3, not this remediation's concern) never interfere with isolating
// the email_1_role_1 uniqueness check under test.
const freshAdminState = async (country) => {
  stateCounter++;
  const s = await State.create({ name: `ZE2E_F3_STATE_${Date.now()}_${stateCounter}`, code: randLetters(), type: "STATE", countryRef: country._id, geo: { type: "Point", coordinates: [77, 28] }, isActive: true, isDeleted: false });
  createdIds.states.push(s._id);
  return s;
};

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;

  try {
    const country = await Country.findOne({}).lean();
    check("Setup: a Country reference fixture exists", !!country);

    // ═══════════════════════════════════════════════════════════
    // F3-07 / F3-08 — LIVE INDEX VERIFICATION (the database itself,
    // not the schema declaration, is the authority).
    // ═══════════════════════════════════════════════════════════
    const liveIndexes = await User.collection.indexes();
    const phoneIdx = liveIndexes.find((i) => i.name === "phone_1_role_1");
    const emailIdx = liveIndexes.find((i) => i.name === "email_1_role_1");
    const staleP1 = liveIndexes.find((i) => i.name === "phone_1_isDeleted_1");
    const staleE1 = liveIndexes.find((i) => i.name === "email_1" && i.sparse === true && !i.partialFilterExpression);

    check("F3-07a. Live phone_1_role_1 index exists", !!phoneIdx, phoneIdx);
    check("F3-07b. Live phone_1_role_1 index is unique:true", phoneIdx?.unique === true, phoneIdx?.unique);
    check("F3-07c. Live email_1_role_1 index exists", !!emailIdx, emailIdx);
    check("F3-07d. Live email_1_role_1 index is unique:true", emailIdx?.unique === true, emailIdx?.unique);
    check(
      "F3-08a. Live phone index partialFilterExpression matches intended active/string semantics",
      JSON.stringify(phoneIdx?.partialFilterExpression) === JSON.stringify({ isDeleted: false, phone: { $type: "string" } }),
      phoneIdx?.partialFilterExpression
    );
    check(
      "F3-08b. Live email index partialFilterExpression matches intended active/string semantics",
      JSON.stringify(emailIdx?.partialFilterExpression) === JSON.stringify({ isDeleted: false, email: { $type: "string" } }),
      emailIdx?.partialFilterExpression
    );
    check("F3-08c. Stale legacy phone_1_isDeleted_1 (non-unique) index has been removed", !staleP1, staleP1);
    check("F3-08d. Stale legacy sparse-only email_1 (non-unique) index has been removed", !staleE1, staleE1);

    // F3-09 — Model.init() for the SPECIFIC indexes this remediation
    // owns. A full, unconditional User.init() currently also touches a
    // SEPARATE, pre-existing, unrelated index mismatch on
    // role_1_adminLevel_1 (an admin-hierarchy uniqueness rule, last
    // touched by a different, earlier phase, with a live
    // partialFilterExpression that no longer matches the current
    // schema declaration) — confirmed via direct live-index inspection
    // during this remediation, NOT caused by and explicitly out of
    // scope for this F3 fix (see report). Asserting a blanket
    // Model.init() success here would either falsely fail this suite
    // on an unrelated pre-existing issue, or require touching code
    // outside F3's locked scope — neither is acceptable, so this
    // check verifies the two indexes this remediation is actually
    // responsible for via the same live-index route already proven
    // in F3-07/F3-08 above, which is the more precise, honest proof.
    na("F3-09. Full, unconditional Model.init() success", "a SEPARATE, pre-existing, unrelated index mismatch on role_1_adminLevel_1 (admin-hierarchy uniqueness, not phone/email) currently blocks a blanket User.init() call — confirmed out of F3's locked scope; the phone/email indexes this remediation owns are independently verified live via F3-07/F3-08 above");

    // ═══════════════════════════════════════════════════════════
    // F3-01 — PHONE ACTIVE UNIQUENESS (same role)
    // ═══════════════════════════════════════════════════════════
    const phoneA = nextPhone();
    const userA = await User.create({ name: `${NAME_PREFIX}A`, phone: phoneA, role: "OWNER", accountStatus: "ACTIVE" });
    createdIds.users.push(userA._id);
    let sameRoleDupBlocked = false;
    try {
      await User.create({ name: `${NAME_PREFIX}A2`, phone: phoneA, role: "OWNER", accountStatus: "ACTIVE" });
    } catch (err) {
      sameRoleDupBlocked = err.code === 11000;
    }
    check("F3-01. A second ACTIVE User with the SAME phone+role is rejected (E11000) at the database level", sameRoleDupBlocked);
    const phoneACount = await User.countDocuments({ phone: phoneA, role: "OWNER" });
    check("F3-01b. Exactly one User document exists for this phone+role after the blocked attempt", phoneACount === 1, phoneACount);

    // ═══════════════════════════════════════════════════════════
    // F3-02 — EMAIL ACTIVE UNIQUENESS (same role)
    // ═══════════════════════════════════════════════════════════
    const emailB = `${NAME_PREFIX.toLowerCase()}b_${Date.now()}@example.test`;
    const stateB1 = await freshAdminState(country);
    const userB = await User.create({ name: `${NAME_PREFIX}B`, email: emailB, role: "ADMIN", adminLevel: "STATE", adminSubRole: "SUPPORT", stateRef: stateB1._id, countryRef: country._id, accountStatus: "ACTIVE" });
    createdIds.users.push(userB._id);
    let emailDupBlocked = false;
    try {
      // A DIFFERENT fresh state — isolates the failure to the
      // email_1_role_1 index alone (a same-state attempt would also
      // collide on the unrelated stateRef+adminSubRole exclusivity
      // index, which is not what this check is testing).
      const stateB2 = await freshAdminState(country);
      await User.create({ name: `${NAME_PREFIX}B2`, email: emailB, role: "ADMIN", adminLevel: "STATE", adminSubRole: "SUPPORT", stateRef: stateB2._id, countryRef: country._id, accountStatus: "ACTIVE" });
    } catch (err) {
      emailDupBlocked = err.code === 11000;
    }
    check("F3-02. A second ACTIVE User with the SAME email+role is rejected (E11000) at the database level", emailDupBlocked);
    const emailBCount = await User.countDocuments({ email: emailB, role: "ADMIN" });
    check("F3-02b. Exactly one User document exists for this email+role after the blocked attempt", emailBCount === 1, emailBCount);

    // ═══════════════════════════════════════════════════════════
    // F3-03 / F3-04 — CROSS-ROLE REUSE IS INTENTIONALLY ALLOWED
    // (OFFICIAL V1 POLICY, LOCKED). Asserted here as CORRECT, expected
    // behavior — not merely tolerated or left open. A regression that
    // suddenly started BLOCKING cross-role reuse would itself be a bug
    // under this policy (it would silently break the 11 real,
    // grandfathered production accounts already relying on it), so
    // this check hard-fails if that ever happens.
    // ═══════════════════════════════════════════════════════════
    const phoneC = nextPhone();
    const ownerC = await User.create({ name: `${NAME_PREFIX}C_OWNER`, phone: phoneC, role: "OWNER", accountStatus: "ACTIVE" });
    createdIds.users.push(ownerC._id);
    let crossRoleUserCreated = false;
    try {
      const userC = await User.create({ name: `${NAME_PREFIX}C_USER`, phone: phoneC, role: "USER", accountStatus: "ACTIVE" });
      createdIds.users.push(userC._id);
      crossRoleUserCreated = true;
    } catch { /* leave false — would indicate a policy regression */ }
    check(
      "F3-03. Cross-role phone reuse (OWNER+USER sharing a phone) is ALLOWED by official V1 policy (Model B) — both identities are created successfully, matching the 11 real grandfathered production accounts",
      crossRoleUserCreated
    );

    na("F3-04. Cross-role email collision", "email is required only for role=ADMIN in this schema (models/User.js's pre-validate hook) — no OWNER/USER/FIELD_AGENT analogue to phone's cross-role pattern exists for email to exercise; the same per-role (not global) policy applies identically to email by construction of the F3-02 index, already proven there");

    // ═══════════════════════════════════════════════════════════
    // F3-05 — CONCURRENT SAME-PHONE (same role) CREATION VIA THE REAL
    // createOrFindUser() FUNCTION — exactly the function every OTP
    // flow in production actually calls.
    // ═══════════════════════════════════════════════════════════
    const phoneD = nextPhone();
    const concurrentAttempts = await Promise.allSettled(
      Array.from({ length: 5 }, () => createOrFindUser(phoneD, "OWNER", `${NAME_PREFIX}D`))
    );
    const fulfilled = concurrentAttempts.filter((r) => r.status === "fulfilled");
    fulfilled.forEach((r) => createdIds.users.push(r.value._id));
    const phoneDCount = await User.countDocuments({ phone: phoneD, role: "OWNER" });
    check("F3-05. 5 concurrent createOrFindUser() calls for the SAME phone+role -> exactly 1 active identity exists", phoneDCount === 1, { phoneDCount, fulfilled: fulfilled.length, rejected: concurrentAttempts.length - fulfilled.length });
    check("F3-05b. At least one of the 5 concurrent attempts succeeded (the system is not fully wedged)", fulfilled.length >= 1, fulfilled.length);

    // ═══════════════════════════════════════════════════════════
    // F3-06 — CONCURRENT SAME-EMAIL (same role) CREATION, direct
    // Mongoose create (no shared email-based find-or-create helper
    // exists in this codebase — ADMIN provisioning has its own
    // dedicated pre-check flow, exercised separately in Phase A/etc.
    // regression; this directly proves the DB-level backstop those
    // application checks rely on).
    // ═══════════════════════════════════════════════════════════
    const emailE = `${NAME_PREFIX.toLowerCase()}e_${Date.now()}@example.test`;
    // Each concurrent attempt gets its OWN fresh state, so only the
    // email_1_role_1 index (the thing under test) can cause a
    // rejection — never the unrelated per-state admin-exclusivity index.
    const statesE = await Promise.all(Array.from({ length: 5 }, () => freshAdminState(country)));
    const concurrentEmailAttempts = await Promise.allSettled(
      statesE.map((s, i) => User.create({ name: `${NAME_PREFIX}E${i}`, email: emailE, role: "ADMIN", adminLevel: "STATE", adminSubRole: "SUPPORT", stateRef: s._id, countryRef: country._id, accountStatus: "ACTIVE" }))
    );
    const emailFulfilled = concurrentEmailAttempts.filter((r) => r.status === "fulfilled");
    emailFulfilled.forEach((r) => createdIds.users.push(r.value._id));
    const emailECount = await User.countDocuments({ email: emailE, role: "ADMIN" });
    check("F3-06. 5 concurrent same-email+role creations -> exactly 1 active identity exists", emailECount === 1, { emailECount, fulfilled: emailFulfilled.length });

    // ═══════════════════════════════════════════════════════════
    // Soft-delete semantics (Phase 6 Scenario D) — verify the
    // EXISTING, unmodified business rule: a soft-deleted user's
    // phone/email does not block reuse (partialFilterExpression
    // requires isDeleted:false to count toward the unique constraint).
    // ═══════════════════════════════════════════════════════════
    const phoneF = nextPhone();
    const userF = await User.create({ name: `${NAME_PREFIX}F`, phone: phoneF, role: "OWNER", accountStatus: "ACTIVE" });
    createdIds.users.push(userF._id);
    await User.updateOne({ _id: userF._id }, { $set: { isDeleted: true } });
    let reuseAfterSoftDeleteAllowed = false;
    try {
      const userF2 = await User.create({ name: `${NAME_PREFIX}F2`, phone: phoneF, role: "OWNER", accountStatus: "ACTIVE" });
      createdIds.users.push(userF2._id);
      reuseAfterSoftDeleteAllowed = true;
    } catch { /* leave false */ }
    check("F3-D. A soft-deleted user's phone+role can be reused by a new ACTIVE user (existing, unmodified soft-delete rule — this remediation did not change it)", reuseAfterSoftDeleteAllowed);
    check("F3-D-active. The soft-deleted duplicate itself must NOT still block active uniqueness (still exactly 1 ACTIVE doc for this phone+role now)", (await User.countDocuments({ phone: phoneF, role: "OWNER", isDeleted: { $ne: true } })) === 1);

    // ═══════════════════════════════════════════════════════════
    // F3-10 — REAL HTTP: existing Field Agent operational auth flow
    // still works end-to-end after this remediation (this is exactly
    // the flow verifyFieldAgentOperationalAuth.js's own H-finding
    // documented — re-proving it here that normal operation is
    // unaffected, ahead of running that whole script in Phase 10).
    // ═══════════════════════════════════════════════════════════
    const faPhone = nextPhone();
    const sendRes = await authFetch(url, "/api/field-agent/auth/send-otp", { phone: faPhone });
    check("F3-10a. Field Agent send-otp still -> 200 after the index change", sendRes.status === 200, sendRes);
    const otp = sendRes.data?.otp;
    const verifyRes = await authFetch(url, "/api/field-agent/auth/verify-otp", { phone: faPhone, otp });
    check("F3-10b. Field Agent verify-otp still -> 200, creates exactly one FIELD_AGENT identity", verifyRes.status === 200 && !!verifyRes.data?.accessToken, verifyRes);
    const faUser = await User.findOne({ phone: faPhone, role: "FIELD_AGENT" });
    if (faUser) createdIds.users.push(faUser._id);
    check("F3-10c. Real User document created with role FIELD_AGENT, exactly once", !!faUser, faUser);

  } finally {
    const safeDelete = async (label, fn) => { try { await fn(); } catch (err) { check(`Cleanup step: ${label}`, false, String(err)); } };
    await safeDelete("User", () => User.deleteMany({ _id: { $in: createdIds.users } }));
    await safeDelete("State", () => State.deleteMany({ _id: { $in: createdIds.states } }));

    const residue = {
      users: await User.countDocuments({ _id: { $in: createdIds.users } }),
      states: await State.countDocuments({ _id: { $in: createdIds.states } }),
    };
    check("Cleanup: zero residue across all F3 fixtures", Object.values(residue).every((n) => n === 0), residue);

    server.close();
    await mongoose.disconnect();
  }

  console.log("\n" + results.join("\n"));
  console.log(`\nF3: ${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
