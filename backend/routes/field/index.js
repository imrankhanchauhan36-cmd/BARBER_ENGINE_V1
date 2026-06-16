import express from "express";
import Shop from "../../models/Shop.js/index.js";

const router = express.Router();

// Submit shop (Field App)
router.post("/submit", async (req, res) => {
  try {
    const shop = new Shop(req.body);
    await shop.save();

    res.status(201).json({
      success: true,
      message: "Shop submitted successfully",
      shop,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// TEMP DEBUG — get all shops
router.get("/all", async (req, res) => {
  const shops = await Shop.find();
  res.json(shops);
});

export default router;
