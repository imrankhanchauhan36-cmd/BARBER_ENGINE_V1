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
import FieldAgentTraining from "../modules/fieldAgentTraining/models/FieldAgentTraining.js";
import TrainingAuditEvent from "../modules/fieldAgentTraining/models/TrainingAuditEvent.js";
import FieldAgentApplication from "../modules/fieldAgent/models/FieldAgentApplication.js";
import { generateAccessToken } from "../services/token.service.js";
import { createDraftVersion, addModule, addContent, updateContent, publishVersion, retireVersion } from "../modules/fieldAgentTraining/services/trainingContent.service.js";
import { uploadTrainingMedia } from "../modules/fieldAgentTraining/services/mediaDelivery.service.js";
import { MODULE_KEY, MODULE_KEY_ORDER, MAX_LIST_LIMIT } from "../modules/fieldAgentTraining/constants/fieldAgentTraining.constants.js";
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

  // ── FA-3.3.2.4 — ADMIN QUERY SAFETY ─────────────────────────────
  {
    const overLimitProgress = await authFetch(`/api/admin/field-agent-training/progress?limit=999999999`, adminToken);
    check("/progress?limit=999999999 -> 400", overLimitProgress.status === 400, overLimitProgress.status);

    const overLimitAudit = await authFetch(`/api/admin/field-agent-training/audit?limit=999999999`, adminToken);
    check("/audit?limit=999999999 -> 400", overLimitAudit.status === 400, overLimitAudit.status);

    const atMaxProgress = await authFetch(`/api/admin/field-agent-training/progress?limit=${MAX_LIST_LIMIT}`, adminToken);
    const atMaxProgressJson = await atMaxProgress.json();
    check(
      `/progress?limit=${MAX_LIST_LIMIT} succeeds, <= ${MAX_LIST_LIMIT} rows`,
      atMaxProgress.status === 200 && (atMaxProgressJson?.data?.progress?.length ?? 0) <= MAX_LIST_LIMIT,
      `status=${atMaxProgress.status} rows=${atMaxProgressJson?.data?.progress?.length}`
    );

    const versionsPage1 = await authFetch(`/api/admin/field-agent-training/versions?limit=1&page=1`, adminToken);
    const versionsPage1Json = await versionsPage1.json();
    const versionsPage2 = await authFetch(`/api/admin/field-agent-training/versions?limit=1&page=2`, adminToken);
    const versionsPage2Json = await versionsPage2.json();
    const v1 = versionsPage1Json?.data?.versions?.[0];
    const v2 = versionsPage2Json?.data?.versions?.[0];
    check(
      "/versions?limit=1&page=2 returns a correct, different second page",
      versionsPage2.status === 200 && !!v1 && !!v2 && String(v1._id) !== String(v2._id) && v1.versionNumber > v2.versionNumber,
      `page1=${v1?.versionNumber} page2=${v2?.versionNumber}`
    );

    const invalidPage = await authFetch(`/api/admin/field-agent-training/progress?page=0`, adminToken);
    check("/progress?page=0 -> 400 (non-positive page rejected)", invalidPage.status === 400, invalidPage.status);

    const invalidLimit = await authFetch(`/api/admin/field-agent-training/audit?limit=0`, adminToken);
    check("/audit?limit=0 -> 400 (non-positive limit rejected)", invalidLimit.status === 400, invalidLimit.status);

    const invalidLimitType = await authFetch(`/api/admin/field-agent-training/versions?limit=notanumber`, adminToken);
    check("/versions?limit=notanumber -> 400 (non-numeric limit rejected)", invalidLimitType.status === 400, invalidLimitType.status);

    // Live MongoDB explain() — confirms the two new indexes are
    // actually used for the exact unfiltered-sort query shapes these
    // endpoints run, not merely that the index exists in isolation.
    const explainStages = (winningPlan) => {
      const stages = [];
      const walk = (node) => {
        if (!node) return;
        if (node.stage) stages.push(node.stage);
        if (node.inputStage) walk(node.inputStage);
        if (Array.isArray(node.inputStages)) node.inputStages.forEach(walk);
      };
      walk(winningPlan);
      return stages;
    };

    const progressExplain = await FieldAgentTraining.find().sort({ updatedAt: -1 }).limit(20).explain("executionStats");
    const progressStages = explainStages(progressExplain.queryPlanner.winningPlan);
    check(
      "listAgentProgress query plan uses IXSCAN on {updatedAt:-1}, not COLLSCAN",
      progressStages.includes("IXSCAN") && !progressStages.includes("COLLSCAN"),
      JSON.stringify(progressStages)
    );

    const auditExplain = await TrainingAuditEvent.find({}).sort({ createdAt: -1 }).limit(50).explain("executionStats");
    const auditStages = explainStages(auditExplain.queryPlanner.winningPlan);
    check(
      "listAuditEvents (unfiltered) query plan uses IXSCAN on {createdAt:-1}, not COLLSCAN",
      auditStages.includes("IXSCAN") && !auditStages.includes("COLLSCAN"),
      JSON.stringify(auditStages)
    );

    // Direct index-existence confirmation (not just schema definition).
    const faTrainingIndexes = await FieldAgentTraining.collection.indexes();
    check(
      "MongoDB: FieldAgentTraining has {updatedAt:-1} index",
      faTrainingIndexes.some((i) => i.name === "updatedAt_-1"),
      JSON.stringify(faTrainingIndexes.map((i) => i.name))
    );
    const auditIndexes = await TrainingAuditEvent.collection.indexes();
    check(
      "MongoDB: TrainingAuditEvent has {createdAt:-1} index",
      auditIndexes.some((i) => i.name === "createdAt_-1"),
      JSON.stringify(auditIndexes.map((i) => i.name))
    );
  }

  // ── FA-3.3.2.3 — MEDIA LIFECYCLE + CLEANUP ──────────────────────
  {
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    );
    const uploadMedia = (contentId, filename = "test.png") => {
      const form = new FormData();
      form.append("media", new Blob([tinyPng], { type: "image/png" }), filename);
      return fetch(url(`/api/admin/field-agent-training/content/${contentId}/media`), {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
        body: form,
      });
    };
    const latestAudit = (entityId) =>
      TrainingAuditEvent.findOne({ entityType: "TRAINING_CONTENT", entityId, action: "CONTENT_UPDATED" }).sort({ createdAt: -1 }).lean();

    const draft = await createTaggedDraft("media lifecycle");
    const { module: mod } = await addTaggedModule(draft._id, MODULE_KEY.FOUNDATION);

    const addLesson = async (title) => {
      const res = await authFetch(`/api/admin/field-agent-training/modules/${mod._id}/content`, adminToken, {
        method: "POST",
        body: JSON.stringify({ contentType: "LESSON", translations: [{ languageCode: "en", title, body: title, approved: true }] }),
      });
      return (await res.json())?.data?.content;
    };
    const lesson1 = await addLesson("L1");
    const lesson2 = await addLesson("L2");

    // ── Correction 2: generic PATCH with media -> 400, unrelated PATCH still works ──
    const patchWithMedia = await authFetch(`/api/admin/field-agent-training/content/${lesson1._id}`, adminToken, {
      method: "PATCH",
      body: JSON.stringify({ media: { publicId: "x", resourceType: "video" } }),
    });
    check("generic PATCH with media field -> 400", patchWithMedia.status === 400, patchWithMedia.status);

    const patchNoMedia = await authFetch(`/api/admin/field-agent-training/content/${lesson1._id}`, adminToken, {
      method: "PATCH",
      body: JSON.stringify({ translations: [{ languageCode: "en", title: "L1 updated", body: "L1 updated", approved: true }] }),
    });
    check("generic PATCH without media still succeeds", patchNoMedia.status === 200, patchNoMedia.status);

    // ── upload (setContentMedia choke point) + replace + cleanup success ──
    const upload1 = await uploadMedia(lesson1._id, "first.png");
    const upload1Json = await upload1.json();
    const firstPublicId = upload1Json?.data?.content?.media?.publicId;
    check("media upload via dedicated endpoint succeeds", upload1.status === 200 && !!firstPublicId, JSON.stringify(upload1Json).slice(0, 200));

    const replace1 = await uploadMedia(lesson1._id, "second.png");
    const replace1Json = await replace1.json();
    check(
      "media replace succeeds with a genuinely new publicId",
      replace1.status === 200 && replace1Json?.data?.content?.media?.publicId !== firstPublicId
    );
    const auditAfterReplace = await latestAudit(lesson1._id);
    check(
      "replace: superseded asset cleanup audited as success (real Cloudinary destroy)",
      auditAfterReplace?.newValue?.cloudinaryCleanup?.status === "success",
      JSON.stringify(auditAfterReplace?.newValue?.cloudinaryCleanup)
    );

    // ── removal ──
    const remove1 = await authFetch(`/api/admin/field-agent-training/content/${lesson1._id}/media`, adminToken, { method: "DELETE" });
    const remove1Json = await remove1.json();
    check(
      "media removal via DELETE succeeds, publicId cleared",
      remove1.status === 200 && remove1Json?.data?.content?.media?.publicId == null,
      remove1.status
    );
    const auditAfterRemove = await latestAudit(lesson1._id);
    check(
      "removal: cleanup audited as success (real Cloudinary destroy)",
      auditAfterRemove?.newValue?.cloudinaryCleanup?.status === "success",
      JSON.stringify(auditAfterRemove?.newValue?.cloudinaryCleanup)
    );

    // ── Correction 1: shared publicId -> destroy skipped, not attempted ──
    // Real uploads always get a fresh, unique publicId, so a shared
    // reference can only be constructed directly in the DB — this
    // reproduces the edge case the reference-check defends against
    // (defense-in-depth), which the real API surface cannot itself
    // produce once Correction 2 is in effect.
    const upload2 = await uploadMedia(lesson2._id, "shared.png");
    const upload2Json = await upload2.json();
    const sharedMedia = upload2Json?.data?.content?.media;
    check("second media upload succeeds (setup for shared-publicId test)", upload2.status === 200 && !!sharedMedia?.publicId);

    await TrainingContent.updateOne({ _id: lesson1._id }, { $set: { media: sharedMedia } });

    const removeShared = await authFetch(`/api/admin/field-agent-training/content/${lesson1._id}/media`, adminToken, { method: "DELETE" });
    check("removing shared-publicId media still succeeds (DB updated)", removeShared.status === 200, removeShared.status);

    const auditAfterSharedRemove = await latestAudit(lesson1._id);
    check(
      "shared publicId removal is SKIPPED (not destroyed), reason recorded",
      auditAfterSharedRemove?.newValue?.cloudinaryCleanup?.status === "skipped" && !!auditAfterSharedRemove?.newValue?.cloudinaryCleanup?.reason,
      JSON.stringify(auditAfterSharedRemove?.newValue?.cloudinaryCleanup)
    );

    const lesson2AfterSkip = await TrainingContent.findById(lesson2._id).lean();
    check(
      "the OTHER content item's shared asset survives untouched",
      lesson2AfterSkip.media?.publicId === sharedMedia.publicId
    );

    // ── real Cloudinary cleanup failure (genuine API error, not mocked) ──
    // Empirically confirmed before writing this test: Cloudinary's
    // destroy API treats an already-nonexistent publicId as a
    // successful no-op (NOT an error), but genuinely rejects an
    // invalid resource_type value with a real HTTP error. Corrupting
    // the stored resourceType directly in the DB (application code can
    // never produce this — mediaSchema's enum constrains it at every
    // real write path) is what makes the upcoming destroy call
    // genuinely fail, for real, against Cloudinary's real API.
    const upload3 = await uploadMedia(lesson2._id, "willbecorrupted.png");
    const upload3Json = await upload3.json();
    check("third media upload succeeds (setup for real-failure test)", upload3.status === 200);

    await TrainingContent.updateOne({ _id: lesson2._id }, { $set: { "media.resourceType": "not-a-real-type" } });

    const replaceTriggeringFailure = await uploadMedia(lesson2._id, "newmedia.png");
    const replaceFailureJson = await replaceTriggeringFailure.json();
    check(
      "request still succeeds even when the real Cloudinary cleanup call fails",
      replaceTriggeringFailure.status === 200,
      JSON.stringify(replaceFailureJson).slice(0, 200)
    );

    const lesson2AfterFailure = await TrainingContent.findById(lesson2._id).lean();
    check(
      "DB media field correctly updated to the NEW media despite the cleanup failure (MongoDB authoritative)",
      lesson2AfterFailure.media?.publicId === replaceFailureJson?.data?.content?.media?.publicId &&
        lesson2AfterFailure.media.publicId !== sharedMedia.publicId
    );

    const auditAfterFailure = await latestAudit(lesson2._id);
    check(
      "the real Cloudinary cleanup failure is recorded in the audit trail",
      auditAfterFailure?.newValue?.cloudinaryCleanup?.status === "failed" && !!auditAfterFailure?.newValue?.cloudinaryCleanup?.error,
      JSON.stringify(auditAfterFailure?.newValue?.cloudinaryCleanup)
    );

    // ── published content: media mutation rejected, nothing destroyed ──
    const publishedVersion = await TrainingVersion.findOne({ status: "PUBLISHED" }).lean();
    const publishedMediaContent = await TrainingContent.findOne({
      trainingVersion: publishedVersion._id,
      "media.publicId": { $ne: null },
    }).lean();
    const beforePublicId = publishedMediaContent?.media?.publicId;

    const removeOnPublished = await authFetch(`/api/admin/field-agent-training/content/${publishedMediaContent._id}/media`, adminToken, {
      method: "DELETE",
    });
    check("removing media from PUBLISHED content -> 409", removeOnPublished.status === 409, removeOnPublished.status);

    const uploadOnPublished = await uploadMedia(publishedMediaContent._id, "shouldfail.png");
    check("uploading media to PUBLISHED content -> 409", uploadOnPublished.status === 409, uploadOnPublished.status);

    const publishedMediaAfter = await TrainingContent.findById(publishedMediaContent._id).lean();
    check(
      "PUBLISHED content's original media publicId is completely untouched (assertDraft blocks before any Cloudinary call)",
      publishedMediaAfter.media?.publicId === beforePublicId,
      `before=${beforePublicId} after=${publishedMediaAfter.media?.publicId}`
    );
  }

  // ── FA-3.3.2.2 — DRAFT DISCARD + CONTENT REORDER ────────────────
  {
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    );
    const uploadMedia = (contentId, filename = "test.png") => {
      const form = new FormData();
      form.append("media", new Blob([tinyPng], { type: "image/png" }), filename);
      return fetch(url(`/api/admin/field-agent-training/content/${contentId}/media`), {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
        body: form,
      });
    };
    const addLessonTo = async (moduleId, title) => {
      const res = await authFetch(`/api/admin/field-agent-training/modules/${moduleId}/content`, adminToken, {
        method: "POST",
        body: JSON.stringify({ contentType: "LESSON", translations: [{ languageCode: "en", title, body: title, approved: true }] }),
      });
      return (await res.json())?.data?.content;
    };

    // ── discard: success path, real media cleanup ──
    const discardDraft = await createTaggedDraft("draft discard - success path");
    const { module: discardMod } = await addTaggedModule(discardDraft._id, MODULE_KEY.FOUNDATION);
    const discardLesson = await addLessonTo(discardMod._id, "to be discarded");
    const uploadForDiscard = await uploadMedia(discardLesson._id, "discard-me.png");
    const uploadForDiscardJson = await uploadForDiscard.json();
    const discardedPublicId = uploadForDiscardJson?.data?.content?.media?.publicId;
    check("media uploaded to draft-about-to-be-discarded", uploadForDiscard.status === 200 && !!discardedPublicId);

    const discardRes = await authFetch(`/api/admin/field-agent-training/versions/${discardDraft._id}`, adminToken, { method: "DELETE" });
    const discardJson = await discardRes.json();
    check("discarding a genuine DRAFT succeeds", discardRes.status === 200, JSON.stringify(discardJson).slice(0, 200));
    check(
      "discard cleanup: unreferenced media destroyed (real Cloudinary call)",
      discardJson?.data?.mediaCleanup?.some((m) => m.publicId === discardedPublicId && m.status === "success"),
      JSON.stringify(discardJson?.data?.mediaCleanup)
    );

    const versionGone = await TrainingVersion.findById(discardDraft._id).lean();
    const modulesGone = await TrainingModule.countDocuments({ trainingVersion: discardDraft._id });
    const contentGone = await TrainingContent.countDocuments({ trainingVersion: discardDraft._id });
    check("discarded version no longer exists", !versionGone);
    check("discard leaves zero orphan TrainingModule rows", modulesGone === 0, modulesGone);
    check("discard leaves zero orphan TrainingContent rows", contentGone === 0, contentGone);

    const discardAudit = await TrainingAuditEvent.findOne({ entityType: "TRAINING_VERSION", entityId: discardDraft._id, action: "VERSION_DISCARDED" }).lean();
    check(
      "VERSION_DISCARDED audit event recorded with module/content counts",
      discardAudit?.oldValue?.moduleCount === 1 && discardAudit?.oldValue?.contentCount === 1,
      JSON.stringify(discardAudit?.oldValue)
    );

    // ── discard idempotency: second call -> 404 ──
    const discardAgain = await authFetch(`/api/admin/field-agent-training/versions/${discardDraft._id}`, adminToken, { method: "DELETE" });
    check("re-discarding an already-discarded version -> 404 (idempotent-safe)", discardAgain.status === 404, discardAgain.status);

    // ── discard rejected on PUBLISHED / RETIRED ──
    const publishedVersionForDiscard = await TrainingVersion.findOne({ status: "PUBLISHED" }).lean();
    const discardPublished = await authFetch(`/api/admin/field-agent-training/versions/${publishedVersionForDiscard._id}`, adminToken, { method: "DELETE" });
    check("discarding a PUBLISHED version -> 409, nothing deleted", discardPublished.status === 409, discardPublished.status);
    const publishedStillThere = await TrainingVersion.findById(publishedVersionForDiscard._id).lean();
    check("PUBLISHED version still exists after rejected discard", !!publishedStillThere);

    const retiredVersionForDiscard = await TrainingVersion.findOne({ status: "RETIRED" }).lean();
    const discardRetired = await authFetch(`/api/admin/field-agent-training/versions/${retiredVersionForDiscard._id}`, adminToken, { method: "DELETE" });
    check("discarding a RETIRED version -> 409, nothing deleted", discardRetired.status === 409, discardRetired.status);
    const retiredStillThere = await TrainingVersion.findById(retiredVersionForDiscard._id).lean();
    check("RETIRED version still exists after rejected discard", !!retiredStillThere);

    // ── discard: shared publicId across two DRAFT versions -> cleanup skipped ──
    // (deferred from FA-3.3.2.3 pending discardDraftVersion's existence —
    // reuses the identical isPublicIdReferencedElsewhere machinery)
    const survivorDraft = await createTaggedDraft("discard shared-media survivor");
    const { module: survivorMod } = await addTaggedModule(survivorDraft._id, MODULE_KEY.FOUNDATION);
    const survivorLesson = await addLessonTo(survivorMod._id, "survivor");
    const survivorUpload = await uploadMedia(survivorLesson._id, "survivor.png");
    const survivorMedia = (await survivorUpload.json())?.data?.content?.media;
    check("survivor draft's media uploaded", survivorUpload.status === 200 && !!survivorMedia?.publicId);

    const sharedDraft = await createTaggedDraft("discard shared-media victim");
    const { module: sharedMod } = await addTaggedModule(sharedDraft._id, MODULE_KEY.FOUNDATION);
    const sharedLesson = await addLessonTo(sharedMod._id, "shares survivor's media");
    // Real uploads always get a unique publicId — this cross-version
    // share can only be constructed directly in the DB (see the same
    // rationale in the FA-3.3.2.3 section above).
    await TrainingContent.updateOne({ _id: sharedLesson._id }, { $set: { media: survivorMedia } });

    const discardShared = await authFetch(`/api/admin/field-agent-training/versions/${sharedDraft._id}`, adminToken, { method: "DELETE" });
    const discardSharedJson = await discardShared.json();
    check("discarding a version whose media is shared elsewhere still succeeds", discardShared.status === 200, discardShared.status);
    check(
      "shared media cleanup is SKIPPED during discard (not destroyed), reason recorded",
      discardSharedJson?.data?.mediaCleanup?.some((m) => m.publicId === survivorMedia.publicId && m.status === "skipped" && !!m.reason),
      JSON.stringify(discardSharedJson?.data?.mediaCleanup)
    );
    const survivorAfterDiscard = await TrainingContent.findById(survivorLesson._id).lean();
    check("the surviving draft's own media reference is untouched", survivorAfterDiscard.media?.publicId === survivorMedia.publicId);

    // clean up the survivor draft directly (not itself under test here)
    await TrainingContent.deleteMany({ trainingVersion: survivorDraft._id });
    await TrainingModule.deleteMany({ trainingVersion: survivorDraft._id });
    await TrainingVersion.deleteOne({ _id: survivorDraft._id });

    // ── reorder: the exact example from the approved plan ──
    // Before: A=0 B=1 C=2 D=3 — Move D to position 1 — After: A=0 D=1 B=2 C=3
    const reorderDraft = await createTaggedDraft("content reorder");
    const { module: reorderMod } = await addTaggedModule(reorderDraft._id, MODULE_KEY.FOUNDATION);
    const A = await addLessonTo(reorderMod._id, "A");
    const B = await addLessonTo(reorderMod._id, "B");
    const C = await addLessonTo(reorderMod._id, "C");
    const D = await addLessonTo(reorderMod._id, "D");

    const beforeReorder = await TrainingContent.find({ trainingModule: reorderMod._id }).sort({ order: 1 }).select("_id order").lean();
    check(
      "before reorder: A=0 B=1 C=2 D=3",
      beforeReorder.map((c) => String(c._id)).join(",") === [A._id, B._id, C._id, D._id].map(String).join(","),
      JSON.stringify(beforeReorder)
    );

    const reorderRes = await authFetch(`/api/admin/field-agent-training/modules/${reorderMod._id}/reorder-content`, adminToken, {
      method: "PATCH",
      body: JSON.stringify({ orderedContentIds: [A._id, D._id, B._id, C._id] }),
    });
    check("reorder request succeeds", reorderRes.status === 200, reorderRes.status);

    const afterReorder = await TrainingContent.find({ trainingModule: reorderMod._id }).select("_id order").lean();
    const orderById = Object.fromEntries(afterReorder.map((c) => [String(c._id), c.order]));
    check(
      "after reorder: A=0 D=1 B=2 C=3 — exact example from the approved plan",
      orderById[String(A._id)] === 0 && orderById[String(D._id)] === 1 && orderById[String(B._id)] === 2 && orderById[String(C._id)] === 3,
      JSON.stringify(orderById)
    );
    const orderValues = Object.values(orderById).sort((a, b) => a - b);
    check("reordered orders are contiguous 0..n-1 with no duplicates/gaps", JSON.stringify(orderValues) === JSON.stringify([0, 1, 2, 3]));

    const reorderAudit = await TrainingAuditEvent.findOne({ entityType: "TRAINING_MODULE", entityId: reorderMod._id, action: "MODULE_UPDATED" })
      .sort({ createdAt: -1 })
      .lean();
    check(
      "reorder is audited (MODULE_UPDATED, before/after content order)",
      !!reorderAudit?.newValue?.contentOrder,
      JSON.stringify(reorderAudit?.newValue)
    );

    // ── reorder rejected: mismatched id set ──
    const badReorder = await authFetch(`/api/admin/field-agent-training/modules/${reorderMod._id}/reorder-content`, adminToken, {
      method: "PATCH",
      body: JSON.stringify({ orderedContentIds: [A._id, B._id, C._id] }), // missing D
    });
    check("reorder with a missing id -> 400", badReorder.status === 400, badReorder.status);

    // ── reorder rejected on PUBLISHED content ──
    const publishedModule = await TrainingModule.findOne({ trainingVersion: publishedVersionForDiscard._id }).lean();
    const publishedModuleContentIds = (await TrainingContent.find({ trainingModule: publishedModule._id }).select("_id").lean()).map((c) => c._id);
    const reorderPublished = await authFetch(`/api/admin/field-agent-training/modules/${publishedModule._id}/reorder-content`, adminToken, {
      method: "PATCH",
      body: JSON.stringify({ orderedContentIds: publishedModuleContentIds.slice().reverse() }),
    });
    check("reordering PUBLISHED content -> 409", reorderPublished.status === 409, reorderPublished.status);

    // ── concurrent reorder: two overlapping requests never corrupt ordering ──
    const concurrentDraft = await createTaggedDraft("concurrent reorder");
    const { module: concurrentMod } = await addTaggedModule(concurrentDraft._id, MODULE_KEY.FOUNDATION);
    const cA = await addLessonTo(concurrentMod._id, "A");
    const cB = await addLessonTo(concurrentMod._id, "B");
    const cC = await addLessonTo(concurrentMod._id, "C");
    const cD = await addLessonTo(concurrentMod._id, "D");
    const ids = [cA._id, cB._id, cC._id, cD._id];

    const reorderCall = (orderedContentIds) =>
      authFetch(`/api/admin/field-agent-training/modules/${concurrentMod._id}/reorder-content`, adminToken, {
        method: "PATCH",
        body: JSON.stringify({ orderedContentIds }),
      });

    const [concurrent1, concurrent2] = await Promise.all([
      reorderCall([ids[3], ids[2], ids[1], ids[0]]),
      reorderCall([ids[1], ids[0], ids[3], ids[2]]),
    ]);
    check(
      "concurrent reorder: at least one request succeeds (the other may 409-retry-exhausted, never corrupts data)",
      concurrent1.status === 200 || concurrent2.status === 200,
      `${concurrent1.status} / ${concurrent2.status}`
    );

    const afterConcurrent = await TrainingContent.find({ trainingModule: concurrentMod._id }).select("order").lean();
    const concurrentOrders = afterConcurrent.map((c) => c.order).sort((a, b) => a - b);
    check(
      "after concurrent reorder, final DB state is a valid contiguous permutation (0,1,2,3 each exactly once)",
      JSON.stringify(concurrentOrders) === JSON.stringify([0, 1, 2, 3]),
      JSON.stringify(concurrentOrders)
    );
  }

  // ── FA-3.3.2.5 — VERSIONING EDGE CASES A-E ──────────────────────
  // Verification-only: no product code is modified by this section.
  // Whatever behavior is found (correct or not) is exactly what the
  // already-frozen fieldAgentTraining.service.js / trainingContent.
  // service.js produce today.
  {
    const buildFullCurriculumVersion = async (notes) => {
      const draft = await createDraftVersion({ adminId: admin._id, notes });
      let mediaContentId = null;
      for (const moduleDef of CURRICULUM) {
        const trainingModule = await addModule({
          versionId: draft._id,
          moduleKey: moduleDef.moduleKey,
          translations: moduleDef.title,
          adminId: admin._id,
        });
        for (const contentDef of moduleDef.content) {
          const content = await addContent({
            moduleId: trainingModule._id,
            contentType: contentDef.contentType,
            translations: contentDef.translations,
            grading: contentDef.grading ?? null,
            helpEligible: contentDef.helpEligible ?? contentDef.contentType === "LESSON",
            adminId: admin._id,
          });
          if (!mediaContentId && contentDef.contentType === "LESSON") {
            const tinyPng = Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
              "base64"
            );
            const { publicId, resourceType } = await uploadTrainingMedia({ buffer: tinyPng, mimetype: "image/png", contentId: content._id });
            await updateContent({ contentId: content._id, patch: { media: { publicId, resourceType } }, adminId: admin._id });
            mediaContentId = content._id;
          }
        }
      }
      return publishVersion({ versionId: draft._id, adminId: admin._id });
    };

    const upsertFieldAgent = async (phone, name) => {
      let u = await User.findOne({ phone }).select("+tokenVersion");
      if (!u) u = await User.create({ name, phone, role: "FIELD_AGENT", isActive: true });
      else {
        u.role = "FIELD_AGENT";
        u.isActive = true;
        await u.save();
      }
      return u;
    };
    const fieldAgentToken = (user) => generateAccessToken({ _id: user._id, role: "FIELD_AGENT", tokenVersion: user.tokenVersion ?? 0 });

    // Fresh fixtures every run — dedicated phone range, distinct from
    // FA-3.3.1's own (9999900002-05).
    const edgeCasePhones = ["9999900012", "9999900013", "9999900014"];
    const existingEdgeUsers = await User.find({ phone: { $in: edgeCasePhones } }).select("_id").lean();
    const existingEdgeIds = existingEdgeUsers.map((u) => u._id);
    await FieldAgentTraining.deleteMany({ agentRef: { $in: existingEdgeIds } });
    await FieldAgentApplication.deleteMany({ userRef: { $in: existingEdgeIds } });
    await User.deleteMany({ _id: { $in: existingEdgeIds } });

    // ── Case A: agent mid-training on V1, V2 published (auto-retires
    // V1) — agent must stay pinned to V1, never silently migrated. ──
    const agentA = await upsertFieldAgent("9999900012", "FA-3.3.2.5 Case A Agent");
    const vBeforeA = await buildFullCurriculumVersion(`${FIXTURE_TAG} — case A before (V1)`);
    await FieldAgentApplication.create({ userRef: agentA._id, phone: "9999900012", status: "TRAINING_PENDING", nonTerminal: true });
    const tokenA = fieldAgentToken(agentA);

    const overviewA1 = await authFetch("/api/field-agent/training/me", tokenA);
    const overviewA1Json = await overviewA1.json();
    check(
      "Case A: agent lazily enrolls, pinned to the currently published version (V1)",
      overviewA1.status === 200 && overviewA1Json?.data?.training?.trainingVersionNumber === vBeforeA.versionNumber,
      JSON.stringify(overviewA1Json?.data?.training?.trainingVersionNumber)
    );

    const vAfterA = await buildFullCurriculumVersion(`${FIXTURE_TAG} — case A after (V2)`);
    check("Case A setup: V2 published, auto-retiring V1", vAfterA.status === "PUBLISHED");
    const vBeforeARetired = await TrainingVersion.findById(vBeforeA._id).lean();
    check("Case A setup: V1 is now RETIRED", vBeforeARetired.status === "RETIRED");

    const overviewA2 = await authFetch("/api/field-agent/training/me", tokenA);
    const overviewA2Json = await overviewA2.json();
    check(
      "Case A: agent overview still resolves after V2 publishes (not locked out)",
      overviewA2.status === 200,
      JSON.stringify(overviewA2Json).slice(0, 200)
    );
    check(
      "Case A: agent remains pinned to V1 — NOT silently migrated to V2",
      overviewA2Json?.data?.training?.trainingVersionNumber === vBeforeA.versionNumber,
      `expected v${vBeforeA.versionNumber}, got v${overviewA2Json?.data?.training?.trainingVersionNumber}`
    );

    const enrollmentsA = await FieldAgentTraining.find({ agentRef: agentA._id }).lean();
    check("Case A: still exactly one FieldAgentTraining document (no duplicate/migration)", enrollmentsA.length === 1, enrollmentsA.length);
    check(
      "Case A: that one document's trainingVersion is still V1",
      enrollmentsA[0] && String(enrollmentsA[0].trainingVersion) === String(vBeforeA._id)
    );

    const moduleContentA = await authFetch(`/api/field-agent/training/modules/${MODULE_KEY.FOUNDATION}?lang=en`, tokenA);
    check(
      "Case A: agent can still read module content on their pinned V1 after V2 publishes",
      moduleContentA.status === 200,
      moduleContentA.status
    );

    // ── Case B: V1 retired directly (NO replacement published) while
    // an agent is mid-training on it — existing enrollment/content
    // must remain stable; no data corruption; no forced migration.
    const agentB = await upsertFieldAgent("9999900013", "FA-3.3.2.5 Case B Agent");
    const vBeforeB = await buildFullCurriculumVersion(`${FIXTURE_TAG} — case B before (V1)`);
    await FieldAgentApplication.create({ userRef: agentB._id, phone: "9999900013", status: "TRAINING_PENDING", nonTerminal: true });
    const tokenB = fieldAgentToken(agentB);

    const overviewB1 = await authFetch("/api/field-agent/training/me", tokenB);
    const overviewB1Json = await overviewB1.json();
    check(
      "Case B: agent lazily enrolls into the currently published version (V1)",
      overviewB1.status === 200 && overviewB1Json?.data?.training?.trainingVersionNumber === vBeforeB.versionNumber
    );

    await retireVersion({ versionId: vBeforeB._id, adminId: admin._id, reason: "FA-3.3.2.5 Case B — retire with no replacement published" });
    const noPublishedAfterB = await TrainingVersion.findOne({ status: "PUBLISHED" }).lean();
    check("Case B setup: zero published versions exist immediately after this retire", !noPublishedAfterB);

    // Core training functionality never calls getPublishedVersionOrThrow()
    // — it reads the agent's own pinned enrollment/content directly.
    const moduleContentB = await authFetch(`/api/field-agent/training/modules/${MODULE_KEY.FOUNDATION}?lang=en`, tokenB);
    check(
      "Case B: agent can still read their pinned module content after V1 is retired with no replacement",
      moduleContentB.status === 200,
      moduleContentB.status
    );

    const overviewB2 = await authFetch("/api/field-agent/training/me", tokenB);
    const overviewB2Json = await overviewB2.json();
    check(
      "Case B: agent overview (/me) still resolves after their version is retired with no replacement published",
      overviewB2.status === 200,
      `status=${overviewB2.status} body=${JSON.stringify(overviewB2Json).slice(0, 200)}`
    );

    check(
      "Case B: the returned /me payload's version number is still V1's (no forced migration)",
      overviewB2Json?.data?.training?.trainingVersionNumber === vBeforeB.versionNumber,
      `expected v${vBeforeB.versionNumber}, got v${overviewB2Json?.data?.training?.trainingVersionNumber}`
    );

    const enrollmentB = await FieldAgentTraining.findOne({ agentRef: agentB._id, isActive: true }).lean();
    check(
      "Case B: enrollment remains pinned to the (now retired) V1, completely untouched",
      enrollmentB && String(enrollmentB.trainingVersion) === String(vBeforeB._id)
    );

    const moduleForB = await TrainingModule.findOne({ trainingVersion: vBeforeB._id, moduleKey: MODULE_KEY.FOUNDATION }).lean();
    check("Case B: V1's own module/content documents are completely unchanged (still exist)", !!moduleForB);

    // ── Opposite case: NO active enrollment at all, and zero
    // published versions (same window Case B just created) — this
    // MUST still fail with the existing expected error. The fix only
    // removes an UNNECESSARY lookup for an already-active enrollment;
    // it must not weaken the genuinely-required lookup when a brand
    // new enrollment would need to be opened and there is nothing to
    // enroll into.
    const agentNoEnrollment = await upsertFieldAgent("9999900014", "FA-3.3.2.5 No-Enrollment Agent");
    await FieldAgentApplication.create({ userRef: agentNoEnrollment._id, phone: "9999900014", status: "TRAINING_PENDING", nonTerminal: true });
    const tokenNoEnrollment = fieldAgentToken(agentNoEnrollment);
    const stillNoPublished = await TrainingVersion.findOne({ status: "PUBLISHED" }).lean();
    check("opposite-case setup: still zero published versions", !stillNoPublished);

    const overviewNoEnrollment = await authFetch("/api/field-agent/training/me", tokenNoEnrollment);
    const overviewNoEnrollmentJson = await overviewNoEnrollment.json();
    check(
      "opposite case: no active enrollment + zero published versions -> still fails with the existing expected error",
      overviewNoEnrollment.status === 404,
      `status=${overviewNoEnrollment.status} body=${JSON.stringify(overviewNoEnrollmentJson).slice(0, 200)}`
    );

    // ── Case C ── already exhaustively proven by the frozen
    // verifyFieldAgentTraining.js's own re-enrollment-lifecycle
    // regression (agent completes V1 -> V2 published -> agent becomes
    // eligible again -> new V2 enrollment -> V1 historical enrollment
    // intact) — mandated to run as part of this same regression pass
    // rather than re-implemented here, to avoid duplicating an entire
    // 10-module completion flow a second time for no new signal.
    results.push("ℹ️  Case C verified by verifyFieldAgentTraining.js's own re-enrollment-lifecycle regression (run as part of this same pass)");

    // Case B deliberately left zero published versions system-wide —
    // Cases D/E below need a real PUBLISHED (and a real RETIRED, from
    // Case B's own vBeforeB) version to test protection against.
    const vForCasesDE = await buildFullCurriculumVersion(`${FIXTURE_TAG} — cases D/E target`);
    check("setup for cases D/E: a version is published again", vForCasesDE.status === "PUBLISHED");

    // ── Case D: attempt to mutate a PUBLISHED version -> rejected. ──
    const currentPublished = await TrainingVersion.findOne({ status: "PUBLISHED" }).lean();
    const publishedModuleD = await TrainingModule.findOne({ trainingVersion: currentPublished._id }).lean();
    const mutateModuleD = await authFetch(`/api/admin/field-agent-training/modules/${publishedModuleD._id}`, adminToken, {
      method: "PATCH",
      body: JSON.stringify({ translations: [{ languageCode: "en", title: "should not apply", approved: true }] }),
    });
    check("Case D: mutating a PUBLISHED module -> 409", mutateModuleD.status === 409, mutateModuleD.status);

    const publishedContentD = await TrainingContent.findOne({ trainingVersion: currentPublished._id }).lean();
    const mutateContentD = await authFetch(`/api/admin/field-agent-training/content/${publishedContentD._id}`, adminToken, {
      method: "PATCH",
      body: JSON.stringify({ required: !publishedContentD.required }),
    });
    check("Case D: mutating PUBLISHED content -> 409", mutateContentD.status === 409, mutateContentD.status);

    // ── Case E: attempt to discard a PUBLISHED or RETIRED version -> rejected. ──
    const discardPublishedE = await authFetch(`/api/admin/field-agent-training/versions/${currentPublished._id}`, adminToken, { method: "DELETE" });
    check("Case E: discarding the PUBLISHED version -> 409", discardPublishedE.status === 409, discardPublishedE.status);
    const publishedStillThereE = await TrainingVersion.findById(currentPublished._id).lean();
    check("Case E: PUBLISHED version still exists after rejected discard", !!publishedStillThereE);

    const discardRetiredE = await authFetch(`/api/admin/field-agent-training/versions/${vBeforeB._id}`, adminToken, { method: "DELETE" });
    check("Case E: discarding a RETIRED version (V1 from case B) -> 409", discardRetiredE.status === 409, discardRetiredE.status);
    const retiredStillThereE = await TrainingVersion.findById(vBeforeB._id).lean();
    check("Case E: RETIRED version still exists after rejected discard", !!retiredStillThereE);

    // ── restore a real, media-bearing PUBLISHED curriculum — Case B
    // deliberately leaves zero published versions system-wide, which
    // must never be the state this script exits in.
    const restored = await buildFullCurriculumVersion("FA-3.3.1 v1 curriculum — restored after FA-3.3.2.5 verification");
    check("real curriculum restored as PUBLISHED after edge-case testing", restored.status === "PUBLISHED", restored.status);
    const restoredHasMedia = await TrainingContent.exists({ trainingVersion: restored._id, "media.publicId": { $ne: null } });
    check("restored curriculum carries media-bearing content", !!restoredHasMedia);

    // ── edge-case fixture cleanup (own phones, disjoint from FA-3.3.1's) ──
    const edgeUsers = await User.find({ phone: { $in: edgeCasePhones } }).select("_id").lean();
    const edgeIds = edgeUsers.map((u) => u._id);
    const edgeTrainingDeleted = await FieldAgentTraining.deleteMany({ agentRef: { $in: edgeIds } });
    const edgeAppDeleted = await FieldAgentApplication.deleteMany({ userRef: { $in: edgeIds } });
    const edgeUsersDeleted = await User.deleteMany({ _id: { $in: edgeIds } });
    console.log(
      `🧹 FA-3.3.2.5 edge-case fixture cleanup: removed ${edgeUsersDeleted.deletedCount} user(s), ` +
        `${edgeAppDeleted.deletedCount} FieldAgentApplication doc(s), ${edgeTrainingDeleted.deletedCount} FieldAgentTraining doc(s).`
    );
  }

  // ── FINAL FA-3.3.2 AUDIT — AUTHORIZATION BOUNDARY (previously
  // untested gap: STATE/DISTRICT admin write-rejection and
  // FIELD_AGENT-blocked-from-admin-routes had never been exercised
  // live in any prior subphase's suite). Verification-only — no
  // product code changed by this section.
  {
    // Must be a genuinely usable account — this location-hierarchy
    // seed pool includes some SUSPENDED/inactive scaffold admins
    // (unrelated to FA-3.3.2), and the frozen `protect` middleware
    // correctly rejects those before ever reaching this module's own
    // authorization check, which would otherwise be mistaken for an
    // authz defect here.
    const districtAdmin = await User.findOne({
      role: "ADMIN",
      adminLevel: { $in: ["STATE", "DISTRICT"] },
      isActive: true,
      accountStatus: "ACTIVE",
    })
      .select("+tokenVersion")
      .lean();
    check("a real STATE/DISTRICT admin fixture exists (pre-existing location-hierarchy data)", !!districtAdmin);
    const districtToken = generateAccessToken({
      _id: districtAdmin._id,
      role: "ADMIN",
      adminLevel: districtAdmin.adminLevel,
      tokenVersion: districtAdmin.tokenVersion ?? 0,
    });

    const districtRead = await authFetch("/api/admin/field-agent-training/versions", districtToken);
    check(`${districtAdmin.adminLevel} admin CAN read /versions (read-scope intact)`, districtRead.status === 200, districtRead.status);

    const districtCreateVersion = await authFetch("/api/admin/field-agent-training/versions", districtToken, {
      method: "POST",
      body: JSON.stringify({ notes: "should be rejected" }),
    });
    check(`${districtAdmin.adminLevel} admin CANNOT create a version (INDIA-only write) -> 403`, districtCreateVersion.status === 403, districtCreateVersion.status);

    const currentPublishedForAuthz = await TrainingVersion.findOne({ status: "PUBLISHED" }).lean();
    const districtPublish = await authFetch(`/api/admin/field-agent-training/versions/${currentPublishedForAuthz._id}/publish`, districtToken, { method: "POST" });
    check(`${districtAdmin.adminLevel} admin CANNOT publish -> 403`, districtPublish.status === 403, districtPublish.status);

    const districtDiscard = await authFetch(`/api/admin/field-agent-training/versions/${currentPublishedForAuthz._id}`, districtToken, { method: "DELETE" });
    check(`${districtAdmin.adminLevel} admin CANNOT discard -> 403`, districtDiscard.status === 403, districtDiscard.status);

    const districtModuleForReorder = await TrainingModule.findOne({ trainingVersion: currentPublishedForAuthz._id }).lean();
    const districtReorder = await authFetch(`/api/admin/field-agent-training/modules/${districtModuleForReorder._id}/reorder-content`, districtToken, {
      method: "PATCH",
      body: JSON.stringify({ orderedContentIds: [] }),
    });
    check(`${districtAdmin.adminLevel} admin CANNOT reorder content -> 403`, districtReorder.status === 403, districtReorder.status);

    const districtOverride = await authFetch("/api/admin/field-agent-training/progress/override", districtToken, {
      method: "POST",
      body: JSON.stringify({ agentUserId: admin._id, contentId: districtModuleForReorder._id, overrideClass: "RECOMMENDED", reason: "x" }),
    });
    check(`${districtAdmin.adminLevel} admin CANNOT apply a progress override (INDIA-only) -> 403`, districtOverride.status === 403, districtOverride.status);

    // ── FIELD_AGENT token must be blocked from the entire admin surface ──
    const audAgentPhone = "9999900015";
    let audAgent = await User.findOne({ phone: audAgentPhone }).select("+tokenVersion");
    if (!audAgent) audAgent = await User.create({ name: "FA-3.3.2 Final Audit Agent", phone: audAgentPhone, role: "FIELD_AGENT", isActive: true });
    const audAgentToken = generateAccessToken({ _id: audAgent._id, role: "FIELD_AGENT", tokenVersion: audAgent.tokenVersion ?? 0 });

    const agentReadVersions = await authFetch("/api/admin/field-agent-training/versions", audAgentToken);
    check("FIELD_AGENT token CANNOT read admin /versions -> 403", agentReadVersions.status === 403, agentReadVersions.status);

    const agentCreateVersion = await authFetch("/api/admin/field-agent-training/versions", audAgentToken, {
      method: "POST",
      body: JSON.stringify({ notes: "should be rejected" }),
    });
    check("FIELD_AGENT token CANNOT create a version -> 403", agentCreateVersion.status === 403, agentCreateVersion.status);

    const agentReadProgress = await authFetch("/api/admin/field-agent-training/progress", audAgentToken);
    check("FIELD_AGENT token CANNOT read admin /progress (another agent's data) -> 403", agentReadProgress.status === 403, agentReadProgress.status);

    const agentReadAudit = await authFetch("/api/admin/field-agent-training/audit", audAgentToken);
    check("FIELD_AGENT token CANNOT read admin /audit -> 403", agentReadAudit.status === 403, agentReadAudit.status);

    const agentUploadMedia = await fetch(url(`/api/admin/field-agent-training/content/${districtModuleForReorder._id}/media`), {
      method: "POST",
      headers: { Authorization: `Bearer ${audAgentToken}` },
    });
    check("FIELD_AGENT token CANNOT reach the admin media upload route -> 401/403", [401, 403].includes(agentUploadMedia.status), agentUploadMedia.status);

    // cleanup this section's own disposable fixture
    await User.deleteOne({ _id: audAgent._id });
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
