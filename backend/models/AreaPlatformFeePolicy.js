/**
 * BARBER ENGINE V1
 * backend/models/AreaPlatformFeePolicy.js
 *
 * PAN-India Platform Fee configuration. This is NOT a second
 * customer-facing fee — it is the configured SOURCE of the one existing
 * customer-facing fee, which continues to be stored on Booking as
 * commissionAmountInPaise (unchanged field name, unchanged downstream
 * consumers — Field Agent earning, both cancel paths,
 * RefundExecutionService, both frontends — all keep reading that exact
 * field regardless of how its value was produced).
 *
 * Same DRAFT -> PUBLISHED -> RETIRED lifecycle as GstPolicyVersion /
 * CommercialPolicyVersion.
 *
 * LAUNCH-PHASE SCOPE ADDITION (2026-10 — "Global Platform Fee"): this
 * model originally supported AREA scope only (one fee per Area). For
 * launch, ZEMISH wants a single GLOBAL/PAN-India fee instead, with the
 * area-scoping capability deliberately preserved (not deleted) for a
 * later phase. `scope` is the minimal additive discriminator —
 * identical idiom to CommercialPolicyOverride.js's own `scopeType`
 * field in this exact codebase:
 *   - scope: "GLOBAL" -> areaRef is null. At most one PUBLISHED GLOBAL
 *     document ever exists (new partial-unique index below).
 *   - scope: "AREA"   -> areaRef required, exactly the pre-existing
 *     behavior and its own pre-existing partial-unique index, both
 *     byte-for-byte unchanged.
 * areaRef's conditional requirement (required for AREA, forbidden for
 * GLOBAL) is enforced in the SERVICE layer, not via a Mongoose
 * conditional-required function on `this` — the sibling
 * CommercialPolicyOverride.js model's own header documents exactly why
 * that pattern is unreliable inside findOneAndUpdate (AREA-2.4.1
 * lesson), so this file follows that already-proven precedent instead.
 * Existing (pre-launch) documents have no `scope` field in the raw
 * BSON at all — never backfilled, never migrated — they simply never
 * match a `{scope:"GLOBAL"}` query, so they cannot be mistaken for a
 * Global policy. Nothing about the AREA path is deleted, renamed, or
 * behaviorally changed.
 *
 * A booking resolves and snapshots the fee amount at lockSlot time
 * (booking.controller.js) — client never supplies a fee amount.
 * Publishing a new fee only ever affects bookings locked after that
 * publish; historical bookings keep whatever was resolved at the time
 * (Booking.commissionAmountInPaise / Booking.platformFeePolicyRef,
 * both pre-existing, immutable, untouched by this change).
 *
 * PRICING ENGINE EXPANSION (2026-10 — GLOBAL scope only, AREA scope
 * untouched/still flat-fee-only): `calculationType` is the second
 * additive discriminator, same service-layer-enforced-conditional
 * idiom as `scope`/`areaRef` above.
 *   - FIXED      -> feeInPaise (pre-existing field, reused as-is).
 *   - PERCENTAGE -> percentageRate (0-100), applied to the booking's
 *     serviceAmountInPaise, rounded with Math.round — the exact same
 *     rounding convention already used for GST (services/gstPolicy.service.js
 *     callers), chosen for consistency, not reinvented here.
 *   - SLAB       -> slabs[], each {minAmountInPaise, maxAmountInPaise,
 *     feeInPaise}. Boundary semantics (locked, see
 *     services/areaPlatformFee.service.js#validateGlobalFeeConfig for
 *     the enforcement): BOTH ends inclusive (minAmount <= amount <=
 *     maxAmount), so a non-overlapping, gapless slab list reads
 *     naturally (₹100-200, ₹201-300, no overlap, no gap). The FIRST
 *     slab (lowest minAmountInPaise) is REQUIRED to start at 0 — the
 *     safest launch choice: real bookings are never priced below ₹1
 *     (Service.price has `min: 1`), but requiring a 0 floor removes
 *     an entire class of "what if the amount is below every slab"
 *     edge case rather than deferring it. The LAST slab (highest
 *     minAmountInPaise) is REQUIRED to have `maxAmountInPaise: null`
 *     — an explicit "unlimited" representation (never a magic huge
 *     integer) — and is the ONLY slab allowed to be unlimited; every
 *     other slab must have a finite max. Combined with the mandatory
 *     gapless-coverage check, this makes it structurally impossible
 *     for a valid (non-negative) booking amount to match zero slabs,
 *     which is this feature's own version of "no silent ₹0" — an
 *     invalid configuration is rejected at both createDraft/updateDraft
 *     time AND re-checked at publish time, never allowed to reach a
 *     live booking.
 * `calculationType` is schema-required, but defaults via a function
 * (not a static value) to "FIXED" when `this.scope === "AREA"` —
 * this keeps every pre-existing AREA-scope caller (including the
 * disposable E2E fixtures that `.create()` AREA policies directly,
 * bypassing the service layer) working with zero further changes,
 * while still forcing every GLOBAL-scope caller to state its
 * calculation type explicitly (no default for GLOBAL). This default
 * function only ever runs at document construction (`.create()`/
 * `new Model()`), never inside `findOneAndUpdate` — none of this
 * model's write paths use `findOneAndUpdate` (createDraft uses
 * `.create()`, update/publish/retire use `.findById()` + `.save()`),
 * so the AREA-2.4.1 "`this` is unreliable inside findOneAndUpdate"
 * lesson referenced above does not apply to this particular default.
 */

