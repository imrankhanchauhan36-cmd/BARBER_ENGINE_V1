/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/adminFieldAgentWallet.service.js
 *
 * STEP 2.4 — Admin Field Agent Wallet API. Read-only only —
 * WalletBalanceService/WalletLedger are reused exactly as they are
 * (WalletBalanceService.getWallet() for the balance, a plain
 * WalletLedger.find() for history) — no write to either anywhere in
 * this file.
 *
 * Wallet owner identity follows the SAME convention every other
 * Field-Agent wallet read in this codebase already uses (see
 * adminFieldAgentSummary.service.js): ownerType/entityType ===
 * FieldAgent.commercialPath (ACQUISITION_AGENT | TERRITORY_PARTNER —
 * confirmed byte-identical to WalletLedger's own LEDGER_OWNER_TYPE /
 * WalletBalanceService's WALLET_ENTITY_TYPE values before writing this
 * file), ownerId/entityId === the FieldAgent's own _id. A Field Agent
 * with no commercialPath selected yet has no wallet — this returns an
 * empty/null shape rather than querying with a null owner.
 *
 * `balanceAfter` (ticket's own singular field name): WalletLedger
 * entries snapshot ALL FOUR buckets per entry (balanceAfter.
 * {availableInPaise,pendingInPaise,lockedInPaise,processingInPaise}) —
 * this file surfaces balanceAfter.availableInPaise specifically, since
 * that is the one bucket the ticket's own Wallet section itself asks
 * for as the headline number. Disclosed here rather than guessed at
 * silently.
 */

import FieldAgent from "../models/FieldAgent.js";
import WalletBalanceService from "../../../services/WalletBalanceService.js";
import WalletLedger from "../../../models/WalletLedger.js";
import { Errors } from "../../../utils/response.js";

const EMPTY_WALLET = { availableInPaise: 0, pendingInPaise: 0, lockedInPaise: 0 };

export const getAdminFieldAgentWallet = async ({ fieldAgentId }) => {
  const fieldAgent = await FieldAgent.findById(fieldAgentId).select("_id commercialPath").lean();
  if (!fieldAgent) throw Errors.notFound("Field Agent not found");

  if (!fieldAgent.commercialPath) {
    return { wallet: EMPTY_WALLET, ledger: [] };
  }

  const [walletDoc, ledgerRows] = await Promise.all([
    WalletBalanceService.getWallet({
      entityType: fieldAgent.commercialPath,
      entityId: fieldAgent._id,
    }),
    WalletLedger.find({ ownerType: fieldAgent.commercialPath, ownerId: fieldAgent._id })
      .select("createdAt direction action amountInPaise balanceAfter")
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const wallet = walletDoc
    ? {
        availableInPaise: walletDoc.availableBalanceInPaise ?? 0,
        pendingInPaise: walletDoc.pendingBalanceInPaise ?? 0,
        lockedInPaise: walletDoc.lockedBalanceInPaise ?? 0,
      }
    : EMPTY_WALLET;

  const ledger = ledgerRows.map((row) => ({
    date: row.createdAt,
    direction: row.direction,
    source: row.action,
    amountInPaise: row.amountInPaise,
    balanceAfter: row.balanceAfter?.availableInPaise ?? null,
  }));

  return { wallet, ledger };
};
