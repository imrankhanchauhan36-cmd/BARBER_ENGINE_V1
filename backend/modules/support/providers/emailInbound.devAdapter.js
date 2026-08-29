/**
 * BARBER ENGINE V1
 * backend/modules/support/providers/emailInbound.devAdapter.js
 *
 * Phase H Step 9 — Email Support (inbound). DEV/TEST ONLY.
 *
 * No real email provider is configured yet (per the approved Phase 1
 * design: "build a provider-agnostic ingestion boundary and local/test
 * adapter instead of hardcoding a production provider"). This adapter
 * accepts an ALREADY-NORMALIZED JSON body — i.e. it IS the shape
 * emailInbound.service.js expects, byte-for-byte — so local testing
 * (curl/Postman) can exercise the full pipeline without any real
 * mailbox or provider account.
 *
 * A future real-provider adapter (e.g. emailInbound.sendgridAdapter.js
 * for SendGrid's Inbound Parse multipart payload, or an equivalent for
 * Mailgun Routes) would live alongside this file and do genuine
 * field-mapping/parsing work — that adapter, not
 * emailInbound.service.js or the controller/route, is the ONLY thing
 * that would need to change to plug in a real provider. This function
 * is intentionally a thin identity pass-through, not a placeholder for
 * future logic to be added here later — the seam is the file boundary
 * itself.
 */

export function normalizeDevPayload(rawBody) {
  return {
    providerEventId: rawBody.providerEventId,
    messageId: rawBody.messageId ?? null,
    inReplyTo: rawBody.inReplyTo ?? null,
    references: Array.isArray(rawBody.references) ? rawBody.references : [],
    fromEmail: rawBody.fromEmail,
    toEmail: rawBody.toEmail ?? null,
    subject: rawBody.subject ?? null,
    textBody: rawBody.textBody,
    attachments: Array.isArray(rawBody.attachments) ? rawBody.attachments : [],
  };
}
