/**
 * BARBER_ENGINE_V1
 * backend/modules/notifications/providers/EmailProvider.js
 *
 * Notification Engine — Phase H Step 9 (Support Email Support) — real
 * SMTP implementation via nodemailer, replacing the prior
 * NOT_IMPLEMENTED stub. Still satisfies the exact same
 * NotificationProvider.contract.js shape — NotificationDispatcher and
 * NotificationProviderResolver are untouched by this change.
 *
 * Provider-neutral by construction: nodemailer speaks plain SMTP, so
 * SendGrid/SES/Mailgun/Gmail/Ethereal/any other provider all work
 * identically through SMTP_HOST/PORT/USER/PASSWORD — no vendor SDK, no
 * vendor-specific payload shape. Swapping providers in production is a
 * .env change only, never a code change.
 *
 * Payload shape (caller-supplied — see emailOutbound.service.js, the
 * only intended caller) is deliberately richer than the generic
 * NotificationService.send() payload (title/message/recipientId),
 * since a support-reply email needs a real recipient address,
 * subject, body, and threading headers that a generic app
 * notification never has:
 *   { to, toName?, subject, text, html?, headers? }
 *
 * If SMTP_HOST is not configured (local/dev with no provider set up
 * yet), send() returns a clean {success:false, error:"NOT_CONFIGURED"}
 * result — never throws — so the rest of the pipeline (SupportMessage
 * creation, delivery logging, audit) stays fully testable without any
 * real mailbox.
 */

import nodemailer from "nodemailer";
import { NOTIFICATION_CHANNEL } from "../../../constants/notification.constants.js";
import logger from "../../../utils/logger.js";

function buildTransporter() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;

  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });
}

const EmailProvider = Object.freeze({
  name: "EMAIL",

  /**
   * @param {object} payload
   * @param {string} payload.to
   * @param {string} [payload.toName]
   * @param {string} payload.subject
   * @param {string} payload.text
   * @param {string} [payload.html]
   * @param {object} [payload.headers] - e.g. Message-ID/In-Reply-To/References
   * @returns {Promise<import("./NotificationProvider.contract.js").NotificationProviderResult>}
   */
  send: async (payload) => {
    const startedAt = Date.now();

    const fromAddress = process.env.SUPPORT_EMAIL_FROM_ADDRESS;
    const transporter = buildTransporter();

    if (!transporter || !fromAddress) {
      return {
        success: false,
        provider: "smtp",
        channel: NOTIFICATION_CHANNEL.EMAIL,
        messageId: null,
        latencyMs: Date.now() - startedAt,
        error: "NOT_CONFIGURED",
      };
    }

    const fromName = process.env.SUPPORT_EMAIL_FROM_NAME || "Support";
    const replyTo = process.env.SUPPORT_EMAIL_REPLY_TO || fromAddress;

    try {
      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromAddress}>`,
        to: payload.toName ? `"${payload.toName}" <${payload.to}>` : payload.to,
        replyTo,
        subject: payload.subject,
        text: payload.text,
        html: payload.html || undefined,
        headers: payload.headers || undefined,
      });

      return {
        success: true,
        provider: "smtp",
        channel: NOTIFICATION_CHANNEL.EMAIL,
        messageId: info.messageId || null,
        latencyMs: Date.now() - startedAt,
        error: null,
      };
    } catch (err) {
      logger.warn("[EmailProvider] send failed", { error: err.message });
      return {
        success: false,
        provider: "smtp",
        channel: NOTIFICATION_CHANNEL.EMAIL,
        messageId: null,
        latencyMs: Date.now() - startedAt,
        error: err.message || "SEND_FAILED",
      };
    }
  },
});

export default EmailProvider;
