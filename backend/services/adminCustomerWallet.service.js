/**
 * BARBER ENGINE V1
 * backend/services/adminCustomerWallet.service.js
 *
 * STEP 5.5B — Admin Customer Wallet API. Read-only — no write to
 * User (or anything else) anywhere in this file. No schema change.
 *
 * ONLY MODEL — User. Per the ticket's own explicit rules:
 *   - walletBalance comes straight from User.walletBalance
 *   - rewardPoints  comes straight from User.rewardPoints
 *   - No WalletLedger, no SalonEarnings, no calculation of any kind.
 * This is a deliberate departure from every other Wallet surface in
 * this codebase (Salon Wallet tab, Field Agent Wallet tab), which are
 * all WalletLedger/SalonEarnings-backed and involve real aggregation.
 * A User's own wallet is not a SalonEarnings row and is not
 * reconstructed from WalletLedger — it is the two raw fields already
 * sitting on the User document, read verbatim, per this ticket's own
 * rule.
 *
 * "Customer" = a User document with role "USER" (same definition as
 * STEP 5.1's audit finding, reused unchanged since STEP 5.2A).
 *
 * Amount naming — User.walletBalance is stored as a plain number on
 * the schema (no *InPaise suffix on the field itself), but every
 * other money-bearing customer endpoint in this module (5.2A's
 * lifetimeSpendInPaise, 5.2B's amountInPaise) treats these balances
 * as paise, and adminUser.controller.js's own existing DTO already
 * exposes this exact same field as `wallet.balance` without any unit
 * conversion — so this endpoint reads it verbatim too and only
 * renames the response key to walletBalanceInPaise per the ticket's
 * named response shape, without altering the underlying value.
 *
 * Scope guard mirrors the now-standardized districtRef rule used by
 * every sibling admin/users/:id/* endpoint (STEP 5.2A/5.2B/5.5A).
 */

import mongoose from "mongoose";
import User from "../models/User.js";
import { Errors } from "../utils/response.js";

const isWithinAdminScope = (admin, customer) => {
  if (admin?.adminLevel === "INDIA") return true;
  if (admin?.adminLevel === "STATE") {
    return customer.stateRef?.toString() === admin.stateRef?.toString();
  }
  if (admin?.adminLevel === "DISTRICT") {
    return customer.districtRef?.toString() === admin.districtRef?.toString();
  }
  return false;
};

export const getAdminCustomerWallet = async ({ customerId, admin }) => {
  if (!mongoose.Types.ObjectId.isValid(customerId)) {
    throw Errors.badRequest("Invalid customer ID");
  }

  const customer = await User.findOne({ _id: customerId, role: "USER", isDeleted: { $ne: true } })
    .select("stateRef districtRef walletBalance rewardPoints")
    .lean();
  if (!customer) throw Errors.notFound("Customer not found");
  if (!isWithinAdminScope(admin, customer)) throw Errors.forbidden("Out of your authorized scope");

  return {
    wallet: {
      walletBalanceInPaise: customer.walletBalance ?? 0,
      rewardPoints: customer.rewardPoints ?? 0,
    },
  };
};
