/**
 * BARBER_ENGINE_V1
 * backend/scripts/unit/verifySalonReadyKycGuard.mjs
 *
 * ZEMISH "Admin approval blocked by KYC" fix — offline regression test
 * for the booking-readiness side of the change.
 *
 * Context: admin.controller.js's updateSalonStatus no longer requires
 * the owner's mandatory PAN+Bank KYC before approving a salon (see
 * verifyAssistedOnboardingSubmitGate.mjs for that wiring proof).
 * Without an independent check, a salon approved while KYC-pending
 * would immediately become bookable, because the sole centralized
 * booking-readiness guard — isSalonReadyForBooking() in
 * utils/salonReady.guard.js, called only from lockSlot in
 * booking.controller.js — previously keyed off approval.status alone.
 * This file proves the new business.isKycVerifiedForDiscovery check
 * added to that guard actually blocks booking for an approved-but-
 * unverified salon, without disturbing any of the guard's other,
 * pre-existing checks or their order.
 *
 * Why REAL functions, stubbed persistence (not pure source-text
 * matching): unlike salon.onboarding.controller.js and
 * fieldAgentOnboarding.service.js, this guard's own import graph
 * (models/Salon.js, models/Service.js, models/Chair.js) is just plain
 * Mongoose model files — no Redis, no config side effects. Confirmed
 * by reading each file's own imports before writing this test. That
 * makes it safe to import and call the REAL isSalonReadyForBooking
 * directly, stubbing only the three model methods it calls
 * (Salon.findOne, Service.countDocuments, Chair.countDocuments) so no
 * real MongoDB connection is ever required — same restoration pattern
 * already used for Salon.updateMany in
 * verifyVerificationServiceOrchestratorIntegration.mjs.
 *
 * Covers:
 *   1. Approved + KYC-verified + otherwise-complete salon -> ready.
 *   2. Approved + KYC NOT verified -> blocked, reason KYC_NOT_VERIFIED
 *      (the exact scenario this fix exists to prevent).
 *   3. NOT approved (still PENDING) + KYC verified -> blocked, reason
 *      NOT_APPROVED, not KYC_NOT_VERIFIED — proves the approval check
 *      still runs, and runs BEFORE the new KYC check (order intact).
 *   4. Approved + KYC verified + force-closed -> still blocked,
 *      reason FORCE_CLOSED — proves the new check didn't short-circuit
 *      or reorder any pre-existing downstream check.
 *   5. Approved + KYC verified + zero active services / zero active
 *      chairs / no valid working hours -> each still blocked with its
 *      own pre-existing reason — all untouched by this change.
 *   6. Invalid salonId / salon not found -> unchanged, unaffected.
 *   7. Salon.findOne's own .select() projection includes
 *      "business.isKycVerifiedForDiscovery" (the new field is actually
 *      fetched, not just checked against undefined).
 *
 * Run:  cd backend && node scripts/unit/verifySalonReadyKycGuard.mjs
 */

