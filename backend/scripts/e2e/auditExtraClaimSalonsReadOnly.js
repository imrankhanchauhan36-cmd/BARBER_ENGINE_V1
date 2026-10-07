import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../../config/db.js";
import Salon from "../../models/Salon.js";

const ids = ["6abdb808bbcae3fe996ee169","6abe0748b63e557199ba040c","6abed4a9a07cb5975bdbca4c","6abed8f0a07cb5975bdbd543"];
const run = async () => {
  await connectDB();
  for (const id of ids) {
    const s = await Salon.findById(id).select("basicInfo.shopName approval.status ownerId").lean();
    console.log(JSON.stringify({ id, shopName: s?.basicInfo?.shopName, approvalStatus: s?.approval?.status, ownerId: s?.ownerId ? String(s.ownerId) : null }));
  }
  await mongoose.connection.close();
};
run().catch(async (e) => { console.error(e); try{await mongoose.connection.close();}catch{} process.exit(1); });
