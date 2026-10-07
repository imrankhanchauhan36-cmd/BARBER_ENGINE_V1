/**
 * BARBER_ENGINE_V1
 * backend/scripts/auditFieldAgentGeographyPhaseD.mjs
 *
 * MUST-DO-NOW #5 — PHASE D AUDIT ONLY. STRICTLY READ-ONLY against the
 * real shared Atlas database: every single call in this file is one
 * of find/findOne/countDocuments/distinct/.lean() — there is no
 * .create()/.insertMany()/.updateOne()/.updateMany()/.save()/
 * .deleteOne()/.deleteMany() anywhere below. It exists purely to dump
 * structured facts for a human-written classification; it makes no
 * classification decision itself and performs no migration.
 *
 * Run:
 *   cd backend
 *   node scripts/auditFieldAgentGeographyPhaseD.mjs
 */

import "dotenv/config";
import connectDB from "../config/db.js";
import mongoose from "mongoose";

import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import FieldAgentGeographyAssignment from "../modules/fieldAgent/models/FieldAgentGeographyAssignment.js";
import FieldAgentApplication from "../modules/fieldAgent/models/FieldAgentApplication.js";
import FieldAgentAuditEvent from "../modules/fieldAgent/models/FieldAgentAuditEvent.js";
import FieldAgentEarningLedger from "../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import FieldAgentPayoutRequest from "../modules/fieldAgent/models/FieldAgentPayoutRequest.js";
import CommercialTerritory from "../modules/fieldAgent/models/CommercialTerritory.js";
import TerritoryAssignment from "../modules/fieldAgent/models/TerritoryAssignment.js";
import AcquisitionClaim from "../modules/fieldAgent/models/AcquisitionClaim.js";
import AcquisitionReferral from "../modules/fieldAgent/models/AcquisitionReferral.js";
import Salon from "../models/Salon.js";
import Booking from "../models/Booking.js";
import Transaction from "../models/Transaction.js";
import WalletLedger from "../models/WalletLedger.js";
import SalonEarnings from "../models/SalonEarnings.js";
import State from "../models/State.js";
import District from "../models/District.js";

