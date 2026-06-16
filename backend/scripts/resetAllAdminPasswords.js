import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import User from "../models/User.js";

dotenv.config();

////////////////////////////////////////////////////////////
// 🔒 SAFETY CONFIG
////////////////////////////////////////////////////////////

const CONFIRM_RESET = true;

if (!CONFIRM_RESET) {
  console.log("❌ RESET BLOCKED");
  process.exit(0);
}

// 🔒 ENV SAFETY
if (process.env.NODE_ENV === "production") {
  throw new Error("❌ Script not allowed in production");
}

// 🔐 PASSWORD
if (!process.env.ADMIN_RESET_PASSWORD) {
  throw new Error("❌ Set ADMIN_RESET_PASSWORD in env");
}

const NEW_PASSWORD = process.env.ADMIN_RESET_PASSWORD;

const FILTER = {
  role: "ADMIN",
  isDeleted: { $ne: true },
};

////////////////////////////////////////////////////////////

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ DB Connected");

    ////////////////////////////////////////////////////////////
    // 🔥 COUNT ADMINS
    ////////////////////////////////////////////////////////////
    const count = await User.countDocuments(FILTER);

    if (!count) {
      console.log("❌ No admins found");
      process.exit(0);
    }

    console.log(`Found ${count} admins`);

    ////////////////////////////////////////////////////////////
    // 🔥 HASH PASSWORD
    ////////////////////////////////////////////////////////////
    const hashedPassword = await bcrypt.hash(NEW_PASSWORD, 10);

    ////////////////////////////////////////////////////////////
    // 🔥 BULK UPDATE (FAST)
    ////////////////////////////////////////////////////////////
    const result = await User.updateMany(FILTER, {
      $set: {
        password: hashedPassword,
        mustChangePassword: true,
        loginAttempts: 0,
        lockUntil: null,
      },
    });

    ////////////////////////////////////////////////////////////
    // 🎉 DONE
    ////////////////////////////////////////////////////////////
    console.log(`
====================================
🎉 ADMIN PASSWORD RESET COMPLETE
====================================
Matched: ${result.matchedCount}
Modified: ${result.modifiedCount}
====================================
    `);

    process.exit(0);

  } catch (err) {
    console.error("❌ ERROR:", err);
    process.exit(1);
  }
};

run();