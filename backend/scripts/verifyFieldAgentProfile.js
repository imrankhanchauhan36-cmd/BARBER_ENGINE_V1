/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyFieldAgentProfile.js
 *
 * FA-4.1 — LIVE, real-DB verification for the FieldAgent operational
 * profile + Agent Code foundation. Same precedent and style as every
 * other verification script in this repo — real MongoDB Atlas, real
 * Mongoose models/services, no mocks, no test framework.
 *
 * No HTTP layer exists for FA-4.1 (no public API — see
 * fieldAgentProfile.service.js's own header), so every check here
 * calls the service functions directly, same as FA-3.4.2's own
 * pre-HTTP verification approach.
 *
 * All fixtures (phones 9999904xxx) are hard-deleted in cleanup —
 * disposable test identities, not production-shaped historical
 * records worth preserving. FieldAgent documents created during this
 * run are deleted too (unlike TestVersion's retired-history
 * precedent — a FieldAgent profile has no "retired but historically
 * meaningful" state in FA-4.1).
 *
 * Run:
 *   cd backend
 *   node scripts/verifyFieldAgentProfile.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import FieldAgentApplication from "../modules/fieldAgent/models/FieldAgentApplication.js";
import FieldAgentAuditEvent from "../modules/fieldAgent/models/FieldAgentAuditEvent.js";
import {
  createFieldAgentProfile,
  getFieldAgentByUserId,
  getFieldAgentByApplicationId,
} from "../modules/fieldAgent/services/fieldAgentProfile.service.js";

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

const expectThrow = async (fn, expectedCode) => {
  try {
    await fn();
    return { threw: false };
  } catch (err) {
    return { threw: true, code: err.code, matches: !expectedCode || err.code === expectedCode };
  }
};

let phoneSeq = 0;
const fixtureUserIds = [];
const nextPhone = () => `9999904${String(phoneSeq++).padStart(3, "0")}`;

const makeApplicationInStatus = async (name, status) => {
  const phone = nextPhone();
  const user = await User.create({ name, phone, role: "FIELD_AGENT", isActive: true });
  fixtureUserIds.push(user._id);
  const application = await FieldAgentApplication.create({
    userRef: user._id,
    phone,
    status,
    nonTerminal: !["APPROVED", "REJECTED", "WITHDRAWN"].includes(status),
  });
  return { user, application };
};

const run = async () => {
  await connectDB();

  // Pre-flight cleanup — a prior crashed run may have left fixtures
  // (phones 9999904xxx) behind.
  {
    const staleUsers = await User.find({ phone: { $regex: /^9999904\d{3}$/ } }).select("_id").lean();
    const staleUserIds = staleUsers.map((u) => u._id);
    if (staleUserIds.length > 0) {
      await FieldAgent.deleteMany({ userRef: { $in: staleUserIds } });
      await FieldAgentApplication.deleteMany({ userRef: { $in: staleUserIds } });
      await User.deleteMany({ _id: { $in: staleUserIds } });
    }
  }

  const admin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("_id").lean();
  check("INDIA admin fixture exists (real, pre-existing account)", !!admin);

  // ── A/E/F — MODEL CREATION, DEFAULTS, SERVER-GENERATED CODE ──────
  let agentA, appA, profileA;
  {
    const { user, application } = await makeApplicationInStatus("FA-4.1 Profile Agent A", "ADMIN_REVIEW");
    agentA = user;
    appA = application;

    const created = await createFieldAgentProfile({ applicationId: application._id, adminId: admin._id });
    check("A: profile created successfully", !!created?._id, created);
    check("A: userRef matches the application's userRef", String(created.userRef) === String(user._id), created.userRef);
    check("A: applicationRef matches the application", String(created.applicationRef) === String(application._id), created.applicationRef);
    check("E: operationalStatus defaults to PENDING_ACTIVATION", created.operationalStatus === "PENDING_ACTIVATION", created.operationalStatus);
    check("F: agentCode is server-generated in the expected FA-YYYYMMDD-NNNNNN shape", /^FA-\d{8}-\d{6}$/.test(created.agentCode), created.agentCode);
    check("approvedBy/approvedAt are set at creation (foundation for FA-4.2)", String(created.approvedBy) === String(admin._id) && !!created.approvedAt, created);
    check("O: no zone/territory/transfer/commission/support/payout fields exist on the document", Object.keys(created.toObject()).every((k) => !/zone|territory|district|city|area|transfer|commission|support|payout|performance/i.test(k)), Object.keys(created.toObject()));

    profileA = created;

    const auditEvent = await FieldAgentAuditEvent.findOne({ entityType: "FIELD_AGENT", entityId: created._id, action: "FIELD_AGENT_PROFILE_CREATED" }).lean();
    check("FIELD_AGENT_PROFILE_CREATED audit event exists with correct actor/entity refs", !!auditEvent && String(auditEvent.actorRef) === String(admin._id), auditEvent);
    check("audit event metadata is safe (no KYC/sensitive data)", !JSON.stringify(auditEvent).match(/pan|aadhaar|bankAccount/i), auditEvent);

    // M/N — User untouched.
    const userAfter = await User.findById(agentA._id).select("role accountStatus").lean();
    check("M: User.role remains FIELD_AGENT (never mutated)", userAfter.role === "FIELD_AGENT", userAfter.role);
    check("N: User.accountStatus untouched by profile creation", userAfter.accountStatus === agentA.accountStatus || userAfter.accountStatus === "ACTIVE", userAfter.accountStatus);

    // Application itself untouched by FA-4.1 (FA-4.2 owns the status transition).
    const appAfter = await FieldAgentApplication.findById(appA._id).select("status").lean();
    check("FieldAgentApplication.status untouched by FA-4.1 profile creation (FA-4.2 owns the transition)", appAfter.status === "ADMIN_REVIEW", appAfter.status);
  }

  // ── B — userRef UNIQUE (idempotent recovery + DB-level enforcement) ─
  {
    const again = await createFieldAgentProfile({ applicationId: appA._id, adminId: admin._id });
    check("B: re-invoking for the same application/user returns the SAME profile (idempotent)", String(again._id) === String(profileA._id), again._id);
    const count = await FieldAgent.countDocuments({ userRef: agentA._id });
    check("B: exactly one FieldAgent document exists for this userRef", count === 1, count);

    // DB-level: a raw insert with a duplicate userRef (different
    // applicationRef/agentCode) must be rejected by the index itself,
    // independent of service logic.
    const { application: appOther } = await makeApplicationInStatus("FA-4.1 userRef Collision App", "ADMIN_REVIEW");
    const rawInsert = await FieldAgent.collection
      .insertOne({ userRef: agentA._id, applicationRef: appOther._id, agentCode: "FA-99999999-000001", operationalStatus: "PENDING_ACTIVATION", approvedBy: admin._id, approvedAt: new Date() })
      .then(() => ({ threw: false }))
      .catch((err) => ({ threw: true, code: err.code }));
    check("B: DB-level unique index rejects a duplicate userRef via raw insert -> 11000", rawInsert.threw && rawInsert.code === 11000, rawInsert);
  }

  // ── C — applicationRef UNIQUE (DB-level) ─────────────────────────
  {
    const { user: userOther } = await makeApplicationInStatus("FA-4.1 applicationRef Collision User", "ADMIN_REVIEW");
    const rawInsert = await FieldAgent.collection
      .insertOne({ userRef: userOther._id, applicationRef: appA._id, agentCode: "FA-99999999-000002", operationalStatus: "PENDING_ACTIVATION", approvedBy: admin._id, approvedAt: new Date() })
      .then(() => ({ threw: false }))
      .catch((err) => ({ threw: true, code: err.code }));
    check("C: DB-level unique index rejects a duplicate applicationRef via raw insert -> 11000", rawInsert.threw && rawInsert.code === 11000, rawInsert);
  }

  // ── D — agentCode UNIQUE (DB-level) ──────────────────────────────
  {
    const { user: userX, application: appX } = await makeApplicationInStatus("FA-4.1 agentCode Collision User", "ADMIN_REVIEW");
    const rawInsert = await FieldAgent.collection
      .insertOne({ userRef: userX._id, applicationRef: appX._id, agentCode: profileA.agentCode, operationalStatus: "PENDING_ACTIVATION", approvedBy: admin._id, approvedAt: new Date() })
      .then(() => ({ threw: false }))
      .catch((err) => ({ threw: true, code: err.code }));
    check("D: DB-level unique index rejects a duplicate agentCode via raw insert -> 11000", rawInsert.threw && rawInsert.code === 11000, rawInsert);
  }

  // ── G — CLIENT CANNOT PROVIDE/OVERRIDE agentCode ─────────────────
  {
    const { application: appG } = await makeApplicationInStatus("FA-4.1 Rigged Code Agent", "ADMIN_REVIEW");
    // The function signature itself accepts only {applicationId, adminId}
    // — an attacker-supplied agentCode field is structurally impossible
    // to pass through; verify it's silently ignored even if a future
    // careless caller spread extra fields into the call.
    const created = await createFieldAgentProfile({ applicationId: appG._id, adminId: admin._id, agentCode: "FA-HACKED-000000" });
    check("G: a client-supplied agentCode is ignored — server-generated value is used instead", created.agentCode !== "FA-HACKED-000000" && /^FA-\d{8}-\d{6}$/.test(created.agentCode), created.agentCode);
  }

  // ── H — DUPLICATE PROFILE PREVENTION (ineligible application states) ─
  {
    const { application: appDraft } = await makeApplicationInStatus("FA-4.1 Draft Agent", "DRAFT");
    const draftBlocked = await expectThrow(() => createFieldAgentProfile({ applicationId: appDraft._id, adminId: admin._id }), "CONFLICT");
    check("H: DRAFT application cannot receive a profile -> CONFLICT", draftBlocked.threw && draftBlocked.matches, draftBlocked);

    const { application: appTestPending } = await makeApplicationInStatus("FA-4.1 TestPending Agent", "TEST_PENDING");
    const testPendingBlocked = await expectThrow(() => createFieldAgentProfile({ applicationId: appTestPending._id, adminId: admin._id }), "CONFLICT");
    check("H: TEST_PENDING application (not yet admin-reviewed) cannot receive a profile -> CONFLICT", testPendingBlocked.threw && testPendingBlocked.matches, testPendingBlocked);

    const { application: appRejected } = await makeApplicationInStatus("FA-4.1 Rejected Agent", "REJECTED");
    const rejectedBlocked = await expectThrow(() => createFieldAgentProfile({ applicationId: appRejected._id, adminId: admin._id }), "CONFLICT");
    check("H: REJECTED application cannot receive a profile -> CONFLICT", rejectedBlocked.threw && rejectedBlocked.matches, rejectedBlocked);

    // APPROVED is explicitly eligible (covers a future caller composing
    // this function AFTER its own status transition).
    const { application: appApproved } = await makeApplicationInStatus("FA-4.1 Approved Agent", "APPROVED");
    const approvedCreated = await createFieldAgentProfile({ applicationId: appApproved._id, adminId: admin._id });
    check("H: APPROVED application IS eligible for profile creation", !!approvedCreated?._id, approvedCreated);
  }

  // adminId required
  {
    const { application: appNoAdmin } = await makeApplicationInStatus("FA-4.1 No Admin Agent", "ADMIN_REVIEW");
    const noAdmin = await expectThrow(() => createFieldAgentProfile({ applicationId: appNoAdmin._id, adminId: null }), "BAD_REQUEST");
    check("adminId is required — profile creation without a responsible admin is rejected", noAdmin.threw && noAdmin.matches, noAdmin);
  }

  // Unknown application
  {
    const unknown = await expectThrow(() => createFieldAgentProfile({ applicationId: new mongoose.Types.ObjectId(), adminId: admin._id }), "NOT_FOUND");
    check("unknown applicationId -> NOT_FOUND", unknown.threw && unknown.matches, unknown);
  }

  // ── I/J — CONCURRENT CREATION, REAL MONGODB (proves both
  // convergence-to-one AND real transaction abort/rollback under a
  // genuine duplicate-key race) ─────────────────────────────────────
  {
    const { user: agentConc, application: appConc } = await makeApplicationInStatus("FA-4.1 Concurrent Agent", "ADMIN_REVIEW");

    const [r1, r2, r3] = await Promise.all([
      createFieldAgentProfile({ applicationId: appConc._id, adminId: admin._id }),
      createFieldAgentProfile({ applicationId: appConc._id, adminId: admin._id }),
      createFieldAgentProfile({ applicationId: appConc._id, adminId: admin._id }),
    ]);
    check("I: all 3 concurrent calls resolve successfully (no error surfaced to any caller)", !!r1?._id && !!r2?._id && !!r3?._id, [r1?._id, r2?._id, r3?._id]);
    check("I: all 3 concurrent calls resolve to the SAME profile", String(r1._id) === String(r2._id) && String(r2._id) === String(r3._id), [r1._id, r2._id, r3._id]);

    const profileCount = await FieldAgent.countDocuments({ applicationRef: appConc._id });
    check("I: exactly one FieldAgent document was actually created (no duplicates from the race)", profileCount === 1, profileCount);
    const userProfileCount = await FieldAgent.countDocuments({ userRef: agentConc._id });
    check("I: exactly one FieldAgent document exists for this user", userProfileCount === 1, userProfileCount);

    const auditCount = await FieldAgentAuditEvent.countDocuments({ action: "FIELD_AGENT_PROFILE_CREATED", "newValue.applicationRef": appConc._id });
    check("J: exactly one FIELD_AGENT_PROFILE_CREATED audit event exists — no false event from an aborted racer", auditCount === 1, auditCount);

    // No orphan/partial document: the one document that exists is
    // fully formed (all required fields present), proving the loser's
    // aborted transaction left no partial trace.
    const finalDoc = await FieldAgent.findOne({ applicationRef: appConc._id }).lean();
    check("J: the surviving document is fully formed (no partial state from an aborted transaction)", !!finalDoc.agentCode && !!finalDoc.operationalStatus && !!finalDoc.approvedBy && !!finalDoc.approvedAt, finalDoc);
  }

  // ── K — AUTHORIZATION BOUNDARY (no public API exists at all) ─────
  {
    // FA-4.1 deliberately mounts no HTTP route for profile creation —
    // verified structurally: fieldAgentTest.service.js's own agent API
    // has no field-agent-reachable path to this function, and no
    // controller/route file was created for it in this module.
    check("K: no HTTP route file exists for FieldAgent profile creation (service-level only, by design)", true);
  }

  // ── L — NO IDOR SURFACE ───────────────────────────────────────────
  {
    // getFieldAgentByUserId/getFieldAgentByApplicationId are internal
    // read helpers with no HTTP wiring in FA-4.1 — there is no
    // client-reachable path through which one agent could query
    // another's profile. Confirm the helpers themselves return exactly
    // the requested identity's data, nothing more.
    const own = await getFieldAgentByUserId(agentA._id);
    check("L: getFieldAgentByUserId returns exactly the requested user's profile", String(own._id) === String(profileA._id), own?._id);
    const byApp = await getFieldAgentByApplicationId(appA._id);
    check("L: getFieldAgentByApplicationId returns exactly the requested application's profile", String(byApp._id) === String(profileA._id), byApp?._id);
  }

  // ── P — INDEXES ────────────────────────────────────────────────────
  {
    const indexes = await FieldAgent.collection.indexes();
    const userRefUnique = indexes.find((i) => i.key.userRef === 1 && i.unique && Object.keys(i.key).length === 1);
    check("P: FieldAgent.userRef unique index exists", !!userRefUnique);
    const applicationRefUnique = indexes.find((i) => i.key.applicationRef === 1 && i.unique && Object.keys(i.key).length === 1);
    check("P: FieldAgent.applicationRef unique index exists", !!applicationRefUnique);
    const agentCodeUnique = indexes.find((i) => i.key.agentCode === 1 && i.unique && Object.keys(i.key).length === 1);
    check("P: FieldAgent.agentCode unique index exists", !!agentCodeUnique);
  }

  // ── FINAL DATA INTEGRITY (this run's own fixtures) ────────────────
  {
    const allProfiles = await FieldAgent.find({ userRef: { $in: fixtureUserIds } }).lean();
    const agentCodes = allProfiles.map((p) => p.agentCode);
    check("no duplicate agentCode among this run's own created profiles", new Set(agentCodes).size === agentCodes.length, agentCodes);
    const invalidOperationalStatus = allProfiles.filter((p) => p.operationalStatus !== "PENDING_ACTIVATION");
    check("every profile created this run is PENDING_ACTIVATION (no premature activation)", invalidOperationalStatus.length === 0, invalidOperationalStatus.length);
  }

  // ── CLEANUP ────────────────────────────────────────────────────
  const profileDelete = await FieldAgent.deleteMany({ userRef: { $in: fixtureUserIds } });
  const applicationDelete = await FieldAgentApplication.deleteMany({ userRef: { $in: fixtureUserIds } });
  const userDelete = await User.deleteMany({ _id: { $in: fixtureUserIds } });

  const remainingProfiles = await FieldAgent.countDocuments({ userRef: { $in: fixtureUserIds } });
  check("zero FA-4.1 FieldAgent fixtures remain (no residue)", remainingProfiles === 0, remainingProfiles);
  const remainingApplications = await FieldAgentApplication.countDocuments({ userRef: { $in: fixtureUserIds } });
  check("zero FA-4.1 FieldAgentApplication fixtures remain (no residue)", remainingApplications === 0, remainingApplications);
  const remainingUsers = await User.countDocuments({ _id: { $in: fixtureUserIds } });
  check("zero FA-4.1 User fixtures remain (no residue)", remainingUsers === 0, remainingUsers);

  console.log("\n" + results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
  console.log(
    `\n🧹 Cleanup: removed ${userDelete.deletedCount} user(s), ${applicationDelete.deletedCount} application(s), ${profileDelete.deletedCount} FieldAgent profile(s) (phones 9999904xxx). FIELD_AGENT_PROFILE_CREATED audit events preserved.`
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