const run = async () => {
  await connectDB();

  // ── 1. BASELINE COUNTS (read-only) ────────────────────────────────
  const baseline = {
    FieldAgent: await FieldAgent.countDocuments({}),
    FieldAgentGeographyAssignment: await FieldAgentGeographyAssignment.countDocuments({}),
    FieldAgentApplication: await FieldAgentApplication.countDocuments({}),
    FieldAgentAuditEvent: await FieldAgentAuditEvent.countDocuments({}),
    FieldAgentEarningLedger: await FieldAgentEarningLedger.countDocuments({}),
    FieldAgentPayoutRequest: await FieldAgentPayoutRequest.countDocuments({}),
    CommercialTerritory: await CommercialTerritory.countDocuments({}),
    TerritoryAssignment: await TerritoryAssignment.countDocuments({}),
    AcquisitionClaim: await AcquisitionClaim.countDocuments({}),
    AcquisitionReferral: await AcquisitionReferral.countDocuments({}),
    Salon: await Salon.countDocuments({}),
    Booking: await Booking.countDocuments({}),
    Transaction: await Transaction.countDocuments({}),
    WalletLedger: await WalletLedger.countDocuments({}),
    SalonEarnings: await SalonEarnings.countDocuments({}),
  };
  console.log("=== BASELINE COUNTS ===");
  console.log(JSON.stringify(baseline, null, 2));

  const opStatusDist = await FieldAgent.aggregate([{ $group: { _id: "$operationalStatus", count: { $sum: 1 } } }]);
  const commercialPathDist = await FieldAgent.aggregate([{ $group: { _id: "$commercialPath", count: { $sum: 1 } } }]);
  console.log("\n=== FieldAgent.operationalStatus distribution ===");
  console.log(JSON.stringify(opStatusDist, null, 2));
  console.log("\n=== FieldAgent.commercialPath distribution ===");
  console.log(JSON.stringify(commercialPathDist, null, 2));

  // ── 2. FULL FIELD AGENT INVENTORY ─────────────────────────────────
  const agents = await FieldAgent.find({}).select("agentCode commercialPath operationalStatus createdAt userRef applicationRef").lean();
  console.log(`\n=== FIELD AGENT COUNT CONFIRMED: ${agents.length} ===`);

  // Pre-fetch all TerritoryAssignments (any status) for these agents
  const agentIds = agents.map((a) => a._id);
  const allTAs = await TerritoryAssignment.find({ fieldAgentRef: { $in: agentIds } })
    .select("fieldAgentRef territoryRef status effectiveFrom effectiveUntil assignedBy")
    .lean();
  const taByAgent = new Map();
  for (const ta of allTAs) {
    const key = String(ta.fieldAgentRef);
    if (!taByAgent.has(key)) taByAgent.set(key, []);
    taByAgent.get(key).push(ta);
  }

  // Pre-fetch all referenced CommercialTerritory docs
  const territoryIds = [...new Set(allTAs.map((ta) => String(ta.territoryRef)))];
  const territories = await CommercialTerritory.find({ _id: { $in: territoryIds } })
    .select("name scopeType stateRef districtRef cityRef areaRefs status")
    .lean();
  const territoryById = new Map(territories.map((t) => [String(t._id), t]));

  // Pre-fetch all referenced State/District names
  const stateIds = [...new Set(territories.map((t) => t.stateRef && String(t.stateRef)).filter(Boolean))];
  const districtIds = [...new Set(territories.map((t) => t.districtRef && String(t.districtRef)).filter(Boolean))];
  const states = await State.find({ _id: { $in: stateIds } }).select("name").lean();
  const districts = await District.find({ _id: { $in: districtIds } }).select("name stateRef").lean();
  const stateById = new Map(states.map((s) => [String(s._id), s]));
  const districtById = new Map(districts.map((d) => [String(d._id), d]));

  // Pre-fetch FieldAgentApplication for these agents (by applicationRef AND by userRef, in case of drift)
  const applicationRefs = agents.map((a) => a.applicationRef).filter(Boolean);
  const applications = await FieldAgentApplication.find({ _id: { $in: applicationRefs } })
    .select("userRef requestedZone status createdAt")
    .lean();
  const applicationById = new Map(applications.map((app) => [String(app._id), app]));

  // Pre-fetch geography/territory-relevant audit events for these agents
  const auditEvents = await FieldAgentAuditEvent.find({
    entityId: { $in: agentIds },
    action: { $regex: /GEOGRAPHY|TERRITORY|COMMERCIAL_MODEL/ },
  }).select("entityId entityType action actorType newValue oldValue createdAt").lean();
  const auditByAgent = new Map();
  for (const ev of auditEvents) {
    const key = String(ev.entityId);
    if (!auditByAgent.has(key)) auditByAgent.set(key, []);
    auditByAgent.get(key).push(ev);
  }

  // Pre-fetch AcquisitionClaim counts per agent (context only, per ticket's own rule — never used for geography inference)
  const claimCounts = await AcquisitionClaim.aggregate([
    { $match: { fieldAgentRef: { $in: agentIds } } },
    { $group: { _id: "$fieldAgentRef", count: { $sum: 1 } } },
  ]);
  const claimCountByAgent = new Map(claimCounts.map((c) => [String(c._id), c.count]));

  console.log("\n=== PER-AGENT INVENTORY ===");
  for (const agent of agents) {
    const key = String(agent._id);
    const tas = taByAgent.get(key) || [];
    const tasResolved = tas.map((ta) => {
      const territory = territoryById.get(String(ta.territoryRef));
      return {
        territoryAssignmentId: ta._id,
        status: ta.status,
        effectiveFrom: ta.effectiveFrom,
        effectiveUntil: ta.effectiveUntil,
        territoryExists: !!territory,
        territoryName: territory?.name ?? null,
        territoryStatus: territory?.status ?? null,
        scopeType: territory?.scopeType ?? null,
        stateRef: territory?.stateRef ?? null,
        stateName: territory?.stateRef ? (stateById.get(String(territory.stateRef))?.name ?? "UNRESOLVED") : null,
        districtRef: territory?.districtRef ?? null,
        districtName: territory?.districtRef ? (districtById.get(String(territory.districtRef))?.name ?? "UNRESOLVED") : null,
        districtBelongsToState: territory?.districtRef && territory?.stateRef
          ? String(districtById.get(String(territory.districtRef))?.stateRef) === String(territory.stateRef)
          : null,
      };
    });

    const application = agent.applicationRef ? applicationById.get(String(agent.applicationRef)) : null;
    const applicationMissing = !!agent.applicationRef && !application;

    const events = auditByAgent.get(key) || [];

    console.log(JSON.stringify({
      fieldAgentId: agent._id,
      agentCode: agent.agentCode,
      commercialPath: agent.commercialPath,
      operationalStatus: agent.operationalStatus,
      createdAt: agent.createdAt,
      applicationRef: agent.applicationRef ?? null,
      applicationMissing,
      applicationRequestedZone: application?.requestedZone ?? null,
      applicationStatus: application?.status ?? null,
      territoryAssignments: tasResolved,
      geographyAuditEvents: events.map((e) => ({ action: e.action, actorType: e.actorType, createdAt: e.createdAt, newValue: e.newValue })),
      acquisitionClaimCount_contextOnly: claimCountByAgent.get(key) || 0,
    }));
  }

  // ── 3. ORPHAN DETECTION ────────────────────────────────────────────
  console.log("\n=== ORPHAN CHECKS ===");
  const allTAsEver = await TerritoryAssignment.find({}).select("fieldAgentRef territoryRef status").lean();
  const orphanTAsMissingAgent = [];
  const orphanTAsMissingTerritory = [];
  const allAgentIdSet = new Set((await FieldAgent.find({}).select("_id").lean()).map((a) => String(a._id)));
  const allTerritoryIdSet = new Set((await CommercialTerritory.find({}).select("_id").lean()).map((t) => String(t._id)));
  for (const ta of allTAsEver) {
    if (!allAgentIdSet.has(String(ta.fieldAgentRef))) orphanTAsMissingAgent.push(ta._id);
    if (!allTerritoryIdSet.has(String(ta.territoryRef))) orphanTAsMissingTerritory.push(ta._id);
  }
  console.log(`TerritoryAssignment rows (any status): ${allTAsEver.length}`);
  console.log(`Orphan TerritoryAssignment -> missing FieldAgent: ${orphanTAsMissingAgent.length} ${JSON.stringify(orphanTAsMissingAgent)}`);
  console.log(`Orphan TerritoryAssignment -> missing CommercialTerritory: ${orphanTAsMissingTerritory.length} ${JSON.stringify(orphanTAsMissingTerritory)}`);

  const allApplications = await FieldAgentApplication.find({}).select("_id userRef").lean();
  const agentsByApplicationRef = new Set(agents.map((a) => a.applicationRef && String(a.applicationRef)).filter(Boolean));
  const applicationsWithNoFieldAgent = allApplications.filter((app) => !agentsByApplicationRef.has(String(app._id)));
  console.log(`FieldAgentApplication rows total: ${allApplications.length}`);
  console.log(`Applications with no corresponding FieldAgent.applicationRef: ${applicationsWithNoFieldAgent.length} ${JSON.stringify(applicationsWithNoFieldAgent.map(a=>a._id))}`);

  console.log("\n=== DONE — NO WRITES PERFORMED ===");

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
