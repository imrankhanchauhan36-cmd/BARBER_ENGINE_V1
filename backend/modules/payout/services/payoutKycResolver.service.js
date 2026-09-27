/**
 * BARBER ENGINE V1
 * backend/modules/payout/services/payoutKycResolver.service.js
 *
 * STEP 6.3 — Generic PayoutRequest Engine. The "Universal KYC resolver"
 * the ticket asks for: ONE function that, given a wallet's own
 * {entityType, entityId} (the SAME identity STEP 6.2's Unified Wallet
 * Engine already uses), resolves the correct KYC record and returns an
 * immutable bank snapshot — or throws if not verified/incomplete.
 *
 * WHY THIS IS NEEDED (read-only audit finding, STEP 6.3's own audit):
 * KYC.ownerId is keyed to a User, never to a Salon or a FieldAgent
 * document directly — so a wallet's entityId is NOT the same ID space
 * as KYC.ownerId for either entity kind:
 *   - SALON:               entityId = Salon._id  → Salon.ownerId (User)
 *   - ACQUISITION_AGENT /
 *     TERRITORY_PARTNER:   entityId = FieldAgent._id → FieldAgent.userRef (User)
 * Two existing call sites (controllers/payout.controller.js for SALON,
 * modules/fieldAgent/services/fieldAgentPayout.service.js for
 * FIELD_AGENT) each hand-roll this resolution independently — this
 * file is the first SHARED resolver, used by all three entity types
 * this engine supports, so they can never diverge from each other.
 *
 * "VERIFIED" RECONCILIATION (read-only audit finding): the two existing
 * call sites also check two DIFFERENT fields for "is the bank verified":
 *   - SALON path checks   KYC.verification.bank.verified === true
 *   - FIELD_AGENT path checks KYC.bank.pennyDropStatus === "SUCCESS"
 * This resolver treats EITHER signal as sufficient (verified = either
 * flag is true) — deliberately inclusive, not a silent pick of one over
 * the other, since either one represents a real, already-established
 * verification event for that record. This is a documented reconciliation
 * decision, not an accident: STEP 6.3 does not change what either
 * existing flow itself checks (controllers/payout.controller.js and
 * fieldAgentPayout.service.js are both untouched by this step), it only
 * defines what THIS NEW engine accepts.
 *
 * READ-ONLY against Salon, FieldAgent, and KYC — never writes to any of
 * them. modules/kyc/ itself is completely untouched by this step.
 */

import Salon from "../../../models/Salon.js";
import FieldAgent from "../../fieldAgent/models/FieldAgent.js";
import User from "../../../models/User.js";
import KYC from "../../kyc/models/KYC.js";
import { APPLICANT_TYPE } from "../../kyc/constants/kyc.constants.js";
import { decrypt } from "../../kyc/services/encryption.service.js";
import { Errors } from "../../../utils/response.js";
import { PAYOUT_ENTITY_TYPE } from "../constants/genericPayoutRequest.constants.js";

/**
 * Resolves {entityType, entityId} -> the User this wallet's KYC record
 * belongs to, plus the applicantType that record is filed under.
 * Read-only. Throws Errors.notFound if the underlying Salon/FieldAgent
 * document itself does not exist (defensive — should not occur in
 * practice for a real wallet).
 */
const resolveKycOwner = async ({ entityType, entityId, session }) => {
  if (entityType === PAYOUT_ENTITY_TYPE.SALON) {
    const salon = await Salon.findById(entityId).select("ownerId").session(session || null).lean();
    if (!salon) throw Errors.notFound("Salon not found for this wallet");
    return { ownerUserId: salon.ownerId, applicantType: APPLICANT_TYPE.OWNER };
  }

  // ACQUISITION_AGENT and TERRITORY_PARTNER are both FieldAgent
  // documents — KYC itself only ever files a FieldAgent's record under
  // the single generic APPLICANT_TYPE.FIELD_AGENT (KYC has no separate
  // "acquisition" vs "territory" applicant type — a FieldAgent's
  // commercialPath is a Field-Agent-module concept, not a KYC one).
  const fieldAgent = await FieldAgent.findById(entityId).select("userRef").session(session || null).lean();
  if (!fieldAgent) throw Errors.notFound("Field Agent not found for this wallet");
  return { ownerUserId: fieldAgent.userRef, applicantType: APPLICANT_TYPE.FIELD_AGENT };
};

