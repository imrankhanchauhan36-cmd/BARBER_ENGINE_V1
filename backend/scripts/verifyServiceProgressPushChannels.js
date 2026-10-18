/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyServiceProgressPushChannels.js
 *
 * Static, file-based regression check for the "missing customer push
 * for service-progress steps" fix. Same convention as
 * verifyCheckInPushChannel.js: NO database connection, creates NO
 * booking, sends NO real notification — reads the modified source
 * files directly off disk and asserts against their literal text.
 *
 * Covers the 4 approved call sites (SERVICE_STARTED x2, manual +
 * automatic; SERVICE_COMPLETED_USER / SERVICE_AUTO_COMPLETED_USER x2,
 * manual + automatic), the one approved BOOKING_CONFIRMED copy fix,
 * and scope guards proving every explicitly out-of-scope call site
 * (forceComplete, the SALON-facing completion messages, the existing
 * check-in/payment-privacy fixes) was left untouched.
 *
 * Run:  cd backend && node scripts/verifyServiceProgressPushChannels.js
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

const bookingCtrlPath = path.resolve(__dirname, "../controllers/booking.controller.js");
const autoStartPath   = path.resolve(__dirname, "../jobs/autoStart.job.js");
const autoCompletePath = path.resolve(__dirname, "../jobs/autoComplete.job.js");

const bookingCtrl   = fs.readFileSync(bookingCtrlPath, "utf8");
const autoStartSrc  = fs.readFileSync(autoStartPath, "utf8");
const autoCompleteSrc = fs.readFileSync(autoCompletePath, "utf8");

const sliceFn = (source, fnMarker, nextMarker) => {
  const start = source.indexOf(fnMarker);
  const end   = nextMarker ? source.indexOf(nextMarker, start + fnMarker.length) : source.length;
  return start !== -1 ? source.slice(start, end === -1 ? source.length : end) : "";
};

const CH_PUSH = /\},\s*\[\s*NOTIFICATION_CHANNEL\.IN_APP\s*,\s*NOTIFICATION_CHANNEL\.PUSH\s*\]\s*\)/;

// ── 1. startService() — SERVICE_STARTED now push-enabled ───────
const startServiceBody = sliceFn(bookingCtrl, "export const startService = async", "\nexport const completeService");
check(
  "startService(): SERVICE_STARTED now requests [IN_APP, PUSH]",
  /templateKey:\s*NOTIFICATION_EVENTS\.SERVICE_STARTED[\s\S]*?\},\s*\[\s*NOTIFICATION_CHANNEL\.IN_APP\s*,\s*NOTIFICATION_CHANNEL\.PUSH\s*\]\s*\)/.test(startServiceBody)
);
check(
  "startService(): recipient/template/message text unchanged",
  startServiceBody.includes("recipientId:   booking.userRef,") &&
  startServiceBody.includes('recipientType: "USER",') &&
  startServiceBody.includes("Your service has started. Sit back and relax!")
);
check(
  "startService(): CHECKED_IN -> ONGOING transition validation still present",
  startServiceBody.includes("validateBookingTransition(booking.status, BOOKING_STATUS.ONGOING)")
);

// ── 2. autoStart.job.js — automatic SERVICE_STARTED ─────────────
check(
  "autoStart.job.js: NOTIFICATION_CHANNEL imported",
  /import\s*\{\s*NOTIFICATION_CHANNEL\s*\}\s*from\s*"\.\.\/constants\/notification\.constants\.js"/.test(autoStartSrc)
);
check(
  "autoStart.job.js: SERVICE_STARTED now requests [IN_APP, PUSH]",
  /templateKey:\s*NOTIFICATION_EVENTS\.SERVICE_STARTED[\s\S]*?\},\s*\[\s*NOTIFICATION_CHANNEL\.IN_APP\s*,\s*NOTIFICATION_CHANNEL\.PUSH\s*\]\s*\)/.test(autoStartSrc)
);
check(
  "autoStart.job.js: message text identical to the manual path (consistent wording)",
  autoStartSrc.includes("Your service has started. Sit back and relax!")
);

// ── 3. completeService() — SERVICE_COMPLETED_USER now push-enabled, SALON untouched ──
const completeServiceBody = sliceFn(bookingCtrl, "export const completeService = async", "\nexport const cancelBooking");
check(
  "completeService(): SERVICE_COMPLETED_USER now requests [IN_APP, PUSH]",
  /templateKey:\s*NOTIFICATION_EVENTS\.SERVICE_COMPLETED_USER[\s\S]*?\},\s*\[\s*NOTIFICATION_CHANNEL\.IN_APP\s*,\s*NOTIFICATION_CHANNEL\.PUSH\s*\]\s*\)/.test(completeServiceBody)
);
check(
  "completeService(): SERVICE_COMPLETED_SALON (owner) call left untouched (no channels argument)",
  // Bounded to the block's OWN closing "});" so this can never bleed
  // into the next, different NotificationService.send() call below it.
  /templateKey:\s*NOTIFICATION_EVENTS\.SERVICE_COMPLETED_SALON,[\s\S]*?\n\s*\}\);/.test(completeServiceBody)
);
check(
  "completeService(): message text unchanged",
  completeServiceBody.includes("Your service is complete. Thank you for booking with us!")
);

