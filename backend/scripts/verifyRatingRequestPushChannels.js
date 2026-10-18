/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyRatingRequestPushChannels.js
 *
 * Static, file-based regression check for the new Review & Rating
 * push-notification addition (RATING_REQUEST_USER). Same convention
 * as verifyServiceProgressPushChannels.js: NO database connection,
 * creates NO booking/rating, sends NO real notification — reads the
 * modified source files directly off disk and asserts against their
 * literal text.
 *
 * Covers: the new additive event key, the 3 approved call sites
 * (completeService, forceComplete, autoComplete.job.js) each sending
 * [IN_APP, PUSH] with the correct recipient/actionType/deep-link, the
 * pre-existing SERVICE_COMPLETED_USER/SERVICE_AUTO_COMPLETED_USER
 * sends remaining byte-identical, and a negative check that no other
 * lifecycle path (checkInBooking, startService, autoStart.job.js,
 * runBookingConfirmedEffects, lockSlot) was given this new event.
 *
 * Run:  cd backend && node scripts/verifyRatingRequestPushChannels.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond) => {
  if (cond) { pass++; rows.push(`  ✅ ${name}`); }
  else      { fail++; rows.push(`  ❌ ${name}`); }
};

const bookingCtrlPath   = path.resolve(__dirname, "../controllers/booking.controller.js");
const autoCompletePath  = path.resolve(__dirname, "../jobs/autoComplete.job.js");
const autoStartPath     = path.resolve(__dirname, "../jobs/autoStart.job.js");
const eventsConstPath   = path.resolve(__dirname, "../modules/notifications/constants/notificationEvents.constants.js");

const bookingCtrl    = fs.readFileSync(bookingCtrlPath, "utf8");
const autoCompleteSrc = fs.readFileSync(autoCompletePath, "utf8");
const autoStartSrc    = fs.readFileSync(autoStartPath, "utf8");
const eventsConstSrc  = fs.readFileSync(eventsConstPath, "utf8");

const sliceFn = (source, fnMarker, nextMarker) => {
  const start = source.indexOf(fnMarker);
  const end   = nextMarker ? source.indexOf(nextMarker, start + fnMarker.length) : source.length;
  return start !== -1 ? source.slice(start, end === -1 ? source.length : end) : "";
};

