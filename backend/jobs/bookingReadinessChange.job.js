/**
 * ============================================================
 * 🔔 BOOKING READINESS CHANGE JOB (R4 — approved pilot)
 * ============================================================
 *
 * PURPOSE
 * ───────
 * Notifies the Salon Owner (IN_APP + PUSH) when their salon's booking
 * readiness genuinely TRANSITIONS between READY / NEEDS_ATTENTION /
 * NOT_READY, or when the first blocking reason code changes while the
 * status itself stays the same (e.g. NOT_READY for "shop marked
 * closed" becomes NOT_READY for "no active services" after the owner
 * reopens the shop but still has no active service — a genuinely new,
 * actionable fact the owner has not yet been told about).
 *
 * THIS JOB NEVER RECOMPUTES READINESS ITSELF
 * ───────────────────────────────────────────
 * Every verdict comes from calling services/bookingReadiness.service.js
 * ::getBookingReadiness({salonId, date}) completely unmodified — the
 * exact same frozen function controllers/salon.readiness.controller.js
 * already calls for the owner-facing GET endpoint. This file adds no
 * new readiness rule, no new blocking reason, and never alters that
 * function's return value before using it.
 *
 * WHY A PERIODIC JOB, NOT MUTATION HOOKS (approved design, see the
 * read-only audit this phase is based on)
 * ─────────────────────────────────────────
 * At least one real readiness transition — a chair assignment's
 * active time window simply elapsing — has NO corresponding database
 * write at all (confirmed: constants/professionalChairAssignment
 * .constants.js's ASSIGNMENT_STATUS has only ACTIVE/CANCELLED, no
 * EXPIRED; bookingReadiness.service.js detects this purely by
 * comparing `now` against `assignment.endTime` at read time). A
 * mutation-hook approach could never detect that transition no matter
 * how many of the ~9 real owner/admin mutation endpoints it touched.
 * A periodic poll-and-compare catches every transition uniformly,
 * including this one, with zero changes to any existing controller,
 * route, or the readiness engine itself.
 *
 * MULTI-SALON CORRECTNESS (the one thing this job must get right that
 * the existing HTTP readiness/dashboard controllers do NOT)
 * ─────────────────────────────────────────────────────────
 * controllers/salon.readiness.controller.js and
 * controllers/salon.me.controller.js::getDashboardStats both still
 * resolve "which salon" via an unscoped `Salon.findOne({ownerId})` —
 * confirmed, pre-existing, NOT fixed by this phase (out of scope; the
 * frozen readiness controller is untouched). This job must not repeat
 * that gap: it iterates real Salon documents directly by their own
 * `_id` (see buildCandidateSalonQuery below), never by owner lookup,
 * so a multi-salon owner's salons are each evaluated and notified
 * correctly and independently, regardless of that separate, already-
 * known HTTP-endpoint limitation.
 *
 * PERSISTENCE — IN-MEMORY CACHE ONLY, BY EXPLICIT APPROVAL FOR THIS
 * PILOT. READ THIS BEFORE CHANGING THE INTERVAL OR DEPLOYING.
 * ───────────────────────────────────────────────────────────────
 * `lastKnownBySalon` below is a plain in-process Map — NOT persisted
 * to any collection or field (explicitly out of scope for this pilot).
 * Concrete, honest consequences:
 *   - RESTART/DEPLOY: the Map is empty again. The very first tick
 *     after any restart establishes a silent new baseline for every
 *     salon (see checkOneSalon's `previousKey === undefined` branch) —
 *     this is correct behavior (never a notification storm on
 *     restart), but it also means a transition that happened in the
 *     narrow window just before that restart is silently absorbed
 *     into the new baseline and NEVER notified. This is a MISSED
 *     notification risk, not a duplicate one. Not durable, not
 *     exactly-once — this job makes no such guarantee.
 *   - MULTIPLE INSTANCES: verified from this repo — package.json's
 *     start script is a bare `node server.js`; no PM2 ecosystem file,
 *     Dockerfile, docker-compose, or `cluster` module usage exists
 *     anywhere in this repository, and every other existing
 *     background job already relies on this same single-process
 *     setInterval model. NOT verified: the actual replica count of
 *     wherever this backend is actually hosted (a hosting-platform
 *     setting, invisible to this repo). If this backend is EVER run
 *     as 2+ concurrent instances, each would keep its own independent
 *     cache with no cross-instance coordination — each would
 *     separately detect the same real transition and each would
 *     separately send a notification for it, i.e. a DUPLICATE
 *     notification risk with no existing mechanism in this pilot to
 *     prevent it. Re-evaluate before ever scaling this backend
 *     horizontally.
 *   - A persisted field (e.g. a new Salon field or a small dedicated
 *     collection) would remove both risks above but is a real schema
 *     change — deliberately NOT made here; a separate, explicit
 *     approval would be needed first.
 *
 * WHAT THIS JOB DELIBERATELY DOES NOT DO
 * ───────────────────────────────────────
 *   - No new readiness rule, reason code, or status value — only the
 *     3 values getBookingReadiness() already returns are read.
 *   - No change to any existing controller, route, or mutation
 *     endpoint (salon toggle, timings, holiday, services, chairs,
 *     staff status, chair assignments) — this job only READS.
 *   - No schema/index/collection change.
 *   - No batching/pagination — this pilot does one full
 *     Salon.find(...).lean() scan per tick, matching "smallest
 *     reliable" over introducing new complexity; revisit if the
 *     number of approved salons ever makes a full per-tick scan (each
 *     scan item independently re-running the slot engine) too costly.
 *
 * INTEGRATION
 * ───────────
 *   In server.js, alongside the existing jobs:
 *     import { startBookingReadinessChangeJob } from "./jobs/bookingReadinessChange.job.js";
 *     const bookingReadinessChangeJob = startBookingReadinessChangeJob();
 *   In shutdown():
 *     bookingReadinessChangeJob.stop();
 * ============================================================
 */

