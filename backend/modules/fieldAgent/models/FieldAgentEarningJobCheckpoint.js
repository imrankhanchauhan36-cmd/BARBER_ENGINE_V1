/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/models/FieldAgentEarningJobCheckpoint.js
 *
 * FA-9 — the durable discovery cursor for fieldAgentEarning.job.js.
 * A single fixed-id singleton document (EARNING_JOB_CHECKPOINT_ID).
 *
 * Compound (lastCompletedAt, lastId) — NOT a bare Date — per the FA-9
 * Issue 3 correction: two Booking documents can share an identical
 * completedAt millisecond, so a bare Date cursor could skip a
 * same-instant sibling. _id is the deterministic tiebreak.
 *
 * Advanced ONLY after an entire fetched discovery batch reaches a
 * terminal outcome (see fieldAgentEarning.job.js) — never mid-batch,
 * and only forward (monotonic guard applied at the update call site,
 * not enforced here at the schema level, since the guard needs the
 * candidate value to compare against).
 */

import mongoose from "mongoose";

const FieldAgentEarningJobCheckpointSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    lastCompletedAt: { type: Date, default: new Date(0) },
    lastId: { type: mongoose.Schema.Types.ObjectId, default: new mongoose.Types.ObjectId("000000000000000000000000") },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false, versionKey: false }
);

export default mongoose.models.FieldAgentEarningJobCheckpoint ||
  mongoose.model("FieldAgentEarningJobCheckpoint", FieldAgentEarningJobCheckpointSchema);
