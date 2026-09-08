//////////////////////////////////////////////////////////////
// WEEKLY SCHEDULE TEMPLATE ENGINE — SERVICE (C4 Phase 1)
//
// Owner-facing, versioned weekly (day-of-week) staff→chair→time
// PATTERN storage — a new, dedicated collection
// (WeeklyScheduleTemplate), per the approved C4 audit. Configuration
// only: does NOT create, read, or touch ProfessionalChairAssignment,
// Booking, the Slot Engine, or Chair Timeline. No materializer, no
// cron, no background job exists yet — that is C4 Phase 2, not built
// here.
//
// Concurrency / conflict scope: deliberately does NOT run the full
// Rule A-D conflict engine professionalChairAssignment.service.js
// uses — this template is configuration, not a concrete bookable
// commitment. The (not-yet-built) materializer will be the one to
// apply the real conflict engine when it eventually turns a template
// entry into a concrete ProfessionalChairAssignment row.
//////////////////////////////////////////////////////////////

import Salon from "../models/Salon.js";
import Chair from "../models/Chair.js";
import Staff from "../models/Staff.js";
import WeeklyScheduleTemplate from "../models/WeeklyScheduleTemplate.js";

import { TEMPLATE_STATUS, WEEKDAYS } from "../constants/weeklyScheduleTemplate.constants.js";
import { Errors } from "../utils/response.js";

//////////////////////////////////////////////////////////////
// 🧠 HELPERS — same local-duplication convention
// professionalChairAssignment.service.js, chairAvailability.service.js,
// and professional.service.js already use (independent copy, not
// shared/imported across files).
//////////////////////////////////////////////////////////////

const resolveOwnerSalon = async (ownerId) => {
  const salon = await Salon.findOne({ ownerId, isDeleted: { $ne: true } }).select("_id").lean();
  if (!salon) throw Errors.notFound("Salon not found");
  return salon;
};

const todayIST = () => {
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const y = istNow.getFullYear();
  const m = String(istNow.getMonth() + 1).padStart(2, "0");
  const d = String(istNow.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const isValidCalendarDate = (dateStr) => {
  const [year, month, day] = dateStr.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth()    === month - 1 &&
    parsed.getUTCDate()     === day
  );
};

// Flattens { monday: { entries: [...] }, ... } into a single list of
// { day, professionalId, chairId, startTime, endTime } rows — used
// only to batch-validate references, never persisted in this shape.
const collectEntries = (days) => {
  const list = [];
  for (const day of WEEKDAYS) {
    const dayEntries = days?.[day]?.entries || [];
    for (const entry of dayEntries) list.push({ day, ...entry });
  }
  return list;
};

// Batched — exactly two queries (professionals, chairs) regardless of
// how many entries/weekdays are being validated, never one query per
// entry. Validates existence + salon ownership + active status, the
// same "eligible" bar professionalChairAssignment.service.js's own
// assertChairEligible/assertProfessionalEligible apply at concrete
// assignment creation time — reused as a rule, not imported as code
// (this file does not import from that frozen file).
const validateEntries = async (salonId, entries) => {
  if (!entries.length) return;

  const professionalIds = [...new Set(entries.map((e) => String(e.professionalId)))];
  const chairIds        = [...new Set(entries.map((e) => String(e.chairId)))];

  const [validStaff, validChairs] = await Promise.all([
    Staff.find({ _id: { $in: professionalIds }, salonId, isActive: true, isDeleted: false }).select("_id").lean(),
    Chair.find({ _id: { $in: chairIds }, salonId, isActive: true, isDeleted: false }).select("_id").lean(),
  ]);

  const validStaffIds = new Set(validStaff.map((s) => String(s._id)));
  const validChairIds = new Set(validChairs.map((c) => String(c._id)));

  for (const entry of entries) {
    if (!validStaffIds.has(String(entry.professionalId))) {
      throw Errors.badRequest(`${entry.day}: professional ${entry.professionalId} is not a valid, active professional for this salon`);
    }
    if (!validChairIds.has(String(entry.chairId))) {
      throw Errors.badRequest(`${entry.day}: chair ${entry.chairId} is not a valid, active chair for this salon`);
    }
  }
};

//////////////////////////////////////////////////////////////
// 🚀 1. CREATE — a new versioned template, effective from a given date
//////////////////////////////////////////////////////////////

export const createTemplate = async ({ ownerId, effectiveFrom, days }) => {
  const salon = await resolveOwnerSalon(ownerId);

  if (!isValidCalendarDate(effectiveFrom)) {
    throw Errors.badRequest(`${effectiveFrom} is not a valid calendar date`);
  }
  // Recommended default per the approved C4 audit: effectiveFrom may
  // be today or any future date; a version cannot be back-dated. No
  // existing convention in this codebase does anything different for
  // a "when does this take effect" date, so this is not a policy
  // conflict — it matches createAssignment's own "past dates cannot be
  // assigned" rule.
  if (effectiveFrom < todayIST()) {
    throw Errors.badRequest("effectiveFrom cannot be in the past — create a version effective today or later");
  }

  const entries = collectEntries(days || {});
  await validateEntries(salon._id, entries);

  // Service-level pre-check for a clean, attributable error in the
  // common case — the unique index below is the real, race-safe
  // guarantee (see the catch block).
  const existing = await WeeklyScheduleTemplate.findOne({ salonId: salon._id, effectiveFrom }).select("_id").lean();
  if (existing) {
    throw Errors.conflict(`A schedule version effective from ${effectiveFrom} already exists for this salon`);
  }

  try {
    const template = await WeeklyScheduleTemplate.create({
      salonId: salon._id,
      effectiveFrom,
      days: days || {},
      createdBy: ownerId,
      updatedBy: ownerId,
    });
    return template.toObject();
  } catch (err) {
    // Race-condition safety net — two concurrent creates for the same
    // salon+effectiveFrom can both pass the pre-check above; the
    // unique index guarantees only one succeeds, and this translates
    // the raw Mongo E11000 into the same clean, user-safe message
    // rather than leaking a database error.
    if (err?.code === 11000) {
      throw Errors.conflict(`A schedule version effective from ${effectiveFrom} already exists for this salon`);
    }
    throw err;
  }
};

//////////////////////////////////////////////////////////////
// 🚀 2. LIST — newest effectiveFrom first (most relevant to an owner
// reviewing current/upcoming versions).
//////////////////////////////////////////////////////////////

export const listTemplates = async ({ ownerId, status = TEMPLATE_STATUS.ACTIVE, page = 1, limit = 20 }) => {
  const salon = await resolveOwnerSalon(ownerId);

  const filter = { salonId: salon._id };
  if (status !== "ALL") filter.status = status;

  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    WeeklyScheduleTemplate.find(filter)
      .sort({ effectiveFrom: -1 })
      .skip(skip).limit(limit).lean(),
    WeeklyScheduleTemplate.countDocuments(filter),
  ]);

  return { items, pagination: { total, page, limit, pages: Math.ceil(total / limit) || 1 } };
};

