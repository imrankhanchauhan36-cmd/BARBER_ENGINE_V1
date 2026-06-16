import express from "express";
import Country from "../models/Country.js";
import State from "../models/State.js";
import City from "../models/District.js";

import { protect } from "../middlewares/auth.middleware.js";
import { requireRole } from "../middlewares/role.middleware.js";
import { requireAdminLevel } from "../middlewares/requireAdminLevel.js";

const router = express.Router();

/**
 🔐 ONLY INDIA ADMIN CAN CREATE GEO
*/
router.use(protect, requireRole("ADMIN"), requireAdminLevel("INDIA"));

/**
 ✅ CREATE COUNTRY
*/
router.post("/country", async (req, res) => {
  try {
    req.body.name = req.body.name.trim().toLowerCase();

    const country = await Country.create(req.body);
    res.status(201).json(country);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        message: "Country already exists",
      });
    }
    res.status(500).json({ message: err.message });
  }
});

/**
 ✅ CREATE STATE
*/
router.post("/state", async (req, res) => {
  try {
    req.body.name = req.body.name.trim().toLowerCase();

    const { countryRef } = req.body;

    const country = await Country.findById(countryRef).lean();
    if (!country) {
      return res.status(400).json({
        message: "Invalid country reference",
      });
    }

    const state = await State.create(req.body);
    res.status(201).json(state);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        message: "State already exists in this country",
      });
    }
    res.status(500).json({ message: err.message });
  }
});

/**
 ✅ CREATE CITY
*/
router.post("/city", async (req, res) => {
  try {
    req.body.name = req.body.name.trim().toLowerCase();

    const { stateRef } = req.body;

    const state = await State.findById(stateRef).lean();
    if (!state) {
      return res.status(400).json({
        message: "Invalid state reference",
      });
    }

    const city = await City.create(req.body);
    res.status(201).json(city);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        message: "City already exists in this state",
      });
    }
    res.status(500).json({ message: err.message });
  }
});

/* =========================================================
   ✅ GET ROUTES (ADDED — EXISTING CODE NOT TOUCHED)
   ========================================================= */

/**
 ✅ GET COUNTRIES
*/
router.get("/country", async (req, res) => {
  try {
    const countries = await Country.find().lean();
    res.json(countries);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 ✅ GET STATES
*/
router.get("/state", async (req, res) => {
  try {
    const states = await State.find()
      .populate("countryRef", "name")
      .lean();

    res.json(states);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 ✅ GET CITIES
*/
router.get("/city", async (req, res) => {
  try {
    const cities = await City.find()
      .populate("stateRef", "name")
      .lean();

    res.json(cities);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
