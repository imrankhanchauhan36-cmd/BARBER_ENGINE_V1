/**
 * BARBER ENGINE V1
 * backend/modules/wallet/services/walletIdentityResolver.service.js
 *
 * STEP 6.5A — HTTP API Exposure. Resolves an authenticated req.user
 * (role OWNER or FIELD_AGENT) into the {entityType, entityId} identity
 * WalletBalanceService/GenericPayoutRequestService already use — the
 * REVERSE direction of modules/payout/services/payoutKycResolver.
 * service.js's own resolveKycOwner (entity -> User), which is why this
 * is a separate, new, additive file rather than a modification to that
 * one. Read-only against Salon and FieldAgent — no writes, no business
 * logic, purely an identity lookup this HTTP layer needs and nothing
 * else in the codebase provided yet.
 */

import Salon from "../../../models/Salon.js";
import FieldAgent from "../../fieldAgent/models/FieldAgent.js";
import { PAYOUT_ENTITY_TYPE } from "../../payout/constants/genericPayoutRequest.constants.js";
import { COMMERCIAL_PATH } from "../../fieldAgent/constants/fieldAgent.constants.js";

/**
 * @param {{_id, role: string}} user - req.user
 * @returns {Promise<{entityType: string, entityId: import("mongoose").Types.ObjectId}|null>}
 *   null when this user has no wallet-bearing identity (no Salon, no
 *   FieldAgent, or a FieldAgent whose commercialPath isn't one of the
 *   two wallet-bearing kinds) — the caller decides how to respond.
 */
export const resolveWalletIdentityForUser = async (user) => {
  if (!user) return null;

  if (user.role === "OWNER") {
    const salon = await Salon.findOne({ ownerId: user._id, isDeleted: { $ne: true } }).select("_id").lean();
    if (!salon) return null;
    return { entityType: PAYOUT_ENTITY_TYPE.SALON, entityId: salon._id };
  }

  if (user.role === "FIELD_AGENT") {
    const fieldAgent = await FieldAgent.findOne({ userRef: user._id }).select("_id commercialPath").lean();
    if (!fieldAgent || !fieldAgent.commercialPath) return null;
    if (![COMMERCIAL_PATH.ACQUISITION_AGENT, COMMERCIAL_PATH.TERRITORY_PARTNER].includes(fieldAgent.commercialPath)) return null;
    return { entityType: fieldAgent.commercialPath, entityId: fieldAgent._id };
  }

  return null;
};
