/**
 * STRICTLY READ-ONLY follow-up check for the Final Finance Audit.
 * No writes anywhere in this file.
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../../config/db.js";
import AcquisitionClaim from "../../modules/fieldAgent/models/AcquisitionClaim.js";
import AcquisitionEarningProgress from "../../modules/fieldAgent/models/AcquisitionEarningProgress.js";
import FieldAgentEarningLedger from "../../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import Salon from "../../models/Salon.js";

const run = async () => {
  await connectDB();

  const progresses = await AcquisitionEarningProgress.find({}).lean();
  console.log(`Total AcquisitionEarningProgress docs: ${progresses.length}`);

  let realMismatch = 0, testMismatch = 0, realMatch = 0, testMatch = 0;

  for (const p of progresses) {
    const claim = await AcquisitionClaim.findById(p.acquisitionClaimRef).lean();
    const salon = claim ? await Salon.findById(claim.salonRef).select("basicInfo.shopName").lean() : null;
    const ledgerRows = await FieldAgentEarningLedger.find({ acquisitionClaimRef: p.acquisitionClaimRef, entitlementType: "ACQUISITION" }).lean();
    const sumCredited = ledgerRows.reduce((s, r) => s + (r.creditedAmountInPaise || 0), 0);
    const isTest = /ZE2E|TEST/i.test(salon?.basicInfo?.shopName || "");
    const match = sumCredited === p.earnedInPaise;
    if (isTest) { if (match) testMatch++; else testMismatch++; }
    else { if (match) realMatch++; else realMismatch++; }
    console.log(JSON.stringify({
      claimId: String(p.acquisitionClaimRef),
      shopName: salon?.basicInfo?.shopName || "(salon not found)",
      isTest,
      progressEarned: p.earnedInPaise,
      progressStatus: p.status,
      ledgerRowCount: ledgerRows.length,
      sumCredited,
      match,
    }));
  }

  console.log(`\nSummary: real-salon claims matching=${realMatch} mismatching=${realMismatch}; test-salon claims matching=${testMatch} mismatching=${testMismatch}`);

  await mongoose.connection.close();
};
run().catch(async (e) => { console.error(e); try { await mongoose.connection.close(); } catch {} process.exit(1); });