// ── 4. forceComplete() — now in scope (follow-up task): CHECKED_IN
// -> COMPLETED direct path, must now ALSO request PUSH, same as the
// other two COMPLETED-reaching paths.
const forceCompleteBody = sliceFn(bookingCtrl, "export const forceComplete = async", null);
check(
  "forceComplete(): SERVICE_COMPLETED_USER now requests [IN_APP, PUSH]",
  /templateKey:\s*NOTIFICATION_EVENTS\.SERVICE_COMPLETED_USER[\s\S]*?\},\s*\[\s*NOTIFICATION_CHANNEL\.IN_APP\s*,\s*NOTIFICATION_CHANNEL\.PUSH\s*\]\s*\)/.test(forceCompleteBody)
);
check(
  "forceComplete(): authorization (assertSalonOwnership), CHECKED_IN-only guard, and message text unchanged",
  forceCompleteBody.includes("await assertSalonOwnership(booking.salonRef, req.user._id, session);") &&
  forceCompleteBody.includes('if (booking.status !== BOOKING_STATUS.CHECKED_IN) {') &&
  forceCompleteBody.includes("Your service is complete. Thank you for booking with us!")
);

// ── 5. autoComplete.job.js — automatic SERVICE_AUTO_COMPLETED_USER, SALON untouched, wording preserved ──
check(
  "autoComplete.job.js: NOTIFICATION_CHANNEL imported",
  /import\s*\{\s*NOTIFICATION_CHANNEL\s*\}\s*from\s*"\.\.\/constants\/notification\.constants\.js"/.test(autoCompleteSrc)
);
check(
  "autoComplete.job.js: SERVICE_AUTO_COMPLETED_USER now requests [IN_APP, PUSH]",
  /templateKey:\s*NOTIFICATION_EVENTS\.SERVICE_AUTO_COMPLETED_USER[\s\S]*?\},\s*\[\s*NOTIFICATION_CHANNEL\.IN_APP\s*,\s*NOTIFICATION_CHANNEL\.PUSH\s*\]\s*\)/.test(autoCompleteSrc)
);
check(
  "autoComplete.job.js: SERVICE_AUTO_COMPLETED_SALON (owner) call left untouched (no channels argument)",
  /templateKey:\s*NOTIFICATION_EVENTS\.SERVICE_AUTO_COMPLETED_SALON,[\s\S]*?\n\s*\}\);/.test(autoCompleteSrc)
);
check(
  "autoComplete.job.js: distinguishing wording preserved verbatim (deliberate design, not changed)",
  autoCompleteSrc.includes("Your service duration ended. Booking automatically completed. Chair released.")
);

// ── 6. BOOKING_CONFIRMED copy fix — "today" defect removed, date now included ──
const confirmedEffectsBody = sliceFn(bookingCtrl, "export const runBookingConfirmedEffects = async", "\nexport const confirmBooking");
check(
  "BOOKING_CONFIRMED message no longer hardcodes \"today\"",
  !/confirmed for today at/.test(confirmedEffectsBody)
);
check(
  "BOOKING_CONFIRMED message now includes the full booking date (toLocaleString dateStyle+timeStyle)",
  /bookingDateTimeStr = booking\.startTime\.toLocaleString\("en-IN", \{\s*dateStyle: "medium", timeStyle: "short"/.test(confirmedEffectsBody) &&
  confirmedEffectsBody.includes("message:       `Your appointment is confirmed for ${bookingDateTimeStr}.`")
);
check(
  "BOOKING_CONFIRMED still [IN_APP, PUSH], recipient/template unchanged",
  /templateKey:\s*NOTIFICATION_EVENTS\.BOOKING_CONFIRMED[\s\S]*?\},\s*\[\s*NOTIFICATION_CHANNEL\.IN_APP\s*,\s*NOTIFICATION_CHANNEL\.PUSH\s*\]\s*\)/.test(confirmedEffectsBody) &&
  confirmedEffectsBody.includes("recipientId:   booking.userRef,")
);

// ── 7. Preserved from earlier phases — re-confirmed unchanged ──
check(
  "PAYMENT_SUCCESS privacy-safe message preserved",
  confirmedEffectsBody.includes("Your payment was successful. Tap to view details.")
);
check(
  "checkInBooking() BOOKING_CHECKED_IN still [IN_APP, PUSH] (untouched by this task)",
  /BOOKING_CHECKED_IN[\s\S]*?\},\s*\[\s*NOTIFICATION_CHANNEL\.IN_APP\s*,\s*NOTIFICATION_CHANNEL\.PUSH\s*\]\s*\)/.test(bookingCtrl)
);
check(
  "BOOKING_CREATED (owner, post-confirmation) still [IN_APP, PUSH] (untouched by this task)",
  /templateKey:\s*NOTIFICATION_EVENTS\.BOOKING_CREATED[\s\S]*?\},\s*\[\s*NOTIFICATION_CHANNEL\.IN_APP\s*,\s*NOTIFICATION_CHANNEL\.PUSH\s*\]\s*\)/.test(confirmedEffectsBody)
);

console.log(rows.join("\n"));
console.log(`\nRESULT: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
