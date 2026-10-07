/**
 * BARBER_ENGINE_V1
 * backend/scripts/financeCleanup_2026-10-04.js
 *
 * ONE-TIME, EXPLICITLY AUTHORIZED finance test-data cleanup. Executes
 * ONLY the exact delete/archive operations from the verified
 * "FINAL PRE-DELETE MANIFEST" (manifest file loaded below, generated
 * by scripts/e2e/auditFinalManifestReadOnly.js and reviewed/approved
 * by the user before this script was written).
 *
 * SAFETY DISCIPLINE (per explicit instruction):
 *   - Every destructive group: re-query exact IDs -> assert they match
 *     the manifest's own recorded IDs/counts -> delete by EXACT ID
 *     array only (never a broad filter) -> record deletedCount ->
 *     continue. Any mismatch anywhere aborts the ENTIRE run with zero
 *     further deletes.
 *   - The 29 AcquisitionEarningProgress + 7 FieldAgentEarningLedger
 *     documents are archived (full document export) BEFORE deletion,
 *     with a verified archive count, per explicit instruction.
 *   - Never touches: RevenueSplit, GSTLedger, the 1 Refund, the 20
 *     OPEN FieldAgentEarningPolicyGap rows, any APPROVED Salon, any
 *     APPROVED salon's owner, Rida beauty parlor, the 4 real-looking
 *     customer users, or any geo/master collection (none of those are
 *     even imported below).
 */
import "dotenv/config";
import fs from "fs";
import mongoose from "mongoose";
import connectDB from "../config/db.js";

import Salon from "../models/Salon.js";
import User from "../models/User.js";
import Booking from "../models/Booking.js";
import Transaction from "../models/Transaction.js";
import WalletTransaction from "../models/WalletTransaction.js";
import WalletLedger from "../models/WalletLedger.js";
import SalonEarnings from "../models/SalonEarnings.js";
import PayoutRequest from "../models/PayoutRequest.js";
import Refund from "../models/Refund.js";
import RevenueSplit from "../modules/finance/models/RevenueSplit.js";
import GSTLedger from "../modules/finance/models/GSTLedger.js";
import AcquisitionClaim from "../modules/fieldAgent/models/AcquisitionClaim.js";
import AcquisitionEarningProgress from "../modules/fieldAgent/models/AcquisitionEarningProgress.js";
import FieldAgentEarningLedger from "../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import FieldAgentEarningPolicyGap from "../modules/fieldAgent/models/FieldAgentEarningPolicyGap.js";

const MANIFEST_PATH = "/private/tmp/claude-502/-Users-imrankhan-BARBER-ENGINE-V1/4afd4ed8-cced-4cd4-a0a0-edcb4dd577ae/scratchpad/final_cleanup_manifest.json";
const ARCHIVE_PATH = "/private/tmp/claude-502/-Users-imrankhan-BARBER-ENGINE-V1/4afd4ed8-cced-4cd4-a0a0-edcb4dd577ae/scratchpad/fieldAgentOrphanArchive_2026-10-04.json";

const oid = (s) => new mongoose.Types.ObjectId(s);
const log = (msg) => console.log(`[CLEANUP] ${msg}`);

let STOPPED_REASON = null;
const report = { archived: null, deletedCounts: {}, errors: [] };

const abort = (reason) => {
  STOPPED_REASON = reason;
  log(`❌ ABORTING: ${reason}`);
};

