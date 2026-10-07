/**
 * STRICTLY READ-ONLY. Determines how much of the current dataset is
 * real vs disposable-test, across the collections that matter for the
 * Final Finance Audit's deletion plan.
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../../config/db.js";
import Salon from "../../models/Salon.js";
import Booking from "../../models/Booking.js";
import Transaction from "../../models/Transaction.js";
import AcquisitionClaim from "../../modules/fieldAgent/models/AcquisitionClaim.js";
import Refund from "../../models/Refund.js";

const run = async () => {
  await connectDB();

  const salonTotal = await Salon.countDocuments({});
  const testSalonCount = await Salon.countDocuments({ "basicInfo.shopName": { $regex: /ZE2E|TEST/i } });
  console.log(`Salons total: ${salonTotal}, test-named: ${testSalonCount}, presumed-real: ${salonTotal - testSalonCount}`);

  // Claims whose salonRef still resolves to an EXISTING salon, split by whether that salon is test-named.
  const claims = await AcquisitionClaim.find({}).select("_id salonRef status").lean();
  let claimSalonMissing = 0, claimSalonTest = 0, claimSalonReal = 0;
  for (const c of claims) {
    const s = await Salon.findById(c.salonRef).select("basicInfo.shopName").lean();
    if (!s) claimSalonMissing++;
    else if (/ZE2E|TEST/i.test(s.basicInfo?.shopName || "")) claimSalonTest++;
    else claimSalonReal++;
  }
  console.log(`AcquisitionClaims: total=${claims.length}, salon missing=${claimSalonMissing}, salon test-named=${claimSalonTest}, salon looks real=${claimSalonReal}`);

  // Bookings against a real (non-test) salon, by status.
  const realBookingsAgg = await Booking.aggregate([
    { $lookup: { from: "salons", localField: "salonRef", foreignField: "_id", as: "s" } },
    { $unwind: { path: "$s", preserveNullAndEmptyArrays: true } },
    { $match: { $and: [
      { $or: [{ s: { $exists: false } }, { "s.basicInfo.shopName": { $not: /ZE2E|TEST/i } }] },
    ] } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  console.log("Bookings NOT against a ZE2E/TEST-named salon, by status:", realBookingsAgg);

  const salonMissingForBooking = await Booking.aggregate([
    { $lookup: { from: "salons", localField: "salonRef", foreignField: "_id", as: "s" } },
    { $match: { s: { $size: 0 } } },
    { $count: "count" },
  ]);
  console.log("Bookings whose salonRef no longer resolves to any Salon (orphans):", salonMissingForBooking[0]?.count || 0);

  console.log("Refund collection total:", await Refund.countDocuments({}));

  await mongoose.connection.close();
};
run().catch(async (e) => { console.error(e); try { await mongoose.connection.close(); } catch {} process.exit(1); });
