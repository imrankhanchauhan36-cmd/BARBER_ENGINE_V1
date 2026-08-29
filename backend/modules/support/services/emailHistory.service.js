/**
 * BARBER ENGINE V1
 * backend/modules/support/services/emailHistory.service.js
 *
 * Phase H Step 9 (follow-up) — Admin Panel Email Support, Phase 3.
 * Read-only aggregation of a ticket's email activity for display —
 * no new schema, no new writes, no changes to Email Phase 2's
 * inbound/outbound logic. Purely joins two already-existing,
 * already-populated collections (SupportInboundEmailEvent,
 * NotificationDeliveryLog) via already-existing fields
 * (SupportMessage.deliveryLogRef), the same "zero new fields" approach
 * emailOutbound.service.js's own threading refinement used.
 *
 * Callers are responsible for the existence/authorization gate before
 * calling this (see adminSupport.controller.js/agentSupport.controller.js
 * — both reuse their existing getAdminTicketDetail/getAgentTicketDetail
 * calls purely as that gate, exactly like listAssignmentHistory's own
 * callers already do) — this function assumes ticketId is already a
 * ticket the caller is authorized to see.
 */

import SupportMessage from "../models/SupportMessage.js";
import SupportInboundEmailEvent from "../models/SupportInboundEmailEvent.js";
import NotificationDeliveryLog from "../../notifications/models/NotificationDeliveryLog.js";
import { CHANNEL } from "../constants/support.constants.js";

/**
 * @param {object} params
 * @param {string|import("mongoose").Types.ObjectId} params.ticketId
 * @returns {Promise<{inboundEvents: object[], outboundDeliveries: object[]}>}
 */
export async function getTicketEmailHistory({ ticketId }) {
  const [inboundEvents, emailMessages] = await Promise.all([
    SupportInboundEmailEvent.find({ matchedTicketRef: ticketId })
      .sort({ createdAt: 1 })
      .select("providerEventId messageId fromEmail toEmail subject status errorMessage createdAt")
      .lean(),
    SupportMessage.find({ ticketRef: ticketId, channel: CHANNEL.EMAIL, deliveryLogRef: { $ne: null } })
      .sort({ createdAt: 1 })
      .select("_id senderType createdAt deliveryLogRef")
      .lean(),
  ]);

  const deliveryLogIds = emailMessages.map((m) => m.deliveryLogRef);
  const deliveryLogs = deliveryLogIds.length
    ? await NotificationDeliveryLog.find({ _id: { $in: deliveryLogIds } })
        .select("status provider providerMessageId lastError sentAt createdAt")
        .lean()
    : [];
  const deliveryLogById = new Map(deliveryLogs.map((log) => [String(log._id), log]));

  const outboundDeliveries = emailMessages.map((m) => ({
    messageId: m._id,
    senderType: m.senderType,
    messageCreatedAt: m.createdAt,
    delivery: deliveryLogById.get(String(m.deliveryLogRef)) || null,
  }));

  return { inboundEvents, outboundDeliveries };
}