import Salon from "../models/Salon.js";
import NotificationService from "../services/NotificationService.js";
import { NOTIFICATION_EVENTS } from "../modules/notifications/constants/notificationEvents.constants.js";
import { NOTIFICATION_CHANNEL } from "../constants/notification.constants.js";
import { getBookingReadiness } from "../services/bookingReadiness.service.js";
import { recordStart, recordSuccess, recordFailure } from "./jobHeartbeat.js";

//////////////////////////////////////////////////////////////
// 🔥 CONFIG — same 60s cadence every other job in this codebase
// already uses (serviceOverdue/reminder/slaScanner/autoStart/
// autoComplete), kept for "existing background-job style"
// consistency rather than inventing a different one.
//////////////////////////////////////////////////////////////

const INTERVAL_MS = 60 * 1000;
const JOB_NAME     = "[BookingReadinessChangeJob]";

//////////////////////////////////////////////////////////////
// 🧠 IST DATE — duplicated verbatim from
// bookingReadiness.service.js's own module-private todayIST(),
// matching this codebase's own established per-file-duplication
// convention for exactly this small, stable primitive (see that
// file's own identical comment about parseISTDate/getISTDayName).
// Not imported: todayIST() is not exported there, and this phase
// must not modify that frozen file to export it.
//////////////////////////////////////////////////////////////

