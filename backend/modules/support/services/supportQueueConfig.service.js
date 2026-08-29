/**
 * BARBER ENGINE V1
 * backend/modules/support/services/supportQueueConfig.service.js
 *
 * Phase H Step 8 (Step 3) — Support Configuration Management: Queues.
 *
 * Confirmed by direct inspection: no prior API/service anywhere reads
 * SupportQueue's own fields (categoryRefs/ownerTeamRef/
 * maxConcurrentTickets) — every existing consumer (SupportTicket.
 * currentAssignment.queueRef, SupportAssignment.queueRef,
 * SupportRoutingRule/SupportCoverage's targetQueueRef) only ever
 * carries it as an opaque ObjectId. This file is therefore purely
 * additive — there is no existing "list queues" endpoint or response
 * shape to preserve, unlike Teams/Categories.
 *
 * routingResolution.service.js/assignmentResolution.service.js are
 * NOT modified by this file — they keep treating targetQueueRef/
 * queueRef as an opaque id exactly as before; this service only lets
 * an admin create/edit the SupportQueue documents those ids point at.
 *
 * createdBy/updatedBy (already on SupportQueue.js) are reused as the
 * audit mechanism, same as Teams/Categories.
 */

import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import SupportQueue from "../models/SupportQueue.js";
import SupportTeam from "../models/SupportTeam.js";
import SupportCategory from "../models/SupportCategory.js";

/////////////////////////////////////////////////////////////
// 🔍 VALIDATION — same existence-check idiom as supportAgent.
// service.js's assertTeamsExist/assertCategoriesExist.
/////////////////////////////////////////////////////////////

async function assertOwnerTeamValid(ownerTeamRef) {
  const team = await SupportTeam.findOne({ _id: ownerTeamRef, isDeleted: false }).select("_id").lean();
  if (!team) {
    throw Errors.badRequest("ownerTeamRef must reference an existing team");
  }
}

async function assertCategoriesValid(categoryRefs = []) {
  if (!categoryRefs.length) return;
  const count = await SupportCategory.countDocuments({ _id: { $in: categoryRefs }, isDeleted: false });
  if (count !== categoryRefs.length) {
    throw Errors.badRequest("One or more categoryRefs do not reference an existing category");
  }
}

function toPublicQueue(queue) {
  return {
    id: queue._id,
    queueCode: queue.queueCode,
    name: queue.name,
    description: queue.description,
    categoryRefs: queue.categoryRefs,
    ownerTeamRef: queue.ownerTeamRef,
    maxConcurrentTickets: queue.maxConcurrentTickets,
    isActive: queue.isActive,
    createdBy: queue.createdBy,
    updatedBy: queue.updatedBy,
    createdAt: queue.createdAt,
    updatedAt: queue.updatedAt,
  };
}

/////////////////////////////////////////////////////////////
// 🚀 CREATE
/////////////////////////////////////////////////////////////

export async function createQueue({ queueCode, name, description = null, categoryRefs = [], ownerTeamRef, maxConcurrentTickets = null, actorId }) {
  await assertOwnerTeamValid(ownerTeamRef);
  await assertCategoriesValid(categoryRefs);

  try {
    const queue = await SupportQueue.create({
      queueCode,
      name,
      description,
      categoryRefs,
      ownerTeamRef,
      maxConcurrentTickets,
      isActive: true,
      isDeleted: false,
      createdBy: actorId,
      updatedBy: actorId,
    });
    return toPublicQueue(queue);
  } catch (err) {
    if (err.code === 11000) {
      throw Errors.conflict("A queue with this queueCode already exists");
    }
    throw err;
  }
}

/////////////////////////////////////////////////////////////
// 📋 LIST — management view. All non-deleted queues, full fields.
/////////////////////////////////////////////////////////////

export async function listQueuesForAdmin() {
  const queues = await SupportQueue.find({ isDeleted: false })
    .sort({ name: 1 })
    .lean();
  return queues.map(toPublicQueue);
}

/////////////////////////////////////////////////////////////
// ✏️ UPDATE
/////////////////////////////////////////////////////////////

export async function updateQueue(id, updates, actorId) {
  if (!mongoose.isValidObjectId(id)) throw Errors.notFound("Queue not found");

  const queue = await SupportQueue.findOne({ _id: id, isDeleted: false });
  if (!queue) throw Errors.notFound("Queue not found");

  if (Object.prototype.hasOwnProperty.call(updates, "ownerTeamRef")) {
    await assertOwnerTeamValid(updates.ownerTeamRef);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "categoryRefs")) {
    await assertCategoriesValid(updates.categoryRefs);
  }

  Object.assign(queue, updates, { updatedBy: actorId });

  try {
    await queue.save();
  } catch (err) {
    if (err.code === 11000) {
      throw Errors.conflict("A queue with this queueCode already exists");
    }
    throw err;
  }

  return toPublicQueue(queue);
}

/////////////////////////////////////////////////////////////
// 🔌 STATUS
/////////////////////////////////////////////////////////////

export async function updateQueueStatus(id, isActive, actorId) {
  return updateQueue(id, { isActive }, actorId);
}
