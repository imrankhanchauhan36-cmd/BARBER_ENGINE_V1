import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../../config/db.js";
import FieldAgentEarningPolicyGap from "../../modules/fieldAgent/models/FieldAgentEarningPolicyGap.js";

const run = async () => {
  await connectDB();
  const all = await FieldAgentEarningPolicyGap.find({}).select("_id status gapType referenceKey").lean();
  console.log(`Total remaining: ${all.length}`);
  for (const g of all) console.log(JSON.stringify({ id: String(g._id), status: g.status, gapType: g.gapType, referenceKey: g.referenceKey }));
  await mongoose.connection.close();
};
run().catch(async (e) => { console.error(e); try{await mongoose.connection.close();}catch{} process.exit(1); });
