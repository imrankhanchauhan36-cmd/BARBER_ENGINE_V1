/**
 * BARBER ENGINE V1
 * backend/modules/support/services/botActivity.service.js
 *
 * Phase H — Bot Support. Read-only bot-activity history for a ticket
 * — every SupportBotAction row, category/confidence/outcome/
 * escalation-reason included. Kept as its own small, additive
 * endpoint-backing service, same pattern as callLog.service.js's own
 * getTicketCallHistory() — never folded into or renaming
 * emailHistory.service.js.
 */

import SupportBotAction from "../models/SupportBotAction.js";

export async function getTicketBotActivity({ ticketId }) {
  const actions = await SupportBotAction.find({ ticketRef: ticketId })
    .sort({ createdAt: -1 })
    .populate({ path: "classifiedCategoryRef", select: "code name" })
    .lean();

  return { actions };
}
