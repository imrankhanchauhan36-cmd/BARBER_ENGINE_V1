/**
 * BARBER ENGINE V1
 * backend/modules/support/providers/whatsappInbound.devAdapter.js
 *
 * Phase H — WhatsApp Support (inbound). DEV/TEST ONLY.
 *
 * No real WhatsApp provider is configured yet. This adapter accepts an
 * ALREADY-NORMALIZED JSON body — i.e. it IS the shape
 * whatsappInbound.service.js expects, byte-for-byte — so local testing
 * (curl/Postman/a test script) can exercise the full pipeline without
 * any real WhatsApp Business account. Exact sibling of
 * emailInbound.devAdapter.js.
 *
 * A future real-provider adapter (e.g. whatsappInbound.metaAdapter.js
 * for Meta Cloud API's actual webhook JSON — entry[].changes[].value.
 * messages[], phone numbers as digits-with-country-code, etc.) would
 * live alongside this file and do genuine field-mapping/parsing work —
 * that adapter, not whatsappInbound.service.js or the controller/
 * route, is the ONLY thing that would need to change to plug in a real
 * provider. This function is intentionally a thin identity
 * pass-through, not a placeholder for future logic to be added here
 * later — the seam is the file boundary itself. The downstream service
 * knows nothing about provider-specific payload structure.
 */

export function normalizeDevPayload(rawBody) {
  return {
    providerEventId: rawBody.providerEventId,
    contextMessageId: rawBody.contextMessageId ?? null,
    fromPhoneNumber: rawBody.fromPhoneNumber,
    toPhoneNumber: rawBody.toPhoneNumber ?? null,
    textBody: rawBody.textBody,
  };
}
