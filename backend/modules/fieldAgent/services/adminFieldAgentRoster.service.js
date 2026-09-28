/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/adminFieldAgentRoster.service.js
 *
 * STEP 3.1 (backend addendum, user-approved exception — see the
 * validator's own header for the full rationale). Read-only list of
 * FieldAgent documents, exposing each row's own _id so the admin
 * panel's roster table can link into the already-built STEP 2.x
 * per-agent detail endpoints (summary/salons/earnings/wallet/
 * payouts). No wallet/salon/earnings aggregation is duplicated here —
 * deliberately minimal (identity + status + commercialType +
 * pagination/search/filter only); the admin panel enriches each
 * page's rows via STEP 2.1's existing GET /:id/summary, reusing that
 * logic rather than re-implementing it a second time in a list
 * context.
 *
 * Search mirrors fieldAgentReview.service.js's own established
 * idiom exactly: a bounded ($limit 500), escaped-regex sub-lookup
 * against User (name/phone) first, never an unbounded regex against
 * FieldAgent itself.
 */

import FieldAgent from "../models/FieldAgent.js";
import User from "../../../models/User.js";

const MAX_SEARCH_LENGTH = 100;

const clampLimit = (limit) => {
  const n = Number(limit) || 20;
  return Math.min(Math.max(n, 1), 100);
};
const clampPage = (page) => Math.max(1, Number(page) || 1);

export const listAdminFieldAgentRoster = async ({ page, limit, search, status, commercialType }) => {
  const safeLimit = clampLimit(limit);
  const safePage = clampPage(page);

  const filter = {};
  if (status) filter.operationalStatus = status;
  if (commercialType) filter.commercialPath = commercialType;

  if (search) {
    const trimmed = String(search).trim().slice(0, MAX_SEARCH_LENGTH);
    if (trimmed) {
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matchedUsers = await User.find({
        role: "FIELD_AGENT",
        $or: [{ name: { $regex: escaped, $options: "i" } }, { phone: { $regex: escaped, $options: "i" } }],
      })
        .select("_id")
        .limit(500)
        .lean();
      filter.userRef = { $in: matchedUsers.map((u) => u._id) };
    }
  }

  const [agents, total] = await Promise.all([
    FieldAgent.find(filter)
      .select("agentCode userRef commercialPath operationalStatus createdAt")
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    FieldAgent.countDocuments(filter),
  ]);

  const users = await User.find({ _id: { $in: agents.map((a) => a.userRef) } })
    .select("name phone")
    .lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  const items = agents.map((a) => {
    const user = userById.get(String(a.userRef));
    return {
      id: a._id,
      agentCode: a.agentCode,
      name: user?.name ?? null,
      phone: user?.phone ?? null,
      commercialType: a.commercialPath,
      status: a.operationalStatus,
      createdAt: a.createdAt,
    };
  });

  return {
    items,
    pagination: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) || 1 },
  };
};