const run = async () => {
  await connectDB();

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  log(`Loaded manifest from ${MANIFEST_PATH}`);

  // APPROVED-salon pre-flight snapshot — for the final safety comparison.
  const approvedBefore = await Salon.find({ "approval.status": "APPROVED" }).select("_id").lean();
  const approvedBeforeIds = new Set(approvedBefore.map((s) => String(s._id)));
  if (approvedBeforeIds.size !== 20) {
    abort(`Pre-flight check failed: expected 20 APPROVED salons, found ${approvedBeforeIds.size}`);
  }

  // ════════════════════════════════════════════════════════════
  // STEP 0 — ARCHIVE 29 AcquisitionEarningProgress + 7 FieldAgentEarningLedger
  // ════════════════════════════════════════════════════════════
  if (!STOPPED_REASON) {
    const progressIds = manifest.fieldAgentData.acquisitionEarningProgress.ids;
    const ledgerIds = manifest.fieldAgentData.fieldAgentEarningLedger.ids;

    const progressDocs = await AcquisitionEarningProgress.find({ _id: { $in: progressIds.map(oid) } }).lean();
    const ledgerDocs = await FieldAgentEarningLedger.find({ _id: { $in: ledgerIds.map(oid) } }).lean();

    if (progressDocs.length !== 29 || progressIds.length !== 29) {
      abort(`Archive count mismatch: expected 29 AcquisitionEarningProgress, manifest has ${progressIds.length}, live query found ${progressDocs.length}`);
    } else if (ledgerDocs.length !== 7 || ledgerIds.length !== 7) {
      abort(`Archive count mismatch: expected 7 FieldAgentEarningLedger, manifest has ${ledgerIds.length}, live query found ${ledgerDocs.length}`);
    } else {
      fs.writeFileSync(ARCHIVE_PATH, JSON.stringify({ archivedAt: new Date().toISOString(), acquisitionEarningProgress: progressDocs, fieldAgentEarningLedger: ledgerDocs }, null, 2));
      const verify = JSON.parse(fs.readFileSync(ARCHIVE_PATH, "utf8"));
      if (verify.acquisitionEarningProgress.length === 29 && verify.fieldAgentEarningLedger.length === 7) {
        report.archived = { path: ARCHIVE_PATH, progressCount: 29, ledgerCount: 7 };
        log(`✅ Archive written and verified: ${ARCHIVE_PATH} (29 progress + 7 ledger docs)`);
      } else {
        abort("Archive file verification failed after write — re-read did not show 29+7 documents");
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // STEP 1 — Delete 5 confirmed test USER accounts
  // ════════════════════════════════════════════════════════════
  if (!STOPPED_REASON) {
    const testUserIds = manifest.testUsers.map((u) => u.userId);
    const liveUsers = await User.find({ _id: { $in: testUserIds.map(oid) } }).select("_id role").lean();
    let safe = liveUsers.length === 5;
    for (const u of liveUsers) {
      if (u.role !== "USER") { safe = false; abort(`Test user ${u._id} has role ${u.role}, expected USER — refusing to delete`); break; }
      const ownsSalon = await Salon.exists({ ownerId: u._id });
      const isFieldAgent = await mongoose.connection.db.collection("fieldagents").findOne({ userRef: u._id });
      if (ownsSalon || isFieldAgent) { safe = false; abort(`Test user ${u._id} owns a salon or is a Field Agent — refusing to delete`); break; }
    }
    if (safe && !STOPPED_REASON) {
      const result = await User.deleteMany({ _id: { $in: testUserIds.map(oid) } });
      report.deletedCounts.testUsers = result.deletedCount;
      log(`✅ Deleted ${result.deletedCount} test users (expected 5)`);
      if (result.deletedCount !== 5) abort(`User deletion count mismatch: deleted ${result.deletedCount}, expected 5`);
    } else if (!STOPPED_REASON) {
      abort(`Test user re-verification found ${liveUsers.length} of 5 expected users`);
    }
  }

  // ════════════════════════════════════════════════════════════
  // STEP 2 — Delete test operational data: Transactions, WalletTransactions, Bookings
  // ════════════════════════════════════════════════════════════
  if (!STOPPED_REASON) {
    const testBookingIds = Object.values(manifest.testBookings.bySalon).flatMap((s) => s.ids);
    if (testBookingIds.length !== 206) {
      abort(`Manifest booking-ID count mismatch: expected 206, manifest has ${testBookingIds.length}`);
    } else {
      const liveBookingCount = await Booking.countDocuments({ _id: { $in: testBookingIds.map(oid) } });
      if (liveBookingCount !== 206) {
        abort(`Live booking re-query mismatch: expected 206, found ${liveBookingCount}`);
      } else {
        // Transactions linked to these bookings + the 3 known orphans
        const linkedTxnIds = manifest.testTransactions.linkedToKeptTestBookings.ids;
        const orphanTxnIds = manifest.testTransactions.orphaned.ids.map((t) => t.id);
        const allTxnIds = [...linkedTxnIds, ...orphanTxnIds];
        const liveTxnCount = await Transaction.countDocuments({ _id: { $in: allTxnIds.map(oid) } });
        if (liveTxnCount !== allTxnIds.length) {
          abort(`Transaction re-query mismatch: manifest has ${allTxnIds.length}, live found ${liveTxnCount}`);
        } else {
          const txnResult = await Transaction.deleteMany({ _id: { $in: allTxnIds.map(oid) } });
          report.deletedCounts.transactions = txnResult.deletedCount;
          log(`✅ Deleted ${txnResult.deletedCount} Transactions (expected ${allTxnIds.length})`);

          const wtxnIds = manifest.testWalletTransactions.rows.map((r) => r.id);
          const liveWtxnCount = await WalletTransaction.countDocuments({ _id: { $in: wtxnIds.map(oid) } });
          if (liveWtxnCount !== wtxnIds.length) {
            abort(`WalletTransaction re-query mismatch: manifest has ${wtxnIds.length}, live found ${liveWtxnCount}`);
          } else {
            const wtxnResult = await WalletTransaction.deleteMany({ _id: { $in: wtxnIds.map(oid) } });
            report.deletedCounts.walletTransactions = wtxnResult.deletedCount;
            log(`✅ Deleted ${wtxnResult.deletedCount} WalletTransactions (expected ${wtxnIds.length})`);

            const bookingResult = await Booking.deleteMany({ _id: { $in: testBookingIds.map(oid) } });
            report.deletedCounts.bookings = bookingResult.deletedCount;
            log(`✅ Deleted ${bookingResult.deletedCount} Bookings (expected 206)`);
            if (bookingResult.deletedCount !== 206) abort(`Booking deletion count mismatch: deleted ${bookingResult.deletedCount}, expected 206`);
          }
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // STEP 3 — Delete 63 test AcquisitionClaims + 309 RESOLVED policy gaps
  // ════════════════════════════════════════════════════════════
  if (!STOPPED_REASON) {
    const claimIds = [...manifest.fieldAgentData.bareOrphanedClaims.ids, ...manifest.fieldAgentData.bareClaimsOnKeptSalons.ids];
    if (claimIds.length !== 63) {
      abort(`Manifest claim-ID count mismatch: expected 63, found ${claimIds.length}`);
    } else {
      const liveClaimCount = await AcquisitionClaim.countDocuments({ _id: { $in: claimIds.map(oid) } });
      if (liveClaimCount !== 63) {
        abort(`Live claim re-query mismatch: expected 63, found ${liveClaimCount}`);
      } else {
        const claimResult = await AcquisitionClaim.deleteMany({ _id: { $in: claimIds.map(oid) } });
        report.deletedCounts.acquisitionClaims = claimResult.deletedCount;
        log(`✅ Deleted ${claimResult.deletedCount} AcquisitionClaims (expected 63)`);
        if (claimResult.deletedCount !== 63) abort(`Claim deletion count mismatch: deleted ${claimResult.deletedCount}, expected 63`);
      }
    }
  }
  if (!STOPPED_REASON) {
    const gapIds = manifest.fieldAgentData.resolvedPolicyGaps.ids;
    if (gapIds.length !== 309) {
      abort(`Manifest resolved-gap-ID count mismatch: expected 309, found ${gapIds.length}`);
    } else {
      const liveGapCount = await FieldAgentEarningPolicyGap.countDocuments({ _id: { $in: gapIds.map(oid) }, status: "RESOLVED" });
      if (liveGapCount !== 309) {
        abort(`Live RESOLVED-gap re-query mismatch: expected 309, found ${liveGapCount}`);
      } else {
        const gapResult = await FieldAgentEarningPolicyGap.deleteMany({ _id: { $in: gapIds.map(oid) }, status: "RESOLVED" });
        report.deletedCounts.resolvedPolicyGaps = gapResult.deletedCount;
        log(`✅ Deleted ${gapResult.deletedCount} RESOLVED FieldAgentEarningPolicyGap rows (expected 309)`);
        if (gapResult.deletedCount !== 309) abort(`Gap deletion count mismatch: deleted ${gapResult.deletedCount}, expected 309`);
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // STEP 4 — Delete the ARCHIVED 29 Progress + 7 Ledger (only now, post-archive)
  // ════════════════════════════════════════════════════════════
  if (!STOPPED_REASON && report.archived) {
    const progressIds = manifest.fieldAgentData.acquisitionEarningProgress.ids;
    const ledgerIds = manifest.fieldAgentData.fieldAgentEarningLedger.ids;
    const progressResult = await AcquisitionEarningProgress.deleteMany({ _id: { $in: progressIds.map(oid) } });
    report.deletedCounts.acquisitionEarningProgress = progressResult.deletedCount;
    log(`✅ Deleted ${progressResult.deletedCount} AcquisitionEarningProgress (expected 29, archived first)`);
    if (progressResult.deletedCount !== 29) abort(`Progress deletion count mismatch: deleted ${progressResult.deletedCount}, expected 29`);

    if (!STOPPED_REASON) {
      const ledgerResult = await FieldAgentEarningLedger.deleteMany({ _id: { $in: ledgerIds.map(oid) } });
      report.deletedCounts.fieldAgentEarningLedger = ledgerResult.deletedCount;
      log(`✅ Deleted ${ledgerResult.deletedCount} FieldAgentEarningLedger (expected 7, archived first)`);
      if (ledgerResult.deletedCount !== 7) abort(`Ledger deletion count mismatch: deleted ${ledgerResult.deletedCount}, expected 7`);
    }
  } else if (!STOPPED_REASON && !report.archived) {
    abort("Refusing to delete AcquisitionEarningProgress/FieldAgentEarningLedger — archive step did not complete successfully");
  }

  // ════════════════════════════════════════════════════════════
  // STEP 5 — Delete the 283 test WalletLedger rows
  // ════════════════════════════════════════════════════════════
  if (!STOPPED_REASON) {
    const keptTestSalonIds = Object.keys(manifest.testWalletLedger.bySalon).filter((k) => !k.includes("_draftWallet"));
    const draftWalletSalonId = "6aa2701ad0104a244ab02749";
    const filter = { salonId: { $in: [...keptTestSalonIds, draftWalletSalonId].map(oid) } };
    const liveCount = await WalletLedger.countDocuments(filter);
    if (liveCount !== 283) {
      abort(`WalletLedger re-query mismatch: expected 283, found ${liveCount}`);
    } else {
      const wlResult = await WalletLedger.deleteMany(filter);
      report.deletedCounts.walletLedger = wlResult.deletedCount;
      log(`✅ Deleted ${wlResult.deletedCount} WalletLedger rows (expected 283)`);
      if (wlResult.deletedCount !== 283) abort(`WalletLedger deletion count mismatch: deleted ${wlResult.deletedCount}, expected 283`);
    }
  }

  // ════════════════════════════════════════════════════════════
  // STEP 6 — Delete the 5 test SalonEarnings wallets
  // ════════════════════════════════════════════════════════════
  if (!STOPPED_REASON) {
    const walletSalonIds = ["6a27461b3b043bc85837107a", "6a28483c3b043bc85838a2d3", "6a402736616f7392f163dfc7", "6a69f11eaf6418886704d4b1", "6aa2701ad0104a244ab02749"];
    const liveWalletCount = await SalonEarnings.countDocuments({ entityType: "SALON", entityId: { $in: walletSalonIds.map(oid) } });
    if (liveWalletCount !== 5) {
      abort(`SalonEarnings re-query mismatch: expected 5, found ${liveWalletCount}`);
    } else {
      const seResult = await SalonEarnings.deleteMany({ entityType: "SALON", entityId: { $in: walletSalonIds.map(oid) } });
      report.deletedCounts.salonEarnings = seResult.deletedCount;
      log(`✅ Deleted ${seResult.deletedCount} SalonEarnings wallets (expected 5)`);
      if (seResult.deletedCount !== 5) abort(`SalonEarnings deletion count mismatch: deleted ${seResult.deletedCount}, expected 5`);
    }
  }

  // ════════════════════════════════════════════════════════════
  // STEP 7 — Delete the 17 PayoutRequest rows (TESTING SALON 2 only)
  // ════════════════════════════════════════════════════════════
  if (!STOPPED_REASON) {
    const payoutIds = manifest.testPayoutRequests.ids;
    if (payoutIds.length !== 17 || !manifest.testPayoutRequests.allBelongToTestingSalon2) {
      abort(`PayoutRequest manifest check failed: count=${payoutIds.length}, allBelongToTestingSalon2=${manifest.testPayoutRequests.allBelongToTestingSalon2}`);
    } else {
      const livePayouts = await PayoutRequest.find({ _id: { $in: payoutIds.map(oid) } }).select("salonId").lean();
      const allMatch = livePayouts.length === 17 && livePayouts.every((p) => String(p.salonId) === "6a28483c3b043bc85838a2d3");
      if (!allMatch) {
        abort(`PayoutRequest live re-verification failed: found ${livePayouts.length} of 17, or salonId mismatch`);
      } else {
        const payoutResult = await PayoutRequest.deleteMany({ _id: { $in: payoutIds.map(oid) } });
        report.deletedCounts.payoutRequests = payoutResult.deletedCount;
        log(`✅ Deleted ${payoutResult.deletedCount} PayoutRequest rows (expected 17)`);
        if (payoutResult.deletedCount !== 17) abort(`PayoutRequest deletion count mismatch: deleted ${payoutResult.deletedCount}, expected 17`);
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // STEP 8 — Delete the 7 confirmed disposable DRAFT test salons
  // ════════════════════════════════════════════════════════════
  if (!STOPPED_REASON) {
    const draftSalonIds = manifest.draftSalons.map((d) => d.salonId);
    if (draftSalonIds.length !== 7) {
      abort(`Manifest draft-salon count mismatch: expected 7, found ${draftSalonIds.length}`);
    } else {
      const liveDraftSalons = await Salon.find({ _id: { $in: draftSalonIds.map(oid) } }).select("_id approval.status").lean();
      const anyApproved = liveDraftSalons.some((s) => s.approval?.status === "APPROVED");
      if (anyApproved) {
        abort("CRITICAL: one of the 7 draft-salon candidates is now APPROVED — refusing to delete any of them");
      } else if (liveDraftSalons.length !== 7) {
        abort(`Live draft-salon re-query mismatch: expected 7, found ${liveDraftSalons.length}`);
      } else {
        const salonResult = await Salon.deleteMany({ _id: { $in: draftSalonIds.map(oid) } });
        report.deletedCounts.draftSalons = salonResult.deletedCount;
        log(`✅ Deleted ${salonResult.deletedCount} DRAFT test salons (expected 7)`);
        if (salonResult.deletedCount !== 7) abort(`Draft salon deletion count mismatch: deleted ${salonResult.deletedCount}, expected 7`);
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // POST-CLEANUP VERIFICATION
  // ════════════════════════════════════════════════════════════
  const freshCounts = {
    Salon: await Salon.countDocuments({}),
    Booking: await Booking.countDocuments({}),
    Transaction: await Transaction.countDocuments({}),
    WalletTransaction: await WalletTransaction.countDocuments({}),
    WalletLedger: await WalletLedger.countDocuments({}),
    SalonEarnings: await SalonEarnings.countDocuments({}),
    RevenueSplit: await RevenueSplit.countDocuments({}),
    GSTLedger: await GSTLedger.countDocuments({}),
    Refund: await Refund.countDocuments({}),
    AcquisitionClaim: await AcquisitionClaim.countDocuments({}),
    AcquisitionEarningProgress: await AcquisitionEarningProgress.countDocuments({}),
    FieldAgentEarningLedger: await FieldAgentEarningLedger.countDocuments({}),
    FieldAgentEarningPolicyGap: await FieldAgentEarningPolicyGap.countDocuments({}),
    PayoutRequest: await PayoutRequest.countDocuments({}),
    User: await User.countDocuments({}),
  };

  const approvedAfter = await Salon.find({ "approval.status": "APPROVED" }).select("_id").lean();
  const approvedAfterIds = new Set(approvedAfter.map((s) => String(s._id)));
  const approvedOwnersAfter = await User.find({ _id: { $in: manifest.approvedOwnerIds.map(oid) } }).select("_id").lean();
  const ridaStillExists = await Salon.exists({ _id: oid("6a4f67e237bba49fad164506") });
  const openGapsAfter = await FieldAgentEarningPolicyGap.countDocuments({ status: "OPEN" });

  const criticalAssertions = {
    all20ApprovedSalonsStillExist: manifest.approvedSalonIds.every((id) => approvedAfterIds.has(id)),
    approvedSalonIdsUnchanged: approvedAfterIds.size === 20 && [...approvedAfterIds].every((id) => manifest.approvedSalonIds.includes(id)),
    allApprovedOwnersStillExist: approvedOwnersAfter.length === manifest.approvedOwnerIds.length,
    ridaBeautyParlorStillExists: !!ridaStillExists,
    revenueSplitCountUnchanged: freshCounts.RevenueSplit === 5,
    gstLedgerCountUnchanged: freshCounts.GSTLedger === 4,
    refundCountUnchanged: freshCounts.Refund === 1,
    openPolicyGapCountUnchanged: openGapsAfter === 20,
  };

  report.freshCounts = freshCounts;
  report.criticalAssertions = criticalAssertions;
  report.stoppedReason = STOPPED_REASON;
  report.finalStatus = STOPPED_REASON ? "CLEANUP STOPPED" : (Object.values(criticalAssertions).every(Boolean) ? "CLEANUP COMPLETE" : "CLEANUP COMPLETE WITH ASSERTION FAILURE");

  console.log("\n\n========== FINAL REPORT ==========");
  console.log(JSON.stringify(report, null, 2));

  await mongoose.connection.close();
};

run().catch(async (err) => {
  console.error("CLEANUP SCRIPT FATAL ERROR:", err);
  try { await mongoose.connection.close(); } catch {}
  process.exit(1);
});