//////////////////////////////////////////////////////////////
// 🚀 3. GET ONE
//////////////////////////////////////////////////////////////

export const getTemplateById = async ({ ownerId, templateId }) => {
  const salon = await resolveOwnerSalon(ownerId);

  const template = await WeeklyScheduleTemplate.findOne({ _id: templateId, salonId: salon._id }).lean();
  if (!template) throw Errors.notFound("Schedule version not found");
  return template;
};

//////////////////////////////////////////////////////////////
// 🚀 4. UPDATE — content only (one or more weekdays), and ONLY while
// the version has not yet become effective. See model NOTE 3.
//////////////////////////////////////////////////////////////

export const updateTemplate = async ({ ownerId, templateId, payload }) => {
  const salon = await resolveOwnerSalon(ownerId);

  const template = await WeeklyScheduleTemplate.findOne({ _id: templateId, salonId: salon._id });
  if (!template) throw Errors.notFound("Schedule version not found");

  if (template.status === TEMPLATE_STATUS.CANCELLED) {
    throw Errors.badRequest("Cannot update a cancelled schedule version — create a new one instead");
  }

  // Immutability once effective — the locked C4 rule. A version whose
  // effectiveFrom has already been reached (today or the past) is
  // treated as historical/current and must not be silently rewritten;
  // the owner must create a new future-effective version instead.
  if (template.effectiveFrom <= todayIST()) {
    throw Errors.badRequest("This schedule version is already effective and cannot be edited — create a new version with a future effectiveFrom instead");
  }

  const entries = collectEntries(payload.days || {});
  await validateEntries(salon._id, entries);

  for (const day of WEEKDAYS) {
    if (payload.days[day]) {
      template.days[day] = { entries: payload.days[day].entries || [] };
    }
  }

  template.updatedBy = ownerId;
  await template.save();
  return template.toObject();
};

//////////////////////////////////////////////////////////////
// 🚀 5. CANCEL (soft — status: CANCELLED, never deleted, idempotent)
//
// Same "not yet effective" guard as update — cancelling an
// already-effective version would change what pattern is understood
// to govern dates at/after its effectiveFrom, which is exactly the
// kind of silent historical rewrite the locked C4 rules forbid. If the
// owner wants different behavior from a given future date, the correct
// action is creating a new version effective from that date, not
// cancelling this one.
//////////////////////////////////////////////////////////////

export const cancelTemplate = async ({ ownerId, templateId }) => {
  const salon = await resolveOwnerSalon(ownerId);

  const template = await WeeklyScheduleTemplate.findOne({ _id: templateId, salonId: salon._id });
  if (!template) throw Errors.notFound("Schedule version not found");

  // Idempotent no-op — same pattern cancelAssignment/cancelBlock use.
  if (template.status === TEMPLATE_STATUS.CANCELLED) {
    return template.toObject();
  }

  if (template.effectiveFrom <= todayIST()) {
    throw Errors.badRequest("This schedule version is already effective and cannot be cancelled — create a new version to change future behavior instead");
  }

  template.status = TEMPLATE_STATUS.CANCELLED;
  template.updatedBy = ownerId;
  await template.save();
  return template.toObject();
};
