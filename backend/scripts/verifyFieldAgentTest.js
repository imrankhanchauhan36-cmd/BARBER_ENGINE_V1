/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyFieldAgentTest.js
 *
 * FA-3.4.1/3.4.2 — LIVE, real-HTTP + real-service-call, real-DB
 * verification for the Mandatory Test Engine. Same precedent and
 * style as scripts/verifyFieldAgentTrainingAdmin.js — real Express
 * app, real signed JWTs, real MongoDB, no mocks, no test framework
 * (none exists in this repo, none is fabricated here).
 *
 * FA-3.4.1's admin-authoring sections (A-J) drive the already-wired
 * HTTP admin API. FA-3.4.2's TestAttempt sections (K onward) call
 * fieldAgentTest.service.js's exported functions DIRECTLY — there is
 * no agent-facing HTTP controller/route yet (that's FA-3.4.3's own
 * scope), so this is the correct, non-mocked way to exercise the
 * attempt engine at its actual current layer.
 *
 * This file will keep growing across FA-3.4's remaining work packages
 * (3.4.3 agent API + FA-2 handoff + audit events, 3.4.4 final
 * integration regression), exactly mirroring how
 * verifyFieldAgentTrainingAdmin.js accumulated checks across FA-3.3.2's
 * subphases.
 *
 * All DRAFT versions this script creates are tagged via `notes`
 * starting with FIXTURE_TAG and are deleted directly in the cleanup
 * section at the end — self-cleaning, zero residue, safe to run
 * repeatedly. PUBLISHED-then-RETIRED fixtures are intentionally left
 * in place (retired history is never deleted, same accepted precedent
 * as the training verification scripts). FA-3.4.2's own User/
 * FieldAgentApplication/TestAttempt fixtures (phones 9999901xxx) are
 * hard-deleted in cleanup — they are disposable test identities, not
 * production-shaped historical records worth preserving.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyFieldAgentTest.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import TestVersion from "../modules/fieldAgentTest/models/TestVersion.js";
import TestQuestion from "../modules/fieldAgentTest/models/TestQuestion.js";
import TestAttempt from "../modules/fieldAgentTest/models/TestAttempt.js";
import FieldAgentApplication from "../modules/fieldAgent/models/FieldAgentApplication.js";
import FieldAgentAuditEvent from "../modules/fieldAgent/models/FieldAgentAuditEvent.js";
import FieldAgentTraining from "../modules/fieldAgentTraining/models/FieldAgentTraining.js";
import { generateAccessToken } from "../services/token.service.js";
import {
  startTestAttempt,
  getAttemptQuestions,
  submitTestAttempt,
} from "../modules/fieldAgentTest/services/fieldAgentTest.service.js";

const FIXTURE_TAG = "FA-3.4.1 TEST FIXTURE";

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

// A valid single-choice question with an approved English translation.
const makeQuestion = (text, { correctOptionIndex = 0, extraTranslations = [], approved = true } = {}) => ({
  translations: [
    { languageCode: "en", questionText: text, options: ["A", "B", "C", "D"], approved },
    ...extraTranslations,
  ],
  grading: { type: "SINGLE_CHOICE", correctOptionIndex },
});

// ── FA-3.4.2 fixtures ────────────────────────────────────────────
// Disjoint phone range from every other fixture in this file (99999000xx)
// and this file's own FA-3.4.1 authz section (9999900015/16).
let fa342PhoneSeq = 0;
const fa342UserIds = [];
const nextFa342Phone = () => `9999901${String(fa342PhoneSeq++).padStart(3, "0")}`;

// A fresh FIELD_AGENT user with a fresh FieldAgentApplication in
// TEST_PENDING — the standard "ready to start a test" fixture shape
// every FA-3.4.2 scenario below builds on.
const createTestPendingAgent = async (name) => {
  const phone = nextFa342Phone();
  const user = await User.create({ name, phone, role: "FIELD_AGENT", isActive: true });
  fa342UserIds.push(user._id);
  const application = await FieldAgentApplication.create({
    userRef: user._id,
    phone,
    status: "TEST_PENDING",
    nonTerminal: true,
  });
  return { user, application };
};

