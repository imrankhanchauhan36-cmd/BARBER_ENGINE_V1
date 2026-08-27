/**
 * BARBER ENGINE V1
 * backend/modules/support/models/SupportSlaPolicy.js
 *
 * Phase G Step 1 — SLA Policy CRUD slice. LOCKED specification:
 *   - categoryRef nullable: null = GLOBAL DEFAULT, non-null = one
 *     specific SupportCategory's policy.
 *   - targetsByPriority: exactly LOW/NORMAL/HIGH/CRITICAL, each with
 *     firstResponseMinutes/resolutionMinutes (calendar-time minutes —
 *     no business-hours model exists or is used, per the approved
 *     decision).
 *   - warningThresholdPercent: one value per policy (percentage of
 *     SLA consumed, not a fixed duration — approved decision).
 *
 * Deliberately excluded per the locked spec: teamRef (no team-scoped
 * policies), businessHoursRef (no business-hours calculation),
 * escalation fields, notification fields, and any SLA *runtime* field
 * (deadlines/pause state live on SupportTicket itself, in a later
 * slice — this model is configuration only, never mutated by ticket
 * activity).
 *
 * isDeleted (soft-delete) follows the exact same convention already
 * used by every other Support configuration model (SupportCategory,
 * SupportTeam, SupportQueue) — "delete" here is not a hard Mongo
 * delete, consistent with the rest of this module.
 */

import mongoose from "mongoose";

const prioritySlaTargetSchema = new mongoose.Schema(
  {
    // Calendar-time minutes (approved decision — no business-hours
    // calculation). Not required to be a whole integer: "positive
    // minutes" is the only constraint the locked spec asks for.
    firstResponseMinutes: { type: Number, required: true, min: 1 },
    resolutionMinutes: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const targetsByPrioritySchema = new mongoose.Schema(
  {
    LOW: { type: prioritySlaTargetSchema, required: true },
    NORMAL: { type: prioritySlaTargetSchema, required: true },
    HIGH: { type: prioritySlaTargetSchema, required: true },
    CRITICAL: { type: prioritySlaTargetSchema, required: true },
  },
  { _id: false }
);

const supportSlaPolicySchema = new mongoose.Schema(
  {
    // null = GLOBAL DEFAULT policy. Non-null = this category's own
    // policy. Deliberately no `ref:` omission here — unlike
    // SupportTicket's forward-compat placeholders (slaPolicyRef
    // itself, businessHoursRef), SupportCategory already exists, so
    // this can safely be a real, populatable reference.
    categoryRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupportCategory",
      default: null,
    },

    targetsByPriority: { type: targetsByPrioritySchema, required: true },

    // Percentage of SLA consumed at which a warning fires (approved
    // decision — percentage-of-consumed, not fixed-duration-before-
    // deadline). Bounded (1,99) rather than [0,100]: 0 would warn
    // immediately on ticket creation, 100 would only ever "warn" at
    // the exact instant of breach — both degenerate, neither a
    // meaningful early-warning signal.
    warningThresholdPercent: { type: Number, required: true, min: 1, max: 99 },

    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false, index: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// Enforces "at most one NON-DELETED policy per category, at most one
// NON-DELETED global default" in a single index — NOT sparse. A
// standard (non-sparse) unique index treats an explicit `null` as a
// real, uniqueness-constrained value in MongoDB (sparse indexes are
// what SKIP null/missing fields, which would instead allow unlimited
// global-default documents — the opposite of what's required here).
// Every document always carries an explicit categoryRef value
// (ObjectId or null, never omitted), so this is the correct, minimal
// mechanism — no application-level uniqueness check is relied upon as
// the sole guard (the service layer pre-checks for a friendly error
// message, but this index is the authoritative, race-condition-safe
// boundary).
//
// partialFilterExpression restricts the constraint to isDeleted:false
// documents. Without it, soft-deleting a policy (the only delete this
// module ever performs — see deleteSlaPolicy() below) permanently
// occupies its categoryRef slot in the index, making it impossible to
// ever create a replacement policy for that category/global default
// again — confirmed live: after G.9 cleanup soft-deleted the test
// policies, creating a new one for the same category or as the new
// global default both failed with a duplicate-key 409, even though
// listSlaPolicies() correctly showed zero policies. Scoping the index
// to isDeleted:false is the minimal fix — it preserves the exact same
// "at most one active-or-inactive-but-not-deleted policy per slot"
// guarantee among real (non-deleted) documents, while allowing a
// fresh policy to reuse a slot vacated by a soft-delete.
supportSlaPolicySchema.index(
  { categoryRef: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

export default mongoose.models.SupportSlaPolicy || mongoose.model("SupportSlaPolicy", supportSlaPolicySchema);
