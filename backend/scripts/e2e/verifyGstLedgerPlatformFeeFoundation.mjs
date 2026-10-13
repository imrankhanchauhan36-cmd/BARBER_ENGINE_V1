/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyGstLedgerPlatformFeeFoundation.mjs
 *
 * PLATFORM-FEE GST — Phase 3 (RevenueSplit/GSTLedger/refund/report)
 * focused tests, additive, 2026-10-12. Verifies:
 *   (a) the RevenueSplit required-field landmine fix (confirmed LIVE
 *       against the real dev DB in an earlier preflight: 0 of 6 real
 *       completed bookings had a RevenueSplit, because a null
 *       gstAmountInPaise/gstRatePercent — a legitimate, legacy state —
 *       threw on a `required: true` field, silently caught, returning
 *       null);
 *   (b) the corrected taxableValueInPaise base (service amount, not
 *       platform fee) on new GSTLedger SALE rows;
 *   (c) fee-GST-only bookings (service GST = 0, e.g. an unregistered
 *       salon) still create a correct SALE row instead of being
 *       silently dropped;
 *   (d) refund reversal apportions BOTH GST components independently
 *       and correctly, including a fee-GST-only reversal;
 *   (e) splitRefundComponents' new 4th component;
 *   (f) GSTReportService's new parallel platform-fee-GST columns;
 *   (g) end-to-end: createRevenueSplitForBooking() on a realistic
 *       CONFIRMED booking now produces BOTH a RevenueSplit AND a
 *       GSTLedger SALE row — the exact gap confirmed live.
 *
 * SAFE/LOCAL BY CONSTRUCTION — same MongoMemoryReplSet pattern as the
 * other Phase 1/2 foundation scripts in this directory/scripts/unit/.
 * Never touches MONGODB_URI/Atlas.
 *
 * Run:  cd backend && node scripts/e2e/verifyGstLedgerPlatformFeeFoundation.mjs
 */

process.env.SKIP_REDIS_AUTOCONNECT = "true";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, extra) => {
  if (cond) { pass++; rows.push(`  ✅ ${name}`); }
  else { fail++; rows.push(`  ❌ ${name}${extra !== undefined ? `  (got: ${JSON.stringify(extra)})` : ""}`); }
};
const oid = () => new mongoose.Types.ObjectId();

