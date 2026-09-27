/**
 * BARBER ENGINE V1
 * backend/modules/finance/services/FinanceDashboardKPIService.js
 *
 * STEP 7.1 — Finance Dashboard KPI Engine. READ-ONLY, aggregation only.
 * This file never writes anything, anywhere — every export is a plain
 * `.aggregate()`/`.countDocuments()` read. No Wallet write, no Booking
 * write, no Refund write, no Razorpay call, no GST write — confirmed by
 * this file's own import list: every model here is read via its
 * default export's query methods only, never `.create()`/`.save()`/
 * `.updateOne()`/`.findOneAndUpdate()`.
 *
 * "Do NOT calculate Zemish Holding from RevenueSplit" (explicit
 * correction) — RevenueSplit is not imported anywhere in this file.
 * "Merchant Amount Received" instead comes from models/Transaction.js
 * — the actual Razorpay-captured-payment record (Transaction.amount,
 * Transaction.status), completely independent of RevenueSplit's own
 * per-booking commercial breakdown.
 *
 * HOLDING FORMULA (as corrected):
 *   Holding = Merchant Amount Received
 *           − Salon Paid
 *           − Acquisition Paid
 *           − Territory Paid
 *           − Source Refunds
 *           − GST Already Paid
 *
 * Where:
 *   Merchant Amount Received = SUM(Transaction.amount) for every
 *     transaction that was actually captured by the gateway
 *     (status PAID or REFUNDED — FAILED/PENDING never received money).
 *     Refunds are handled as their own separate subtraction term below,
 *     so this term is deliberately the GROSS captured amount, never
 *     netted against refunds itself.
 *   Salon Paid / Acquisition Paid / Territory Paid = SUM of amountInPaise
 *     across every payout-request row with status PAID, for that
 *     entity kind. THREE payout-request collections coexist in this
 *     codebase today (models/PayoutRequest.js — SALON only;
 *     FieldAgentPayoutRequest — ACQUISITION_AGENT + TERRITORY_PARTNER,
 *     undifferentiated at the schema level, joined against
 *     FieldAgent.commercialPath to split them; GenericPayoutRequest —
 *     all three, entityType-tagged directly) — every PAID row across
 *     ALL of them counts toward "already paid out", regardless of
 *     which system processed it.
 *   Source Refunds = SUM(Transaction.refundAmount) — this field is
 *     already the maintained, running total of accepted (PENDING +
 *     PROCESSED) refunds per transaction, kept up to date by the
 *     existing, UNTOUCHED RazorpayRefundService.js#applyRefundEffects.
 *     Reusing it here avoids a second, independent refund aggregation
 *     that could drift from the one the refund engine itself maintains.
 *   GST Already Paid = the net GST liability (SALE − REFUND_REVERSAL,
 *     all-time, from GSTLedger) — see getGstLiabilityInPaise's own
 *     header for why this is the same figure as the "GST Liability"
 *     KPI card: this codebase has no separate government-remittance-
 *     tracking model, so GST collected (net of reversals) is treated
 *     as earmarked/reserved for the government and excluded from
 *     Zemish's own holding, whether or not the literal bank remittance
 *     has executed yet. Documented assumption, confirmed in the STEP
 *     7.1 audit — not silently inferred here.
 */

import SalonEarnings from "../../../models/SalonEarnings.js";
import Transaction from "../../../models/Transaction.js";
import Refund from "../../../models/Refund.js";
import GSTLedger from "../models/GSTLedger.js";
import PayoutRequest from "../../../models/PayoutRequest.js";
import FieldAgentPayoutRequest from "../../fieldAgent/models/FieldAgentPayoutRequest.js";
import GenericPayoutRequest from "../../payout/models/GenericPayoutRequest.js";
import { GST_LEDGER_TYPE } from "../constants/gstLedger.constants.js";
import { PAYOUT_ENTITY_TYPE } from "../../payout/constants/genericPayoutRequest.constants.js";
import { COMMERCIAL_PATH } from "../../fieldAgent/constants/fieldAgent.constants.js";

// ── Small aggregation helpers (all read-only) ──────────────────────
const sumField = async (Model, match, field) => {
  const rows = await Model.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: `$${field}` } } }]);
  return rows[0]?.total || 0;
};

