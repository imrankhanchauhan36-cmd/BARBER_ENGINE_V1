import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../../config/db.js";
import Booking from "../../models/Booking.js";

const run = async () => {
  await connectDB();
  for (const sid of ["6aa2701ad0104a244ab02749", "6aa2701fd0104a244ab027fa"]) {
    const bookings = await Booking.find({ salonRef: new mongoose.Types.ObjectId(sid) }).select("_id status createdAt totalAmountInPaise").lean();
    console.log(JSON.stringify({ salonId: sid, bookings }));
  }
  await mongoose.connection.close();
};
run().catch(async (e) => { console.error(e); try{await mongoose.connection.close();}catch{} process.exit(1); });
