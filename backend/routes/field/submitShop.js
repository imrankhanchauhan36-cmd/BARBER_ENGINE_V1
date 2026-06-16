import mongoose from "mongoose";

/**
 * TEMP SHOP SCHEMA (Phase-0)
 * Final schema next step me lock hoga
 */
const ShopSchema = new mongoose.Schema(
  {
    name: String,
    ownerName: String,
    phone: String,
    address: String,

    services: [
      {
        name: String,
        price: Number,
        duration: Number,
      },
    ],

    stalls: [
      {
        name: String,
      },
    ],

    status: {
      type: String,
      default: "PENDING", // PENDING | APPROVED | REJECTED
    },
  },
  { timestamps: true }
);

const Shop = mongoose.models.Shop || mongoose.model("Shop", ShopSchema);

export const submitShop = async (req, res) => {
  try {
    const shop = new Shop(req.body);
    await shop.save();

    res.status(201).json({
      success: true,
      message: "Shop submitted for admin review",
      shop,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Shop submission failed",
      error: error.message,
    });
  }
};
