/**
 * BARBER ENGINE V1
 * backend/modules/support/services/supportRoutingRuleConfig.service.js
 *
 * Phase H Step 8 (Step 4) — Support Configuration Management: Routing
 * Rules. Confirmed by direct inspection of routingResolution.
 * service.js: it only ever READS active SupportRoutingRule rows
 * (`SupportRoutingRule.find({isActive:true,isDeleted:false})
 * .sort({rulePriority:1})`) — no admin route/controller/service for
 * writing them existed before this file. This service does not
 * change, wrap, or re-implement any part of resolveRouting()/
 * selectWinningRule() — it only lets an admin create/edit the rows
 * that engine already reads, using the exact same field shape.
 *
 * createdBy/updatedBy (already on SupportRoutingRule.js) are reused as
 * the audit mechanism, same as Teams/Categories/Queues.
 */

import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import SupportRoutingRule from "../models/SupportRoutingRule.js";
import SupportCategory from "../models/SupportCategory.js";
import SupportQueue from "../models/SupportQueue.js";
import SupportTeam from "../models/SupportTeam.js";
import Country from "../../../models/Country.js";
import State from "../../../models/State.js";
import District from "../../../models/District.js";
import City from "../../../models/City.js";
import Area from "../../../models/Area.js";

const GEO_MODELS = {
  countryRef: Country,
  stateRef: State,
  districtRef: District,
  cityRef: City,
  areaRef: Area,
};

/////////////////////////////////////////////////////////////
// 🔍 VALIDATION — reference existence only. Geo fields are
// independent optional wildcards on this model (unlike SupportCoverage,
// which has a scopeLevel-driven consistency hook) — no cross-field
// consistency rule is invented here that the model itself doesn't have.
/////////////////////////////////////////////////////////////

async function assertGeoRefsValid(fields) {
  for (const [field, Model] of Object.entries(GEO_MODELS)) {
    const value = fields[field];
    if (!value) continue;
    const exists = await Model.exists({ _id: value, isDeleted: { $ne: true } });
    if (!exists) throw Errors.badRequest(`${field} does not reference an existing record`);
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
  await assertGeoRefsValid(fields);
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

function toPublicRule(rule) {
  return {
    id: rule._id,
    name: rule.name,
    description: rule.description,
    isActive: rule.isActive,
    rulePriority: rule.rulePriority,
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: rule.effectiveTo,
    countryRef: rule.countryRef,
    stateRef: rule.stateRef,
    districtRef: rule.districtRef,
    cityRef: rule.cityRef,
    areaRef: rule.areaRef,
    categoryRefs: rule.categoryRefs,
    priorities: rule.priorities,
    languages: rule.languages,
    requesterTypes: rule.requesterTypes,
    targetQueueRef: rule.targetQueueRef,
    targetTeamRef: rule.targetTeamRef,
    createdBy: rule.createdBy,
    updatedBy: rule.updatedBy,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

/////////////////////////////////////////////////////////////
// 🚀 CREATE
/////////////////////////////////////////////////////////////

export async function createRoutingRule(fields) {
  const { actorId, ...ruleFields } = fields;
  await assertReferencesValid(ruleFields);

  const rule = await SupportRoutingRule.create({
    ...ruleFields,
    isDeleted: false,
    createdBy: actorId,
    updatedBy: actorId,
  });
  return toPublicRule(rule);
}

/////////////////////////////////////////////////////////////
// 📋 LIST — management view. All non-deleted rules, sorted by
// rulePriority (matches the engine's own read order) then name.
/////////////////////////////////////////////////////////////

export async function listRoutingRulesForAdmin() {
  const rules = await SupportRoutingRule.find({ isDeleted: false })
    .sort({ rulePriority: 1, name: 1 })
    .lean();
  return rules.map(toPublicRule);
}

/////////////////////////////////////////////////////////////
// ✏️ UPDATE
/////////////////////////////////////////////////////////////

export async function updateRoutingRule(id, updates, actorId) {
  if (!mongoose.isValidObjectId(id)) throw Errors.notFound("Routing rule not found");

  const rule = await SupportRoutingRule.findOne({ _id: id, isDeleted: false });
  if (!rule) throw Errors.notFound("Routing rule not found");

  await assertReferencesValid(updates);

  Object.assign(rule, updates, { updatedBy: actorId });
  await rule.save();

  return toPublicRule(rule);
}

/////////////////////////////////////////////////////////////
// 🔌 STATUS
/////////////////////////////////////////////////////////////

export async function updateRoutingRuleStatus(id, isActive, actorId) {
  return updateRoutingRule(id, { isActive }, actorId);
}
