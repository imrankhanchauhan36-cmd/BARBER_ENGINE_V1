/**
 * BARBER_ENGINE_V1
 * backend/scripts/seedSupportTestUsers.js
 *
 * DEVELOPMENT/TEST-ONLY provisioning script for the F.3.9 audit's
 * approved dev-fixture path. Creates exactly two User documents —
 * one AGENT, one SUPPORT_ADMIN — so authenticated Support live
 * verification (/api/support/auth/login and everything downstream of
 * it) has real, legitimate credentials to use. No HTTP route, no
 * client can reach this — it is a standalone script, run manually,
 * exactly like scripts/02_seedIndiaSuperAdmin.js and
 * scripts/resetAllAdminPasswords.js already do for the ADMIN role.
 * Neither of those scripts, User.js, nor any Support engine/route/
 * controller file is modified by this one.
 *
 * Idempotent — safe to re-run. If a test user with the given email
 * already exists, it is left completely untouched (no password
 * overwrite, no field changes) and its credentials are simply
 * reprinted so you can keep using them.
 *
 * Run:
 *   cd backend
 *   node scripts/seedSupportTestUsers.js
 */

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import User from "../models/User.js";

dotenv.config();

////////////////////////////////////////////////////////////
// 🔒 HARD PRODUCTION GUARD — checked BEFORE any DB connection
// is opened, matching resetAllAdminPasswords.js's own ordering.
////////////////////////////////////////////////////////////

if (process.env.NODE_ENV === "production") {
  console.error("❌ BLOCKED: seedSupportTestUsers.js must never run with NODE_ENV=production.");
  console.error("   No connection was opened. No data was read or written.");
  process.exit(1);
}

////////////////////////////////////////////////////////////
// 🧪 TEST FIXTURE DEFINITIONS
////////////////////////////////////////////////////////////

// A single shared, clearly-fake dev password — same convention as
// admin.controller.js's own hardcoded "Admin@12345" temp password.
// Not a real secret; not used anywhere outside local/dev verification.
const TEST_PASSWORD = "SupportTest@12345";

// User.js's own pre("validate") hook requires `phone` for every
// non-ADMIN role (a rule that predates AGENT/SUPPORT_ADMIN and was
// never updated for them — confirmed by running this script once
// without phone and observing "Phone required for this role" before
// any write occurred). Not modifying User.js to work around this —
// instead supplying values the schema already accepts: obviously
// synthetic, reserved-looking numbers matching its own
// /^[6-9]\d{9}$/ format, distinct per fixture to satisfy the sparse-
// unique phone index.
const TEST_USERS = [
  {
    name: "Support Agent (Test Fixture)",
    email: "support.agent.test@local.dev",
    phone: "9000000001",
    role: "AGENT",
  },
  {
    name: "Support Admin (Test Fixture)",
    email: "support.admin.test@local.dev",
    phone: "9000000002",
    role: "SUPPORT_ADMIN",
  },
];

////////////////////////////////////////////////////////////
// 🚀 MAIN EXECUTION
////////////////////////////////////////////////////////////

const run = async () => {
  const outcomes = [];

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ MongoDB Connected");

    for (const fixture of TEST_USERS) {
      // Idempotency check — email is the schema's own unique key
      // (sparse+partial-unique index on email), so this is the
      // correct existence check regardless of role.
      const existing = await User.findOne({ email: fixture.email });

      if (existing) {
        console.log(`⚠️  ${fixture.role} test user already exists — left untouched (no password/field changes).`);
        outcomes.push({ ...fixture, created: false });
        continue;
      }

      const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 12);

      try {
        await User.create({
          name: fixture.name,
          email: fixture.email,
          phone: fixture.phone,
          password: hashedPassword,
          role: fixture.role,
          isActive: true,
          isDeleted: false,
        });
        console.log(`✅ ${fixture.role} test user created.`);
        outcomes.push({ ...fixture, created: true });
      } catch (err) {
        // Race safety — same E11000 handling convention as
        // 02_seedIndiaSuperAdmin.js: another process created the
        // same fixture between our check and our create.
        if (err.code === 11000) {
          console.log(`⚠️  ${fixture.role} test user already exists (race-detected) — left untouched.`);
          outcomes.push({ ...fixture, created: false });
        } else {
          throw err;
        }
      }
    }

    ////////////////////////////////////////////////////////
    // 🎉 PRINT CREDENTIALS — only after every fixture above is
    // confirmed either created or already-existing.
    ////////////////////////////////////////////////////////
    console.log(`
====================================================
SUPPORT TEST CREDENTIALS (development/test only)
====================================================`);
    for (const o of outcomes) {
      console.log(`
Role:     ${o.role}
Email:    ${o.email}
Password: ${TEST_PASSWORD}
Status:   ${o.created ? "created" : "already existed"}`);
    }
    console.log(`
====================================================
Login via: POST /api/support/auth/login  { "email": ..., "password": ... }
====================================================
`);

    process.exit(0);
  } catch (err) {
    console.error("❌ SEED FAILED:", err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
};

run();
