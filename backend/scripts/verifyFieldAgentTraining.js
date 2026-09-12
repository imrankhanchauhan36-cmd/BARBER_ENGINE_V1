/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyFieldAgentTraining.js
 *
 * FA-3.3.1 — LIVE, real-HTTP, real-DB verification script. This
 * project has no test framework installed (no jest/mocha, no `test`
 * script — confirmed by inspection before writing this). Prior phases
 * (e.g. scripts/seedSupportTestUsers.js's own header) establish the
 * same precedent this script follows: a standalone, manually-run
 * script against the real dev DB, not a fabricated test harness.
 *
 * Unlike a unit test, this starts the REAL Express app (import of
 * app.js — the same file server.js mounts, minus server.js's own
 * cron/socket wiring) on an ephemeral port and drives it with real
 * fetch() calls carrying real signed JWTs (via the same
 * services/token.service.js#generateAccessToken every real login
 * uses) — exercising the actual route → middleware → controller →
 * service → model stack exactly as production traffic would.
 *
 * Creates a small number of disposable FIELD_AGENT/USER fixture users
 * and FieldAgentApplication documents (phones 99999000xx), matching
 * seedSupportTestUsers.js's own precedent for dev-only fixtures in
 * this same database. Re-running this script resets its own fixtures
 * first, so it's safe to run repeatedly.
 *
 * Run (after scripts/seedFieldAgentTrainingV1.js has published v1):
 *   cd backend
 *   node scripts/verifyFieldAgentTraining.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import FieldAgentApplication from "../modules/fieldAgent/models/FieldAgentApplication.js";
import FieldAgentTraining from "../modules/fieldAgentTraining/models/FieldAgentTraining.js";
import TrainingVersion from "../modules/fieldAgentTraining/models/TrainingVersion.js";
import TrainingModule from "../modules/fieldAgentTraining/models/TrainingModule.js";
import TrainingContent from "../modules/fieldAgentTraining/models/TrainingContent.js";
import { generateAccessToken } from "../services/token.service.js";
import { MODULE_KEY_ORDER } from "../modules/fieldAgentTraining/constants/fieldAgentTraining.constants.js";
import { createDraftVersion, addModule, addContent, updateContent, publishVersion } from "../modules/fieldAgentTraining/services/trainingContent.service.js";
import { uploadTrainingMedia } from "../modules/fieldAgentTraining/services/mediaDelivery.service.js";
import { CURRICULUM } from "./seedFieldAgentTrainingV1.js";

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

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;

  const authFetch = (path, token, opts = {}) =>
    fetch(url(path), {
      ...opts,
      headers: {
        ...(opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`,
        ...(opts.headers || {}),
      },
    });

  // ── FIXTURES ───────────────────────────────────────────────────
  const upsertUser = async (phone, role, name) => {
    let u = await User.findOne({ phone }).select("+tokenVersion");
    if (!u) u = await User.create({ name, phone, role, isActive: true });
    else {
      u.role = role;
      u.isActive = true;
      await u.save();
    }
    return u;
  };

  const agent = await upsertUser("9999900002", "FIELD_AGENT", "FA-3.3 Verify Agent");
  const withdrawnAgent = await upsertUser("9999900003", "FIELD_AGENT", "FA-3.3 Verify Withdrawn Agent");
  const overrideAgent = await upsertUser("9999900004", "FIELD_AGENT", "FA-3.3 Verify Override Agent");
  const outsider = await upsertUser("9999900005", "USER", "FA-3.3 Verify Outsider");
  // tokenVersion is `select:false` on User — protect() compares the
  // token's tokenVersion against the LIVE document's, so it must be
  // read explicitly here rather than assumed to be 0 (a pre-existing
  // real admin fixture may already have a non-zero tokenVersion from
  // prior logins/resets).
  const admin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion");
  check("INDIA admin fixture exists (run seedFieldAgentTrainingV1.js first)", !!admin);

  const allTestAgentIds = [agent._id, withdrawnAgent._id, overrideAgent._id];
  await FieldAgentTraining.deleteMany({ agentRef: { $in: allTestAgentIds } });
  await FieldAgentApplication.deleteMany({ userRef: { $in: allTestAgentIds } });

  const application = await FieldAgentApplication.create({
    userRef: agent._id,
    phone: "9999900002",
    status: "TRAINING_PENDING",
    nonTerminal: true,
  });
  await FieldAgentApplication.create({
    userRef: withdrawnAgent._id,
    phone: "9999900003",
    status: "WITHDRAWN",
    nonTerminal: false,
    withdrawnAt: new Date(),
  });
  await FieldAgentApplication.create({
    userRef: overrideAgent._id,
    phone: "9999900004",
    status: "TRAINING_PENDING",
    nonTerminal: true,
  });

  const tok = (user, role, extra = {}) => generateAccessToken({ _id: user._id, role, tokenVersion: user.tokenVersion ?? 0, ...extra });
  const agentToken = tok(agent, "FIELD_AGENT");
  const withdrawnToken = tok(withdrawnAgent, "FIELD_AGENT");
  const overrideAgentToken = tok(overrideAgent, "FIELD_AGENT");
  const outsiderToken = tok(outsider, "USER");
  const adminToken = admin ? tok(admin, "ADMIN", { adminLevel: "INDIA" }) : null;

  // ── 1. AuthN/AuthZ ─────────────────────────────────────────────
  const noTokenRes = await fetch(url("/api/field-agent/training/me"));
  check("no token -> 401", noTokenRes.status === 401, noTokenRes.status);

  const wrongRoleRes = await authFetch("/api/field-agent/training/me", outsiderToken);
  check("wrong role (USER) -> 403", wrongRoleRes.status === 403, wrongRoleRes.status);

  const withdrawnRes = await authFetch("/api/field-agent/training/me", withdrawnToken);
  check("withdrawn application -> 403 (fails closed)", withdrawnRes.status === 403, withdrawnRes.status);

  // ── 2. Lazy enrollment + idempotency ───────────────────────────
  const overview1res = await authFetch("/api/field-agent/training/me", agentToken);
  const overview1 = await overview1res.json();
  check("first /me creates enrollment (200)", overview1res.status === 200, JSON.stringify(overview1));
  check("overview lists all 10 modules", overview1?.data?.training?.modules?.length === 10, overview1?.data?.training?.modules?.length);

  await authFetch("/api/field-agent/training/me", agentToken); // second call
  const enrollmentCount = await FieldAgentTraining.countDocuments({ agentRef: agent._id });
  check("repeat access creates no duplicate enrollment", enrollmentCount === 1, enrollmentCount);

  // ── 3. Language fallback + no grading leak ─────────────────────
  const hiRes = await authFetch("/api/field-agent/training/modules/FOUNDATION?lang=hi", agentToken);
  const hiJson = await hiRes.json();
  const hiText = JSON.stringify(hiJson);
  check("Hindi translation served for lang=hi", hiText.includes("ज़ेमिश परिचय"), "Hindi title missing");
  check(
    "agent-facing content never exposes grading/answer keys",
    !hiText.includes("correctOptionIndex") && !hiText.includes("correctKeys") && !hiText.includes('"grading"'),
    hiText.slice(0, 200)
  );

  // ── 4. Drive every module to completion ────────────────────────
  for (const moduleDef of CURRICULUM) {
    const res = await authFetch(`/api/field-agent/training/modules/${moduleDef.moduleKey}?lang=en`, agentToken);
    const body = await res.json();
    const items = body?.data?.items || [];
    check(`${moduleDef.moduleKey}: item count matches curriculum`, items.length === moduleDef.content.length, items.length);

    for (let i = 0; i < moduleDef.content.length; i++) {
      const def = moduleDef.content[i];
      const item = items[i];
      if (!item) continue;

      if (def.contentType === "LESSON") {
        const r = await authFetch(`/api/field-agent/training/content/${item.id}/lesson-progress`, agentToken, {
          method: "POST",
          body: JSON.stringify({ watchedSeconds: 0 }),
        });
        const j = await r.json();
        check(`${moduleDef.moduleKey}#${i} LESSON completes`, r.status === 200 && j?.data?.completed === true, JSON.stringify(j));
        continue;
      }

      const rubric = def.grading;
      const wrongSubmission =
        rubric.type === "SINGLE_CHOICE"
          ? { answerIndex: rubric.correctOptionIndex === 0 ? 1 : 0 }
          : { selectedKeys: ["999"] };
      const correctSubmission =
        rubric.type === "SINGLE_CHOICE" ? { answerIndex: rubric.correctOptionIndex } : { selectedKeys: rubric.correctKeys };

      const wrongRes = await authFetch(`/api/field-agent/training/content/${item.id}/submit`, agentToken, {
        method: "POST",
        body: JSON.stringify(wrongSubmission),
      });
      const wrongJson = await wrongRes.json();
      check(
        `${moduleDef.moduleKey}#${i} ${def.contentType} wrong submission does not pass`,
        wrongRes.status === 200 && wrongJson?.data?.passed === false,
        JSON.stringify(wrongJson)
      );

      const rightRes = await authFetch(`/api/field-agent/training/content/${item.id}/submit`, agentToken, {
        method: "POST",
        body: JSON.stringify(correctSubmission),
      });
      const rightJson = await rightRes.json();
      check(
        `${moduleDef.moduleKey}#${i} ${def.contentType} correct submission passes`,
        rightRes.status === 200 && rightJson?.data?.passed === true,
        JSON.stringify(rightJson)
      );
    }
  }

  // ── 5. Full completion -> atomic FA-2 handoff ──────────────────
  const finalApp = await FieldAgentApplication.findById(application._id);
  check("FA-2 application: TRAINING_PENDING -> TEST_PENDING", finalApp.status === "TEST_PENDING", finalApp.status);
  check("FA-2 application.nonTerminal remains true", finalApp.nonTerminal === true);
  check("FA-2 application.trainingRef linked (best-effort pointer)", !!finalApp.trainingRef);

  const finalEnrollment = await FieldAgentTraining.findOne({ agentRef: agent._id });
  check("FieldAgentTraining.status COMPLETED", finalEnrollment.status === "COMPLETED", finalEnrollment.status);
  check(
    "every module marked COMPLETED",
    finalEnrollment.moduleProgress.every((m) => m.status === "COMPLETED"),
    JSON.stringify(finalEnrollment.moduleProgress.filter((m) => m.status !== "COMPLETED"))
  );

  const postCompletionRes = await authFetch("/api/field-agent/training/me", agentToken);
  check("read-only access still works after completion", postCompletionRes.status === 200, postCompletionRes.status);

  // ── 6. Published-version immutability ──────────────────────────
  const versionDoc = await TrainingVersion.findOne({ status: "PUBLISHED" });
  const firstModule = await TrainingModule.findOne({ trainingVersion: versionDoc._id, moduleKey: MODULE_KEY_ORDER[0] });

  if (adminToken) {
    const immutableRes = await authFetch(`/api/admin/field-agent-training/modules/${firstModule._id}/content`, adminToken, {
      method: "POST",
      body: JSON.stringify({ contentType: "REFERENCE", translations: [{ languageCode: "en", title: "x", approved: true }] }),
    });
    check("cannot add content to a PUBLISHED version (409)", immutableRes.status === 409, immutableRes.status);

    // ── 7. Media immutability + signed delivery ─────────────────
    // Media can only be attached while a version is DRAFT (same
    // immutability rule as any other content field) — so seedFieldAgentTrainingV1.js
    // attaches a real sample image to FOUNDATION's first LESSON
    // BEFORE publishing v1. Here we confirm (a) uploading to that
    // same PUBLISHED content is correctly refused, and (b) the agent
    // can still fetch a real, freshly-signed Cloudinary URL for the
    // media that was legitimately attached pre-publish.
    try {
      const mediaContent = await TrainingContent.findOne({
        trainingVersion: versionDoc._id,
        "media.publicId": { $ne: null },
      });
      check(
        "currently-published version has pre-attached sample media",
        !!mediaContent,
        `published version ${versionDoc._id} has no media-bearing content`
      );
      if (!mediaContent) throw new Error("no media-bearing content on the published version — skipping media sub-checks");

      const tinyPng = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      );
      const form = new FormData();
      form.append("media", new Blob([tinyPng], { type: "image/png" }), "test.png");
      const uploadRes = await fetch(url(`/api/admin/field-agent-training/content/${mediaContent._id}/media`), {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
        body: form,
      });
      check(
        "cannot upload media to PUBLISHED content (409, immutable)",
        uploadRes.status === 409,
        uploadRes.status
      );

      const mediaRes = await authFetch(`/api/field-agent/training/content/${mediaContent._id}/media`, agentToken);
      const mediaJson = await mediaRes.json();
      check(
        "agent receives signed Cloudinary delivery URL",
        mediaRes.status === 200 && typeof mediaJson?.data?.url === "string" && mediaJson.data.url.includes("cloudinary.com"),
        JSON.stringify(mediaJson).slice(0, 300)
      );
      check(
        "delivery URL uses authenticated (non-public) resource type",
        (mediaJson?.data?.url || "").includes("/authenticated/"),
        mediaJson?.data?.url
      );
    } catch (err) {
      if (!/no media-bearing content/.test(err.message)) {
        check("media upload + signed delivery reachable (Cloudinary credentials)", false, err.message);
      }
    }

    // ── 8. Admin progress override — auditable, mandatory reason ──
    const overviewOverrideRes = await authFetch("/api/field-agent/training/me", overrideAgentToken);
    await overviewOverrideRes.json();
    const overrideModuleContentRes = await authFetch(
      `/api/field-agent/training/modules/${MODULE_KEY_ORDER[0]}?lang=en`,
      overrideAgentToken
    );
    const overrideModuleContent = await overrideModuleContentRes.json();
    const overrideTargetId = overrideModuleContent?.data?.items?.[0]?.id;

    const missingReasonRes = await authFetch("/api/admin/field-agent-training/progress/override", adminToken, {
      method: "POST",
      body: JSON.stringify({ agentUserId: overrideAgent._id, contentId: overrideTargetId, overrideClass: "RECOMMENDED" }),
    });
    check("override without reason is rejected (400)", missingReasonRes.status === 400, missingReasonRes.status);

    const overrideRes = await authFetch("/api/admin/field-agent-training/progress/override", adminToken, {
      method: "POST",
      body: JSON.stringify({
        agentUserId: overrideAgent._id,
        contentId: overrideTargetId,
        overrideClass: "REQUIRES_APPROVAL",
        reason: "FA-3.3.1 live verification — exercising the override path",
      }),
    });
    const overrideJson = await overrideRes.json();
    check("admin override applied", overrideRes.status === 200, JSON.stringify(overrideJson).slice(0, 300));

    const overrideAudit = await authFetch(
      `/api/admin/field-agent-training/audit?entityType=FIELD_AGENT_TRAINING`,
      adminToken
    );
    const overrideAuditJson = await overrideAudit.json();
    check(
      "override is recorded in TrainingAuditEvent with reason + class",
      overrideAuditJson?.data?.events?.some(
        (e) => e.action === "ADMIN_PROGRESS_OVERRIDE" && e.reason && e.newValue?.overrideClass === "REQUIRES_APPROVAL"
      )
    );

    // ── 9. Admin read endpoints ─────────────────────────────────
    const versionsRes = await authFetch("/api/admin/field-agent-training/versions", adminToken);
    check("admin can list training versions", versionsRes.status === 200, versionsRes.status);

    const progressRes = await authFetch("/api/admin/field-agent-training/progress", adminToken);
    check("admin can list agent progress", progressRes.status === 200, progressRes.status);
  } else {
    results.push("⚠️  Skipped immutability/media/override/admin-read checks — no INDIA admin fixture found");
  }

  // ── 10. Help scoping ────────────────────────────────────────────
  const helpRes = await authFetch("/api/field-agent/help?lang=en", agentToken);
  const helpJson = await helpRes.json();
  const helpText = JSON.stringify(helpJson);
  check("Help endpoint reachable", helpRes.status === 200, helpRes.status);
  check(
    "Help excludes non-launch-scope modules (e.g. FOUNDATION)",
    !(helpJson?.data?.modules || []).some((m) => m.moduleKey === "FOUNDATION")
  );
  check(
    "Help never leaks grading structure",
    !helpText.includes("correctOptionIndex") && !helpText.includes("correctKeys")
  );

  // ── 11. MongoDB indexes verified directly against the live DB ──
  // (not just the Mongoose schema definition — a schema change alone
  // does not retroactively fix/drop an already-existing wrong index).
  const rawIndexes = await FieldAgentTraining.collection.indexes();
  const activePartialUnique = rawIndexes.find(
    (i) => i.name === "agentRef_1" && i.unique === true && i.partialFilterExpression?.isActive === true
  );
  check(
    "MongoDB: partial-unique index on {agentRef} filtered to isActive:true exists",
    !!activePartialUnique,
    JSON.stringify(rawIndexes)
  );
  const blanketUnique = rawIndexes.find((i) => i.name === "agentRef_1" && i.unique === true && !i.partialFilterExpression);
  check("MongoDB: old blanket unique {agentRef} index (no partial filter) is gone", !blanketUnique);
  const compoundUnique = rawIndexes.find(
    (i) => i.name === "agentRef_1_trainingVersion_1" && i.unique === true && !i.partialFilterExpression
  );
  check("MongoDB: unique compound index on {agentRef,trainingVersion} exists", !!compoundUnique);

  // ── 12. Multi-version re-enrollment lifecycle ──────────────────
  // FA-2's current state machine has no route back to
  // TRAINING_PENDING once TEST_PENDING is reached (TEST_FAILED only
  // loops to TEST_PENDING) — so this exact sequence is dormant in
  // production today. It is still the TRAINING ENGINE's own
  // structural contract (approved architecture requirement) and must
  // hold regardless of which future phase opens that FA-2 route. The
  // application's status is written directly here only to SIMULATE
  // that future eligibility state for this test — no FA-2 file, and
  // no FA-2 transition helper, is touched or bypassed anywhere below;
  // every actual state change still goes through the real
  // getOrCreateEnrollment()/openNewEnrollment() engine code via the
  // real HTTP endpoint.
  if (adminToken) {
    try {
      const preEnrollment = await FieldAgentTraining.findOne({ agentRef: agent._id, isActive: true }).lean();
      check(
        "pre-check: agent has exactly one COMPLETED active enrollment before re-enrollment",
        preEnrollment?.status === "COMPLETED",
        JSON.stringify(preEnrollment)
      );

      const draft = await createDraftVersion({ adminId: admin._id, notes: "FA-3.3.1 regression — re-enrollment lifecycle" });
      let vNextMediaContentId = null;
      for (const moduleDef of CURRICULUM) {
        const tm = await addModule({
          versionId: draft._id,
          moduleKey: moduleDef.moduleKey,
          translations: moduleDef.title,
          adminId: admin._id,
        });
        for (const contentDef of moduleDef.content) {
          const created = await addContent({
            moduleId: tm._id,
            contentType: contentDef.contentType,
            translations: contentDef.translations,
            grading: contentDef.grading ?? null,
            helpEligible: contentDef.helpEligible ?? contentDef.contentType === "LESSON",
            adminId: admin._id,
          });
          // Mirrors seedFieldAgentTrainingV1.js's own pre-publish media
          // attachment — every version this project ever publishes
          // (seed OR regression) must carry real media, since step 7's
          // signed-delivery check targets whatever is CURRENTLY
          // published, and this regression block is itself what ends
          // up published by the time that check runs on a later run.
          if (!vNextMediaContentId && contentDef.contentType === "LESSON") {
            const tinyPng = Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
              "base64"
            );
            const { publicId, resourceType } = await uploadTrainingMedia({
              buffer: tinyPng,
              mimetype: "image/png",
              contentId: created._id,
            });
            await updateContent({ contentId: created._id, patch: { media: { publicId, resourceType } }, adminId: admin._id });
            vNextMediaContentId = created._id;
          }
        }
      }
      const vNext = await publishVersion({ versionId: draft._id, adminId: admin._id });
      check("vNext published (supersedes the previously PUBLISHED version)", vNext.status === "PUBLISHED", vNext.status);

      await FieldAgentApplication.updateOne(
        { _id: application._id },
        { $set: { status: "TRAINING_PENDING", nonTerminal: true } }
      );

      const reEnrollRes = await authFetch("/api/field-agent/training/me", agentToken);
      const reEnrollJson = await reEnrollRes.json();
      check("re-enrollment: /me succeeds and opens a new cycle", reEnrollRes.status === 200, JSON.stringify(reEnrollJson).slice(0, 200));
      check(
        "re-enrollment: new active enrollment is pinned to vNext",
        reEnrollJson?.data?.training?.trainingVersionNumber === vNext.versionNumber,
        reEnrollJson?.data?.training?.trainingVersionNumber
      );

      const allEnrollments = await FieldAgentTraining.find({ agentRef: agent._id }).sort({ createdAt: 1 }).lean();
      check("agent now has exactly 2 historical FieldAgentTraining documents", allEnrollments.length === 2, allEnrollments.length);

      const oldOne = allEnrollments.find((e) => String(e._id) === String(preEnrollment._id));
      check(
        "OLD completed enrollment preserved: still COMPLETED, now isActive:false",
        !!oldOne && oldOne.isActive === false && oldOne.status === "COMPLETED",
        JSON.stringify(oldOne)
      );
      check(
        "OLD enrollment's progress was never overwritten",
        JSON.stringify(oldOne?.moduleProgress) === JSON.stringify(preEnrollment.moduleProgress) &&
          JSON.stringify(oldOne?.contentProgress) === JSON.stringify(preEnrollment.contentProgress)
      );

      const newOne = allEnrollments.find((e) => String(e._id) !== String(preEnrollment._id));
      check(
        "NEW enrollment is active, pinned to vNext, separate record",
        !!newOne && newOne.isActive === true && String(newOne.trainingVersion) === String(vNext._id)
      );
      check("NEW enrollment starts IN_PROGRESS (not resumed from the old one)", newOne?.status === "IN_PROGRESS");

      // Duplicate-active prevention: hitting /me again must reuse the
      // SAME new active enrollment, never create a 3rd document.
      await authFetch("/api/field-agent/training/me", agentToken);
      const countAfterRepeat = await FieldAgentTraining.countDocuments({ agentRef: agent._id });
      check("repeat access after re-enrollment creates no 3rd document", countAfterRepeat === 2, countAfterRepeat);

      // Index-level proof (not just application-logic proof): a raw
      // insert attempting a 2nd simultaneous isActive:true document
      // for this agent must be rejected by MongoDB itself.
      let activeIndexRejected = false;
      try {
        await FieldAgentTraining.create({
          agentRef: agent._id,
          applicationRef: application._id,
          trainingVersion: vNext._id,
          isActive: true,
        });
      } catch (err) {
        activeIndexRejected = err.code === 11000;
      }
      check("MongoDB rejects a 2nd simultaneous active enrollment (raw insert)", activeIndexRejected);

      // Same {agent, version} pair can never be inserted twice either,
      // active or not — the compound unique index.
      let compoundIndexRejected = false;
      try {
        await FieldAgentTraining.create({
          agentRef: agent._id,
          applicationRef: application._id,
          trainingVersion: vNext._id,
          isActive: false,
        });
      } catch (err) {
        compoundIndexRejected = err.code === 11000;
      }
      check("MongoDB rejects a duplicate {agent,version} row (raw insert)", compoundIndexRejected);

      // Admin history endpoint must show BOTH cycles.
      const historyRes = await authFetch(`/api/admin/field-agent-training/progress/${agent._id}/history`, adminToken);
      const historyJson = await historyRes.json();
      check(
        "admin history endpoint lists both historical + active enrollments",
        historyJson?.data?.history?.length === 2,
        JSON.stringify(historyJson).slice(0, 200)
      );
    } catch (err) {
      check("re-enrollment lifecycle regression block completed without crashing", false, err.message);
    }
  } else {
    results.push("⚠️  Skipped re-enrollment lifecycle regression — no admin fixture");
  }

  // ── DONE ─────────────────────────────────────────────────────
  server.close();

  console.log("\n" + results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);

  // ── 13. Dev-fixture cleanup ─────────────────────────────────────
  // Runs BEFORE the DB connection closes below — every query here
  // needs a live connection.
  // Reported separately from pass/fail above — cleanup runs
  // regardless of test outcome so a failed run never leaves residue
  // either. Removes ONLY the disposable fixtures this script itself
  // created (phones 9999900002-9999900005): FIELD_AGENT/USER test
  // users and their FieldAgentApplication/FieldAgentTraining
  // documents. Deliberately does NOT delete any TrainingVersion/
  // TrainingModule/TrainingContent — that IS the real FA-3.3 v1
  // curriculum data this phase exists to produce, not verification
  // noise — and does NOT delete the admin account used throughout
  // (a real, pre-existing INDIA SUPER ADMIN, confirmed by direct
  // query before this script ran — not a fixture this script owns —
  // and it is now referenced as createdBy/publishedBy on that real
  // curriculum data, so removing it would orphan those references).
  const cleanupPhones = ["9999900002", "9999900003", "9999900004", "9999900005"];
  const cleanupUsers = await User.find({ phone: { $in: cleanupPhones } }).select("_id phone").lean();
  const cleanupUserIds = cleanupUsers.map((u) => u._id);
  const trainingDeleted = await FieldAgentTraining.deleteMany({ agentRef: { $in: cleanupUserIds } });
  const applicationDeleted = await FieldAgentApplication.deleteMany({ userRef: { $in: cleanupUserIds } });
  const usersDeleted = await User.deleteMany({ _id: { $in: cleanupUserIds } });
  console.log(
    `\n🧹 Dev-fixture cleanup: removed ${usersDeleted.deletedCount} test user(s), ` +
      `${applicationDeleted.deletedCount} FieldAgentApplication doc(s), ${trainingDeleted.deletedCount} FieldAgentTraining doc(s) ` +
      `(phones ${cleanupPhones.join(", ")}). Curriculum data (TrainingVersion/Module/Content) and the real admin account were left untouched.`
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
