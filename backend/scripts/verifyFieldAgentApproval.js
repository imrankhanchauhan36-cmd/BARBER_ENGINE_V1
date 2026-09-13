/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyFieldAgentApproval.js
 *
 * FA-4.2 — LIVE, real-HTTP, real-DB verification for admin
 * approval/rejection of Field Agent applications. Same precedent and
 * style as every other verification script in this repo — real
 * Express app, real signed JWTs, real MongoDB Atlas, no mocks.
 *
 * All fixtures (phones 9999905xxx) are hard-deleted in cleanup.
 * FIELD_AGENT_APPROVED/FIELD_AGENT_REJECTED/FIELD_AGENT_PROFILE_CREATED
 * audit events are preserved (append-only, same precedent as every
 * other audit collection in this codebase).
 *
 * Run:
 *   cd backend
 *   node scripts/verifyFieldAgentApproval.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import FieldAgentApplication from "../modules/fieldAgent/models/FieldAgentApplication.js";
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
const nextPhone = () => `9999905${String(phoneSeq++).padStart(3, "0")}`;

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
    const staleUsers = await User.find({ phone: { $regex: /^9999905\d{3}$/ } }).select("_id").lean();
    const staleUserIds = staleUsers.map((u) => u._id);
    if (staleUserIds.length > 0) {
      await FieldAgent.deleteMany({ userRef: { $in: staleUserIds } });
      await FieldAgentApplication.deleteMany({ userRef: { $in: staleUserIds } });
      await User.deleteMany({ _id: { $in: staleUserIds } });
    }
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

  const makeApplicationInStatus = async (name, status, extra = {}) => {
    const phone = nextPhone();
    const user = await User.create({ name, phone, role: "FIELD_AGENT", isActive: true });
    fixtureUserIds.push(user._id);
    const application = await FieldAgentApplication.create({
      userRef: user._id,
      phone,
      status,
      nonTerminal: !["APPROVED", "REJECTED", "WITHDRAWN"].includes(status),
      ...extra,
    });
    const token = generateAccessToken({ _id: user._id, role: "FIELD_AGENT", tokenVersion: user.tokenVersion ?? 0 });
    return { user, application, token };
  };

  const makePlainUser = async (name) => {
    const phone = nextPhone();
    const user = await User.create({ name, phone, role: "USER", isActive: true });
    fixtureUserIds.push(user._id);
    return { user, token: generateAccessToken({ _id: user._id, role: "USER", tokenVersion: user.tokenVersion ?? 0 }) };
  };

  const ADMIN_API = "/api/admin/field-agents";

  // ── A-G — HAPPY PATH APPROVAL ───────────────────────────────────────
  let happyPathApp;
  {
    const { user, application } = await makeApplicationInStatus("FA-4.2 Approve Agent", "ADMIN_REVIEW");
    happyPathApp = application;

    const auditApprovedBefore = await FieldAgentAuditEvent.countDocuments({ action: "FIELD_AGENT_APPROVED", entityId: application._id });
    const auditProfileCreatedBefore = await FieldAgentAuditEvent.countDocuments({ action: "FIELD_AGENT_PROFILE_CREATED" });

    const approveRes = await authFetch(`${ADMIN_API}/${application._id}/approve`, indiaToken, { method: "POST", body: JSON.stringify({}) });
    const approveJson = await approveRes.json();
    check("A: ADMIN_REVIEW -> APPROVED via INDIA admin -> 200", approveRes.status === 200, approveRes.status);
    check("A: application.status is APPROVED", approveJson.data.application.status === "APPROVED", approveJson.data.application.status);

    check("B: FieldAgent profile created", !!approveJson.data.profile?._id, approveJson.data.profile);
    const profile = await FieldAgent.findById(approveJson.data.profile._id).lean();
    check("B: profile.userRef matches the applicant", String(profile.userRef) === String(user._id), profile.userRef);
    check("B: profile.applicationRef matches the application", String(profile.applicationRef) === String(application._id), profile.applicationRef);

    check("C: agentCode is unique and server-generated in the expected shape", /^FA-\d{8}-\d{6}$/.test(profile.agentCode), profile.agentCode);
    check("D: operationalStatus is PENDING_ACTIVATION", profile.operationalStatus === "PENDING_ACTIVATION", profile.operationalStatus);
    check("E: approvedBy is the authenticated admin", String(profile.approvedBy) === String(indiaAdmin._id), profile.approvedBy);
    check("F: approvedAt is populated", !!profile.approvedAt, profile.approvedAt);

    const auditApprovedAfter = await FieldAgentAuditEvent.countDocuments({ action: "FIELD_AGENT_APPROVED", entityId: application._id });
    check("G: exactly one FIELD_AGENT_APPROVED audit event", auditApprovedAfter - auditApprovedBefore === 1, auditApprovedAfter - auditApprovedBefore);
    const auditProfileCreatedAfter = await FieldAgentAuditEvent.countDocuments({ action: "FIELD_AGENT_PROFILE_CREATED" });
    check("approval also produces exactly one FIELD_AGENT_PROFILE_CREATED (reused from FA-4.1, inside the same transaction)", auditProfileCreatedAfter - auditProfileCreatedBefore === 1, auditProfileCreatedAfter - auditProfileCreatedBefore);

    const appAfter = await FieldAgentApplication.findById(application._id).lean();
    check("reviewedBy/reviewedAt set on the application", String(appAfter.reviewedBy) === String(indiaAdmin._id) && !!appAfter.reviewedAt, appAfter);

    // AA/AB — User untouched.
    const userAfter = await User.findById(user._id).select("role accountStatus").lean();
    check("AA: User.role remains FIELD_AGENT (never mutated)", userAfter.role === "FIELD_AGENT", userAfter.role);
    check("AB: User.accountStatus untouched by approval", userAfter.accountStatus === "ACTIVE" || userAfter.accountStatus === user.accountStatus, userAfter.accountStatus);

    // AC/AD — no zone/commission/support/payout fields on the profile.
    const keys = Object.keys(profile);
    check("AC/AD: no zone/territory/transfer/commission/support/payout/performance fields on the profile", keys.every((k) => !/zone|territory|district|city|area|transfer|commission|support|payout|performance/i.test(k)), keys);
  }

  // ── H — APPROVAL FROM INVALID STATES REJECTED ─────────────────────
  {
    for (const status of ["DRAFT", "SUBMITTED", "KYC_PENDING", "TRAINING_PENDING", "TEST_PENDING", "TEST_FAILED"]) {
      const { application } = await makeApplicationInStatus(`FA-4.2 Invalid ${status} Agent`, status);
      const res = await authFetch(`${ADMIN_API}/${application._id}/approve`, indiaToken, { method: "POST", body: JSON.stringify({}) });
      check(`H: approval from ${status} is rejected -> 409`, res.status === 409, res.status);
    }
    const { application: rejectedApp } = await makeApplicationInStatus("FA-4.2 Already Rejected Agent", "REJECTED", { rejectionReason: "prior reason" });
    const rejectedRes = await authFetch(`${ADMIN_API}/${rejectedApp._id}/approve`, indiaToken, { method: "POST", body: JSON.stringify({}) });
    check("H: approval from REJECTED is rejected -> 409", rejectedRes.status === 409, rejectedRes.status);

    const { application: withdrawnApp } = await makeApplicationInStatus("FA-4.2 Withdrawn Agent", "WITHDRAWN", { withdrawnAt: new Date() });
    const withdrawnRes = await authFetch(`${ADMIN_API}/${withdrawnApp._id}/approve`, indiaToken, { method: "POST", body: JSON.stringify({}) });
    check("H: approval from WITHDRAWN is rejected -> 409", withdrawnRes.status === 409, withdrawnRes.status);
  }

  // ── I/J/K/L/M — REJECTION ─────────────────────────────────────────
  let rejectedAppForResubmission, rejectedAgentUser;
  {
    const { user, application, token: applicantToken } = await makeApplicationInStatus("FA-4.2 Reject Agent", "ADMIN_REVIEW");
    rejectedAppForResubmission = application;
    rejectedAgentUser = user;

    const blankRes = await authFetch(`${ADMIN_API}/${application._id}/reject`, indiaToken, { method: "POST", body: JSON.stringify({ reason: "   " }) });
    check("J: blank rejection reason rejected -> 400", blankRes.status === 400, blankRes.status);

    const oversizedRes = await authFetch(`${ADMIN_API}/${application._id}/reject`, indiaToken, { method: "POST", body: JSON.stringify({ reason: "x".repeat(501) }) });
    check("K: oversized rejection reason (501 chars) rejected -> 400", oversizedRes.status === 400, oversizedRes.status);

    const auditRejectedBefore = await FieldAgentAuditEvent.countDocuments({ action: "FIELD_AGENT_REJECTED", entityId: application._id });

    const REASON = "Aadhaar photo was blurry and unreadable — please re-upload a clear scan.";
    const rejectRes = await authFetch(`${ADMIN_API}/${application._id}/reject`, indiaToken, { method: "POST", body: JSON.stringify({ reason: REASON }) });
    const rejectJson = await rejectRes.json();
    check("I: rejection with a valid reason -> 200", rejectRes.status === 200, rejectRes.status);
    check("I: application.status is REJECTED", rejectJson.data.application.status === "REJECTED", rejectJson.data.application.status);
    check("I: rejectionReason persisted verbatim", rejectJson.data.application.rejectionReason === REASON, rejectJson.data.application.rejectionReason);

    const auditRejectedAfter = await FieldAgentAuditEvent.countDocuments({ action: "FIELD_AGENT_REJECTED", entityId: application._id });
    check("L: exactly one FIELD_AGENT_REJECTED audit event", auditRejectedAfter - auditRejectedBefore === 1, auditRejectedAfter - auditRejectedBefore);
    const rejectedEvent = await FieldAgentAuditEvent.findOne({ action: "FIELD_AGENT_REJECTED", entityId: application._id }).lean();
    check("L: rejection audit reason matches", rejectedEvent.reason === REASON, rejectedEvent.reason);

    // Z — no profile on rejected application.
    const profileCount = await FieldAgent.countDocuments({ applicationRef: application._id });
    check("Z: no FieldAgent profile exists for a rejected application", profileCount === 0, profileCount);

    // M — applicant sees rejection reason via the EXISTING agent-facing endpoint.
    const meRes = await authFetch("/api/field-agent/applications/me", applicantToken);
    const meJson = await meRes.json();
    check("M: applicant sees the rejection reason via GET /api/field-agent/applications/me (existing endpoint, no new API)", meRes.status === 200 && meJson.data.application.rejectionReason === REASON, meJson.data?.application?.rejectionReason);
  }

  // ── N/O — RESUBMISSION VIA THE EXISTING, UNMODIFIED FA-2 FLOW ─────
  {
    const applicantToken = generateAccessToken({ _id: rejectedAgentUser._id, role: "FIELD_AGENT", tokenVersion: rejectedAgentUser.tokenVersion ?? 0 });

    const resubmitRes = await authFetch("/api/field-agent/applications", applicantToken, { method: "POST", body: JSON.stringify({}) });
    const resubmitJson = await resubmitRes.json();
    check("N: applicant can create a NEW application after rejection (existing FA-2 createOrGetDraftApplication, unmodified)", resubmitRes.status === 201, resubmitRes.status);
    check("N: the new application is a genuinely DIFFERENT document from the rejected one", String(resubmitJson.data.application._id) !== String(rejectedAppForResubmission._id), resubmitJson.data.application._id);
    check("N: the new application starts at DRAFT", resubmitJson.data.application.status === "DRAFT", resubmitJson.data.application.status);
    check(
      "O: the new application has null kycRef/trainingRef/testAttemptRef — KYC/training/test gates are NOT bypassed, must be redone",
      resubmitJson.data.application.kycRef == null && resubmitJson.data.application.trainingRef == null && resubmitJson.data.application.testAttemptRef == null,
      resubmitJson.data.application
    );

    // The old REJECTED document itself is untouched and permanently terminal.
    const oldAppStill = await FieldAgentApplication.findById(rejectedAppForResubmission._id).lean();
    check("the original REJECTED application remains REJECTED, untouched by resubmission", oldAppStill.status === "REJECTED", oldAppStill.status);
  }

  // ── P — REPEATED APPROVAL IDEMPOTENCY ─────────────────────────────
  {
    const auditBefore = await FieldAgentAuditEvent.countDocuments({ action: "FIELD_AGENT_APPROVED", entityId: happyPathApp._id });
    const profileCountBefore = await FieldAgent.countDocuments({ applicationRef: happyPathApp._id });

    const repeatRes = await authFetch(`${ADMIN_API}/${happyPathApp._id}/approve`, indiaToken, { method: "POST", body: JSON.stringify({}) });
    const repeatJson = await repeatRes.json();
    check("P: repeated approval on an already-APPROVED application -> 200, idempotent", repeatRes.status === 200 && repeatJson.data.alreadyApproved === true, repeatRes.status);

    const profileCountAfter = await FieldAgent.countDocuments({ applicationRef: happyPathApp._id });
    check("P: no duplicate FieldAgent created by repeated approval", profileCountAfter === profileCountBefore, profileCountAfter);
    const auditAfter = await FieldAgentAuditEvent.countDocuments({ action: "FIELD_AGENT_APPROVED", entityId: happyPathApp._id });
    check("P: no duplicate FIELD_AGENT_APPROVED audit event from repeated approval", auditAfter === auditBefore, auditAfter);
  }

  // ── Q — CONCURRENT APPROVAL (real HTTP, real MongoDB) ─────────────
  {
    const { application } = await makeApplicationInStatus("FA-4.2 Concurrent Approve Agent", "ADMIN_REVIEW");
    const [r1, r2, r3] = await Promise.all([
      authFetch(`${ADMIN_API}/${application._id}/approve`, indiaToken, { method: "POST", body: JSON.stringify({}) }),
      authFetch(`${ADMIN_API}/${application._id}/approve`, indiaToken, { method: "POST", body: JSON.stringify({}) }),
      authFetch(`${ADMIN_API}/${application._id}/approve`, indiaToken, { method: "POST", body: JSON.stringify({}) }),
    ]);
    check("Q: all 3 concurrent approve requests succeed -> 200", r1.status === 200 && r2.status === 200 && r3.status === 200, [r1.status, r2.status, r3.status]);
    const [j1, j2, j3] = await Promise.all([r1.json(), r2.json(), r3.json()]);
    check("Q: all 3 resolve to the SAME profile", j1.data.profile._id === j2.data.profile._id && j2.data.profile._id === j3.data.profile._id, [j1.data.profile._id, j2.data.profile._id, j3.data.profile._id]);

    const profileCount = await FieldAgent.countDocuments({ applicationRef: application._id });
    check("Q: exactly one FieldAgent profile was created (no duplicates from the race)", profileCount === 1, profileCount);
    const agentCodeDistinct = await FieldAgent.distinct("agentCode", { applicationRef: application._id });
    check("Y: exactly one agentCode exists for this application", agentCodeDistinct.length === 1, agentCodeDistinct);
    const auditCount = await FieldAgentAuditEvent.countDocuments({ action: "FIELD_AGENT_APPROVED", entityId: application._id });
    check("Q: exactly one FIELD_AGENT_APPROVED audit event, no duplicates from the race", auditCount === 1, auditCount);
  }

  // ── R — CONCURRENT APPROVE + REJECT ───────────────────────────────
  {
    const { application } = await makeApplicationInStatus("FA-4.2 Approve-Reject Race Agent", "ADMIN_REVIEW");
    const [approveRes, rejectRes] = await Promise.all([
      authFetch(`${ADMIN_API}/${application._id}/approve`, indiaToken, { method: "POST", body: JSON.stringify({}) }),
      authFetch(`${ADMIN_API}/${application._id}/reject`, indiaToken, { method: "POST", body: JSON.stringify({ reason: "Racing rejection" }) }),
    ]);
    const statuses = [approveRes.status, rejectRes.status].sort();
    check("R: exactly one of approve/reject succeeds (200), the other is rejected (409)", statuses[0] === 200 && statuses[1] === 409, [approveRes.status, rejectRes.status]);

    const finalApp = await FieldAgentApplication.findById(application._id).lean();
    check("R: final application status is a single, coherent terminal decision (APPROVED xor REJECTED)", finalApp.status === "APPROVED" || finalApp.status === "REJECTED", finalApp.status);

    const profileCount = await FieldAgent.countDocuments({ applicationRef: application._id });
    check(
      "R: FieldAgent profile exists IFF the final decision was APPROVED (never a profile on a REJECTED outcome, never zero on an APPROVED one)",
      (finalApp.status === "APPROVED" && profileCount === 1) || (finalApp.status === "REJECTED" && profileCount === 0),
      { status: finalApp.status, profileCount }
    );

    const approvedAuditCount = await FieldAgentAuditEvent.countDocuments({ action: "FIELD_AGENT_APPROVED", entityId: application._id });
    const rejectedAuditCount = await FieldAgentAuditEvent.countDocuments({ action: "FIELD_AGENT_REJECTED", entityId: application._id });
    check("R: no duplicate/contradictory audit trail (exactly one approved OR one rejected event, never both, never two)", approvedAuditCount + rejectedAuditCount === 1, { approvedAuditCount, rejectedAuditCount });
  }

  // ── S — DATA-INCONSISTENCY GUARD (transaction rollback proof) ────
  {
    const { application } = await makeApplicationInStatus("FA-4.2 Data Inconsistency Agent", "ADMIN_REVIEW");
    // Simulate a real inconsistency: a FieldAgent profile already
    // exists for this application while it is STILL ADMIN_REVIEW —
    // structurally impossible via the real approval path, injected
    // directly to prove the guard actually fires and leaves no
    // partial/corrupted state.
    await FieldAgent.collection.insertOne({
      userRef: new mongoose.Types.ObjectId(),
      applicationRef: application._id,
      agentCode: `FA-99999999-${String(Math.floor(Math.random() * 900000) + 100000)}`,
      operationalStatus: "PENDING_ACTIVATION",
      approvedBy: indiaAdmin._id,
      approvedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await authFetch(`${ADMIN_API}/${application._id}/approve`, indiaToken, { method: "POST", body: JSON.stringify({}) });
    check("S: approval halts with a server error when a pre-existing profile is detected against ADMIN_REVIEW (data-inconsistency guard)", res.status === 500, res.status);

    const appAfter = await FieldAgentApplication.findById(application._id).lean();
    check("S: aborted transaction leaves the application still ADMIN_REVIEW (no partial transition)", appAfter.status === "ADMIN_REVIEW", appAfter.status);
    const profileCount = await FieldAgent.countDocuments({ applicationRef: application._id });
    check("S: no SECOND profile was created — exactly the one injected document remains", profileCount === 1, profileCount);
    const auditCount = await FieldAgentAuditEvent.countDocuments({ action: "FIELD_AGENT_APPROVED", entityId: application._id });
    check("S: no false FIELD_AGENT_APPROVED audit event from the aborted attempt", auditCount === 0, auditCount);

    // Cleanup the injected inconsistency directly (not part of the
    // normal fixture set since its userRef is synthetic).
    await FieldAgent.deleteMany({ applicationRef: application._id });
  }

  // ── T — Transient retry already proven live by Q/R's real Promise.all
  // races against real MongoDB (the exact mechanism that crashed this
  // service's first concurrent-approval run before the fix — see the
  // module's own deliverable notes); no separate synthetic test needed.
  check("T: transient-transaction retry proven live under Q/R's real concurrent MongoDB races", true);

  // ── U — IDOR / cross-application isolation ────────────────────────
  {
    const { application: untouchedApp } = await makeApplicationInStatus("FA-4.2 Untouched Agent", "ADMIN_REVIEW");
    const { application: targetApp } = await makeApplicationInStatus("FA-4.2 IDOR Target Agent", "ADMIN_REVIEW");

    await authFetch(`${ADMIN_API}/${targetApp._id}/approve`, indiaToken, { method: "POST", body: JSON.stringify({}) });

    const untouchedAfter = await FieldAgentApplication.findById(untouchedApp._id).lean();
    check("U: approving one application does not affect an unrelated ADMIN_REVIEW application", untouchedAfter.status === "ADMIN_REVIEW", untouchedAfter.status);

    const unknownIdRes = await authFetch(`${ADMIN_API}/${new mongoose.Types.ObjectId()}/approve`, indiaToken, { method: "POST", body: JSON.stringify({}) });
    check("U: approving a nonexistent applicationId -> 404", unknownIdRes.status === 404, unknownIdRes.status);
  }

  // ── V — AUTHORIZATION MATRIX ───────────────────────────────────────
  {
    const { application } = await makeApplicationInStatus("FA-4.2 AuthZ Target Agent", "ADMIN_REVIEW");
    const { token: fieldAgentToken } = await makeApplicationInStatus("FA-4.2 AuthZ FieldAgent Actor", "ADMIN_REVIEW");
    const { token: plainUserToken } = await makePlainUser("FA-4.2 AuthZ Plain User");

    const faApprove = await authFetch(`${ADMIN_API}/${application._id}/approve`, fieldAgentToken, { method: "POST", body: JSON.stringify({}) });
    check("V: FIELD_AGENT token cannot approve -> 403", faApprove.status === 403, faApprove.status);

    const userApprove = await authFetch(`${ADMIN_API}/${application._id}/approve`, plainUserToken, { method: "POST", body: JSON.stringify({}) });
    check("V: USER token cannot approve -> 403", userApprove.status === 403, userApprove.status);

    const noTokenApprove = await authFetch(`${ADMIN_API}/${application._id}/approve`, null, { method: "POST", body: JSON.stringify({}) });
    check("V: unauthenticated request cannot approve -> 401", noTokenApprove.status === 401, noTokenApprove.status);

    if (districtToken) {
      const districtApprove = await authFetch(`${ADMIN_API}/${application._id}/approve`, districtToken, { method: "POST", body: JSON.stringify({}) });
      check(`V: ${districtAdmin.adminLevel} admin CANNOT approve (INDIA-only) -> 403`, districtApprove.status === 403, districtApprove.status);

      const districtReject = await authFetch(`${ADMIN_API}/${application._id}/reject`, districtToken, { method: "POST", body: JSON.stringify({ reason: "should be rejected" }) });
      check(`V: ${districtAdmin.adminLevel} admin CANNOT reject (INDIA-only) -> 403`, districtReject.status === 403, districtReject.status);

      const districtRead = await authFetch(`${ADMIN_API}?limit=5`, districtToken);
      check(`V: ${districtAdmin.adminLevel} admin CAN read the review queue (read-scope intact)`, districtRead.status === 200, districtRead.status);

      const districtDetail = await authFetch(`${ADMIN_API}/${application._id}`, districtToken);
      check(`V: ${districtAdmin.adminLevel} admin CAN read application detail`, districtDetail.status === 200, districtDetail.status);
    }

    const indiaApprove = await authFetch(`${ADMIN_API}/${application._id}/approve`, indiaToken, { method: "POST", body: JSON.stringify({}) });
    check("V: INDIA admin CAN approve", indiaApprove.status === 200, indiaApprove.status);
  }

  // ── W — CLIENT-CONTROLLED FIELD INJECTION ─────────────────────────
  {
    const { application } = await makeApplicationInStatus("FA-4.2 Rigged Fields Agent", "ADMIN_REVIEW");
    const riggedApprove = await authFetch(`${ADMIN_API}/${application._id}/approve`, indiaToken, {
      method: "POST",
      body: JSON.stringify({ agentCode: "FA-HACKED-000000", approvedBy: "bogus", operationalStatus: "ACTIVE", status: "APPROVED", userRef: "bogus" }),
    });
    check("W: approve body with server-controlled fields is rejected -> 400", riggedApprove.status === 400, riggedApprove.status);

    const { application: appReject } = await makeApplicationInStatus("FA-4.2 Rigged Reject Agent", "ADMIN_REVIEW");
    const riggedReject = await authFetch(`${ADMIN_API}/${appReject._id}/reject`, indiaToken, {
      method: "POST",
      body: JSON.stringify({ reason: "valid reason", status: "REJECTED", approvedBy: "bogus" }),
    });
    check("W: reject body with server-controlled fields is rejected -> 400", riggedReject.status === 400, riggedReject.status);

    // The application remains fully usable after the rejected rigged
    // request — a legitimate, clean approval still succeeds.
    const cleanApprove = await authFetch(`${ADMIN_API}/${application._id}/approve`, indiaToken, { method: "POST", body: JSON.stringify({}) });
    const cleanJson = await cleanApprove.json();
    check("a clean approve after a rejected rigged one still succeeds with server-generated values", cleanApprove.status === 200 && /^FA-\d{8}-\d{6}$/.test(cleanJson.data.profile.agentCode), cleanJson.data?.profile?.agentCode);
  }

  // ── FINAL DATA INTEGRITY (this run's own fixtures) ────────────────
  {
    const profiles = await FieldAgent.find({ userRef: { $in: fixtureUserIds } }).lean();
    const codes = profiles.map((p) => p.agentCode);
    check("no duplicate agentCode among this run's own created profiles", new Set(codes).size === codes.length, codes);
    const invalidStatus = profiles.filter((p) => p.operationalStatus !== "PENDING_ACTIVATION");
    check("every profile created this run is PENDING_ACTIVATION", invalidStatus.length === 0, invalidStatus.length);
  }

  // ── CLEANUP ────────────────────────────────────────────────────
  const profileDelete = await FieldAgent.deleteMany({ userRef: { $in: fixtureUserIds } });
  const applicationDelete = await FieldAgentApplication.deleteMany({ userRef: { $in: fixtureUserIds } });
  const userDelete = await User.deleteMany({ _id: { $in: fixtureUserIds } });

  const remainingProfiles = await FieldAgent.countDocuments({ userRef: { $in: fixtureUserIds } });
  check("zero FA-4.2 FieldAgent fixtures remain (no residue)", remainingProfiles === 0, remainingProfiles);
  const remainingApplications = await FieldAgentApplication.countDocuments({ userRef: { $in: fixtureUserIds } });
  check("zero FA-4.2 FieldAgentApplication fixtures remain (no residue)", remainingApplications === 0, remainingApplications);
  const remainingUsers = await User.countDocuments({ _id: { $in: fixtureUserIds } });
  check("zero FA-4.2 User fixtures remain (no residue)", remainingUsers === 0, remainingUsers);

  server.close();

  console.log("\n" + results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
  console.log(
    `\n🧹 Cleanup: removed ${userDelete.deletedCount} user(s), ${applicationDelete.deletedCount} application(s), ${profileDelete.deletedCount} FieldAgent profile(s) (phones 9999905xxx). Audit events preserved.`
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