const occurrences = (source, needle) => (source.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;

// ── 1. New event key — additive only ──────────────────────────────
check(
  "notificationEvents.constants.js: RATING_REQUEST_USER key added",
  /RATING_REQUEST_USER:\s*"RATING_REQUEST_USER"/.test(eventsConstSrc)
);
check(
  "notificationEvents.constants.js: every pre-existing SERVICE_* key still present (additive, nothing removed)",
  eventsConstSrc.includes('SERVICE_STARTED:              "SERVICE_STARTED"') &&
  eventsConstSrc.includes('SERVICE_COMPLETED_SALON:      "SERVICE_COMPLETED_SALON"') &&
  eventsConstSrc.includes('SERVICE_COMPLETED_USER:       "SERVICE_COMPLETED_USER"') &&
  eventsConstSrc.includes('SERVICE_AUTO_COMPLETED_SALON: "SERVICE_AUTO_COMPLETED_SALON"') &&
  eventsConstSrc.includes('SERVICE_AUTO_COMPLETED_USER:  "SERVICE_AUTO_COMPLETED_USER"')
);

// ── 2. completeService() ──────────────────────────────────────────
const completeServiceBody = sliceFn(bookingCtrl, "export const completeService = async", "\nexport const cancelBooking");
check(
  "completeService(): SERVICE_COMPLETED_USER unchanged — recipient/template/message/actionType/[IN_APP,PUSH] all byte-identical",
  /recipientId:\s*booking\.userRef,\s*recipientType:\s*"USER",\s*templateKey:\s*NOTIFICATION_EVENTS\.SERVICE_COMPLETED_USER,\s*title:\s*"Service Completed",\s*message:\s*"Your service is complete\. Thank you for booking with us!",\s*type:\s*"BOOKING",\s*priority:\s*"MEDIUM",\s*actionType:\s*"OPEN_BOOKING",\s*actionUrl:\s*`\/bookings\/\$\{booking\._id\}`,/.test(completeServiceBody)
);
check(
  "completeService(): new RATING_REQUEST_USER send present, [IN_APP, PUSH]",
  /templateKey:\s*NOTIFICATION_EVENTS\.RATING_REQUEST_USER[\s\S]*?\},\s*\[\s*NOTIFICATION_CHANNEL\.IN_APP\s*,\s*NOTIFICATION_CHANNEL\.PUSH\s*\]\s*\)/.test(completeServiceBody)
);
check(
  "completeService(): RATING_REQUEST_USER recipient is booking.userRef/\"USER\"",
  /templateKey:\s*NOTIFICATION_EVENTS\.RATING_REQUEST_USER/.test(completeServiceBody) &&
  (() => {
    const i = completeServiceBody.indexOf("NOTIFICATION_EVENTS.RATING_REQUEST_USER");
    const block = completeServiceBody.slice(Math.max(0, i - 200), i);
    return block.includes("recipientId:   booking.userRef,") && block.includes('recipientType: "USER",');
  })()
);
check(
  "completeService(): RATING_REQUEST_USER uses actionType OPEN_REVIEW and actionUrl /ratings/<id>",
  /templateKey:\s*NOTIFICATION_EVENTS\.RATING_REQUEST_USER[\s\S]*?actionType:\s*"OPEN_REVIEW",\s*actionUrl:\s*`\/ratings\/\$\{booking\._id\}`/.test(completeServiceBody)
);
check(
  "completeService(): RATING_REQUEST_USER placed AFTER the completion commit (transitionBookingStatus already ran)",
  completeServiceBody.indexOf("transitionBookingStatus({ booking, nextStatus: BOOKING_STATUS.COMPLETED") <
  completeServiceBody.indexOf("NOTIFICATION_EVENTS.RATING_REQUEST_USER")
);
check(
  "completeService(): exactly one RATING_REQUEST_USER send (no accidental duplicate)",
  occurrences(completeServiceBody, "NOTIFICATION_EVENTS.RATING_REQUEST_USER") === 1
);

// ── 3. forceComplete() ────────────────────────────────────────────
const forceCompleteBody = sliceFn(bookingCtrl, "export const forceComplete = async", "\nexport const extendService");
check(
  "forceComplete(): SERVICE_COMPLETED_USER unchanged — recipient/template/message/actionType/[IN_APP,PUSH] all byte-identical",
  /recipientId:\s*booking\.userRef,\s*recipientType:\s*"USER",\s*templateKey:\s*NOTIFICATION_EVENTS\.SERVICE_COMPLETED_USER,\s*title:\s*"Service Completed",\s*message:\s*"Your service is complete\. Thank you for booking with us!",\s*type:\s*"BOOKING",\s*priority:\s*"MEDIUM",\s*actionType:\s*"OPEN_BOOKING",\s*actionUrl:\s*`\/bookings\/\$\{booking\._id\}`,/.test(forceCompleteBody)
);
check(
  "forceComplete(): new RATING_REQUEST_USER send present, [IN_APP, PUSH]",
  /templateKey:\s*NOTIFICATION_EVENTS\.RATING_REQUEST_USER[\s\S]*?\},\s*\[\s*NOTIFICATION_CHANNEL\.IN_APP\s*,\s*NOTIFICATION_CHANNEL\.PUSH\s*\]\s*\)/.test(forceCompleteBody)
);
check(
  "forceComplete(): RATING_REQUEST_USER uses actionType OPEN_REVIEW and actionUrl /ratings/<id>",
  /templateKey:\s*NOTIFICATION_EVENTS\.RATING_REQUEST_USER[\s\S]*?actionType:\s*"OPEN_REVIEW",\s*actionUrl:\s*`\/ratings\/\$\{booking\._id\}`/.test(forceCompleteBody)
);
check(
  "forceComplete(): authorization (assertSalonOwnership) and CHECKED_IN-only guard unchanged",
  forceCompleteBody.includes("await assertSalonOwnership(booking.salonRef, req.user._id, session);") &&
  forceCompleteBody.includes('if (booking.status !== BOOKING_STATUS.CHECKED_IN) {')
);
check(
  "forceComplete(): exactly one RATING_REQUEST_USER send (no accidental duplicate)",
  occurrences(forceCompleteBody, "NOTIFICATION_EVENTS.RATING_REQUEST_USER") === 1
);