/**
 * The main entry point. Resolves the entity's KYC record and returns a
 * ready-to-snapshot bank object, or throws Errors.forbidden with a
 * clear reason if the entity has no verified, complete bank KYC yet.
 * Never returns the encrypted account number — only the fields
 * KYC.js itself already stores in masked/display form.
 *
 * @param {{ entityType: string, entityId: import("mongoose").Types.ObjectId|string, session?: import("mongoose").ClientSession }} params
 * @returns {Promise<{ accountHolder: string, maskedAccount: string, ifsc: string, bankName: string|null }>}
 */
export const resolveVerifiedBankSnapshotForEntity = async ({ entityType, entityId, session }) => {
  if (!Object.values(PAYOUT_ENTITY_TYPE).includes(entityType)) {
    throw Errors.badRequest(`Unknown payout entityType: ${entityType}`);
  }

  const { ownerUserId, applicantType } = await resolveKycOwner({ entityType, entityId, session });

  const kyc = await KYC.findOne({
    ownerId: ownerUserId,
    applicantType,
    isDeleted: { $ne: true },
  })
    .select("bank verification")
    .session(session || null)
    .lean();

  if (!kyc || !kyc.bank) {
    throw Errors.forbidden("Bank KYC details are not available for this account");
  }

  // See file header — either existing verification signal is accepted.
  const isVerified = kyc.verification?.bank?.verified === true || kyc.bank.pennyDropStatus === "SUCCESS";
  if (!isVerified) {
    throw Errors.forbidden("Your bank account must be verified before you can request a withdrawal");
  }

  if (!kyc.bank.accountHolder || !kyc.bank.maskedAccount || !kyc.bank.ifsc) {
    throw Errors.forbidden("Bank details are incomplete");
  }

  return {
    accountHolder: kyc.bank.accountHolder,
    maskedAccount: kyc.bank.maskedAccount,
    ifsc: kyc.bank.ifsc,
    bankName: kyc.bank.bankName || null,
  };
};

/**
 * STEP 6.4 — Razorpay Route Settlement Engine. The dispatch-time
 * counterpart to resolveVerifiedBankSnapshotForEntity above: decrypts
 * the entity's LIVE bank account number and returns everything a
 * gateway call needs to actually send money — ACCOUNT_NUMBER, phone —
 * ONLY at the moment of dispatch, never persisted anywhere.
 *
 * SECURITY CROSS-CHECK (mirrors modules/fieldAgent/services/
 * fieldAgentAutoPayout.service.js#resolveDestination exactly): the
 * live KYC bank record must still match the IMMUTABLE bankSnapshot
 * captured on the GenericPayoutRequest at request time (same IFSC,
 * same masked account, and the decrypted account number's last 4
 * digits agreeing with the snapshot's masked value). If the bank
 * details have changed since the request was made, this returns null
 * — the caller must fail safe (PROCESSING -> AVAILABLE), never guess
 * which account is correct.
 *
 * Returns null (never throws) when the destination cannot be safely
 * resolved — same "fail safe, don't guess" discipline as the proven
 * precedent.
 */
export const resolveDispatchDestinationForEntity = async ({ entityType, entityId, bankSnapshot }) => {
  const { ownerUserId, applicantType } = await resolveKycOwner({ entityType, entityId });

  const [kyc, user] = await Promise.all([
    KYC.findOne({ ownerId: ownerUserId, applicantType, isDeleted: { $ne: true } }).select("bank verification").lean(),
    User.findById(ownerUserId).select("phone email").lean(),
  ]);

  const bank = kyc?.bank;
  if (!bank || !bank.encryptedAccount) return null;
  const isVerified = kyc.verification?.bank?.verified === true || bank.pennyDropStatus === "SUCCESS";
  if (!isVerified) return null;

  const accountNumber = decrypt(bank.encryptedAccount);
  if (!accountNumber) return null;

  const snap = bankSnapshot || {};
  if (bank.ifsc !== snap.ifsc || bank.maskedAccount !== snap.maskedAccount) return null;
  if (!String(snap.maskedAccount || "").endsWith(accountNumber.slice(-4))) return null;

  const phone = String(user?.phone || "").replace(/\D/g, "").slice(-10);
  if (phone.length !== 10) return null;

  return {
    accountHolder: bank.accountHolder,
    accountNumber,
    ifsc: bank.ifsc,
    phone,
    email: user?.email || undefined,
  };
};
