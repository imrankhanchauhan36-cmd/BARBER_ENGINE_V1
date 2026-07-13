/**
 * BARBER_ENGINE_V1
 * backend/models/Category.js
 *
 * Category Discovery Engine — v1 (FROZEN SPEC)
 *
 * Single source of truth powering: Home Screen, Search, Filters,
 * Recommendations, Admin Panel, Analytics, future PWA.
 *
 * ── STABILITY CONTRACT ────────────────────────────────────────────
 * `code` and `slug` are PERMANENT once created. They are referenced
 * by deep links, analytics events, and (loosely) by Service.category
 * matching in the discovery layer. Never rename them — only
 * displayName, icon/image, displayOrder, and visibility flags are
 * safe to change after creation.
 *
 * ── LINKING STRATEGY ────────────────────────────────────────────────
 * This is a LOOSE coupling to Service.category, not a hard foreign
 * key. Service.category today is a free string set by salon owners
 * (e.g. "HAIRCUT", "OTHER") with real data-quality noise (facial
 * services sometimes tagged FACIAL, sometimes OTHER). The Discovery
 * API matches ?category=<slug> against Service.category AND
 * Service.name via case-insensitive partial match — not strict
 * equality — so no migration of existing Service data is required
 * before this ships.
 *
 * ── VISIBILITY MODEL ─────────────────────────────────────────────────
 * Only isActive:true categories are returned by the public Discovery
 * API. "Coming soon" categories (e.g. Grooming Packages, Bridal at
 * launch) are seeded with isActive:false and comingSoon:true — they
 * exist in the DB for the admin panel to preview/manage, but stay
 * fully invisible to end users until an admin flips isActive:true.
 * This keeps the V1 frontend simple (no "coming soon" badge/disabled-
 * tap UI needed yet) while the data model is ready for it later.
 */

import mongoose from "mongoose";

const CategorySchema = new mongoose.Schema(
  {
    // Permanent internal code — never changes once set. Used for
    // analytics/reporting/integrations independent of display text.
    // e.g. "CAT_HAIRCUT"
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      unique: true,
      match: /^CAT_[A-Z0-9_]+$/,
    },

    // Permanent URL/filter identifier — never changes once set.
    // e.g. "haircut". This is what ?category= matches against.
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      match: /^[a-z0-9]+(-[a-z0-9]+)*$/,
      index: true,
    },

    // User-facing name — freely editable, does NOT affect slug/code.
    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
    },

    description: {
      type: String,
      default: "",
      trim: true,
      maxlength: 300,
    },

    // ── Assets — frontend never hardcodes these ──────────────────
    iconUrl: { type: String, default: null },      // chip icon (~200x200)
    thumbnailUrl: { type: String, default: null },  // low-bandwidth / list use
    imageUrl: { type: String, default: null },      // future banner/grid card (~800x600)

    // Which Home gender-tab(s) this category's chip should appear
    // under (Men / Women / Unisex switcher, already built on Home
    // Screen). Distinct from Service.applicableFor: this controls
    // whether the CATEGORY CHIP shows on the current tab; Service's
    // own applicableFor separately controls which services within a
    // salon are bookable for that gender. Both are needed — this
    // one is not redundant with the other.
    applicableFor: {
      type: [{ type: String, enum: ["MEN", "WOMEN"] }],
      default: ["MEN", "WOMEN"],
    },

    // ── Directory-level defaults ──────────────────────────────────
    // NOT authoritative pricing/duration — these are display hints
    // only (e.g. Home screen "Starts from ₹199", initial filter
    // ranges, salon onboarding defaults). A salon's actual Service
    // documents (price, duration) always take precedence wherever
    // real booking numbers are shown. Nullable — a category with no
    // default simply omits these from its card.
    estimatedDuration: {
      type: Number,   // minutes
      default: null,
      min: 0,
    },
    startingPrice: {
      type: Number,   // rupees
      default: null,
      min: 0,
    },

    // ── Visibility & lifecycle ────────────────────────────────────
    featured: {
      type: Boolean,
      default: false,
    },

    // See VISIBILITY MODEL note above — paired with isActive:false
    // for categories not yet ready to accept bookings.
    comingSoon: {
      type: Boolean,
      default: false,
    },

    // Core taxonomy categories (Haircut, Facial, etc). These can be
    // disabled but must never be hard-deleted — protects deep links
    // and historical analytics from breaking.
    systemCategory: {
      type: Boolean,
      default: false,
    },

    // Bumped whenever this document changes in a way the frontend
    // cache should invalidate on. Deliberately explicit rather than
    // relying on updatedAt (which changes on any save, including
    // internal bookkeeping) — version changes only on real content
    // edits.
    version: {
      type: Number,
      default: 1,
    },

    displayOrder: {
      type: Number,
      default: 0,
      index: true,
    },

    // Soft-disable — hidden from the public Discovery API but never
    // removed from the DB. This is the ONLY way to "remove" a
    // systemCategory from view; hard delete is blocked in the
    // controller for systemCategory: true documents.
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Primary public-read pattern: active, non-deleted, sorted by
// displayOrder — the exact shape of the Discovery API's category list.
CategorySchema.index({ isDeleted: 1, isActive: 1, displayOrder: 1 });

export default mongoose.models.Category || mongoose.model("Category", CategorySchema);