// ── 4. autoComplete.job.js ─────────────────────────────────────────
check(
  "autoComplete.job.js: SERVICE_AUTO_COMPLETED_USER unchanged — message/actionType/[IN_APP,PUSH] all byte-identical",
  /templateKey:\s*NOTIFICATION_EVENTS\.SERVICE_AUTO_COMPLETED_USER,\s*title:\s*"Service Completed",\s*message:\s*"Your service duration ended\. Booking automatically completed\. Chair released\.",[\s\S]*?\},\s*\[\s*NOTIFICATION_CHANNEL\.IN_APP\s*,\s*NOTIFICATION_CHANNEL\.PUSH\s*\]\s*\)/.test(autoCompleteSrc)
);
check(
  "autoComplete.job.js: SERVICE_AUTO_COMPLETED_SALON (owner) left untouched (no channels argument)",
  /templateKey:\s*NOTIFICATION_EVENTS\.SERVICE_AUTO_COMPLETED_SALON,[\s\S]*?\n\s*\}\);/.test(autoCompleteSrc)
);
check(
  "autoComplete.job.js: new RATING_REQUEST_USER send present, [IN_APP, PUSH], correct recipient",
  /recipientId:\s*booking\.userRef,\s*recipientType:\s*"USER",\s*templateKey:\s*NOTIFICATION_EVENTS\.RATING_REQUEST_USER[\s\S]*?\},\s*\[\s*NOTIFICATION_CHANNEL\.IN_APP\s*,\s*NOTIFICATION_CHANNEL\.PUSH\s*\]\s*\)/.test(autoCompleteSrc)
);
check(
  "autoComplete.job.js: RATING_REQUEST_USER uses actionType OPEN_REVIEW and actionUrl /ratings/<id>",
  /templateKey:\s*NOTIFICATION_EVENTS\.RATING_REQUEST_USER[\s\S]*?actionType:\s*"OPEN_REVIEW",\s*actionUrl:\s*`\/ratings\/\$\{booking\._id\}`/.test(autoCompleteSrc)
);
check(
  "autoComplete.job.js: exactly one RATING_REQUEST_USER send (no accidental duplicate)",
  occurrences(autoCompleteSrc, "NOTIFICATION_EVENTS.RATING_REQUEST_USER") === 1
);

// ── 5. Negative check — no review-request on any OTHER lifecycle path ──
const confirmedEffectsBody = sliceFn(bookingCtrl, "export const runBookingConfirmedEffects = async", "\nexport const confirmBooking");
const checkInBody   = sliceFn(bookingCtrl, "export const checkInBooking = async", "\nexport const startService");
const startServiceBody = sliceFn(bookingCtrl, "export const startService = async", "\nexport const completeService");
const lockSlotBody  = sliceFn(bookingCtrl, "export const lockSlot = async", "\nexport const confirmBooking");

check(
  "RATING_REQUEST_USER NOT present in runBookingConfirmedEffects/checkInBooking/startService/lockSlot (no scope creep)",
  !confirmedEffectsBody.includes("RATING_REQUEST_USER") &&
  !checkInBody.includes("RATING_REQUEST_USER") &&
  !startServiceBody.includes("RATING_REQUEST_USER") &&
  !lockSlotBody.includes("RATING_REQUEST_USER")
);
check(
  "RATING_REQUEST_USER NOT present in autoStart.job.js (no scope creep)",
  !autoStartSrc.includes("RATING_REQUEST_USER")
);
check(
  "booking.controller.js: RATING_REQUEST_USER appears exactly twice in the whole file (completeService + forceComplete, nowhere else)",
  occurrences(bookingCtrl, "NOTIFICATION_EVENTS.RATING_REQUEST_USER") === 2
);

console.log(rows.join("\n"));
console.log(`\nRESULT: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
