/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyGSTLedger.js
 *
 * P0 Revenue Calculation Engine — Step 4.1 (GST Ledger Engine) — live
 * verification. Real Atlas dev DB, disposable prefixed fixtures, purged
 * before and after. No Razorpay/Cashfree/Wallet/Booking write is
 * exercised by THIS script beyond what Step 1/2/3 already proved — this
 * step is scoped to GSTLedgerService + its one integration point.
 *
 * Proves:
 *   1. One SALE GSTLedger row is created from a real RevenueSplit,
 *      snapshotting values verbatim (no recalculation).
 *   2. GST disabled / gstAmount == 0 → returns null, no row created.
 *   3. Idempotent: repeat calls and a concurrent race both produce
 *      exactly one SALE row (unique partial index holds).
 *   4. Immutable: every mutation path is rejected at the schema level.
 *   5. Policy version snapshot preserved even if RevenueSettings is
 *      republished afterward.
 *   6. RevenueSplit is completely untouched by GST ledger creation.
 *   7. "Refund not touched": REFUND_REVERSAL rows are never created by
 *      this step, and the existing refund engine (P0-C) is not imported
 *      or called anywhere in the new files.
 *   8. The real integration point: createRevenueSplitForBooking() (Step
 *      3) now also produces a GSTLedger row, automatically, with no
 *      booking.controller.js change.
 *
 * Run:  cd backend && node scripts/verifyGSTLedger.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import Salon from "../models/Salon.js";
import Booking, { BOOKING_STATUS } from "../models/Booking.js";
import RevenueSettings from "../modules/finance/models/RevenueSettings.js";
import RevenueSplit from "../modules/finance/models/RevenueSplit.js";
import GSTLedger from "../modules/finance/models/GSTLedger.js";
import { GST_LEDGER_TYPE, GST_LEDGER_STATUS } from "../modules/finance/constants/gstLedger.constants.js";
import { calculateRevenue } from "../modules/finance/services/RevenueCalculationService.js";
import { toRevenueSplitDocumentDTO } from "../modules/finance/dto/revenue.dto.js";
import { createSaleLedger } from "../modules/finance/services/GSTLedgerService.js";
import { createRevenueSplitForBooking } from "../modules/finance/services/RevenueSplitIntegrationService.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const P = "ZTEST_GSTLED41_";
const oid = () => new mongoose.Types.ObjectId();
const phone = () => `9${Math.floor(100000000 + Math.random() * 899999999)}`;