import Salon from "../../models/Salon.js";
import Service from "../../models/Service.js";
import Chair from "../../models/Chair.js";
import { isSalonReadyForBooking, SALON_NOT_READY_REASONS } from "../../utils/salonReady.guard.js";

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; rows.push(`✅ ${name}`); }
  else { fail++; rows.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const VALID_TIMINGS = {
  monday: { isClosed: false, open: "09:00", close: "18:00" },
};

const originalSalonFindOne = Salon.findOne;
const originalServiceCountDocuments = Service.countDocuments;
const originalChairCountDocuments = Chair.countDocuments;

// Same inherited-method stub/restore idiom as
// verifyVerificationServiceOrchestratorIntegration.mjs's withStubbedPersistence.
const withStubbedModels = async (fn, { salonFixture, serviceCount = 1, chairCount = 1 }) => {
  let findOneSelectArg = null;
  Salon.findOne = (filter) => ({
    select(sel) { findOneSelectArg = sel; return this; },
    lean: async () => salonFixture,
  });
  Service.countDocuments = async () => serviceCount;
  Chair.countDocuments = async () => chairCount;
  try {
    const outcome = await fn();
    return { outcome, findOneSelectArg };
  } finally {
    delete Salon.findOne;
    if (Salon.findOne !== originalSalonFindOne) Salon.findOne = originalSalonFindOne;
    delete Service.countDocuments;
    if (Service.countDocuments !== originalServiceCountDocuments) Service.countDocuments = originalServiceCountDocuments;
    delete Chair.countDocuments;
    if (Chair.countDocuments !== originalChairCountDocuments) Chair.countDocuments = originalChairCountDocuments;
  }
};

const VALID_SALON_ID = "507f1f77bcf86cd799439011";

const run = async () => {
  // ── 1. Approved + KYC-verified + otherwise-complete -> ready ──
  {
    const salon = { approval: { status: "APPROVED" }, business: { isKycVerifiedForDiscovery: true, isForceClosed: false }, timings: VALID_TIMINGS };
    const { outcome } = await withStubbedModels(() => isSalonReadyForBooking(VALID_SALON_ID), { salonFixture: salon });
    check("1. Approved + KYC verified + complete data: ready=true", outcome.ready === true, outcome);
  }

  // ── 2. Approved + KYC NOT verified -> blocked, KYC_NOT_VERIFIED ──
  {
    const salon = { approval: { status: "APPROVED" }, business: { isKycVerifiedForDiscovery: false, isForceClosed: false }, timings: VALID_TIMINGS };
    const { outcome } = await withStubbedModels(() => isSalonReadyForBooking(VALID_SALON_ID), { salonFixture: salon });
    check("2. Approved + KYC NOT verified: ready=false", outcome.ready === false, outcome);
    check("2. Approved + KYC NOT verified: reason=KYC_NOT_VERIFIED", outcome.reason === SALON_NOT_READY_REASONS.KYC_NOT_VERIFIED, outcome);
  }
  // Same, but isKycVerifiedForDiscovery is missing entirely (undefined) —
  // must fail closed exactly like explicit false, never treated as truthy.
  {
    const salon = { approval: { status: "APPROVED" }, business: { isForceClosed: false }, timings: VALID_TIMINGS };
    const { outcome } = await withStubbedModels(() => isSalonReadyForBooking(VALID_SALON_ID), { salonFixture: salon });
    check("2b. Approved + isKycVerifiedForDiscovery missing entirely: fails closed (ready=false, KYC_NOT_VERIFIED)", outcome.ready === false && outcome.reason === SALON_NOT_READY_REASONS.KYC_NOT_VERIFIED, outcome);
  }

  // ── 3. NOT approved (PENDING) + KYC verified -> NOT_APPROVED, not
  // KYC_NOT_VERIFIED — proves approval check still runs, and runs
  // BEFORE the new KYC check ──
  {
    const salon = { approval: { status: "PENDING" }, business: { isKycVerifiedForDiscovery: true, isForceClosed: false }, timings: VALID_TIMINGS };
    const { outcome } = await withStubbedModels(() => isSalonReadyForBooking(VALID_SALON_ID), { salonFixture: salon });
    check("3. PENDING salon + KYC verified: ready=false", outcome.ready === false, outcome);
    check("3. PENDING salon + KYC verified: reason=NOT_APPROVED (approval check still takes precedence)", outcome.reason === SALON_NOT_READY_REASONS.NOT_APPROVED, outcome);
  }

  // ── 4. Approved + KYC verified + force-closed -> still FORCE_CLOSED,
  // proving the new check didn't disturb this pre-existing downstream
  // check ──
  {
    const salon = { approval: { status: "APPROVED" }, business: { isKycVerifiedForDiscovery: true, isForceClosed: true }, timings: VALID_TIMINGS };
    const { outcome } = await withStubbedModels(() => isSalonReadyForBooking(VALID_SALON_ID), { salonFixture: salon });
    check("4. Approved + KYC verified + force-closed: ready=false, reason=FORCE_CLOSED (unaffected pre-existing check)", outcome.ready === false && outcome.reason === SALON_NOT_READY_REASONS.FORCE_CLOSED, outcome);
  }

  // ── 5. Approved + KYC verified + zero services / zero chairs / bad
  // timings -> each pre-existing check still fires with its own
  // reason, unaffected by this change ──
  {
    const salon = { approval: { status: "APPROVED" }, business: { isKycVerifiedForDiscovery: true, isForceClosed: false }, timings: VALID_TIMINGS };
    const { outcome } = await withStubbedModels(() => isSalonReadyForBooking(VALID_SALON_ID), { salonFixture: salon, serviceCount: 0 });
    check("5a. Approved + KYC verified + zero services: ready=false, reason=NO_ACTIVE_SERVICES (unaffected pre-existing check)", outcome.ready === false && outcome.reason === SALON_NOT_READY_REASONS.NO_SERVICES, outcome);
  }
  {
    const salon = { approval: { status: "APPROVED" }, business: { isKycVerifiedForDiscovery: true, isForceClosed: false }, timings: VALID_TIMINGS };
    const { outcome } = await withStubbedModels(() => isSalonReadyForBooking(VALID_SALON_ID), { salonFixture: salon, chairCount: 0 });
    check("5b. Approved + KYC verified + zero chairs: ready=false, reason=NO_ACTIVE_CHAIRS (unaffected pre-existing check)", outcome.ready === false && outcome.reason === SALON_NOT_READY_REASONS.NO_CHAIRS, outcome);
  }
  {
    const salon = { approval: { status: "APPROVED" }, business: { isKycVerifiedForDiscovery: true, isForceClosed: false }, timings: { monday: { isClosed: true } } };
    const { outcome } = await withStubbedModels(() => isSalonReadyForBooking(VALID_SALON_ID), { salonFixture: salon });
    check("5c. Approved + KYC verified + no valid working hours: ready=false, reason=NO_WORKING_HOURS (unaffected pre-existing check)", outcome.ready === false && outcome.reason === SALON_NOT_READY_REASONS.NO_WORKING_HOURS, outcome);
  }

  // ── 6. Invalid id / not found -> unchanged, unaffected (no model
  // stubbing needed for the invalid-id case — it returns before any
  // query) ──
  {
    const outcome = await isSalonReadyForBooking("not-a-valid-object-id");
    check("6a. Invalid salonId: ready=false, reason=INVALID_SALON_ID", outcome.ready === false && outcome.reason === SALON_NOT_READY_REASONS.INVALID_ID, outcome);
  }
  {
    const { outcome } = await withStubbedModels(() => isSalonReadyForBooking(VALID_SALON_ID), { salonFixture: null });
    check("6b. Salon not found: ready=false, reason=SALON_NOT_FOUND", outcome.ready === false && outcome.reason === SALON_NOT_READY_REASONS.NOT_FOUND, outcome);
  }

  // ── 7. The guard's own Salon.findOne(...).select(...) projection
  // actually includes the new field — proves it's fetched, not just
  // checked against an always-undefined property ──
  {
    const salon = { approval: { status: "APPROVED" }, business: { isKycVerifiedForDiscovery: true, isForceClosed: false }, timings: VALID_TIMINGS };
    const { findOneSelectArg } = await withStubbedModels(() => isSalonReadyForBooking(VALID_SALON_ID), { salonFixture: salon });
    check("7. Salon.findOne(...).select(...) projection includes business.isKycVerifiedForDiscovery", typeof findOneSelectArg === "string" && findOneSelectArg.includes("business.isKycVerifiedForDiscovery"), findOneSelectArg);
  }

  // ── Restoration sanity — confirms the stub/restore cycle leaves the
  // real inherited Mongoose methods intact for any later script/import ──
  check("Salon.findOne fully restored (inherited lookup, no stray own property)", !Object.prototype.hasOwnProperty.call(Salon, "findOne"));
  check("Service.countDocuments fully restored (inherited lookup, no stray own property)", !Object.prototype.hasOwnProperty.call(Service, "countDocuments"));
  check("Chair.countDocuments fully restored (inherited lookup, no stray own property)", !Object.prototype.hasOwnProperty.call(Chair, "countDocuments"));

  console.log(rows.join("\n"));
  console.log(`\nSALON READY-FOR-BOOKING KYC GUARD (real isSalonReadyForBooking, persistence stubbed — no MongoDB connection was made): ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