// ═══════════════════════════════════════════════════════════════════
// KPI 2 — SALON LIABILITY: every wallet bucket Zemish currently owes
// to salons (not yet withdrawn). Reads SalonEarnings only.
// ═══════════════════════════════════════════════════════════════════
export const getSalonLiabilityInPaise = async () => {
  const rows = await SalonEarnings.aggregate([
    { $match: { entityType: "SALON" } },
    { $group: {
        _id: null,
        availableInPaise: { $sum: "$availableBalanceInPaise" },
        pendingInPaise: { $sum: "$pendingBalanceInPaise" },
        lockedInPaise: { $sum: "$lockedBalanceInPaise" },
        processingInPaise: { $sum: "$processingBalanceInPaise" },
    } },
  ]);
  const r = rows[0] || { availableInPaise: 0, pendingInPaise: 0, lockedInPaise: 0, processingInPaise: 0 };
  return { ...r, totalInPaise: r.availableInPaise + r.pendingInPaise + r.lockedInPaise + r.processingInPaise };
};

// ═══════════════════════════════════════════════════════════════════
// KPI 3 — AGENT LIABILITY: every wallet bucket Zemish currently owes
// to Field Agents (ACQUISITION_AGENT + TERRITORY_PARTNER — STEP 6.2's
// new, specific types — plus the legacy generic FIELD_AGENT type still
// used by fieldAgentWalletBridge.service.js's own pre-existing
// mirrored credits, so no agent's liability is silently undercounted
// merely because their earnings were bridged before the STEP 6.2
// entity-type split existed). Reads SalonEarnings only.
// ═══════════════════════════════════════════════════════════════════
export const getAgentLiabilityInPaise = async () => {
  const rows = await SalonEarnings.aggregate([
    { $match: { entityType: { $in: ["ACQUISITION_AGENT", "TERRITORY_PARTNER", "FIELD_AGENT"] } } },
    { $group: {
        _id: null,
        availableInPaise: { $sum: "$availableBalanceInPaise" },
        pendingInPaise: { $sum: "$pendingBalanceInPaise" },
        lockedInPaise: { $sum: "$lockedBalanceInPaise" },
        processingInPaise: { $sum: "$processingBalanceInPaise" },
    } },
  ]);
  const r = rows[0] || { availableInPaise: 0, pendingInPaise: 0, lockedInPaise: 0, processingInPaise: 0 };
  return { ...r, totalInPaise: r.availableInPaise + r.pendingInPaise + r.lockedInPaise + r.processingInPaise };
};

// ═══════════════════════════════════════════════════════════════════
// KPI 4 — GST LIABILITY: net, all-time (SALE − REFUND_REVERSAL), from
// GSTLedger only. Deliberately NOT reusing GSTReportService.js (which
// is period-scoped: current month/quarter/year) — this is a fresh,
// independent, unbounded read against the same collection, per the
// STEP 7.1 audit's own finding that no all-time variant existed yet.
// "No GST changes" is honored literally: GSTReportService.js,
// GSTLedgerService.js and GSTLedger.js are not imported for writing
// and are not modified anywhere in this step.
// ═══════════════════════════════════════════════════════════════════
export const getGstLiabilityInPaise = async () => {
  const rows = await GSTLedger.aggregate([
    { $group: { _id: "$ledgerType", total: { $sum: "$gstAmountInPaise" } } },
  ]);
  const collected = rows.find((r) => r._id === GST_LEDGER_TYPE.SALE)?.total || 0;
  const reversed = rows.find((r) => r._id === GST_LEDGER_TYPE.REFUND_REVERSAL)?.total || 0;
  return { collectedInPaise: collected, reversedInPaise: reversed, netInPaise: collected - reversed };
};

// ═══════════════════════════════════════════════════════════════════
// KPI 5 — PROCESSING PAYOUTS: money currently in flight to a bank
// account (moved out of LOCKED, not yet confirmed PAID or FAILED),
// across every entity type. Reads SalonEarnings.processingBalanceInPaise
// directly — the single, always-consistent-by-construction source
// (WalletBalanceService is the sole writer of this bucket regardless
// of which of the three payout-request models triggered the move),
// rather than trying to reconcile three separate payout-request
// collections against each other.
// ═══════════════════════════════════════════════════════════════════
export const getProcessingPayoutsInPaise = () => sumField(SalonEarnings, {}, "processingBalanceInPaise");

// ═══════════════════════════════════════════════════════════════════
// KPI 6 — REFUND EXPOSURE: total money already returned or in the
// gateway refund pipeline (PENDING + PROCESSED — CREATING is excluded
// as a transient, not-yet-gateway-confirmed state). Reads Refund only.
// ═══════════════════════════════════════════════════════════════════
export const getRefundExposureInPaise = async () => {
  const rows = await Refund.aggregate([
    { $match: { refundStatus: { $in: ["PENDING", "PROCESSED"] } } },
    { $group: { _id: null, total: { $sum: "$amountInPaise" }, count: { $sum: 1 } } },
  ]);
  return { totalInPaise: rows[0]?.total || 0, count: rows[0]?.count || 0 };
};

