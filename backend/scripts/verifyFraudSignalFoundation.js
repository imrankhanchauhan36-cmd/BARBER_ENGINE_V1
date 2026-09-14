/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyFraudSignalFoundation.js
 *
 * FA-7.1 — LIVE, real-MongoDB verification for the FraudSignal
 * foundation (model + immutability + indexes + recordSignal service).
 * No HTTP server is started — FA-7.1 has no route/controller of any
 * kind (foundation only, per the approved plan), so this suite talks
 * to the model/service directly against real MongoDB Atlas, no mocks.
 *
 * FraudSignal has zero dependency on FieldAgent/Salon/AcquisitionReferral/
 * AcquisitionClaim being real documents — subjectRef/fieldAgentRef/
 * sourceEventRef are bare ObjectIds by design (see the model's own
 * header), so every fixture here is a synthetic ObjectId, never a real
 * cross-collection document. This is itself a structural proof of the
 * "zero runtime dependency on frozen models" requirement.
 *
 * All fixtures use dedupeKey prefix "ZTEST_FA71_", hard-deleted in
 * cleanup by exact tracked _id only.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyFraudSignalFoundation.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import connectDB from "../config/db.js";
import FraudSignal from "../modules/fieldAgent/models/FraudSignal.js";
import { recordSignal, getSignalByDedupeKey } from "../modules/fieldAgent/services/fraudSignal.service.js";
import { SIGNAL_TYPE, SUBJECT_TYPE, SIGNAL_SEVERITY } from "../modules/fieldAgent/constants/fraudSignal.constants.js";

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

const DEDUPE_PREFIX = "ZTEST_FA71_";
let seq = 0;
const nextDedupeKey = (tag) => `${DEDUPE_PREFIX}${tag}_${seq++}_${Date.now()}`;

const createdSignalIds = [];

const validPayload = (overrides = {}) => ({
  signalType: SIGNAL_TYPE.REFERRAL_VELOCITY,
  subjectType: SUBJECT_TYPE.FIELD_AGENT,
  subjectRef: new mongoose.Types.ObjectId(),
  fieldAgentRef: new mongoose.Types.ObjectId(),
  severity: SIGNAL_SEVERITY.MEDIUM,
  evidence: { windowStart: new Date().toISOString(), referralCount: 12 },
  sourceEventRef: new mongoose.Types.ObjectId(),
  dedupeKey: nextDedupeKey("BASE"),
  ...overrides,
});

