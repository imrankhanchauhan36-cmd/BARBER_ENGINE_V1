import mongoose from "mongoose";

const RatingSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      unique: true, // 🔒 one booking = one rating
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    salonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Salon",
      required: true,
      index: true,
    },

    rating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
    },

    review: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    // 🔒 DAY-22: flag system (NO EDIT)
    isFlagged: {
      type: Boolean,
      default: false,
    },

    flagReason: {
      type: String,
    },

    isHidden: {
      type: Boolean,
      default: false, // admin can hide, not delete
    },
  },
  { timestamps: true }
);

export default mongoose.models.Rating ||
  mongoose.model("Rating", RatingSchema);
