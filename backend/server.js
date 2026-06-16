import express from "express";
import cors from "cors";
import mongoose from "mongoose";

// Routes
import fieldRoutes from "./routes/field/index.js";
import adminRoutes from "./routes/admin/index.js";

const app = express();

/* ===================== MIDDLEWARE ===================== */
app.use(cors());
app.use(express.json());

/* ===================== DATABASE ===================== */
const MONGO_URL = "mongodb://127.0.0.1:27017/barber_marketplace";

mongoose
  .connect(MONGO_URL)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Error:", err));

/* ===================== ROUTES ===================== */
app.use("/api/field", fieldRoutes);
app.use("/api/admin", adminRoutes);

/* ===================== HEALTH CHECK ===================== */
app.get("/", (req, res) => {
  res.send("Barber Marketplace Backend Running 🚀");
});

/* ===================== SERVER ===================== */
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
