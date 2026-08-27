/**
 * BARBER ENGINE V1
 * backend/modules/support/models/SupportMessage.js
 *
 * Phase C — Support Core. Frozen per Phase B §5/§7.
 *
 * Append-only — no edit capability anywhere in the service/controller
 * layer. isDeleted exists only for moderation-hide (same philosophy
 * as Rating.isHidden — admin can hide, never rewrite what was said).
 * ticketRef is denormalized from conversationRef specifically so the
 * dominant "all messages for ticket X, filtered by visibility" query
 * never needs a join.
 *
 * attachments are embedded (not a separate collection/SalonMedia
 * reuse) — Phase B §4: no independent lifecycle/reorder/cover-image
 * need exists for a message attachment, unlike a salon gallery.
 */

import mongoose from "mongoose";
import { CHANNEL, MESSAGE_VISIBILITY, SENDER_TYPE } from "../constants/support.constants.js";

const attachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    type: { type: String, default: null },
    publicId: { type: String, default: null },
    mimeType: { type: String, default: null },
    sizeBytes: { type: Number, default: null },
  },
  { _id: false }
);

const supportMessageSchema = new mongoose.Schema(
  {
    conversationRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupportConversation",
      required: true,
    },
    ticketRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupportTicket",
      required: true,
    },

    senderRef: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    senderType: {
      type: String,
      enum: Object.values(SENDER_TYPE),
      required: true,
    },

    visibility: {
      type: String,
      enum: Object.values(MESSAGE_VISIBILITY),
      required: true,
    },

    body: { type: String, required: true, trim: true, maxlength: 5000 },
    attachments: { type: [attachmentSchema], default: [] },

    channel: {
      type: String,
      enum: Object.values(CHANNEL),
      default: CHANNEL.IN_APP,
    },

    // NotificationDeliveryLog doesn't get a real second caller until
    // Phase I (Communication Layer) — plain ObjectId, no `ref:`, same
    // forward-compatibility reasoning as SupportTicket.currentAssignment.
    deliveryLogRef: { type: mongoose.Schema.Types.ObjectId, default: null },

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Approved Phase-C indexes only.
supportMessageSchema.index({ conversationRef: 1, createdAt: 1 });
supportMessageSchema.index({ ticketRef: 1, visibility: 1, createdAt: 1 });

export default mongoose.models.SupportMessage || mongoose.model("SupportMessage", supportMessageSchema);