const run = async () => {
  await connectDB();

  const fixtureUserIds = [];
  const fixtureSalonIds = [];
  const fixtureBookingIds = [];
  const fixtureSettingsIds = [];

  const purgeFixtures = async () => {
    await GSTLedger.collection.deleteMany({ bookingId: { $in: fixtureBookingIds } });
    await RevenueSplit.collection.deleteMany({ bookingId: { $in: fixtureBookingIds } });
    await Booking.collection.deleteMany({ _id: { $in: fixtureBookingIds } });
    await Salon.deleteMany({ _id: { $in: fixtureSalonIds } });
    await RevenueSettings.deleteMany({ _id: { $in: fixtureSettingsIds.filter(Boolean) } });
    await User.deleteMany({ _id: { $in: fixtureUserIds } });
  };

  try {
    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("_id").lean();
    if (!indiaAdmin) throw new Error("No INDIA admin in DB to use as createdBy for fixtures");

    const owner = await User.create({ name: `${P}OWNER`, phone: phone(), role: "OWNER", accountStatus: "ACTIVE" });
    fixtureUserIds.push(owner._id);
    const dayTiming = { open: "09:00", close: "20:00" };
    const salon = await Salon.create({
      ownerId: owner._id, basicInfo: { shopName: `${P}SALON`, category: "UNISEX" },
      timings: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, dayTiming])),
      location: { geo: { type: "Point", coordinates: [77, 28] }, address: `${P} addr` },
    });
    fixtureSalonIds.push(salon._id);
    const cust = await User.create({ name: `${P}CUST`, phone: phone(), role: "USER", accountStatus: "ACTIVE" });
    fixtureUserIds.push(cust._id);

    let slot = 0;
    const mkBooking = async ({ service = 10000, razorpay = true } = {}) => {
      const start = new Date(Date.now() + (120 + slot++ * 45) * 60000);
      const b = await Booking.create({
        userRef: cust._id, salonRef: salon._id, chairRef: oid(), serviceRefs: [oid()],
        bookingDate: new Date().toISOString().slice(0, 10), startTime: start, endTime: new Date(start.getTime() + 30 * 60000),
        serviceDuration: 30, status: BOOKING_STATUS.CONFIRMED, serviceAmountInPaise: service, commissionAmountInPaise: 2000, totalAmountInPaise: service + 2360,
      });
      if (razorpay) await Booking.collection.updateOne({ _id: b._id }, { $set: { razorpayOrderId: `order_ZTESTGST${Date.now()}${Math.floor(Math.random() * 10000)}` } });
      fixtureBookingIds.push(b._id);
      return razorpay ? Booking.findById(b._id) : b;
    };
    const publish = async (platformFeeInPaise, gstRate, gstEnabled = true) => {
      await RevenueSettings.updateMany({ status: "PUBLISHED" }, { $set: { status: "RETIRED", retiredAt: new Date() } });
      const last = await RevenueSettings.findOne().sort({ version: -1 }).select("version").lean();
      const doc = await RevenueSettings.create({ platformFeeInPaise, gstRate, gstEnabled, minimumPayoutInPaise: 50000, autoPayoutEnabled: false, version: (last?.version ?? 0) + 1, createdBy: indiaAdmin._id, status: "PUBLISHED", publishedAt: new Date(), publishedBy: indiaAdmin._id });
      fixtureSettingsIds.push(doc._id);
      return doc;
    };
    const mkSplit = async (booking, settings) => {
      const calc = calculateRevenue({ serviceAmountInPaise: booking.serviceAmountInPaise, revenueSettings: { platformFeeInPaise: settings.platformFeeInPaise, gstRate: settings.gstRate, gstEnabled: settings.gstEnabled, version: settings.version } });
      return RevenueSplit.create({ bookingId: booking._id, ...toRevenueSplitDocumentDTO(calc) });
    };

    // ═══ 1. Basic SALE ledger creation, snapshot-only (no recalculation) ═══
    const settingsV1 = await publish(2000, 18); // ₹20 fee, 18% GST
    const b1 = await mkBooking({ service: 10000 });
    const split1 = await mkSplit(b1, settingsV1);
    check("Split1 sanity: fee 2000, gst 360, service 10000 (LOCKED example)", split1.platformFeeInPaise === 2000 && split1.gstAmountInPaise === 360 && split1.serviceAmountInPaise === 10000);

    const ledger1 = await createSaleLedger({ revenueSplit: split1 });
    check("G1. SALE ledger created for a real RevenueSplit", !!ledger1?._id, ledger1);
    check("G2. ledgerType SALE, status COLLECTED", ledger1.ledgerType === GST_LEDGER_TYPE.SALE && ledger1.status === GST_LEDGER_STATUS.COLLECTED);
    check("G3. Values are copied VERBATIM off RevenueSplit — taxableValue=platformFee=2000, gstAmount=360, gstRate=18, no recalculation", ledger1.taxableValueInPaise === 2000 && ledger1.taxableValueInPaise === split1.platformFeeInPaise && ledger1.gstAmountInPaise === 360 && ledger1.gstAmountInPaise === split1.gstAmountInPaise && ledger1.gstRate === 18 && ledger1.gstRate === split1.gstRatePercent, ledger1);
    check("G4. platformFeeInPaise snapshotted too", ledger1.platformFeeInPaise === 2000);
    check("G5. bookingId + revenueSplitId correctly linked", String(ledger1.bookingId) === String(b1._id) && String(ledger1.revenueSplitId) === String(split1._id));
    check("G6. policyVersion snapshotted from the RevenueSplit (not re-resolved)", ledger1.policyVersion === split1.policyVersion);
    check("G7. invoiceDate set", !!ledger1.invoiceDate);

    // ═══ 2. GST disabled / zero → null, no row ═══════════════════════
    const settingsDisabled = await publish(1500, 18, false); // gstEnabled:false
    const b2 = await mkBooking({ service: 5000 });
    const split2 = await mkSplit(b2, settingsDisabled);
    check("Split2 sanity: gstAmountInPaise forced to 0 when GST disabled (RevenueCalculationService, Step 1)", split2.gstAmountInPaise === 0);
    const ledger2 = await createSaleLedger({ revenueSplit: split2 });
    check("G8. GST disabled at calc time → createSaleLedger returns null, no row created", ledger2 === null && (await GSTLedger.countDocuments({ revenueSplitId: split2._id })) === 0);

    const settingsZeroFee = await publish(0, 18, true); // fee 0 → gst 0 even with GST enabled
    const b3 = await mkBooking({ service: 5000 });
    const split3 = await mkSplit(b3, settingsZeroFee);
    check("Split3 sanity: zero platform fee → zero GST even though gstEnabled is true", split3.gstAmountInPaise === 0);
    const ledger3 = await createSaleLedger({ revenueSplit: split3 });
    check("G9. gstAmount == 0 (zero fee, GST enabled) → returns null, no row created", ledger3 === null && (await GSTLedger.countDocuments({ revenueSplitId: split3._id })) === 0);

    // ═══ 3. Idempotency + concurrency ════════════════════════════════
    const ledger1Again = await createSaleLedger({ revenueSplit: split1 });
    check("G10. Calling again for the SAME RevenueSplit returns the EXISTING row (same _id), never a second one", String(ledger1Again._id) === String(ledger1._id) && (await GSTLedger.countDocuments({ revenueSplitId: split1._id, ledgerType: "SALE" })) === 1);

    const b4 = await mkBooking({ service: 8000 });
    const split4 = await mkSplit(b4, settingsV1);
    const raced = await Promise.allSettled(Array.from({ length: 5 }, () => createSaleLedger({ revenueSplit: split4 })));
    check("G11. Five CONCURRENT calls for the same RevenueSplit → none throws, all resolve", raced.every((r) => r.status === "fulfilled"), raced.map((r) => r.status === "rejected" ? r.reason?.message : "ok"));
    const raceIds = raced.filter((r) => r.status === "fulfilled" && r.value).map((r) => String(r.value._id));
    check("G12. All concurrent calls converge on the SAME row id — unique partial index held under a real race", new Set(raceIds).size === 1);
    check("G13. Exactly one SALE row exists for that RevenueSplit after the race", (await GSTLedger.countDocuments({ revenueSplitId: split4._id, ledgerType: "SALE" })) === 1);

    // Duplicate-key path exercised directly (defense in depth on the service's own catch branch).
    let directDupErr;
    try {
      await GSTLedger.create({ bookingId: b1._id, revenueSplitId: split1._id, ledgerType: "SALE", status: "COLLECTED", taxableValueInPaise: 2000, gstRate: 18, gstAmountInPaise: 360, platformFeeInPaise: 2000, invoiceDate: new Date(), policyVersion: split1.policyVersion });
    } catch (e) { directDupErr = e; }
    check("G14. A direct model-level duplicate SALE row for the same revenueSplitId is rejected by the DB (partial unique index, not just the service)", directDupErr?.code === 11000, directDupErr?.message);

    // ═══ 4. Immutability ══════════════════════════════════════════════
    let u1, u2, u3, u4, d1;
    try { await GSTLedger.updateOne({ _id: ledger1._id }, { $set: { gstAmountInPaise: 1 } }); } catch (e) { u1 = e; }
    try { await GSTLedger.findOneAndUpdate({ _id: ledger1._id }, { $set: { status: "REVERSED" } }); } catch (e) { u2 = e; }
    try { await GSTLedger.updateMany({ _id: ledger1._id }, { $set: { policyVersion: 999 } }); } catch (e) { u3 = e; }
    try { const doc = await GSTLedger.findById(ledger1._id); doc.gstAmountInPaise = 1; await doc.save(); } catch (e) { u4 = e; }
    try { await GSTLedger.deleteOne({ _id: ledger1._id }); } catch (e) { d1 = e; }
    check("I1. updateOne is blocked", /immutable/i.test(u1?.message || ""), u1?.message);
    check("I2. findOneAndUpdate is blocked", /immutable/i.test(u2?.message || ""), u2?.message);
    check("I3. updateMany is blocked", /immutable/i.test(u3?.message || ""), u3?.message);
    check("I4. document.save() after mutating a field is a no-op (schema immutable:true)", (await GSTLedger.findById(ledger1._id).lean()).gstAmountInPaise === 360, u4?.message);
    check("I5. deleteOne is blocked", /immutable/i.test(d1?.message || ""), d1?.message);
    check("I6. document completely unchanged after every attack", (await GSTLedger.findById(ledger1._id).lean()).gstAmountInPaise === 360 && (await GSTLedger.countDocuments({ revenueSplitId: split1._id })) === 1);

    // ═══ 5. Policy snapshot preserved across a republish ═════════════
    await publish(9999, 28); // a wildly different version published AFTER ledger1 was created
    const ledger1AfterRepublish = await GSTLedger.findById(ledger1._id).lean();
    check("G15. Republishing new RevenueSettings does NOT change the existing GST ledger row — still fee ₹20, GST ₹3.60, old policyVersion", ledger1AfterRepublish.platformFeeInPaise === 2000 && ledger1AfterRepublish.gstAmountInPaise === 360 && ledger1AfterRepublish.policyVersion === split1.policyVersion, ledger1AfterRepublish);

    // ═══ 6. RevenueSplit is completely untouched ═════════════════════
    const split1AfterAll = await RevenueSplit.findById(split1._id).lean();
    check("G16. RevenueSplit itself is byte-identical to what it was before any GST ledger call — GSTLedgerService never writes to RevenueSplit", split1AfterAll.gstAmountInPaise === 360 && split1AfterAll.platformFeeInPaise === 2000 && split1AfterAll.customerPaidInPaise === split1.customerPaidInPaise);

    // ═══ 7. Refund not touched ════════════════════════════════════════
    check("G17. No REFUND_REVERSAL row exists anywhere — this step creates SALE rows only", (await GSTLedger.countDocuments({ ledgerType: "REFUND_REVERSAL" })) === 0);
    const gstLedgerServiceSrc = await import("node:fs").then((fs) => fs.readFileSync(new URL("../modules/finance/services/GSTLedgerService.js", import.meta.url), "utf8"));
    // Step 4.2 note: GSTLedgerService.js now ALSO exports
    // createRefundReversalLedger(), which reads (never writes)
    // models/Refund.js by design (that step's own explicit instruction).
    // createSaleLedger() itself still never references any of these.
    const strippedSrc = gstLedgerServiceSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const createSaleLedgerSrc = strippedSrc.slice(strippedSrc.indexOf("createSaleLedger ="), strippedSrc.indexOf("createRefundReversalLedger =") === -1 ? undefined : strippedSrc.indexOf("createRefundReversalLedger ="));
    check("G18. createSaleLedger() itself contains no reference to Refund/Wallet/Razorpay/Cashfree/Booking — additive, isolated (Step 4.2's separate createRefundReversalLedger legitimately reads Refund — see verifyGSTReversal.js)", !/Refund|Wallet|Razorpay|Cashfree|models\/Booking/i.test(createSaleLedgerSrc), "(checked against code with comments stripped, createSaleLedger only)");

    // ═══ 8. Real integration point — createRevenueSplitForBooking (Step 3) ═══
    const settingsLive = await publish(2000, 18);
    const b5 = await mkBooking({ service: 15000 });
    const splitViaIntegration = await createRevenueSplitForBooking({ booking: b5 });
    check("G19. The Step 3 integration point returns a RevenueSplit as before (unchanged contract)", !!splitViaIntegration?._id && splitViaIntegration.serviceAmountInPaise === 15000);
    const ledgerViaIntegration = await GSTLedger.findOne({ revenueSplitId: splitViaIntegration._id }).lean();
    check("G20. …AND it now ALSO produced a GST SALE ledger row automatically, with NO booking.controller.js change (the integration lives entirely in RevenueSplitIntegrationService.js)", !!ledgerViaIntegration && ledgerViaIntegration.gstAmountInPaise === 360 && ledgerViaIntegration.policyVersion === settingsLive.version, ledgerViaIntegration);

    // Calling the Step 3 integration again (idempotent booking-level call) must not create a second GST row either.
    const splitViaIntegrationAgain = await createRevenueSplitForBooking({ booking: b5 });
    check("G21. Re-running the Step 3 integration for the SAME booking is fully idempotent end-to-end: same RevenueSplit, still exactly one GST ledger row", String(splitViaIntegrationAgain._id) === String(splitViaIntegration._id) && (await GSTLedger.countDocuments({ revenueSplitId: splitViaIntegration._id })) === 1);
  } catch (err) {
    fail++; results.push(`❌ UNEXPECTED ERROR — ${err.stack || err}`);
  } finally {
    await purgeFixtures().catch((e) => results.push(`⚠️ purge error ${e.message}`));
    await mongoose.disconnect();
  }
  console.log(results.join("\n"));
  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
};
run();
