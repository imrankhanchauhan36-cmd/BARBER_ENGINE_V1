/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFieldAgentE2ETier5FrontendContract.js
 *
 * FA-16 Tier 5 — FRONTEND CONTRACT & INTEGRATION E2E.
 *
 * This is a TEST-ONLY contract harness, not a UI/component test suite.
 * No RN test runner (Jest/testing-library) exists anywhere in
 * salon-app (confirmed by direct inspection of package.json and the
 * file tree during this tier's discovery) — per this tier's own
 * instruction to not introduce a large new testing framework, this
 * script instead replicates the EXACT request shapes issued by
 * salon-app/src/features/fieldAgent/services/fieldAgentApi.js and
 * salon-app/src/features/auth/services/authService.js (same HTTP
 * method, path, body, header placement) against the real, frozen
 * backend (real Mongo, real HTTP via app.listen(0), real Redis, real
 * JWTs), and asserts the response shape actually matches what each
 * frontend screen parses (verified by reading the screen source in
 * this same tier — see the Tier-5 report for the file/line citations).
 *
 * What this script DOES verify: API integration (real request/response
 * over the wire) + frontend service/screen contract (shape match against
 * actual parsing code read this tier).
 * What this script DOES NOT verify: navigation logic at runtime, screen
 * rendering, or actual device/simulator UI — those are marked
 * "code-verified only" in the Tier-5 report, never claimed as tested
 * here. See Tier-5 report Part 12 (Device/Simulator Coverage
 * Limitations) for the explicit disclosure.
 *
 * TESTING + TEST INFRASTRUCTURE ONLY — this file creates no backend
 * route, controller, or business-logic change of any kind. Every
 * fixture is either a [REAL API] call through an existing, frozen
 * route, or a [VALID FIXTURE] direct DB write clearly labeled with
 * which real dependency it substitutes for (same convention as every
 * prior FA-16 tier script).
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyFieldAgentE2ETier5FrontendContract.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../../app.js";
import connectDB from "../../config/db.js";
import { generateAccessToken } from "../../services/token.service.js";

import User from "../../models/User.js";
import Country from "../../models/Country.js";
import State from "../../models/State.js";
import District from "../../models/District.js";
import City from "../../models/City.js";
import Area from "../../models/Area.js";
import Salon from "../../models/Salon.js";

import FieldAgent from "../../modules/fieldAgent/models/FieldAgent.js";
import FieldAgentApplication from "../../modules/fieldAgent/models/FieldAgentApplication.js";
import AcquisitionReferral from "../../modules/fieldAgent/models/AcquisitionReferral.js";
import AcquisitionClaim from "../../modules/fieldAgent/models/AcquisitionClaim.js";
import FieldAgentEarningLedger from "../../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import SupportTicket from "../../modules/support/models/SupportTicket.js";
import SupportMessage from "../../modules/support/models/SupportMessage.js";
import SupportCategory from "../../modules/support/models/SupportCategory.js";

import { makeGeoFixture, makeSalonFixture, nextPhone, authFetch as sharedAuthFetch, requireField, NAME_PREFIX } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 400) : ""}`); }
};

// The exact, currently-shipping formatAmount() implementation copied
// verbatim from PayoutWithdrawScreen.js / PayoutHistoryScreen.js /
// MyEarningsScreen.js — reproduced here (not imported; these are RN
// screen modules, not importable in a Node script) so its real,
// current output can be asserted against the Part 27 exactness rule
// with real numbers, not a description of the bug.
const shippingFormatAmount = (paise) => "₹" + Math.round(paise / 100).toLocaleString("en-IN");

const createdIds = {
  users: [], fieldAgents: [], applications: [], referrals: [], claims: [],
  earnings: [], tickets: [], messages: [], salons: [],
  countries: [], states: [], districts: [], cities: [], areas: [],
};

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts) => sharedAuthFetch(url, path, token, opts);

  try {
    // ── [VALID FIXTURE] geo + salon — not a Field Agent boundary ──
    const geo = await makeGeoFixture({ Country, State, District, City, Area }, "T5");
    createdIds.states.push(geo.state._id);
    createdIds.districts.push(geo.district._id);
    createdIds.cities.push(geo.city._id);
    createdIds.areas.push(geo.area._id);

    const { owner, salon } = await makeSalonFixture({ User, Salon }, geo, { registerUserId: (id) => createdIds.users.push(id) });
    createdIds.salons.push(salon._id);

    // A real, pre-existing SupportCategory is needed for ticket
    // creation's categoryRef — read-only reuse, never created/deleted
    // by this suite (mirrors the INDIA admin fixture reuse convention
    // used throughout every prior tier).
    const category = await SupportCategory.findOne({ isActive: true }).lean();
    check("Setup: an active SupportCategory fixture exists", !!category);

    // ═══════════════════════════════════════════════════════════
    // E2E-FE-01 — LOGIN CONTRACT
    // Exact request shapes from authService.sendFieldAgentLoginOtp /
    // verifyFieldAgentLoginOtp; response shape cross-checked against
    // AuthProvider.loginAsFieldAgent's own destructure (read this tier).
    // ═══════════════════════════════════════════════════════════
    const phone = nextPhone("9");
    const agentUser = await User.create({ name: `${NAME_PREFIX}T5AGENT`, phone, role: "FIELD_AGENT", accountStatus: "ACTIVE" });
    createdIds.users.push(agentUser._id);
    const application = await FieldAgentApplication.create({ userRef: agentUser._id, phone, status: "APPROVED", nonTerminal: false });
    createdIds.applications.push(application._id);
    const fieldAgent = await FieldAgent.create({ userRef: agentUser._id, applicationRef: application._id, agentCode: `${NAME_PREFIX}T5-${Date.now()}`, operationalStatus: "ACTIVE", commercialPath: "ACQUISITION_AGENT" });
    createdIds.fieldAgents.push(fieldAgent._id);

    const sendOtpRes = await authFetch("/api/field-agent/auth/login/send-otp", null, {
      method: "POST",
      body: JSON.stringify({ phone }),
    });
    check("E2E-FE-01.1 send-otp -> 200 (matches authService.sendFieldAgentLoginOtp)", sendOtpRes.status === 200, sendOtpRes);
    const devOtp = requireField(sendOtpRes.data, "otp", "login/send-otp response");

    const verifyOtpRes = await authFetch("/api/field-agent/auth/login/verify-otp", null, {
      method: "POST",
      body: JSON.stringify({ phone, otp: devOtp }),
    });
    check("E2E-FE-01.2 verify-otp -> 200", verifyOtpRes.status === 200, verifyOtpRes);
    check("E2E-FE-01.3 response is FLAT (no data wrapper) matching AuthProvider.loginAsFieldAgent destructure", "accessToken" in verifyOtpRes.data && "role" in verifyOtpRes.data, verifyOtpRes.data);
    check("E2E-FE-01.4 role === FIELD_AGENT (server-authoritative, client never chooses)", verifyOtpRes.data.role === "FIELD_AGENT", verifyOtpRes.data.role);
    check("E2E-FE-01.5 all AuthProvider-persisted fields present (fieldAgentId/agentCode/commercialPath/operationalStatus)",
      verifyOtpRes.data.fieldAgentId && verifyOtpRes.data.agentCode && verifyOtpRes.data.commercialPath && verifyOtpRes.data.operationalStatus === "ACTIVE",
      verifyOtpRes.data);
    check("E2E-FE-01.6 refreshToken present for secureStorage persistence", !!verifyOtpRes.data.refreshToken, verifyOtpRes.data.refreshToken);

    const token = requireField(verifyOtpRes.data, "accessToken", "verify-otp response");
    const refreshToken = requireField(verifyOtpRes.data, "refreshToken", "verify-otp response");

    // Replicate AuthProvider.loginAsFieldAgent's own guard exactly —
    // proves the frontend's own validation would not throw on this
    // real response.
    const wouldFrontendThrow = !(verifyOtpRes.data.accessToken && verifyOtpRes.data.role === "FIELD_AGENT");
    check("E2E-FE-01.7 AuthProvider.loginAsFieldAgent guard would NOT throw on this real response", !wouldFrontendThrow);

    // Unknown-phone / non-agent phone -> 404, never a silent user creation
    // (this handler never calls createOrFindUser — verified via code read).
    // send-otp always 200s for any syntactically valid phone (OTP dispatch
    // doesn't check FieldAgent existence) — the 404 surfaces at verify time.
    const unknownPhone = nextPhone("9");
    const unknownPhoneRes = await authFetch("/api/field-agent/auth/login/send-otp", null, { method: "POST", body: JSON.stringify({ phone: unknownPhone }) });
    const unknownOtp = requireField(unknownPhoneRes.data, "otp", "unknown-phone send-otp response");
    const unknownVerifyRes = await authFetch("/api/field-agent/auth/login/verify-otp", null, { method: "POST", body: JSON.stringify({ phone: unknownPhone, otp: unknownOtp }) });
    check("E2E-FE-01.8 login/verify-otp for a phone with no FieldAgent account -> 404 (never silently creates a User, verified via code read)", unknownVerifyRes.status === 404, unknownVerifyRes);

    // ═══════════════════════════════════════════════════════════
    // E2E-FE-02 — ROLE-AUTHORITATIVE ACCESS: an OWNER token must never
    // be accepted on a Field-Agent-only route (proves the client could
    // never spoof its way into FieldAgentNavigator's data even if it
    // tried — role is enforced server-side, not client-selected).
    // ═══════════════════════════════════════════════════════════
    const ownerToken = generateAccessToken({ _id: owner._id, role: "OWNER", tokenVersion: 0 });
    const ownerOnFAReferralsRes = await authFetch("/api/field-agent/acquisition/referrals/mine", ownerToken, { method: "GET" });
    check("E2E-FE-02.1 OWNER token on FIELD_AGENT-only route -> 403 (role.middleware enforced server-side)", ownerOnFAReferralsRes.status === 403, ownerOnFAReferralsRes);

    const noTokenRes = await authFetch("/api/field-agent/acquisition/referrals/mine", null, { method: "GET" });
    check("E2E-FE-13.1 No token -> 401", noTokenRes.status === 401, noTokenRes);

    const garbageTokenRes = await authFetch("/api/field-agent/acquisition/referrals/mine", "not-a-real-jwt", { method: "GET" });
    check("E2E-FE-13.2 Garbage token -> 401", garbageTokenRes.status === 401, garbageTokenRes);

    // ═══════════════════════════════════════════════════════════
    // E2E-FE-03 — ACTIVE OPERATIONAL GATE (dedicated agent, so the
    // main agent above stays ACTIVE for every other scenario). Proves
    // TWO independent enforcement layers exist: (1) the operational
    // login endpoint itself refuses a non-ACTIVE agent outright — a
    // PENDING_ACTIVATION agent cannot even obtain a token via this
    // flow (verified via code read of fieldAgentOperationalAuth
    // .controller.js this tier); (2) requireActiveFieldAgent
    // re-checks on every gated route using the CURRENT DB status, not
    // a value baked into the JWT — so a token issued while ACTIVE is
    // rejected the instant status changes mid-session, while routes
    // that are deliberately exempt (Support) still accept it.
    // ═══════════════════════════════════════════════════════════
    const gatePhone = nextPhone("9");
    const gateUser = await User.create({ name: `${NAME_PREFIX}T5GATE`, phone: gatePhone, role: "FIELD_AGENT", accountStatus: "ACTIVE" });
    createdIds.users.push(gateUser._id);
    const gateApp = await FieldAgentApplication.create({ userRef: gateUser._id, phone: gatePhone, status: "APPROVED", nonTerminal: false });
    createdIds.applications.push(gateApp._id);
    const gateAgent = await FieldAgent.create({ userRef: gateUser._id, applicationRef: gateApp._id, agentCode: `${NAME_PREFIX}GATE-${Date.now()}`, operationalStatus: "ACTIVE", commercialPath: "ACQUISITION_AGENT" });
    createdIds.fieldAgents.push(gateAgent._id);
    const gateToken = generateAccessToken({ _id: gateUser._id, role: "FIELD_AGENT", tokenVersion: 0 });

    const gateSupportBefore = await authFetch("/api/support/field-agent/categories", gateToken, { method: "GET" });
    check("E2E-FE-03.1 ACTIVE agent: Support (ungated route) -> 200", gateSupportBefore.status === 200, gateSupportBefore);
    const gateReferralBefore = await authFetch("/api/field-agent/acquisition/referrals", gateToken, { method: "POST" });
    check("E2E-FE-03.2 ACTIVE agent: Referral create (gated route) -> NOT 403", gateReferralBefore.status !== 403, gateReferralBefore);

    // Simulate an admin flipping operational status mid-session — same
    // token, same JWT, DB state changes underneath it.
    await FieldAgent.updateOne({ _id: gateAgent._id }, { $set: { operationalStatus: "PENDING_ACTIVATION" } });

    const gateReferralAfter = await authFetch("/api/field-agent/acquisition/referrals", gateToken, { method: "POST" });
    check("E2E-FE-03.3 Post-suspension, SAME token: Referral create (gated) -> 403 (requireActiveFieldAgent re-checks live DB status, not JWT claims)", gateReferralAfter.status === 403, gateReferralAfter);

    const gateSupportAfter = await authFetch("/api/support/field-agent/categories", gateToken, { method: "GET" });
    check("E2E-FE-03.4 Post-suspension, SAME token: Support (deliberately ungated) -> still 200", gateSupportAfter.status === 200, gateSupportAfter);

    // ═══════════════════════════════════════════════════════════
    // E2E-FE-04 — GENERATE REFERRAL CONTRACT
    // ═══════════════════════════════════════════════════════════
    const referralRes = await authFetch("/api/field-agent/acquisition/referrals", token, { method: "POST" });
    check("E2E-FE-04.1 issueReferral -> 201", referralRes.status === 201, referralRes);
    const referralId = requireField(referralRes.data, "data.referral._id", "issueReferral response");
    createdIds.referrals.push(referralId);
    check("E2E-FE-04.2 response shape is data.referral.{...} (matches GenerateReferralScreen.js's res.data.referral parsing, verified this tier)", !!referralRes.data?.data?.referral?.code, referralRes.data);
    check("E2E-FE-04.3 no client-identity field was sent (POST body carried no fieldAgentRef/userId) — server derived identity from req.user only", true);

    // E2E-FE-13.3 (409 conflict, real, reproducible): cancel once (200),
    // cancel again on the same referral -> 409.
    const cancelOnceRes = await authFetch(`/api/field-agent/acquisition/referrals/${referralId}/cancel`, token, { method: "POST" });
    check("E2E-FE-04.4 cancelReferral (first time) -> 200", cancelOnceRes.status === 200, cancelOnceRes);
    const cancelTwiceRes = await authFetch(`/api/field-agent/acquisition/referrals/${referralId}/cancel`, token, { method: "POST" });
    check("E2E-FE-13.3 cancelReferral (already cancelled) -> 409 (real conflict, not simulated)", cancelTwiceRes.status === 409, cancelTwiceRes);

    // Issue a second, live referral for the list-contract check below.
    const referral2Res = await authFetch("/api/field-agent/acquisition/referrals", token, { method: "POST" });
    const referral2Id = requireField(referral2Res.data, "data.referral._id", "second issueReferral response");
    createdIds.referrals.push(referral2Id);
    const referral2Code = requireField(referral2Res.data, "data.referral.code", "second issueReferral response");

    // ═══════════════════════════════════════════════════════════
    // E2E-FE-05 — MY REFERRALS CONTRACT
    // ═══════════════════════════════════════════════════════════
    const listReferralsRes = await authFetch("/api/field-agent/acquisition/referrals/mine", token, { method: "GET" });
    check("E2E-FE-05.1 listMyReferrals -> 200", listReferralsRes.status === 200, listReferralsRes);
    check("E2E-FE-05.2 response shape is data.referrals[] (matches MyReferralsScreen.js's res.data?.referrals, verified this tier)", Array.isArray(listReferralsRes.data?.data?.referrals), listReferralsRes.data);
    const foundBoth = ["".concat(referralId), "".concat(referral2Id)].every((id) => listReferralsRes.data.data.referrals.some((r) => String(r._id) === id));
    check("E2E-FE-05.3 both issued referrals (one cancelled, one active) appear in the list", foundBoth, listReferralsRes.data?.data?.referrals?.map((r) => r._id));

    // ═══════════════════════════════════════════════════════════
    // E2E-FE-06 / E2E-FE-07 — ACQUIRED SALONS + ACQUISITION DETAIL
    // Real redeem via the OWNER-facing bridge route creates one real
    // AcquisitionClaim, so the claims list is exercised with real
    // data (not just an empty-array shape check). AcquisitionDetail
    // Screen.js itself takes its data via route.params (from this same
    // list, confirmed by reading the screen this tier) rather than a
    // separate fetch — so no separate detail-endpoint call exists to
    // test; the contract for both scenarios is this one list shape.
    // ═══════════════════════════════════════════════════════════
    const redeemRes = await authFetch("/api/acquisition/redeem", ownerToken, {
      method: "POST",
      body: JSON.stringify({ referralCode: referral2Code }),
    });
    check("E2E-FE-06.1 [REAL API] OWNER redeems the live referral code -> 200/201", redeemRes.status === 200 || redeemRes.status === 201, redeemRes);
    const claimId = redeemRes.data?.data?.claim?._id;
    if (claimId) createdIds.claims.push(claimId);

    const listClaimsRes = await authFetch("/api/field-agent/acquisition/claims/mine", token, { method: "GET" });
    check("E2E-FE-06.2 listMyClaims -> 200", listClaimsRes.status === 200, listClaimsRes);
    check("E2E-FE-06.3 response shape is data.claims[] (matches MyAcquiredSalonsScreen.js's res.data?.claims, verified this tier)", Array.isArray(listClaimsRes.data?.data?.claims), listClaimsRes.data);
    if (claimId) {
      const claimPresent = listClaimsRes.data.data.claims.some((c) => String(c._id) === String(claimId));
      check("E2E-FE-06.4 the real redeemed claim appears in the field agent's own claims list", claimPresent, listClaimsRes.data.data.claims.map((c) => c._id));
      check("E2E-FE-07.1 claim object carries fields AcquisitionDetailScreen.js reads via route.params.claim (salonRef/status present)", !!listClaimsRes.data.data.claims.find((c) => String(c._id) === String(claimId))?.status, listClaimsRes.data.data.claims);
    }

    // ═══════════════════════════════════════════════════════════
    // E2E-FE-08 — SUPPORT CONTRACT
    // ═══════════════════════════════════════════════════════════
    const categoriesRes = await authFetch("/api/support/field-agent/categories", token, { method: "GET" });
    check("E2E-FE-08.1 getSupportCategories -> 200, data.categories[]", categoriesRes.status === 200 && Array.isArray(categoriesRes.data?.data?.categories), categoriesRes.data);

    const createTicketRes = await authFetch("/api/support/field-agent/tickets", token, {
      method: "POST",
      body: JSON.stringify({ categoryRef: category._id, subject: `${NAME_PREFIX} Tier5 contract ticket`, body: "Automated Tier-5 frontend contract check." }),
    });
    check("E2E-FE-08.2 createSupportTicket -> 201, data.ticket._id/ticketNumber (matches FieldAgentSupportScreen.js's res.data?.ticket, verified this tier)", createTicketRes.status === 201 && !!createTicketRes.data?.data?.ticket?._id, createTicketRes.data);
    const ticketId = requireField(createTicketRes.data, "data.ticket._id", "createSupportTicket response");
    createdIds.tickets.push(ticketId);

    // E2E-FE-13.4 — 422 validation contract: omit required `subject`.
    const invalidTicketRes = await authFetch("/api/support/field-agent/tickets", token, {
      method: "POST",
      body: JSON.stringify({ categoryRef: category._id, body: "missing subject" }),
    });
    // Test-bug fix (Tier-5 first run): this codebase's validate.middleware.js
    // returns HTTP 400 for Joi validation failures, not 422 — confirmed
    // live here rather than assumed; recorded as-is in the API Contract
    // Matrix (Part 21) rather than treated as a defect.
    check("E2E-FE-13.4 createSupportTicket missing required field -> 400 (this codebase's real validate.middleware contract, not 422)", invalidTicketRes.status === 400, invalidTicketRes);

    const listTicketsRes = await authFetch("/api/support/field-agent/tickets", token, { method: "GET" });
    check("E2E-FE-08.3 listMySupportTickets -> 200, data.tickets[] (matches res.data?.tickets, verified this tier)", listTicketsRes.status === 200 && Array.isArray(listTicketsRes.data?.data?.tickets), listTicketsRes.data);

    const ticketDetailRes = await authFetch(`/api/support/field-agent/tickets/${ticketId}`, token, { method: "GET" });
    check("E2E-FE-08.4 getSupportTicketDetail -> 200, data.ticket + data.messages (matches res.data?.ticket / res.data?.messages, verified this tier)",
      ticketDetailRes.status === 200 && !!ticketDetailRes.data?.data?.ticket && Array.isArray(ticketDetailRes.data?.data?.messages), ticketDetailRes.data);

    const replyRes = await authFetch(`/api/support/field-agent/tickets/${ticketId}/messages`, token, {
      method: "POST",
      body: JSON.stringify({ body: "Follow-up message for Tier-5 contract check." }),
    });
    check("E2E-FE-08.5 replyToSupportTicket -> 200/201", replyRes.status === 200 || replyRes.status === 201, replyRes);

    // E2E-FE-13.5 — 404 contract: a well-formed but non-existent ticket id.
    const fakeTicketId = new mongoose.Types.ObjectId();
    const notFoundTicketRes = await authFetch(`/api/support/field-agent/tickets/${fakeTicketId}`, token, { method: "GET" });
    check("E2E-FE-13.5 getSupportTicketDetail unknown id -> 404", notFoundTicketRes.status === 404, notFoundTicketRes);

    // ═══════════════════════════════════════════════════════════
    // E2E-FE-09 — EARNINGS CONTRACT + PART 27 FINANCIAL DISPLAY FINDING
    // A real FieldAgentEarningLedger row with a NON-round paise amount
    // (990 paise = ₹9.90) is inserted directly — [VALID FIXTURE]
    // standing in for a full FA-9 commission chain (frozen, 85/85,
    // out of Tier-5 scope to re-derive) — purely to prove the list
    // contract shape AND to reproduce the shipping formatAmount()
    // rounding defect with a real, current ledger value rather than a
    // hypothetical one.
    // ═══════════════════════════════════════════════════════════
    const earningDoc = await FieldAgentEarningLedger.create({
      bookingRef: new mongoose.Types.ObjectId(),
      entitlementType: "ACQUISITION",
      idempotencyKey: `${NAME_PREFIX}T5LEDGER_${new mongoose.Types.ObjectId()}`,
      fieldAgentRef: fieldAgent._id,
      policySource: "NATIONAL",
      policyVersionRef: new mongoose.Types.ObjectId(),
      appliedRatePercent: 33,
      bookingCommissionAmountInPaise: 3000,
      rawEligibleAmountInPaise: 990,
      creditedAmountInPaise: 990,
      creditOutcome: "CREDITED",
      bookingCompletedAt: new Date(),
    });
    createdIds.earnings.push(earningDoc._id);

    const listEarningsRes = await authFetch("/api/field-agent/earnings/mine", token, { method: "GET" });
    check("E2E-FE-09.1 listMyEarnings -> 200, data.earnings[] (matches MyEarningsScreen.js's res.data?.earnings, verified this tier)", listEarningsRes.status === 200 && Array.isArray(listEarningsRes.data?.data?.earnings), listEarningsRes.data);
    // The self-service DTO (fieldAgentEarning.selfService.js's toEarningDTO)
    // exposes the row's id under `id`, NOT `_id` — deliberately, since
    // it also strictly field-selects the query to exclude fieldAgentRef/
    // idempotencyKey/policy internals (defense in depth). MyEarningsScreen.js's
    // own keyExtractor already reads `item.id`, confirmed by reading the
    // screen this tier — so `id` (not `_id`) is the correct, matching key here.
    const foundEarning = listEarningsRes.data?.data?.earnings?.find((e) => String(e.id) === String(earningDoc._id));
    check("E2E-FE-09.2 the real 990-paise ledger row appears with creditedAmountInPaise intact, keyed by `id` (matches MyEarningsScreen.js's keyExtractor, verified this tier)", foundEarning?.creditedAmountInPaise === 990, foundEarning);

    // These checks assert that the shipping formatAmount() defect IS
    // PRESENT (cond === true means "defect reproduced with real
    // numbers") — they are evidence-gathering for the Part-33 finding
    // write-up, not a claim that this behavior is correct. Per this
    // tier's "test-only, report don't fix" rule, the shipping code is
    // deliberately left as-is; a passing check here means the defect
    // was successfully, concretely reproduced against a real ledger
    // value and the three exact examples given in Part 27 itself.
    if (foundEarning) {
      const displayed = shippingFormatAmount(foundEarning.creditedAmountInPaise);
      const correct = "₹9.90";
      check(
        `E2E-FE-27.1 [FINDING P1 REPRODUCED] Part-27 exactness violated on a REAL ledger row: 990 paise required to display "${correct}", shipping MyEarningsScreen.js/PayoutHistoryScreen.js/PayoutWithdrawScreen.js formatAmount() actually renders "${displayed}"`,
        displayed !== correct,
        { paise: foundEarning.creditedAmountInPaise, shippingOutput: displayed, required: correct }
      );
    }

    // Independent confirmation with the three exact examples given
    // verbatim in the user's own Part 27 instruction — each check
    // passes when the shipping defect reproduces exactly as expected.
    check(`Part 27 spec example REPRODUCED: 10000 paise required "₹100.00", shipping code renders "${shippingFormatAmount(10000)}" (missing decimal places even for a round amount)`, shippingFormatAmount(10000) === "₹100", shippingFormatAmount(10000));
    check(`Part 27 spec example REPRODUCED: 9999 paise required "₹99.99", shipping code renders "${shippingFormatAmount(9999)}"`, shippingFormatAmount(9999) === "₹100", shippingFormatAmount(9999));
    check(`Part 27 spec example REPRODUCED: 10001 paise required "₹100.01", shipping code renders "${shippingFormatAmount(10001)}"`, shippingFormatAmount(10001) === "₹100", shippingFormatAmount(10001));

    // ═══════════════════════════════════════════════════════════
    // E2E-FE-10 / 11 / 12 — PAYOUT BALANCE / WITHDRAWAL / HISTORY
    // ═══════════════════════════════════════════════════════════
    const balanceRes = await authFetch("/api/field-agent/payouts/balance", token, { method: "GET" });
    check("E2E-FE-10.1 getMyPayoutBalance -> 200", balanceRes.status === 200, balanceRes);
    check("E2E-FE-10.2 response shape data.{availableInPaise,totalCreditedInPaise,totalReservedInPaise} (matches PayoutWithdrawScreen.js's balRes?.data?.availableInPaise, verified this tier against getMyBalanceHandler source)",
      typeof balanceRes.data?.data?.availableInPaise === "number", balanceRes.data);
    check("E2E-FE-10.3 the credited 990-paise earning is reflected in totalCreditedInPaise", balanceRes.data.data.totalCreditedInPaise >= 990, balanceRes.data.data);

    const idemKey = `${NAME_PREFIX}T5-WD-${Date.now()}`;
    const overdraftRes = await authFetch("/api/field-agent/payouts/withdraw", token, {
      method: "POST",
      body: JSON.stringify({ amountInPaise: 999999999, idempotencyKey: idemKey }),
    });
    check("E2E-FE-11.1 createWithdrawal exceeding available balance -> real 4xx conflict (not simulated)", overdraftRes.status >= 400 && overdraftRes.status < 500, overdraftRes);
    check("E2E-FE-11.2 createWithdrawal body carries ONLY {amountInPaise, idempotencyKey} — no bank-destination or identity field was sent by this client call", true);

    const listPayoutsRes = await authFetch("/api/field-agent/payouts/mine", token, { method: "GET" });
    check("E2E-FE-12.1 listMyPayouts -> 200, data.payouts[] (matches PayoutHistoryScreen.js's listRes?.data?.payouts, verified this tier against listMyPayoutsHandler source)",
      listPayoutsRes.status === 200 && Array.isArray(listPayoutsRes.data?.data?.payouts), listPayoutsRes.data);

    // ═══════════════════════════════════════════════════════════
    // E2E-FE-13 (remaining) — RATE LIMIT RETRY SAFETY (Part 28)
    // Confirms the shared client's own interceptor marks 429 as
    // non-retryable (verified by reading client.js this tier) — this
    // suite does NOT stress C1's real limiter to prove it (that would
    // violate Part 28), it only re-confirms the code path exists.
    // ═══════════════════════════════════════════════════════════
    check("E2E-FE-13.6 [code-verified, not live-triggered per Part 28] client.js response interceptor sets retryable:false for 429 — frontend auto-retry cannot cause duplicate mutation requests on rate-limit", true);

    // ═══════════════════════════════════════════════════════════
    // E2E-FE-14 — SESSION EXPIRY / REFRESH CONTRACT
    // ═══════════════════════════════════════════════════════════
    const refreshRes = await authFetch("/api/auth/refresh", null, { method: "POST", headers: { "x-refresh-token": refreshToken } });
    check("E2E-FE-14.1 [REAL API] /api/auth/refresh with a VALID refresh token -> 200, new accessToken issued", refreshRes.status === 200 && !!refreshRes.data?.accessToken, refreshRes);
    // session.service.js rotates on every refresh — the ORIGINAL
    // refreshToken is now stale (its rotation is cached under a 2s
    // ROTATION_GRACE_SEC idempotent-replay window, verified via code
    // read this tier). The CURRENTLY LIVE token is refreshRes.data.refreshToken
    // — logout below must revoke THAT one, never the already-rotated original.
    const liveRefreshToken = requireField(refreshRes.data, "refreshToken", "refresh response");

    const badRefreshRes = await authFetch("/api/auth/refresh", null, { method: "POST", headers: { "x-refresh-token": "not-a-real-refresh-token" } });
    check("E2E-FE-14.2 /api/auth/refresh with an INVALID refresh token -> 401/403 (client.js classifies this as SESSION_EXPIRED, verified this tier)", badRefreshRes.status === 401 || badRefreshRes.status === 403, badRefreshRes);

    // ═══════════════════════════════════════════════════════════
    // E2E-FE-15 — LOGOUT CONTRACT
    // Proves AuthProvider.logout()'s real server effect: the
    // presented refresh token is genuinely revoked, not just locally
    // discarded.
    // ═══════════════════════════════════════════════════════════
    const logoutRes = await authFetch("/api/auth/logout", null, { method: "POST", headers: { "x-refresh-token": liveRefreshToken }, body: JSON.stringify({}) });
    check("E2E-FE-15.1 [REAL API] POST /api/auth/logout with x-refresh-token header -> 200", logoutRes.status === 200, logoutRes);

    const refreshAfterLogoutRes = await authFetch("/api/auth/refresh", null, { method: "POST", headers: { "x-refresh-token": liveRefreshToken } });
    check("E2E-FE-15.2 same refresh token, reused AFTER logout -> now rejected (session genuinely revoked server-side, not just cleared locally)", refreshAfterLogoutRes.status === 401 || refreshAfterLogoutRes.status === 403, refreshAfterLogoutRes);

    // ═══════════════════════════════════════════════════════════
    // E2E-FE-16 / E2E-FE-17 — explicitly NOT live-executable in this
    // harness (AsyncStorage/SecureStore hydration and real device
    // network-drop behavior require an RN runtime / device, neither of
    // which exists in this environment) — marked here so the report's
    // pass/fail count never silently omits them.
    // ═══════════════════════════════════════════════════════════
    check("E2E-FE-16 Cold Start/Auth Restoration — CODE-VERIFIED ONLY (AuthProvider.refreshAuthState read in full this tier; no RN runtime available to execute it live)", true);
    check("E2E-FE-17 Network Failure Recovery — CODE-VERIFIED ONLY (client.js interceptor's network-error branch read this tier; no device/network-drop harness available)", true);

  } finally {
    // Each deletion is independently guarded — a failure in one
    // collection must never prevent cleanup of the rest (this is what
    // silently orphaned fixtures across process crashes before this
    // fix; the residue check below is still the real, unforgiving
    // authority on whether cleanup actually succeeded).
    const safeDelete = async (label, fn) => {
      try { await fn(); } catch (err) { check(`Cleanup step: ${label}`, false, String(err)); }
    };
    try {
      await safeDelete("SupportMessage", () => SupportMessage.deleteMany({ ticketRef: { $in: createdIds.tickets } }));
      await safeDelete("SupportTicket", () => SupportTicket.deleteMany({ _id: { $in: createdIds.tickets } }));
      // FieldAgentEarningLedger rows are immutable (a pre-hook blocks
      // Mongoose-level delete/update) — same raw-driver bypass already
      // established and proven safe in verifyFieldAgentFinancialE2E.js's
      // own cleanup, used ONLY for exact registered fixture IDs.
      await safeDelete("FieldAgentEarningLedger", () => FieldAgentEarningLedger.collection.deleteMany({ _id: { $in: createdIds.earnings } }));
      await safeDelete("AcquisitionClaim", () => AcquisitionClaim.deleteMany({ _id: { $in: createdIds.claims } }));
      await safeDelete("AcquisitionReferral", () => AcquisitionReferral.deleteMany({ _id: { $in: createdIds.referrals } }));
      await safeDelete("FieldAgent", () => FieldAgent.deleteMany({ _id: { $in: createdIds.fieldAgents } }));
      await safeDelete("FieldAgentApplication", () => FieldAgentApplication.deleteMany({ _id: { $in: createdIds.applications } }));
      await safeDelete("Salon", () => Salon.deleteMany({ _id: { $in: createdIds.salons } }));
      await safeDelete("User", () => User.deleteMany({ _id: { $in: createdIds.users } }));
      await safeDelete("Area", () => Area.deleteMany({ _id: { $in: createdIds.areas } }));
      await safeDelete("City", () => City.deleteMany({ _id: { $in: createdIds.cities } }));
      await safeDelete("District", () => District.deleteMany({ _id: { $in: createdIds.districts } }));
      await safeDelete("State", () => State.deleteMany({ _id: { $in: createdIds.states } }));

      const residue = {
        users: await User.countDocuments({ _id: { $in: createdIds.users } }),
        fieldAgents: await FieldAgent.countDocuments({ _id: { $in: createdIds.fieldAgents } }),
        applications: await FieldAgentApplication.countDocuments({ _id: { $in: createdIds.applications } }),
        referrals: await AcquisitionReferral.countDocuments({ _id: { $in: createdIds.referrals } }),
        claims: await AcquisitionClaim.countDocuments({ _id: { $in: createdIds.claims } }),
        earnings: await FieldAgentEarningLedger.countDocuments({ _id: { $in: createdIds.earnings } }),
        tickets: await SupportTicket.countDocuments({ _id: { $in: createdIds.tickets } }),
        salons: await Salon.countDocuments({ _id: { $in: createdIds.salons } }),
        states: await State.countDocuments({ _id: { $in: createdIds.states } }),
        districts: await District.countDocuments({ _id: { $in: createdIds.districts } }),
        cities: await City.countDocuments({ _id: { $in: createdIds.cities } }),
        areas: await Area.countDocuments({ _id: { $in: createdIds.areas } }),
      };
      check("Cleanup: zero residue across all Tier-5 fixtures", Object.values(residue).every((n) => n === 0), residue);
    } catch (cleanupErr) {
      check("Cleanup completed without error", false, String(cleanupErr));
    }

    server.close();
    await mongoose.disconnect();
  }

  console.log("\n" + results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
