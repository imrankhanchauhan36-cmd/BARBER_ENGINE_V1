/**
 * BARBER ENGINE V1
 * backend/utils/pagination.js — v2 FINAL
 */

import mongoose from "mongoose";

const DEFAULT_PAGE  = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT     = 100;

// ─── buildPagination ──────────────────────────────────────────────

export const buildPagination = (query = {}) => {
  const page  = Math.max(1, parseInt(query.page)  || DEFAULT_PAGE);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit) || DEFAULT_LIMIT));
  const skip  = (page - 1) * limit;
  return { page, limit, skip };
};

// ─── paginationMeta ───────────────────────────────────────────────

export const paginationMeta = (page, limit, total) => ({
  page,
  limit,
  total,
  totalPages: total === 0 ? 0 : Math.ceil(total / limit), // ✅ FIX #2
});

// ─── buildScopeFilter ─────────────────────────────────────────────

export const buildScopeFilter = (user = {}) => {
  if (!user || !user.adminLevel) return {};

  const level = String(user.adminLevel).toUpperCase();

  if (level === "INDIA") return {};

  if (level === "STATE") {
    // ✅ FIX #1 — validate before ObjectId cast
    if (!mongoose.isValidObjectId(user.stateRef)) return {};
    return { stateRef: new mongoose.Types.ObjectId(user.stateRef) };
  }

  if (level === "DISTRICT") {
    const filter = {};
    if (mongoose.isValidObjectId(user.stateRef))
      filter.stateRef    = new mongoose.Types.ObjectId(user.stateRef);
    if (mongoose.isValidObjectId(user.districtRef))
      filter.districtRef = new mongoose.Types.ObjectId(user.districtRef);
    return filter;
  }

  return {};
};

// ─── buildSearch ──────────────────────────────────────────────────

export const buildSearch = (term = "", fields = []) => {
  if (!term || !term.trim() || fields.length === 0) return {};

  const regex = new RegExp(
    term.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "i"
  );

  return { $or: fields.map((field) => ({ [field]: { $regex: regex } })) };
};

// ─── buildSort ────────────────────────────────────────────────────

export const buildSort = (query = {}, allowedFields = []) => {
  const DEFAULT_SORT = { createdAt: -1 };
  const { sortBy, sortOrder } = query;

  if (!sortBy) return DEFAULT_SORT;
  if (allowedFields.length && !allowedFields.includes(sortBy)) return DEFAULT_SORT;

  return { [sortBy]: String(sortOrder).toLowerCase() === "asc" ? 1 : -1 };
};

// ─── buildDateFilter ──────────────────────────────────────────────

export const buildDateFilter = (query = {}, field = "createdAt") => {
  const { from, to } = query;
  if (!from && !to) return {};

  const dateFilter = {};

  if (from) {
    const fromDate = new Date(from);
    if (!isNaN(fromDate)) dateFilter.$gte = fromDate;
  }

  if (to) {
    const toDate = new Date(to);
    if (!isNaN(toDate)) {
      toDate.setHours(23, 59, 59, 999);
      dateFilter.$lte = toDate;
    }
  }

  return Object.keys(dateFilter).length ? { [field]: dateFilter } : {};
};

// ─── buildStatusFilter ────────────────────────────────────────────

export const buildStatusFilter = (query = {}, field = "status", allowed = []) => {
  const val = query[field] || query.status;
  if (!val) return {};
  if (allowed.length && !allowed.includes(val)) return {};
  return { [field]: val };
};

// ─── paginatedQuery ───────────────────────────────────────────────

export const paginatedQuery = async (
  Model,
  filter = {},
  pagination = {},
  opts = {}
) => {
  const { page, limit, skip } = pagination;
  const {
    sort     = { createdAt: -1 },
    select   = "",
    populate = [],
    lean     = true,           // ✅ FIX #3 — configurable
  } = opts;

  let query = Model.find(filter)
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .select(select)
    .populate(populate);

  if (lean) query = query.lean();

  const [total, docs] = await Promise.all([
    Model.countDocuments(filter),
    query,
  ]);

  return {
    docs,
    meta: paginationMeta(page, limit, total),
  };
};