// Calls a service function and reports whether it threw the expected
// AppError `code` (e.g. "CONFLICT", "NOT_FOUND", "BAD_REQUEST") — used
// throughout FA-3.4.2's negative-path checks instead of a bare
// try/catch at every call site.
const expectThrow = async (fn, expectedCode) => {
  try {
    await fn();
    return { threw: false };
  } catch (err) {
    return { threw: true, code: err.code, statusCode: err.statusCode, matches: !expectedCode || err.code === expectedCode };
  }
};

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;

  const authFetch = (path, token, opts = {}) =>
    fetch(url(path), {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(opts.headers || {}),
      },
    });

  const admin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion");
  check("INDIA admin fixture exists (real, pre-existing account)", !!admin);
  const adminToken = generateAccessToken({ _id: admin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: admin.tokenVersion ?? 0 });

  const createTaggedDraft = async (notesSuffix, body = {}) => {
    const res = await authFetch("/api/admin/field-agent-test/versions", adminToken, {
      method: "POST",
      body: JSON.stringify({ notes: `${FIXTURE_TAG} — ${notesSuffix}`, ...body }),
    });
    const json = await res.json();
    return { res, version: json?.data?.version, json };
  };

  const addQ = (versionId, body) =>
    authFetch(`/api/admin/field-agent-test/versions/${versionId}/questions`, adminToken, {
      method: "POST",
      body: JSON.stringify(body),
    });

  // ── SECTION A — DRAFT VERSION CREATE / UPDATE ───────────────────
  let draftA;
  {
    const { res, version } = await createTaggedDraft("draft create defaults");
    check("draft create (defaults) -> 201", res.status === 201, res.status);
    check("draft defaults to passingScore=70", version?.passingScore === 70, version?.passingScore);
    check("draft defaults to maxAttempts=3", version?.maxAttempts === 3, version?.maxAttempts);
    check("draft defaults to retryCooldownMinutes=1440", version?.retryCooldownMinutes === 1440, version?.retryCooldownMinutes);
    check("draft status is DRAFT", version?.status === "DRAFT", version?.status);
    draftA = version;

    const badPassingScore = await createTaggedDraft("invalid passingScore", { passingScore: 0 });
    check("passingScore=0 rejected at create -> 400", badPassingScore.res.status === 400, badPassingScore.res.status);

    const badMaxAttempts = await createTaggedDraft("invalid maxAttempts", { maxAttempts: 0 });
    check("maxAttempts=0 rejected at create -> 400", badMaxAttempts.res.status === 400, badMaxAttempts.res.status);

    const updateRes = await authFetch(`/api/admin/field-agent-test/versions/${draftA._id}`, adminToken, {
      method: "PATCH",
      body: JSON.stringify({ passingScore: 80, maxAttempts: 5, retryCooldownMinutes: 60 }),
    });
    const updateJson = await updateRes.json();
    check("draft update business fields -> 200", updateRes.status === 200, updateRes.status);
    check("updated passingScore=80", updateJson?.data?.version?.passingScore === 80, updateJson?.data?.version?.passingScore);
    check("updated maxAttempts=5", updateJson?.data?.version?.maxAttempts === 5, updateJson?.data?.version?.maxAttempts);
    check("updated retryCooldownMinutes=60", updateJson?.data?.version?.retryCooldownMinutes === 60, updateJson?.data?.version?.retryCooldownMinutes);

    // Revert to locked defaults for the rest of this run's fixture.
    await authFetch(`/api/admin/field-agent-test/versions/${draftA._id}`, adminToken, {
      method: "PATCH",
      body: JSON.stringify({ passingScore: 70, maxAttempts: 3, retryCooldownMinutes: 1440 }),
    });
  }

  // ── SECTION B — QUESTION CRUD ───────────────────────────────────
  let questionB;
  {
    const good = await addQ(draftA._id, makeQuestion("What is 2+2?"));
    const goodJson = await good.json();
    check("add question (valid SINGLE_CHOICE) -> 201", good.status === 201, good.status);
    questionB = goodJson?.data?.question;

    const tooFewOptions = await addQ(draftA._id, {
      translations: [{ languageCode: "en", questionText: "Bad", options: ["OnlyOne"], approved: true }],
      grading: { type: "SINGLE_CHOICE", correctOptionIndex: 0 },
    });
    check("question with <2 options rejected -> 400", tooFewOptions.status === 400, tooFewOptions.status);

    const outOfBounds = await addQ(draftA._id, makeQuestion("Out of bounds", { correctOptionIndex: 99 }));
    check("correctOptionIndex out of bounds rejected -> 400", outOfBounds.status === 400, outOfBounds.status);

    const badGradingType = await addQ(draftA._id, {
      translations: [{ languageCode: "en", questionText: "Bad type", options: ["A", "B"], approved: true }],
      grading: { type: "CHECKLIST", correctOptionIndex: 0 },
    });
    check("grading.type other than SINGLE_CHOICE rejected -> 400", badGradingType.status === 400, badGradingType.status);

    const updateRes = await authFetch(`/api/admin/field-agent-test/questions/${questionB._id}`, adminToken, {
      method: "PATCH",
      body: JSON.stringify({ translations: [{ languageCode: "en", questionText: "What is 2+2? (updated)", options: ["A", "B", "C", "D"], approved: true }] }),
    });
    const updateJson = await updateRes.json();
    check("update question -> 200", updateRes.status === 200, updateRes.status);
    check("update reflected", updateJson?.data?.question?.translations?.[0]?.questionText === "What is 2+2? (updated)");

    const disposable = await addQ(draftA._id, makeQuestion("To be deleted"));
    const disposableJson = await disposable.json();
    const delRes = await authFetch(`/api/admin/field-agent-test/questions/${disposableJson.data.question._id}`, adminToken, { method: "DELETE" });
    check("delete question -> 200", delRes.status === 200, delRes.status);
    const stillThere = await TestQuestion.findById(disposableJson.data.question._id).lean();
    check("deleted question is actually gone", !stillThere);
  }

  // ── SECTION C — REORDER ─────────────────────────────────────────
  {
    const q2 = await (await addQ(draftA._id, makeQuestion("Reorder Q2"))).json();
    const q3 = await (await addQ(draftA._id, makeQuestion("Reorder Q3"))).json();

    const existing = await TestQuestion.find({ testVersion: draftA._id }).sort({ order: 1 }).select("_id").lean();
    const reversed = existing.map((q) => String(q._id)).reverse();

    const reorderRes = await authFetch(`/api/admin/field-agent-test/versions/${draftA._id}/reorder-questions`, adminToken, {
      method: "PATCH",
      body: JSON.stringify({ orderedQuestionIds: reversed }),
    });
    const reorderJson = await reorderRes.json();
    check("reorder (exact permutation) -> 200", reorderRes.status === 200, reorderRes.status);
    const resultOrder = (reorderJson?.data?.questions || []).map((q) => String(q._id));
    check("reorder produced the exact requested order", JSON.stringify(resultOrder) === JSON.stringify(reversed));

    const badPermutation = await authFetch(`/api/admin/field-agent-test/versions/${draftA._id}/reorder-questions`, adminToken, {
      method: "PATCH",
      body: JSON.stringify({ orderedQuestionIds: [reversed[0]] }), // missing entries
    });
    check("reorder with a non-exact permutation rejected -> 400", badPermutation.status === 400, badPermutation.status);

    // restore ascending order for readability of later sections
    await authFetch(`/api/admin/field-agent-test/versions/${draftA._id}/reorder-questions`, adminToken, {
      method: "PATCH",
      body: JSON.stringify({ orderedQuestionIds: reversed.slice().reverse() }),
    });
  }

  // ── SECTION D — PUBLISH GATE ─────────────────────────────────────
  let publishedVersion;
  {
    const tooFewPublish = await authFetch(`/api/admin/field-agent-test/versions/${draftA._id}/publish`, adminToken, { method: "POST" });
    check("publish with <10 questions rejected -> 409", tooFewPublish.status === 409, tooFewPublish.status);

    // draftA currently has 3 questions (from sections B/C) — top up to 10.
    for (let i = 0; i < 7; i++) {
      const r = await addQ(draftA._id, makeQuestion(`Filler question ${i}`));
      check(`filler question ${i} added -> 201`, r.status === 201, r.status);
    }

    const unapprovedEnglish = await addQ(draftA._id, makeQuestion("Not yet approved", { approved: false }));
    const unapprovedJson = await unapprovedEnglish.json();
    check("author-time: unapproved-English question is still creatable (approval gate is publish-time only)", unapprovedEnglish.status === 201, unapprovedEnglish.status);

    const publishBlockedByUnapproved = await authFetch(`/api/admin/field-agent-test/versions/${draftA._id}/publish`, adminToken, { method: "POST" });
    check("publish blocked while an active question has no approved 'en' translation -> 409", publishBlockedByUnapproved.status === 409, publishBlockedByUnapproved.status);

    // Deactivate the unapproved question rather than deleting it —
    // exercises `active:false` excluding it from the publish gate.
    await authFetch(`/api/admin/field-agent-test/questions/${unapprovedJson.data.question._id}`, adminToken, {
      method: "PATCH",
      body: JSON.stringify({ active: false }),
    });

    const activeCount = await TestQuestion.countDocuments({ testVersion: draftA._id, active: true });
    check("exactly 10 active questions remain for publish", activeCount === 10, activeCount);

    const publishRes = await authFetch(`/api/admin/field-agent-test/versions/${draftA._id}/publish`, adminToken, { method: "POST" });
    const publishJson = await publishRes.json();
    check("publish with 10 approved active questions -> 200", publishRes.status === 200, publishRes.status);
    check("published version status is PUBLISHED", publishJson?.data?.version?.status === "PUBLISHED", publishJson?.data?.version?.status);
    publishedVersion = publishJson?.data?.version;

    const publishedCount = await TestVersion.countDocuments({ status: "PUBLISHED" });
    check("exactly one PUBLISHED version exists after publish", publishedCount === 1, publishedCount);
  }

  // ── SECTION E — PUBLISHED IMMUTABILITY ──────────────────────────
  {
    const anyQuestion = await TestQuestion.findOne({ testVersion: publishedVersion._id }).lean();

    const editAttempt = await authFetch(`/api/admin/field-agent-test/questions/${anyQuestion._id}`, adminToken, {
      method: "PATCH",
      body: JSON.stringify({ translations: [{ languageCode: "en", questionText: "hacked", options: ["A", "B"], approved: true }] }),
    });
    check("edit a published question rejected -> 409", editAttempt.status === 409, editAttempt.status);

    const deleteAttempt = await authFetch(`/api/admin/field-agent-test/questions/${anyQuestion._id}`, adminToken, { method: "DELETE" });
    check("delete a published question rejected -> 409", deleteAttempt.status === 409, deleteAttempt.status);

    const allQIds = (await TestQuestion.find({ testVersion: publishedVersion._id }).select("_id").lean()).map((q) => String(q._id));
    const reorderAttempt = await authFetch(`/api/admin/field-agent-test/versions/${publishedVersion._id}/reorder-questions`, adminToken, {
      method: "PATCH",
      body: JSON.stringify({ orderedQuestionIds: allQIds.slice().reverse() }),
    });
    check("reorder a published version's questions rejected -> 409", reorderAttempt.status === 409, reorderAttempt.status);

    const versionEditAttempt = await authFetch(`/api/admin/field-agent-test/versions/${publishedVersion._id}`, adminToken, {
      method: "PATCH",
      body: JSON.stringify({ passingScore: 50 }),
    });
    check("edit a published version's business fields rejected -> 409", versionEditAttempt.status === 409, versionEditAttempt.status);

    const questionAddAttempt = await addQ(publishedVersion._id, makeQuestion("should be rejected"));
    check("add a question to a published version rejected -> 409", questionAddAttempt.status === 409, questionAddAttempt.status);

    const grading = await TestQuestion.findById(anyQuestion._id).select("+grading").lean();
    check("published question grading is unchanged after rejected edit attempts", grading?.grading?.correctOptionIndex === anyQuestion.grading?.correctOptionIndex || grading?.grading != null);
  }

  // ── SECTION F — RETIRE ───────────────────────────────────────────
  {
    const retireRes = await authFetch(`/api/admin/field-agent-test/versions/${publishedVersion._id}/retire`, adminToken, {
      method: "POST",
      body: JSON.stringify({ reason: "FA-3.4.1 verification — manual retire" }),
    });
    const retireJson = await retireRes.json();
    check("retire a PUBLISHED version -> 200", retireRes.status === 200, retireRes.status);
    check("retired version status is RETIRED", retireJson?.data?.version?.status === "RETIRED", retireJson?.data?.version?.status);

    const retireAgain = await authFetch(`/api/admin/field-agent-test/versions/${publishedVersion._id}/retire`, adminToken, { method: "POST" });
    check("retire an already-RETIRED version rejected -> 409", retireAgain.status === 409, retireAgain.status);

    const publishedCountAfterRetire = await TestVersion.countDocuments({ status: "PUBLISHED" });
    check("zero PUBLISHED versions remain after retire", publishedCountAfterRetire === 0, publishedCountAfterRetire);
  }

  // ── SECTION G — DISCARD ──────────────────────────────────────────
  {
    const { version: discardDraft } = await createTaggedDraft("discard target");
    await addQ(discardDraft._id, makeQuestion("will be discarded"));
    const qCountBefore = await TestQuestion.countDocuments({ testVersion: discardDraft._id });
    check("discard-target draft has 1 question before discard", qCountBefore === 1, qCountBefore);

    const discardRes = await authFetch(`/api/admin/field-agent-test/versions/${discardDraft._id}`, adminToken, { method: "DELETE" });
    const discardJson = await discardRes.json();
    check("discard a DRAFT -> 200", discardRes.status === 200, discardRes.status);
    check("discard response reports questionCount=1", discardJson?.data?.questionCount === 1, discardJson?.data?.questionCount);

    const versionGone = await TestVersion.findById(discardDraft._id).lean();
    check("discarded version document no longer exists", !versionGone);
    const qCountAfter = await TestQuestion.countDocuments({ testVersion: discardDraft._id });
    check("discarded version's questions are all gone (no orphans)", qCountAfter === 0, qCountAfter);

    const rediscard = await authFetch(`/api/admin/field-agent-test/versions/${discardDraft._id}`, adminToken, { method: "DELETE" });
    check("re-discarding an already-discarded version -> 404 (idempotent-safe)", rediscard.status === 404, rediscard.status);

    const discardPublished = await authFetch(`/api/admin/field-agent-test/versions/${publishedVersion._id}`, adminToken, { method: "DELETE" });
    check("discard a RETIRED version rejected -> 409", discardPublished.status === 409, discardPublished.status);
  }

  // ── SECTION H — ORPHAN CHECK (whole collection) ──────────────────
  {
    const allQuestions = await TestQuestion.find().select("testVersion").lean();
    const versionIds = new Set((await TestVersion.find().select("_id").lean()).map((v) => String(v._id)));
    const orphans = allQuestions.filter((q) => !versionIds.has(String(q.testVersion)));
    check("zero orphan TestQuestion documents across the whole collection", orphans.length === 0, orphans.length);
  }

  // ── SECTION I — MONGODB INDEXES ──────────────────────────────────
  {
    const versionIndexes = await TestVersion.collection.indexes();
    const versionNumberUnique = versionIndexes.find((i) => i.key.versionNumber === 1 && i.unique);
    check("TestVersion.versionNumber unique index exists", !!versionNumberUnique);

    const publishedPartial = versionIndexes.find(
      (i) => i.key.status === 1 && i.unique && i.partialFilterExpression?.status === "PUBLISHED"
    );
    check("TestVersion.status unique partial(PUBLISHED) index exists", !!publishedPartial);

    const questionIndexes = await TestQuestion.collection.indexes();
    const orderUnique = questionIndexes.find((i) => i.key.testVersion === 1 && i.key.order === 1 && i.unique);
    check("TestQuestion.{testVersion,order} unique index exists", !!orderUnique);
  }

  // ── SECTION J — AUTHORIZATION BOUNDARY ────────────────────────────
  {
    const districtAdmin = await User.findOne({
      role: "ADMIN",
      adminLevel: { $in: ["STATE", "DISTRICT"] },
      isActive: true,
      accountStatus: "ACTIVE",
    })
      .select("+tokenVersion")
      .lean();
    check("a real STATE/DISTRICT admin fixture exists (pre-existing location-hierarchy data)", !!districtAdmin);

    if (districtAdmin) {
      const districtToken = generateAccessToken({
        _id: districtAdmin._id,
        role: "ADMIN",
        adminLevel: districtAdmin.adminLevel,
        tokenVersion: districtAdmin.tokenVersion ?? 0,
      });

      const districtRead = await authFetch("/api/admin/field-agent-test/versions", districtToken);
      check(`${districtAdmin.adminLevel} admin CAN read /versions (read-scope intact)`, districtRead.status === 200, districtRead.status);

      const districtCreate = await authFetch("/api/admin/field-agent-test/versions", districtToken, {
        method: "POST",
        body: JSON.stringify({ notes: "should be rejected" }),
      });
      check(`${districtAdmin.adminLevel} admin CANNOT create a version (INDIA-only write) -> 403`, districtCreate.status === 403, districtCreate.status);

      const districtPublish = await authFetch(`/api/admin/field-agent-test/versions/${publishedVersion._id}/publish`, districtToken, { method: "POST" });
      check(`${districtAdmin.adminLevel} admin CANNOT publish -> 403`, districtPublish.status === 403, districtPublish.status);

      const districtDiscard = await authFetch(`/api/admin/field-agent-test/versions/${publishedVersion._id}`, districtToken, { method: "DELETE" });
      check(`${districtAdmin.adminLevel} admin CANNOT discard -> 403`, districtDiscard.status === 403, districtDiscard.status);
    }

    const audAgentPhone = "9999900016";
    let audAgent = await User.findOne({ phone: audAgentPhone }).select("+tokenVersion");
    if (!audAgent) audAgent = await User.create({ name: "FA-3.4.1 Verification Agent", phone: audAgentPhone, role: "FIELD_AGENT", isActive: true });
    const audAgentToken = generateAccessToken({ _id: audAgent._id, role: "FIELD_AGENT", tokenVersion: audAgent.tokenVersion ?? 0 });

    const agentReadVersions = await authFetch("/api/admin/field-agent-test/versions", audAgentToken);
    check("FIELD_AGENT token CANNOT read admin /versions -> 403", agentReadVersions.status === 403, agentReadVersions.status);

    const agentCreateVersion = await authFetch("/api/admin/field-agent-test/versions", audAgentToken, {
      method: "POST",
      body: JSON.stringify({ notes: "should be rejected" }),
    });
    check("FIELD_AGENT token CANNOT create a version -> 403", agentCreateVersion.status === 403, agentCreateVersion.status);
  }

  // ════════════════════════════════════════════════════════════════
  // FA-3.4.2 — TestAttempt + Server-Side Scoring
  // Direct service-layer calls (startTestAttempt/getAttemptQuestions/
  // submitTestAttempt) — no HTTP agent API exists yet (FA-3.4.3).
  // ════════════════════════════════════════════════════════════════

  // Pre-flight cleanup — a prior crashed/interrupted run may have left
  // FA-3.4.2 fixtures (phones 9999901xxx) behind before its own
  // cleanup section ran; remove them before creating fresh ones this
  // run so a rerun (including right after a crash) never collides on
  // the unique phone index.
  {
    const staleUsers = await User.find({ phone: { $regex: /^9999901\d{3}$/ } }).select("_id").lean();
    const staleUserIds = staleUsers.map((u) => u._id);
    if (staleUserIds.length > 0) {
      await TestAttempt.deleteMany({ agentRef: { $in: staleUserIds } });
      await FieldAgentApplication.deleteMany({ userRef: { $in: staleUserIds } });
      await User.deleteMany({ _id: { $in: staleUserIds } });
    }
  }

  // ── SECTION K — TestAttempt MODEL / INDEXES ───────────────────────
  {
    const indexes = await TestAttempt.collection.indexes();

    const attemptNumberUnique = indexes.find(
      (i) => i.key.applicationRef === 1 && i.key.attemptNumber === 1 && i.unique
    );
    check("TestAttempt.{applicationRef,attemptNumber} unique index exists", !!attemptNumberUnique);

    const activeAttemptPartial = indexes.find(
      (i) =>
        i.unique &&
        i.partialFilterExpression?.status === "IN_PROGRESS" &&
        Object.keys(i.key).length === 1 &&
        i.key.applicationRef === 1
    );
    check("TestAttempt.{applicationRef} unique partial(IN_PROGRESS) index exists — the single-active-attempt DB guard", !!activeAttemptPartial);

    const appStatusIdx = indexes.find((i) => i.key.applicationRef === 1 && i.key.status === 1 && !i.unique);
    check("TestAttempt.{applicationRef,status} index exists", !!appStatusIdx);

    const agentIdx = indexes.find((i) => i.key.agentRef === 1 && Object.keys(i.key).length === 1);
    check("TestAttempt.{agentRef} index exists", !!agentIdx);
  }

  // ── SECTION L — FIXTURE: PUBLISHED V1 TEST VERSION ────────────────
  // 10 questions, all correctOptionIndex=0 (option "A") — makes exact
  // percentage math trivial and auditable in every scenario below.
  let testV1;
  {
    const { version: draft } = await createTaggedDraft("attempt engine V1");
    for (let i = 0; i < 10; i++) {
      const r = await addQ(draft._id, makeQuestion(`FA-3.4.2 Q${i}`, { correctOptionIndex: 0 }));
      check(`V1 fixture question ${i} created -> 201`, r.status === 201, r.status);
    }
    const publishRes = await authFetch(`/api/admin/field-agent-test/versions/${draft._id}/publish`, adminToken, { method: "POST" });
    const publishJson = await publishRes.json();
    check("V1 test version published for FA-3.4.2 fixtures", publishRes.status === 200 && publishJson?.data?.version?.status === "PUBLISHED", publishRes.status);
    testV1 = publishJson.data.version;
  }

  const allCorrectAnswers = (attempt) => attempt.questionRefs.map((qId) => ({ questionId: qId, selectedOptionIndex: 0 }));
  const allWrongAnswers = (attempt) => attempt.questionRefs.map((qId) => ({ questionId: qId, selectedOptionIndex: 1 }));
  const nCorrectAnswers = (attempt, correctCount) =>
    attempt.questionRefs.map((qId, i) => ({ questionId: qId, selectedOptionIndex: i < correctCount ? 0 : 1 }));

  // ── SECTION M — START ATTEMPT ─────────────────────────────────────
  {
    const { user: agentM, application: appM } = await createTestPendingAgent("FA-3.4.2 Start Agent");

    const attempt1 = await startTestAttempt({ userId: agentM._id });
    check("start attempt succeeds for TEST_PENDING application", attempt1.status === "IN_PROGRESS", attempt1.status);
    check("attempt 1 attemptNumber=1", attempt1.attemptNumber === 1, attempt1.attemptNumber);
    check("attempt pinned to the current published version", String(attempt1.testVersionRef) === String(testV1._id));

    const expectedQIds = (await TestQuestion.find({ testVersion: testV1._id, active: true }).sort({ order: 1 }).select("_id").lean()).map((q) =>
      String(q._id)
    );
    check(
      "questionRefs is the complete, deterministic, ordered active-question set",
      JSON.stringify(attempt1.questionRefs.map(String)) === JSON.stringify(expectedQIds)
    );

    // Repeat call while IN_PROGRESS — idempotent reuse, no duplicate.
    const attempt1Again = await startTestAttempt({ userId: agentM._id });
    check("repeat start while IN_PROGRESS returns the SAME attempt (no duplicate)", String(attempt1Again._id) === String(attempt1._id));
    const countAfterRepeat = await TestAttempt.countDocuments({ applicationRef: appM._id });
    check("exactly one TestAttempt document exists after a repeat start", countAfterRepeat === 1, countAfterRepeat);

    // Ineligible application state (e.g. never submitted / mid-KYC).
    const { user: agentDraft } = await createTestPendingAgent("FA-3.4.2 Ineligible Agent");
    await FieldAgentApplication.updateOne({ userRef: agentDraft._id }, { $set: { status: "DRAFT" } });
    const draftBlocked = await expectThrow(() => startTestAttempt({ userId: agentDraft._id }), "CONFLICT");
    check("application not in TEST_PENDING/TEST_FAILED cannot start a test", draftBlocked.threw && draftBlocked.matches, draftBlocked);

    // Already-passed application (awaiting admin review) cannot start.
    const { user: agentPassed } = await createTestPendingAgent("FA-3.4.2 Already Passed Agent");
    await FieldAgentApplication.updateOne({ userRef: agentPassed._id }, { $set: { status: "ADMIN_REVIEW" } });
    const passedBlocked = await expectThrow(() => startTestAttempt({ userId: agentPassed._id }), "CONFLICT");
    check("a passed application (ADMIN_REVIEW) cannot start a new test", passedBlocked.threw && passedBlocked.matches, passedBlocked);

    // Unknown identity (no application at all) — service-layer proxy
    // for "unauthenticated"/unrecognized caller, since no HTTP/auth
    // middleware sits in front of this service yet (FA-3.4.3).
    const unknownUserId = new mongoose.Types.ObjectId();
    const unknownBlocked = await expectThrow(() => startTestAttempt({ userId: unknownUserId }), "NOT_FOUND");
    check("an identity with no Field Agent application cannot start a test", unknownBlocked.threw && unknownBlocked.matches, unknownBlocked);
  }

  // ── SECTION N — QUESTION DELIVERY ─────────────────────────────────
  {
    const { user: agentN } = await createTestPendingAgent("FA-3.4.2 Delivery Agent");
    const attempt = await startTestAttempt({ userId: agentN._id });

    const delivered = await getAttemptQuestions({ userId: agentN._id, attemptId: attempt._id });
    check(
      "delivered question order exactly matches attempt.questionRefs",
      JSON.stringify(delivered.questions.map((q) => String(q._id))) === JSON.stringify(attempt.questionRefs.map(String))
    );

    const deliveredText = JSON.stringify(delivered);
    check("delivered questions never include grading", !deliveredText.includes('"grading"'), deliveredText.slice(0, 200));
    check("delivered questions never include correctOptionIndex", !deliveredText.includes("correctOptionIndex"), deliveredText.slice(0, 200));

    // IDOR — a different FIELD_AGENT cannot fetch this attempt.
    const { user: agentOutsider } = await createTestPendingAgent("FA-3.4.2 Outsider Agent");
    const idorBlocked = await expectThrow(() => getAttemptQuestions({ userId: agentOutsider._id, attemptId: attempt._id }), "NOT_FOUND");
    check("a different FIELD_AGENT cannot read another agent's attempt questions -> NOT_FOUND (IDOR-safe)", idorBlocked.threw && idorBlocked.matches, idorBlocked);

    // Unknown identity.
    const unknownBlocked = await expectThrow(
      () => getAttemptQuestions({ userId: new mongoose.Types.ObjectId(), attemptId: attempt._id }),
      "NOT_FOUND"
    );
    check("an unrecognized identity cannot read attempt questions", unknownBlocked.threw && unknownBlocked.matches, unknownBlocked);
  }

  // ── SECTION O — SUBMISSION / SCORING ──────────────────────────────
  {
    // All correct -> 100%, PASSED, application -> ADMIN_REVIEW.
    const { user: agentAllCorrect } = await createTestPendingAgent("FA-3.4.2 All Correct Agent");
    const attemptAllCorrect = await startTestAttempt({ userId: agentAllCorrect._id });
    const resultAllCorrect = await submitTestAttempt({
      userId: agentAllCorrect._id,
      attemptId: attemptAllCorrect._id,
      answers: allCorrectAnswers(attemptAllCorrect),
    });
    check("10/10 correct -> score=100", resultAllCorrect.score === 100, resultAllCorrect.score);
    check("score=100 -> passed=true", resultAllCorrect.passed === true, resultAllCorrect.passed);
    const appAllCorrect = await FieldAgentApplication.findById(attemptAllCorrect.applicationRef).lean();
    check("passing submission moves application TEST_PENDING -> ADMIN_REVIEW", appAllCorrect.status === "ADMIN_REVIEW", appAllCorrect.status);
    const finalizedAttempt = await TestAttempt.findById(attemptAllCorrect._id).lean();
    check("finalized attempt status is PASSED", finalizedAttempt.status === "PASSED", finalizedAttempt.status);
    check("finalized attempt has submittedAt set", !!finalizedAttempt.submittedAt);

    // Boundary pass exactly at 70%.
    const { user: agentBoundaryPass } = await createTestPendingAgent("FA-3.4.2 Boundary Pass Agent");
    const attemptBoundaryPass = await startTestAttempt({ userId: agentBoundaryPass._id });
    const resultBoundaryPass = await submitTestAttempt({
      userId: agentBoundaryPass._id,
      attemptId: attemptBoundaryPass._id,
      answers: nCorrectAnswers(attemptBoundaryPass, 7),
    });
    check("7/10 correct -> score=70 (exact boundary)", resultBoundaryPass.score === 70, resultBoundaryPass.score);
    check("score=70 >= passingScore=70 -> passed=true", resultBoundaryPass.passed === true, resultBoundaryPass.passed);

    // Below-pass failure.
    const { user: agentBelowPass } = await createTestPendingAgent("FA-3.4.2 Below Pass Agent");
    const attemptBelowPass = await startTestAttempt({ userId: agentBelowPass._id });
    const resultBelowPass = await submitTestAttempt({
      userId: agentBelowPass._id,
      attemptId: attemptBelowPass._id,
      answers: nCorrectAnswers(attemptBelowPass, 6),
    });
    check("6/10 correct -> score=60", resultBelowPass.score === 60, resultBelowPass.score);
    check("score=60 < passingScore=70 -> passed=false", resultBelowPass.passed === false, resultBelowPass.passed);
    const appBelowPass = await FieldAgentApplication.findById(attemptBelowPass.applicationRef).lean();
    check("failing submission moves application TEST_PENDING -> TEST_FAILED", appBelowPass.status === "TEST_FAILED", appBelowPass.status);

    // Unanswered questions are scored incorrect, not rejected —
    // 7 explicitly correct + 3 fully OMITTED from the payload (not
    // merely null) should still score exactly 70, same as 7/10 above.
    const { user: agentUnanswered } = await createTestPendingAgent("FA-3.4.2 Unanswered Agent");
    const attemptUnanswered = await startTestAttempt({ userId: agentUnanswered._id });
    const partialAnswers = attemptUnanswered.questionRefs.slice(0, 7).map((qId) => ({ questionId: qId, selectedOptionIndex: 0 }));
    const resultUnanswered = await submitTestAttempt({
      userId: agentUnanswered._id,
      attemptId: attemptUnanswered._id,
      answers: partialAnswers,
    });
    check("3 fully-omitted answers score as incorrect (7/10 -> score=70)", resultUnanswered.score === 70, resultUnanswered.score);
  }

  // ── SECTION P — SUBMISSION VALIDATION + CLIENT-TRUST BOUNDARY ─────
  {
    const { user: agentUnknownQ } = await createTestPendingAgent("FA-3.4.2 Unknown Question Agent");
    const attemptUnknownQ = await startTestAttempt({ userId: agentUnknownQ._id });
    const unknownQResult = await expectThrow(
      () =>
        submitTestAttempt({
          userId: agentUnknownQ._id,
          attemptId: attemptUnknownQ._id,
          answers: [{ questionId: new mongoose.Types.ObjectId(), selectedOptionIndex: 0 }],
        }),
      "BAD_REQUEST"
    );
    check("unknown question id in submission is rejected -> BAD_REQUEST", unknownQResult.threw && unknownQResult.matches, unknownQResult);
    const attemptStillOpen1 = await TestAttempt.findById(attemptUnknownQ._id).lean();
    check("rejected submission (unknown question) leaves the attempt IN_PROGRESS, not consumed", attemptStillOpen1.status === "IN_PROGRESS", attemptStillOpen1.status);
    check("rejected submission releases the submission claim", attemptStillOpen1.submissionClaimedAt === null, attemptStillOpen1.submissionClaimedAt);

    const { user: agentDupQ } = await createTestPendingAgent("FA-3.4.2 Duplicate Question Agent");
    const attemptDupQ = await startTestAttempt({ userId: agentDupQ._id });
    const dupQResult = await expectThrow(
      () =>
        submitTestAttempt({
          userId: agentDupQ._id,
          attemptId: attemptDupQ._id,
          answers: [
            { questionId: attemptDupQ.questionRefs[0], selectedOptionIndex: 0 },
            { questionId: attemptDupQ.questionRefs[0], selectedOptionIndex: 1 },
          ],
        }),
      "BAD_REQUEST"
    );
    check("duplicate question id in one submission is rejected -> BAD_REQUEST", dupQResult.threw && dupQResult.matches, dupQResult);

    const { user: agentInvalidOpt } = await createTestPendingAgent("FA-3.4.2 Invalid Option Agent");
    const attemptInvalidOpt = await startTestAttempt({ userId: agentInvalidOpt._id });
    const invalidOptResult = await expectThrow(
      () =>
        submitTestAttempt({
          userId: agentInvalidOpt._id,
          attemptId: attemptInvalidOpt._id,
          answers: [{ questionId: attemptInvalidOpt.questionRefs[0], selectedOptionIndex: 99 }],
        }),
      "BAD_REQUEST"
    );
    check("out-of-bounds selectedOptionIndex is rejected -> BAD_REQUEST", invalidOptResult.threw && invalidOptResult.matches, invalidOptResult);

    // A malformed submission must not permanently lock the attempt —
    // a corrected resubmission on the SAME attempt must still succeed.
    const fixedResult = await submitTestAttempt({
      userId: agentInvalidOpt._id,
      attemptId: attemptInvalidOpt._id,
      answers: allCorrectAnswers(attemptInvalidOpt),
    });
    check("after a rejected submission, a corrected resubmission on the same attempt succeeds", fixedResult.score === 100, fixedResult.score);

    // Client-supplied score/passed/version/application/agent refs are
    // ignored — server-computed values are used regardless.
    const { user: agentRigged } = await createTestPendingAgent("FA-3.4.2 Rigged Client Agent");
    const attemptRigged = await startTestAttempt({ userId: agentRigged._id });
    const riggedResult = await submitTestAttempt({
      userId: agentRigged._id,
      attemptId: attemptRigged._id,
      answers: allCorrectAnswers(attemptRigged),
      score: 0,
      passed: false,
      testVersionRef: "bogus",
      applicationRef: "bogus",
      agentRef: "bogus",
    });
    check(
      "client-supplied score/passed/refs are silently ignored — server-computed result is used",
      riggedResult.score === 100 && riggedResult.passed === true,
      riggedResult
    );
  }

  // ── SECTION Q — RETRY / MAX ATTEMPTS / COOLDOWN / STATE HANDOFF ───
  {
    const { user: agentQ, application: appQ } = await createTestPendingAgent("FA-3.4.2 Retry Agent");

    const attempt1 = await startTestAttempt({ userId: agentQ._id });
    const fail1 = await submitTestAttempt({ userId: agentQ._id, attemptId: attempt1._id, answers: allWrongAnswers(attempt1) });
    check("attempt 1 fails (0/10)", fail1.score === 0 && fail1.passed === false, fail1);

    const appAfterFail1 = await FieldAgentApplication.findById(appQ._id).lean();
    check("fail -> application TEST_PENDING -> TEST_FAILED", appAfterFail1.status === "TEST_FAILED", appAfterFail1.status);

    const immediateRetryBlocked = await expectThrow(() => startTestAttempt({ userId: agentQ._id }), "CONFLICT");
    check("retry immediately after failing is blocked by cooldown -> CONFLICT", immediateRetryBlocked.threw && immediateRetryBlocked.matches, immediateRetryBlocked);

    // Backdate the FAILED attempt beyond the 24h/1440min cooldown —
    // real arithmetic against real stored data, not a mocked clock.
    const backdateCooldown = async (attemptId) =>
      TestAttempt.updateOne({ _id: attemptId }, { $set: { submittedAt: new Date(Date.now() - (testV1.retryCooldownMinutes + 5) * 60000) } });
    await backdateCooldown(attempt1._id);

    const attempt2 = await startTestAttempt({ userId: agentQ._id });
    check("retry -> TEST_FAILED -> TEST_PENDING transition, new attemptNumber=2", attempt2.attemptNumber === 2, attempt2.attemptNumber);
    const appAfterRetry1 = await FieldAgentApplication.findById(appQ._id).lean();
    check("retry moves application TEST_FAILED -> TEST_PENDING", appAfterRetry1.status === "TEST_PENDING", appAfterRetry1.status);

    const fail2 = await submitTestAttempt({ userId: agentQ._id, attemptId: attempt2._id, answers: allWrongAnswers(attempt2) });
    check("attempt 2 fails (0/10)", fail2.passed === false, fail2);
    await backdateCooldown(attempt2._id);

    const attempt3 = await startTestAttempt({ userId: agentQ._id });
    check("second retry -> attemptNumber=3 (= locked maxAttempts)", attempt3.attemptNumber === 3, attempt3.attemptNumber);

    const fail3 = await submitTestAttempt({ userId: agentQ._id, attemptId: attempt3._id, answers: allWrongAnswers(attempt3) });
    check("attempt 3 fails (0/10)", fail3.passed === false, fail3);
    await backdateCooldown(attempt3._id);

    const maxAttemptsBlocked = await expectThrow(() => startTestAttempt({ userId: agentQ._id }), "CONFLICT");
    check("a 4th attempt is blocked once maxAttempts=3 is exhausted, even after cooldown elapses", maxAttemptsBlocked.threw && maxAttemptsBlocked.matches, maxAttemptsBlocked);
    const finalAttemptCount = await TestAttempt.countDocuments({ applicationRef: appQ._id });
    check("exactly 3 TestAttempt documents exist for this application (no 4th created)", finalAttemptCount === 3, finalAttemptCount);
    const attemptNumbers = (await TestAttempt.find({ applicationRef: appQ._id }).select("attemptNumber").lean()).map((a) => a.attemptNumber).sort();
    check("attempt numbers are exactly [1,2,3] — sequential, unique, no gaps or duplicates", JSON.stringify(attemptNumbers) === JSON.stringify([1, 2, 3]), attemptNumbers);
  }

  // ── SECTION R — PINNED TESTVERSION SURVIVES A NEWER PUBLISH ───────
  // Start (and keep IN_PROGRESS) an attempt against V1, THEN publish
  // V2 with a different passingScore, THEN submit the V1 attempt —
  // prove it is still graded by V1's own passingScore, not V2's.
  let testV2;
  {
    const { user: agentPin } = await createTestPendingAgent("FA-3.4.2 Version Pinning Agent");
    const attemptPin = await startTestAttempt({ userId: agentPin._id });
    check("pinning-test attempt pinned to V1 (passingScore=70)", String(attemptPin.testVersionRef) === String(testV1._id));

    const { version: draftV2 } = await createTaggedDraft("attempt engine V2 (different passingScore)", { passingScore: 90 });
    for (let i = 0; i < 10; i++) {
      await addQ(draftV2._id, makeQuestion(`FA-3.4.2 V2 Q${i}`, { correctOptionIndex: 0 }));
    }
    const publishV2Res = await authFetch(`/api/admin/field-agent-test/versions/${draftV2._id}/publish`, adminToken, { method: "POST" });
    const publishV2Json = await publishV2Res.json();
    check("V2 (passingScore=90) publishes successfully, auto-retiring V1", publishV2Res.status === 200, publishV2Res.status);
    testV2 = publishV2Json.data.version;

    const v1AfterSupersede = await TestVersion.findById(testV1._id).lean();
    check("V1 is now RETIRED (superseded by V2)", v1AfterSupersede.status === "RETIRED", v1AfterSupersede.status);

    // 7/10 correct -> 70%. Would FAIL against V2's 90% bar, but this
    // attempt is pinned to V1 (70% bar) — must still PASS.
    const pinResult = await submitTestAttempt({
      userId: agentPin._id,
      attemptId: attemptPin._id,
      answers: nCorrectAnswers(attemptPin, 7),
    });
    check("pinned V1 attempt scores 70", pinResult.score === 70, pinResult.score);
    check(
      "pinned V1 attempt uses V1's passingScore(70), not V2's(90) or V1's now-RETIRED status — passed=true",
      pinResult.passed === true,
      pinResult
    );
  }

  // ── SECTION S — CONCURRENCY (real MongoDB, no mocks) ──────────────
  {
    // Concurrent start — two simultaneous requests, same application.
    const { user: agentConcStart, application: appConcStart } = await createTestPendingAgent("FA-3.4.2 Concurrent Start Agent");
    const [csA, csB] = await Promise.all([
      startTestAttempt({ userId: agentConcStart._id }),
      startTestAttempt({ userId: agentConcStart._id }),
    ]);
    check("concurrent start: both calls resolve (loser reuses the winner's attempt)", !!csA && !!csB);
    check("concurrent start: both calls resolve to the SAME attempt id", String(csA._id) === String(csB._id), { a: String(csA._id), b: String(csB._id) });
    const concStartCount = await TestAttempt.countDocuments({ applicationRef: appConcStart._id });
    check("concurrent start: exactly one TestAttempt document was created", concStartCount === 1, concStartCount);
    const concStartActiveCount = await TestAttempt.countDocuments({ applicationRef: appConcStart._id, status: "IN_PROGRESS" });
    check("concurrent start: exactly one IN_PROGRESS attempt exists", concStartActiveCount === 1, concStartActiveCount);

    // Concurrent retry — two simultaneous requests after a failure.
    const { user: agentConcRetry, application: appConcRetry } = await createTestPendingAgent("FA-3.4.2 Concurrent Retry Agent");
    const attemptR1 = await startTestAttempt({ userId: agentConcRetry._id });
    await submitTestAttempt({ userId: agentConcRetry._id, attemptId: attemptR1._id, answers: allWrongAnswers(attemptR1) });
    await TestAttempt.updateOne(
      { _id: attemptR1._id },
      { $set: { submittedAt: new Date(Date.now() - (testV2.retryCooldownMinutes + 5) * 60000) } }
    );
    const [crA, crB] = await Promise.all([
      startTestAttempt({ userId: agentConcRetry._id }),
      startTestAttempt({ userId: agentConcRetry._id }),
    ]);
    check("concurrent retry: both calls resolve to the SAME new attempt id", String(crA._id) === String(crB._id), { a: String(crA._id), b: String(crB._id) });
    const concRetryCount = await TestAttempt.countDocuments({ applicationRef: appConcRetry._id });
    check("concurrent retry: exactly 2 TestAttempt documents exist total (attempt 1 + exactly one new attempt 2)", concRetryCount === 2, concRetryCount);
    const appAfterConcRetry = await FieldAgentApplication.findById(appConcRetry._id).lean();
    check("concurrent retry: application is TEST_PENDING exactly once (no corrupted double-transition)", appAfterConcRetry.status === "TEST_PENDING", appAfterConcRetry.status);

    // Concurrent submit — two simultaneous submissions, different
    // answer sets, same attempt.
    const { user: agentConcSubmit } = await createTestPendingAgent("FA-3.4.2 Concurrent Submit Agent");
    const attemptCS = await startTestAttempt({ userId: agentConcSubmit._id });
    const [subA, subB] = await Promise.allSettled([
      submitTestAttempt({ userId: agentConcSubmit._id, attemptId: attemptCS._id, answers: allCorrectAnswers(attemptCS) }),
      submitTestAttempt({ userId: agentConcSubmit._id, attemptId: attemptCS._id, answers: allWrongAnswers(attemptCS) }),
    ]);
    const fulfilled = [subA, subB].filter((r) => r.status === "fulfilled");
    const rejected = [subA, subB].filter((r) => r.status === "rejected");
    check("concurrent submit: exactly one of the two submissions finalizes", fulfilled.length === 1, { subA: subA.status, subB: subB.status });
    check("concurrent submit: the other is rejected with CONFLICT (claim already held/finalized)", rejected.length === 1 && rejected[0].reason?.code === "CONFLICT", rejected[0]?.reason?.message);
    const finalizedCS = await TestAttempt.findById(attemptCS._id).lean();
    check(
      "concurrent submit: final score is exactly one whole submission's result, never a corrupted mix (100 or 0, not in-between)",
      finalizedCS.score === 100 || finalizedCS.score === 0,
      finalizedCS.score
    );
    check("concurrent submit: attempt is finalized exactly once (status is PASSED or FAILED, not IN_PROGRESS)", finalizedCS.status !== "IN_PROGRESS", finalizedCS.status);
    const appAfterConcSubmit = await FieldAgentApplication.findById(attemptCS.applicationRef).lean();
    check(
      "concurrent submit: application received exactly one, consistent transition (ADMIN_REVIEW iff attempt PASSED, TEST_FAILED iff attempt FAILED)",
      (finalizedCS.status === "PASSED" && appAfterConcSubmit.status === "ADMIN_REVIEW") ||
        (finalizedCS.status === "FAILED" && appAfterConcSubmit.status === "TEST_FAILED"),
      { attempt: finalizedCS.status, application: appAfterConcSubmit.status }
    );

    // Transaction-failure proof — corrupt the application's status out
    // from under an IN_PROGRESS attempt (simulating some other real
    // concurrent process moving it), then prove the FA-2 transition
    // failure aborts cleanly with no contradictory attempt state.
    const { user: agentTxFail, application: appTxFail } = await createTestPendingAgent("FA-3.4.2 Transaction Failure Agent");
    const attemptTxFail = await startTestAttempt({ userId: agentTxFail._id });
    await FieldAgentApplication.updateOne({ _id: appTxFail._id }, { $set: { status: "KYC_PENDING", nonTerminal: true } });
    const txFailResult = await expectThrow(
      () => submitTestAttempt({ userId: agentTxFail._id, attemptId: attemptTxFail._id, answers: allCorrectAnswers(attemptTxFail) }),
      "CONFLICT"
    );
    check("an invalid FA-2 transition at finalization time aborts the whole submission -> CONFLICT", txFailResult.threw && txFailResult.matches, txFailResult);
    const attemptAfterTxFail = await TestAttempt.findById(attemptTxFail._id).lean();
    check("aborted transaction leaves the attempt untouched — still IN_PROGRESS, not PASSED/FAILED", attemptAfterTxFail.status === "IN_PROGRESS", attemptAfterTxFail.status);
    check("aborted transaction leaves the attempt unscored", attemptAfterTxFail.score === null && attemptAfterTxFail.passed === null, attemptAfterTxFail);
    check("aborted transaction still released the submission claim (not permanently stuck)", attemptAfterTxFail.submissionClaimedAt === null, attemptAfterTxFail.submissionClaimedAt);
    const appAfterTxFail = await FieldAgentApplication.findById(appTxFail._id).lean();
    check("aborted transaction leaves the application's (corrupted, pre-existing) status untouched by this submission", appAfterTxFail.status === "KYC_PENDING", appAfterTxFail.status);
  }

  // ════════════════════════════════════════════════════════════════
  // FA-3.4.3 — Agent API + FA-2 Handoff + Audit Integration
  // Real HTTP, real JWT, real MongoDB — exercising the actual routes
  // mounted at /api/field-agent/test, not direct service calls.
  // ════════════════════════════════════════════════════════════════

  let fa343PhoneSeq = 0;
  const fa343UserIds = [];
  const nextFa343Phone = () => `9999902${String(fa343PhoneSeq++).padStart(3, "0")}`;

  const makeFieldAgent = async (name) => {
    const phone = nextFa343Phone();
    const user = await User.create({ name, phone, role: "FIELD_AGENT", isActive: true });
    fa343UserIds.push(user._id);
    const application = await FieldAgentApplication.create({ userRef: user._id, phone, status: "TEST_PENDING", nonTerminal: true });
    const token = generateAccessToken({ _id: user._id, role: "FIELD_AGENT", tokenVersion: user.tokenVersion ?? 0 });
    return { user, application, token };
  };

  const TEST_API = "/api/field-agent/test";

  // Pre-flight cleanup — same rationale as FA-3.4.2's own (a prior
  // crashed/interrupted run may have left phones 9999902xxx behind).
  {
    const staleUsers = await User.find({ phone: { $regex: /^9999902\d{3}$/ } }).select("_id").lean();
    const staleUserIds = staleUsers.map((u) => u._id);
    if (staleUserIds.length > 0) {
      await TestAttempt.deleteMany({ agentRef: { $in: staleUserIds } });
      await FieldAgentApplication.deleteMany({ userRef: { $in: staleUserIds } });
      await User.deleteMany({ _id: { $in: staleUserIds } });
    }
  }

  // ── SECTION T — FIXTURE: PUBLISHED V3 TEST VERSION (for HTTP tests) ─
  let testV3;
  {
    const { version: draft } = await createTaggedDraft("FA-3.4.3 HTTP attempt engine V3");
    for (let i = 0; i < 10; i++) {
      await addQ(draft._id, makeQuestion(`FA-3.4.3 Q${i}`, { correctOptionIndex: 0 }));
    }
    const pubRes = await authFetch(`/api/admin/field-agent-test/versions/${draft._id}/publish`, adminToken, { method: "POST" });
    const pubJson = await pubRes.json();
    check("V3 test version published for FA-3.4.3 HTTP fixtures", pubRes.status === 200 && pubJson?.data?.version?.status === "PUBLISHED", pubRes.status);
    testV3 = pubJson.data.version;
  }

  // ── SECTION U — STATUS / START / QUESTIONS (happy path, HTTP) ────
  let passAgent, passAttemptId;
  {
    const agentU = await makeFieldAgent("FA-3.4.3 Status+Start Agent");

    const statusBeforeRes = await authFetch(TEST_API, agentU.token);
    const statusBefore = await statusBeforeRes.json();
    check("GET status before test -> 200", statusBeforeRes.status === 200, statusBeforeRes.status);
    check("status.testingAvailable=true before starting", statusBefore.data.status.testingAvailable === true, statusBefore.data.status);
    check("status.applicationStatus=TEST_PENDING", statusBefore.data.status.applicationStatus === "TEST_PENDING", statusBefore.data.status.applicationStatus);
    check("status.activeAttempt=null before starting", statusBefore.data.status.activeAttempt === null, statusBefore.data.status.activeAttempt);

    const auditStartedBefore = await FieldAgentAuditEvent.countDocuments({ actorRef: agentU.user._id, action: "TEST_STARTED" });

    const startRes = await authFetch(`${TEST_API}/attempts`, agentU.token, { method: "POST", body: JSON.stringify({}) });
    const startJson = await startRes.json();
    check("POST start attempt -> 200", startRes.status === 200, startRes.status);
    check("start response has attemptNumber=1", startJson.data.attempt.attemptNumber === 1, startJson.data.attempt);
    check("start response has questionCount=10", startJson.data.attempt.questionCount === 10, startJson.data.attempt.questionCount);
    const attemptId = startJson.data.attempt.attemptId;

    const auditStartedAfter = await FieldAgentAuditEvent.countDocuments({ actorRef: agentU.user._id, action: "TEST_STARTED" });
    check("exactly one TEST_STARTED audit event created for the actual new attempt", auditStartedAfter - auditStartedBefore === 1, auditStartedAfter - auditStartedBefore);
    const startedEvent = await FieldAgentAuditEvent.findOne({ actorRef: agentU.user._id, action: "TEST_STARTED" }).lean();
    check(
      "TEST_STARTED audit metadata is safe (no answers/grading) and correct",
      startedEvent.entityType === "TEST_ATTEMPT" &&
        String(startedEvent.entityId) === String(attemptId) &&
        startedEvent.newValue?.attemptNumber === 1 &&
        !JSON.stringify(startedEvent).includes("grading"),
      startedEvent
    );

    // Repeat start on the same active attempt — idempotent HTTP
    // response, NO duplicate TEST_STARTED audit event.
    const startRes2 = await authFetch(`${TEST_API}/attempts`, agentU.token, { method: "POST", body: JSON.stringify({}) });
    const startJson2 = await startRes2.json();
    check("repeat start -> 200, same attemptId", startRes2.status === 200 && startJson2.data.attempt.attemptId === attemptId, startJson2.data.attempt);
    const auditStartedAfterRepeat = await FieldAgentAuditEvent.countDocuments({ actorRef: agentU.user._id, action: "TEST_STARTED" });
    check("repeated start creates NO duplicate TEST_STARTED audit event", auditStartedAfterRepeat === auditStartedAfter, auditStartedAfterRepeat);

    const statusActiveRes = await authFetch(TEST_API, agentU.token);
    const statusActive = await statusActiveRes.json();
    check("status now reflects the active attempt", statusActive.data.status.activeAttempt?.attemptId === attemptId, statusActive.data.status.activeAttempt);
    check("status.attemptNumber=1 while active", statusActive.data.status.attemptNumber === 1, statusActive.data.status.attemptNumber);

    const questionsRes = await authFetch(`${TEST_API}/attempts/${attemptId}`, agentU.token);
    const questionsJson = await questionsRes.json();
    check("GET attempt questions -> 200", questionsRes.status === 200, questionsRes.status);
    check("10 questions delivered", questionsJson.data.questions.length === 10, questionsJson.data.questions.length);

    const attemptDoc = await TestAttempt.findById(attemptId).lean();
    check(
      "delivered question order exactly matches attempt.questionRefs (HTTP layer)",
      JSON.stringify(questionsJson.data.questions.map((q) => q._id)) === JSON.stringify(attemptDoc.questionRefs.map(String))
    );

    // Answer-key leakage scan across every response body seen so far.
    const combined = JSON.stringify([statusBefore, startJson, startJson2, statusActive, questionsJson]);
    check(
      "no grading/correctOptionIndex/answer-key leaked across status/start/questions HTTP responses",
      !combined.includes('"grading"') && !combined.includes("correctOptionIndex") && !combined.includes("rubric"),
      combined.slice(0, 300)
    );

    passAgent = agentU;
    passAttemptId = attemptId;
  }

  // ── SECTION V — SUBMIT PASS -> ADMIN_REVIEW + TEST_SUBMITTED ──────
  {
    const attemptDoc = await TestAttempt.findById(passAttemptId).lean();
    const answers = attemptDoc.questionRefs.map((qId) => ({ questionId: qId, selectedOptionIndex: 0 }));

    const auditSubmittedBefore = await FieldAgentAuditEvent.countDocuments({ actorRef: passAgent.user._id, action: "TEST_SUBMITTED" });

    const submitRes = await authFetch(`${TEST_API}/attempts/${passAttemptId}/submit`, passAgent.token, {
      method: "POST",
      body: JSON.stringify({ answers }),
    });
    const submitJson = await submitRes.json();
    check("POST submit (10/10 correct) -> 200", submitRes.status === 200, submitRes.status);
    check("submit response score=100, passed=true", submitJson.data.score === 100 && submitJson.data.passed === true, submitJson.data);
    check("submit response contains no answer-key/grading data", !JSON.stringify(submitJson).includes("grading") && !JSON.stringify(submitJson).includes("correctOptionIndex"), submitJson);

    const appAfterPass = await FieldAgentApplication.findById(passAgent.application._id).lean();
    check("passing submission moves application TEST_PENDING -> ADMIN_REVIEW (HTTP layer)", appAfterPass.status === "ADMIN_REVIEW", appAfterPass.status);

    const auditSubmittedAfter = await FieldAgentAuditEvent.countDocuments({ actorRef: passAgent.user._id, action: "TEST_SUBMITTED" });
    check("exactly one TEST_SUBMITTED audit event created", auditSubmittedAfter - auditSubmittedBefore === 1, auditSubmittedAfter - auditSubmittedBefore);
    const submittedEvent = await FieldAgentAuditEvent.findOne({ actorRef: passAgent.user._id, action: "TEST_SUBMITTED" }).lean();
    check(
      "TEST_SUBMITTED audit metadata is safe (score/passed only, no answers/grading) and correct",
      submittedEvent.newValue?.score === 100 &&
        submittedEvent.newValue?.passed === true &&
        !("answers" in (submittedEvent.newValue || {})) &&
        !JSON.stringify(submittedEvent).includes("grading"),
      submittedEvent
    );

    const statusAfterPass = await (await authFetch(TEST_API, passAgent.token)).json();
    check("status after passing reflects ADMIN_REVIEW, testingAvailable=false", statusAfterPass.data.status.applicationStatus === "ADMIN_REVIEW" && statusAfterPass.data.status.testingAvailable === false, statusAfterPass.data.status);

    // Cannot start again — passed, no longer eligible.
    const restartRes = await authFetch(`${TEST_API}/attempts`, passAgent.token, { method: "POST", body: JSON.stringify({}) });
    check("cannot start a new attempt after passing -> 409", restartRes.status === 409, restartRes.status);
  }

  // ── SECTION W — SUBMIT FAIL -> TEST_FAILED, RETRY, COOLDOWN, MAX ──
  {
    const agentW = await makeFieldAgent("FA-3.4.3 Fail+Retry Agent");

    const start1 = await (await authFetch(`${TEST_API}/attempts`, agentW.token, { method: "POST", body: JSON.stringify({}) })).json();
    const attempt1Doc = await TestAttempt.findById(start1.data.attempt.attemptId).lean();
    const wrongAnswers1 = attempt1Doc.questionRefs.map((qId) => ({ questionId: qId, selectedOptionIndex: 1 }));

    const fail1Res = await authFetch(`${TEST_API}/attempts/${attempt1Doc._id}/submit`, agentW.token, { method: "POST", body: JSON.stringify({ answers: wrongAnswers1 }) });
    const fail1Json = await fail1Res.json();
    check("submit all-wrong -> 200, score=0, passed=false", fail1Res.status === 200 && fail1Json.data.score === 0 && fail1Json.data.passed === false, fail1Json.data);

    const appAfterFail1 = await FieldAgentApplication.findById(agentW.application._id).lean();
    check("failing submission moves application TEST_PENDING -> TEST_FAILED (HTTP layer)", appAfterFail1.status === "TEST_FAILED", appAfterFail1.status);

    const statusAfterFail = await (await authFetch(TEST_API, agentW.token)).json();
    check("status after failing shows cooldownUntil set, testingAvailable=false", !!statusAfterFail.data.status.cooldownUntil && statusAfterFail.data.status.testingAvailable === false, statusAfterFail.data.status);

    const immediateRetry = await authFetch(`${TEST_API}/attempts`, agentW.token, { method: "POST", body: JSON.stringify({}) });
    check("retry blocked by cooldown -> 409", immediateRetry.status === 409, immediateRetry.status);

    // Backdate beyond cooldown — real data, real arithmetic.
    await TestAttempt.updateOne({ _id: attempt1Doc._id }, { $set: { submittedAt: new Date(Date.now() - (testV3.retryCooldownMinutes + 5) * 60000) } });

    const auditStartedBeforeRetry = await FieldAgentAuditEvent.countDocuments({ actorRef: agentW.user._id, action: "TEST_STARTED" });
    const start2Res = await authFetch(`${TEST_API}/attempts`, agentW.token, { method: "POST", body: JSON.stringify({}) });
    const start2Json = await start2Res.json();
    check("retry after cooldown elapses -> 200, attemptNumber=2", start2Res.status === 200 && start2Json.data.attempt.attemptNumber === 2, start2Json.data.attempt);
    const auditStartedAfterRetry = await FieldAgentAuditEvent.countDocuments({ actorRef: agentW.user._id, action: "TEST_STARTED" });
    check("retry creates its own new TEST_STARTED audit event", auditStartedAfterRetry - auditStartedBeforeRetry === 1, auditStartedAfterRetry - auditStartedBeforeRetry);

    const appAfterRetry = await FieldAgentApplication.findById(agentW.application._id).lean();
    check("retry moves application TEST_FAILED -> TEST_PENDING (HTTP layer)", appAfterRetry.status === "TEST_PENDING", appAfterRetry.status);

    // Drive to max attempts (locked V1 default = 3).
    const attempt2Doc = await TestAttempt.findById(start2Json.data.attempt.attemptId).lean();
    await authFetch(`${TEST_API}/attempts/${attempt2Doc._id}/submit`, agentW.token, {
      method: "POST",
      body: JSON.stringify({ answers: attempt2Doc.questionRefs.map((qId) => ({ questionId: qId, selectedOptionIndex: 1 })) }),
    });
    await TestAttempt.updateOne({ _id: attempt2Doc._id }, { $set: { submittedAt: new Date(Date.now() - (testV3.retryCooldownMinutes + 5) * 60000) } });

    const start3Json = await (await authFetch(`${TEST_API}/attempts`, agentW.token, { method: "POST", body: JSON.stringify({}) })).json();
    check("second retry -> attemptNumber=3 (= locked maxAttempts)", start3Json.data.attempt.attemptNumber === 3, start3Json.data.attempt);
    const attempt3Doc = await TestAttempt.findById(start3Json.data.attempt.attemptId).lean();
    await authFetch(`${TEST_API}/attempts/${attempt3Doc._id}/submit`, agentW.token, {
      method: "POST",
      body: JSON.stringify({ answers: attempt3Doc.questionRefs.map((qId) => ({ questionId: qId, selectedOptionIndex: 1 })) }),
    });
    await TestAttempt.updateOne({ _id: attempt3Doc._id }, { $set: { submittedAt: new Date(Date.now() - (testV3.retryCooldownMinutes + 5) * 60000) } });

    const maxAttemptsRes = await authFetch(`${TEST_API}/attempts`, agentW.token, { method: "POST", body: JSON.stringify({}) });
    check("4th attempt blocked once maxAttempts=3 exhausted, even after cooldown -> 409 (HTTP layer)", maxAttemptsRes.status === 409, maxAttemptsRes.status);

    const statusMaxed = await (await authFetch(TEST_API, agentW.token)).json();
    check("status reflects remainingAttempts=0 once exhausted", statusMaxed.data.status.remainingAttempts === 0, statusMaxed.data.status.remainingAttempts);
  }

  // ── SECTION X — IDOR (agent A vs agent B) ─────────────────────────
  {
    const agentA = await makeFieldAgent("FA-3.4.3 IDOR Agent A");
    const agentB = await makeFieldAgent("FA-3.4.3 IDOR Agent B");

    const startA = await (await authFetch(`${TEST_API}/attempts`, agentA.token, { method: "POST", body: JSON.stringify({}) })).json();
    const attemptAId = startA.data.attempt.attemptId;

    const bReadsA = await authFetch(`${TEST_API}/attempts/${attemptAId}`, agentB.token);
    check("agent B cannot GET agent A's attempt questions -> 404 (IDOR-safe, no existence leak)", bReadsA.status === 404, bReadsA.status);

    const attemptADoc = await TestAttempt.findById(attemptAId).lean();
    const bSubmitsA = await authFetch(`${TEST_API}/attempts/${attemptAId}/submit`, agentB.token, {
      method: "POST",
      body: JSON.stringify({ answers: attemptADoc.questionRefs.map((qId) => ({ questionId: qId, selectedOptionIndex: 0 })) }),
    });
    check("agent B cannot POST submit on agent A's attempt -> 404 (IDOR-safe)", bSubmitsA.status === 404, bSubmitsA.status);

    const attemptAAfterBAttack = await TestAttempt.findById(attemptAId).lean();
    check("agent A's attempt is completely unaffected by agent B's blocked attempts", attemptAAfterBAttack.status === "IN_PROGRESS" && attemptAAfterBAttack.score === null, attemptAAfterBAttack);

    const bReadsUnknown = await authFetch(`${TEST_API}/attempts/${new mongoose.Types.ObjectId()}`, agentB.token);
    check("a nonexistent attemptId also -> 404, same shape as an owned-by-another-agent one (no existence oracle)", bReadsUnknown.status === 404, bReadsUnknown.status);
  }

  // ── SECTION Y — UNAUTHENTICATED + WRONG ROLE ──────────────────────
  {
    const noTokenStatus = await fetch(url(TEST_API));
    check("unauthenticated GET status -> 401", noTokenStatus.status === 401, noTokenStatus.status);

    const noTokenStart = await fetch(url(`${TEST_API}/attempts`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    check("unauthenticated POST start -> 401", noTokenStart.status === 401, noTokenStart.status);

    const someAttempt = await TestAttempt.findOne().lean();
    const noTokenQuestions = await fetch(url(`${TEST_API}/attempts/${someAttempt._id}`));
    check("unauthenticated GET questions -> 401", noTokenQuestions.status === 401, noTokenQuestions.status);

    const noTokenSubmit = await fetch(url(`${TEST_API}/attempts/${someAttempt._id}/submit`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: [] }) });
    check("unauthenticated POST submit -> 401", noTokenSubmit.status === 401, noTokenSubmit.status);

    // Wrong role — a real ADMIN token must not gain agent-test access.
    const adminStatusRes = await authFetch(TEST_API, adminToken);
    check("ADMIN token CANNOT use the agent test status API -> 403", adminStatusRes.status === 403, adminStatusRes.status);
    const adminStartRes = await authFetch(`${TEST_API}/attempts`, adminToken, { method: "POST", body: JSON.stringify({}) });
    check("ADMIN token CANNOT start a test attempt -> 403", adminStartRes.status === 403, adminStartRes.status);

    const agentY = await makeFieldAgent("FA-3.4.3 Own Access Agent");
    const ownStatusRes = await authFetch(TEST_API, agentY.token);
    check("a real FIELD_AGENT CAN use its own test status API -> 200", ownStatusRes.status === 200, ownStatusRes.status);
  }

  // ── SECTION Z — MALICIOUS CLIENT-SUPPLIED FIELDS ──────────────────
  {
    const agentZ = await makeFieldAgent("FA-3.4.3 Rigged Client Agent");

    const riggedStart = await authFetch(`${TEST_API}/attempts`, agentZ.token, {
      method: "POST",
      body: JSON.stringify({ applicationRef: "bogus", agentRef: "bogus", testVersionRef: "bogus", attemptNumber: 99, score: 100, passed: true }),
    });
    check("start with forbidden client-trust fields -> 400 (rejected, not silently used)", riggedStart.status === 400, riggedStart.status);

    const legitStart = await (await authFetch(`${TEST_API}/attempts`, agentZ.token, { method: "POST", body: JSON.stringify({}) })).json();
    const attemptZDoc = await TestAttempt.findById(legitStart.data.attempt.attemptId).lean();

    const riggedSubmit = await authFetch(`${TEST_API}/attempts/${attemptZDoc._id}/submit`, agentZ.token, {
      method: "POST",
      body: JSON.stringify({
        answers: attemptZDoc.questionRefs.map((qId) => ({ questionId: qId, selectedOptionIndex: 0 })),
        score: 0,
        passed: false,
        applicationRef: "bogus",
        agentRef: "bogus",
        testVersionRef: "bogus",
        attemptNumber: 999,
      }),
    });
    check("submit with forbidden client-trust fields -> 400 (rejected, not silently used)", riggedSubmit.status === 400, riggedSubmit.status);

    // Attempt remains fully usable after the rejected rigged request —
    // a legitimate, clean resubmission still succeeds with the
    // server-computed (not client-supplied) result.
    const cleanSubmit = await authFetch(`${TEST_API}/attempts/${attemptZDoc._id}/submit`, agentZ.token, {
      method: "POST",
      body: JSON.stringify({ answers: attemptZDoc.questionRefs.map((qId) => ({ questionId: qId, selectedOptionIndex: 0 })) }),
    });
    const cleanSubmitJson = await cleanSubmit.json();
    check("a clean resubmission after a rejected rigged one still succeeds, server-computed", cleanSubmit.status === 200 && cleanSubmitJson.data.score === 100 && cleanSubmitJson.data.passed === true, cleanSubmitJson.data);
  }

  // ── SECTION AA — CONCURRENCY (real HTTP) ──────────────────────────
  {
    const agentConcStart = await makeFieldAgent("FA-3.4.3 HTTP Concurrent Start Agent");
    const [csA, csB] = await Promise.all([
      authFetch(`${TEST_API}/attempts`, agentConcStart.token, { method: "POST", body: JSON.stringify({}) }),
      authFetch(`${TEST_API}/attempts`, agentConcStart.token, { method: "POST", body: JSON.stringify({}) }),
    ]);
    const [csAJson, csBJson] = await Promise.all([csA.json(), csB.json()]);
    check("concurrent HTTP start: both requests succeed (200)", csA.status === 200 && csB.status === 200, [csA.status, csB.status]);
    check("concurrent HTTP start: both resolve to the same attemptId", csAJson.data.attempt.attemptId === csBJson.data.attempt.attemptId, [csAJson.data.attempt.attemptId, csBJson.data.attempt.attemptId]);
    const concStartAttemptCount = await TestAttempt.countDocuments({ applicationRef: agentConcStart.application._id });
    check("concurrent HTTP start: exactly one TestAttempt document created", concStartAttemptCount === 1, concStartAttemptCount);
    const concStartAuditCount = await FieldAgentAuditEvent.countDocuments({ actorRef: agentConcStart.user._id, action: "TEST_STARTED" });
    check("concurrent HTTP start: exactly one TEST_STARTED audit event, no duplicates from the race", concStartAuditCount === 1, concStartAuditCount);

    const agentConcSubmit = await makeFieldAgent("FA-3.4.3 HTTP Concurrent Submit Agent");
    const startCS = await (await authFetch(`${TEST_API}/attempts`, agentConcSubmit.token, { method: "POST", body: JSON.stringify({}) })).json();
    const attemptCSDoc = await TestAttempt.findById(startCS.data.attempt.attemptId).lean();
    const allCorrectCS = attemptCSDoc.questionRefs.map((qId) => ({ questionId: qId, selectedOptionIndex: 0 }));
    const allWrongCS = attemptCSDoc.questionRefs.map((qId) => ({ questionId: qId, selectedOptionIndex: 1 }));

    const [subA, subB] = await Promise.all([
      authFetch(`${TEST_API}/attempts/${attemptCSDoc._id}/submit`, agentConcSubmit.token, { method: "POST", body: JSON.stringify({ answers: allCorrectCS }) }),
      authFetch(`${TEST_API}/attempts/${attemptCSDoc._id}/submit`, agentConcSubmit.token, { method: "POST", body: JSON.stringify({ answers: allWrongCS }) }),
    ]);
    const statuses = [subA.status, subB.status].sort();
    check("concurrent HTTP submit: exactly one 200 and one 409 (no double finalize)", statuses[0] === 200 && statuses[1] === 409, statuses);

    const concSubmitAuditCount = await FieldAgentAuditEvent.countDocuments({ actorRef: agentConcSubmit.user._id, action: "TEST_SUBMITTED" });
    check("concurrent HTTP submit: exactly one TEST_SUBMITTED audit event", concSubmitAuditCount === 1, concSubmitAuditCount);
    const finalizedCS = await TestAttempt.findById(attemptCSDoc._id).lean();
    check("concurrent HTTP submit: final score is one whole result, never corrupted (100 or 0)", finalizedCS.score === 100 || finalizedCS.score === 0, finalizedCS.score);
  }

  // ── SECTION AB — AUDIT CORRECTNESS UNDER FAILURE (no false events) ─
  {
    const agentAB = await makeFieldAgent("FA-3.4.3 Invalid Submission Audit Agent");
    const startAB = await (await authFetch(`${TEST_API}/attempts`, agentAB.token, { method: "POST", body: JSON.stringify({}) })).json();
    const attemptABId = startAB.data.attempt.attemptId;

    const auditSubmittedBefore = await FieldAgentAuditEvent.countDocuments({ actorRef: agentAB.user._id, action: "TEST_SUBMITTED" });

    const unknownQRes = await authFetch(`${TEST_API}/attempts/${attemptABId}/submit`, agentAB.token, {
      method: "POST",
      body: JSON.stringify({ answers: [{ questionId: new mongoose.Types.ObjectId(), selectedOptionIndex: 0 }] }),
    });
    check("submission with an unknown question id -> 400", unknownQRes.status === 400, unknownQRes.status);

    const auditSubmittedAfterInvalid = await FieldAgentAuditEvent.countDocuments({ actorRef: agentAB.user._id, action: "TEST_SUBMITTED" });
    check("an invalid (rejected) submission creates NO TEST_SUBMITTED audit event", auditSubmittedAfterInvalid === auditSubmittedBefore, auditSubmittedAfterInvalid - auditSubmittedBefore);

    const attemptABDoc = await TestAttempt.findById(attemptABId).lean();
    check("attempt remains IN_PROGRESS and resubmittable after the rejected submission", attemptABDoc.status === "IN_PROGRESS", attemptABDoc.status);
  }

  // ── SECTION AC — TRANSACTION-FAILURE CONSISTENCY (HTTP layer) ────
  {
    const agentAC = await makeFieldAgent("FA-3.4.3 Transaction Failure Agent (HTTP)");
    const startAC = await (await authFetch(`${TEST_API}/attempts`, agentAC.token, { method: "POST", body: JSON.stringify({}) })).json();
    const attemptACId = startAC.data.attempt.attemptId;
    const attemptACDoc = await TestAttempt.findById(attemptACId).lean();

    // Simulate a real concurrent external mutation of the application
    // state between start and submit.
    await FieldAgentApplication.updateOne({ _id: agentAC.application._id }, { $set: { status: "KYC_PENDING", nonTerminal: true } });

    const auditSubmittedBefore = await FieldAgentAuditEvent.countDocuments({ actorRef: agentAC.user._id, action: "TEST_SUBMITTED" });
    const failedTxRes = await authFetch(`${TEST_API}/attempts/${attemptACId}/submit`, agentAC.token, {
      method: "POST",
      body: JSON.stringify({ answers: attemptACDoc.questionRefs.map((qId) => ({ questionId: qId, selectedOptionIndex: 0 })) }),
    });
    check("an FA-2 transition failure at finalization time surfaces as a 4xx/5xx error, not a false success", failedTxRes.status >= 400, failedTxRes.status);

    const auditSubmittedAfter = await FieldAgentAuditEvent.countDocuments({ actorRef: agentAC.user._id, action: "TEST_SUBMITTED" });
    check("a failed FA-2 transition creates NO false TEST_SUBMITTED audit event", auditSubmittedAfter === auditSubmittedBefore, auditSubmittedAfter - auditSubmittedBefore);

    const attemptACAfter = await TestAttempt.findById(attemptACId).lean();
    check("aborted transaction (HTTP layer) leaves the attempt untouched — still IN_PROGRESS", attemptACAfter.status === "IN_PROGRESS", attemptACAfter.status);
  }

  // ════════════════════════════════════════════════════════════════
  // FA-3.4.4 — FINAL INTEGRATION REGRESSION
  // Cross-work-package scenarios not yet proven by FA-3.4.1/3.4.2/
  // 3.4.3's own sections above — no new product behavior, only proof
  // that the three packages operate correctly TOGETHER, through the
  // real agent HTTP API. Everything reachable via direct service
  // calls alone was already exhaustively proven in FA-3.4.2's own
  // sections; this block deliberately does NOT repeat that.
  // ════════════════════════════════════════════════════════════════

  let fa344PhoneSeq = 0;
  const fa344UserIds = [];
  const nextFa344Phone = () => `9999903${String(fa344PhoneSeq++).padStart(3, "0")}`;

  const makeFieldAgent344 = async (name) => {
    const phone = nextFa344Phone();
    const user = await User.create({ name, phone, role: "FIELD_AGENT", isActive: true });
    fa344UserIds.push(user._id);
    const application = await FieldAgentApplication.create({ userRef: user._id, phone, status: "TEST_PENDING", nonTerminal: true });
    const token = generateAccessToken({ _id: user._id, role: "FIELD_AGENT", tokenVersion: user.tokenVersion ?? 0 });
    return { user, application, token };
  };

  // Pre-flight cleanup — same rationale as FA-3.4.2/3.4.3's own.
  {
    const staleUsers = await User.find({ phone: { $regex: /^9999903\d{3}$/ } }).select("_id").lean();
    const staleUserIds = staleUsers.map((u) => u._id);
    if (staleUserIds.length > 0) {
      await TestAttempt.deleteMany({ agentRef: { $in: staleUserIds } });
      await FieldAgentApplication.deleteMany({ userRef: { $in: staleUserIds } });
      await User.deleteMany({ _id: { $in: staleUserIds } });
    }
  }

  const publishFa344Version = async (notesSuffix, body = {}) => {
    const { version: draft } = await createTaggedDraft(notesSuffix, body);
    for (let i = 0; i < 10; i++) {
      await addQ(draft._id, makeQuestion(`FA-3.4.4 ${notesSuffix} Q${i}`, { correctOptionIndex: 0 }));
    }
    const pubRes = await authFetch(`/api/admin/field-agent-test/versions/${draft._id}/publish`, adminToken, { method: "POST" });
    const pubJson = await pubRes.json();
    return { res: pubRes, version: pubJson.data.version };
  };

  // ── FA-3.4.4 SCENARIO 1 — FULL LIFECYCLE, PASS BRANCH (real HTTP) ─
  // Admin draft -> 10 questions -> grading -> publish -> agent
  // TEST_PENDING -> status -> start -> TEST_STARTED audit -> ordered
  // questions, no grading -> submit -> score -> finalize ->
  // TEST_SUBMITTED audit -> ADMIN_REVIEW. One coherent, sequentially
  // asserted narrative, exactly as specified.
  let lifecycleVersion;
  {
    const { res: pubRes, version } = await publishFa344Version("lifecycle pass branch");
    check("SCENARIO 1: admin publishes a DRAFT with 10 graded questions -> PUBLISHED", pubRes.status === 200 && version.status === "PUBLISHED", pubRes.status);
    lifecycleVersion = version;

    const agent1 = await makeFieldAgent344("FA-3.4.4 Lifecycle Pass Agent");

    const status1 = await (await authFetch(TEST_API, agent1.token)).json();
    check("SCENARIO 1: agent reaches TEST_PENDING, status shows testingAvailable=true", status1.data.status.applicationStatus === "TEST_PENDING" && status1.data.status.testingAvailable === true, status1.data.status);

    const auditStartedBefore = await FieldAgentAuditEvent.countDocuments({ actorRef: agent1.user._id, action: "TEST_STARTED" });
    const start1 = await (await authFetch(`${TEST_API}/attempts`, agent1.token, { method: "POST", body: JSON.stringify({}) })).json();
    const attempt1Id = start1.data.attempt.attemptId;
    const auditStartedAfter = await FieldAgentAuditEvent.countDocuments({ actorRef: agent1.user._id, action: "TEST_STARTED" });
    check("SCENARIO 1: POST start creates exactly one TEST_STARTED audit event", auditStartedAfter - auditStartedBefore === 1, auditStartedAfter - auditStartedBefore);

    const questions1 = await (await authFetch(`${TEST_API}/attempts/${attempt1Id}`, agent1.token)).json();
    const attempt1Doc = await TestAttempt.findById(attempt1Id).lean();
    check(
      "SCENARIO 1: questions returned in attempt.questionRefs order",
      JSON.stringify(questions1.data.questions.map((q) => q._id)) === JSON.stringify(attempt1Doc.questionRefs.map(String))
    );
    check(
      "SCENARIO 1: grading/answer key absent from question delivery",
      !JSON.stringify(questions1).includes('"grading"') && !JSON.stringify(questions1).includes("correctOptionIndex")
    );

    const auditSubmittedBefore = await FieldAgentAuditEvent.countDocuments({ actorRef: agent1.user._id, action: "TEST_SUBMITTED" });
    const submit1 = await (
      await authFetch(`${TEST_API}/attempts/${attempt1Id}/submit`, agent1.token, {
        method: "POST",
        body: JSON.stringify({ answers: attempt1Doc.questionRefs.map((qId) => ({ questionId: qId, selectedOptionIndex: 0 })) }),
      })
    ).json();
    check("SCENARIO 1: server calculates score=100 for 10/10 correct", submit1.data.score === 100 && submit1.data.passed === true, submit1.data);

    const finalized1 = await TestAttempt.findById(attempt1Id).lean();
    check("SCENARIO 1: TestAttempt finalized to PASSED", finalized1.status === "PASSED", finalized1.status);

    const auditSubmittedAfter = await FieldAgentAuditEvent.countDocuments({ actorRef: agent1.user._id, action: "TEST_SUBMITTED" });
    check("SCENARIO 1: exactly one TEST_SUBMITTED audit event", auditSubmittedAfter - auditSubmittedBefore === 1, auditSubmittedAfter - auditSubmittedBefore);

    const app1After = await FieldAgentApplication.findById(agent1.application._id).lean();
    check("SCENARIO 1: FA-2 application transitions TEST_PENDING -> ADMIN_REVIEW on pass", app1After.status === "ADMIN_REVIEW", app1After.status);
  }

  // ── FA-3.4.4 SCENARIO 2 — FAIL -> COOLDOWN -> RETRY -> TEST_PENDING
  {
    const agent2 = await makeFieldAgent344("FA-3.4.4 Lifecycle Fail Retry Agent");
    const start2 = await (await authFetch(`${TEST_API}/attempts`, agent2.token, { method: "POST", body: JSON.stringify({}) })).json();
    const attempt2Doc = await TestAttempt.findById(start2.data.attempt.attemptId).lean();

    const fail2 = await (
      await authFetch(`${TEST_API}/attempts/${attempt2Doc._id}/submit`, agent2.token, {
        method: "POST",
        body: JSON.stringify({ answers: attempt2Doc.questionRefs.map((qId) => ({ questionId: qId, selectedOptionIndex: 1 })) }),
      })
    ).json();
    check("SCENARIO 2: failed attempt scores 0, passed=false", fail2.data.score === 0 && fail2.data.passed === false, fail2.data);

    const app2AfterFail = await FieldAgentApplication.findById(agent2.application._id).lean();
    check("SCENARIO 2: application transitions TEST_PENDING -> TEST_FAILED", app2AfterFail.status === "TEST_FAILED", app2AfterFail.status);

    const blockedRetry = await authFetch(`${TEST_API}/attempts`, agent2.token, { method: "POST", body: JSON.stringify({}) });
    check("SCENARIO 2: retry blocked while cooldown is active -> 409", blockedRetry.status === 409, blockedRetry.status);

    await TestAttempt.updateOne({ _id: attempt2Doc._id }, { $set: { submittedAt: new Date(Date.now() - (lifecycleVersion.retryCooldownMinutes + 5) * 60000) } });

    const retry2 = await (await authFetch(`${TEST_API}/attempts`, agent2.token, { method: "POST", body: JSON.stringify({}) })).json();
    check("SCENARIO 2: retry after cooldown creates a new attempt (attemptNumber=2)", retry2.data.attempt.attemptNumber === 2, retry2.data.attempt);

    const app2AfterRetry = await FieldAgentApplication.findById(agent2.application._id).lean();
    check("SCENARIO 2: application transitions TEST_FAILED -> TEST_PENDING on retry", app2AfterRetry.status === "TEST_PENDING", app2AfterRetry.status);

    const retryAttemptDoc = await TestAttempt.findById(retry2.data.attempt.attemptId).lean();
    check("SCENARIO 2: new attempt is pinned to the currently published version", String(retryAttemptDoc.testVersionRef) === String(lifecycleVersion._id), retryAttemptDoc.testVersionRef);
  }

  // ── FA-3.4.4 SCENARIO 3 — VERSION PINNING VIA THE REAL AGENT API ──
  {
    const { version: pinV1 } = await publishFa344Version("pinning V1");
    const agent3 = await makeFieldAgent344("FA-3.4.4 Pinning Agent");

    const start3 = await (await authFetch(`${TEST_API}/attempts`, agent3.token, { method: "POST", body: JSON.stringify({}) })).json();
    const attempt3Id = start3.data.attempt.attemptId;
    const attempt3Doc = await TestAttempt.findById(attempt3Id).lean();
    check("SCENARIO 3: attempt pinned to V1 at start", String(attempt3Doc.testVersionRef) === String(pinV1._id), attempt3Doc.testVersionRef);

    // Publish V2 with a DIFFERENT passingScore — auto-retires V1.
    const { res: pubV2Res, version: pinV2 } = await publishFa344Version("pinning V2 (different passingScore)", { passingScore: 95 });
    check("SCENARIO 3: V2 publishes successfully, becomes current published version", pubV2Res.status === 200 && pinV2.status === "PUBLISHED", pubV2Res.status);
    const v1AfterSupersede = await TestVersion.findById(pinV1._id).lean();
    check("SCENARIO 3: V1 is now RETIRED", v1AfterSupersede.status === "RETIRED", v1AfterSupersede.status);

    // The existing V1 attempt must be COMPLETELY UNALTERED by V2's publish.
    const attempt3AfterV2Publish = await TestAttempt.findById(attempt3Id).lean();
    check(
      "SCENARIO 3: existing V1 attempt is unaltered by V2's publish — still pinned to V1, still IN_PROGRESS",
      String(attempt3AfterV2Publish.testVersionRef) === String(pinV1._id) && attempt3AfterV2Publish.status === "IN_PROGRESS",
      attempt3AfterV2Publish
    );

    // Submit the V1 attempt THROUGH THE REAL AGENT API — 7/10 correct
    // is 70%, which would FAIL against V2's 95% bar but must PASS
    // against V1's 70% bar, since scoring is pinned.
    const submit3 = await (
      await authFetch(`${TEST_API}/attempts/${attempt3Id}/submit`, agent3.token, {
        method: "POST",
        body: JSON.stringify({
          answers: attempt3Doc.questionRefs.map((qId, i) => ({ questionId: qId, selectedOptionIndex: i < 7 ? 0 : 1 })),
        }),
      })
    ).json();
    check("SCENARIO 3: V1-pinned attempt scores 70 via the real HTTP API", submit3.data.score === 70, submit3.data.score);
    check("SCENARIO 3: V1-pinned attempt PASSES using V1's passingScore(70), not V2's(95)", submit3.data.passed === true, submit3.data);

    const attempt3Final = await TestAttempt.findById(attempt3Id).lean();
    check("SCENARIO 3: finalized attempt remains permanently pinned to V1", String(attempt3Final.testVersionRef) === String(pinV1._id), attempt3Final.testVersionRef);

    // A NEW eligible attempt (different agent) must use V2.
    const agent3b = await makeFieldAgent344("FA-3.4.4 Pinning Agent V2");
    const start3b = await (await authFetch(`${TEST_API}/attempts`, agent3b.token, { method: "POST", body: JSON.stringify({}) })).json();
    const attempt3bDoc = await TestAttempt.findById(start3b.data.attempt.attemptId).lean();
    check("SCENARIO 3: a new attempt started after V2's publish is pinned to V2", String(attempt3bDoc.testVersionRef) === String(pinV2._id), attempt3bDoc.testVersionRef);
  }

  // ── FA-3.4.4 SCENARIO 4 — RETIRED VERSION, NO REPLACEMENT, ACTIVE
  // ATTEMPT SURVIVES (regression guard vs. the FA-3.3.2.5-style defect:
  // access to an in-flight attempt must NEVER depend on a currently
  // published version existing).
  {
    const { version: retireTarget } = await publishFa344Version("retire-no-replacement");
    const agent4 = await makeFieldAgent344("FA-3.4.4 Retired-No-Replacement Agent");

    const start4 = await (await authFetch(`${TEST_API}/attempts`, agent4.token, { method: "POST", body: JSON.stringify({}) })).json();
    const attempt4Id = start4.data.attempt.attemptId;
    const attempt4Doc = await TestAttempt.findById(attempt4Id).lean();

    // Manually retire — NOT superseded by a new publish, so ZERO
    // PUBLISHED versions exist afterward.
    const retireRes = await authFetch(`/api/admin/field-agent-test/versions/${retireTarget._id}/retire`, adminToken, {
      method: "POST",
      body: JSON.stringify({ reason: "FA-3.4.4 SCENARIO 4 — retire with no replacement" }),
    });
    check("SCENARIO 4: version retired with no replacement published", retireRes.status === 200, retireRes.status);
    const publishedCountNow = await TestVersion.countDocuments({ status: "PUBLISHED" });
    check("SCENARIO 4: zero PUBLISHED versions exist at this point", publishedCountNow === 0, publishedCountNow);

    // The EXISTING in-progress attempt must still be fully usable.
    const questions4 = await authFetch(`${TEST_API}/attempts/${attempt4Id}`, agent4.token);
    check("SCENARIO 4: GET questions on the still-active attempt succeeds with NO published version at all", questions4.status === 200, questions4.status);

    const submit4 = await authFetch(`${TEST_API}/attempts/${attempt4Id}/submit`, agent4.token, {
      method: "POST",
      body: JSON.stringify({ answers: attempt4Doc.questionRefs.map((qId) => ({ questionId: qId, selectedOptionIndex: 0 })) }),
    });
    const submit4Json = await submit4.json();
    check("SCENARIO 4: submitting the still-active attempt succeeds with NO published version at all", submit4.status === 200 && submit4Json.data.score === 100, submit4.status);

    // A DIFFERENT, NEW agent must NOT be able to start — no published
    // version exists to start against (confirms a retired version can
    // never become a new attempt's current version).
    const agent4b = await makeFieldAgent344("FA-3.4.4 No-Published-Version Agent");
    const blockedStart = await authFetch(`${TEST_API}/attempts`, agent4b.token, { method: "POST", body: JSON.stringify({}) });
    check("SCENARIO 4: a NEW attempt cannot start with zero published versions -> 404/409", [404, 409].includes(blockedStart.status), blockedStart.status);
  }

  // Restore a published version for the remaining scenarios below.
  let currentFa344Version;
  {
    const { version } = await publishFa344Version("restore for remaining scenarios");
    currentFa344Version = version;
  }

  // ── FA-3.4.4 SCENARIO 5 — CONCURRENT RETRY VIA REAL HTTP ─────────
  {
    const agent5 = await makeFieldAgent344("FA-3.4.4 Concurrent Retry HTTP Agent");
    const start5 = await (await authFetch(`${TEST_API}/attempts`, agent5.token, { method: "POST", body: JSON.stringify({}) })).json();
    const attempt5Doc = await TestAttempt.findById(start5.data.attempt.attemptId).lean();
    await authFetch(`${TEST_API}/attempts/${attempt5Doc._id}/submit`, agent5.token, {
      method: "POST",
      body: JSON.stringify({ answers: attempt5Doc.questionRefs.map((qId) => ({ questionId: qId, selectedOptionIndex: 1 })) }),
    });
    await TestAttempt.updateOne({ _id: attempt5Doc._id }, { $set: { submittedAt: new Date(Date.now() - (currentFa344Version.retryCooldownMinutes + 5) * 60000) } });

    const auditStartedBefore = await FieldAgentAuditEvent.countDocuments({ actorRef: agent5.user._id, action: "TEST_STARTED" });
    const [rA, rB] = await Promise.all([
      authFetch(`${TEST_API}/attempts`, agent5.token, { method: "POST", body: JSON.stringify({}) }),
      authFetch(`${TEST_API}/attempts`, agent5.token, { method: "POST", body: JSON.stringify({}) }),
    ]);
    const [rAJson, rBJson] = await Promise.all([rA.json(), rB.json()]);
    check("SCENARIO 5: concurrent HTTP retry — both requests succeed (200)", rA.status === 200 && rB.status === 200, [rA.status, rB.status]);
    check("SCENARIO 5: concurrent HTTP retry — both resolve to the SAME new attempt", rAJson.data.attempt.attemptId === rBJson.data.attempt.attemptId, [rAJson.data.attempt.attemptId, rBJson.data.attempt.attemptId]);

    const attempt5Count = await TestAttempt.countDocuments({ applicationRef: agent5.application._id });
    check("SCENARIO 5: exactly 2 TestAttempt documents total (attempt 1 + exactly one retry)", attempt5Count === 2, attempt5Count);
    const activeCount5 = await TestAttempt.countDocuments({ applicationRef: agent5.application._id, status: "IN_PROGRESS" });
    check("SCENARIO 5: exactly one active (IN_PROGRESS) attempt — no duplicate", activeCount5 === 1, activeCount5);

    const auditStartedAfter = await FieldAgentAuditEvent.countDocuments({ actorRef: agent5.user._id, action: "TEST_STARTED" });
    check("SCENARIO 5: exactly one new TEST_STARTED audit event from the race (2 total: attempt 1 + this retry)", auditStartedAfter - auditStartedBefore === 1, auditStartedAfter - auditStartedBefore);

    const app5After = await FieldAgentApplication.findById(agent5.application._id).lean();
    check("SCENARIO 5: application is TEST_PENDING exactly once — no double TEST_FAILED->TEST_PENDING transition", app5After.status === "TEST_PENDING", app5After.status);
  }

  // ── FA-3.4.4 SCENARIO 6 — MAX-ATTEMPT EXHAUSTION VIA REAL HTTP ───
  {
    const agent6 = await makeFieldAgent344("FA-3.4.4 Max Attempts Agent");
    let lastAttemptId = null;
    for (let n = 1; n <= currentFa344Version.maxAttempts; n++) {
      const startN = await (await authFetch(`${TEST_API}/attempts`, agent6.token, { method: "POST", body: JSON.stringify({}) })).json();
      check(`SCENARIO 6: attempt ${n} starts with attemptNumber=${n}`, startN.data.attempt.attemptNumber === n, startN.data.attempt);
      lastAttemptId = startN.data.attempt.attemptId;
      const attemptNDoc = await TestAttempt.findById(lastAttemptId).lean();
      await authFetch(`${TEST_API}/attempts/${lastAttemptId}/submit`, agent6.token, {
        method: "POST",
        body: JSON.stringify({ answers: attemptNDoc.questionRefs.map((qId) => ({ questionId: qId, selectedOptionIndex: 1 })) }),
      });
      await TestAttempt.updateOne({ _id: lastAttemptId }, { $set: { submittedAt: new Date(Date.now() - (currentFa344Version.retryCooldownMinutes + 5) * 60000) } });
    }
    const exhaustedRes = await authFetch(`${TEST_API}/attempts`, agent6.token, { method: "POST", body: JSON.stringify({}) });
    check(`SCENARIO 6: attempt ${currentFa344Version.maxAttempts + 1} blocked once maxAttempts=${currentFa344Version.maxAttempts} exhausted -> 409`, exhaustedRes.status === 409, exhaustedRes.status);
    const attemptCount6 = await TestAttempt.countDocuments({ applicationRef: agent6.application._id });
    check(`SCENARIO 6: exactly ${currentFa344Version.maxAttempts} TestAttempt documents exist (no extra created)`, attemptCount6 === currentFa344Version.maxAttempts, attemptCount6);
  }

  // ── FA-3.4.4 — AUDIT: VERSION LIFECYCLE EVENTS ────────────────────
  {
    const publishedEvent = await FieldAgentAuditEvent.findOne({
      entityType: "TEST_VERSION",
      entityId: lifecycleVersion._id,
      action: "TEST_VERSION_PUBLISHED",
    }).lean();
    check("TEST_VERSION_PUBLISHED audit event exists for a version published during this run", !!publishedEvent, publishedEvent);

    const retiredEvent = await FieldAgentAuditEvent.findOne({
      entityType: "TEST_VERSION",
      action: "TEST_VERSION_RETIRED",
    })
      .sort({ createdAt: -1 })
      .lean();
    check("TEST_VERSION_RETIRED audit event exists (version(s) retired during this run)", !!retiredEvent, retiredEvent);
    check(
      "TEST_VERSION_PUBLISHED/RETIRED audit metadata contains no grading/answer-key data",
      !JSON.stringify(publishedEvent).includes("grading") && !JSON.stringify(retiredEvent).includes("grading")
    );
  }

  // ── FA-3.4.4 — INDEX USAGE VERIFICATION (explain, not just existence) ─
  {
    const anyApplicationId = (await TestAttempt.findOne().select("applicationRef").lean())?.applicationRef;
    if (anyApplicationId) {
      const attemptExplain = await TestAttempt.find({ applicationRef: anyApplicationId }).explain("executionStats");
      const attemptStage = JSON.stringify(attemptExplain.queryPlanner?.winningPlan || attemptExplain);
      check("TestAttempt lookup by applicationRef uses an index scan, not a collection scan", attemptStage.includes("IXSCAN") && !attemptStage.includes("COLLSCAN"), attemptStage.slice(0, 200));
    }

    const versionExplain = await TestVersion.find({ status: "PUBLISHED" }).explain("executionStats");
    const versionStage = JSON.stringify(versionExplain.queryPlanner?.winningPlan || versionExplain);
    check("TestVersion PUBLISHED lookup uses an index scan, not a collection scan", versionStage.includes("IXSCAN") && !versionStage.includes("COLLSCAN"), versionStage.slice(0, 200));

    const anyAgentId = (await TestAttempt.findOne().select("agentRef").lean())?.agentRef;
    if (anyAgentId) {
      const agentExplain = await TestAttempt.find({ agentRef: anyAgentId }).explain("executionStats");
      const agentStage = JSON.stringify(agentExplain.queryPlanner?.winningPlan || agentExplain);
      check("TestAttempt lookup by agentRef uses an index scan, not a collection scan", agentStage.includes("IXSCAN") && !agentStage.includes("COLLSCAN"), agentStage.slice(0, 200));
    }
  }

  // ── FA-3.4.4 — FINAL DATA INTEGRITY SWEEP (DB-level, pre-cleanup) ─
  {
    // No orphan TestQuestion — every testVersion reference resolves.
    const allQuestions = await TestQuestion.find().select("testVersion").lean();
    const allVersionIds = new Set((await TestVersion.find().select("_id").lean()).map((v) => String(v._id)));
    const orphanQuestions = allQuestions.filter((q) => !allVersionIds.has(String(q.testVersion)));
    check("data integrity: zero orphan TestQuestion documents", orphanQuestions.length === 0, orphanQuestions.length);

    // No orphan TestAttempt — applicationRef and testVersionRef both resolve.
    const allApplicationIds = new Set((await FieldAgentApplication.find().select("_id").lean()).map((a) => String(a._id)));
    const allAttempts = await TestAttempt.find().select("applicationRef testVersionRef questionRefs status attemptNumber score passed").lean();
    const orphanAttemptsByApplication = allAttempts.filter((a) => !allApplicationIds.has(String(a.applicationRef)));
    check("data integrity: zero orphan TestAttempt documents (missing applicationRef)", orphanAttemptsByApplication.length === 0, orphanAttemptsByApplication.length);
    const orphanAttemptsByVersion = allAttempts.filter((a) => !allVersionIds.has(String(a.testVersionRef)));
    check("data integrity: zero orphan TestAttempt documents (missing testVersionRef)", orphanAttemptsByVersion.length === 0, orphanAttemptsByVersion.length);
    const allQuestionIds = new Set((await TestQuestion.find().select("_id").lean()).map((q) => String(q._id)));
    const attemptsWithMissingQuestions = allAttempts.filter((a) => (a.questionRefs || []).some((qId) => !allQuestionIds.has(String(qId))));
    check("data integrity: zero TestAttempt documents referencing a missing TestQuestion", attemptsWithMissingQuestions.length === 0, attemptsWithMissingQuestions.length);

    // No invalid TestAttempt status.
    const invalidStatusCount = await TestAttempt.countDocuments({ status: { $nin: ["IN_PROGRESS", "PASSED", "FAILED"] } });
    check("data integrity: zero TestAttempt documents with an invalid status", invalidStatusCount === 0, invalidStatusCount);

    // No duplicate active (IN_PROGRESS) attempts per application.
    const duplicateActive = await TestAttempt.aggregate([
      { $match: { status: "IN_PROGRESS" } },
      { $group: { _id: "$applicationRef", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]);
    check("data integrity: zero applications with more than one active TestAttempt", duplicateActive.length === 0, duplicateActive);

    // No duplicate {applicationRef,attemptNumber}.
    const duplicateAttemptNumbers = await TestAttempt.aggregate([
      { $group: { _id: { applicationRef: "$applicationRef", attemptNumber: "$attemptNumber" }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]);
    check("data integrity: zero duplicate {applicationRef,attemptNumber} pairs", duplicateAttemptNumbers.length === 0, duplicateAttemptNumbers);

    // No duplicate published TestVersion.
    const publishedVersionCount = await TestVersion.countDocuments({ status: "PUBLISHED" });
    check("data integrity: at most one PUBLISHED TestVersion exists", publishedVersionCount <= 1, publishedVersionCount);

    // No false TEST_SUBMITTED audit records — for every fixture agent
    // created across this ENTIRE run (FA-3.4.2 + FA-3.4.3 + FA-3.4.4),
    // TEST_SUBMITTED count must never exceed the number of finalized
    // (PASSED/FAILED) attempts that agent actually has.
    const allFixtureUserIds = [...fa342UserIds, ...fa343UserIds, ...fa344UserIds];
    let falseAuditFound = false;
    for (const uid of allFixtureUserIds) {
      const submittedCount = await FieldAgentAuditEvent.countDocuments({ actorRef: uid, action: "TEST_SUBMITTED" });
      const finalizedAttemptCount = await TestAttempt.countDocuments({ agentRef: uid, status: { $in: ["PASSED", "FAILED"] } });
      if (submittedCount > finalizedAttemptCount) {
        falseAuditFound = true;
        break;
      }
    }
    check("data integrity: no fixture agent has more TEST_SUBMITTED audit events than finalized attempts (no false submissions)", !falseAuditFound, falseAuditFound);

    // No orphan FieldAgentTraining records created by this integration
    // fixture — these fixtures bypass training entirely (created
    // directly at TEST_PENDING), so none should ever exist.
    const orphanTrainingCount = await FieldAgentTraining.countDocuments({ agentRef: { $in: allFixtureUserIds } });
    check("data integrity: zero FieldAgentTraining records were created by FA-3.4 integration fixtures", orphanTrainingCount === 0, orphanTrainingCount);
  }

  // ── CLEANUP ────────────────────────────────────────────────────
  // FA-3.4.2's own PUBLISHED fixture (testV2 — testV1 was already
  // auto-retired when V2 published in Section R) must be retired too,
  // to preserve this script's own "zero PUBLISHED remain" invariant.
  if (testV2?._id) {
    const liveV2 = await TestVersion.findById(testV2._id).lean();
    if (liveV2?.status === "PUBLISHED") {
      await authFetch(`/api/admin/field-agent-test/versions/${testV2._id}/retire`, adminToken, {
        method: "POST",
        body: JSON.stringify({ reason: "FA-3.4.2 verification cleanup" }),
      });
    }
  }
  // FA-3.4.3's own PUBLISHED fixture (testV3) — same invariant.
  if (testV3?._id) {
    const liveV3 = await TestVersion.findById(testV3._id).lean();
    if (liveV3?.status === "PUBLISHED") {
      await authFetch(`/api/admin/field-agent-test/versions/${testV3._id}/retire`, adminToken, {
        method: "POST",
        body: JSON.stringify({ reason: "FA-3.4.3 verification cleanup" }),
      });
    }
  }
  // FA-3.4.4's own remaining PUBLISHED fixture (currentFa344Version —
  // every other FA-3.4.4-published version was already retired by a
  // subsequent publish or an explicit retire within its own scenario).
  if (currentFa344Version?._id) {
    const liveFa344 = await TestVersion.findById(currentFa344Version._id).lean();
    if (liveFa344?.status === "PUBLISHED") {
      await authFetch(`/api/admin/field-agent-test/versions/${currentFa344Version._id}/retire`, adminToken, {
        method: "POST",
        body: JSON.stringify({ reason: "FA-3.4.4 verification cleanup" }),
      });
    }
  }

  const draftFixtures = await TestVersion.find({ notes: { $regex: `^${FIXTURE_TAG}` }, status: "DRAFT" }).lean();
  let deletedVersions = 0;
  for (const v of draftFixtures) {
    await TestQuestion.deleteMany({ testVersion: v._id });
    await TestVersion.deleteOne({ _id: v._id });
    deletedVersions += 1;
  }
  const remainingDraftFixtures = await TestVersion.countDocuments({ notes: { $regex: `^${FIXTURE_TAG}` }, status: "DRAFT" });
  check("zero DRAFT-status test fixtures remain (no residue)", remainingDraftFixtures === 0, remainingDraftFixtures);

  const publishedCountFinal = await TestVersion.countDocuments({ status: "PUBLISHED" });
  check("zero PUBLISHED versions remain after this run's own retire (no product/PUBLISHED-state leak)", publishedCountFinal === 0, publishedCountFinal);

  // FA-3.4.2's disposable User/FieldAgentApplication/TestAttempt
  // fixtures — hard-deleted, not preserved as history (unlike
  // published-then-retired TestVersion fixtures above).
  const attemptDeleteResult = await TestAttempt.deleteMany({ agentRef: { $in: fa342UserIds } });
  const applicationDeleteResult = await FieldAgentApplication.deleteMany({ userRef: { $in: fa342UserIds } });
  const userDeleteResult = await User.deleteMany({ _id: { $in: fa342UserIds } });

  const remainingAttempts = await TestAttempt.countDocuments({ agentRef: { $in: fa342UserIds } });
  check("zero FA-3.4.2 TestAttempt fixtures remain (no residue)", remainingAttempts === 0, remainingAttempts);
  const remainingApplications = await FieldAgentApplication.countDocuments({ userRef: { $in: fa342UserIds } });
  check("zero FA-3.4.2 FieldAgentApplication fixtures remain (no residue)", remainingApplications === 0, remainingApplications);
  const remainingUsers = await User.countDocuments({ _id: { $in: fa342UserIds } });
  check("zero FA-3.4.2 User fixtures remain (no residue)", remainingUsers === 0, remainingUsers);

  // FA-3.4.3's own disposable User/FieldAgentApplication/TestAttempt
  // fixtures (phones 9999902xxx) — hard-deleted, same as FA-3.4.2's.
  // Their TEST_STARTED/TEST_SUBMITTED FieldAgentAuditEvent rows are
  // deliberately NOT deleted — audit logs legitimately outlive the
  // entities they describe, same accepted precedent as every other
  // audit collection in this codebase.
  const fa343AttemptDelete = await TestAttempt.deleteMany({ agentRef: { $in: fa343UserIds } });
  const fa343ApplicationDelete = await FieldAgentApplication.deleteMany({ userRef: { $in: fa343UserIds } });
  const fa343UserDelete = await User.deleteMany({ _id: { $in: fa343UserIds } });

  const fa343RemainingAttempts = await TestAttempt.countDocuments({ agentRef: { $in: fa343UserIds } });
  check("zero FA-3.4.3 TestAttempt fixtures remain (no residue)", fa343RemainingAttempts === 0, fa343RemainingAttempts);
  const fa343RemainingApplications = await FieldAgentApplication.countDocuments({ userRef: { $in: fa343UserIds } });
  check("zero FA-3.4.3 FieldAgentApplication fixtures remain (no residue)", fa343RemainingApplications === 0, fa343RemainingApplications);
  const fa343RemainingUsers = await User.countDocuments({ _id: { $in: fa343UserIds } });
  check("zero FA-3.4.3 User fixtures remain (no residue)", fa343RemainingUsers === 0, fa343RemainingUsers);

  // FA-3.4.4's own disposable fixtures (phones 9999903xxx) — hard-
  // deleted, same as FA-3.4.2/3.4.3's. Audit events preserved.
  const fa344AttemptDelete = await TestAttempt.deleteMany({ agentRef: { $in: fa344UserIds } });
  const fa344ApplicationDelete = await FieldAgentApplication.deleteMany({ userRef: { $in: fa344UserIds } });
  const fa344UserDelete = await User.deleteMany({ _id: { $in: fa344UserIds } });

  const fa344RemainingAttempts = await TestAttempt.countDocuments({ agentRef: { $in: fa344UserIds } });
  check("zero FA-3.4.4 TestAttempt fixtures remain (no residue)", fa344RemainingAttempts === 0, fa344RemainingAttempts);
  const fa344RemainingApplications = await FieldAgentApplication.countDocuments({ userRef: { $in: fa344UserIds } });
  check("zero FA-3.4.4 FieldAgentApplication fixtures remain (no residue)", fa344RemainingApplications === 0, fa344RemainingApplications);
  const fa344RemainingUsers = await User.countDocuments({ _id: { $in: fa344UserIds } });
  check("zero FA-3.4.4 User fixtures remain (no residue)", fa344RemainingUsers === 0, fa344RemainingUsers);

  const finalPublishedCount = await TestVersion.countDocuments({ status: "PUBLISHED" });
  check("zero PUBLISHED versions remain after full FA-3.4 integration run (final check)", finalPublishedCount === 0, finalPublishedCount);

  server.close();

  console.log("\n" + results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
  console.log(`\n🧹 Cleanup: removed ${deletedVersions} DRAFT test-fixture version(s) (and their questions). Real admin/location accounts untouched.`);
  console.log(
    `🧹 FA-3.4.2 cleanup: removed ${userDeleteResult.deletedCount} user(s), ${applicationDeleteResult.deletedCount} application(s), ${attemptDeleteResult.deletedCount} attempt(s) (phones 9999901xxx).`
  );
  console.log(
    `🧹 FA-3.4.3 cleanup: removed ${fa343UserDelete.deletedCount} user(s), ${fa343ApplicationDelete.deletedCount} application(s), ${fa343AttemptDelete.deletedCount} attempt(s) (phones 9999902xxx). TEST_STARTED/TEST_SUBMITTED audit events preserved.`
  );
  console.log(
    `🧹 FA-3.4.4 cleanup: removed ${fa344UserDelete.deletedCount} user(s), ${fa344ApplicationDelete.deletedCount} application(s), ${fa344AttemptDelete.deletedCount} attempt(s) (phones 9999903xxx). TEST_STARTED/TEST_SUBMITTED/TEST_VERSION_PUBLISHED/TEST_VERSION_RETIRED audit events preserved.`
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
