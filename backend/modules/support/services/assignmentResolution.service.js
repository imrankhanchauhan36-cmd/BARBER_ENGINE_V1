/**
 * BARBER ENGINE V1
 * backend/modules/support/services/assignmentResolution.service.js
 *
 * Phase F.2 — Agent Assignment Resolution Engine.
 * Phase F.3.3 — integrated with SupportAgentWorkload's atomic
 * reserve/ensure primitives (replacing the countDocuments-based
 * in-transaction re-check as the hot-path capacity gate) and with
 * ticketLifecycle.service.js's QUEUED->ASSIGNED transition on a
 * successful assignment. The F.2 eligibility/ranking algorithm itself
 * (filterEligibleAgents, getEligibleAgents, getAgentPresence,
 * getActiveAssignmentCounts, selectLeastLoadedAgent,
 * rankEligibleAgents) is unmodified — getActiveAssignmentCounts still
 * uses SupportAssignment.aggregate() for ranking/tie-break ordering
 * only, which is a read, not a capacity gate, and stays exactly as
 * F.2 built it.
 *
 * resolveAssignment() itself consumes an already-resolved routing
 * decision's targetQueueRef/targetTeamRef and picks a single eligible
 * agent within the resolved team, or leaves the ticket QUEUED with no
 * agent if none qualifies — it still never imports or duplicates
 * routingResolution.service.js's own logic. Phase F.3.6 adds one new
 * orchestration function, routeAndAssignTicket(), that is the first
 * real caller of routingResolution.service.js's resolveRouting() —
 * sequencing it with this file's own resolveAssignment(), never
 * reimplementing either engine's internals.
 *
 * Security note (Phase F §7): targetQueueRef/targetTeamRef must only
 * ever be sourced from a routing decision (Phase E.2's output) by the
 * caller — this service has no controller/route this phase and takes
 * no client-facing input at all; categoryRef/language are derived
 * from the persisted SupportTicket document itself, never accepted as
 * caller-supplied values, so a compromised or careless caller cannot
 * steer eligibility by passing arbitrary category/language values.
 *
 * Redis is accessed via the existing shared client (config/redis.js),
 * the same import/try-catch/fail-safe pattern already used in
 * services/session.service.js and services/slotEngine.service.js —
 * no new Redis client, no new connection.
 */

import mongoose from "mongoose";
import redis from "../../../config/redis.js";
import logger from "../../../utils/logger.js";
import SupportAgentProfile from "../models/SupportAgentProfile.js";
import SupportAssignment from "../models/SupportAssignment.js";
import SupportTicket from "../models/SupportTicket.js";
import { ensureAgentWorkload, reserveAgentCapacity, releaseAgentCapacity } from "../models/SupportAgentWorkload.js";
import {
  ACTOR_TYPE,
  AUDIT_ACTION,
  ASSIGNMENT_STATUS,
  ASSIGNMENT_REASON,
  AGENT_AVAILABILITY_STATUS,
  TICKET_STATUS,
} from "../constants/support.constants.js";
import { transitionTicketStatus } from "./ticketLifecycle.service.js";
import { recordSupportAuditEvent } from "./supportAudit.service.js";
import { resolveRouting } from "./routingResolution.service.js";

const MAX_CANDIDATE_ATTEMPTS = 5; // bounded retry, mirrors createTicket's own MAX_TICKET_NUMBER_ATTEMPTS idiom

const presenceKey = (agentId) => `support:agent:presence:${agentId}`;

// Bounded safety valve for sweepQueuedTicketsForAgent(), matching the
// exact "MAX_ITERATIONS_PER_RUN" idiom already used by
// jobs/slaScanner.job.js — a catch-up sweep triggered by one agent
// coming online must never turn into an unbounded scan of every
// QUEUED ticket in the system.
const MAX_SWEEP_TICKETS = 20;

// Presence is a live, self-reported signal (Phase F §11) — a TTL is a
// safety net against a crashed/closed agent tab leaving a stale
// AVAILABLE key forever; letting it expire back to the fail-safe
// OFFLINE default (getAgentPresence's own missing-key behavior) is
// strictly safer than no TTL at all. 12h comfortably covers a full
// shift without requiring the client to re-heartbeat.
const PRESENCE_TTL_SECONDS = 12 * 60 * 60;

const PRESENCE_SETTABLE_VALUES = new Set([
  AGENT_AVAILABILITY_STATUS.AVAILABLE,
  AGENT_AVAILABILITY_STATUS.BUSY,
  AGENT_AVAILABILITY_STATUS.OFFLINE,
]);

/**
 * Hard filters 1,3,4,5,7 (team membership, not deleted, category,
 * language, not ON_LEAVE/DISABLED) applied in memory over an
 * already-fetched, team-scoped candidate list. Pure — no I/O — kept
 * separate from the Mongo query below (same idiom as Phase E.2's
 * selectWinningRule/selectCoverageWinner) both so it's directly
 * testable without a DB connection, and because category/language/
 * availabilityStatus aren't part of the {teamRefs,isActive} index —
 * folding them into the Mongo filter would only widen a query that
 * index can't fully serve anyway, over a candidate pool that's
 * already small once scoped to one team (Phase F §11/§19).
 */
