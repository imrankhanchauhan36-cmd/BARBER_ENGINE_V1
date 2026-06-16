import Rating from "../models/Rating.js";

/**
 * 🔒 ADMIN: HIDE RATING (SOFT)
 */
export const hideRating = async (req, res) => {
  try {
    const { ratingId, reason } = req.body;

    const rating = await Rating.findById(ratingId);

    if (!rating) {
      return res.status(404).json({ success: false, message: "Rating not found" });
    }

    rating.isHidden = true;
    rating.adminNote = reason || "Hidden by admin";
    await rating.save();

    return res.json({
      success: true,
      message: "Rating hidden safely",
    });
  } catch (err) {
    console.error("HIDE RATING ERROR:", err);
    return res.status(500).json({ success: false });
  }
};

/**
 * 🔓 ADMIN: UNHIDE RATING
 */
export const unhideRating = async (req, res) => {
  try {
    const { ratingId } = req.body;

    const rating = await Rating.findById(ratingId);

    if (!rating) {
      return res.status(404).json({ success: false, message: "Rating not found" });
    }

    rating.isHidden = false;
    await rating.save();

    return res.json({
      success: true,
      message: "Rating restored",
    });
  } catch (err) {
    console.error("UNHIDE RATING ERROR:", err);
    return res.status(500).json({ success: false });
  }
};
