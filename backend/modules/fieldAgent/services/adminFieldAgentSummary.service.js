/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/adminFieldAgentSummary.service.js
 *
 * STEP 2.1 — Admin Field Agent Summary API. Read-only aggregation
 * only — every model/service it reads is unmodified (see the STEP
 * 1.3 audit this implements): FieldAgent, User, KYC,
 * TerritoryAssignment, CommercialTerritory, AcquisitionClaim, Salon,
 * FieldAgentEarningLedger, WalletBalanceService, GenericPayoutRequest,
 * FieldAgentPayoutRequest. No write to any of them anywhere in this
 * file. All amounts stay in paise end to end — never converted to
 * rupees here.
 *
 * PAYOUT MERGE (per the STEP 1.3 audit's own explicit recommendation):
 * "Pending Withdraw"/"Total Withdrawn" are summed across BOTH
 * GenericPayoutRequest (entityType/entityId, the newer unified system)
 * AND FieldAgentPayoutRequest (fieldAgentRef, the older FA-14 system)
 * — both are live and independently reachable by the same Field
 * Agent today, so reading only one would silently under-report real
 * money in flight or already paid.
 *
 * "Active Salons" — an AcquisitionClaim is only genuinely active while
 * status is ACTIVE_RECOVERY (the current non-terminal "agent is
 * recognized/earning for this salon" state — PENDING_APPROVAL is not
 * yet active, COMPLETED/ENDED are terminal; see
 * acquisitionClaim.constants.js's own header for the full lifecycle),
 * further narrowed to salons still APPROVED and not deleted.
 */

import FieldAgent from "../models/FieldAgent.js";
import User from "../../../models/User.js";
import KYC from "../../kyc/models/KYC.js";
import { APPLICANT_TYPE } from "../../kyc/constants/kyc.constants.js";
import TerritoryAssignment from "../models/TerritoryAssignment.js";
import CommercialTerritory from "../models/CommercialTerritory.js";
import { ASSIGNMENT_STATUS } from "../constants/commercialTerritory.constants.js";
import AcquisitionClaim from "../models/AcquisitionClaim.js";
import { CLAIM_STATUS } from "../constants/acquisitionClaim.constants.js";
import Salon from "../../../models/Salon.js";
import FieldAgentEarningLedger from "../models/FieldAgentEarningLedger.js";
import WalletBalanceService from "../../../services/WalletBalanceService.js";
import GenericPayoutRequest from "../../payout/models/GenericPayoutRequest.js";
import { GENERIC_PAYOUT_STATUS } from "../../payout/constants/genericPayoutRequest.constants.js";
import FieldAgentPayoutRequest from "../models/FieldAgentPayoutRequest.js";
import { COMMERCIAL_PATH } from "../constants/fieldAgent.constants.js";
import { Errors } from "../../../utils/response.js";

// Both payout systems share the identical status vocabulary (REQUESTED/
// PROCESSING/PAID/FAILED/REJECTED/CANCELLED — confirmed against each
// model's own enum before writing this file), so GENERIC_PAYOUT_STATUS
// and FIELD_AGENT_PAYOUT_STATUS's own REQUESTED/PROCESSING/PAID values
// are interchangeable here; GENERIC_PAYOUT_STATUS's is used as the one
// canonical source for both queries below rather than duplicating a
// second, redundant open/paid split per system.
const OPEN_PAYOUT_STATUSES = [GENERIC_PAYOUT_STATUS.REQUESTED, GENERIC_PAYOUT_STATUS.PROCESSING];
const PAID_STATUS = GENERIC_PAYOUT_STATUS.PAID;

const sumAmount = async (Model, filter) => {
  const [row] = await Model.aggregate([
    { $match: filter },
    { $group: { _id: null, total: { $sum: "$amountInPaise" } } },
  ]);
  return row?.total || 0;
};

export const getAdminFieldAgentSummary = async ({ fieldAgentId }) => {
  const fieldAgent = await FieldAgent.findById(fieldAgentId).lean();
  if (!fieldAgent) throw Errors.notFound("Field Agent not found");

  const [user, kyc, activeTerritoryAssignment, totalSalons, lifetimeEarningsRow] = await Promise.all([
    User.findById(fieldAgent.userRef).select("name phone email").lean(),
    KYC.findOne({ ownerId: fieldAgent.userRef, applicantType: APPLICANT_TYPE.FIELD_AGENT }).select("status").lean(),
    fieldAgent.commercialPath === COMMERCIAL_PATH.TERRITORY_PARTNER
      ? TerritoryAssignment.findOne({ fieldAgentRef: fieldAgent._id, status: ASSIGNMENT_STATUS.ACTIVE }).lean()
      : Promise.resolve(null),
    AcquisitionClaim.countDocuments({ fieldAgentRef: fieldAgent._id }),
    FieldAgentEarningLedger.aggregate([
      { $match: { fieldAgentRef: fieldAgent._id } },
      { $group: { _id: null, total: { $sum: "$creditedAmountInPaise" } } },
    ]),
  ]);

  // ── Territory (Territory Partners only) ──────────────────────────
  const territory = activeTerritoryAssignment
    ? await CommercialTerritory.findById(activeTerritoryAssignment.territoryRef).select("name").lean()
    : null;

  // ── Active Salons — ACTIVE_RECOVERY claims whose Salon is still
  // APPROVED and not deleted (see file header). ─────────────────────
  const activeClaims = await AcquisitionClaim.find({
    fieldAgentRef: fieldAgent._id,
    status: CLAIM_STATUS.ACTIVE_RECOVERY,
  }).select("salonRef").lean();
  const activeSalons = activeClaims.length
    ? await Salon.countDocuments({
        _id: { $in: activeClaims.map((c) => c.salonRef) },
        "approval.status": "APPROVED",
        isDeleted: { $ne: true },
      })
    : 0;

  // ── Wallet — only meaningful once a commercialPath has been
  // selected (COMMERCIAL_PATH values are identical strings to
  // PAYOUT_ENTITY_TYPE.ACQUISITION_AGENT/TERRITORY_PARTNER, confirmed
  // before writing this file — no translation needed). ─────────────
  const wallet = fieldAgent.commercialPath
    ? await WalletBalanceService.getWallet({
        entityType: fieldAgent.commercialPath,
        entityId: fieldAgent._id,
      })
    : null;

  // ── Payout totals — merged across both live systems (see file
  // header for why both are queried). ───────────────────────────────
  const genericFilterBase = fieldAgent.commercialPath
    ? { entityType: fieldAgent.commercialPath, entityId: fieldAgent._id }
    : null; // no commercialPath selected yet -> no GenericPayoutRequest could possibly exist for this agent

  const [
    genericPending,
    genericPaid,
    fieldAgentPending,
    fieldAgentPaid,
  ] = await Promise.all([
    genericFilterBase
      ? sumAmount(GenericPayoutRequest, { ...genericFilterBase, status: { $in: OPEN_PAYOUT_STATUSES } })
      : Promise.resolve(0),
    genericFilterBase
      ? sumAmount(GenericPayoutRequest, { ...genericFilterBase, status: PAID_STATUS })
      : Promise.resolve(0),
    sumAmount(FieldAgentPayoutRequest, { fieldAgentRef: fieldAgent._id, status: { $in: OPEN_PAYOUT_STATUSES } }),
    sumAmount(FieldAgentPayoutRequest, { fieldAgentRef: fieldAgent._id, status: PAID_STATUS }),
  ]);

  return {
    agent: {
      id: fieldAgent._id,
      agentCode: fieldAgent.agentCode,
      name: user?.name ?? null,
      phone: user?.phone ?? null,
      email: user?.email ?? null,
      commercialType: fieldAgent.commercialPath,
      operationalStatus: fieldAgent.operationalStatus,
      joinDate: fieldAgent.approvedAt ?? fieldAgent.createdAt,
    },
    territory: territory ? { id: territory._id, name: territory.name } : null,
    kycStatus: kyc?.status ?? null,
    totalSalons,
    activeSalons,
    walletBalance: wallet
      ? {
          availableBalanceInPaise: wallet.availableBalanceInPaise ?? 0,
          pendingBalanceInPaise: wallet.pendingBalanceInPaise ?? 0,
          lockedBalanceInPaise: wallet.lockedBalanceInPaise ?? 0,
          processingBalanceInPaise: wallet.processingBalanceInPaise ?? 0,
        }
      : null,
    lifetimeEarningsInPaise: lifetimeEarningsRow?.[0]?.total || 0,
    pendingWithdrawInPaise: genericPending + fieldAgentPending,
    totalWithdrawnInPaise: genericPaid + fieldAgentPaid,
  };
};
