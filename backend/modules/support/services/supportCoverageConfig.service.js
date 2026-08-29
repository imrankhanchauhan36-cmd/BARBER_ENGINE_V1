/**
 * BARBER ENGINE V1
 * backend/modules/support/services/supportCoverageConfig.service.js
 *
 * Phase H Step 8 (Step 5) — Support Configuration Management:
 * Coverage. Confirmed by direct inspection of routingResolution.
 * service.js: it only ever READS active SupportCoverage rows via
 * resolveCoverageForTicket()'s AREA->CITY->DISTRICT->STATE->COUNTRY
 * walk-up — no admin write route existed before this file. This
 * service does not change that walk-up algorithm, selectCoverageWinner(),
 * or buildRoutingDecision() in any way.
 *
 * The model's own two pre("validate") hooks (scope-level geo
 * consistency; effectiveTo > effectiveFrom) remain the sole DB-level
 * authority for those two rules — this service does not bypass or
 * weaken them in any way, and the model itself is untouched.
 *
 * IMPORTANT, discovered empirically during Step 8 testing (not
 * assumed): the geo-consistency hook calls `next(new Error(...))` —
 * a PLAIN Error, not a mongoose.Error.ValidationError — so a
 * violation does NOT get mapped to a 422 by the existing global
 * errorHandler (which only pattern-matches on
 * mongoose.Error.ValidationError) and instead falls through to a raw
 * 500. This is a pre-existing gap in the model's own hook, invisible
 * until now because no prior code path ever called
 * SupportCoverage.create()/.save() with admin/attacker-controllable
 * input (only the seed script wrote here, always with a
 * hand-verified-correct row). Per the explicit "do not redesign the
 * coverage model" instruction, the hook itself is NOT modified here.
 * Instead, assertGeoConsistency() below mirrors the exact same rule
 * as a service-level pre-check, giving every caller a proper 400
 * BAD_REQUEST before ever reaching that hook — the same
 * "friendly pre-check in the service, DB-level rule remains the real
 * authority" idiom SupportSlaPolicy.js's own comment already
 * documents for its unique index.
 *
 * createdBy/updatedBy (already on SupportCoverage.js) are reused as
 * the audit mechanism, same as every other Step 8 config resource.
 */

import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import SupportCoverage from "../models/SupportCoverage.js";
import SupportCategory from "../models/SupportCategory.js";
import SupportQueue from "../models/SupportQueue.js";
import SupportTeam from "../models/SupportTeam.js";
import { SCOPE_LEVEL } from "../constants/support.constants.js";

// Exact mirror of SupportCoverage.js's own SCOPE_LEVEL_ORDER/
// SCOPE_LEVEL_FIELD — kept in sync by inspection, not imported,
// because the model does not export them; duplicating two small
// constant maps is preferable to reaching into the model's internals.
const SCOPE_LEVEL_ORDER = [
  SCOPE_LEVEL.COUNTRY,
  SCOPE_LEVEL.STATE,
  SCOPE_LEVEL.DISTRICT,
  SCOPE_LEVEL.CITY,
  SCOPE_LEVEL.AREA,
];
const SCOPE_LEVEL_FIELD = {
  [SCOPE_LEVEL.COUNTRY]: "countryRef",
  [SCOPE_LEVEL.STATE]: "stateRef",
  [SCOPE_LEVEL.DISTRICT]: "districtRef",
  [SCOPE_LEVEL.CITY]: "cityRef",
  [SCOPE_LEVEL.AREA]: "areaRef",
};

function assertGeoConsistency(scopeLevel, fields) {
  const levelIndex = SCOPE_LEVEL_ORDER.indexOf(scopeLevel);
  if (levelIndex === -1) return; // invalid enum value — Joi already rejects this
  for (let i = 0; i < SCOPE_LEVEL_ORDER.length; i++) {
    const field = SCOPE_LEVEL_FIELD[SCOPE_LEVEL_ORDER[i]];
    const isRequiredAtThisLevel = i <= levelIndex;
    if (isRequiredAtThisLevel && !fields[field]) {
      throw Errors.badRequest(`${field} is required for scopeLevel ${scopeLevel}`);
    }
    if (!isRequiredAtThisLevel && fields[field]) {
      throw Errors.badRequest(`${field} must not be set for scopeLevel ${scopeLevel}`);
    }
  }
}

async function assertCategoriesValid(categoryRefs = []) {
  if (!categoryRefs.length) return;
  const count = await SupportCategory.countDocuments({ _id: { $in: categoryRefs }, isDeleted: false });
  if (count !== categoryRefs.length) {
    throw Errors.badRequest("One or more categoryRefs do not reference an existing category");
  }
}

