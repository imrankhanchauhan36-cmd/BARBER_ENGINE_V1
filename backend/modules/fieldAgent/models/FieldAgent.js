/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/models/FieldAgent.js
 *
 * FA-4.1 — the operational Field Agent profile. Deliberately a
 * SEPARATE document from both User (the authenticated identity,
 * role: FIELD_AGENT — already exists from the application stage,
 * never duplicated or re-created here) and FieldAgentApplication
 * (the pre-approval application record, which terminates at
 * APPROVED and is never mutated by this model). Same separation
 * rationale as modules/support/models/SupportAgentProfile.js keeping
 * support-specific state off the shared User document.
 *
 * A FieldAgent document is only ever created once an application has
 * reached ADMIN_REVIEW (or later APPROVED) — see
 * fieldAgentProfile.service.js#createFieldAgentProfile, which is the
 * ONLY writer. No HTTP endpoint creates this document directly in
 * FA-4.1; FA-4.2 owns wiring the actual admin-approval transaction
 * that calls into this foundation.
 *
 * DELIBERATELY EXCLUDED from this schema (out of FA-4.1 scope, later
 * milestones own them): zoneRef/territoryRef/districtRef/cityRef/
 * areaRef, transfer fields, commission fields, support fields, payout
 * fields, performance fields. No KYC data (PAN/Aadhaar/bank details)
 * is duplicated here — this document only ever references
 * userRef/applicationRef, never copies sensitive fields off them.
 *
 * agentCode is immutable after creation — enforced in the service
 * layer (never included in any update payload; no update path exists
 * for this field at all in FA-4.1, since nothing mutates a FieldAgent
 * document after creation yet).
 */

import mongoose from "mongoose";
import { FIELD_AGENT_OPERATIONAL_STATUS } from "../constants/fieldAgent.constants.js";

const fieldAgentSchema = new mongoose.Schema(
  {
    userRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    applicationRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FieldAgentApplication",
      required: true,
    },

    // Server-generated only — see fieldAgentProfile.service.js's
    // generateAgentCode(). Never client-suppliable, never derived from
    // phone/Aadhaar/PAN/application id/district/zone.
    agentCode: {
      type: String,
      required: true,
      trim: true,
    },

    operationalStatus: {
      type: String,
      enum: Object.values(FIELD_AGENT_OPERATIONAL_STATUS),
      default: FIELD_AGENT_OPERATIONAL_STATUS.PENDING_ACTIVATION,
      required: true,
    },

    // Nullable only in the schema sense (no non-null constraint) —
    // every actual write path (createFieldAgentProfile) requires a
    // real adminId and sets both together, atomically, at creation.
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One profile per user, one profile per application — DB-level, not
// merely application-level (same "unique index is the actual
// guarantee" discipline as every other lifecycle in this codebase).
fieldAgentSchema.index({ userRef: 1 }, { unique: true });
fieldAgentSchema.index({ applicationRef: 1 }, { unique: true });

// agentCode is the human-facing identity — must be globally unique.
fieldAgentSchema.index({ agentCode: 1 }, { unique: true });

// Deliberately still NO index on operationalStatus in FA-4.1 — it has
// only one meaningful value so far, and no query filters on it yet;
// every read here is a point lookup by _id. Add an index only when a
// real listing/filtering query needs one.

export default mongoose.models.FieldAgent || mongoose.model("FieldAgent", fieldAgentSchema);
