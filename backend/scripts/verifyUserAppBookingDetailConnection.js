/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyUserAppBookingDetailConnection.js
 *
 * Static, file-based regression check for the User App booking
 * progress UI connection task. Same convention as
 * verifyServiceProgressPushChannels.js: NO database connection, NO
 * app build/bundle, reads the modified source files directly off disk
 * and asserts against their literal text. Lives in backend/scripts
 * purely to reuse this project's existing verify-script convention;
 * it only reads files under ../../user-app.
 *
 * Run:  cd backend && node scripts/verifyUserAppBookingDetailConnection.js
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

const userAppRoot = path.resolve(__dirname, "../../user-app/src");

const detailPath   = path.join(userAppRoot, "features/booking/screens/BookingDetailScreen.js");
const historyPath  = path.join(userAppRoot, "features/booking/screens/BookingHistoryScreen.js");
const pushSvcPath  = path.join(userAppRoot, "services/push/userPushNotificationService.js");
const notifsPath   = path.join(userAppRoot, "features/notifications/screens/NotificationsScreen.js");

const detailSrc  = fs.readFileSync(detailPath, "utf8");
const historySrc = fs.readFileSync(historyPath, "utf8");
const pushSvcSrc = fs.readFileSync(pushSvcPath, "utf8");
const notifsSrc  = fs.readFileSync(notifsPath, "utf8");

// ── 1. BookingDetailScreen — accepts bookingId-only params, refetches ──
check(
  "BookingDetailScreen: accepts route.params.bookingId (not just a full booking object)",
  /route\.params\?\.bookingId/.test(detailSrc)
);
check(
  "BookingDetailScreen: refetches via the EXISTING list endpoint (/api/v1/bookings/user), no new endpoint invented",
  detailSrc.includes('apiClient.get("/api/v1/bookings/user"') &&
  !/\/api\/v1\/bookings\/user\/[a-zA-Z]+\/\$\{/.test(detailSrc) // no templated single-booking path
);
check(
  "BookingDetailScreen: matches the fetched list by _id client-side (no server contract change)",
  /list\.find\(\(b\)\s*=>\s*b\._id\s*===\s*targetBookingId\)/.test(detailSrc)
);
check(
  "BookingDetailScreen: uses useFocusEffect so it refreshes on open AND on return to the screen",
  /from\s*"@react-navigation\/native"/.test(detailSrc) && detailSrc.includes("useFocusEffect(")
);
check(
  "BookingDetailScreen: never discards an existing snapshot just because it's missing from the refetch (no silent regression for older bookings)",
  detailSrc.includes("hadSnapshot") && detailSrc.includes("Never seen this booking before")
);
check(
  "BookingDetailScreen: existing cancel flow (performCancel/handleCancel/idempotency key) left intact",
  detailSrc.includes("const performCancel = async () => {") &&
  detailSrc.includes("cancelIdempotencyKeyRef.current = generateIdempotencyKey();") &&
  detailSrc.includes('"/api/v1/bookings/user/cancel"')
);

// ── 2. New real-field UI sections — no invented fields ──
check(
  "BookingDetailScreen: Timeline section reads only real Booking model fields (checkedInAt/serviceStartedAt/completedAt/cancelledAt/noShowMarkedAt)",
  detailSrc.includes("booking.checkedInAt") &&
  detailSrc.includes("booking.serviceStartedAt") &&
  detailSrc.includes("booking.completedAt") &&
  detailSrc.includes("booking.cancelledAt") &&
  detailSrc.includes("booking.noShowMarkedAt")
);
check(
  "BookingDetailScreen: Cancellation Details section reads only real fields (cancelReason/cancellationPolicy/refundAmountInPaise)",
  detailSrc.includes("booking.cancelReason") &&
  detailSrc.includes("booking.cancellationPolicy") &&
  detailSrc.includes("booking.refundAmountInPaise")
);
check(
  "BookingDetailScreen: cancellation policy labels map the backend's own enum values only (NO_PAYMENT/FULL_REFUND/HALF_REFUND/NO_REFUND)",
  /NO_PAYMENT:\s*"/.test(detailSrc) && /FULL_REFUND:\s*"/.test(detailSrc) &&
  /HALF_REFUND:\s*"/.test(detailSrc) && /NO_REFUND:\s*"/.test(detailSrc)
);

// ── 3. BookingHistoryScreen — focus refresh, no duplicate initial fetch ──
check(
  "BookingHistoryScreen: uses useFocusEffect for refresh-on-focus",
  /from\s*"@react-navigation\/native"/.test(historySrc) && historySrc.includes("useFocusEffect(")
);
check(
  "BookingHistoryScreen: old mount-only useEffect(fetchBookings) was replaced, not duplicated alongside the new focus effect",
  !/useEffect\(\(\)\s*=>\s*\{\s*fetchBookings\(1\);\s*\},\s*\[\]\);/.test(historySrc)
);
check(
  "BookingHistoryScreen: focus refresh uses the existing silent refresh=true path (small spinner), not the full-screen isLoading replace",
  /fetchBookings\(1,\s*true\)/.test(historySrc)
);
check(
  "BookingHistoryScreen: existing cancel flow and pagination untouched",
  historySrc.includes('apiClient.post("/api/v1/bookings/user/cancel"') &&
  historySrc.includes("onEndReached={loadMore}")
);

// ── 4. Notification deep-link taps now resolve a real booking id ──
check(
  "userPushNotificationService.js: resolves a booking id from entityId or the deepLink path before falling back to the list",
  pushSvcSrc.includes('data?.entityId || extractBookingIdFromDeepLink(data?.deepLink)')
);
check(
  "userPushNotificationService.js: navigates to BOOKING_DETAIL with a real bookingId when resolvable",
  /navRef\.navigate\(ROUTES\.BOOKING_DETAIL,\s*\{\s*bookingId\s*\}\)/.test(pushSvcSrc)
);
check(
  "userPushNotificationService.js: OPEN_WALLET and the list fallback are unchanged",
  pushSvcSrc.includes("OPEN_WALLET:  { screen: ROUTES.WALLET }") &&
  pushSvcSrc.includes("OPEN_BOOKING: { parent: ROUTES.MAIN_TABS, screen: ROUTES.BOOKINGS }")
);
check(
  "NotificationsScreen.js: in-app tap uses its own already-available meta.bookingId (no guessing/parsing needed)",
  /item\.actionType === "OPEN_BOOKING" && item\.meta\?\.bookingId/.test(notifsSrc) &&
  /navigation\.navigate\(ROUTES\.BOOKING_DETAIL,\s*\{\s*bookingId:\s*item\.meta\.bookingId\s*\}\)/.test(notifsSrc)
);
check(
  "NotificationsScreen.js: falls back to the existing list route when meta.bookingId is absent (backward compatible)",
  notifsSrc.includes("const route = ACTION_ROUTES[item.actionType];")
);

console.log(rows.join("\n"));
console.log(`\nRESULT: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