async function assertTargetQueueValid(targetQueueRef) {
  if (!targetQueueRef) return;
  const exists = await SupportQueue.exists({ _id: targetQueueRef, isDeleted: false });
  if (!exists) throw Errors.badRequest("targetQueueRef must reference an existing queue");
}

async function assertTargetTeamValid(targetTeamRef) {
  if (!targetTeamRef) return;
  const exists = await SupportTeam.exists({ _id: targetTeamRef, isDeleted: false });
  if (!exists) throw Errors.badRequest("targetTeamRef must reference an existing team");
}

async function assertReferencesValid(fields) {
  if (Object.prototype.hasOwnProperty.call(fields, "categoryRefs")) {
    await assertCategoriesValid(fields.categoryRefs);
  }
  if (Object.prototype.hasOwnProperty.call(fields, "targetQueueRef")) {
    await assertTargetQueueValid(fields.targetQueueRef);
  }
  if (Object.prototype.hasOwnProperty.call(fields, "targetTeamRef")) {
    await assertTargetTeamValid(fields.targetTeamRef);
  }
}

function toPublicCoverage(coverage) {
  return {
    id: coverage._id,
    scopeLevel: coverage.scopeLevel,
    countryRef: coverage.countryRef,
    stateRef: coverage.stateRef,
    districtRef: coverage.districtRef,
    cityRef: coverage.cityRef,
    areaRef: coverage.areaRef,
    categoryRefs: coverage.categoryRefs,
    priorities: coverage.priorities,
    isActive: coverage.isActive,
    effectiveFrom: coverage.effectiveFrom,
    effectiveTo: coverage.effectiveTo,
    targetQueueRef: coverage.targetQueueRef,
    targetTeamRef: coverage.targetTeamRef,
    selectionPriority: coverage.selectionPriority,
    fallbackBehavior: coverage.fallbackBehavior,
    createdBy: coverage.createdBy,
    updatedBy: coverage.updatedBy,
    createdAt: coverage.createdAt,
    updatedAt: coverage.updatedAt,
  };
}

/////////////////////////////////////////////////////////////
// 🚀 CREATE
/////////////////////////////////////////////////////////////

export async function createCoverage(fields) {
  const { actorId, ...coverageFields } = fields;
  await assertReferencesValid(coverageFields);
  assertGeoConsistency(coverageFields.scopeLevel, coverageFields);

  const coverage = await SupportCoverage.create({
    ...coverageFields,
    isDeleted: false,
    createdBy: actorId,
    updatedBy: actorId,
  });
  return toPublicCoverage(coverage);
}

/////////////////////////////////////////////////////////////
// 📋 LIST — management view. All non-deleted coverage rows, sorted by
// scopeLevel then selectionPriority (mirrors how the engine picks a
// winner within one level).
/////////////////////////////////////////////////////////////

export async function listCoverageForAdmin() {
  const rows = await SupportCoverage.find({ isDeleted: false })
    .sort({ scopeLevel: 1, selectionPriority: 1 })
    .lean();
  return rows.map(toPublicCoverage);
}

/////////////////////////////////////////////////////////////
// ✏️ UPDATE — scopeLevel itself is never editable (enforced by the
// validator's Joi.forbidden()); every other field can change, and
// re-running the model's own validate hooks on save() keeps geo
// consistency correct even after a partial update.
/////////////////////////////////////////////////////////////

export async function updateCoverage(id, updates, actorId) {
  if (!mongoose.isValidObjectId(id)) throw Errors.notFound("Coverage not found");

  const coverage = await SupportCoverage.findOne({ _id: id, isDeleted: false });
  if (!coverage) throw Errors.notFound("Coverage not found");

  await assertReferencesValid(updates);

  const mergedGeo = {};
  for (const field of Object.values(SCOPE_LEVEL_FIELD)) {
    mergedGeo[field] = Object.prototype.hasOwnProperty.call(updates, field) ? updates[field] : coverage[field];
  }
  assertGeoConsistency(coverage.scopeLevel, mergedGeo);

  Object.assign(coverage, updates, { updatedBy: actorId });
  await coverage.save();

  return toPublicCoverage(coverage);
}

/////////////////////////////////////////////////////////////
// 🔌 STATUS
/////////////////////////////////////////////////////////////

export async function updateCoverageStatus(id, isActive, actorId) {
  return updateCoverage(id, { isActive }, actorId);
}
