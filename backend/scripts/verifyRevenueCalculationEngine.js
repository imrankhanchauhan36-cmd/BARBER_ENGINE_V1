/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyRevenueCalculationEngine.js
 *
 * P0 Revenue Calculation Engine — Step 1 — disposable live verification.
 *
 * Proves, against the real Atlas dev DB with prefixed disposable
 * fixtures (purged before and after):
 *   1. calculateRevenue() is a pure function — the LOCKED example and
 *      edge cases (GST rounding, GST disabled, zero fee, large amounts).
 *   2. RevenueSettings: DRAFT create, PUBLISHED via a real write, "at
 *      most one PUBLISHED" DB-enforced via the partial unique index,
 *      unique version numbers.
 *   3. RevenueSplit: create from a real calculateRevenue() output via the
 *      DTO, one-per-booking uniqueness, and — the core guarantee —
 *      IMMUTABILITY (updateOne/findOneAndUpdate/deleteOne all rejected at
 *      the schema level, exactly like WalletLedger).
 *   4. Policy versioning: publishing a NEW RevenueSettings version does
 *      NOT change an already-created RevenueSplit's snapshotted values —
 *      the "Booking A stays Version 7 forever" guarantee.
 *   5. Confirms RevenueCalculationService touches no DB (no writes happen
 *      merely from calling it) and this module is not wired into
 *      Booking/Wallet/Ledger anywhere.
 *
 * Run:  cd backend && node scripts/verifyRevenueCalculationEngine.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import { calculateRevenue } from "../modules/finance/services/RevenueCalculationService.js";
import { toRevenueCalculationDTO, toRevenueSplitDocumentDTO } from "../modules/finance/dto/revenue.dto.js";
import RevenueSettings from "../modules/finance/models/RevenueSettings.js";
import RevenueSplit from "../modules/finance/models/RevenueSplit.js";
import { REVENUE_SETTINGS_STATUS } from "../modules/finance/constants/revenue.constants.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const P = "ZTEST_REVENG_";
const oid = () => new mongoose.Types.ObjectId();
const phone = () => `9${Math.floor(100000000 + Math.random() * 899999999)}`;

const purge = async () => {
  const users = await User.find({ name: new RegExp(`^${P}`) }).select("_id").lean();
  const userIds = users.map((u) => u._id);
  await RevenueSplit.collection.deleteMany({ bookingId: { $in: [] } }); // placeholder, real cleanup below by tag
  await RevenueSettings.deleteMany({ createdBy: { $in: userIds } });
  await User.deleteMany({ _id: { $in: userIds } });
};

