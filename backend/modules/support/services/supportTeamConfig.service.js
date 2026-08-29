/**
 * BARBER ENGINE V1
 * backend/modules/support/services/supportTeamConfig.service.js
 *
 * Phase H Step 8 (Step 1) — Support Configuration Management: Teams.
 * Full admin CRUD over SupportTeam, deliberately SEPARATE from
 * supportAgent.service.js's own listTeams() (the Agent-creation
 * dropdown: active-only, {_id,teamCode,name} projection) — that
 * function and its route (GET /api/support/admin/teams) are left
 * completely unchanged. This file's listTeamsForAdmin() is a distinct
 * function for the new management view (all non-deleted teams,
 * active or inactive, full fields) reached via a separate route
 * (GET /api/support/admin/teams/manage).
 *
 * createdBy/updatedBy (already on SupportTeam.js) are reused as the
 * audit mechanism for these config changes — SupportAuditEvent is not
 * used here since its schema requires a ticketRef (config changes have
 * none), and inventing a second audit system was explicitly ruled out.
 */

import mongoose from "mongoose";
import { Errors } from "../../../utils/response.js";
import SupportTeam from "../models/SupportTeam.js";
import User from "../../../models/User.js";

/////////////////////////////////////////////////////////////
// 🔍 VALIDATION — teamLeadRef must reference a real, active AGENT.
// "Team Lead is derived, never a User.role... the only role that can
// ever lead a SupportTeam is AGENT" (slaEscalation.service.js's own
// comment) — enforced here rather than assumed.
/////////////////////////////////////////////////////////////

async function assertTeamLeadValid(teamLeadRef) {
  if (!teamLeadRef) return;
  const agent = await User.findOne({
    _id: teamLeadRef,
    role: "AGENT",
    isActive: true,
    isDeleted: { $ne: true },
  }).select("_id").lean();
  if (!agent) {
    throw Errors.badRequest("teamLeadRef must reference an existing active AGENT");
  }
}

function toPublicTeam(team) {
  return {
    id: team._id,
    teamCode: team.teamCode,
    name: team.name,
    description: team.description,
    teamLeadRef: team.teamLeadRef,
    isActive: team.isActive,
    createdBy: team.createdBy,
    updatedBy: team.updatedBy,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  };
}

/////////////////////////////////////////////////////////////
// 🚀 CREATE
/////////////////////////////////////////////////////////////

export async function createTeam({ teamCode, name, description = null, teamLeadRef = null, actorId }) {
  await assertTeamLeadValid(teamLeadRef);

  try {
    const team = await SupportTeam.create({
      teamCode,
      name,
      description,
      teamLeadRef,
      isActive: true,
      isDeleted: false,
      createdBy: actorId,
      updatedBy: actorId,
    });
    return toPublicTeam(team);
  } catch (err) {
    if (err.code === 11000) {
      throw Errors.conflict("A team with this teamCode already exists");
    }
    throw err;
  }
}

/////////////////////////////////////////////////////////////
// 📋 LIST — management view. All non-deleted teams (active AND
// inactive, unlike the Agent-creation dropdown's active-only filter),
// full fields.
/////////////////////////////////////////////////////////////

export async function listTeamsForAdmin() {
  const teams = await SupportTeam.find({ isDeleted: false })
    .sort({ name: 1 })
    .lean();
  return teams.map(toPublicTeam);
}

/////////////////////////////////////////////////////////////
// ✏️ UPDATE — single-document write, no transaction needed (matches
// slaPolicy.service.js's updateSlaPolicy / supportAgent.service.js's
// updateAgentProfile, also single-document saves).
/////////////////////////////////////////////////////////////

export async function updateTeam(id, updates, actorId) {
  if (!mongoose.isValidObjectId(id)) throw Errors.notFound("Team not found");

  const team = await SupportTeam.findOne({ _id: id, isDeleted: false });
  if (!team) throw Errors.notFound("Team not found");

  if (Object.prototype.hasOwnProperty.call(updates, "teamLeadRef")) {
    await assertTeamLeadValid(updates.teamLeadRef);
  }

  Object.assign(team, updates, { updatedBy: actorId });

  try {
    await team.save();
  } catch (err) {
    if (err.code === 11000) {
      throw Errors.conflict("A team with this teamCode already exists");
    }
    throw err;
  }

  return toPublicTeam(team);
}

/////////////////////////////////////////////////////////////
// 🔌 STATUS — activate/deactivate. Deliberately does not touch
// anything else (no team-lead re-check, no assignment/routing side
// effect) — routingResolution.service.js/assignmentResolution.
// service.js are read-only over SupportTeam and are not modified by
// this change.
/////////////////////////////////////////////////////////////

export async function updateTeamStatus(id, isActive, actorId) {
  return updateTeam(id, { isActive }, actorId);
}
