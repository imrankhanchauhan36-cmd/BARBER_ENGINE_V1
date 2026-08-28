/**
 * BARBER ENGINE V1
 * backend/modules/support/services/supportAgent.service.js
 *
 * Phase H Step 7 — Support Agent Management. Creates/reads/updates the
 * AGENT-role User + its SupportAgentProfile + SupportAgentWorkload as
 * one consistent unit, reusing every existing primitive unmodified:
 *   - User.js's own schema/validation/uniqueness rules (untouched)
 *   - SupportAgentProfile.js's own schema (untouched)
 *   - SupportAgentWorkload.js's own ensureAgentWorkload() (untouched)
 * No second authentication system, no new User fields, no new indexes.
 */

import crypto from "crypto";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

import { Errors } from "../../../utils/response.js";
import User from "../../../models/User.js";
import SupportAgentProfile from "../models/SupportAgentProfile.js";
import SupportAgentWorkload, { ensureAgentWorkload } from "../models/SupportAgentWorkload.js";
import SupportTeam from "../models/SupportTeam.js";
import SupportCategory from "../models/SupportCategory.js";

// Same bcrypt cost as seedSupportTestUsers.js (the more recent,
// Support-specific precedent) — admin.controller.js's own
// createStateAdmin uses 10; flagged in the approved plan as a known,
// pre-existing inconsistency this module does not attempt to fix.
const BCRYPT_COST = 12;

/////////////////////////////////////////////////////////////
// 🔐 TEMP PASSWORD — generated fresh per agent, never a shared
// hardcoded default (unlike admin.controller.js's "Admin@12345").
// Returned once in the creation response only; only the bcrypt hash
// is ever persisted.
/////////////////////////////////////////////////////////////

function generateTempPassword() {
  // 16 random bytes -> base64url, trimmed to 20 chars, then a fixed
  // suffix guaranteeing at least one digit + one uppercase letter so
  // it can never accidentally fail an unrelated future password-
  // strength rule. Not a login-facing UX string — an admin copies
  // this once and the agent is expected to change it (mustChangePassword).
  const random = crypto.randomBytes(16).toString("base64url").slice(0, 20);
  return `Zm${random}9A`;
}

/////////////////////////////////////////////////////////////
// 🔍 EXISTENCE CHECKS — same shape as slaPolicy.service.js's own
// assertCategoryExists(), extended to arrays via $in + count.
/////////////////////////////////////////////////////////////

async function assertTeamsExist(teamRefs = []) {
  if (!teamRefs.length) return;
  const count = await SupportTeam.countDocuments({ _id: { $in: teamRefs }, isDeleted: false });
  if (count !== teamRefs.length) {
    throw Errors.badRequest("One or more teamRefs do not reference an existing team");
  }
}

async function assertCategoriesExist(categoryRefs = []) {
  if (!categoryRefs.length) return;
  const count = await SupportCategory.countDocuments({ _id: { $in: categoryRefs }, isDeleted: false });
  if (count !== categoryRefs.length) {
    throw Errors.badRequest("One or more categoryRefs do not reference an existing category");
  }
}

function assertPrimaryTeamConsistent(teamRefs = [], primaryTeamRef = null) {
  if (!primaryTeamRef) return;
  const isMember = teamRefs.some((t) => String(t) === String(primaryTeamRef));
  if (!isMember) {
    throw Errors.badRequest("primaryTeamRef must be one of the provided teamRefs");
  }
}

/////////////////////////////////////////////////////////////
// 🧹 SANITIZATION — explicit allow-list, never relies on .lean()
// implicitly inheriting toJSON's strip-list (it doesn't).
/////////////////////////////////////////////////////////////

function toPublicAgentUser(userDoc) {
  return {
    id: userDoc._id,
    name: userDoc.name,
    email: userDoc.email,
    phone: userDoc.phone,
    role: userDoc.role,
    isActive: userDoc.isActive,
    createdAt: userDoc.createdAt,
  };
}

/////////////////////////////////////////////////////////////
// 🚀 CREATE — transactional: User + SupportAgentProfile +
// SupportAgentWorkload all succeed or all roll back.
/////////////////////////////////////////////////////////////

export async function createAgent({
  name, email, phone, teamRefs = [], primaryTeamRef = null,
  categoryRefs = [], languages = [], maxActiveTickets = null, actorId,
}) {
  await assertTeamsExist(teamRefs);
  await assertCategoriesExist(categoryRefs);
  assertPrimaryTeamConsistent(teamRefs, primaryTeamRef);

  const tempPassword = generateTempPassword();
  const hashedPassword = await bcrypt.hash(tempPassword, BCRYPT_COST);

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const [userDoc] = await User.create(
      [{
        name,
        email,
        phone,
        password: hashedPassword,
        role: "AGENT",
        isActive: true,
        isDeleted: false,
        // Forward-compatible only — no login flow currently reads this
        // field (confirmed by inspection of supportAuth.controller.js);
        // set for consistency with the majority of existing admin-
        // creation call sites, not because it changes behavior today.
        mustChangePassword: true,
        createdBy: actorId,
      }],
      { session }
    );

    const [profileDoc] = await SupportAgentProfile.create(
      [{
        userRef: userDoc._id,
        teamRefs,
        primaryTeamRef,
        categoryRefs,
        languages,
        isActive: true,
        maxActiveTickets,
        createdBy: actorId,
        updatedBy: actorId,
      }],
      { session }
    );

    await ensureAgentWorkload({ agentRef: userDoc._id, session });

    await session.commitTransaction();

    return {
      agent: toPublicAgentUser(userDoc),
      profile: profileDoc,
      tempPassword,
    };
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    if (err.code === 11000) {
      throw Errors.conflict("An account with this phone or email already exists");
    }
    throw err;
  } finally {
    session.endSession();
  }
}

