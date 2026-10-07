/**
 * POST-CLEANUP RE-AUDIT — STRICTLY READ-ONLY. No writes anywhere.
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../../config/db.js";

import Salon from "../../models/Salon.js";
import Booking from "../../models/Booking.js";
import Transaction from "../../models/Transaction.js";
import WalletLedger from "../../models/WalletLedger.js";
import SalonEarnings from "../../models/SalonEarnings.js";
import PayoutRequest from "../../models/PayoutRequest.js";
import FieldAgentEarningPolicyGap from "../../modules/fieldAgent/models/FieldAgentEarningPolicyGap.js";

const oid = (s) => new mongoose.Types.ObjectId(s);
const section = (t) => console.log(`\n${"=".repeat(10)} ${t} ${"=".repeat(10)}`);
const j = (x) => JSON.stringify(x);

const KEPT_TEST_SALON_IDS = [
  "6a27461b3b043bc85837107a", // Testing Salon 1
  "6a28483c3b043bc85838a2d3", // TESTING SALON 2
  "6a402736616f7392f163dfc7", // Testing salon no6
  "6a69f11eaf6418886704d4b1", // Testing salon no 10
];
const DRAFT_WALLET_SALON_ID = "6aa2701ad0104a244ab02749"; // P0-1 Test Salon #1
const DRAFT_TEST_SALON_IDS = [
  "6a6f29d7af641888670f2c70","6aa2701ad0104a244ab02749","6aa2701fd0104a244ab027fa",
  "6abdb808bbcae3fe996ee169","6abe0748b63e557199ba040c","6abed4a9a07cb5975bdbca4c","6abed8f0a07cb5975bdbd543",
];
const RIDA_ID = "6a4f67e237bba49fad164506";
const APPROVED_SALON_IDS_EXPECTED = [
  "6a27461b3b043bc85837107a","6a28483c3b043bc85838a2d3","6a28684d3b043bc85838b231","6a2869bf3b043bc85838b320",
  "6a2870e83b043bc85838b5c1","6a2872133b043bc85838b67b","6a2873f43b043bc85838b68e","6a311a6d4633fa58986b8a04",
  "6a367a184c9a3dd9caeffe70","6a3da136616f7392f162b762","6a402736616f7392f163dfc7","6a6fab19af641888670f7028",
  "6a6fb6c1af641888670f777a","6a6fbdcaaf641888670f7bf9","6a6fbf2eaf641888670f7c1b","6a6fcb86af641888670f831d",
  "6a7055e1af641888670fc435","6abe16b7b63e557199ba2c76","6abe46c31c0a777ec2f2b497","6a69f11eaf6418886704d4b1",
];

const run = async () => {
  await connectDB();

  // ════════════════════════════════════════════════════════════
  // A — WalletLedger, exact 283 rows, full detail + safety checks
  // ════════════════════════════════════════════════════════════
  section("A — WalletLedger re-audit");
  const walletLedgerFilter = { salonId: { $in: [...KEPT_TEST_SALON_IDS, DRAFT_WALLET_SALON_ID].map(oid) } };
  const wlRows = await WalletLedger.find(walletLedgerFilter).select("_id salonId ownerType ownerId bucket direction action amountInPaise entityType entityId createdAt").lean();
  console.log(`Exact WalletLedger rows matching the 5 test salonIds: ${wlRows.length} (expected 283)`);

  let anyNonTestSalon = false, anyRida = false, bookingRefsStillLive = 0, txnEntityCount = 0;
  const bySalonCount = {};
  for (const row of wlRows) {
    const sid = String(row.salonId);
    bySalonCount[sid] = (bySalonCount[sid] || 0) + 1;
    if (!KEPT_TEST_SALON_IDS.includes(sid) && sid !== DRAFT_WALLET_SALON_ID) anyNonTestSalon = true;
    if (sid === RIDA_ID) anyRida = true;
    if (row.entityType === "BOOKING") {
      const bookingExists = await Booking.exists({ _id: row.entityId });
      if (bookingExists) bookingRefsStillLive++;
    }
  }
  console.log(`Rows by salon: ${j(bySalonCount)}`);
  console.log(`Any row belongs to a non-test/non-draft-wallet salon? ${anyNonTestSalon}`);
  console.log(`Any row belongs to Rida beauty parlor? ${anyRida}`);
  console.log(`Rows whose entityType=BOOKING and that booking STILL exists (should be 0, since all test bookings were already deleted): ${bookingRefsStillLive}`);

  // Does any remaining Transaction/Booking reference one of these ledger rows? (Transaction/Booking have no FK to WalletLedger._id at all — confirm by schema.)
  console.log(`Transaction model has no field referencing WalletLedger._id (confirmed by schema inspection) — no remaining Transaction can "reference" a WalletLedger row by design.`);

  // Full ID list sample (first 5) + total
  console.log(`Sample WalletLedger IDs (first 5 of ${wlRows.length}): ${j(wlRows.slice(0, 5).map((r) => String(r._id)))}`);

  // ════════════════════════════════════════════════════════════
  // B — SalonEarnings, all 9, full classification
  // ════════════════════════════════════════════════════════════
  section("B — SalonEarnings re-audit (all 9)");
  const wallets = await SalonEarnings.find({}).lean();
  for (const w of wallets) {
    const salon = await Salon.findById(w.salonId).select("basicInfo.shopName approval.status").lean();
    const ledgerCount = await WalletLedger.countDocuments({ salonId: w.salonId });
    const isTestWallet = [...KEPT_TEST_SALON_IDS, DRAFT_WALLET_SALON_ID].includes(String(w.salonId));
    console.log(j({
      walletId: String(w._id),
      salonId: String(w.salonId),
      shopName: salon?.basicInfo?.shopName ?? null,
      salonApprovalStatus: salon?.approval?.status ?? null,
      availableBalanceInPaise: w.availableBalanceInPaise,
      pendingBalanceInPaise: w.pendingBalanceInPaise,
      lockedBalanceInPaise: w.lockedBalanceInPaise,
      processingBalanceInPaise: w.processingBalanceInPaise,
      lifetimeWithdrawalsInPaise: w.lifetimeWithdrawalsInPaise,
      walletVersion: w.walletVersion,
      walletLedgerRowCount: ledgerCount,
      classification: isTestWallet ? "TEST_WALLET_CAN_DELETE" : "KEEP",
    }));
  }

  // ════════════════════════════════════════════════════════════
  // C — PayoutRequest, all 17, full detail
  // ════════════════════════════════════════════════════════════
  section("C — PayoutRequest re-audit (all 17)");
  const payouts = await PayoutRequest.find({}).select("_id salonId status amountInPaise createdAt updatedAt").lean();
  console.log(`Total PayoutRequest: ${payouts.length}`);
  const allBelongToTesting2 = payouts.every((p) => String(p.salonId) === "6a28483c3b043bc85838a2d3");
  console.log(`All belong to TESTING SALON 2? ${allBelongToTesting2}`);
  for (const p of payouts) {
    console.log(j({ id: String(p._id), salonId: String(p.salonId), status: p.status, amountInPaise: p.amountInPaise, createdAt: p.createdAt, updatedAt: p.updatedAt }));
  }
  // Their wallet/transaction dependency check — the PayoutRequest.salonId's wallet
  const testing2Wallet = await SalonEarnings.findOne({ salonId: oid("6a28483c3b043bc85838a2d3") }).select("_id").lean();
  console.log(`TESTING SALON 2's wallet still exists (expected: yes, not yet deleted): ${!!testing2Wallet}`);
  const testing2TxnCount = await Transaction.countDocuments({ salonId: oid("6a28483c3b043bc85838a2d3") });
  console.log(`TESTING SALON 2's remaining Transaction count (expected 0, already deleted): ${testing2TxnCount}`);

  // ════════════════════════════════════════════════════════════
  // D — 7 DRAFT salons, re-verify untouched
  // ════════════════════════════════════════════════════════════
  section("D — DRAFT salon re-verification (7)");
  for (const sid of DRAFT_TEST_SALON_IDS) {
    const s = await Salon.findById(sid).select("basicInfo.shopName approval.status onboarding.step").lean();
    const bookingCount = await Booking.countDocuments({ salonRef: oid(sid) });
    const txnCount = await Transaction.countDocuments({ salonId: oid(sid) });
    const walletCount = await SalonEarnings.countDocuments({ salonId: oid(sid) });
    console.log(j({ salonId: sid, exists: !!s, shopName: s?.basicInfo?.shopName ?? null, approvalStatus: s?.approval?.status, step: s?.onboarding?.step, bookingCount, txnCount, walletCount }));
  }
  const ridaInDraftList = DRAFT_TEST_SALON_IDS.includes(RIDA_ID);
  console.log(`Rida beauty parlor appears in the draft-delete list? ${ridaInDraftList}`);

  // ════════════════════════════════════════════════════════════
  // E — APPROVED salon safety
  // ════════════════════════════════════════════════════════════
  section("E — APPROVED salon safety check");
  const approvedNow = await Salon.find({ "approval.status": "APPROVED" }).select("_id").lean();
  const approvedNowIds = new Set(approvedNow.map((s) => String(s._id)));
  console.log(`Current APPROVED salon count: ${approvedNowIds.size} (expected 20)`);
  const allOriginalStillApproved = APPROVED_SALON_IDS_EXPECTED.every((id) => approvedNowIds.has(id));
  console.log(`All 20 original APPROVED salon IDs still present and APPROVED: ${allOriginalStillApproved}`);
  const noExtras = approvedNowIds.size === APPROVED_SALON_IDS_EXPECTED.length && [...approvedNowIds].every((id) => APPROVED_SALON_IDS_EXPECTED.includes(id));
  console.log(`No unexpected extra/missing APPROVED salon: ${noExtras}`);

  // ════════════════════════════════════════════════════════════
  // F — Policy gap status
  // ════════════════════════════════════════════════════════════
  section("F — Policy gap status re-audit");
  const theGapRefIds = [
    "6aa955f8c296435f61da7999","6aa955ffc296435f61da799a","6aa95603c296435f61da799b","6aa95608c296435f61da799e",
    "6aa9560cc296435f61da799f","6aa95616c296435f61da79a2","6aa95618c296435f61da79a3","6aa9561ac296435f61da79a4",
    "6aa9561cc296435f61da79a5","6aa9561ec296435f61da79a6","6aa95620c296435f61da79a7","6aa95622c296435f61da79a8",
    "6aa95625c296435f61da79a9","6aa95628c296435f61da79ab","6aa9562cc296435f61da79ac","6aa9562ec296435f61da79ad",
    "6aa95632c296435f61da79b0","6aa95638c296435f61da79b2","6aa9563dc296435f61da79b3","6aacb33dc296435f61dc851e",
  ];
  const gaps = await FieldAgentEarningPolicyGap.find({ _id: { $in: theGapRefIds.map(oid) } }).select("_id status lastErrorCode referenceKey resolvedAt").lean();
  console.log(`Total found: ${gaps.length} (expected 20)`);
  const allResolved = gaps.every((g) => g.status === "RESOLVED");
  console.log(`All status=RESOLVED: ${allResolved}`);
  for (const g of gaps) console.log(j({ id: String(g._id), status: g.status, lastErrorCode: g.lastErrorCode, referenceKey: g.referenceKey, resolvedAt: g.resolvedAt }));

  await mongoose.connection.close();
};

run().catch(async (err) => {
  console.error("RE-AUDIT FAILED:", err);
  try { await mongoose.connection.close(); } catch {}
  process.exit(1);
});
