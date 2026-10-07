/**
 * STRICTLY READ-ONLY. Fresh exact counts after the partial cleanup run
 * halted on FieldAgentEarningLedger's immutability guard.
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
import RevenueSplit from "../../modules/finance/models/RevenueSplit.js";
import GSTLedger from "../../modules/finance/models/GSTLedger.js";
import AcquisitionClaim from "../../modules/fieldAgent/models/AcquisitionClaim.js";
import AcquisitionEarningProgress from "../../modules/fieldAgent/models/AcquisitionEarningProgress.js";
import FieldAgentEarningLedger from "../../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import FieldAgentEarningPolicyGap from "../../modules/fieldAgent/models/FieldAgentEarningPolicyGap.js";

const run = async () => {
  await connectDB();
  const counts = {
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
  console.log(JSON.stringify(counts, null, 2));

  const approved = await Salon.countDocuments({ "approval.status": "APPROVED" });
  console.log(`APPROVED salon count: ${approved}`);
  const openGaps = await FieldAgentEarningPolicyGap.countDocuments({ status: "OPEN" });
  console.log(`OPEN policy gap count: ${openGaps}`);
  const ridaExists = await Salon.exists({ _id: new mongoose.Types.ObjectId("6a4f67e237bba49fad164506") });
  console.log(`Rida beauty parlor still exists: ${!!ridaExists}`);

  await mongoose.connection.close();
};
run().catch(async (e) => { console.error(e); try { await mongoose.connection.close(); } catch {} process.exit(1); });
