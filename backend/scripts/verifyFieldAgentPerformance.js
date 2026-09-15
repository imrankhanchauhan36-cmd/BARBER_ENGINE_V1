/**
 * BARBER ENGINE V1
 * backend/scripts/verifyFieldAgentPerformance.js
 *
 * FA-11.1 — dedicated, real-Mongo verification for the Field Agent
 * Performance domain foundation: PerformancePolicyVersion's
 * DRAFT/PUBLISHED/RETIRED lifecycle (mirrors verifyCommercialPolicy*'s
 * own coverage of CommercialPolicyVersion) and
 * FieldAgentPerformanceSnapshot's uniqueness/immutability contract.
 *
 * FA-11.2 — extends this same script with the calculation-layer
 * verification: fieldAgentPerformance.service.js's pure aggregation
 * against real fixture data (acquisition, ledger, territory/term,
 * current-state, fraud/admin context), window-boundary precision,
 * lifetime/rolling separation, zero-denominator safety, query-plan
 * evidence, determinism, and production-boundary non-interference.
 *
 * Deliberately NOT covered here (FA-11.3+ scope, not yet implemented):
 * the background job, the admin read API, authorization/scoping.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyFieldAgentPerformance.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";

import User from "../models/User.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import PerformancePolicyVersion from "../modules/fieldAgent/models/PerformancePolicyVersion.js";
import FieldAgentPerformanceSnapshot from "../modules/fieldAgent/models/FieldAgentPerformanceSnapshot.js";
import FieldAgentAuditEvent from "../modules/fieldAgent/models/FieldAgentAuditEvent.js";
import {
  createDraftPerformancePolicyVersion,
  publishPerformancePolicyVersion,
} from "../modules/fieldAgent/services/performancePolicy.service.js";
import {
  computeFieldAgentPerformanceSnapshotPayload,
  createFieldAgentPerformanceSnapshot,
} from "../modules/fieldAgent/services/fieldAgentPerformance.service.js";
import { PERFORMANCE_DIMENSION } from "../modules/fieldAgent/constants/performance.constants.js";

// FA-11.2 authoritative sources
import AcquisitionClaim from "../modules/fieldAgent/models/AcquisitionClaim.js";
import AcquisitionEarningProgress from "../modules/fieldAgent/models/AcquisitionEarningProgress.js";
import TerritoryAssignment from "../modules/fieldAgent/models/TerritoryAssignment.js";
import TerritoryPartnerTermSnapshot from "../modules/fieldAgent/models/TerritoryPartnerTermSnapshot.js";
import FraudSignal from "../modules/fieldAgent/models/FraudSignal.js";
import KYC from "../modules/kyc/models/KYC.js";
import FieldAgentTraining from "../modules/fieldAgentTraining/models/FieldAgentTraining.js";
import TestAttempt from "../modules/fieldAgentTest/models/TestAttempt.js";

// Untouched-by-FA-11 collections — spot-checked before/after to prove
// this milestone's own tests never drifted a frozen collection.
import FieldAgentEarningLedger from "../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import FieldAgentEarningPolicyGap from "../modules/fieldAgent/models/FieldAgentEarningPolicyGap.js";
import FieldAgentEarningJobCheckpoint from "../modules/fieldAgent/models/FieldAgentEarningJobCheckpoint.js";
import CommercialTerritory from "../modules/fieldAgent/models/CommercialTerritory.js";

const NAME_PREFIX = "ZTEST_FA11_";
const oid = () => new mongoose.Types.ObjectId();
const MS_PER_DAY = 24 * 60 * 60 * 1000;

let passed = 0;
let failed = 0;
const check = (label, cond, extra) => {
  if (cond) {
    passed++;
    console.log(`✅ ${label}`);
  } else {
    failed++;
    console.log(`❌ ${label}`, extra !== undefined ? extra : "");
  }
};

const run = async () => {
  await connectDB();

  const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("_id").lean();
  if (!indiaAdmin) throw new Error("No existing INDIA admin found — cannot run FA-11 verification");

  const fixturePolicyIds = [];
  const fixtureSnapshotIds = [];
  const fixtureFieldAgentIds = [];
  const fixtureUserIds = [];
  const fixtureClaimIds = [];
  const fixtureProgressIds = [];
  const fixtureLedgerIds = [];
  const fixtureAssignmentIds = [];
  const fixtureTermSnapshotIds = [];
  const fixtureFraudSignalIds = [];
  const fixtureAuditEventIds = [];
  const fixtureKycIds = [];
  const fixtureTrainingIds = [];
  const fixtureTestAttemptIds = [];

  // ── PRODUCTION-BOUNDARY BEFORE STATE ──────────────────────────────
  const before = {
    ledger: await FieldAgentEarningLedger.countDocuments(),
    gaps: await FieldAgentEarningPolicyGap.countDocuments(),
    checkpoint: await FieldAgentEarningJobCheckpoint.findById("FIELD_AGENT_EARNING_CURSOR").lean(),
    progress: await AcquisitionEarningProgress.countDocuments(),
    termSnapshots: await TerritoryPartnerTermSnapshot.countDocuments(),
    territories: await CommercialTerritory.countDocuments(),
    assignments: await TerritoryAssignment.countDocuments(),
    claims: await AcquisitionClaim.countDocuments(),
  };

  try {
    // ── 0. FAIL CLOSED WHEN NO PUBLISHED POLICY EXISTS ───────────────
    {
      const existingPublished = await PerformancePolicyVersion.countDocuments({ status: "PUBLISHED" });
      check("0. Precondition — no PerformancePolicyVersion is published yet (production baseline)", existingPublished === 0, existingPublished);

      let failedClosed = false;
      try {
        await computeFieldAgentPerformanceSnapshotPayload({ fieldAgentRef: oid(), cycleKey: "PRECHECK", now: new Date() });
      } catch (err) {
        failedClosed = err.statusCode === 409 || /No PUBLISHED PerformancePolicyVersion/.test(err.message || "");
      }
      check("0. Calculation FAILS CLOSED with no PUBLISHED PerformancePolicyVersion (never invents a default window)", failedClosed);
    }

    const mkFieldAgent = async ({ commercialPath = "ACQUISITION_AGENT", accountStatus = "ACTIVE", operationalStatus = "ACTIVE" } = {}) => {
      const agentUser = await User.create({
        name: `${NAME_PREFIX}AGENT_${Date.now()}_${Math.random()}`,
        phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`,
        role: "FIELD_AGENT",
        accountStatus,
      });
      fixtureUserIds.push(agentUser._id);
      const applicationRef = oid();
      const fieldAgent = await FieldAgent.create({
        userRef: agentUser._id,
        applicationRef,
        agentCode: `ZF11-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        operationalStatus,
        commercialPath,
      });
      fixtureFieldAgentIds.push(fieldAgent._id);
      return { fieldAgent, agentUser, applicationRef };
    };

    // ── 1. POLICY LIFECYCLE ─────────────────────────────────────────
    {
      const v1 = await createDraftPerformancePolicyVersion({
        adminId: indiaAdmin._id,
        rollingWindowDays: 90,
        dimensionsEnabled: [PERFORMANCE_DIMENSION.ACQUISITION_PRODUCTIVITY, PERFORMANCE_DIMENSION.COMPLIANCE_ELIGIBILITY],
      });
      fixturePolicyIds.push(v1._id);
      check("1. Draft policy created with status DRAFT", v1.status === "DRAFT");
      check("1. Draft policy has no score/weight field", v1.weights === undefined && v1.score === undefined);

      const published1 = await publishPerformancePolicyVersion({ versionId: v1._id, adminId: indiaAdmin._id });
      check("1. Publish transitions DRAFT -> PUBLISHED", published1.status === "PUBLISHED");
      check("1. publishedAt/publishedBy set on publish", !!published1.publishedAt && String(published1.publishedBy) === String(indiaAdmin._id));

      const auditRow = await FieldAgentAuditEvent.findOne({ entityType: "PERFORMANCE_POLICY_VERSION", entityId: v1._id, action: "PERFORMANCE_POLICY_PUBLISHED" }).lean();
      check("1. FieldAgentAuditEvent recorded for publish", !!auditRow);
    }

    // ── 2. EXACTLY ONE PUBLISHED (supersede-and-retire) ─────────────
    {
      const v2 = await createDraftPerformancePolicyVersion({ adminId: indiaAdmin._id, rollingWindowDays: 90, dimensionsEnabled: [] });
      fixturePolicyIds.push(v2._id);
      const published2 = await publishPerformancePolicyVersion({ versionId: v2._id, adminId: indiaAdmin._id });
      check("2. Second publish succeeds", published2.status === "PUBLISHED");

      const stillPublishedCount = await PerformancePolicyVersion.countDocuments({ _id: { $in: fixturePolicyIds }, status: "PUBLISHED" });
      check("2. Exactly one PUBLISHED among this test's own fixtures", stillPublishedCount === 1, stillPublishedCount);

      const v1Fresh = await PerformancePolicyVersion.findById(fixturePolicyIds[0]).lean();
      check("2. Previous PUBLISHED version auto-RETIRED on supersede", v1Fresh.status === "RETIRED" && !!v1Fresh.retiredAt);
    }

    // ── 3. PUBLISH CONCURRENCY ──────────────────────────────────────
    {
      const v3 = await createDraftPerformancePolicyVersion({ adminId: indiaAdmin._id, rollingWindowDays: 60, dimensionsEnabled: [] });
      const v4 = await createDraftPerformancePolicyVersion({ adminId: indiaAdmin._id, rollingWindowDays: 60, dimensionsEnabled: [] });
      fixturePolicyIds.push(v3._id, v4._id);

      const results = await Promise.allSettled([
        publishPerformancePolicyVersion({ versionId: v3._id, adminId: indiaAdmin._id }),
        publishPerformancePolicyVersion({ versionId: v4._id, adminId: indiaAdmin._id }),
      ]);
      const bothResolved = results.every((r) => r.status === "fulfilled");
      check("3. Two concurrent publish attempts (different drafts) both resolve without an uncaught error", bothResolved, JSON.stringify(results.map((r) => r.status)));

      const publishedAmongAll = await PerformancePolicyVersion.countDocuments({ _id: { $in: fixturePolicyIds }, status: "PUBLISHED" });
      check("3. Exactly one PUBLISHED after concurrent publish race", publishedAmongAll === 1, publishedAmongAll);
    }

    // ── 4. SNAPSHOT UNIQUENESS (fieldAgentRef, cycleKey) ────────────
    let snapshotAgent, activePolicy;
    {
      const created = await mkFieldAgent();
      snapshotAgent = created.fieldAgent;
      activePolicy = await PerformancePolicyVersion.findOne({ status: "PUBLISHED" }).lean();

      const baseSnapshot = {
        fieldAgentRef: snapshotAgent._id,
        commercialPath: "ACQUISITION_AGENT",
        cycleKey: "2026-09-CYCLE-A",
        policyVersionRef: activePolicy._id,
        computedAt: new Date(),
        rollingWindowDays: activePolicy.rollingWindowDays,
        rollingWindow: {
          claimsIssuedCount: 2,
          acquisitionCreditedBookingCount: 5,
          acquisitionCreditedAmountInPaise: 5000,
          territoryCreditedBookingCount: 0,
          territoryCreditedAmountInPaise: 0,
          adminActionCount: 0,
        },
        lifetime: { salonsAcquiredCount: 2, targetCompletionCount: 0, targetCompletionRate: 0 },
        currentState: { claimsActiveCount: 1, kycStatus: "VERIFIED", trainingStatus: "COMPLETED", testStatus: "PASSED", accountStatus: "ACTIVE", operationalStatus: "ACTIVE" },
      };

      const s1 = await FieldAgentPerformanceSnapshot.create(baseSnapshot);
      fixtureSnapshotIds.push(s1._id);
      check("4. First snapshot for (agent, cycleKey) succeeds", !!s1._id);

      let duplicateRejected = false;
      try {
        await FieldAgentPerformanceSnapshot.create(baseSnapshot);
      } catch (err) {
        duplicateRejected = err.code === 11000;
      }
      check("4. Duplicate (fieldAgentRef, cycleKey) rejected with E11000", duplicateRejected);

      const s2 = await FieldAgentPerformanceSnapshot.create({ ...baseSnapshot, cycleKey: "2026-09-CYCLE-B" });
      fixtureSnapshotIds.push(s2._id);
      check("4. Different cycleKey for the SAME agent is allowed (not a duplicate)", !!s2._id);
    }

    // ── 5. CONCURRENT SNAPSHOT CREATION (same agent, same cycle) ────
    {
      const raceCreated = await mkFieldAgent();
      const raceAgent = raceCreated.fieldAgent;
      const baseSnapshot = {
        fieldAgentRef: raceAgent._id,
        commercialPath: "ACQUISITION_AGENT",
        cycleKey: "2026-09-CYCLE-RACE",
        policyVersionRef: activePolicy._id,
        computedAt: new Date(),
        rollingWindowDays: activePolicy.rollingWindowDays,
        rollingWindow: { claimsIssuedCount: 0, acquisitionCreditedBookingCount: 0, acquisitionCreditedAmountInPaise: 0, territoryCreditedBookingCount: 0, territoryCreditedAmountInPaise: 0, adminActionCount: 0 },
        lifetime: { salonsAcquiredCount: 0, targetCompletionCount: 0, targetCompletionRate: 0 },
        currentState: { claimsActiveCount: 0, kycStatus: "VERIFIED", trainingStatus: "COMPLETED", testStatus: "PASSED", accountStatus: "ACTIVE", operationalStatus: "ACTIVE" },
      };

      const raceResults = await Promise.allSettled(
        Array.from({ length: 8 }, () => FieldAgentPerformanceSnapshot.create(baseSnapshot))
      );
      const succeeded = raceResults.filter((r) => r.status === "fulfilled");
      succeeded.forEach((r) => fixtureSnapshotIds.push(r.value._id));
      check("5. Exactly one of 8 concurrent same-cycle creation attempts succeeds", succeeded.length === 1, succeeded.length);

      const rejectedAllE11000 = raceResults.filter((r) => r.status === "rejected").every((r) => r.reason?.code === 11000);
      check("5. Every rejected concurrent attempt failed with E11000 (not some other error)", rejectedAllE11000);

      const docCount = await FieldAgentPerformanceSnapshot.countDocuments({ fieldAgentRef: raceAgent._id, cycleKey: "2026-09-CYCLE-RACE" });
      check("5. Exactly one document exists in the DB for this (agent, cycle) after the race", docCount === 1, docCount);
    }

    // ── 6. IMMUTABILITY ──────────────────────────────────────────────
    {
      const targetId = fixtureSnapshotIds[0];
      const attempts = [
        () => FieldAgentPerformanceSnapshot.updateOne({ _id: targetId }, { $set: { "currentState.accountStatus": "SUSPENDED" } }),
        () => FieldAgentPerformanceSnapshot.findOneAndUpdate({ _id: targetId }, { $set: { "currentState.accountStatus": "SUSPENDED" } }),
        () => FieldAgentPerformanceSnapshot.deleteOne({ _id: targetId }),
        () => FieldAgentPerformanceSnapshot.findOneAndDelete({ _id: targetId }),
      ];
      let allBlocked = true;
      for (const attempt of attempts) {
        try {
          await attempt();
          allBlocked = false;
        } catch (err) {
          if (!/immutable/i.test(err.message || "")) allBlocked = false;
        }
      }
      check("6. updateOne/findOneAndUpdate/deleteOne/findOneAndDelete are all blocked at the schema level", allBlocked);

      const stillThere = await FieldAgentPerformanceSnapshot.findById(targetId).lean();
      check("6. Snapshot document is unchanged/still present after all blocked mutation attempts", !!stillThere && stillThere.currentState.accountStatus === "ACTIVE");
    }

    // ── 7. UNAVAILABLE FIELDS ────────────────────────────────────────
    {
      const s = await FieldAgentPerformanceSnapshot.findById(fixtureSnapshotIds[0]).lean();
      check(
        "7. supportRelationshipEvidence carries the exact fixed UNAVAILABLE message",
        s.unavailable?.supportRelationshipEvidence === "UNAVAILABLE — no authoritative Field Agent linkage in SupportTicket"
      );
      check(
        "7. complaintEvidence carries the exact fixed UNAVAILABLE message",
        s.unavailable?.complaintEvidence === "UNAVAILABLE — no complaint/grievance model exists"
      );
    }

    // ── 8. INDEXES ────────────────────────────────────────────────────
    {
      const policyIndexes = await PerformancePolicyVersion.collection.indexes();
      check(
        "8. PerformancePolicyVersion has a partial unique index on status=PUBLISHED",
        policyIndexes.some((i) => i.unique && i.partialFilterExpression?.status === "PUBLISHED" && Object.keys(i.key).join(",") === "status")
      );
      check(
        "8. PerformancePolicyVersion has a unique versionNumber index",
        policyIndexes.some((i) => i.unique && Object.keys(i.key).join(",") === "versionNumber")
      );

      const snapshotIndexes = await FieldAgentPerformanceSnapshot.collection.indexes();
      check(
        "8. FieldAgentPerformanceSnapshot has a unique (fieldAgentRef, cycleKey) index",
        snapshotIndexes.some((i) => i.unique && Object.keys(i.key).join(",") === "fieldAgentRef,cycleKey")
      );
      check(
        "8. FieldAgentPerformanceSnapshot has a (fieldAgentRef, computedAt desc) lookup index",
        snapshotIndexes.some((i) => !i.unique && Object.keys(i.key).join(",") === "fieldAgentRef,computedAt")
      );
      check(
        "8. No unauthorized speculative index exists on FieldAgentPerformanceSnapshot beyond _id/unique/lookup",
        snapshotIndexes.length === 3,
        snapshotIndexes.map((i) => Object.keys(i.key).join(","))
      );
    }

    // ── 9. NO CLIENT-TRUSTED VALUE PATH EXISTS YET ───────────────────
    {
      // No admin controller/route file exists yet — the only write
      // path is the service functions above (adminId/versionId/
      // fieldAgentRef are function arguments, never parsed from an
      // HTTP body here).
      const fs = await import("node:fs");
      const controllerExists = fs.existsSync(new URL("../modules/fieldAgent/controllers/adminFieldAgentPerformance.controller.js", import.meta.url));
      check("9. No admin controller/route file exists yet (correctly deferred to FA-11.3)", !controllerExists);
    }

    // ═══════════════════════════════════════════════════════════════
    // FA-11.2 — CALCULATION LAYER
    // ═══════════════════════════════════════════════════════════════

    const NOW = new Date();
    const windowStart = new Date(NOW.getTime() - activePolicy.rollingWindowDays * MS_PER_DAY);

    // ── 11. NO BOOKING DEPENDENCY (static source check) ──────────────
    {
      const fs = await import("node:fs");
      const src = fs.readFileSync(new URL("../modules/fieldAgent/services/fieldAgentPerformance.service.js", import.meta.url), "utf8");
      check("11. fieldAgentPerformance.service.js never imports the Booking model", !/models\/Booking\.js/.test(src));
    }

    // ── 12. ACQUISITION METRICS (claims, salons, target completion) ──
    let acqAgent;
    {
      const created = await mkFieldAgent();
      acqAgent = created.fieldAgent;

      // Claim A: issued well OUTSIDE the window (lifetime-only), on a
      // salon this agent later re-acquires — proves distinct-salon
      // de-duplication and lifetime/window independence together.
      const salonRefLifetime = oid();
      const claimOld = await AcquisitionClaim.create({
        salonRef: salonRefLifetime,
        fieldAgentRef: acqAgent._id,
        status: "ENDED",
        endedReason: "AGENT_WITHDRAWN",
        endedAt: new Date(windowStart.getTime() - 5 * MS_PER_DAY),
        createdAt: new Date(windowStart.getTime() - 10 * MS_PER_DAY),
      });
      fixtureClaimIds.push(claimOld._id);

      // Claim B: the SAME salon re-claimed, issued INSIDE the window,
      // still ACTIVE.
      const claimReclaim = await AcquisitionClaim.create({
        salonRef: salonRefLifetime,
        fieldAgentRef: acqAgent._id,
        status: "ACTIVE",
        createdAt: new Date(windowStart.getTime() + 2 * MS_PER_DAY),
      });
      fixtureClaimIds.push(claimReclaim._id);

      // Claim C: a DIFFERENT salon, issued exactly at windowStart
      // (inclusive boundary) — ACTIVE, with a progress record that
      // reached TARGET_REACHED.
      const salonRefC = oid();
      const claimC = await AcquisitionClaim.create({
        salonRef: salonRefC,
        fieldAgentRef: acqAgent._id,
        status: "ACTIVE",
        createdAt: windowStart,
      });
      fixtureClaimIds.push(claimC._id);
      const progressC = await AcquisitionEarningProgress.create({
        acquisitionClaimRef: claimC._id,
        salonRef: salonRefC,
        targetInPaise: 10000,
        earnedInPaise: 10000,
        status: "TARGET_REACHED",
      });
      fixtureProgressIds.push(progressC._id);

      // Claim D: issued exactly 1ms BEFORE windowStart (exclusive —
      // must NOT count toward claimsIssuedCount), still IN_PROGRESS.
      const salonRefD = oid();
      const claimD = await AcquisitionClaim.create({
        salonRef: salonRefD,
        fieldAgentRef: acqAgent._id,
        status: "ACTIVE",
        createdAt: new Date(windowStart.getTime() - 1),
      });
      fixtureClaimIds.push(claimD._id);
      const progressD = await AcquisitionEarningProgress.create({
        acquisitionClaimRef: claimD._id,
        salonRef: salonRefD,
        targetInPaise: 10000,
        earnedInPaise: 3000,
        status: "IN_PROGRESS",
      });
      fixtureProgressIds.push(progressD._id);

      const payload = await computeFieldAgentPerformanceSnapshotPayload({ fieldAgentRef: acqAgent._id, cycleKey: "FA11-2-ACQ", now: NOW });

      check("12. Published policy => calculation succeeds", !!payload);
      check("3-boundary. claimsIssuedCount includes windowStart-inclusive, excludes 1ms-before", payload.rollingWindow.claimsIssuedCount === 2, payload.rollingWindow.claimsIssuedCount);
      check("5. claimsActiveCount counts only status=ACTIVE (3 of 4 claims)", payload.currentState.claimsActiveCount === 3, payload.currentState.claimsActiveCount);
      check("6. salonsAcquiredCount de-duplicates the re-claimed salon (3 distinct salons, not 4 claims)", payload.lifetime.salonsAcquiredCount === 3, payload.lifetime.salonsAcquiredCount);
      check("4. Lifetime salonsAcquiredCount includes the claim issued OUTSIDE the window", payload.lifetime.salonsAcquiredCount >= 3);
      check("7. targetCompletionCount counts only TARGET_REACHED progress rows", payload.lifetime.targetCompletionCount === 1, payload.lifetime.targetCompletionCount);
      check("8. targetCompletionRate = 1/2 progress records", payload.lifetime.targetCompletionRate === 0.5, payload.lifetime.targetCompletionRate);
    }

    // ── 9. ZERO-DENOMINATOR (claims exist, zero progress records) ────
    {
      const created = await mkFieldAgent();
      const zeroDenomAgent = created.fieldAgent;
      const claim = await AcquisitionClaim.create({ salonRef: oid(), fieldAgentRef: zeroDenomAgent._id, status: "ACTIVE", createdAt: NOW });
      fixtureClaimIds.push(claim._id);
      // Deliberately no AcquisitionEarningProgress created — mirrors a
      // claim stuck on an open CLAIM_PROGRESS_GAP.

      const payload = await computeFieldAgentPerformanceSnapshotPayload({ fieldAgentRef: zeroDenomAgent._id, cycleKey: "FA11-2-ZERO", now: NOW });
      check("9. targetCompletionRate is null (never a fabricated 0) when zero progress records exist", payload.lifetime.targetCompletionRate === null, payload.lifetime.targetCompletionRate);
    }

    // ── 10-11. ACQUISITION / TERRITORY LEDGER FINANCIAL ACTIVITY ─────
    {
      const created = await mkFieldAgent();
      const ledgerAgent = created.fieldAgent;

      const mkLedgerRow = async ({ entitlementType, creditOutcome, creditedAmountInPaise, bookingCompletedAt }) => {
        const row = await FieldAgentEarningLedger.create({
          bookingRef: oid(),
          entitlementType,
          idempotencyKey: `earning:${oid()}:${entitlementType}`,
          fieldAgentRef: ledgerAgent._id,
          acquisitionClaimRef: entitlementType === "ACQUISITION" ? oid() : null,
          territoryAssignmentRef: entitlementType === "TERRITORY_PARTNER" ? oid() : null,
          policySource: "NATIONAL",
          policyVersionRef: oid(),
          appliedRatePercent: 10,
          bookingCommissionAmountInPaise: creditedAmountInPaise * 10,
          rawEligibleAmountInPaise: creditedAmountInPaise,
          creditedAmountInPaise,
          creditOutcome,
          bookingCompletedAt,
        });
        fixtureLedgerIds.push(row._id);
        return row;
      };

      // In-window CREDITED rows (count toward the metrics).
      await mkLedgerRow({ entitlementType: "ACQUISITION", creditOutcome: "CREDITED", creditedAmountInPaise: 4000, bookingCompletedAt: new Date(windowStart.getTime() + 1 * MS_PER_DAY) });
      await mkLedgerRow({ entitlementType: "ACQUISITION", creditOutcome: "CREDITED", creditedAmountInPaise: 6000, bookingCompletedAt: NOW });
      await mkLedgerRow({ entitlementType: "TERRITORY_PARTNER", creditOutcome: "CREDITED", creditedAmountInPaise: 2500, bookingCompletedAt: new Date(windowStart.getTime() + 2 * MS_PER_DAY) });

      // Non-CREDITED outcome in-window — must NOT count.
      await mkLedgerRow({ entitlementType: "ACQUISITION", creditOutcome: "ZERO_TARGET_REACHED", creditedAmountInPaise: 0, bookingCompletedAt: NOW });

      // CREDITED but OUTSIDE the window (1ms before windowStart) — must NOT count.
      await mkLedgerRow({ entitlementType: "ACQUISITION", creditOutcome: "CREDITED", creditedAmountInPaise: 9999, bookingCompletedAt: new Date(windowStart.getTime() - 1) });

      const payload = await computeFieldAgentPerformanceSnapshotPayload({ fieldAgentRef: ledgerAgent._id, cycleKey: "FA11-2-LEDGER", now: NOW });

      check("10. acquisitionCreditedBookingCount counts only in-window CREDITED ACQUISITION rows", payload.rollingWindow.acquisitionCreditedBookingCount === 2, payload.rollingWindow.acquisitionCreditedBookingCount);
      check("11. acquisitionCreditedAmountInPaise sums only in-window CREDITED ACQUISITION rows (4000+6000)", payload.rollingWindow.acquisitionCreditedAmountInPaise === 10000, payload.rollingWindow.acquisitionCreditedAmountInPaise);
      check("12. territoryCreditedBookingCount counts only in-window CREDITED TERRITORY_PARTNER rows", payload.rollingWindow.territoryCreditedBookingCount === 1, payload.rollingWindow.territoryCreditedBookingCount);
      check("13. territoryCreditedAmountInPaise sums only in-window CREDITED TERRITORY_PARTNER rows", payload.rollingWindow.territoryCreditedAmountInPaise === 2500, payload.rollingWindow.territoryCreditedAmountInPaise);
    }

    // ── 14-20. TERRITORY / TENURE / ASSIGNMENT HISTORY / TERM ────────
    {
      const created = await mkFieldAgent({ commercialPath: "TERRITORY_PARTNER" });
      const tpAgent = created.fieldAgent;

      // Historical assignment #1 — PARTNER_EXIT, ended.
      const a1 = await TerritoryAssignment.create({
        territoryRef: oid(),
        fieldAgentRef: tpAgent._id,
        status: "ENDED",
        effectiveFrom: new Date(NOW.getTime() - 500 * MS_PER_DAY),
        effectiveUntil: new Date(NOW.getTime() - 400 * MS_PER_DAY),
        endReason: "PARTNER_EXIT",
        assignedBy: indiaAdmin._id,
        endedBy: indiaAdmin._id,
      });
      fixtureAssignmentIds.push(a1._id);

      // Historical assignment #2 — TERRITORY_RETIRED, ended.
      const a2 = await TerritoryAssignment.create({
        territoryRef: oid(),
        fieldAgentRef: tpAgent._id,
        status: "ENDED",
        effectiveFrom: new Date(NOW.getTime() - 399 * MS_PER_DAY),
        effectiveUntil: new Date(NOW.getTime() - 200 * MS_PER_DAY),
        endReason: "TERRITORY_RETIRED",
        assignedBy: indiaAdmin._id,
        endedBy: indiaAdmin._id,
      });
      fixtureAssignmentIds.push(a2._id);

      // Historical assignment #3 — ADMIN_REASSIGNED, ended.
      const a3 = await TerritoryAssignment.create({
        territoryRef: oid(),
        fieldAgentRef: tpAgent._id,
        status: "ENDED",
        effectiveFrom: new Date(NOW.getTime() - 199 * MS_PER_DAY),
        effectiveUntil: new Date(NOW.getTime() - 100 * MS_PER_DAY),
        endReason: "ADMIN_REASSIGNED",
        assignedBy: indiaAdmin._id,
        endedBy: indiaAdmin._id,
      });
      fixtureAssignmentIds.push(a3._id);

      // Current ACTIVE assignment, tenure exactly 100 days.
      const currentAssignment = await TerritoryAssignment.create({
        territoryRef: oid(),
        fieldAgentRef: tpAgent._id,
        status: "ACTIVE",
        effectiveFrom: new Date(NOW.getTime() - 100 * MS_PER_DAY),
        assignedBy: indiaAdmin._id,
      });
      fixtureAssignmentIds.push(currentAssignment._id);

      // Term snapshot for the current assignment — expires 30 days from now.
      const termSnapshot = await TerritoryPartnerTermSnapshot.create({
        territoryAssignmentRef: currentAssignment._id,
        fieldAgentRef: tpAgent._id,
        termStartAt: currentAssignment.effectiveFrom,
        termMonths: 36,
        termExpiresAt: new Date(NOW.getTime() + 30 * MS_PER_DAY),
        policyVersionRef: oid(),
      });
      fixtureTermSnapshotIds.push(termSnapshot._id);

      const payload = await computeFieldAgentPerformanceSnapshotPayload({ fieldAgentRef: tpAgent._id, cycleKey: "FA11-2-TERRITORY", now: NOW });

      check("14. territoryTenureDays = 100 for the current ACTIVE assignment", payload.lifetime.territoryTenureDays === 100, payload.lifetime.territoryTenureDays);
      check("15. territoryAssignmentHistory contains all 4 assignments", payload.lifetime.territoryAssignmentHistory.length === 4, payload.lifetime.territoryAssignmentHistory.length);
      check("16. PARTNER_EXIT reason preserved in history", payload.lifetime.territoryAssignmentHistory.some((h) => h.endReason === "PARTNER_EXIT"));
      check("17. TERRITORY_RETIRED reason preserved in history", payload.lifetime.territoryAssignmentHistory.some((h) => h.endReason === "TERRITORY_RETIRED"));
      check("18. ADMIN_REASSIGNED reason preserved in history", payload.lifetime.territoryAssignmentHistory.some((h) => h.endReason === "ADMIN_REASSIGNED"));
      check("19. termStatus.daysRemaining ~= 30 for the current assignment's snapshot", payload.currentState.termStatus.daysRemaining === 30, payload.currentState.termStatus.daysRemaining);
      check("19. termStatus.expired = false when term has not yet expired", payload.currentState.termStatus.expired === false);

      // ── 20. EXACT TERM EXPIRY BOUNDARY ───────────────────────────
      const boundaryNow = new Date(termSnapshot.termExpiresAt.getTime());
      const beforeBoundaryNow = new Date(termSnapshot.termExpiresAt.getTime() - 1);
      const atBoundaryPayload = await computeFieldAgentPerformanceSnapshotPayload({ fieldAgentRef: tpAgent._id, cycleKey: "FA11-2-TERM-AT", now: boundaryNow });
      const beforeBoundaryPayload = await computeFieldAgentPerformanceSnapshotPayload({ fieldAgentRef: tpAgent._id, cycleKey: "FA11-2-TERM-BEFORE", now: beforeBoundaryNow });
      check("20. now === termExpiresAt => expired TRUE (matches FA-10's own >= boundary)", atBoundaryPayload.currentState.termStatus.expired === true);
      check("20. now === termExpiresAt-1ms => expired FALSE", beforeBoundaryPayload.currentState.termStatus.expired === false);
    }

    // ── 21-25. CURRENT STATE (KYC/training/test/account/operational) ─
    {
      const created = await mkFieldAgent({ accountStatus: "SUSPENDED", operationalStatus: "ACTIVE" });
      const stateAgent = created.fieldAgent;

      const kyc = await KYC.create({ ownerId: created.agentUser._id, applicantType: "FIELD_AGENT", status: "VERIFIED" });
      fixtureKycIds.push(kyc._id);
      const training = await FieldAgentTraining.create({ agentRef: created.agentUser._id, applicationRef: created.applicationRef, trainingVersion: oid(), status: "COMPLETED" });
      fixtureTrainingIds.push(training._id);
      const testAttempt = await TestAttempt.create({
        applicationRef: created.applicationRef,
        agentRef: created.agentUser._id,
        testVersionRef: oid(),
        attemptNumber: 1,
        status: "PASSED",
        questionRefs: [oid(), oid()],
        score: 90,
        passed: true,
        startedAt: NOW,
        submittedAt: NOW,
      });
      fixtureTestAttemptIds.push(testAttempt._id);

      const payload = await computeFieldAgentPerformanceSnapshotPayload({ fieldAgentRef: stateAgent._id, cycleKey: "FA11-2-STATE", now: NOW });

      check("21. kycStatus reflects the authoritative KYC document", payload.currentState.kycStatus === "VERIFIED", payload.currentState.kycStatus);
      check("22. trainingStatus reflects the authoritative FieldAgentTraining document", payload.currentState.trainingStatus === "COMPLETED", payload.currentState.trainingStatus);
      check("23. testStatus reflects the authoritative TestAttempt document", payload.currentState.testStatus === "PASSED", payload.currentState.testStatus);
      check("24. accountStatus reflects the authoritative User document (SUSPENDED)", payload.currentState.accountStatus === "SUSPENDED", payload.currentState.accountStatus);
      check("25. operationalStatus reflects the authoritative FieldAgent document", payload.currentState.operationalStatus === "ACTIVE", payload.currentState.operationalStatus);
      check("Current-state values are not re-interpreted into a score (raw strings preserved verbatim)", typeof payload.currentState.kycStatus === "string");
    }

    // ── 26-27. FRAUD ADVISORY CONTEXT (counts only, no side effect) ──
    {
      const created = await mkFieldAgent();
      const fraudAgent = created.fieldAgent;

      const mkSignal = async (severity, createdAt) => {
        const s = await FraudSignal.create({
          signalType: "CROSS_AGENT_SALON_CYCLING",
          subjectType: "FIELD_AGENT",
          subjectRef: fraudAgent._id,
          fieldAgentRef: fraudAgent._id,
          severity,
          evidence: { note: "FA-11.2 test fixture" },
          sourceEventRef: oid(),
          dedupeKey: `ZTEST_FA11_${oid()}`,
          createdAt,
        });
        fixtureFraudSignalIds.push(s._id);
        return s;
      };
      await mkSignal("HIGH", new Date(windowStart.getTime() + 1 * MS_PER_DAY));
      await mkSignal("HIGH", NOW);
      await mkSignal("MEDIUM", NOW);
      await mkSignal("LOW", new Date(windowStart.getTime() - 5 * MS_PER_DAY)); // outside window — must not count

      const userBefore = await User.findById(created.agentUser._id).select("accountStatus").lean();
      const agentBefore = await FieldAgent.findById(fraudAgent._id).select("operationalStatus").lean();

      const payload = await computeFieldAgentPerformanceSnapshotPayload({ fieldAgentRef: fraudAgent._id, cycleKey: "FA11-2-FRAUD", now: NOW });

      check("26. fraudSignalCounts.HIGH = 2 (in-window only)", payload.rollingWindow.fraudSignalCounts.HIGH === 2, payload.rollingWindow.fraudSignalCounts.HIGH);
      check("26. fraudSignalCounts.MEDIUM = 1", payload.rollingWindow.fraudSignalCounts.MEDIUM === 1, payload.rollingWindow.fraudSignalCounts.MEDIUM);
      check("26. Out-of-window LOW signal excluded from fraudSignalCounts", payload.rollingWindow.fraudSignalCounts.LOW === undefined);

      const userAfter = await User.findById(created.agentUser._id).select("accountStatus").lean();
      const agentAfter = await FieldAgent.findById(fraudAgent._id).select("operationalStatus").lean();
      check("27. FraudSignal read has NO side effect on User.accountStatus", userBefore.accountStatus === userAfter.accountStatus);
      check("27. FraudSignal read has NO side effect on FieldAgent.operationalStatus", agentBefore.operationalStatus === agentAfter.operationalStatus);
      const fraudSignalCountAfter = await FraudSignal.countDocuments({ fieldAgentRef: fraudAgent._id });
      check("27. Computing a snapshot never writes a new FraudSignal row", fraudSignalCountAfter === 4, fraudSignalCountAfter);
    }

    // ── 28. ADMIN ACTION COUNT (context only) ────────────────────────
    {
      const created = await mkFieldAgent();
      const adminCtxAgent = created.fieldAgent;

      const mkAuditEvent = async (createdAt) => {
        const e = await FieldAgentAuditEvent.create({
          entityType: "FIELD_AGENT",
          entityId: adminCtxAgent._id,
          actorRef: indiaAdmin._id,
          actorType: "ADMIN",
          action: "FIELD_AGENT_APPROVED",
          createdAt,
        });
        fixtureAuditEventIds.push(e._id);
        return e;
      };
      await mkAuditEvent(new Date(windowStart.getTime() + 1 * MS_PER_DAY));
      await mkAuditEvent(NOW);
      await mkAuditEvent(new Date(windowStart.getTime() - 3 * MS_PER_DAY)); // outside window

      const payload = await computeFieldAgentPerformanceSnapshotPayload({ fieldAgentRef: adminCtxAgent._id, cycleKey: "FA11-2-ADMIN", now: NOW });
      check("28. adminActionCount counts only in-window admin-actor events on this agent", payload.rollingWindow.adminActionCount === 2, payload.rollingWindow.adminActionCount);
    }

    // ── 29-30. UNAVAILABLE FIELDS — SERVICE NEVER OVERRIDES ─────────
    {
      const created = await mkFieldAgent();
      const payload = await computeFieldAgentPerformanceSnapshotPayload({ fieldAgentRef: created.fieldAgent._id, cycleKey: "FA11-2-UNAVAIL", now: NOW });
      check("29. Calculation payload never sets its own 'unavailable' key (schema default is the sole authority)", payload.unavailable === undefined);

      const persisted = await createFieldAgentPerformanceSnapshot({ fieldAgentRef: created.fieldAgent._id, cycleKey: "FA11-2-UNAVAIL", now: NOW });
      fixtureSnapshotIds.push(persisted._id);
      check("29. Persisted snapshot carries the fixed supportRelationshipEvidence message", persisted.unavailable.supportRelationshipEvidence === "UNAVAILABLE — no authoritative Field Agent linkage in SupportTicket");
      check("30. Persisted snapshot carries the fixed complaintEvidence message", persisted.unavailable.complaintEvidence === "UNAVAILABLE — no complaint/grievance model exists");
    }

    // ── 31. NO BOOKING DEPENDENCY (already covered above as #11) ─────
    // ── 32. NO FINANCIAL WRITES ──────────────────────────────────────
    {
      const ledgerCountBeforeCalc = await FieldAgentEarningLedger.countDocuments();
      await computeFieldAgentPerformanceSnapshotPayload({ fieldAgentRef: acqAgent._id, cycleKey: "FA11-2-NOWRITE-CHECK", now: NOW });
      const ledgerCountAfterCalc = await FieldAgentEarningLedger.countDocuments();
      check("32. Calculation performs zero writes to FieldAgentEarningLedger", ledgerCountBeforeCalc === ledgerCountAfterCalc);
    }

    // ── 33. IDEMPOTENT CREATE VIA THE CONTROLLED PERSISTENCE PATH ────
    {
      const created = await mkFieldAgent();
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => createFieldAgentPerformanceSnapshot({ fieldAgentRef: created.fieldAgent._id, cycleKey: "FA11-2-IDEMPOTENT", now: NOW }))
      );
      const allFulfilled = results.every((r) => r.status === "fulfilled");
      check("33. createFieldAgentPerformanceSnapshot never throws under concurrent calls for the same cycle (idempotent)", allFulfilled, JSON.stringify(results.map((r) => r.status)));
      results.filter((r) => r.status === "fulfilled").forEach((r) => fixtureSnapshotIds.push(r.value._id));
      const docCount = await FieldAgentPerformanceSnapshot.countDocuments({ fieldAgentRef: created.fieldAgent._id, cycleKey: "FA11-2-IDEMPOTENT" });
      check("33. Exactly one snapshot document exists after 5 concurrent idempotent calls", docCount === 1, docCount);
    }

    // ── 34. DETERMINISTIC REPEATED CALCULATION ──────────────────────
    {
      const payloadA = await computeFieldAgentPerformanceSnapshotPayload({ fieldAgentRef: acqAgent._id, cycleKey: "FA11-2-DETERMINISM", now: NOW });
      const payloadB = await computeFieldAgentPerformanceSnapshotPayload({ fieldAgentRef: acqAgent._id, cycleKey: "FA11-2-DETERMINISM", now: NOW });
      const normalize = (p) => JSON.stringify(p, (k, v) => (v instanceof Map ? Object.fromEntries(v) : v));
      check("34. Repeated calculation with identical inputs produces byte-identical output", normalize(payloadA) === normalize(payloadB));
    }

    // ── 35. QUERY-PLAN VERIFICATION ──────────────────────────────────
    {
      const claimPlan = await AcquisitionClaim.find({ fieldAgentRef: acqAgent._id }).explain("queryPlanner");
      const claimPlanStr = JSON.stringify(claimPlan.queryPlanner?.winningPlan || {});
      check("35. AcquisitionClaim(fieldAgentRef) lookup uses an index scan, not COLLSCAN", claimPlanStr.includes("IXSCAN") && !claimPlanStr.includes("COLLSCAN"), claimPlanStr.slice(0, 200));

      const ledgerPlan = await FieldAgentEarningLedger.find({ fieldAgentRef: acqAgent._id }).explain("queryPlanner");
      const ledgerPlanStr = JSON.stringify(ledgerPlan.queryPlanner?.winningPlan || {});
      check("35. FieldAgentEarningLedger(fieldAgentRef) lookup uses an index scan, not COLLSCAN", ledgerPlanStr.includes("IXSCAN") && !ledgerPlanStr.includes("COLLSCAN"), ledgerPlanStr.slice(0, 200));

      const activeAssignmentPlan = await TerritoryAssignment.findOne({ fieldAgentRef: acqAgent._id, status: "ACTIVE" }).explain("queryPlanner");
      const activeAssignmentPlanStr = JSON.stringify(activeAssignmentPlan.queryPlanner?.winningPlan || {});
      check("35. TerritoryAssignment(fieldAgentRef,status=ACTIVE) lookup uses the partial unique index", activeAssignmentPlanStr.includes("IXSCAN") && !activeAssignmentPlanStr.includes("COLLSCAN"), activeAssignmentPlanStr.slice(0, 200));

      const fullHistoryPlan = await TerritoryAssignment.find({ fieldAgentRef: acqAgent._id }).explain("queryPlanner");
      const fullHistoryPlanStr = JSON.stringify(fullHistoryPlan.queryPlanner?.winningPlan || {});
      check(
        "35. FINDING (documented, not a failure): TerritoryAssignment(fieldAgentRef) full-history query has no covering index (partial index cannot serve a status-less query) — COLLSCAN confirmed, flagged for explicit approval before FA-11.4",
        fullHistoryPlanStr.includes("COLLSCAN")
      );

      const fraudPlan = await FraudSignal.find({ fieldAgentRef: acqAgent._id }).explain("queryPlanner");
      const fraudPlanStr = JSON.stringify(fraudPlan.queryPlanner?.winningPlan || {});
      check("35. FraudSignal(fieldAgentRef) lookup uses an index scan, not COLLSCAN", fraudPlanStr.includes("IXSCAN") && !fraudPlanStr.includes("COLLSCAN"), fraudPlanStr.slice(0, 200));

      const auditPlan = await FieldAgentAuditEvent.find({ entityType: "FIELD_AGENT", entityId: acqAgent._id }).explain("queryPlanner");
      const auditPlanStr = JSON.stringify(auditPlan.queryPlanner?.winningPlan || {});
      check("35. FieldAgentAuditEvent(entityType,entityId) lookup uses an index scan, not COLLSCAN", auditPlanStr.includes("IXSCAN") && !auditPlanStr.includes("COLLSCAN"), auditPlanStr.slice(0, 200));
    }

    // ── 36. N+1 PROTECTION (bounded query count regardless of claim volume) ─
    {
      const created = await mkFieldAgent();
      const manyClaimsAgent = created.fieldAgent;
      const manyClaims = [];
      for (let i = 0; i < 15; i++) {
        manyClaims.push({ salonRef: oid(), fieldAgentRef: manyClaimsAgent._id, status: "ENDED", endedReason: "AGENT_WITHDRAWN", endedAt: NOW, createdAt: new Date(windowStart.getTime() + i * 1000) });
      }
      const inserted = await AcquisitionClaim.insertMany(manyClaims);
      inserted.forEach((c) => fixtureClaimIds.push(c._id));

      const t0 = Date.now();
      await computeFieldAgentPerformanceSnapshotPayload({ fieldAgentRef: manyClaimsAgent._id, cycleKey: "FA11-2-N1", now: NOW });
      const durationWith15Claims = Date.now() - t0;

      const t1 = Date.now();
      await computeFieldAgentPerformanceSnapshotPayload({ fieldAgentRef: acqAgent._id, cycleKey: "FA11-2-N1-BASELINE", now: NOW });
      const durationWithFewClaims = Date.now() - t1;

      // Structural guarantee (by construction — one find() + one $in
      // lookup, never a per-claim query) means duration should not
      // scale linearly with claim count. A generous 10x ceiling
      // catches a real per-claim-query regression without being flaky
      // on normal latency jitter.
      check(
        "36. Calculation time does not scale linearly with claim count (no per-claim query loop)",
        durationWith15Claims < durationWithFewClaims * 10 + 200,
        { durationWith15Claims, durationWithFewClaims }
      );
    }

    // ── 37. AUTHORIZATION-INDEPENDENT SERVICE BEHAVIOR ───────────────
    {
      // The service takes only (fieldAgentRef, cycleKey, now) — no
      // admin/session/role parameter exists, so its behavior is
      // structurally identical regardless of caller identity.
      const payload = await computeFieldAgentPerformanceSnapshotPayload({ fieldAgentRef: acqAgent._id, cycleKey: "FA11-2-AUTHZ-INDEPENDENT", now: NOW });
      check("37. Service succeeds with no authorization/session context passed at all", !!payload);
    }

    // ── 38. MALFORMED/MISSING AGENT HANDLING ─────────────────────────
    {
      let threwNotFound = false;
      try {
        await computeFieldAgentPerformanceSnapshotPayload({ fieldAgentRef: oid(), cycleKey: "FA11-2-MISSING", now: NOW });
      } catch (err) {
        threwNotFound = err.statusCode === 404 || /not found/i.test(err.message || "");
      }
      check("38. Non-existent fieldAgentRef throws NotFound rather than producing a garbage snapshot", threwNotFound);
    }
  } finally {
    // ── CLEANUP (explicit ID lists only — never a broad delete) ──────
    await FieldAgentAuditEvent.collection.deleteMany({ $or: [{ entityId: { $in: fixturePolicyIds } }, { _id: { $in: fixtureAuditEventIds } }] });
    await FieldAgentPerformanceSnapshot.collection.deleteMany({ _id: { $in: fixtureSnapshotIds } });
    await PerformancePolicyVersion.collection.deleteMany({ _id: { $in: fixturePolicyIds } });
    await AcquisitionEarningProgress.deleteMany({ _id: { $in: fixtureProgressIds } });
    await AcquisitionClaim.deleteMany({ _id: { $in: fixtureClaimIds } });
    await FieldAgentEarningLedger.collection.deleteMany({ _id: { $in: fixtureLedgerIds } });
    await TerritoryPartnerTermSnapshot.collection.deleteMany({ _id: { $in: fixtureTermSnapshotIds } });
    await TerritoryAssignment.deleteMany({ _id: { $in: fixtureAssignmentIds } });
    await FraudSignal.collection.deleteMany({ _id: { $in: fixtureFraudSignalIds } });
    await KYC.deleteMany({ _id: { $in: fixtureKycIds } });
    await FieldAgentTraining.deleteMany({ _id: { $in: fixtureTrainingIds } });
    await TestAttempt.deleteMany({ _id: { $in: fixtureTestAttemptIds } });
    await FieldAgent.deleteMany({ _id: { $in: fixtureFieldAgentIds } });
    await User.deleteMany({ _id: { $in: fixtureUserIds } });

    const residue = {
      policies: await PerformancePolicyVersion.countDocuments({ _id: { $in: fixturePolicyIds } }),
      snapshots: await FieldAgentPerformanceSnapshot.countDocuments({ _id: { $in: fixtureSnapshotIds } }),
      fieldAgents: await FieldAgent.countDocuments({ _id: { $in: fixtureFieldAgentIds } }),
      users: await User.countDocuments({ _id: { $in: fixtureUserIds } }),
      claims: await AcquisitionClaim.countDocuments({ _id: { $in: fixtureClaimIds } }),
      progress: await AcquisitionEarningProgress.countDocuments({ _id: { $in: fixtureProgressIds } }),
      ledger: await FieldAgentEarningLedger.countDocuments({ _id: { $in: fixtureLedgerIds } }),
      assignments: await TerritoryAssignment.countDocuments({ _id: { $in: fixtureAssignmentIds } }),
      termSnapshots: await TerritoryPartnerTermSnapshot.countDocuments({ _id: { $in: fixtureTermSnapshotIds } }),
      fraudSignals: await FraudSignal.countDocuments({ _id: { $in: fixtureFraudSignalIds } }),
      kyc: await KYC.countDocuments({ _id: { $in: fixtureKycIds } }),
      training: await FieldAgentTraining.countDocuments({ _id: { $in: fixtureTrainingIds } }),
      testAttempts: await TestAttempt.countDocuments({ _id: { $in: fixtureTestAttemptIds } }),
      auditEvents: await FieldAgentAuditEvent.countDocuments({ _id: { $in: fixtureAuditEventIds } }),
    };
    const zeroResidue = Object.values(residue).every((n) => n === 0);
    check("Zero residue — all FA-11 fixtures removed", zeroResidue, residue);
  }

  // ── PRODUCTION BOUNDARY (captured AFTER cleanup, per test-safety rule) ──
  {
    const after = {
      ledger: await FieldAgentEarningLedger.countDocuments(),
      gaps: await FieldAgentEarningPolicyGap.countDocuments(),
      checkpoint: await FieldAgentEarningJobCheckpoint.findById("FIELD_AGENT_EARNING_CURSOR").lean(),
      progress: await AcquisitionEarningProgress.countDocuments(),
      termSnapshots: await TerritoryPartnerTermSnapshot.countDocuments(),
      territories: await CommercialTerritory.countDocuments(),
      assignments: await TerritoryAssignment.countDocuments(),
      claims: await AcquisitionClaim.countDocuments(),
      publishedPolicies: await PerformancePolicyVersion.countDocuments({ status: "PUBLISHED" }),
      realSnapshots: await FieldAgentPerformanceSnapshot.countDocuments(),
    };
    check("33. FieldAgentEarningLedger count unchanged after cleanup", after.ledger === before.ledger, { before: before.ledger, after: after.ledger });
    check("33. FieldAgentEarningPolicyGap count unchanged (still 46 legitimate gaps)", after.gaps === before.gaps, { before: before.gaps, after: after.gaps });
    check(
      "33. FA-9 earning checkpoint unchanged",
      before.checkpoint?.lastCompletedAt?.toISOString() === after.checkpoint?.lastCompletedAt?.toISOString() &&
        String(before.checkpoint?.lastId) === String(after.checkpoint?.lastId)
    );
    check("33. AcquisitionEarningProgress count unchanged", after.progress === before.progress, { before: before.progress, after: after.progress });
    check("33. TerritoryPartnerTermSnapshot count unchanged", after.termSnapshots === before.termSnapshots, { before: before.termSnapshots, after: after.termSnapshots });
    check("33. CommercialTerritory count unchanged", after.territories === before.territories, { before: before.territories, after: after.territories });
    check("33. TerritoryAssignment count unchanged", after.assignments === before.assignments, { before: before.assignments, after: after.assignments });
    check("33. AcquisitionClaim count unchanged", after.claims === before.claims, { before: before.claims, after: after.claims });
    check("No real (non-fixture) PerformancePolicyVersion left PUBLISHED", after.publishedPolicies === 0, after.publishedPolicies);
    check("No real (non-fixture) FieldAgentPerformanceSnapshot remains", after.realSnapshots === 0, after.realSnapshots);
  }

  console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)\n`);
  await mongoose.connection.close();
  process.exit(failed > 0 ? 1 : 0);
};

run().catch(async (err) => {
  console.error("❌ FA-11 verification body threw:", err);
  try {
    await mongoose.connection.close();
  } catch {}
  process.exit(1);
});
