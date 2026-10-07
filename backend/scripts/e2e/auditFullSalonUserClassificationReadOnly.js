/**
 * UPDATED FINANCE CLEANUP POLICY — fresh read-only classification.
 * STRICTLY READ-ONLY. No .create(/.save(/.update*(/.delete*(/$set.
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../../config/db.js";

import Salon from "../../models/Salon.js";
import User from "../../models/User.js";
import Booking from "../../models/Booking.js";
import Transaction from "../../models/Transaction.js";
import WalletTransaction from "../../models/WalletTransaction.js";
import WalletLedger from "../../models/WalletLedger.js";
import SalonEarnings from "../../models/SalonEarnings.js";
import PayoutRequest from "../../models/PayoutRequest.js";
import Refund from "../../models/Refund.js";
import AcquisitionClaim from "../../modules/fieldAgent/models/AcquisitionClaim.js";
import FieldAgent from "../../modules/fieldAgent/models/FieldAgent.js";

const section = (t) => console.log(`\n${"=".repeat(10)} ${t} ${"=".repeat(10)}`);
const j = (x) => JSON.stringify(x);

const TEST_NAME_RE = /ZE2E|TEST/i;

const run = async () => {
  await connectDB();

  // ════════════════════════════════════════════════════════════
  // ALL SALONS — full classification fields
  // ════════════════════════════════════════════════════════════
  section("ALL SALONS — full detail");
  const allSalons = await Salon.find({}).select("basicInfo.shopName approval.status ownerId onboarding.step onboarding.completed createdAt isDeleted").lean();
  console.log(`Total Salon documents: ${allSalons.length}`);

  const results = [];
  for (const s of allSalons) {
    const owner = await User.findById(s.ownerId).select("name phone role accountStatus createdAt").lean();
    const bookingCount = await Booking.countDocuments({ salonRef: s._id });
    const txnCount = await Transaction.countDocuments({ salonId: s._id });
    const wallet = await SalonEarnings.findOne({ entityType: "SALON", entityId: s._id }).select("_id availableBalanceInPaise pendingBalanceInPaise").lean();
    const claimCount = await AcquisitionClaim.countDocuments({ salonRef: s._id });

    const shopNameLooksTest = TEST_NAME_RE.test(s.basicInfo?.shopName || "");
    const ownerLooksTest = owner ? TEST_NAME_RE.test(owner.name || "") : false;
    const approvalStatus = s.approval?.status;
    const isApproved = approvalStatus === "APPROVED";

    results.push({
      salonId: String(s._id),
      shopName: s.basicInfo?.shopName ?? null,
      approvalStatus,
      ownerId: String(s.ownerId),
      ownerName: owner?.name ?? null,
      ownerPhone: owner?.phone ?? null,
      ownerRole: owner?.role ?? null,
      ownerAccountStatus: owner?.accountStatus ?? null,
      ownerCreatedAt: owner?.createdAt ?? null,
      onboardingStep: s.onboarding?.step ?? null,
      onboardingCompleted: s.onboarding?.completed ?? null,
      salonCreatedAt: s.createdAt,
      isApproved,
      shopNameLooksTest,
      ownerLooksTest,
      bookingCount,
      transactionCount: txnCount,
      hasWallet: !!wallet,
      walletAvailable: wallet?.availableBalanceInPaise ?? null,
      walletPending: wallet?.pendingBalanceInPaise ?? null,
      claimCount,
    });
  }

  for (const r of results) console.log(j(r));

  // ════════════════════════════════════════════════════════════
  // ALL distinct customer users who made a booking — test vs real heuristic
  // ════════════════════════════════════════════════════════════
  section("ALL distinct customer userRefs from Bookings");
  const customerIds = await Booking.distinct("userRef");
  console.log(`Distinct customer userRefs: ${customerIds.length}`);
  for (const uid of customerIds) {
    const u = await User.findById(uid).select("name phone role accountStatus createdAt").lean();
    const bCount = await Booking.countDocuments({ userRef: uid });
    const looksTest = u ? (TEST_NAME_RE.test(u.name || "") || /^(ZE2E|7000000|9000000)/.test(u.phone || "")) : null;
    console.log(j({ userId: String(uid), exists: !!u, name: u?.name ?? null, phone: u?.phone ?? null, role: u?.role ?? null, accountStatus: u?.accountStatus ?? null, bookingCount: bCount, looksTest }));
  }

  // ════════════════════════════════════════════════════════════
  // Distinct salon owner users — classification
  // ════════════════════════════════════════════════════════════
  section("ALL distinct Salon owner userRefs");
  const ownerIds = await Salon.distinct("ownerId");
  console.log(`Distinct owner userRefs: ${ownerIds.length}`);
  for (const oid of ownerIds) {
    const u = await User.findById(oid).select("name phone role accountStatus createdAt").lean();
    const salonsOwned = await Salon.countDocuments({ ownerId: oid });
    const looksTest = u ? (TEST_NAME_RE.test(u.name || "") || /^(ZE2E|7000000|9000000)/.test(u.phone || "")) : null;
    console.log(j({ ownerId: String(oid), exists: !!u, name: u?.name ?? null, phone: u?.phone ?? null, role: u?.role ?? null, accountStatus: u?.accountStatus ?? null, salonsOwned, looksTest }));
  }

  // ════════════════════════════════════════════════════════════
  // PayoutRequest (legacy salon model) — test classification
  // ════════════════════════════════════════════════════════════
  section("PayoutRequest (legacy, salon) — all rows");
  const payouts = await PayoutRequest.find({}).select("salonId amountInPaise status createdAt").lean();
  for (const p of payouts) {
    const salon = await Salon.findById(p.salonId).select("basicInfo.shopName approval.status").lean();
    console.log(j({ payoutId: String(p._id), salonId: String(p.salonId), shopName: salon?.basicInfo?.shopName ?? "(salon not found)", salonApproval: salon?.approval?.status ?? null, amountInPaise: p.amountInPaise, status: p.status, createdAt: p.createdAt }));
  }

  // ════════════════════════════════════════════════════════════
  // Refund — classification
  // ════════════════════════════════════════════════════════════
  section("Refund — the 1 row");
  const refunds = await Refund.find({}).select("bookingId amountInPaise refundStatus createdAt").lean();
  for (const r of refunds) {
    const booking = r.bookingId ? await Booking.findById(r.bookingId).select("salonRef").lean() : null;
    const salon = booking ? await Salon.findById(booking.salonRef).select("basicInfo.shopName").lean() : null;
    console.log(j({ refundId: String(r._id), bookingId: r.bookingId ? String(r.bookingId) : null, bookingExists: !!booking, salonShopName: salon?.basicInfo?.shopName ?? "(unknown)", amountInPaise: r.amountInPaise, status: r.refundStatus }));
  }

  // ════════════════════════════════════════════════════════════
  // FieldAgent accounts — confirm which are test vs real
  // ════════════════════════════════════════════════════════════
  section("FieldAgent documents — all, with owning user");
  const agents = await FieldAgent.find({}).select("userRef operationalStatus createdAt").lean();
  for (const a of agents) {
    const u = await User.findById(a.userRef).select("name phone accountStatus").lean();
    console.log(j({ fieldAgentId: String(a._id), userId: String(a.userRef), name: u?.name ?? null, phone: u?.phone ?? null, accountStatus: u?.accountStatus ?? null, operationalStatus: a.operationalStatus }));
  }

  await mongoose.connection.close();
};

run().catch(async (err) => {
  console.error("AUDIT FAILED:", err);
  try { await mongoose.connection.close(); } catch {}
  process.exit(1);
});
