/**
 * BARBER ENGINE V1
 * backend/modules/support/providers/callInbound.devAdapter.js
 *
 * Phase H — Call Support (inbound). DEV/TEST ONLY.
 *
 * No real telephony provider is configured yet. This adapter accepts
 * an ALREADY-NORMALIZED JSON body — i.e. it IS the shape
 * callInbound.service.js expects, byte-for-byte — so local testing can
 * exercise the full multi-event call lifecycle (INITIATED -> RINGING
 * -> ANSWERED -> COMPLETED) without any real telephony account. Exact
 * sibling of emailInbound.devAdapter.js / whatsappInbound.devAdapter.js.
 *
 * A future real-provider adapter (Twilio/Exotel/other — none chosen
 * yet, per the approved design) would live alongside this file and map
 * that provider's actual webhook shape (which varies significantly
 * between providers, unlike Email/WhatsApp's more standardized
 * formats) into this exact same normalized shape — that adapter, not
 * callInbound.service.js or the controller/route, is the ONLY thing
 * that would need to change to plug in a real provider.
 */

export function normalizeDevPayload(rawBody) {
  return {
    providerEventId: rawBody.providerEventId,
    providerCallId: rawBody.providerCallId,
    eventType: rawBody.eventType,
    fromPhoneNumber: rawBody.fromPhoneNumber,
    toPhoneNumber: rawBody.toPhoneNumber ?? null,
    durationSeconds: rawBody.durationSeconds ?? null,
  };
}