const run = async () => {
  await connectDB();

  try {
    try {
      // ── A. MODEL ─────────────────────────────────────────────────────
      {
        const doc = await FraudSignal.create(validPayload());
        createdSignalIds.push(doc._id);
        check("A. Valid creation with all required fields succeeds", !!doc._id);
        check("A. createdAt is set", !!doc.createdAt);
        check("A. updatedAt does NOT exist on the document", doc.updatedAt === undefined, doc.updatedAt);

        const requiredFields = ["signalType", "subjectType", "subjectRef", "fieldAgentRef", "severity", "evidence", "sourceEventRef", "dedupeKey"];
        for (const field of requiredFields) {
          const payload = validPayload();
          delete payload[field];
          let threw = false;
          try {
            await FraudSignal.create(payload);
          } catch (err) {
            threw = true;
          }
          check(`A. Missing required field '${field}' rejected`, threw);
        }

        // Invalid enums
        let threwSignalType = false;
        try { await FraudSignal.create(validPayload({ signalType: "NOT_A_REAL_TYPE" })); } catch (e) { threwSignalType = true; }
        check("A. Invalid signalType enum rejected", threwSignalType);

        let threwSubjectType = false;
        try { await FraudSignal.create(validPayload({ subjectType: "NOT_A_REAL_SUBJECT" })); } catch (e) { threwSubjectType = true; }
        check("A. Invalid subjectType enum rejected", threwSubjectType);

        let threwSeverity = false;
        try { await FraudSignal.create(validPayload({ severity: "CRITICAL" })); } catch (e) { threwSeverity = true; }
        check("A. Invalid severity enum rejected", threwSeverity);

        // Invalid ObjectId format
        let threwBadSubjectRef = false;
        try { await FraudSignal.create(validPayload({ subjectRef: "not-an-object-id" })); } catch (e) { threwBadSubjectRef = true; }
        check("A. Malformed subjectRef ObjectId rejected", threwBadSubjectRef);

        let threwBadFieldAgentRef = false;
        try { await FraudSignal.create(validPayload({ fieldAgentRef: "not-an-object-id" })); } catch (e) { threwBadFieldAgentRef = true; }
        check("A. Malformed fieldAgentRef ObjectId rejected", threwBadFieldAgentRef);

        let threwBadSourceEventRef = false;
        try { await FraudSignal.create(validPayload({ sourceEventRef: "not-an-object-id" })); } catch (e) { threwBadSourceEventRef = true; }
        check("A. Malformed sourceEventRef ObjectId rejected", threwBadSourceEventRef);

        // Duplicate dedupeKey via raw create (bypassing the service) is
        // rejected at the DB level — proves the unique index itself,
        // independent of the service wrapper.
        const dupeKey = nextDedupeKey("RAWDUP");
        const first = await FraudSignal.create(validPayload({ dedupeKey: dupeKey }));
        createdSignalIds.push(first._id);
        let rawDupThrew = false;
        try {
          await FraudSignal.create(validPayload({ dedupeKey: dupeKey }));
        } catch (err) {
          rawDupThrew = err.code === 11000;
        }
        check("A. Raw duplicate dedupeKey insert rejected by unique index (11000)", rawDupThrew);
      }

      // ── B. IMMUTABILITY ─────────────────────────────────────────────
      {
        const doc = await FraudSignal.create(validPayload());
        createdSignalIds.push(doc._id);

        let saveThrew = false;
        try {
          doc.severity = SIGNAL_SEVERITY.HIGH;
          await doc.save();
        } catch (err) {
          saveThrew = true;
        }
        check("B. Direct .save() on an existing document rejected", saveThrew);

        const opsToTest = [
          { name: "findOneAndUpdate", run: () => FraudSignal.findOneAndUpdate({ _id: doc._id }, { $set: { severity: "HIGH" } }) },
          { name: "updateOne", run: () => FraudSignal.updateOne({ _id: doc._id }, { $set: { severity: "HIGH" } }) },
          { name: "updateMany", run: () => FraudSignal.updateMany({ _id: doc._id }, { $set: { severity: "HIGH" } }) },
          { name: "findByIdAndUpdate", run: () => FraudSignal.findByIdAndUpdate(doc._id, { $set: { severity: "HIGH" } }) },
          { name: "replaceOne", run: () => FraudSignal.replaceOne({ _id: doc._id }, validPayload({ dedupeKey: doc.dedupeKey })) },
          { name: "findOneAndReplace", run: () => FraudSignal.findOneAndReplace({ _id: doc._id }, validPayload({ dedupeKey: doc.dedupeKey })) },
        ];
        // Note: the schema also registers a pre-hook on the legacy
        // standalone `update` query method for defense-in-depth, per
        // the approved plan's exact BLOCKED_OPS list — Mongoose 7+ no
        // longer exposes `Model.update()` as a callable query helper
        // (it was removed in favor of updateOne/updateMany, both of
        // which ARE exercised above), so there is no live code path
        // left to actually invoke it through; the hook registration
        // itself is harmless and costs nothing to keep.

        for (const op of opsToTest) {
          let threw = false;
          try {
            await op.run();
          } catch (err) {
            threw = true;
          }
          check(`B. ${op.name} rejected`, threw);
        }

        const unchanged = await FraudSignal.findById(doc._id).lean();
        check("B. Document content unchanged after every blocked mutation attempt", unchanged.severity === SIGNAL_SEVERITY.MEDIUM, unchanged.severity);

        // Deletion must remain structurally possible (retention policy
        // deliberately deferred, not blocked at the schema level).
        const delResult = await FraudSignal.deleteOne({ _id: doc._id });
        check("B. Deletion remains possible (deleteOne succeeds)", delResult.deletedCount === 1);
        const idx = createdSignalIds.indexOf(doc._id);
        if (idx !== -1) createdSignalIds.splice(idx, 1); // already deleted, don't re-delete in cleanup
      }

      // ── C. INDEX ──────────────────────────────────────────────────────
      {
        const indexes = await FraudSignal.collection.indexes();
        check("C. Unique dedupeKey index exists", indexes.some((i) => i.unique && Object.keys(i.key).join(",") === "dedupeKey"));
        check("C. fieldAgentRef+createdAt index exists", indexes.some((i) => Object.keys(i.key).join(",") === "fieldAgentRef,createdAt"));
        check("C. signalType+createdAt index exists", indexes.some((i) => Object.keys(i.key).join(",") === "signalType,createdAt"));
        check("C. severity+createdAt index exists", indexes.some((i) => Object.keys(i.key).join(",") === "severity,createdAt"));
        check("C. sourceEventRef index exists", indexes.some((i) => Object.keys(i.key).join(",") === "sourceEventRef"));
        check("C. Exactly 6 indexes total (5 approved + default _id)", indexes.length === 6, indexes.map((i) => i.name));

        const fixtureAgent = new mongoose.Types.ObjectId();
        const fixtureSource = new mongoose.Types.ObjectId();
        const seeded = await FraudSignal.create(validPayload({ fieldAgentRef: fixtureAgent, sourceEventRef: fixtureSource, dedupeKey: nextDedupeKey("EXPLAIN") }));
        createdSignalIds.push(seeded._id);

        const explainDedupe = await FraudSignal.find({ dedupeKey: seeded.dedupeKey }).explain("queryPlanner");
        check("C. dedupeKey lookup uses IXSCAN, not COLLSCAN", JSON.stringify(explainDedupe.queryPlanner.winningPlan).includes("IXSCAN"));

        const explainAgent = await FraudSignal.find({ fieldAgentRef: fixtureAgent }).sort({ createdAt: -1 }).explain("queryPlanner");
        check("C. fieldAgentRef+createdAt query uses IXSCAN, not COLLSCAN", JSON.stringify(explainAgent.queryPlanner.winningPlan).includes("IXSCAN"));

        const explainType = await FraudSignal.find({ signalType: SIGNAL_TYPE.REFERRAL_VELOCITY }).sort({ createdAt: -1 }).explain("queryPlanner");
        check("C. signalType+createdAt query uses IXSCAN, not COLLSCAN", JSON.stringify(explainType.queryPlanner.winningPlan).includes("IXSCAN"));

        const explainSeverity = await FraudSignal.find({ severity: SIGNAL_SEVERITY.MEDIUM }).sort({ createdAt: -1 }).explain("queryPlanner");
        check("C. severity+createdAt query uses IXSCAN, not COLLSCAN", JSON.stringify(explainSeverity.queryPlanner.winningPlan).includes("IXSCAN"));

        const explainSource = await FraudSignal.find({ sourceEventRef: fixtureSource }).explain("queryPlanner");
        check("C. sourceEventRef query uses IXSCAN, not COLLSCAN", JSON.stringify(explainSource.queryPlanner.winningPlan).includes("IXSCAN"));
      }

      // ── D. CONCURRENCY ────────────────────────────────────────────────
      {
        const sharedKey = nextDedupeKey("CONC");
        const payloadA = validPayload({ dedupeKey: sharedKey, evidence: { referralCount: 15, worker: "A" } });
        const payloadB = validPayload({ dedupeKey: sharedKey, evidence: { referralCount: 15, worker: "B" } });

        const [resultA, resultB] = await Promise.all([recordSignal(payloadA), recordSignal(payloadB)]);
        check("D. Both concurrent recordSignal calls resolve without throwing", !!resultA && !!resultB);
        check("D. Both calls return the SAME persisted document _id", String(resultA._id) === String(resultB._id), `${resultA._id} vs ${resultB._id}`);
        createdSignalIds.push(resultA._id);

        const persistedCount = await FraudSignal.countDocuments({ dedupeKey: sharedKey });
        check("D. Exactly one document persisted for the shared dedupeKey", persistedCount === 1, persistedCount);
      }

      // ── E. IDEMPOTENCY ────────────────────────────────────────────────
      {
        const key = nextDedupeKey("IDEMP");
        const original = await recordSignal(validPayload({ dedupeKey: key, evidence: { referralCount: 10 }, severity: SIGNAL_SEVERITY.LOW }));
        createdSignalIds.push(original._id);

        const retried = await recordSignal(validPayload({ dedupeKey: key, evidence: { referralCount: 999 }, severity: SIGNAL_SEVERITY.HIGH }));
        check("E. Retried recordSignal with same dedupeKey returns the ORIGINAL document", String(retried._id) === String(original._id));
        check("E. Retried call does NOT overwrite the original evidence", retried.evidence.referralCount === 10, retried.evidence.referralCount);
        check("E. Retried call does NOT overwrite the original severity", retried.severity === SIGNAL_SEVERITY.LOW, retried.severity);

        const fromDb = await getSignalByDedupeKey(key);
        check("E. getSignalByDedupeKey reflects the original, unmodified document", fromDb.evidence.referralCount === 10);

        const totalForKey = await FraudSignal.countDocuments({ dedupeKey: key });
        check("E. Exactly one document exists for the key after retry", totalForKey === 1, totalForKey);
      }

      // ── F/G. SECURITY & PRODUCTION-BOUNDARY STATIC SCAN ────────────────
      {
        const modelSrc = fs.readFileSync(path.join(process.cwd(), "modules/fieldAgent/models/FraudSignal.js"), "utf8");
        const serviceSrc = fs.readFileSync(path.join(process.cwd(), "modules/fieldAgent/services/fraudSignal.service.js"), "utf8");
        const constantsSrc = fs.readFileSync(path.join(process.cwd(), "modules/fieldAgent/constants/fraudSignal.constants.js"), "utf8");
        const combinedRaw = modelSrc + "\n" + serviceSrc + "\n" + constantsSrc;
        // Strip comments before scanning — these files' own header
        // comments legitimately *mention* AcquisitionReferral/
        // AcquisitionClaim/CommercialTerritory etc. in prose to
        // document the deliberate ABSENCE of any dependency on them
        // (see FraudSignal.js's own header). A blunt substring scan
        // over raw source would false-positive on exactly that prose,
        // the same class of false positive already diagnosed and
        // fixed this session for AREA-2.5.1/AREA-2.5.2's own scans.
        const combined = combinedRaw
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .split("\n")
          .map((l) => l.replace(/\/\/.*$/, ""))
          .join("\n");

        const forbiddenImports = [
          "AcquisitionReferral", "AcquisitionClaim", "models/FieldAgent.js", "models/Salon.js",
          "CommercialTerritory", "TerritoryAssignment", "TerritoryActivationLock",
          "models/Area.js", "models/KYC.js", "models/User.js", "models/Booking.js", "Wallet", "Commission",
        ];
        for (const forbidden of forbiddenImports) {
          check(`F/G. No import of '${forbidden}' anywhere in FA-7.1 files (comments excluded)`, !combined.includes(forbidden));
        }
        check("F/G. No import statement references any frozen model at all", !/^import .*from ["'].*(Acquisition|FieldAgent\.js|Salon\.js|CommercialTerritory|TerritoryAssignment|TerritoryActivationLock|Area\.js|KYC|models\/User\.js)/m.test(combined));

        check("F. No route/controller file exists for FraudSignal (foundation only)", !fs.existsSync(path.join(process.cwd(), "modules/fieldAgent/routes/fraudSignal.routes.js")) && !fs.existsSync(path.join(process.cwd(), "modules/fieldAgent/controllers/fraudSignal.controller.js")));

        const { execSync } = await import("child_process");
        const diffFiles = execSync("git diff --name-only", { cwd: process.cwd() }).toString();
        check("G. No frozen file modified (app.js)", !diffFiles.includes("app.js"));
        check("G. No frozen file modified (fieldAgent.constants.js)", !diffFiles.includes("fieldAgent.constants.js"));
        check("G. No frozen file modified (commercialTerritory.service.js)", !diffFiles.includes("commercialTerritory.service.js"));
        check("G. No frozen file modified (acquisitionClaim.service.js)", !diffFiles.includes("acquisitionClaim.service.js"));
      }

    } catch (innerErr) {
      console.error("TEST BODY ERROR:", innerErr);
      check("Test body completed without throwing", false, innerErr.message);
    }
  } finally {
    if (createdSignalIds.length) await FraudSignal.deleteMany({ _id: { $in: createdSignalIds } });

    const residue = await FraudSignal.countDocuments({ dedupeKey: { $regex: `^${DEDUPE_PREFIX}` } });
    check("H. Zero test-fixture residue remains after cleanup", residue === 0, residue);

    console.log("\n" + results.join("\n"));
    console.log(`\n${pass} passed, ${fail} failed`);

    await mongoose.disconnect();
    process.exit(fail > 0 ? 1 : 0);
  }
};

run().catch(async (err) => {
  console.error("FATAL:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
