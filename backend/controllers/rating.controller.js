import Rating from "../models/Rating.js";
import Booking from "../models/Chair.js";
import Salon from "../models/Salon.js";

/**
 * 1️⃣ CREATE RATING (IMMUTABLE)
 */
export const createRating = async (req, res) => {
  try {
    const { bookingId, rating, review } = req.body;
    const userId = req.userId; // auth middleware se aayega

    const booking = await Booking.findById(bookingId);

    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    // 🔒 Only COMPLETED booking
    if (booking.status !== "COMPLETED") {
      return res.status(400).json({
        success: false,
        message: "Rating allowed only after service completion",
      });
    }

    // 🔒 Only booking owner
    if (booking.userId.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Not allowed" });
    }

    // 🔒 Unique lock (one booking = one rating)
    const ratingDoc = await Rating.create({
      bookingId,
      userId,
      salonId: booking.salonId,
      rating,
      review,
    });

    // ✅ Aggregate update (safe)
    await Salon.findByIdAndUpdate(booking.salonId, {
      $inc: { ratingCount: 1, ratingTotal: rating },
    });

    return res.json({ success: true, ratingId: ratingDoc._id });
  } catch (err) {
    // duplicate rating (unique bookingId)
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Rating already submitted for this booking",
      });
    }
    console.error("CREATE RATING ERROR:", err);
    return res.status(500).json({ success: false });
  }
};

/**
 * 2️⃣ FLAG / REPORT RATING (NO EDIT)
 */
export const flagRating = async (req, res) => {
  try {
    const { ratingId, reason } = req.body;
    const userId = req.userId;

    const rating = await Rating.findById(ratingId);

    if (!rating) {
      return res.status(404).json({ success: false, message: "Rating not found" });
    }

    // 🔒 Only rating owner can flag
    if (rating.userId.toString() !== userId) {
      return res.status(403).json({ success: false, message: "Not allowed" });
    }

    rating.isFlagged = true;
    rating.flagReason = reason || "User reported issue";
    await rating.save();

    return res.json({ success: true, message: "Rating flagged for review" });
  } catch (err) {
    console.error("FLAG RATING ERROR:", err);
    return res.status(500).json({ success: false });
  }
};

/**
 * 3️⃣ READ-ONLY: GET SALON RATINGS (UI SAFE)
 */
export const getSalonRatings = async (req, res) => {
  try {
    const { salonId } = req.params;

    const ratings = await Rating.find({
      salonId,
      isHidden: false,
    })
      .select("rating review createdAt userId")
      .sort({ createdAt: -1 });

    return res.json({ success: true, ratings });
  } catch (err) {
    console.error("GET RATINGS ERROR:", err);
    return res.status(500).json({ success: false });
  }
};
