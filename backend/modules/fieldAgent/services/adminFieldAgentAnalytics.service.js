/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/adminFieldAgentAnalytics.service.js
 *
 * STEP 3.5A — Admin Field Agent Analytics API. Read-only, platform-wide
 * aggregates only — reuses every model exactly as it is (FieldAgent,
 * AcquisitionClaim, Salon, FieldAgentEarningLedger, SalonEarnings,
 * GenericPayoutRequest, FieldAgentPayoutRequest). No write to any of
 * them anywhere in this file. No schema change.
 *
 * "No ledger recalculation" (the ticket's own instruction): every
 * money figure below is a plain $sum of an already-stored field
 * (creditedAmountInPaise / availableBalanceInPaise / pendingBalanceInPaise
 * / amountInPaise) — nothing here re-derives what a booking's
 * commission *should* be, re-applies a commercial policy, or
 * recomputes a wallet balance from scratch. Amounts stay in paise end
 * to end.
 *
 * Directly implements the STEP 3.4 audit's own recommendations:
 *  - KPIs 1-3 (Total/Active/Inactive Agents) reuse FieldAgent.
 *    "Inactive" is FieldAgent.operationalStatus === PENDING_ACTIVATION
 *    (FieldAgent has no literal "INACTIVE" enum value — see that
 *    audit's own disclosed semantic gap; this is the same proxy the
 *    audit named, not a new interpretation).
 *  - KPI 4 (Total Acquired Salons) reuses the exact same
 *    AcquisitionClaim -> Salon resolution rule as STEP 2.2's
 *    adminFieldAgentSalons.service.js (a claim only counts if its
 *    salonRef still resolves to a real Salon document), counted
 *    platform-wide instead of per-agent.
 *  - KPI 5 (Lifetime Earnings) reuses STEP 2.1/2.3's own $sum over
 *    FieldAgentEarningLedger.creditedAmountInPaise, platform-wide.
 *  - KPIs 6-7 (Wallet Balance / Pending Balance) reuse
 *    adminFinance.controller.js's own $group/$sum idiom against
 *    SalonEarnings, re-scoped by entityType (ACQUISITION_AGENT /
 *    TERRITORY_PARTNER) instead of salonId — that existing endpoint
 *    is SALON-only and was never reusable as-is for field agents (see
 *    the audit).
 *  - KPI 8 (Total Paid Out) reuses STEP 2.4's own dual-collection
 *    merge (GenericPayoutRequest + FieldAgentPayoutRequest), summed
 *    platform-wide instead of per-agent.
 *  - Monthly Earnings Trend groups FieldAgentEarningLedger by
 *    bookingCompletedAt month, last 12 months only (bounded, sane
 *    graph range — the audit flagged no existing endpoint does this
 *    at all).
 *  - Top 10 Agents sorts FieldAgentEarningLedger's own per-agent $sum
 *    (grouped by fieldAgentRef) — deliberately NOT
 *    FieldAgentPerformanceSnapshot, per the audit's own explicit
 *    recommendation: the snapshot collection only covers 8 of 32 real
 *    agents (a performance-cycle-job coverage gap), while every real
 *    earning lives in FieldAgentEarningLedger regardless of whether
 *    that job has ever run for a given agent.
 */

import FieldAgent from "../models/FieldAgent.js";
import User from "../../../models/User.js";
import AcquisitionClaim from "../models/AcquisitionClaim.js";
import Salon from "../../../models/Salon.js";
import FieldAgentEarningLedger from "../models/FieldAgentEarningLedger.js";
import SalonEarnings from "../../../models/SalonEarnings.js";
import GenericPayoutRequest from "../../payout/models/GenericPayoutRequest.js";
import { GENERIC_PAYOUT_STATUS } from "../../payout/constants/genericPayoutRequest.constants.js";
import FieldAgentPayoutRequest, { FIELD_AGENT_PAYOUT_STATUS } from "../models/FieldAgentPayoutRequest.js";
import { FIELD_AGENT_OPERATIONAL_STATUS, COMMERCIAL_PATH } from "../constants/fieldAgent.constants.js";

const FIELD_AGENT_WALLET_ENTITY_TYPES = [COMMERCIAL_PATH.ACQUISITION_AGENT, COMMERCIAL_PATH.TERRITORY_PARTNER];
const TREND_MONTHS = 12;

const sumField = async (Model, filter, field) => {
  const [row] = await Model.aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: `$${field}` } } }]);
  return row?.total || 0;
};