const todayIST = () => {
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const y = istNow.getFullYear();
  const m = String(istNow.getMonth() + 1).padStart(2, "0");
  const d = String(istNow.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

//////////////////////////////////////////////////////////////
// 🧠 IN-MEMORY DEDUPLICATION CACHE — see file header for the full,
// honest restart/multi-instance trade-off this pilot accepts.
// Key: String(salonId). Value: "<status>::<reasonCode-or-NONE>".
//////////////////////////////////////////////////////////////

const lastKnownBySalon = new Map();

const buildKey = (status, reasonCode) => `${status}::${reasonCode ?? "NONE"}`;

//////////////////////////////////////////////////////////////
// 🧠 MESSAGE COPY — existing backend data only. READY's message is
// the same static sentence BookingReadinessCard.js's own
// STATUS_META.READY.defaultMessage already shows; NEEDS_ATTENTION/
// NOT_READY use the real blockingReasons[0].humanMessage the engine
// itself produced — never invented, never recomputed here.
//////////////////////////////////////////////////////////////

const STATUS_TITLES = {
  READY:           "Your salon is ready",
  NEEDS_ATTENTION: "Needs attention",
  NOT_READY:       "Booking not ready",
};

const buildMessage = (readiness) => {
  if (readiness.status === "READY") {
    return "Your salon is ready to accept bookings.";
  }
  // Defensive fallback only — getBookingReadiness() always pushes at
  // least one blockingReasons entry for a non-READY status (confirmed
  // by reading every return path in that function); this never
  // fabricates a reason if that contract were ever violated.
  return readiness.blockingReasons?.[0]?.humanMessage
    || "Your salon's booking readiness needs attention.";
};

//////////////////////////////////////////////////////////////
// 🔍 CANDIDATE SALONS — explicit _id iteration, never
// Salon.findOne({ownerId}). Mirrors the exact filter
// bookingReadiness.service.js's own resolveDayReadiness already
// applies first (SALON_NOT_APPROVED is its own blocking reason) —
// only approved, non-deleted salons are worth polling at all; an
// unapproved salon would always just report NOT_READY/
// SALON_NOT_APPROVED on every tick with nothing for the owner to do
// about it via this feature.
//////////////////////////////////////////////////////////////

const buildCandidateSalonQuery = () => ({
  "approval.status": "APPROVED",
  isDeleted:          { $ne: true },
});

//////////////////////////////////////////////////////////////
// 🔐 CHECK ONE SALON — never throws; a failure here is caught by the
// caller so one salon's problem can never stop the rest of the scan.
//////////////////////////////////////////////////////////////

const checkOneSalon = async (salon) => {
  const salonId = String(salon._id);
  const date    = todayIST();

  const readiness = await getBookingReadiness({ salonId: salon._id, date });

  const reasonCode   = readiness.blockingReasons?.[0]?.code ?? null;
  const currentKey   = buildKey(readiness.status, reasonCode);
  const previousKey  = lastKnownBySalon.get(salonId);

  lastKnownBySalon.set(salonId, currentKey);

  if (previousKey === undefined) {
    // First time this job has seen this salon since it (re)started —
    // establish a silent baseline. Never notify on first sight.
    return { outcome: "baseline" };
  }

  if (previousKey === currentKey) {
    // Same status AND same first blocking reason code — genuinely
    // unchanged, never re-notify.
    return { outcome: "unchanged" };
  }

  // Genuine transition (status changed, or the same status now has a
  // different first blocking reason) — notify the owner.
  await NotificationService.send({
    recipientId:   salon._id,
    recipientType: "SALON",
    templateKey:   NOTIFICATION_EVENTS.BOOKING_READINESS_CHANGED,
    title:         STATUS_TITLES[readiness.status] || "Booking readiness updated",
    message:       buildMessage(readiness),
    type:          "SYSTEM",
    priority:      readiness.status === "READY" ? "MEDIUM" : "HIGH",
    actionType:    "OPEN_HOME",
    actionUrl:     "/dashboard",
    entityType:    "SALON",
    entityId:      salon._id,
    meta:          { salonId: salon._id, status: readiness.status, reasonCode },
  }, [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH]);

  return { outcome: "notified", from: previousKey, to: currentKey };
};

//////////////////////////////////////////////////////////////
// 🚀 MAIN JOB RUNNER
//////////////////////////////////////////////////////////////

let isRunning = false;

const runBookingReadinessChangeJob = async () => {
  if (isRunning) {
    console.warn(`${JOB_NAME} Previous run still in progress — skipping this tick`);
    return;
  }

  isRunning = true;

  let checked = 0;
  let notified = 0;
  let errors = 0;

  try {
    recordStart(JOB_NAME, { intervalMs: INTERVAL_MS });

    const salons = await Salon.find(buildCandidateSalonQuery())
      .select("_id")
      .lean();

    for (const salon of salons) {
      checked++;
      try {
        const result = await checkOneSalon(salon);
        if (result.outcome === "notified") notified++;
      } catch (err) {
        errors++;
        console.error(`${JOB_NAME} Failed to check salon ${salon._id}:`, err.message);
        // Deliberately does NOT re-throw and does NOT update
        // lastKnownBySalon for this salon — a transient failure
        // leaves its prior known key in place, so the next tick
        // compares against the last GOOD verdict, not a guess.
      }
    }

    if (notified > 0 || errors > 0) {
      console.info(
        `${JOB_NAME} Run complete — checked: ${checked} | notified: ${notified} | errors: ${errors}`
      );
    }
    recordSuccess(JOB_NAME);
  } catch (err) {
    console.error(`${JOB_NAME} Query failed:`, err.message);
    recordFailure(JOB_NAME, err);
  } finally {
    isRunning = false;
  }
};

//////////////////////////////////////////////////////////////
// 🚀 EXPORTED STARTER
//////////////////////////////////////////////////////////////

export const startBookingReadinessChangeJob = () => {
  runBookingReadinessChangeJob();

  const intervalHandle = setInterval(runBookingReadinessChangeJob, INTERVAL_MS);

  console.info(`${JOB_NAME} Started — interval: ${INTERVAL_MS / 1000}s`);

  return {
    stop: () => {
      clearInterval(intervalHandle);
      console.info(`${JOB_NAME} Stopped`);
    },
  };
};
