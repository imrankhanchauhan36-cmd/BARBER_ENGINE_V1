/**
 * BARBER ENGINE V1
 * backend/modules/support/models/SupportAgentWorkload.js
 *
 * Phase F.3.1 — the race-safe capacity primitive the Phase F.3
 * architecture audit specified. Kept separate from SupportAgentProfile
 * (Phase F.1) by design — the same bounded-context reasoning already
 * used for SupportAuditEvent-vs-AdminAuditLog and SupportAgentProfile-
 * vs-User: this collection holds exactly one fast-changing operational
 * counter, nothing else, so a reservation is a single-document write
 * with no risk of touching unrelated agent-profile fields.
 *
 * This document is the AUTHORITATIVE, operational source of truth for
 * an agent's live active-assignment count — not a cache, not a
 * convenience. SupportAssignment.countDocuments({agentRef,status:
 * ACTIVE}) (Phase F.2) remains available for reconciliation/audit
 * only (a future, not-yet-built job) and must never be read on the
 * hot assignment path in place of this collection — Phase F.3 §6/§9
 * is explicit that these must not become two competing sources of
 * truth.
 *
 * Reservation is race-safe via MongoDB's single-document atomicity —
 * a findOneAndUpdate's read-condition and write happen as one
 * indivisible operation, so two concurrent reservation attempts
 * against the same agent's last slot can never both succeed. This
 * closes the exact gap Phase F.2 could only narrow (two transactions
 * each inserting a different, unrelated SupportAssignment document
 * create no write conflict for MongoDB to arbitrate) by giving both
 * attempts one shared document to atomically contend over instead.
 *
 * No reconciliation logic, no assignment-engine wiring, and no
 * reservation-usage call sites exist yet — this file is the primitive
 * only, per Phase F.3.1's explicit scope.
 */

import mongoose from "mongoose";

const supportAgentWorkloadSchema = new mongoose.Schema(
  {
    agentRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    activeAssignmentCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

// Approved Phase F.3.1 index — the only one this collection needs;
// every operation here is a point lookup/update by agentRef.
supportAgentWorkloadSchema.index({ agentRef: 1 }, { unique: true });

const SupportAgentWorkload =
  mongoose.models.SupportAgentWorkload || mongoose.model("SupportAgentWorkload", supportAgentWorkloadSchema);

/**
 * Idempotent "create if missing" — a bare findOneAndUpdate reservation
 * attempt against an agent with no workload row yet would match
 * nothing and fail every time, so a row must exist before reserve()
 * is meaningful. Upsert-with-$setOnInsert is itself atomic and safe
 * to call repeatedly/concurrently (a duplicate concurrent upsert
 * either no-ops against the just-created row or is naturally
 * serialized by the unique agentRef index).
 */
export async function ensureAgentWorkload({ agentRef, session = null }) {
  return SupportAgentWorkload.findOneAndUpdate(
    { agentRef },
    { $setOnInsert: { agentRef, activeAssignmentCount: 0 } },
    { upsert: true, new: true, session: session || undefined }
  );
}

/**
 * Atomic conditional reservation — the exact pattern specified in the
 * approved Phase F.3 design. Returns the updated document on success,
 * or null if the agent has no workload row yet or is already at/over
 * capacity (never throws for "no capacity" — that's an expected,
 * ordinary outcome the caller checks via the null return).
 *
 * maxActiveTickets must be a real number — Phase F.3 §4 ratified
 * "null/unconfigured means zero effective capacity, not unlimited";
 * this is enforced here explicitly (short-circuiting before any query)
 * rather than left to rely on BSON's cross-type comparison behavior,
 * so the rule is self-evident to a future reader, not an implicit
 * side effect of how Mongo happens to compare a field against null.
 */
export async function reserveAgentCapacity({ agentRef, maxActiveTickets, session = null }) {
  if (typeof maxActiveTickets !== "number") {
    return null;
  }

  return SupportAgentWorkload.findOneAndUpdate(
    {
      agentRef,
      activeAssignmentCount: { $lt: maxActiveTickets },
    },
    {
      $inc: { activeAssignmentCount: 1 },
    },
    {
      session: session || undefined,
      new: true,
    }
  );
}

/**
 * Atomic conditional release — the { activeAssignmentCount: { $gt: 0 } }
 * guard is what makes "never allow it below zero" a database-level
 * guarantee rather than an application-level assumption: if the count
 * is already 0, the condition matches nothing, the update no-ops, and
 * this returns null instead of decrementing past the floor.
 */
export async function releaseAgentCapacity({ agentRef, session = null }) {
  return SupportAgentWorkload.findOneAndUpdate(
    {
      agentRef,
      activeAssignmentCount: { $gt: 0 },
    },
    {
      $inc: { activeAssignmentCount: -1 },
    },
    {
      session: session || undefined,
      new: true,
    }
  );
}

export default SupportAgentWorkload;