const run = async () => {
  const mem = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mem.getUri(), { dbName: "gst_ledger_platform_fee_foundation" });

  const RevenueSplit = (await import("../../modules/finance/models/RevenueSplit.js")).default;
  const GSTLedger = (await import("../../modules/finance/models/GSTLedger.js")).default;
  const Refund = (await import("../../models/Refund.js")).default;
  const { REFUND_STATUS } = await import("../../models/Refund.js");
  const Booking = (await import("../../models/Booking.js")).default;
  const { createSaleLedger, createRefundReversalLedger } = await import("../../modules/finance/services/GSTLedgerService.js");
  const { createRevenueSplitForBooking } = await import("../../modules/finance/services/RevenueSplitIntegrationService.js");
  const { splitRefundComponents } = await import("../../services/refundComponentSplitter.js");
  const { getMonthlyTotals } = await import("../../modules/finance/services/GSTReportService.js");

  const makeRevenueSplit = (overrides = {}) => RevenueSplit.create({
    bookingId: oid(),
    serviceAmountInPaise: 50000,
    platformFeeInPaise: 2000,
    gstRatePercent: 5,
    gstAmountInPaise: 2500,
    customerPaidInPaise: 54860,
    salonCreditInPaise: 50000,
    zemishRevenueInPaise: 2000,
    policyVersion: 1,
    ...overrides,
  });

  try {
    // ════════════════════════════════════════════════════════════
    // (a) RevenueSplit landmine fix — a null gstAmountInPaise/
    //     gstRatePercent (the exact legacy/no-policy-published state)
    //     no longer throws on RevenueSplit.create(). This is the
    //     root cause of the live-confirmed "0 of 6 real bookings have
    //     a RevenueSplit" finding.
    // ════════════════════════════════════════════════════════════
    const legacySplit = await makeRevenueSplit({
      gstRatePercent: null, gstAmountInPaise: null,
      platformFeeGstRatePercent: null, platformFeeGstAmountInPaise: null,
      customerPaidInPaise: 52000,
    });
    check("(a) RevenueSplit.create() succeeds with gstAmountInPaise/gstRatePercent = null (previously required:true, threw, silently dropped)", !!legacySplit._id, legacySplit);

    // ════════════════════════════════════════════════════════════
    // (b) Corrected taxableValueInPaise base — a normal, both-GST
    //     split creates a SALE row whose taxableValueInPaise is the
    //     SERVICE amount (not the platform fee), and both components
    //     now mathematically reconcile against their own stored rate.
    // ════════════════════════════════════════════════════════════
    const bothGstSplit = await makeRevenueSplit({
      platformFeeGstRatePercent: 18, platformFeeGstAmountInPaise: 360,
    });
    const saleBoth = await createSaleLedger({ revenueSplit: bothGstSplit });
    check("(b1) SALE row created for a both-GST split", !!saleBoth, saleBoth);
    check("(b2) taxableValueInPaise is the SERVICE amount (50000), not the platform fee (2000) — the core audit fix", saleBoth.taxableValueInPaise === 50000, saleBoth.taxableValueInPaise);
    check("(b3) Service-GST row reconciles: taxableValueInPaise * gstRate/100 === gstAmountInPaise", Math.round(saleBoth.taxableValueInPaise * saleBoth.gstRate / 100) === saleBoth.gstAmountInPaise, { taxableValueInPaise: saleBoth.taxableValueInPaise, gstRate: saleBoth.gstRate, gstAmountInPaise: saleBoth.gstAmountInPaise });
    check("(b4) Platform-fee-GST row reconciles: platformFeeTaxableValueInPaise * platformFeeGstRate/100 === platformFeeGstAmountInPaise", Math.round(saleBoth.platformFeeTaxableValueInPaise * saleBoth.platformFeeGstRate / 100) === saleBoth.platformFeeGstAmountInPaise, { platformFeeTaxableValueInPaise: saleBoth.platformFeeTaxableValueInPaise, platformFeeGstRate: saleBoth.platformFeeGstRate, platformFeeGstAmountInPaise: saleBoth.platformFeeGstAmountInPaise });
    check("(b5) platformFeeTaxableValueInPaise equals the platform fee itself (2000)", saleBoth.platformFeeTaxableValueInPaise === 2000);

    // ════════════════════════════════════════════════════════════
    // (c) Fee-GST-only case (service GST = 0, e.g. an unregistered
    //     salon) — a SALE row must still be created, carrying the
    //     fee-GST component, not silently dropped.
    // ════════════════════════════════════════════════════════════
    const feeOnlySplit = await makeRevenueSplit({
      gstRatePercent: 0, gstAmountInPaise: 0,
      platformFeeGstRatePercent: 18, platformFeeGstAmountInPaise: 360,
    });
    const saleFeeOnly = await createSaleLedger({ revenueSplit: feeOnlySplit });
    check("(c1) SALE row IS created when service GST is 0 but platform-fee GST is positive (previously would have been silently skipped)", !!saleFeeOnly, saleFeeOnly);
    check("(c2) gstAmountInPaise stored as 0 (not null, not omitted)", saleFeeOnly.gstAmountInPaise === 0);
    check("(c3) platformFeeGstAmountInPaise correctly stored (360)", saleFeeOnly.platformFeeGstAmountInPaise === 360);

    // ════════════════════════════════════════════════════════════
    // No GST at all (both components null/0) — still correctly
    // returns null, no row.
    // ════════════════════════════════════════════════════════════
    const noGstSplit = await makeRevenueSplit({
      gstRatePercent: null, gstAmountInPaise: null,
      platformFeeGstRatePercent: null, platformFeeGstAmountInPaise: null,
    });
    const saleNone = await createSaleLedger({ revenueSplit: noGstSplit });
    check("No SALE row created when NEITHER GST component is present", saleNone === null);

    // ════════════════════════════════════════════════════════════
    // (d) Refund reversal — full refund on the both-GST split
    //     apportions BOTH components correctly; a fee-GST-only
    //     reversal also works.
    // ════════════════════════════════════════════════════════════
    const makeRefund = (paymentAmountInPaise, amountInPaise, refundId) => Refund.create({
      paymentId: `pay_${oid()}`,
      amountInPaise,
      paymentAmountInPaise,
      idempotencyKey: `test:${refundId}`,
      razorpayRefundId: refundId,
      refundStatus: REFUND_STATUS.PROCESSED,
    });

    await makeRefund(54860, 54860, "rfnd_full_both");
    const reversalBoth = await createRefundReversalLedger({ revenueSplit: bothGstSplit, refundId: "rfnd_full_both" });
    check("(d1) Full refund reversal created for a both-GST SALE row", !!reversalBoth, reversalBoth);
    check("(d2) Service-GST reversal = full gstAmountInPaise (2500) at 100% refund fraction", reversalBoth.gstAmountInPaise === 2500, reversalBoth.gstAmountInPaise);
    check("(d3) Platform-fee-GST reversal = full platformFeeGstAmountInPaise (360) at 100% refund fraction", reversalBoth.platformFeeGstAmountInPaise === 360, reversalBoth.platformFeeGstAmountInPaise);

    await makeRefund(52360, 52360, "rfnd_full_feeonly");
    const reversalFeeOnly = await createRefundReversalLedger({ revenueSplit: feeOnlySplit, refundId: "rfnd_full_feeonly" });
    check("(d4) Fee-GST-only reversal created even though service-GST component is 0 (not silently dropped)", !!reversalFeeOnly, reversalFeeOnly);
    check("(d5) Fee-GST-only reversal's service component is 0 (correctly null-safe, not crashing on 0*fraction)", reversalFeeOnly.gstAmountInPaise === 0, reversalFeeOnly.gstAmountInPaise);
    check("(d6) Fee-GST-only reversal's platform-fee component correctly apportioned (360)", reversalFeeOnly.platformFeeGstAmountInPaise === 360, reversalFeeOnly.platformFeeGstAmountInPaise);

    // Partial (50%) refund on the both-GST split, a second independent refundId.
    await makeRefund(54860, 27430, "rfnd_half_both");
    const halfGstSplit = await makeRevenueSplit({ platformFeeGstRatePercent: 18, platformFeeGstAmountInPaise: 360 });
    await createSaleLedger({ revenueSplit: halfGstSplit });
    const reversalHalf = await createRefundReversalLedger({ revenueSplit: halfGstSplit, refundId: "rfnd_half_both" });
    check("(d7) 50% refund reverses ~half of service GST (1250 of 2500)", reversalHalf.gstAmountInPaise === 1250, reversalHalf.gstAmountInPaise);
    check("(d8) 50% refund reverses ~half of platform-fee GST (180 of 360)", reversalHalf.platformFeeGstAmountInPaise === 180, reversalHalf.platformFeeGstAmountInPaise);

    // ════════════════════════════════════════════════════════════
    // (e) splitRefundComponents' new 4th component.
    // ════════════════════════════════════════════════════════════
    const split4 = splitRefundComponents({
      refundFraction: 1,
      serviceAmountInPaise: 50000,
      commissionAmountInPaise: 2000,
      gstAmountInPaise: 2500,
      platformFeeGstAmountInPaise: 360,
    });
    check("(e1) platformFeeGstRefundPaise present and correct (360 at 100%)", split4.platformFeeGstRefundPaise === 360, split4);
    check("(e2) totalRefundPaise sums all 4 components (50000+2000+2500+360=54860)", split4.totalRefundPaise === 54860, split4.totalRefundPaise);

    const split4null = splitRefundComponents({
      refundFraction: 1,
      serviceAmountInPaise: 50000,
      commissionAmountInPaise: 2000,
      gstAmountInPaise: null,
      platformFeeGstAmountInPaise: null,
    });
    check("(e3) null-guarded: a legacy booking with both GST fields null contributes 0 to each, never throws", split4null.gstRefundPaise === 0 && split4null.platformFeeGstRefundPaise === 0 && split4null.totalRefundPaise === 52000, split4null);

    // ════════════════════════════════════════════════════════════
    // (f) GSTReportService — new parallel platform-fee-GST columns
    //     sum correctly from the SALE/REFUND_REVERSAL rows created
    //     above, and net = collected - reversed independently per
    //     component.
    // ════════════════════════════════════════════════════════════
    const thisYear = new Date().getUTCFullYear();
    const months = await getMonthlyTotals(thisYear);
    const thisMonth = months[new Date().getUTCMonth()];
    check("(f1) platformFeeGstCollectedInPaise aggregates across all SALE rows created this run (>=720 = 360*2 from saleBoth+saleFeeOnly, there's also halfGstSplit's own 360)", thisMonth.platformFeeGstCollectedInPaise >= 1080, thisMonth.platformFeeGstCollectedInPaise);
    check("(f2) platformFeeGstReversedInPaise aggregates across all REFUND_REVERSAL rows created this run (360+360+180=900)", thisMonth.platformFeeGstReversedInPaise === 900, thisMonth.platformFeeGstReversedInPaise);
    check("(f3) netPlatformFeeGstLiabilityInPaise = collected - reversed", thisMonth.netPlatformFeeGstLiabilityInPaise === thisMonth.platformFeeGstCollectedInPaise - thisMonth.platformFeeGstReversedInPaise);
    check("(f4) Existing service-GST columns are unaffected/still present and correctly summed", thisMonth.gstCollectedInPaise >= 2500 + 0 + 2500, thisMonth.gstCollectedInPaise);

    // ════════════════════════════════════════════════════════════
    // (g) End-to-end: createRevenueSplitForBooking() on a realistic
    //     CONFIRMED, Razorpay-paid booking now produces BOTH a
    //     RevenueSplit AND a GSTLedger SALE row — the exact gap
    //     confirmed live against the real dev DB (0 of 6 real
    //     completed bookings had either).
    // ════════════════════════════════════════════════════════════
    const booking = await Booking.create({
      userRef: oid(), salonRef: oid(), chairRef: oid(),
      serviceRefs: [oid()],
      bookingDate: "2026-10-12",
      startTime: new Date(), endTime: new Date(Date.now() + 30 * 60000),
      serviceDuration: 30,
      status: "CONFIRMED",
      razorpayOrderId: `order_${oid()}`,
      serviceAmountInPaise: 50000,
      commissionAmountInPaise: 2000,
      gstRatePercent: 0,                    // unregistered salon — legitimate 0
      gstAmountInPaise: 0,
      platformFeeGstRatePercent: 18,
      platformFeeGstAmountInPaise: 360,
      totalAmountInPaise: 52360,
    });
    const createdSplit = await createRevenueSplitForBooking({ booking });
    check("(g1) RevenueSplit IS created for a realistic CONFIRMED Razorpay booking (fixes the live-confirmed 0-of-6 gap)", !!createdSplit, createdSplit);
    check("(g2) RevenueSplit.platformFeeGstAmountInPaise copied verbatim from Booking (360)", createdSplit?.platformFeeGstAmountInPaise === 360, createdSplit?.platformFeeGstAmountInPaise);
    const createdLedger = await GSTLedger.findOne({ bookingId: booking._id, ledgerType: "SALE" }).lean();
    check("(g3) GSTLedger SALE row IS also created for this booking (fee-GST-only case, service GST=0)", !!createdLedger, createdLedger);
    check("(g4) The ledger row's taxableValueInPaise is the service amount (50000), reconciling correctly even though gstAmountInPaise=0", createdLedger?.taxableValueInPaise === 50000, createdLedger?.taxableValueInPaise);

  } finally {
    await mongoose.disconnect();
    await mem.stop();
  }

  console.log(rows.join("\n"));
  console.log(`\nGST LEDGER + PLATFORM-FEE GST FOUNDATION: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error("TEST SCRIPT CRASHED:", err);
  process.exit(1);
});