/////////////////////////////////////////////////////////////
// 📋 LIST — joins live workload; explicit field allow-list on the
// populate select, not implicit trust in schema select:false defaults.
/////////////////////////////////////////////////////////////

export async function listAgents() {
  const profiles = await SupportAgentProfile.find({ isDeleted: false })
    .populate({ path: "userRef", select: "name email phone isActive role createdAt" })
    .sort({ createdAt: -1 })
    .lean();

  const agentIds = profiles.map((p) => p.userRef?._id).filter(Boolean);
  const workloads = await SupportAgentWorkload.find({ agentRef: { $in: agentIds } })
    .select("agentRef activeAssignmentCount")
    .lean();
  const workloadByAgent = new Map(workloads.map((w) => [String(w.agentRef), w.activeAssignmentCount]));

  return profiles
    .filter((p) => p.userRef) // defensive — skip a profile whose User was hard-deleted out of band
    .map((p) => ({
      id: p.userRef._id,
      name: p.userRef.name,
      email: p.userRef.email,
      phone: p.userRef.phone,
      userIsActive: p.userRef.isActive,
      profileId: p._id,
      teamRefs: p.teamRefs,
      primaryTeamRef: p.primaryTeamRef,
      categoryRefs: p.categoryRefs,
      languages: p.languages,
      isActive: p.isActive,
      maxActiveTickets: p.maxActiveTickets,
      availabilityStatus: p.availabilityStatus,
      activeAssignmentCount: workloadByAgent.get(String(p.userRef._id)) ?? 0,
      createdAt: p.createdAt,
    }));
}

/////////////////////////////////////////////////////////////
// 🔎 GET ONE — :id is the User._id (== SupportAgentProfile.userRef ==
// SupportAgentWorkload.agentRef), the one stable identifier already
// shared across every Support model that references an agent.
/////////////////////////////////////////////////////////////

export async function getAgentById(id) {
  if (!mongoose.isValidObjectId(id)) throw Errors.notFound("Agent not found");

  const profile = await SupportAgentProfile.findOne({ userRef: id, isDeleted: false })
    .populate({ path: "userRef", select: "name email phone isActive role createdAt" })
    .lean();

  if (!profile || !profile.userRef) throw Errors.notFound("Agent not found");

  const workload = await SupportAgentWorkload.findOne({ agentRef: id })
    .select("activeAssignmentCount")
    .lean();

  return {
    id: profile.userRef._id,
    name: profile.userRef.name,
    email: profile.userRef.email,
    phone: profile.userRef.phone,
    userIsActive: profile.userRef.isActive,
    profileId: profile._id,
    teamRefs: profile.teamRefs,
    primaryTeamRef: profile.primaryTeamRef,
    categoryRefs: profile.categoryRefs,
    languages: profile.languages,
    isActive: profile.isActive,
    maxActiveTickets: profile.maxActiveTickets,
    availabilityStatus: profile.availabilityStatus,
    activeAssignmentCount: workload?.activeAssignmentCount ?? 0,
    createdAt: profile.createdAt,
  };
}

/////////////////////////////////////////////////////////////
// ✏️ UPDATE PROFILE — SupportAgentProfile configuration fields only.
// Single-document write, no transaction needed (matches
// slaPolicy.service.js's updateSlaPolicy, also a single-document save).
/////////////////////////////////////////////////////////////

export async function updateAgentProfile(id, updates, actorId) {
  if (!mongoose.isValidObjectId(id)) throw Errors.notFound("Agent not found");

  const profile = await SupportAgentProfile.findOne({ userRef: id, isDeleted: false });
  if (!profile) throw Errors.notFound("Agent not found");

  if (Object.prototype.hasOwnProperty.call(updates, "teamRefs")) {
    await assertTeamsExist(updates.teamRefs);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "categoryRefs")) {
    await assertCategoriesExist(updates.categoryRefs);
  }

  const nextTeamRefs = Object.prototype.hasOwnProperty.call(updates, "teamRefs") ? updates.teamRefs : profile.teamRefs;
  const nextPrimaryTeamRef = Object.prototype.hasOwnProperty.call(updates, "primaryTeamRef") ? updates.primaryTeamRef : profile.primaryTeamRef;
  assertPrimaryTeamConsistent(nextTeamRefs, nextPrimaryTeamRef);

  Object.assign(profile, updates, { updatedBy: actorId });
  await profile.save();

  return getAgentById(id);
}

/////////////////////////////////////////////////////////////
// 🔌 STATUS — modifies SupportAgentProfile.isActive ONLY. User.isActive
// (which also gates supportAuth login) is deliberately untouched — a
// separate, more severe action this module does not expose, per the
// approved plan (item 9/13).
/////////////////////////////////////////////////////////////

export async function updateAgentStatus(id, isActive, actorId) {
  return updateAgentProfile(id, { isActive }, actorId);
}

/////////////////////////////////////////////////////////////
// 👥 TEAMS — minimal read-only list, needed only to populate the
// Team-assignment dropdown (no existing endpoint did this — confirmed
// by the Phase H Step 7 audit).
/////////////////////////////////////////////////////////////

export async function listTeams() {
  return SupportTeam.find({ isDeleted: false, isActive: true })
    .select("_id teamCode name")
    .sort({ name: 1 })
    .lean();
}
