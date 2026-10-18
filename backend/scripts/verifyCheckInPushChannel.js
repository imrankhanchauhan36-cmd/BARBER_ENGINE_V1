/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyCheckInPushChannel.js
 *
 * Static, file-based regression check for the check-in push-channel
 * fix. Deliberately has NO database connection, creates NO booking,
 * sends NO real notification, and never invokes checkInBooking() at
 * runtime — it reads controllers/booking.controller.js directly off
 * disk and asserts against its literal source text. Same convention
 * as user-app/src/config/__verify__/easJsonProductionKey.verify.mjs.
 *
 * Run:  cd backend && node scripts/verifyCheckInPushChannel.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTROLLER_PATH = path.resolve(__dirname, "../controllers/booking.controller.js");

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond) => {
  if (cond) { pass++; rows.push(`  ✅ ${name}`); }
  else      { fail++; rows.push(`  ❌ ${name}`); }
};

const source = fs.readFileSync(CONTROLLER_PATH, "utf8");

// ── Isolate the checkInBooking function body only ──────────────
// Everything asserted below must be scoped to THIS function, so a
// change elsewhere in the file (e.g. startService) can never make
// this script pass by accident.
const startMarker = "export const checkInBooking = async (req, res) => {";
const endMarker    = "export const startService = async (req, res) => {";
const startIdx = source.indexOf(startMarker);
const endIdx   = source.indexOf(endMarker);

check("checkInBooking() function found", startIdx !== -1);
check("startService() function found (used as the function boundary)", endIdx !== -1);
check("checkInBooking() appears before startService() in the file", startIdx !== -1 && endIdx !== -1 && startIdx < endIdx);

const checkInBody  = startIdx !== -1 && endIdx !== -1 ? source.slice(startIdx, endIdx) : "";

// ── The actual fix: both channels now requested ─────────────────
check(
  "checkInBooking() NotificationService.send() now requests [IN_APP, PUSH]",
  /NotificationService\.send\(\{[\s\S]*?\},\s*\[\s*NOTIFICATION_CHANNEL\.IN_APP\s*,\s*NOTIFICATION_CHANNEL\.PUSH\s*\]\s*\)/.test(checkInBody)
);

// ── IN_APP preserved (fix must not have replaced it, only added PUSH) ──
check(
  "IN_APP channel is still present alongside PUSH (not replaced)",
  /\[\s*NOTIFICATION_CHANNEL\.IN_APP\s*,\s*NOTIFICATION_CHANNEL\.PUSH\s*\]/.test(checkInBody)
);

// ── Everything the previous audit required to stay unchanged ───
check("recipientId is still booking.userRef (correct customer id)", /recipientId:\s*booking\.userRef,/.test(checkInBody));
check("recipientType is still \"USER\"", /recipientType:\s*"USER",/.test(checkInBody));
check("templateKey is still BOOKING_CHECKED_IN", /templateKey:\s*NOTIFICATION_EVENTS\.BOOKING_CHECKED_IN,/.test(checkInBody));
check("title/message copy unchanged", /title:\s*"Checked In",/.test(checkInBody) && /You're checked in\. The salon will start your service shortly\./.test(checkInBody));

// ── OTP + state-machine logic untouched (sanity anchors) ────────
check("OTP hashing/lookup logic still present", /hashOtp\(otp\)/.test(checkInBody) && /checkInOtp:\s*hashedOtp,/.test(checkInBody));
check("CONFIRMED -> CHECKED_IN transition validation still present", /validateBookingTransition\(booking\.status, BOOKING_STATUS\.CHECKED_IN\)/.test(checkInBody));
check("Atomic transaction commit still present", /checkInSession\.commitTransaction\(\)/.test(checkInBody));
check("HTTP success contract unchanged (200 + success:true)", /res\.status\(200\)\.json\(\{\s*success:\s*true,/.test(checkInBody));

console.log(rows.join("\n"));
console.log(`\nRESULT: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
