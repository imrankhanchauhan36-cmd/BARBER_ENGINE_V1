/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/fieldAgentWalletBridge.service.js
 *
 * FA-P4-C Step 1 — mirrors credited Field Agent earnings into the
 * Field Agent's wallet (the SAME SalonEarnings/WalletLedger wallet a
 * salon uses, entityType FIELD_AGENT) so that withdrawal runs through
 * WalletBalanceService like any other wallet.
 *
 * FieldAgentEarningLedger stays the source of truth for what was
 * earned and is never written here. Each CREDITED row is mirrored
 * exactly once, keyed by the deterministic idempotency key
 * `fa-earning:<ledgerRowId>` — re-running is a no-op for rows already
 * mirrored, so this is safe to call on every withdrawal.
 */

import mongoose from "mongoose";
import FieldAgentEarningLedger from "../models/FieldAgentEarningLedger.js";
import WalletLedger from "../../../models/WalletLedger.js";
import WalletBalanceService from "../../../services/WalletBalanceService.js";
import { EARNING_CREDIT_OUTCOME } from "../constants/fieldAgentEarning.constants.js";

export const FIELD_AGENT_WALLET_ENTITY_TYPE = "FIELD_AGENT";

export const earningIdempotencyKey = (ledgerRowId) => `fa-earning:${ledgerRowId}`;

/**
 * CREDITED earning rows for this agent that are not yet in the wallet
 * ledger. Read-only; pass a session for a consistent in-transaction read.
 */
export const findUnbridgedEarnings = async (fieldAgentRef, session = null) => {
  const rowsQuery = FieldAgentEarningLedger.find({
    fieldAgentRef: new mongoose.Types.ObjectId(fieldAgentRef),
    creditOutcome: EARNING_CREDIT_OUTCOME.CREDITED,
    creditedAmountInPaise: { $gt: 0 },
  }).select("_id creditedAmountInPaise").lean();
  if (session) rowsQuery.session(session);
  const rows = await rowsQuery;
  if (rows.length === 0) return [];

  const keys = rows.map((r) => earningIdempotencyKey(r._id));
  const doneQuery = WalletLedger.collection.find(
    { idempotencyKey: { $in: keys } },
    { projection: { idempotencyKey: 1 }, ...(session ? { session } : {}) }
  );
  const done = new Set((await doneQuery.toArray()).map((d) => d.idempotencyKey));

  return rows.filter((r) => !done.has(earningIdempotencyKey(r._id)));
};

/**
 * Credits every not-yet-mirrored earning into the agent's wallet
 * AVAILABLE bucket. Must run inside the caller's transaction.
 * Returns the paise mirrored by this call.
 */
export const syncEarningsIntoWallet = async ({ fieldAgentRef, session }) => {
  const pending = await findUnbridgedEarnings(fieldAgentRef, session);
  let mirrored = 0;
  for (const row of pending) {
    const res = await WalletBalanceService.credit({
      entityType:     FIELD_AGENT_WALLET_ENTITY_TYPE,
      entityId:       fieldAgentRef,
      amountInPaise:  row.creditedAmountInPaise,
      action:         "EARNING_CREDIT",
      refType:        "EARNING",
      refId:          row._id,
      idempotencyKey: earningIdempotencyKey(row._id),
      session,
      triggeredBy:    "SYSTEM",
      remarks:        "Field Agent earning credited to wallet",
    });
    if (!res.idempotent) mirrored += row.creditedAmountInPaise;
  }
  return mirrored;
};
