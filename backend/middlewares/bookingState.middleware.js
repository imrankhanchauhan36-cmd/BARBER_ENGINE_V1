import Booking from "../models/Booking.js";
import { validateBookingTransition } from "../utils/bookingState.machine.js";

export const checkBookingState = (allowedStates) => {
  return async (req, res, next) => {
    try {
      const { bookingId } = req.body;

      const booking = await Booking.findById(bookingId);

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found",
        });
      }

      if (!allowedStates.includes(booking.status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid booking state: ${booking.status}`,
        });
      }

      req.booking = booking;
      next();
    } catch (err) {
      next(err);
    }
  };
};