/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyFieldAgentTrainingAdmin.js
 *
 * FA-3.3.2 — LIVE, real-HTTP, real-DB verification for the admin
 * authoring/versioning hardening phase. Same precedent and style as
 * scripts/verifyFieldAgentTraining.js (FA-3.3.1) — real Express app,
 * real signed JWTs, real MongoDB, real Cloudinary where applicable —
 * this project has no test framework and none is fabricated here.
 *
 * This file grows across FA-3.3.2's five subphases (2.1, 2.4, 2.3,
 * 2.2, 2.5), each adding its own section, exactly mirroring how
 * FA-3.3.1's own verification script accumulated checks across its
 * build. verifyFieldAgentTraining.js itself is never modified — this
 * is a separate, additive script.
 *
 * All DRAFT versions this script creates for negative/positive
 * authoring tests are tagged via `notes` starting with
 * "FA-3.3.2 TEST FIXTURE" and are deleted directly (never published,
 * so no immutability rule is ever at risk) in the cleanup section at
 * the end — self-cleaning, zero residue, run repeatedly.
 *
 * Run (after FA-3.3.1's own fixtures/curriculum already exist):
 *   cd backend
 *   node scripts/verifyFieldAgentTrainingAdmin.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import TrainingVersion from "../modules/fieldAgentTraining/models/TrainingVersion.js";
import TrainingModule from "../modules/fieldAgentTraining/models/TrainingModule.js";
import TrainingContent from "../modules/fieldAgentTraining/models/TrainingContent.js";
import { generateAccessToken } from "../services/token.service.js";
import { createDraftVersion, addModule, addContent, updateContent, publishVersion } from "../modules/fieldAgentTraining/services/trainingContent.service.js";
import { uploadTrainingMedia } from "../modules/fieldAgentTraining/services/mediaDelivery.service.js";
import { MODULE_KEY, MODULE_KEY_ORDER } from "../modules/fieldAgentTraining/constants/fieldAgentTraining.constants.js";
import { CURRICULUM } from "./seedFieldAgentTrainingV1.js";

const FIXTURE_TAG = "FA-3.3.2 TEST FIXTURE";

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
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(opts.headers || {}),
      },
    });

  const admin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion");
  check("INDIA admin fixture exists (real, pre-existing account)", !!admin);
  const adminToken = generateAccessToken({ _id: admin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: admin.tokenVersion ?? 0 });

  const createTaggedDraft = async (notesSuffix) => {
    const res = await authFetch("/api/admin/field-agent-training/versions", adminToken, {
      method: "POST",
      body: JSON.stringify({ notes: `${FIXTURE_TAG} — ${notesSuffix}` }),
    });
    const json = await res.json();
    return json?.data?.version;
  };

  const addTaggedModule = async (versionId, moduleKey, titleEn = "Test Module") => {
    const res = await authFetch(`/api/admin/field-agent-training/versions/${versionId}/modules`, adminToken, {
      method: "POST",
      body: JSON.stringify({ moduleKey, translations: [{ languageCode: "en", title: titleEn, approved: true }] }),
    });
    const json = await res.json();
    return { res, module: json?.data?.module, json };
  };

  // ── FA-3.3.2.1 — GRADING RUBRIC VALIDATION (author-time) ────────
  {
    const draft = await createTaggedDraft("rubric validation");
    const { module: mod } = await addTaggedModule(draft._id, MODULE_KEY.FOUNDATION);

    const addKC = (body) =>
      authFetch(`/api/admin/field-agent-training/modules/${mod._id}/content`, adminToken, {
        method: "POST",
        body: JSON.stringify(body),
      });

    // SINGLE_CHOICE: correctOptionIndex out of bounds (options has 2 entries, index 5 requested)
    const badSingleChoice = await addKC({
      contentType: "KNOWLEDGE_CHECK",
      translations: [{ languageCode: "en", title: "Q", body: "Q?", options: ["A", "B"], approved: true }],
      grading: { type: "SINGLE_CHOICE", correctOptionIndex: 5 },
    });
    check("SINGLE_CHOICE correctOptionIndex out of bounds is rejected", badSingleChoice.status >= 400, badSingleChoice.status);

    // CHECKLIST: an out-of-bounds key
    const badChecklistBounds = await addKC({
      contentType: "PRACTICAL_SCENARIO",
      translations: [{ languageCode: "en", title: "S", body: "S?", options: ["A", "B"], approved: true }],
      grading: { type: "CHECKLIST", correctKeys: ["0", "99"] },
    });
    check("CHECKLIST out-of-bounds key is rejected", badChecklistBounds.status >= 400, badChecklistBounds.status);

    // CHECKLIST: a duplicate key
    const badChecklistDup = await addKC({
      contentType: "PRACTICAL_SCENARIO",
      translations: [{ languageCode: "en", title: "S", body: "S?", options: ["A", "B", "C"], approved: true }],
      grading: { type: "CHECKLIST", correctKeys: ["0", "0"] },
    });
    check("CHECKLIST duplicate key is rejected", badChecklistDup.status >= 400, badChecklistDup.status);

    // Valid SINGLE_CHOICE — must succeed
    const goodSingleChoice = await addKC({
      contentType: "KNOWLEDGE_CHECK",
      translations: [{ languageCode: "en", title: "Q", body: "Q?", options: ["A", "B"], approved: true }],
      grading: { type: "SINGLE_CHOICE", correctOptionIndex: 0 },
    });
    check("Valid SINGLE_CHOICE rubric is accepted", goodSingleChoice.status === 201, goodSingleChoice.status);

    // Valid CHECKLIST — must succeed
    const goodChecklist = await addKC({
      contentType: "PRACTICAL_SCENARIO",
      translations: [{ languageCode: "en", title: "S", body: "S?", options: ["A", "B", "C"], approved: true }],
      grading: { type: "CHECKLIST", correctKeys: ["0", "1"] },
    });
    check("Valid CHECKLIST rubric is accepted", goodChecklist.status === 201, goodChecklist.status);

    // passingScore bounds
    const badPassingScore = await addKC({
      contentType: "KNOWLEDGE_CHECK",
      translations: [{ languageCode: "en", title: "Q", body: "Q?", options: ["A", "B"], approved: true }],
      grading: { type: "SINGLE_CHOICE", correctOptionIndex: 0 },
      passingScore: 0,
    });
    check("passingScore: 0 is rejected", badPassingScore.status >= 400, badPassingScore.status);
  }

  // ── FA-3.3.2.1 — WATCH THRESHOLD / MEDIA-TYPE VALIDATION ────────
  {
    const draft = await createTaggedDraft("watch threshold validation");
    const { module: mod } = await addTaggedModule(draft._id, MODULE_KEY.FOUNDATION);

    const addLesson = (body) =>
      authFetch(`/api/admin/field-agent-training/modules/${mod._id}/content`, adminToken, {
        method: "POST",
        body: JSON.stringify({ contentType: "LESSON", translations: [{ languageCode: "en", title: "L", body: "L", approved: true }], ...body }),
      });

    const noMedia = await addLesson({ watchThresholdSeconds: 30 });
    check("positive watchThresholdSeconds with no media is rejected", noMedia.status >= 400, noMedia.status);

    const imageMedia = await addLesson({
      watchThresholdSeconds: 30,
      media: { publicId: "fake/test-image-id", resourceType: "image" },
    });
    check("positive watchThresholdSeconds with non-video media (image) is rejected", imageMedia.status >= 400, imageMedia.status);

    const videoMedia = await addLesson({
      watchThresholdSeconds: 30,
      media: { publicId: "fake/test-video-id", resourceType: "video" },
    });
    check("positive watchThresholdSeconds with video media is accepted", videoMedia.status === 201, videoMedia.status);

    const zeroThresholdNoMedia = await addLesson({ watchThresholdSeconds: 0 });
    check("watchThresholdSeconds: 0 with no media remains legal (unchanged behavior)", zeroThresholdNoMedia.status === 201, zeroThresholdNoMedia.status);

    const nullThresholdNoMedia = await addLesson({});
    check("watchThresholdSeconds unset (null) with no media remains legal (unchanged behavior)", nullThresholdNoMedia.status === 201, nullThresholdNoMedia.status);
  }

  // ── FA-3.3.2.1 — PUBLISH GATE: module translation completeness ──
  {
    const draft = await createTaggedDraft("missing module translation");
    for (const moduleKey of MODULE_KEY_ORDER) {
      if (moduleKey === MODULE_KEY_ORDER[MODULE_KEY_ORDER.length - 1]) {
        // Last module deliberately created with NO translations at all.
        await authFetch(`/api/admin/field-agent-training/versions/${draft._id}/modules`, adminToken, {
          method: "POST",
          body: JSON.stringify({ moduleKey, translations: [{ languageCode: "en", title: "placeholder", approved: false }] }),
        });
        continue;
      }
      const { module: mod } = await addTaggedModule(draft._id, moduleKey);
      await authFetch(`/api/admin/field-agent-training/modules/${mod._id}/content`, adminToken, {
        method: "POST",
        body: JSON.stringify({
          contentType: "LESSON",
          translations: [{ languageCode: "en", title: "L", body: "L", approved: true }],
        }),
      });
    }
    const publishRes = await authFetch(`/api/admin/field-agent-training/versions/${draft._id}/publish`, adminToken, { method: "POST" });
    check(
      "publish rejected when a mandatory module has no approved English translation",
      publishRes.status === 409,
      publishRes.status
    );
  }

  // ── FA-3.3.2.1 — Hindi optional at publish + Help-coverage advisory ──
  // Builds a full, genuinely valid 10-module draft (direct service
  // calls — HTTP plumbing for 10 modules × content would be pure
  // repetition of what's already proven above) with English-only
  // translations and zero helpEligible content, to prove BOTH: Hindi
  // absence never blocks publish, and Help-coverage is advisory only.
  {
    const draft = await createDraftVersion({ adminId: admin._id, notes: `${FIXTURE_TAG} — english-only, no help content` });
    for (const moduleDef of CURRICULUM) {
      const englishOnlyTitle = moduleDef.title.filter((t) => t.languageCode === "en");
      const trainingModule = await addModule({ versionId: draft._id, moduleKey: moduleDef.moduleKey, translations: englishOnlyTitle, adminId: admin._id });
      for (const contentDef of moduleDef.content) {
        const englishOnlyContent = contentDef.translations.filter((t) => t.languageCode === "en");
        await addContent({
          moduleId: trainingModule._id,
          contentType: contentDef.contentType,
          translations: englishOnlyContent,
          grading: contentDef.grading ?? null,
          helpEligible: false, // deliberately zero Help-eligible content anywhere
          adminId: admin._id,
        });
      }
    }

    const publishRes = await authFetch(`/api/admin/field-agent-training/versions/${draft._id}/publish`, adminToken, { method: "POST" });
    const publishJson = await publishRes.json();
    check("publish succeeds with zero Hindi translations anywhere", publishRes.status === 200, JSON.stringify(publishJson).slice(0, 300));
    check(
      "publish response carries a Help-coverage advisory warning (non-blocking)",
      Array.isArray(publishJson?.data?.warnings) && publishJson.data.warnings.length > 0,
      JSON.stringify(publishJson?.data?.warnings)
    );

    // This English-only version is now PUBLISHED (superseding whatever
    // was live) — restore the real, fully-translated curriculum as the
    // final published state before this script exits, so it never
    // leaves an English-only version live for any other consumer.
    const restoreDraft = await createDraftVersion({ adminId: admin._id, notes: "FA-3.3.1 v1 curriculum — restored after FA-3.3.2.1 verification" });
    let restoredMediaContentId = null;
    for (const moduleDef of CURRICULUM) {
      const trainingModule = await addModule({ versionId: restoreDraft._id, moduleKey: moduleDef.moduleKey, translations: moduleDef.title, adminId: admin._id });
      for (const contentDef of moduleDef.content) {
        const content = await addContent({
          moduleId: trainingModule._id,
          contentType: contentDef.contentType,
          translations: contentDef.translations,
          grading: contentDef.grading ?? null,
          helpEligible: contentDef.helpEligible ?? contentDef.contentType === "LESSON",
          adminId: admin._id,
        });
        // Mirrors seedFieldAgentTrainingV1.js's own pre-publish media
        // attachment — this restore MUST also carry real media, since
        // the frozen verifyFieldAgentTraining.js's own media test
        // depends on whatever version is CURRENTLY published having
        // media-bearing content (exactly the same lesson learned
        // during FA-3.3.1's own correction round).
        if (!restoredMediaContentId && contentDef.contentType === "LESSON") {
          const tinyPng = Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            "base64"
          );
          const { publicId, resourceType } = await uploadTrainingMedia({ buffer: tinyPng, mimetype: "image/png", contentId: content._id });
          await updateContent({ contentId: content._id, patch: { media: { publicId, resourceType } }, adminId: admin._id });
          restoredMediaContentId = content._id;
        }
      }
    }
    const restored = await publishVersion({ versionId: restoreDraft._id, adminId: admin._id });
    check("real curriculum restored as PUBLISHED after the English-only test", restored.status === "PUBLISHED", restored.status);
    check("restored curriculum carries media-bearing content", !!restoredMediaContentId);
  }

  // ── CLEANUP — remove every DRAFT test-fixture version tagged above ──
  // Only DRAFT-status tagged versions are deleted — this is a hard
  // safety guard, not a formality: one tagged fixture (the English-
  // only/Help-warning test) was DELIBERATELY published to prove its
  // assertions, then correctly auto-retired the moment the real
  // curriculum was restored afterward. That one is EXPECTED to remain
  // (RETIRED, permanent history — exactly like FA-3.3.1's own
  // regression-test versions that stay retired forever) and this loop
  // correctly refuses to delete it, since deleting ever-published data
  // is never permitted regardless of who published it or why.
  const taggedVersions = await TrainingVersion.find({ notes: { $regex: `^${FIXTURE_TAG}` } }).select("_id status versionNumber").lean();
  let deletedVersions = 0;
  let skippedNonDraft = 0;
  for (const v of taggedVersions) {
    if (v.status !== "DRAFT") {
      skippedNonDraft += 1;
      continue;
    }
    await TrainingContent.deleteMany({ trainingVersion: v._id });
    await TrainingModule.deleteMany({ trainingVersion: v._id });
    await TrainingVersion.deleteOne({ _id: v._id });
    deletedVersions += 1;
  }
  // >=1, not ===1: each run of this script legitimately publishes-
  // then-retires exactly one English-only fixture, and (matching
  // FA-3.3.1's own accepted precedent) retired history accumulates
  // permanently across repeated runs — that's expected, not residue.
  // What must be exactly zero is DRAFT-status leftovers, checked next.
  check(
    "at least this run's published-then-retired fixture survives (retired history is never deleted)",
    skippedNonDraft >= 1,
    `${skippedNonDraft} non-draft tagged version(s) found`
  );
  const remainingDraftFixtures = await TrainingVersion.countDocuments({ notes: { $regex: `^${FIXTURE_TAG}` }, status: "DRAFT" });
  check("zero DRAFT-status test fixtures remain (no residue)", remainingDraftFixtures === 0, remainingDraftFixtures);

  const currentlyPublished = await TrainingVersion.findOne({ status: "PUBLISHED" }).select("notes").lean();
  check(
    "the live PUBLISHED version is the real curriculum, not a leftover test fixture",
    !!currentlyPublished && !currentlyPublished.notes?.startsWith(FIXTURE_TAG),
    currentlyPublished?.notes
  );

  server.close();

  console.log("\n" + results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
  console.log(`\n🧹 Cleanup: removed ${deletedVersions} DRAFT test-fixture version(s) (and their modules/content). Real curriculum and admin account untouched.`);

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
