/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/models/FieldAgentApplication.js
 *
 * FA-2 — tracks one applicant's journey from apply through to
 * admin approval/rejection/withdrawal. This is the ONLY record that
 * exists for an applicant before approval — no FieldAgent profile or
 * Agent ID is created until FA-4's admin-approval phase.
 *
 * userRef/phone are immutable (enforced in the service layer, which
 * never includes them in an update payload — Mongoose has no native
 * per-field immutability short of a plugin, and none is warranted for
 * two fields). basicProfile is editable only while status is DRAFT
 * (enforced in fieldAgentApplication.service.js, not here).
 *
 * requestedZone is the APPLICANT'S REQUEST only — it grants no
 * authority over that geography. Authoritative zone assignment is a
 * FA-5 concept (FieldAgentZone), created by Admin, not derived from
 * this field.
 */

import mongoose from "mongoose";
import {
  APPLICATION_STATUS,
  COMMERCIAL_PATH,
  GENDER,
} from "../constants/fieldAgent.constants.js";

const requestedZoneSchema = new mongoose.Schema(
  {
    stateRef: { type: mongoose.Schema.Types.ObjectId, ref: "State", default: null },
    districtRef: { type: mongoose.Schema.Types.ObjectId, ref: "District", default: null },
    cityRef: { type: mongoose.Schema.Types.ObjectId, ref: "City", default: null },
    areaRef: { type: mongoose.Schema.Types.ObjectId, ref: "Area", default: null },
  },
  { _id: false }
);

const basicProfileSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: null, maxlength: 100 },
    dob: { type: Date, default: null },
    gender: { type: String, enum: [...Object.values(GENDER), null], default: null },
  },
  { _id: false }
);

const fieldAgentApplicationSchema = new mongoose.Schema(
  {
    // No `index: true` here — the partial unique index declared below
    // via schema.index({userRef:1}, {...}) already covers this field;
    // declaring both triggers Mongoose's duplicate-index warning.
    userRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Denormalized from User at creation time for query/display
    // convenience — never re-read from User after creation, and never
    // trusted as the identity boundary (userRef + req.user._id is).
    phone: {
      type: String,
      required: true,
      trim: true,
    },

    basicProfile: {
      type: basicProfileSchema,
      default: () => ({}),
    },

    // Applicant's REQUEST only — see file header. Read-only reference
    // into the existing Country->State->District->City->Area
    // hierarchy; no new location data is ever created from this field.
    requestedZone: {
      type: requestedZoneSchema,
      default: () => ({}),
    },

    // Applicant's REQUEST only — mirrors requestedZone's own boundary
    // (see above): this grants no authority and does not set
    // FieldAgent.commercialPath, which remains the sole authoritative,
    // one-time-only value set by an admin post-approval
    // (commercialModel.service.js#selectCommercialPath). Editable only
    // while status is DRAFT (enforced in the service layer, not here).
    requestedCommercialPath: {
      type: String,
      enum: [...Object.values(COMMERCIAL_PATH), null],
      default: null,
    },

    // No `index: true` here — the {status,createdAt} compound index
    // declared below already serves single-field `status` queries as
    // a prefix, so a separate standalone index would be redundant.
    status: {
      type: String,
      enum: Object.values(APPLICATION_STATUS),
      default: APPLICATION_STATUS.DRAFT,
      required: true,
    },

    // Derived, always kept in sync with `status` by
    // fieldAgentApplication.service.js's setApplicationStatus() helper
    // — true whenever status is NOT one of TERMINAL_APPLICATION_STATUSES.
    // Exists ONLY because MongoDB's partialFilterExpression does not
    // support $nin/$not (confirmed via a real CannotCreateIndex error
    // during implementation — $in/$nin compile to $not internally,
    // which is rejected), so the uniqueness index below needs a plain
    // equality condition instead of a negated status-set condition.
    nonTerminal: {
      type: Boolean,
      default: true,
    },

    // FA-3 (KYC) / FA-4 (training-test) / FA-4 (admin) scope. Left as
    // a bare ObjectId (no `ref`) rather than guessing the eventual KYC
    // applicant-record shape — FA-1 §25 item 6 explicitly flags the
    // exact KYC integration mechanism as needing direct inspection
    // before it's built. FA-2 never reads or writes these.
    kycRef: { type: mongoose.Schema.Types.ObjectId, default: null },
    trainingRef: { type: mongoose.Schema.Types.ObjectId, default: null },
    testAttemptRef: { type: mongoose.Schema.Types.ObjectId, default: null },

    // Admin-review fields — schema is prepared now (per this phase's
    // own field list) but nothing in FA-2 ever writes them; no admin
    // approval endpoint exists until FA-4.
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null, maxlength: 500 },

    withdrawnAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One non-terminal application per user at a time — DB-level, not
// merely application-level. MongoDB partial unique index: only
// documents matching the filter participate in the uniqueness
// constraint, so a user with only REJECTED/WITHDRAWN history can
// always start a fresh application (a new document simply falls
// outside this filter once created), while two simultaneous inserts
// for the same user's non-terminal state race safely — the loser gets
// a duplicate-key error (code 11000), handled explicitly in the
// service layer, never silently swallowed.
fieldAgentApplicationSchema.index(
  { userRef: 1 },
  {
    unique: true,
    partialFilterExpression: {
      nonTerminal: true,
    },
  }
);

// Admin queue / status-scoped listing support (FA-4 will read this;
// declared now so the index isn't retrofitted later at scale).
fieldAgentApplicationSchema.index({ status: 1, createdAt: -1 });

export default mongoose.models.FieldAgentApplication ||
  mongoose.model("FieldAgentApplication", fieldAgentApplicationSchema);
