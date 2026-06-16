import express from "express";
import Shop from "../../models/Shop.js";

const router = express.Router();

/**
 * GET /api/admin/shops/pending
 */
router.get("/shops/pending", async (req, res) => {
  try {
    const shops = await Shop.find({ status: "PENDING" });
    res.json({
      success: true,
      count: shops.length,
      shops,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch pending shops",
    });
  }
});

export default router;
