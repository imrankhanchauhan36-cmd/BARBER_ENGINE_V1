import Booking from "../models/Booking.js";
import { BOOKING_STATUS } from "../utils/bookingState.machine.js";

export const expireBookings = async () => {
  try {
    const now = new Date();

    // HOLD bookings expire karo
    const holdResult = await Booking.updateMany(
      {
        status: BOOKING_STATUS.HOLD,
        lockUntil: { $ne: null, $lt: now },
      },
      {
        $set: { status: BOOKING_STATUS.EXPIRED, lockUntil: null },
      }
    );

    // CONFIRMED bookings — service time nikal gayi to NO_SHOW
    const noShowTime = new Date(now.getTime() - 15 * 60 * 1000);

    const noShowResult = await Booking.updateMany(
      {
        status: BOOKING_STATUS.CONFIRMED,
        startTime: { $lt: noShowTime },
      },
      {
        $set: { status: BOOKING_STATUS.CANCELLED },
      }
    );

    console.log(`🧹 Expired: ${holdResult.modifiedCount}`);
    console.log(`👻 No-show: ${noShowResult.modifiedCount}`);

    return {
      success: true,
      expiredCount: holdResult.modifiedCount,
      noShowCount:  noShowResult.modifiedCount,
      timestamp: now,
    };

  } catch (error) {
    console.error("❌ Expire bookings job failed:", error);
    return { success: false, error: error.message };
  }
};