// ── KPIs ──────────────────────────────────────────────────────────
const getKpis = async () => {
  const [
    totalFieldAgents,
    activeAgents,
    inactiveAgents,
    acquiredSalonRefs,
    lifetimeEarningsInPaise,
    walletAgg,
    genericPaidOut,
    fieldAgentPaidOut,
  ] = await Promise.all([
    FieldAgent.countDocuments({}),
    FieldAgent.countDocuments({ operationalStatus: FIELD_AGENT_OPERATIONAL_STATUS.ACTIVE }),
    FieldAgent.countDocuments({ operationalStatus: FIELD_AGENT_OPERATIONAL_STATUS.PENDING_ACTIVATION }),
    AcquisitionClaim.distinct("salonRef"),
    sumField(FieldAgentEarningLedger, {}, "creditedAmountInPaise"),
    SalonEarnings.aggregate([
      { $match: { entityType: { $in: FIELD_AGENT_WALLET_ENTITY_TYPES } } },
      { $group: { _id: null, totalAvailable: { $sum: "$availableBalanceInPaise" }, totalPending: { $sum: "$pendingBalanceInPaise" } } },
    ]),
    sumField(GenericPayoutRequest, { entityType: { $in: FIELD_AGENT_WALLET_ENTITY_TYPES }, status: GENERIC_PAYOUT_STATUS.PAID }, "amountInPaise"),
    sumField(FieldAgentPayoutRequest, { status: FIELD_AGENT_PAYOUT_STATUS.PAID }, "amountInPaise"),
  ]);

  // Same resolution rule as STEP 2.2 — a claim only counts as a real
  // acquired salon if its salonRef still resolves to an existing
  // Salon document (orphaned test-fixture claims do not count).
  const totalAcquiredSalons = acquiredSalonRefs.length
    ? await Salon.countDocuments({ _id: { $in: acquiredSalonRefs } })
    : 0;

  const wallet = walletAgg[0] || { totalAvailable: 0, totalPending: 0 };

  return {
    totalFieldAgents,
    activeAgents,
    inactiveAgents,
    totalAcquiredSalons,
    lifetimeEarningsInPaise,
    totalWalletBalanceInPaise: wallet.totalAvailable || 0,
    pendingWalletBalanceInPaise: wallet.totalPending || 0,
    totalPaidOutInPaise: genericPaidOut + fieldAgentPaidOut,
  };
};

// ── Monthly Earnings Trend — last 12 months, chronological ────────
const getMonthlyEarningsTrend = async () => {
  const since = new Date();
  since.setMonth(since.getMonth() - (TREND_MONTHS - 1));
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const rows = await FieldAgentEarningLedger.aggregate([
    { $match: { bookingCompletedAt: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m", date: "$bookingCompletedAt" } },
        totalEarnedInPaise: { $sum: "$creditedAmountInPaise" },
        bookingCount: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return rows.map((r) => ({
    month: r._id,
    totalEarnedInPaise: r.totalEarnedInPaise,
    bookingCount: r.bookingCount,
  }));
};

// ── Top 10 Agents — by lifetime credited earnings ──────────────────
const getTop10Agents = async () => {
  const rows = await FieldAgentEarningLedger.aggregate([
    { $group: { _id: "$fieldAgentRef", totalEarnedInPaise: { $sum: "$creditedAmountInPaise" }, bookingCount: { $sum: 1 } } },
    { $sort: { totalEarnedInPaise: -1 } },
    { $limit: 10 },
  ]);
  if (!rows.length) return [];

  const agentIds = rows.map((r) => r._id);
  const agents = await FieldAgent.find({ _id: { $in: agentIds } })
    .select("agentCode userRef commercialPath")
    .lean();
  const agentById = new Map(agents.map((a) => [String(a._id), a]));

  const users = await User.find({ _id: { $in: agents.map((a) => a.userRef) } })
    .select("name phone")
    .lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  return rows.map((r) => {
    const agent = agentById.get(String(r._id));
    const user = agent ? userById.get(String(agent.userRef)) : null;
    return {
      fieldAgentId: r._id,
      agentCode: agent?.agentCode ?? null,
      name: user?.name ?? null,
      phone: user?.phone ?? null,
      commercialType: agent?.commercialPath ?? null,
      totalEarnedInPaise: r.totalEarnedInPaise,
      bookingCount: r.bookingCount,
    };
  });
};

export const getAdminFieldAgentAnalytics = async () => {
  const [kpis, monthlyEarningsTrend, topAgents] = await Promise.all([
    getKpis(),
    getMonthlyEarningsTrend(),
    getTop10Agents(),
  ]);

  return { kpis, monthlyEarningsTrend, topAgents };
};