import mongoose from "mongoose";

export const AREA_PLATFORM_FEE_STATUS = Object.freeze({
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  RETIRED: "RETIRED",
});

// Launch-phase addition — see file header. Not named "AREA_PLATFORM_FEE_SCOPE"
// (this model's own name predates the Global concept) to avoid an
// unrelated rename; the export name is new, the model/collection name
// is untouched.
export const PLATFORM_FEE_SCOPE = Object.freeze({
  GLOBAL: "GLOBAL",
  AREA: "AREA",
});

// Pricing Engine Expansion addition — see file header.
export const PLATFORM_FEE_CALCULATION_TYPE = Object.freeze({
  FIXED: "FIXED",
  PERCENTAGE: "PERCENTAGE",
  SLAB: "SLAB",
});

const areaPlatformFeePolicySchema = new mongoose.Schema(
  {
    // Launch-phase addition. No `default` — every NEW write must state
    // its scope explicitly (createDraftAreaPlatformFee always passes
    // one). Absent entirely on every pre-existing document; a missing
    // field never equals "GLOBAL" or "AREA" in a Mongo query, so old
    // rows are structurally invisible to both new code paths unless
    // explicitly queried without a scope filter (e.g. the existing
    // admin list/detail endpoints, unchanged).
    scope: {
      type: String,
      enum: Object.values(PLATFORM_FEE_SCOPE),
      required: true,
    },

    // Required for scope:"AREA" (pre-existing behavior, unchanged).
    // For scope:"GLOBAL", must be null/omitted — enforced in
    // areaPlatformFee.service.js, not here (see file header).
    areaRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Area",
      default: null,
    },

    // Pricing Engine Expansion addition — see file header. No default
    // for scope:"GLOBAL" (every GLOBAL write must state it explicitly);
    // defaults to FIXED for scope:"AREA" so every pre-existing raw
    // AREA `.create()` caller keeps working unchanged.
    calculationType: {
      type: String,
      enum: Object.values(PLATFORM_FEE_CALCULATION_TYPE),
      required: true,
      default: function () {
        return this.scope === PLATFORM_FEE_SCOPE.AREA ? PLATFORM_FEE_CALCULATION_TYPE.FIXED : undefined;
      },
    },

    // FIXED mode only now (was unconditionally required) — conditional
    // requirement enforced in areaPlatformFee.service.js, matching the
    // scope/areaRef precedent above. Always required+used for AREA
    // scope (unchanged pre-existing behavior).
    feeInPaise: {
      type: Number,
      min: [0, "feeInPaise cannot be negative"],
      validate: {
        validator: (v) => v == null || Number.isInteger(v),
        message: "feeInPaise must be a whole number (paise, not rupees)",
      },
      default: null,
    },

    // PERCENTAGE mode only — Pricing Engine Expansion addition.
    percentageRate: {
      type: Number,
      min: [0, "percentageRate cannot be negative"],
      max: [100, "percentageRate cannot exceed 100"],
      default: null,
    },

    // SLAB mode only — Pricing Engine Expansion addition. Boundary
    // semantics and full validation live in
    // areaPlatformFee.service.js#validateGlobalFeeConfig — see file
    // header. Each slab keeps its own auto-generated _id (default
    // Mongoose subdocument behavior, not suppressed) so the admin UI
    // can key its edit/remove row actions on something stable.
    slabs: {
      type: [
        {
          minAmountInPaise: {
            type: Number,
            required: true,
            min: [0, "minAmountInPaise cannot be negative"],
            validate: { validator: Number.isInteger, message: "minAmountInPaise must be a whole number" },
          },
          maxAmountInPaise: {
            type: Number,
            default: null, // null = unlimited — only the structurally-last slab may use this
            validate: {
              validator: (v) => v == null || Number.isInteger(v),
              message: "maxAmountInPaise must be a whole number or null (unlimited)",
            },
          },
          feeInPaise: {
            type: Number,
            required: true,
            min: [0, "feeInPaise cannot be negative"],
            validate: { validator: Number.isInteger, message: "feeInPaise must be a whole number" },
          },
        },
      ],
      default: undefined,
    },

    status: {
      type: String,
      enum: Object.values(AREA_PLATFORM_FEE_STATUS),
      default: AREA_PLATFORM_FEE_STATUS.DRAFT,
      required: true,
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    retiredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    publishedAt: { type: Date, default: null },
    retiredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// At most one PUBLISHED fee per area at a time — MongoDB-enforced.
areaPlatformFeePolicySchema.index(
  { areaRef: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: AREA_PLATFORM_FEE_STATUS.PUBLISHED },
  }
);

// Non-unique — supports the admin history view's "all versions for
// this area, newest first" query without scanning the whole collection.
areaPlatformFeePolicySchema.index({ areaRef: 1, createdAt: -1 });

// Launch-phase addition — see file header. At most one PUBLISHED
// GLOBAL fee ever exists, MongoDB-enforced, explicit and
// self-documenting rather than relying on the AREA index above
// (which would also reject a second areaRef:null PUBLISHED doc as a
// side effect, but that's not what it was written for).
areaPlatformFeePolicySchema.index(
  { scope: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      scope: PLATFORM_FEE_SCOPE.GLOBAL,
      status: AREA_PLATFORM_FEE_STATUS.PUBLISHED,
    },
  }
);

export default mongoose.models.AreaPlatformFeePolicy ||
  mongoose.model("AreaPlatformFeePolicy", areaPlatformFeePolicySchema);