// ═══════════════════════════════════════════════════════════════════
// KPI 1 — ZEMISH HOLDING (corrected formula — see file header).
// Never reads RevenueSplit. Combines five independent, read-only
// aggregations arithmetically.
// ═══════════════════════════════════════════════════════════════════

/** SUM(Transaction.amount) for every gateway-captured payment (PAID or REFUNDED status). */
const getMerchantAmountReceivedInPaise = () =>
  sumField(Transaction, { status: { $in: ["PAID", "REFUNDED"] } }, "amount");

/** SUM(Transaction.refundAmount) — the refund engine's own maintained running total. */
const getSourceRefundsInPaise = () => sumField(Transaction, {}, "refundAmount");

/** SUM(amountInPaise) of every PAID row across all three payout-request collections, split by entity kind. */
const getPaidOutTotalsInPaise = async () => {
  const salonFromLegacy = await sumField(PayoutRequest, { status: "PAID" }, "amountInPaise");
  const salonFromGeneric = await sumField(GenericPayoutRequest, { status: "PAID", entityType: PAYOUT_ENTITY_TYPE.SALON }, "amountInPaise");

  // FieldAgentPayoutRequest has no entityType/commercialPath of its own
  // — join to FieldAgent (read-only $lookup) to split ACQUISITION_AGENT
  // vs TERRITORY_PARTNER, exactly as the STEP 7.1 audit flagged.
  const legacyFieldAgentRows = await FieldAgentPayoutRequest.aggregate([
    { $match: { status: "PAID" } },
    { $lookup: { from: "fieldagents", localField: "fieldAgentRef", foreignField: "_id", as: "agent" } },
    { $unwind: "$agent" },
    { $group: { _id: "$agent.commercialPath", total: { $sum: "$amountInPaise" } } },
  ]);
  const acquisitionFromLegacy = legacyFieldAgentRows.find((r) => r._id === COMMERCIAL_PATH.ACQUISITION_AGENT)?.total || 0;
  const territoryFromLegacy = legacyFieldAgentRows.find((r) => r._id === COMMERCIAL_PATH.TERRITORY_PARTNER)?.total || 0;

  const acquisitionFromGeneric = await sumField(GenericPayoutRequest, { status: "PAID", entityType: PAYOUT_ENTITY_TYPE.ACQUISITION_AGENT }, "amountInPaise");
  const territoryFromGeneric = await sumField(GenericPayoutRequest, { status: "PAID", entityType: PAYOUT_ENTITY_TYPE.TERRITORY_PARTNER }, "amountInPaise");

  return {
    salonPaidInPaise: salonFromLegacy + salonFromGeneric,
    acquisitionPaidInPaise: acquisitionFromLegacy + acquisitionFromGeneric,
    territoryPaidInPaise: territoryFromLegacy + territoryFromGeneric,
  };
};

export const getZemishHoldingInPaise = async () => {
  const [merchantAmountReceivedInPaise, sourceRefundsInPaise, paidOut, gst] = await Promise.all([
    getMerchantAmountReceivedInPaise(),
    getSourceRefundsInPaise(),
    getPaidOutTotalsInPaise(),
    getGstLiabilityInPaise(),
  ]);

  const holdingInPaise =
    merchantAmountReceivedInPaise
    - paidOut.salonPaidInPaise
    - paidOut.acquisitionPaidInPaise
    - paidOut.territoryPaidInPaise
    - sourceRefundsInPaise
    - gst.netInPaise;

  return {
    merchantAmountReceivedInPaise,
    salonPaidInPaise: paidOut.salonPaidInPaise,
    acquisitionPaidInPaise: paidOut.acquisitionPaidInPaise,
    territoryPaidInPaise: paidOut.territoryPaidInPaise,
    sourceRefundsInPaise,
    gstAlreadyPaidInPaise: gst.netInPaise,
    holdingInPaise,
  };
};

// ═══════════════════════════════════════════════════════════════════
// ALL SIX KPI CARDS — one call for the dashboard's own top row.
// ═══════════════════════════════════════════════════════════════════
export const getFinanceDashboardKPIs = async () => {
  const [holding, salonLiability, agentLiability, gstLiability, processingPayouts, refundExposure] = await Promise.all([
    getZemishHoldingInPaise(),
    getSalonLiabilityInPaise(),
    getAgentLiabilityInPaise(),
    getGstLiabilityInPaise(),
    getProcessingPayoutsInPaise(),
    getRefundExposureInPaise(),
  ]);

  return {
    zemishHolding: holding,
    salonLiability,
    agentLiability,
    gstLiability,
    processingPayoutsInPaise: processingPayouts,
    refundExposure,
    generatedAt: new Date(),
  };
};