export function filterEligibleAgents(agentProfiles, { teamRef, categoryRef, language }) {
  return (agentProfiles || []).filter((agent) => {
    if (agent.isActive === false) return false;
    if (agent.isDeleted) return false;
    if (!Array.isArray(agent.teamRefs) || !agent.teamRefs.some((t) => String(t) === String(teamRef))) return false;
    if (!Array.isArray(agent.categoryRefs) || !agent.categoryRefs.some((c) => String(c) === String(categoryRef))) return false;
    if (!Array.isArray(agent.languages) || !agent.languages.includes(language)) return false;
    if (
      agent.availabilityStatus === AGENT_AVAILABILITY_STATUS.ON_LEAVE ||
      agent.availabilityStatus === AGENT_AVAILABILITY_STATUS.DISABLED
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Filter 2 (isActive) plus team scoping happen here, as the one
 * indexed Mongo query — hits {teamRefs,isActive} (Phase F.1's own
 * index), team-scoped first (Phase F §3), never a global scan. The
 * remaining filters run via filterEligibleAgents() above.
 */
export async function getEligibleAgents({ teamRef, categoryRef, language }) {
  const teamScoped = await SupportAgentProfile.find({
    teamRefs: teamRef,
    isActive: true,
  })
    .sort({ createdAt: 1, _id: 1 })
    .lean();

  return filterEligibleAgents(teamScoped, { teamRef, categoryRef, language });
}

/**
 * Filter 6 — Redis is the sole source of real-time AVAILABLE/BUSY
 * presence. Fail-safe: a missing key, an unreadable key, or a Redis
 * outage all resolve to OFFLINE for that agent — never AVAILABLE.
 * A single agent's read failure never fails the whole batch, and a
 * total Redis outage degrades every agent to OFFLINE rather than
 * throwing (matching config/redis.js's own app-wide "continue without
 * cache" philosophy).
 */
export async function getAgentPresence(agentIds) {
  const presence = new Map(agentIds.map((id) => [String(id), AGENT_AVAILABILITY_STATUS.OFFLINE]));

  await Promise.all(
    agentIds.map(async (agentId) => {
      try {
        const value = await redis.get(presenceKey(agentId));
        if (value === AGENT_AVAILABILITY_STATUS.AVAILABLE) {
          presence.set(String(agentId), AGENT_AVAILABILITY_STATUS.AVAILABLE);
        } else if (value === AGENT_AVAILABILITY_STATUS.BUSY) {
          presence.set(String(agentId), AGENT_AVAILABILITY_STATUS.BUSY);
        }
        // Any other value, or no key at all — stays at the OFFLINE
        // default already set above.
      } catch (err) {
        logger.warn("[assignmentResolution] Redis presence read failed, treating agent as OFFLINE", {
          agentId: String(agentId),
          error: err.message,
        });
        // presence already defaults to OFFLINE — nothing further to do.
      }
    })
  );

  return presence;
}

/**
 * Phase F.4 — the missing self-service half of the presence layer.
 * getAgentPresence() above has always been able to READ this Redis
 * key; nothing anywhere ever WROTE it in production (the only writer
 * in the whole codebase was scripts/seedSupportTestConfig.js, a
 * regression-test fixture) — confirmed by a repo-wide grep before
 * writing this function, not assumed. Every real agent therefore
 * defaulted to OFFLINE forever, so rankEligibleAgents() filtered every
 * candidate out on every ticket, regardless of how correctly team/
 * category/routing/coverage/capacity were configured. This is the
 * confirmed root cause of tickets landing with a resolved TEAM but a
 * permanently blank AGENT.
 *
 * Mirrors the value into SupportAgentProfile.availabilityStatus too —
 * durable, so the Admin Agents list (supportAgent.service.js's
 * listAgents/getAgentById, which already reads this exact field)
 * reflects reality instead of the create-time OFFLINE default forever.
 * This does NOT change the ranking engine itself: rankEligibleAgents()
 * still reads live Redis presence exclusively, unmodified — this
 * mirror is a read-model convenience only, never a second source of
 * truth for assignment eligibility.
 */
export async function setAgentPresence({ agentId, status }) {
  if (!PRESENCE_SETTABLE_VALUES.has(status)) {
    throw new Error(`Invalid presence status: ${status}`);
  }

  if (status === AGENT_AVAILABILITY_STATUS.OFFLINE) {
    await redis.del(presenceKey(agentId));
  } else {
    await redis.set(presenceKey(agentId), status, { EX: PRESENCE_TTL_SECONDS });
  }

  await SupportAgentProfile.updateOne({ userRef: agentId, isDeleted: false }, { $set: { availabilityStatus: status } });

  return { status };
}

/**
 * Read-only counterpart for the UI's own initial hydration (so a
 * reloaded page shows the agent's actual current toggle state instead
 * of always starting blank). Deliberately reuses getAgentPresence's
 * own fail-safe-to-OFFLINE behavior for a missing/expired key — never
 * reports AVAILABLE from a stale source the ranking engine itself
 * wouldn't trust.
 */
export async function getMyPresenceStatus(agentId) {
  const presence = await getAgentPresence([agentId]);
  return presence.get(String(agentId)) || AGENT_AVAILABILITY_STATUS.OFFLINE;
}

/**
 * Phase F.4 — catch-up sweep. Escalation's own handoffToAgent() already
 * retries resolveAssignment() once, at the moment of escalation
 * (assignmentResolution.service.js's existing behavior, unmodified).
 * If nobody was AVAILABLE at that exact moment, the ticket is correctly
 * left QUEUED with its resolved team/queue preserved and no further
 * automatic retry ever happens — until now. Called (best-effort,
 * non-blocking) exactly when an agent transitions TO AVAILABLE: the one
 * moment new capacity has genuinely just appeared. Never reimplements
 * eligibility/ranking — every candidate ticket still goes through the
 * exact same resolveAssignment() every other caller uses, so the
 * just-arrived agent is simply one more candidate in that engine's own
 * least-loaded ranking, not a guaranteed recipient.
 *
 * Scoped to QUEUED tickets whose currentAssignment.teamRef already
 * matches one of this agent's teams and whose agentRef is still null —
 * exactly the NO_AGENT_AVAILABLE outcome shape setUnassignedCurrent
 * Assignment() leaves behind. A ticket with no team resolved at all
 * (NO_TEAM_RESOLVED — a routing/coverage configuration gap, not a
 * presence gap) is out of scope here, same as routeAndAssignTicket's
 * own division of responsibility.
 */
export async function sweepQueuedTicketsForAgent({ agentUserId }) {
  const profile = await SupportAgentProfile.findOne({ userRef: agentUserId, isDeleted: false })
    .select("teamRefs")
    .lean();
  if (!profile || !Array.isArray(profile.teamRefs) || profile.teamRefs.length === 0) {
    return { attempted: 0, assigned: 0 };
  }

  const candidates = await SupportTicket.find({
    isDeleted: false,
    status: TICKET_STATUS.QUEUED,
    "currentAssignment.teamRef": { $in: profile.teamRefs },
    "currentAssignment.agentRef": null,
  })
    .select("_id currentAssignment")
    .sort({ createdAt: 1 })
    .limit(MAX_SWEEP_TICKETS)
    .lean();

  let assigned = 0;
  for (const candidate of candidates) {
    try {
      const result = await resolveAssignment({
        ticketId: candidate._id,
        targetQueueRef: candidate.currentAssignment?.queueRef ?? null,
        targetTeamRef: candidate.currentAssignment?.teamRef,
      });
      if (result.reason === "ASSIGNED") assigned += 1;
    } catch (err) {
      logger.warn("[assignmentResolution] sweep assignment attempt failed (non-critical)", {
        ticketId: String(candidate._id),
        error: err.message,
      });
    }
  }

  return { attempted: candidates.length, assigned };
}

/**
 * Filter 8's live-count half — workload computed against
 * SupportAssignment, never a stored counter (Phase F.1 deliberately
 * has no currentActiveTicketCount). Scoped to the already-narrowed
 * candidate agentIds via $in — never a global SupportAssignment scan
 * — and hits the {agentRef,status} index exactly.
 */
export async function getActiveAssignmentCounts(agentIds, session = null) {
  if (!agentIds.length) return new Map();

  const agg = SupportAssignment.aggregate([
    { $match: { agentRef: { $in: agentIds }, status: ASSIGNMENT_STATUS.ACTIVE } },
    { $group: { _id: "$agentRef", count: { $sum: 1 } } },
  ]);
  if (session) agg.session(session);

  const rows = await agg;
  const counts = new Map(agentIds.map((id) => [String(id), 0]));
  for (const row of rows) counts.set(String(row._id), row.count);
  return counts;
}

/**
 * Deterministic ranking (Phase F §1): lowest active count wins, tied
 * candidates broken by SupportAgentProfile.createdAt ascending, final
 * tie by _id ascending. Pure — no I/O — same idiom as Phase E.2's
 * selectWinningRule/selectCoverageWinner.
 */
export function selectLeastLoadedAgent(candidates) {
  if (!candidates || candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => {
    if (a.activeCount !== b.activeCount) return a.activeCount - b.activeCount;
    const aCreated = new Date(a.agent.createdAt).getTime();
    const bCreated = new Date(b.agent.createdAt).getTime();
    if (aCreated !== bCreated) return aCreated - bCreated;
    return String(a.agent._id).localeCompare(String(b.agent._id));
  });

  return sorted[0].agent;
}

/**
 * Combines hard filters 6 (Redis presence) and 8 (capacity) over an
 * already Mongo-filtered candidate list, then ranks. Pure composition
 * of already-fetched presence/count maps — no I/O itself.
 *
 * maxActiveTickets === null (unconfigured) is treated as INELIGIBLE,
 * not "unlimited" — a fail-closed reading consistent with this
 * engine's Redis fail-safe philosophy: an agent an admin never gave a
 * capacity ceiling to must not receive assignments by default.
 */
export function rankEligibleAgents(candidates, presenceMap, countsMap) {
  const rankable = candidates
    // presenceMap/countsMap are keyed by the candidate's User identity
    // (SupportAgentProfile.userRef), not the profile document's own
    // _id — the caller (resolveAssignment) builds both maps from
    // agent.userRef. Looking these up by agent._id here would silently
    // miss every entry (Defect #1 — confirmed live: an agent's Redis
    // presence, correctly set under their real User._id, was never
    // found because this function checked it under the profile's _id
    // instead, making every agent appear OFFLINE regardless of real
    // presence).
    .filter((agent) => presenceMap.get(String(agent.userRef)) === AGENT_AVAILABILITY_STATUS.AVAILABLE)
    .map((agent) => ({ agent, activeCount: countsMap.get(String(agent.userRef)) ?? 0 }))
    .filter(
      ({ agent, activeCount }) =>
        typeof agent.maxActiveTickets === "number" && activeCount < agent.maxActiveTickets
    );

  return selectLeastLoadedAgent(rankable);
}

/**
 * Atomic write: SupportAssignment create + SupportTicket.
 * currentAssignment update + QUEUED->ASSIGNED transition, all inside
 * the caller's transaction — same session-based transaction pattern
 * already established in supportTicket.service.js's createTicket()
 * and salon.onboarding.controller.js's savePhotos(). Only the three
 * currentAssignment.* paths are mutated (never a wholesale
 * reassignment of the sub-document, so any other current/future
 * currentAssignment field survives untouched) and every other ticket
 * field is left exactly as it was.
 *
 * The ticket's own audit event (action: ASSIGNED, entityId: the
 * ticket) is written by transitionTicketStatus itself — the single,
 * frozen status-mutation authority (ticketLifecycle.service.js,
 * unmodified). No second, manual audit write happens here for the
 * same business moment — Phase F.2's original manual
 * recordSupportAuditEvent() call (entityType:"SupportTicket" but
 * entityId pointing at the SupportAssignment doc) was an imprecise
 * pairing; transitionTicketStatus's own event is both sufficient and
 * correctly scoped to the ticket it actually describes.
 */
async function createAssignment({ ticket, queueRef, teamRef, agentRef, assignedBy, session }) {
  const now = new Date();

  const [assignment] = await SupportAssignment.create(
    [
      {
        ticketRef: ticket._id,
        queueRef,
        teamRef,
        agentRef,
        status: ASSIGNMENT_STATUS.ACTIVE,
        assignedAt: now,
        assignedBy: assignedBy ?? null,
        assignmentReason: ASSIGNMENT_REASON.ROUTING_ENGINE,
      },
    ],
    { session }
  );

  ticket.currentAssignment.queueRef = queueRef;
  ticket.currentAssignment.teamRef = teamRef;
  ticket.currentAssignment.agentRef = agentRef;
  ticket.currentAssignment.assignedAt = now;

  await transitionTicketStatus(
    {
      ticket,
      toStatus: TICKET_STATUS.ASSIGNED,
      actorRef: assignedBy ?? null,
      actorType: ACTOR_TYPE.SYSTEM,
      auditAction: AUDIT_ACTION.ASSIGNED,
    },
    session
  );

  return assignment;
}

async function setUnassignedCurrentAssignment({ ticketId, queueRef, teamRef }) {
  await SupportTicket.updateOne(
    { _id: ticketId },
    {
      $set: {
        "currentAssignment.queueRef": queueRef ?? null,
        "currentAssignment.teamRef": teamRef ?? null,
        "currentAssignment.agentRef": null,
      },
    }
  );
}

/**
 * Top-level orchestrator. Loads the ticket to derive categoryRef/
 * language internally (never trusts a caller-supplied value for
 * these — Phase F §7) and consumes targetQueueRef/targetTeamRef
 * exactly as supplied by the caller's already-computed routing
 * decision (Phase E.2's resolveRouting() output — this file never
 * calls into or duplicates that engine).
 *
 * Returns { assignment, agentRef, reason } — reason is one of
 * "ASSIGNED" | "ALREADY_ASSIGNED" | "NO_AGENT_AVAILABLE" |
 * "NO_TEAM_RESOLVED".
 */
export async function resolveAssignment({ ticketId, targetQueueRef, targetTeamRef, assignedBy = null }) {
  if (!targetTeamRef) {
    // No team to search agents against — not this engine's job to
    // invent one (routing already ran; if it found nothing, this
    // engine mirrors that by leaving the ticket unassigned).
    await setUnassignedCurrentAssignment({ ticketId, queueRef: targetQueueRef, teamRef: null });
    return { assignment: null, agentRef: null, reason: "NO_TEAM_RESOLVED" };
  }

  // Idempotency fast path (Phase F §4) — an existing ACTIVE
  // assignment means "already assigned," never create a second one.
  // The REAL protection is the SupportAssignment.ticketRef partial
  // unique index + the E11000 catch below; this is an optimization
  // that skips redundant candidate selection in the common case.
  const existing = await SupportAssignment.findOne({
    ticketRef: ticketId,
    status: ASSIGNMENT_STATUS.ACTIVE,
  }).lean();
  if (existing) {
    return { assignment: existing, agentRef: existing.agentRef, reason: "ALREADY_ASSIGNED" };
  }

  const ticket = await SupportTicket.findOne({ _id: ticketId, isDeleted: false }).lean();
  if (!ticket) {
    return { assignment: null, agentRef: null, reason: "TICKET_NOT_FOUND" };
  }

  const excludedAgentIds = new Set();

  for (let attempt = 0; attempt < MAX_CANDIDATE_ATTEMPTS; attempt++) {
    const eligibleAgents = await getEligibleAgents({
      teamRef: targetTeamRef,
      categoryRef: ticket.categoryRef,
      language: ticket.language,
    });
    const candidates = eligibleAgents.filter((a) => !excludedAgentIds.has(String(a._id)));
    if (candidates.length === 0) break;

    // Defect #1 fix — agentIds must be the candidates' real User
    // identity (SupportAgentProfile.userRef), the same identity
    // SupportAssignment.agentRef/ticket.currentAssignment.agentRef are
    // schema-typed to hold (both explicitly `ref: "User"`, confirmed
    // by direct schema inspection, with an explicit design comment on
    // currentAssignmentSchema: "agentRef refs User directly ... matching
    // the codebase-wide convention that every actor/person reference
    // points at User, not at a domain-specific profile document").
    // SupportAgentWorkload.agentRef and getActiveAssignmentCounts'
    // own SupportAssignment.aggregate({agentRef:{$in:agentIds}}) query
    // both need this same identity to ever match anything real.
    // Previously this read a.candidates' own SupportAgentProfile._id,
    // which is a different document entirely from the agent's User
    // account — silently breaking presence lookups, workload
    // reservation, and (worse) writing the wrong identity into every
    // SupportAssignment/ticket.currentAssignment ever created.
    const agentIds = candidates.map((a) => a.userRef);
    const [presence, counts] = await Promise.all([
      getAgentPresence(agentIds),
      getActiveAssignmentCounts(agentIds),
    ]);

    const winner = rankEligibleAgents(candidates, presence, counts);
    if (!winner) break;

    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      // Race-safe capacity gate (Phase F.3.3) — replaces F.2's
      // countDocuments-based re-check. ensureAgentWorkload guarantees
      // a workload row exists (idempotent upsert); reserveAgentCapacity
      // is a single-document atomic conditional increment — MongoDB
      // guarantees the read-condition and the write happen as one
      // indivisible operation, so of two concurrent transactions
      // racing for this agent's last slot, only one can ever succeed.
      // This closes the gap F.2 could only narrow (two transactions
      // each inserting a *different* SupportAssignment document create
      // no write conflict for Mongo to arbitrate) by giving both a
      // single shared document to atomically contend over instead.
      await ensureAgentWorkload({ agentRef: winner.userRef, session });
      const reserved = await reserveAgentCapacity({
        agentRef: winner.userRef,
        maxActiveTickets: winner.maxActiveTickets,
        session,
      });

      if (!reserved) {
        // Capacity was lost to a concurrent assignment (or the
        // conditional check simply failed) between ranking and this
        // reservation attempt — not an error. Abort cleanly, exclude
        // this specific candidate, and let the outer loop try the
        // next-best eligible agent (bounded by MAX_CANDIDATE_ATTEMPTS,
        // same existing bound F.2 already used for its own retry loop).
        await session.abortTransaction();
        session.endSession();
        excludedAgentIds.add(String(winner._id));
        continue;
      }

      // Re-fetch the ticket inside the session — the same "re-fetch
      // inside session, guard, abort if changed" pattern already
      // established in jobs/autoStart.job.js — rather than reusing the
      // plain, pre-transaction lean() read from above. Gives
      // transitionTicketStatus a real, session-scoped Mongoose
      // document to mutate and .save().
      const sessionTicket = await SupportTicket.findOne({ _id: ticketId, isDeleted: false }).session(session);
      if (!sessionTicket) {
        await session.abortTransaction();
        session.endSession();
        return { assignment: null, agentRef: null, reason: "TICKET_NOT_FOUND" };
      }

      const assignment = await createAssignment({
        ticket: sessionTicket,
        queueRef: targetQueueRef,
        teamRef: targetTeamRef,
        agentRef: winner.userRef,
        assignedBy,
        session,
      });

      await session.commitTransaction();
      session.endSession();

      return { assignment, agentRef: winner.userRef, reason: "ASSIGNED" };
    } catch (err) {
      try {
        if (session.inTransaction()) await session.abortTransaction();
        session.endSession();
      } catch {}

      // The partial unique index is the final safety layer (Phase F
      // §4/§6) — a concurrent process won the race for this exact
      // ticket between our pre-check and this write. Not an error:
      // fetch and return what actually got assigned.
      const isDuplicateActiveAssignment = err.code === 11000 && err.keyPattern?.ticketRef;
      if (isDuplicateActiveAssignment) {
        const raced = await SupportAssignment.findOne({
          ticketRef: ticketId,
          status: ASSIGNMENT_STATUS.ACTIVE,
        }).lean();
        return { assignment: raced, agentRef: raced?.agentRef ?? null, reason: "ALREADY_ASSIGNED" };
      }

      throw err;
    }
  }

  // No suitable agent found — ticket stays QUEUED (its status is
  // never touched by this engine), queue/team preserved, agentRef
  // null (Phase F §5). No SupportAssignment row is created for this
  // outcome. Still no SupportAuditEvent written here — AUDIT_ACTION.
  // NO_AGENT_AVAILABLE now exists (Phase F.3.2), but wiring it is a
  // deliberate F.3.3 scope decision, not an oversight: this phase's
  // objective is specifically "integrate the successful-assignment
  // path," and the no-agent path is explicitly instructed to be
  // preserved as-is unless required — see the implementation report's
  // No-Agent Behavior section.
  await setUnassignedCurrentAssignment({ ticketId, queueRef: targetQueueRef, teamRef: targetTeamRef });
  return { assignment: null, agentRef: null, reason: "NO_AGENT_AVAILABLE" };
}

/**
 * Phase F.3.4 — closes the ticket's current ACTIVE SupportAssignment
 * with no replacement. Reuses releaseAgentCapacity (F.3.1) and
 * transitionTicketStatus (frozen, unmodified) exactly as F.3.3 reused
 * their reserve/ASSIGNED counterparts — no new primitives invented,
 * no new AUDIT_ACTION needed (UNASSIGNED was already reserved for
 * exactly this in Phase F.3.2).
 *
 * Returns { assignment, reason } — reason is one of "UNASSIGNED" |
 * "ALREADY_UNASSIGNED" | "TICKET_NOT_FOUND".
 */
export async function unassignTicket({ ticketId, actorRef = null, actorType = ACTOR_TYPE.SYSTEM, reason = null }) {
  const existing = await SupportAssignment.findOne({
    ticketRef: ticketId,
    status: ASSIGNMENT_STATUS.ACTIVE,
  }).lean();
  if (!existing) {
    // Nothing to unassign — a deterministic no-op, not an error.
    return { assignment: null, reason: "ALREADY_UNASSIGNED" };
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    // Atomic conditional close — the same single-document-atomicity
    // technique the workload primitives use. If another process
    // already closed/reassigned this exact row since the pre-check
    // above, this matches nothing and returns null: a cleanly
    // detected race, not a corrupted write.
    const closed = await SupportAssignment.findOneAndUpdate(
      { _id: existing._id, status: ASSIGNMENT_STATUS.ACTIVE },
      { $set: { status: ASSIGNMENT_STATUS.UNASSIGNED, unassignedAt: new Date() } },
      { session, new: true }
    );

    if (!closed) {
      await session.abortTransaction();
      session.endSession();
      return { assignment: null, reason: "ALREADY_UNASSIGNED" };
    }

    await releaseAgentCapacity({ agentRef: closed.agentRef, session });

    const ticket = await SupportTicket.findOne({ _id: ticketId, isDeleted: false }).session(session);
    if (!ticket) {
      await session.abortTransaction();
      session.endSession();
      return { assignment: null, reason: "TICKET_NOT_FOUND" };
    }

    // Only currentAssignment.agentRef changes — queueRef/teamRef and
    // every other ticket field are left exactly as they were (never a
    // wholesale replacement of the currentAssignment sub-document).
    ticket.currentAssignment.agentRef = null;

    await transitionTicketStatus(
      {
        ticket,
        toStatus: TICKET_STATUS.QUEUED,
        actorRef,
        actorType,
        auditAction: AUDIT_ACTION.UNASSIGNED,
        reason,
      },
      session
    );

    await session.commitTransaction();
    session.endSession();

    return { assignment: closed, reason: "UNASSIGNED" };
  } catch (err) {
    try {
      if (session.inTransaction()) await session.abortTransaction();
      session.endSession();
    } catch {}
    throw err;
  }
}

/**
 * Phase F.3.4 — atomically moves the ticket's current ACTIVE
 * SupportAssignment from one agent to another. Deliberately NOT
 * "unassign then assign": releasing A's capacity, reserving B's,
 * closing A's row, creating B's row, and the ticket mutation all
 * happen inside one transaction, so a failed B reservation rolls back
 * A's release automatically (MongoDB's whole-transaction atomicity),
 * never leaving a partial/committed QUEUED state in between.
 *
 * Does not re-run the F.2 eligibility/ranking algorithm — this
 * accepts an already-chosen target agent (the caller's
 * responsibility, e.g. a future admin action) and focuses on
 * executing the handoff safely; it does perform a minimal existence/
 * active check on the target agent, since that check is also where
 * the fresh (never caller-supplied) maxActiveTickets value comes from.
 *
 * Returns { assignment, reason } — reason is one of "REASSIGNED" |
 * "NO_OP_SAME_AGENT" | "NO_ACTIVE_ASSIGNMENT" |
 * "NEW_AGENT_NOT_ELIGIBLE" | "NEW_AGENT_CAPACITY_UNAVAILABLE" |
 * "CONCURRENT_MODIFICATION" | "TICKET_NOT_FOUND".
 */
export async function reassignTicket({ ticketId, newAgentRef, actorRef = null, actorType = ACTOR_TYPE.SYSTEM, reason = null }) {
  const existing = await SupportAssignment.findOne({
    ticketRef: ticketId,
    status: ASSIGNMENT_STATUS.ACTIVE,
  }).lean();

  if (!existing) {
    // Nothing to reassign FROM — this operation moves an existing
    // assignment, it does not create a fresh one (resolveAssignment
    // is the function for that, a different operation).
    return { assignment: null, reason: "NO_ACTIVE_ASSIGNMENT" };
  }

  if (String(existing.agentRef) === String(newAgentRef)) {
    // Same-agent reassignment is an explicit idempotent no-op — never
    // release-then-reserve the same agent, never create a second
    // ACTIVE assignment for a target that already holds one.
    return { assignment: existing, reason: "NO_OP_SAME_AGENT" };
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    // Atomic conditional close of the OLD assignment — guards against
    // it having already changed since the pre-check (concurrent
    // reassignment/unassignment race).
    const closedOld = await SupportAssignment.findOneAndUpdate(
      { _id: existing._id, status: ASSIGNMENT_STATUS.ACTIVE },
      { $set: { status: ASSIGNMENT_STATUS.REASSIGNED, unassignedAt: new Date() } },
      { session, new: true }
    );

    if (!closedOld) {
      await session.abortTransaction();
      session.endSession();
      return { assignment: null, reason: "CONCURRENT_MODIFICATION" };
    }

    // Minimal target-agent sanity check, session-scoped — also the
    // source of the fresh maxActiveTickets value the reservation
    // needs (never trusted from the caller). newAgentRef is the
    // target AGENT's User identity — the same identity compared
    // against existing.agentRef above and written directly into
    // SupportAssignment.agentRef/ticket.currentAssignment.agentRef
    // below — so the profile lookup must go by userRef, not _id
    // (Defect #1 fix; this was the same profile-vs-user confusion as
    // resolveAssignment's own candidate selection, just manifesting
    // here as "a valid agent User id is rejected as NEW_AGENT_NOT_
    // ELIGIBLE because it was never a SupportAgentProfile._id").
    const newAgentProfile = await SupportAgentProfile.findOne({ userRef: newAgentRef }).session(session).lean();
    if (!newAgentProfile || newAgentProfile.isActive === false || newAgentProfile.isDeleted) {
      await session.abortTransaction();
      session.endSession();
      return { assignment: null, reason: "NEW_AGENT_NOT_ELIGIBLE" };
    }

    await releaseAgentCapacity({ agentRef: closedOld.agentRef, session });

    await ensureAgentWorkload({ agentRef: newAgentRef, session });
    const reserved = await reserveAgentCapacity({
      agentRef: newAgentRef,
      maxActiveTickets: newAgentProfile.maxActiveTickets,
      session,
    });

    if (!reserved) {
      // Aborting here rolls back BOTH closedOld and the release above
      // — the whole transaction's atomicity is what makes "old agent
      // capacity unchanged, old ACTIVE assignment unchanged" true
      // without any manual compensation logic.
      await session.abortTransaction();
      session.endSession();
      return { assignment: null, reason: "NEW_AGENT_CAPACITY_UNAVAILABLE" };
    }

    const ticket = await SupportTicket.findOne({ _id: ticketId, isDeleted: false }).session(session);
    if (!ticket) {
      await session.abortTransaction();
      session.endSession();
      return { assignment: null, reason: "TICKET_NOT_FOUND" };
    }

    const now = new Date();
    const [newAssignment] = await SupportAssignment.create(
      [
        {
          ticketRef: ticketId,
          queueRef: ticket.currentAssignment.queueRef,
          teamRef: ticket.currentAssignment.teamRef,
          agentRef: newAgentRef,
          status: ASSIGNMENT_STATUS.ACTIVE,
          assignedAt: now,
          assignedBy: actorRef,
          assignmentReason: ASSIGNMENT_REASON.REASSIGNMENT,
          previousAssignmentRef: closedOld._id,
        },
      ],
      { session }
    );

    // Only currentAssignment.agentRef/assignedAt change — queueRef/
    // teamRef and every other ticket field are untouched. Ticket
    // status stays ASSIGNED->ASSIGNED — no real transition occurs, so
    // transitionTicketStatus is deliberately NOT called here (no fake
    // transition just to generate an audit).
    ticket.currentAssignment.agentRef = newAgentRef;
    ticket.currentAssignment.assignedAt = now;
    await ticket.save({ session });

    // One audit event for the whole business moment — the already-
    // reserved AUDIT_ACTION.REASSIGNED, written directly since there's
    // no status transition to carry it. entityType/entityId match
    // every other Support audit event's convention (scoped to the
    // ticket, not the assignment row).
    await recordSupportAuditEvent(
      {
        ticketRef: ticketId,
        actorRef,
        actorType,
        action: AUDIT_ACTION.REASSIGNED,
        entityId: ticketId,
        oldValue: { agentRef: existing.agentRef },
        newValue: { agentRef: newAgentRef },
        reason,
      },
      session
    );

    await session.commitTransaction();
    session.endSession();

    return { assignment: newAssignment, reason: "REASSIGNED" };
  } catch (err) {
    try {
      if (session.inTransaction()) await session.abortTransaction();
      session.endSession();
    } catch {}
    throw err;
  }
}

/**
 * Phase F.3.5.1 — resolves a ticket and, in the same transaction,
 * closes its current ACTIVE SupportAssignment to COMPLETED and
 * releases the agent's workload. RESOLVED is the workload-release
 * trigger (frozen Phase F.3.5 design decision) — CLOSED is not
 * involved here at all (a separate, not-yet-built F.3.5.2).
 *
 * Preconditions, checked before any mutation: the ticket must be
 * IN_PROGRESS or WAITING_FOR_USER — the only two edges
 * VALID_TRANSITIONS actually offers into RESOLVED (ASSIGNED->RESOLVED
 * does not exist and is never attempted) — and a current ACTIVE
 * SupportAssignment with a real agentRef must exist. Neither is
 * invented or worked around; both return a deterministic,
 * non-mutating result if unmet, exactly like resolveAssignment/
 * unassignTicket/reassignTicket's own precondition checks.
 *
 * Returns { ticket, assignment, reason } — reason is one of
 * "RESOLVED" | "ALREADY_RESOLVED" | "ALREADY_CLOSED" |
 * "INVALID_TICKET_STATE" | "NO_ACTIVE_ASSIGNMENT" |
 * "ACTIVE_ASSIGNMENT_MISSING_AGENT" | "CONCURRENT_MODIFICATION" |
 * "WORKLOAD_RELEASE_FAILED" | "TICKET_NOT_FOUND".
 */
export async function resolveTicketAssignment({ ticketId, actorRef = null, actorType = ACTOR_TYPE.SYSTEM, reason = null }) {
  const ticketPreCheck = await SupportTicket.findOne({ _id: ticketId, isDeleted: false }).lean();
  if (!ticketPreCheck) {
    return { ticket: null, assignment: null, reason: "TICKET_NOT_FOUND" };
  }

  // Idempotent, deterministic rejection for every non-eligible starting
  // status — no mutation, no thrown error, matching this file's
  // established "return a deterministic result" convention rather than
  // letting transitionTicketStatus's canTransition() throw a generic
  // conflict error for an expected, ordinary case.
  if (ticketPreCheck.status === TICKET_STATUS.RESOLVED) {
    return { ticket: ticketPreCheck, assignment: null, reason: "ALREADY_RESOLVED" };
  }
  if (ticketPreCheck.status === TICKET_STATUS.CLOSED) {
    return { ticket: ticketPreCheck, assignment: null, reason: "ALREADY_CLOSED" };
  }
  if (
    ticketPreCheck.status !== TICKET_STATUS.IN_PROGRESS &&
    ticketPreCheck.status !== TICKET_STATUS.WAITING_FOR_USER
  ) {
    return { ticket: ticketPreCheck, assignment: null, reason: "INVALID_TICKET_STATE" };
  }

  const activeAssignment = await SupportAssignment.findOne({
    ticketRef: ticketId,
    status: ASSIGNMENT_STATUS.ACTIVE,
  }).lean();

  if (!activeAssignment) {
    // No fabricated assignment, no fabricated workload release — a
    // ticket in a resolvable status but with nothing currently ACTIVE
    // simply cannot go through this function.
    return { ticket: ticketPreCheck, assignment: null, reason: "NO_ACTIVE_ASSIGNMENT" };
  }
  if (!activeAssignment.agentRef) {
    return { ticket: ticketPreCheck, assignment: activeAssignment, reason: "ACTIVE_ASSIGNMENT_MISSING_AGENT" };
  }

  const agentRef = activeAssignment.agentRef; // captured before any mutation

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const sessionTicket = await SupportTicket.findOne({ _id: ticketId, isDeleted: false }).session(session);
    if (!sessionTicket) {
      await session.abortTransaction();
      session.endSession();
      return { ticket: null, assignment: null, reason: "TICKET_NOT_FOUND" };
    }

    const now = new Date();

    // The assignment is closing in this same transaction — the
    // denormalized currentAssignment pointer should stop claiming an
    // agent is currently holding a resolved ticket. queueRef/teamRef
    // are left untouched (historically meaningful, unlike unassignment
    // where they're preserved for a future re-assignment attempt).
    sessionTicket.currentAssignment.agentRef = null;

    await transitionTicketStatus(
      {
        ticket: sessionTicket,
        toStatus: TICKET_STATUS.RESOLVED,
        actorRef,
        actorType,
        auditAction: AUDIT_ACTION.RESOLVED,
        extraFields: { resolvedAt: now },
        reason,
      },
      session
    );

    // Atomic conditional close — the real concurrency-safety layer,
    // not the pre-check above. If another process already completed/
    // unassigned/reassigned this exact row since the pre-check, this
    // matches nothing and returns null: a cleanly detected race:
    // aborting here rolls back the ticket's RESOLVED transition too
    // (same transaction, not yet committed), so the ticket is left
    // exactly as it was.
    const closedAssignment = await SupportAssignment.findOneAndUpdate(
      { _id: activeAssignment._id, status: ASSIGNMENT_STATUS.ACTIVE },
      { $set: { status: ASSIGNMENT_STATUS.COMPLETED, unassignedAt: now } },
      { session, new: true }
    );

    if (!closedAssignment) {
      await session.abortTransaction();
      session.endSession();
      return { ticket: null, assignment: null, reason: "CONCURRENT_MODIFICATION" };
    }

    // The only workload-release mechanism used anywhere in this file —
    // no manual $inc here. A null return means the primitive's own
    // floor/existence guard didn't apply cleanly (an inconsistency
    // that should never happen for a row that was ACTIVE a moment
    // ago) — treated as a hard failure rather than silently claiming
    // a release that didn't provably happen.
    const released = await releaseAgentCapacity({ agentRef, session });
    if (!released) {
      await session.abortTransaction();
      session.endSession();
      return { ticket: null, assignment: null, reason: "WORKLOAD_RELEASE_FAILED" };
    }

    // A second, distinct audit fact from the ticket's own RESOLVED
    // event (already written by transitionTicketStatus above) — the
    // assignment's own completion, not a duplicate of the same event.
    await recordSupportAuditEvent(
      {
        ticketRef: ticketId,
        actorRef,
        actorType,
        action: AUDIT_ACTION.COMPLETED,
        entityId: ticketId,
        oldValue: { assignmentStatus: ASSIGNMENT_STATUS.ACTIVE },
        newValue: { assignmentStatus: ASSIGNMENT_STATUS.COMPLETED, agentRef },
        reason,
      },
      session
    );

    await session.commitTransaction();
    session.endSession();

    return { ticket: sessionTicket, assignment: closedAssignment, reason: "RESOLVED" };
  } catch (err) {
    try {
      if (session.inTransaction()) await session.abortTransaction();
      session.endSession();
    } catch {}
    throw err;
  }
}

/**
 * Phase F.3.5.2 — pure ticket-level finalization. RESOLVED->CLOSED
 * only; SupportAssignment/SupportAgentWorkload are never touched here
 * — resolveTicketAssignment() (F.3.5.1) already closed the assignment
 * to COMPLETED and released the agent's workload at RESOLVED time,
 * per the frozen Phase F.3.5 design decision that RESOLVED, not
 * CLOSED, is the workload-release trigger. This function does not
 * import or call releaseAgentCapacity at all.
 *
 * Preconditions, checked before any mutation: only RESOLVED is a
 * valid starting state — every other status (including REOPENED,
 * which has no CLOSED edge in VALID_TRANSITIONS) is rejected
 * deterministically, no mutation, no thrown error, matching this
 * file's established convention.
 *
 * Returns { ticket, reason } — reason is one of "CLOSED" |
 * "ALREADY_CLOSED" | "INVALID_TICKET_STATE" | "TICKET_NOT_FOUND".
 */
export async function closeTicket({ ticketId, actorRef = null, actorType = ACTOR_TYPE.SYSTEM, reason = null }) {
  const ticketPreCheck = await SupportTicket.findOne({ _id: ticketId, isDeleted: false }).lean();
  if (!ticketPreCheck) {
    return { ticket: null, reason: "TICKET_NOT_FOUND" };
  }

  if (ticketPreCheck.status === TICKET_STATUS.CLOSED) {
    return { ticket: ticketPreCheck, reason: "ALREADY_CLOSED" };
  }
  if (ticketPreCheck.status !== TICKET_STATUS.RESOLVED) {
    // Covers OPEN/TRIAGED/QUEUED/ASSIGNED/IN_PROGRESS/WAITING_FOR_USER/
    // REOPENED uniformly — none of them has a CLOSED edge in
    // VALID_TRANSITIONS, so none of them is force-closed here.
    return { ticket: ticketPreCheck, reason: "INVALID_TICKET_STATE" };
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    // Re-fetch inside the session — same "re-fetch, guard, abort if
    // changed" pattern already used by every other function in this
    // file — even though only one business document (the ticket)
    // mutates here, the paired audit write is a second document, so a
    // transaction is still what guarantees both-or-neither.
    const sessionTicket = await SupportTicket.findOne({ _id: ticketId, isDeleted: false }).session(session);
    if (!sessionTicket) {
      await session.abortTransaction();
      session.endSession();
      return { ticket: null, reason: "TICKET_NOT_FOUND" };
    }

    const now = new Date();

    // resolvedAt is never touched — only closedAt is set, via the
    // same extraFields mechanism reopenTicket/resolveTicketAssignment
    // already use for their own timestamp fields.
    await transitionTicketStatus(
      {
        ticket: sessionTicket,
        toStatus: TICKET_STATUS.CLOSED,
        actorRef,
        actorType,
        auditAction: AUDIT_ACTION.CLOSED,
        extraFields: { closedAt: now },
        reason,
      },
      session
    );

    await session.commitTransaction();
    session.endSession();

    return { ticket: sessionTicket, reason: "CLOSED" };
  } catch (err) {
    try {
      if (session.inTransaction()) await session.abortTransaction();
      session.endSession();
    } catch {}
    throw err;
  }
}

/**
 * Phase F.3.6 — the missing engine-level bridge. Nothing in this
 * codebase previously ever transitioned a ticket OPEN->TRIAGED-
 * >QUEUED, and nothing ever called routingResolution.service.js's
 * resolveRouting() — confirmed by a fresh repo-wide search before
 * writing this function, not assumed. This function closes both gaps
 * by sequencing three already-existing, unmodified pieces: the
 * frozen transitionTicketStatus() authority (for the two missing
 * status edges), resolveRouting() (routing decision, read-only, no
 * writes), and this file's own resolveAssignment() (which already
 * manages its own per-candidate transaction internally). No new
 * transaction wraps all of this together — resolveRouting does no
 * writes at all, and resolveAssignment's existing transactional
 * behavior is preserved exactly as built; wrapping them in a further
 * shared transaction would be a *new* cross-service transaction
 * boundary, not a preservation of the existing ones (Phase F.3.6 §
 * "Transaction Boundary" explicitly calls for the latter, not the
 * former).
 *
 * The OPEN->TRIAGED and TRIAGED->QUEUED transitions are plain,
 * non-transactional transitionTicketStatus() calls — matching the
 * exact precedent already established by reopenTicket() and the
 * customer-reply IN_PROGRESS auto-transition in this same module,
 * neither of which wraps its transition in a session either. Each
 * individual transition is still atomic in itself (one ticket.save()
 * + one audit write is the same shape every existing caller already
 * accepts as sufficient); a ticket that crashes mid-way simply rests
 * at a valid, resumable status (TRIAGED) rather than an inconsistent
 * one — re-invoking this function later picks up exactly where it
 * left off.
 *
 * A ticket already past QUEUED (ASSIGNED and beyond) is left alone
 * entirely — no routing, no assignment attempt — both because
 * resolveAssignment's own ALREADY_ASSIGNED check would catch the
 * ASSIGNED case anyway, and because every other later status has no
 * valid target for this trigger at all (defense in depth + avoids a
 * wasted routing-engine read).
 *
 * No new AUDIT_ACTION is used or added: the OPEN->TRIAGED and
 * TRIAGED->QUEUED transitions use transitionTicketStatus's own
 * default (AUDIT_ACTION.STATUS_CHANGED) — the exact reuse already
 * recommended in the Phase F.3 design audit itself. resolveAssignment's
 * existing no-agent behavior (no audit event written for
 * NO_AGENT_AVAILABLE, reported and accepted back in Phase F.3.3) is
 * NOT retroactively changed here — this function only consumes
 * whatever resolveAssignment already does, never modifies it.
 *
 * Returns { ticket, routingDecision, assignmentResult, reason } —
 * reason is one of "ASSIGNED" | "ALREADY_ASSIGNED" |
 * "NO_AGENT_AVAILABLE" | "NO_TEAM_RESOLVED" | "ALREADY_PROGRESSED" |
 * "TICKET_NOT_FOUND".
 */
export async function routeAndAssignTicket({ ticketId }) {
  const ticket = await SupportTicket.findOne({ _id: ticketId, isDeleted: false });
  if (!ticket) {
    return { ticket: null, routingDecision: null, assignmentResult: null, reason: "TICKET_NOT_FOUND" };
  }

  if (ticket.status === TICKET_STATUS.OPEN) {
    await transitionTicketStatus({
      ticket,
      toStatus: TICKET_STATUS.TRIAGED,
      actorRef: null,
      actorType: ACTOR_TYPE.SYSTEM,
    });
  }

  if (ticket.status === TICKET_STATUS.TRIAGED) {
    await transitionTicketStatus({
      ticket,
      toStatus: TICKET_STATUS.QUEUED,
      actorRef: null,
      actorType: ACTOR_TYPE.SYSTEM,
    });
  }

  if (ticket.status !== TICKET_STATUS.QUEUED) {
    // ASSIGNED/IN_PROGRESS/WAITING_FOR_USER/RESOLVED/CLOSED/REOPENED —
    // not this trigger's job to route or assign again.
    return { ticket, routingDecision: null, assignmentResult: null, reason: "ALREADY_PROGRESSED" };
  }

  const routingDecision = await resolveRouting({
    routingSnapshot: ticket.routingSnapshot,
    categoryRef: ticket.categoryRef,
    priority: ticket.priority,
    language: ticket.language,
    requesterType: ticket.requesterType,
  });

  const assignmentResult = await resolveAssignment({
    ticketId: ticket._id,
    targetQueueRef: routingDecision.targetQueueRef,
    targetTeamRef: routingDecision.targetTeamRef,
  });

  return { ticket, routingDecision, assignmentResult, reason: assignmentResult.reason };
}

/**
 * Phase H Step 8 (follow-up) — read-only assignment history for one
 * ticket. Confirmed by direct inspection: SupportAssignment already
 * carries full history via its previousAssignmentRef chain and
 * status transitions (ACTIVE/REASSIGNED/UNASSIGNED/COMPLETED), but no
 * endpoint anywhere ever read it back — this is the first reader.
 * Does not touch resolveAssignment()/unassignTicket()/reassignTicket()/
 * routeAndAssignTicket() in any way; it is a pure query over rows
 * those functions already write. Sorted oldest-first (matches the
 * ticket's own message/audit ordering convention).
 */
export async function listAssignmentHistory({ ticketId }) {
  return SupportAssignment.find({ ticketRef: ticketId })
    .select("queueRef teamRef agentRef status assignedAt unassignedAt assignedBy assignmentReason previousAssignmentRef createdAt")
    .sort({ createdAt: 1 })
    .lean();
}