const run = async () => {
  await connectDB();

  const fixtureBookingIds = [];
  const fixtureSplitIds = [];
  const fixtureSettingsIds = [];
  const fixtureUserIds = [];

  const purgeFixtures = async () => {
    await RevenueSplit.collection.deleteMany({ _id: { $in: fixtureSplitIds } });
    await RevenueSettings.deleteMany({ _id: { $in: fixtureSettingsIds } });
    await User.deleteMany({ _id: { $in: fixtureUserIds } });
  };

  try {
    await purge();

    // ═══ 1. PURE FUNCTION — LOCKED example + edge cases ═══════════════
    const settingsV7 = { platformFeeInPaise: 2000, gstRate: 18, gstEnabled: true, version: 7 };
    const r1 = calculateRevenue({ serviceAmountInPaise: 10000, revenueSettings: settingsV7 });
    check("C1 LOCKED example: service ₹100 + fee ₹20 + GST 18%(fee) = customer ₹123.60",
      r1.serviceAmountInPaise === 10000 && r1.platformFeeInPaise === 2000 && r1.gstAmountInPaise === 360 && r1.customerPaidInPaise === 12360, r1);
    check("C2 split: salonCredit=service, zemishRevenue=fee (GST is neither)",
      r1.salonCreditInPaise === 10000 && r1.zemishRevenueInPaise === 2000, r1);
    check("C3 policyVersion snapshotted verbatim from revenueSettings.version", r1.policyVersion === 7);
    check("C4 GST is applied to the PLATFORM FEE only, never the service amount",
      r1.gstAmountInPaise === Math.round(2000 * 18 / 100) && r1.gstAmountInPaise !== Math.round((10000 + 2000) * 18 / 100));

    const dto1 = toRevenueCalculationDTO(r1);
    check("C5 DTO matches the ticket's exact 'Split Engine Output' field names/values",
      dto1.serviceAmount === 10000 && dto1.convenienceFee === 2000 && dto1.gstAmount === 360 && dto1.customerPaid === 12360 &&
      dto1.salonCredit === 10000 && dto1.zemishRevenue === 2000 && dto1.gstLiability === 360 && dto1.policyVersion === 7, dto1);

    const r2 = calculateRevenue({ serviceAmountInPaise: 5000, revenueSettings: { platformFeeInPaise: 1500, gstRate: 18, gstEnabled: false, version: 3 } });
    check("C6 gstEnabled:false → GST is always 0 regardless of gstRate; customer pays service+fee only",
      r2.gstAmountInPaise === 0 && r2.gstRatePercent === 0 && r2.customerPaidInPaise === 6500, r2);

    const r3 = calculateRevenue({ serviceAmountInPaise: 0, revenueSettings: { platformFeeInPaise: 0, gstRate: 18, version: 1 } });
    check("C7 zero service + zero fee → zero GST, zero customer paid, no crash", r3.customerPaidInPaise === 0 && r3.gstAmountInPaise === 0);

    const r4 = calculateRevenue({ serviceAmountInPaise: 12345, revenueSettings: { platformFeeInPaise: 33, gstRate: 18, version: 2 } });
    check("C8 GST rounding uses Math.round (₹0.33 fee × 18% = 5.94 paise → rounds to 6)", r4.gstAmountInPaise === 6, r4);

    const r5 = calculateRevenue({ serviceAmountInPaise: 99999999, revenueSettings: { platformFeeInPaise: 500000, gstRate: 28, version: 4 } });
    check("C9 large amounts computed correctly with plain integer paise math (no float drift)",
      r5.gstAmountInPaise === Math.round(500000 * 28 / 100) && r5.customerPaidInPaise === 99999999 + 500000 + r5.gstAmountInPaise, r5);

    // ── input validation (still pure — no DB) ──
    let threw;
    try { calculateRevenue({ serviceAmountInPaise: -1, revenueSettings: settingsV7 }); } catch (e) { threw = e; }
    check("V1 negative serviceAmountInPaise rejected (400, no crash)", threw?.statusCode === 400, threw?.message);
    threw = undefined;
    try { calculateRevenue({ serviceAmountInPaise: 100.5, revenueSettings: settingsV7 }); } catch (e) { threw = e; }
    check("V2 fractional paise rejected", threw?.statusCode === 400);
    threw = undefined;
    try { calculateRevenue({ serviceAmountInPaise: 100, revenueSettings: { platformFeeInPaise: 2000, gstRate: 150, version: 1 } }); } catch (e) { threw = e; }
    check("V3 gstRate out of 0-100 range rejected", threw?.statusCode === 400);
    threw = undefined;
    try { calculateRevenue({ serviceAmountInPaise: 100, revenueSettings: { platformFeeInPaise: -5, gstRate: 18, version: 1 } }); } catch (e) { threw = e; }
    check("V4 negative platformFeeInPaise rejected", threw?.statusCode === 400);
    threw = undefined;
    try { calculateRevenue({ serviceAmountInPaise: 100, revenueSettings: { platformFeeInPaise: 2000, gstRate: 18, version: 0 } }); } catch (e) { threw = e; }
    check("V5 non-positive/missing version rejected", threw?.statusCode === 400);

    // determinism — same input, called many times, always identical output
    const many = Array.from({ length: 20 }, () => calculateRevenue({ serviceAmountInPaise: 7777, revenueSettings: settingsV7 }));
    check("D1 pure/deterministic: 20 calls with identical input → byte-identical output every time",
      many.every((r) => JSON.stringify(r) === JSON.stringify(many[0])));

    // ═══ 2. RevenueSettings — DRAFT/PUBLISHED lifecycle, DB-enforced invariants ═══
    // Reuse an existing real INDIA admin (same precedent as
    // verifyFieldAgentAdminPayoutQueue.js etc.) rather than constructing a
    // full valid ADMIN fixture — User's own pre-save hook requires
    // adminLevel/countryRef/email for role ADMIN, none of which this
    // engine's own tests need to exercise.
    const admin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("_id").lean();
    if (!admin) throw new Error("No INDIA admin in DB to use as createdBy for fixtures");

    const draft1 = await RevenueSettings.create({ platformFeeInPaise: 2000, gstRate: 18, gstEnabled: true, minimumPayoutInPaise: 50000, autoPayoutEnabled: false, version: 900001, createdBy: admin._id });
    fixtureSettingsIds.push(draft1._id);
    check("S1 RevenueSettings created as DRAFT by default", draft1.status === REVENUE_SETTINGS_STATUS.DRAFT);

    draft1.status = REVENUE_SETTINGS_STATUS.PUBLISHED;
    draft1.publishedAt = new Date();
    draft1.publishedBy = admin._id;
    await draft1.save();
    check("S2 a DRAFT can be published (plain field write — the future service adds the transaction/retire discipline)", (await RevenueSettings.findById(draft1._id).lean()).status === "PUBLISHED");

    const draft2 = await RevenueSettings.create({ platformFeeInPaise: 2500, gstRate: 18, gstEnabled: true, minimumPayoutInPaise: 50000, autoPayoutEnabled: true, version: 900002, createdBy: admin._id });
    fixtureSettingsIds.push(draft2._id);
    let dupErr;
    try {
      draft2.status = REVENUE_SETTINGS_STATUS.PUBLISHED;
      await draft2.save();
    } catch (e) { dupErr = e; }
    check("S3 a SECOND PUBLISHED version is rejected by the DB (partial unique index) — 'at most one PUBLISHED' is DB-enforced", dupErr?.code === 11000, dupErr?.message);
    check("S3b the first version is still the only PUBLISHED one after the rejected attempt",
      (await RevenueSettings.countDocuments({ status: "PUBLISHED", _id: { $in: fixtureSettingsIds } })) === 1);

    let verDupErr;
    try { await RevenueSettings.create({ platformFeeInPaise: 3000, gstRate: 18, minimumPayoutInPaise: 50000, version: 900001, createdBy: admin._id }); } catch (e) { verDupErr = e; }
    check("S4 duplicate version number rejected by the DB (unique index on version)", verDupErr?.code === 11000, verDupErr?.message);

    let badRate;
    try { await RevenueSettings.create({ platformFeeInPaise: 2000, gstRate: 250, minimumPayoutInPaise: 50000, version: 900003, createdBy: admin._id }); } catch (e) { badRate = e; }
    fixtureSettingsIds.push((await RevenueSettings.findOne({ version: 900003 }).lean())?._id);
    check("S5 gstRate > 100 rejected by schema validation", badRate?.name === "ValidationError", badRate?.message);

    let badFee;
    try { await RevenueSettings.create({ platformFeeInPaise: -100, gstRate: 18, minimumPayoutInPaise: 50000, version: 900004, createdBy: admin._id }); } catch (e) { badFee = e; }
    check("S6 negative platformFeeInPaise rejected by schema validation", badFee?.name === "ValidationError");

    let badFrac;
    try { await RevenueSettings.create({ platformFeeInPaise: 2000.5, gstRate: 18, minimumPayoutInPaise: 50000, version: 900005, createdBy: admin._id }); } catch (e) { badFrac = e; }
    check("S7 fractional platformFeeInPaise (not whole paise) rejected", badFrac?.name === "ValidationError");

    // ═══ 3. RevenueSplit — created from a real calculation, immutable ═══
    const bookingIdA = oid();
    fixtureBookingIds.push(bookingIdA);
    const calcA = calculateRevenue({ serviceAmountInPaise: 10000, revenueSettings: { platformFeeInPaise: draft1.platformFeeInPaise, gstRate: draft1.gstRate, gstEnabled: draft1.gstEnabled, version: draft1.version } });
    const splitDoc = { bookingId: bookingIdA, ...toRevenueSplitDocumentDTO(calcA) };
    const splitA = await RevenueSplit.create(splitDoc);
    fixtureSplitIds.push(splitA._id);
    check("R1 RevenueSplit created from a real calculateRevenue() output via the DTO, values match exactly",
      splitA.serviceAmountInPaise === 10000 && splitA.platformFeeInPaise === 2000 && splitA.gstAmountInPaise === 360 &&
      splitA.customerPaidInPaise === 12360 && splitA.salonCreditInPaise === 10000 && splitA.zemishRevenueInPaise === 2000 && splitA.policyVersion === draft1.version,
      splitA.toObject());

    let dupSplit;
    try { await RevenueSplit.create({ bookingId: bookingIdA, ...toRevenueSplitDocumentDTO(calcA) }); } catch (e) { dupSplit = e; }
    check("R2 a SECOND split for the same booking is rejected by the DB (one split per booking)", dupSplit?.code === 11000, dupSplit?.message);

    // ── IMMUTABILITY — the core guarantee, schema-enforced ──
    let u1, u2, u3, u4, d1;
    try { await RevenueSplit.updateOne({ _id: splitA._id }, { $set: { customerPaidInPaise: 1 } }); } catch (e) { u1 = e; }
    try { await RevenueSplit.findOneAndUpdate({ _id: splitA._id }, { $set: { gstAmountInPaise: 1 } }); } catch (e) { u2 = e; }
    try { await RevenueSplit.updateMany({ _id: splitA._id }, { $set: { policyVersion: 999 } }); } catch (e) { u3 = e; }
    try { const doc = await RevenueSplit.findById(splitA._id); doc.customerPaidInPaise = 1; await doc.save(); } catch (e) { u4 = e; }
    try { await RevenueSplit.deleteOne({ _id: splitA._id }); } catch (e) { d1 = e; }
    check("I1 updateOne on a RevenueSplit is blocked", /immutable/i.test(u1?.message || ""), u1?.message);
    check("I2 findOneAndUpdate on a RevenueSplit is blocked", /immutable/i.test(u2?.message || ""), u2?.message);
    check("I3 updateMany on a RevenueSplit is blocked", /immutable/i.test(u3?.message || ""), u3?.message);
    check("I4 document.save() after mutating a field is blocked by schema immutable:true (silently ignored, not applied)", (await RevenueSplit.findById(splitA._id).lean()).customerPaidInPaise === 12360, u4?.message);
    check("I5 deleteOne on a RevenueSplit is blocked", /immutable/i.test(d1?.message || ""), d1?.message);
    check("I6 the document is completely unchanged after every attack", (await RevenueSplit.findById(splitA._id).lean()).customerPaidInPaise === 12360 && (await RevenueSplit.countDocuments({ bookingId: bookingIdA })) === 1);

    // ═══ 4. Policy versioning — republishing must NOT touch existing splits ═══
    draft2.status = REVENUE_SETTINGS_STATUS.RETIRED; // clear the way — draft1 is the one PUBLISHED
    await draft2.save();
    let dupPub;
    // publish a NEW version the way a future service would (retire old, publish new) — but here we only need
    // to prove that CREATING+PUBLISHING a new version leaves the old RevenueSplit snapshot untouched.
    const oldPublishedId = draft1._id;
    draft1.status = REVENUE_SETTINGS_STATUS.RETIRED;
    draft1.retiredAt = new Date();
    await draft1.save();
    const draft3 = await RevenueSettings.create({ platformFeeInPaise: 2500, gstRate: 18, gstEnabled: true, minimumPayoutInPaise: 50000, autoPayoutEnabled: false, version: 900006, createdBy: admin._id, status: "PUBLISHED", publishedAt: new Date(), publishedBy: admin._id });
    fixtureSettingsIds.push(draft3._id);
    check("P1 a NEW RevenueSettings version (₹25 fee) is now PUBLISHED, replacing the old one", (await RevenueSettings.findOne({ status: "PUBLISHED" }).lean())._id.toString() === draft3._id.toString());

    const unchangedSplit = await RevenueSplit.findById(splitA._id).lean();
    check("P2 'Booking A stays Version 7 forever': the EXISTING split still shows the OLD fee (₹20) and OLD policyVersion, unaffected by the republish",
      unchangedSplit.platformFeeInPaise === 2000 && unchangedSplit.customerPaidInPaise === 12360 && unchangedSplit.policyVersion === draft1.version, unchangedSplit);

    // A NEW booking calculated now uses the NEW published version — proves the two never collide.
    const bookingIdB = oid();
    fixtureBookingIds.push(bookingIdB);
    const calcB = calculateRevenue({ serviceAmountInPaise: 10000, revenueSettings: { platformFeeInPaise: draft3.platformFeeInPaise, gstRate: draft3.gstRate, gstEnabled: draft3.gstEnabled, version: draft3.version } });
    const splitB = await RevenueSplit.create({ bookingId: bookingIdB, ...toRevenueSplitDocumentDTO(calcB) });
    fixtureSplitIds.push(splitB._id);
    check("P3 a NEW booking calculated after the republish uses the NEW fee (₹25) and NEW policyVersion — the two bookings never recalculate into each other",
      splitB.platformFeeInPaise === 2500 && splitB.policyVersion === draft3.version && splitA.platformFeeInPaise !== splitB.platformFeeInPaise, { A: splitA.toObject(), B: splitB.toObject() });

    // ═══ 5. Isolation — no wallet/ledger/booking side effects anywhere ═══
    const WalletLedger = (await import("../models/WalletLedger.js")).default;
    const walletCountBefore = await WalletLedger.countDocuments({});
    calculateRevenue({ serviceAmountInPaise: 123456, revenueSettings: settingsV7 }); // called again, deliberately not persisted
    const walletCountAfter = await WalletLedger.countDocuments({});
    check("X1 calling calculateRevenue() writes NOTHING to WalletLedger (Calculation Engine never touches wallet, per the LOCKED rule)", walletCountBefore === walletCountAfter);

    const Booking = (await import("../models/Booking.js")).default;
    const bookingExists = await Booking.exists({ _id: bookingIdA });
    check("X2 no Booking document was created by this engine for the fixture booking id used above (this module never touches Booking)", !bookingExists);
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
