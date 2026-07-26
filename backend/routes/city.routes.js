import express from "express";
import { getServiceableCities } from "../controllers/city.controller.js";

const router = express.Router();

// GET /api/v1/cities/serviceable
router.get("/serviceable", getServiceableCities);

export default router;