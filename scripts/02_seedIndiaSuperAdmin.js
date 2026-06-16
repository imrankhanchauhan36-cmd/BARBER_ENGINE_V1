import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import User from "../models/User.js";
import Country from "../models/Country.js";

dotenv.config();

///////////////////////////////////////////////////////////
// 🔒 REQUIRED ENV VALIDATION (FIXED ✅)
///////////////////////////////////////////////////////////
const requiredEnv = [
  "MONGODB_URI",
  "INDIA_ADMIN_PHONE",
  "INDIA_ADMIN_PASSWORD",
  "INDIA_ADMIN_EMAIL",
  "ADMIN_KEY",
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`❌ Missing required ENV variable: ${key}`);
    process.exit(1);
  }
}

///////////////////////////////////////////////////////////
// 📞 PHONE NORMALIZATION (STRICT INDIA FORMAT)
///////////////////////////////////////////////////////////
const normalizePhone = (phone) => {
  const cleaned = String(phone).replace(/\D/g, "");

  if (cleaned.length === 10) return cleaned;

  throw new Error("Invalid Indian phone format (must be 10 digits)");
};

///////////////////////////////////////////////////////////
// 📧 EMAIL NORMALIZATION
///////////////////////////////////////////////////////////
const normalizeEmail = (email) => {
  return String(email).toLowerCase().trim();
};

///////////////////////////////////////////////////////////
// 🚀 MAIN EXECUTION
///////////////////////////////////////////////////////////
const run = async () => {
  let session;

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ MongoDB Connected");

    session = await mongoose.startSession();
    session.startTransaction();

    ///////////////////////////////////////////////////////
    // 🌍 FETCH INDIA COUNTRY
    ///////////////////////////////////////////////////////
    const country = await Country.findOne(
      { code: "IN", isDeleted: false },
      null,
      { session }
    );

    if (!country) {
      throw new Error("India country not found. Seed country first.");
    }

    ///////////////////////////////////////////////////////
    // 📞 NORMALIZE PHONE
    ///////////////////////////////////////////////////////
    const normalizedPhone = normalizePhone(
      process.env.INDIA_ADMIN_PHONE
    );

    ///////////////////////////////////////////////////////
    // 📧 NORMALIZE EMAIL
    ///////////////////////////////////////////////////////
    const normalizedEmail = normalizeEmail(
      process.env.INDIA_ADMIN_EMAIL
    );

    ///////////////////////////////////////////////////////
    // 🔍 CHECK EXISTING INDIA ADMIN
    ///////////////////////////////////////////////////////
    const existingAdmin = await User.findOne(
      {
        role: "ADMIN",
        adminLevel: "INDIA",
        isDeleted: { $ne: true },
      },
      null,
      { session }
    );

    if (existingAdmin) {
      console.log("⚠️ INDIA Super Admin already exists.");
      await session.abortTransaction();
      process.exit(0);
    }

    ///////////////////////////////////////////////////////
    // 🔐 HASH PASSWORD
    ///////////////////////////////////////////////////////
    const hashedPassword = await bcrypt.hash(
      process.env.INDIA_ADMIN_PASSWORD,
      12
    );

    ///////////////////////////////////////////////////////
    // 👑 CREATE SUPER ADMIN
    ///////////////////////////////////////////////////////
    const [admin] = await User.create(
      [
        {
          name: "INDIA SUPER ADMIN",

          email: normalizedEmail,
          phone: normalizedPhone,
          password: hashedPassword,

          role: "ADMIN",
          adminLevel: "INDIA",

          countryRef: country._id,
          stateRef: null,
          districtRef: null,

          permissions: ["ALL"],

          tokenVersion: 0,
          loginAttempts: 0,
          lockUntil: null,

          lastLoginAt: null,

          mustChangePassword: true,
          isEmailVerified: true,
          isPhoneVerified: true,

          createdBy: null,

          isActive: true,
          isDeleted: false,
        },
      ],
      { session }
    );

    ///////////////////////////////////////////////////////
    // ✅ COMMIT TRANSACTION
    ///////////////////////////////////////////////////////
    await session.commitTransaction();

    console.log("🔥 INDIA SUPER ADMIN CREATED SUCCESSFULLY");
    console.log("Admin ID:", admin._id.toString());

    process.exit(0);
  } catch (err) {
    ///////////////////////////////////////////////////////
    // ✅ DUPLICATE SAFETY
    ///////////////////////////////////////////////////////
    if (err.code === 11000) {
      console.error("⚠️ Duplicate admin detected (safe exit)");
      process.exit(0);
    }

    if (session) await session.abortTransaction();

    console.error("❌ SUPER ADMIN SEED FAILED:", err.message);
    process.exit(1);
  } finally {
    if (session) session.endSession();
    await mongoose.disconnect();
  }
};

run();