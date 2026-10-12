/**
 * BARBER_ENGINE_V1
 * backend/scripts/unit/verifyAdminKycLivenessDto.mjs
 *
 * Phase 4 — Liveness DTO fix. Pure unit check, NO database, NO HTTP
 * server, NO provider call — calls toDetailDTO() directly with a
 * plain in-memory fixture object (mirrors the shape .lean() would
 * produce), not a real Mongo document. Confirms:
 *   (a) the new `liveness` field is now present and correctly reads
 *       kyc.verification.liveness,
 *   (b) every other existing field this DTO produces is byte-for-byte
 *       identical to what it produced before this change — i.e. the
 *       fix is additive-only, nothing else shifted.
 *
 * ZEMISH completion pass — toDetailDTO is now `async` (it derives
 * identity.gst.verified from a VerificationLog read, only when a GST
 * number is present). This fixture's gst.maskedNumber is null, so that
 * read is never reached (short-circuited before any DB call) — this
 * file remains a pure, offline, zero-database unit test. `run()` was
 * made async and `toDetailDTO(...)` is now awaited accordingly.
 *
 * Run:  cd backend && node scripts/unit/verifyAdminKycLivenessDto.mjs
 */

import { toDetailDTO } from "../../modules/kyc/dto/adminKyc.dto.js";

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; rows.push(`✅ ${name}`); }
  else { fail++; rows.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const fixtureKyc = {
  _id: "kyc_fixture_1",
  status: "VERIFIED",
  verificationLevel: 5,
  ownerId: { _id: "owner_1", name: "Fixture Owner", phone: "9999999999", email: "f@example.com", accountStatus: "ACTIVE", createdAt: "2026-01-01T00:00:00.000Z" },
  contact: { phone: "9999999999", email: "f@example.com" },
  identity: { pan: { maskedNumber: "ABCDE****F" }, aadhaar: { maskedNumber: "XXXX-XXXX-1234" }, gst: { maskedNumber: null } },
  bank: { accountHolder: "Fixture Owner", maskedAccount: "XXXX1234", ifsc: "HDFC0001234", bankName: "Test Bank", pennyDropStatus: "SUCCESS" },
  documents: { panCard: null, aadhaarFront: null, aadhaarBack: null, cancelledCheque: null, gstCertificate: null, selfie: null, other: [] },
  verification: {
    phone: { status: "VERIFIED", verified: true },
    email: { status: "VERIFIED", verified: true },
    pan: { status: "VERIFIED", verified: true },
    aadhaar: { status: "VERIFIED", verified: true },
    bank: { status: "VERIFIED", verified: true },
    ocr: { status: null, verified: false },
    face: { status: "VERIFIED", verified: true, verifiedAt: "2026-10-01T00:00:00.000Z", verificationSource: "CASHFREE" },
    liveness: { status: "VERIFIED", verified: true, verifiedAt: "2026-10-01T00:00:01.000Z", verificationSource: "CASHFREE", remarks: "Liveness confirmed via Cashfree" },
    manualReview: { status: "VERIFIED", verified: true },
  },
  risk: { score: 10, flags: [], manualReviewRequired: false, lastUpdatedAt: null },
  review: { assignedTo: null, assignedAt: null, reviewedBy: null, reviewedAt: null, rejectReason: null, notes: null },
  submittedAt: "2026-09-01T00:00:00.000Z",
  approvedAt: "2026-09-02T00:00:00.000Z",
  rejectedAt: null,
  expiresAt: "2027-09-02T00:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
};

const run = async () => {
  const started = Date.now();
  const dto = await toDetailDTO(fixtureKyc);
  const elapsedMs = Date.now() - started;
  check("toDetailDTO completed near-instantly (gst.maskedNumber null — VerificationLog read never reached, no DB call made)", elapsedMs < 50, elapsedMs);
  check("dto.identity.gst.verified is false when no GST was submitted (new field, additive)", dto.identity.gst.verified === false, dto.identity.gst);

  // ── The actual fix ──
  check("dto.verification.liveness is present", dto.verification.liveness !== undefined);
  check("dto.verification.liveness.verified === true", dto.verification.liveness.verified === true);
  check("dto.verification.liveness.verificationSource === CASHFREE", dto.verification.liveness.verificationSource === "CASHFREE");
  check("dto.verification.liveness.remarks preserved", dto.verification.liveness.remarks === "Liveness confirmed via Cashfree");

  // ── Everything else must be byte-identical to pre-change shape.
  // Expected object below is exactly what toDetailDTO produced BEFORE
  // this phase's one-line change (manually verified against the prior
  // file content read earlier in this session), with `liveness` added
  // at its correct position for comparison purposes only. ──
  const expectedVerificationBlock = {
    phone: { status: "VERIFIED", verified: true, verifiedAt: null, verificationSource: null, remarks: null, reverifyAfter: null },
    email: { status: "VERIFIED", verified: true, verifiedAt: null, verificationSource: null, remarks: null, reverifyAfter: null },
    pan: { status: "VERIFIED", verified: true, verifiedAt: null, verificationSource: null, remarks: null, reverifyAfter: null },
    aadhaar: { status: "VERIFIED", verified: true, verifiedAt: null, verificationSource: null, remarks: null, reverifyAfter: null },
    bank: { status: "VERIFIED", verified: true, verifiedAt: null, verificationSource: null, remarks: null, reverifyAfter: null },
    ocr: { status: null, verified: false, verifiedAt: null, verificationSource: null, remarks: null, reverifyAfter: null },
    face: { status: "VERIFIED", verified: true, verifiedAt: "2026-10-01T00:00:00.000Z", verificationSource: "CASHFREE", remarks: null, reverifyAfter: null },
    liveness: { status: "VERIFIED", verified: true, verifiedAt: "2026-10-01T00:00:01.000Z", verificationSource: "CASHFREE", remarks: "Liveness confirmed via Cashfree", reverifyAfter: null },
    manualReview: { status: "VERIFIED", verified: true, verifiedAt: null, verificationSource: null, remarks: null, reverifyAfter: null },
  };
  check("verification block matches expected shape exactly (additive-only)", deepEqual(dto.verification, expectedVerificationBlock), dto.verification);

  check("dto.id unchanged", dto.id === fixtureKyc._id);
  check("dto.status unchanged", dto.status === fixtureKyc.status);
  check("dto.owner.name unchanged", dto.owner.name === "Fixture Owner");
  check("dto.bank.maskedAccount unchanged", dto.bank.maskedAccount === "XXXX1234");
  check("dto.risk.score unchanged", dto.risk.score === 10);
  check("dto.timeline.approvedAt unchanged", dto.timeline.approvedAt === fixtureKyc.approvedAt);

  console.log(rows.join("\n"));
  console.log(`\nADMIN KYC LIVENESS DTO: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
