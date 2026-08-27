/**
 * BARBER ENGINE V1
 * backend/modules/support/models/SupportConversation.js
 *
 * Phase C — Support Core. Frozen per Phase B §5/§7.
 *
 * ticketRef is indexed but deliberately NOT unique — Phase C's
 * service layer enforces "exactly one IN_APP conversation per ticket"
 * at the application level, leaving room for a future multi-channel
 * ticket (WhatsApp + In-App conversations on the same ticket) without
 * a breaking schema change (mandatory rule: Ticket != Conversation).
 */

import mongoose from "mongoose";
import { CHANNEL, CONVERSATION_STATUS } from "../constants/support.constants.js";

const participantSchema = new mongoose.Schema(
  {
    userRef: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    roleAtTime: { type: String, default: null },
  },
  { _id: false }
);

const supportConversationSchema = new mongoose.Schema(
  {
    ticketRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupportTicket",
      required: true,
    },

    channel: {
      type: String,
      enum: Object.values(CHANNEL),
      required: true,
      default: CHANNEL.IN_APP,
    },

    status: {
      type: String,
      enum: Object.values(CONVERSATION_STATUS),
      default: CONVERSATION_STATUS.ACTIVE,
    },

    participantRefs: { type: [participantSchema], default: [] },

    lastMessageAt: { type: Date, default: null },
    lastMessagePreview: { type: String, default: null, maxlength: 300 },

    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Approved Phase-C index only — channel index explicitly deferred.
supportConversationSchema.index({ ticketRef: 1 });

export default mongoose.models.SupportConversation || mongoose.model("SupportConversation", supportConversationSchema);
