/**
 * BARBER_ENGINE_V1
 * backend/scripts/seedSupportTestConfig.js
 *
 * DEVELOPMENT/TEST-ONLY provisioning script — same category as
 * scripts/seedSupportTestUsers.js. Creates the MINIMUM Support
 * operational configuration required for a real ticket to actually
 * reach ASSIGNED in this dev database (confirmed empty: 0
 * SupportCategory, 0 SupportTeam, 0 SupportRoutingRule, 0
 * SupportAgentProfile documents existed prior to this script).
 *
 * Deliberately does NOT create a SupportQueue or SupportCoverage row —
 * verified by reading routingResolution.service.js directly:
 * buildRoutingDecision() takes a matched SupportRoutingRule's own
 * targetTeamRef/targetQueueRef as an "admin policy override" that
 * takes precedence over whatever SupportCoverage would have resolved
 * (`ruleTargetTeamRef ?? coverageTargetTeamRef`), and routeAndAssignTicket()
 * only ever reads targetQueueRef/targetTeamRef off that decision — it
 * never inspects the `resolved` boolean SupportCoverage would otherwise
 * drive. A single fully-wildcard rule with its own targetTeamRef set
 * is therefore sufficient on its own; targetQueueRef is left null,
 * exactly like SupportAssignment.queueRef's own default.
 *
 * Also sets the AGENT test fixture's Redis presence key to AVAILABLE —
 * the exact existing key format and value from
 * assignmentResolution.service.js's own presenceKey()/
 * AGENT_AVAILABILITY_STATUS.AVAILABLE (read-only there; this is the
 * first and only writer of that key anywhere in the codebase, since no
 * agent-facing heartbeat endpoint exists yet). No TTL is applied —
 * none exists to reuse (confirmed by inspection: nothing else ever
 * writes this key), and inventing one would be a policy this script
 * has no authority to decide. This is a manually-set, DEV-only value,
 * not a substitute for a real presence/heartbeat system.
 *
 * Idempotent — safe to re-run. Never modifies or deletes any existing
 * record; every check is a plain existence check before creating.
 *
 * Run:
 *   cd backend
 *   node scripts/seedSupportTestConfig.js
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../models/User.js";
import SupportCategory from "../modules/support/models/SupportCategory.js";
import SupportTeam from "../modules/support/models/SupportTeam.js";
import SupportRoutingRule from "../modules/support/models/SupportRoutingRule.js";
import SupportAgentProfile from "../modules/support/models/SupportAgentProfile.js";
import { AGENT_AVAILABILITY_STATUS } from "../modules/support/constants/support.constants.js";

dotenv.config();

////////////////////////////////////////////////////////////
// 🔒 HARD PRODUCTION GUARD — checked BEFORE any DB/Redis
// connection, matching seedSupportTestUsers.js's own ordering.
////////////////////////////////////////////////////////////

if (process.env.NODE_ENV === "production") {
  console.error("❌ BLOCKED: seedSupportTestConfig.js must never run with NODE_ENV=production.");
  console.error("   No connection was opened. No data was read or written.");
  process.exit(1);
}

// Dynamic import, deliberately placed AFTER the guard above — unlike
// mongoose/User/SupportCategory (plain schema definitions, no
// connection side effect on import), config/redis.js connects to
// Redis as soon as it is imported at all. A static top-level import
// is hoisted before any of this file's own code runs (including the
// guard), which was confirmed to leak a real Redis connection attempt
// during testing even when NODE_ENV=production. A dynamic import here
// executes only when this line is reached, i.e. only after the guard
// has already had the chance to exit.
const { default: redis } = await import("../config/redis.js");

const AGENT_FIXTURE_EMAIL = "support.agent.test@local.dev";

// Exact existing key/value convention from assignmentResolution.service.js
// — not reinvented here, only reused.
const presenceKey = (agentId) => `support:agent:presence:${agentId}`;

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ MongoDB Connected");

    const agentUser = await User.findOne({ email: AGENT_FIXTURE_EMAIL, role: "AGENT" });
    if (!agentUser) {
      throw new Error(
        `AGENT fixture (${AGENT_FIXTURE_EMAIL}) not found — run scripts/seedSupportTestUsers.js first.`
      );
    }

    ////////////////////////////////////////////////////////
    // 1. SupportCategory
    ////////////////////////////////////////////////////////
    let category = await SupportCategory.findOne({ code: "TEST_GENERAL" });
    if (category) {
      console.log("⚠️  SupportCategory 'TEST_GENERAL' already exists — left untouched.");
    } else {
      try {
        category = await SupportCategory.create({
          name: "General Inquiry (Test Fixture)",
          code: "TEST_GENERAL",
          isActive: true,
          isDeleted: false,
        });
        console.log("✅ SupportCategory 'TEST_GENERAL' created.");
      } catch (err) {
        if (err.code === 11000) {
          category = await SupportCategory.findOne({ code: "TEST_GENERAL" });
          console.log("⚠️  SupportCategory 'TEST_GENERAL' already exists (race-detected) — left untouched.");
        } else throw err;
      }
    }

    ////////////////////////////////////////////////////////
    // 2. SupportTeam
    ////////////////////////////////////////////////////////
    let team = await SupportTeam.findOne({ teamCode: "TEST_TEAM", isDeleted: false });
    if (team) {
      console.log("⚠️  SupportTeam 'TEST_TEAM' already exists — left untouched.");
    } else {
      try {
        team = await SupportTeam.create({
          teamCode: "TEST_TEAM",
          name: "Test Support Team (Fixture)",
          isActive: true,
          isDeleted: false,
        });
        console.log("✅ SupportTeam 'TEST_TEAM' created.");
      } catch (err) {
        if (err.code === 11000) {
          team = await SupportTeam.findOne({ teamCode: "TEST_TEAM", isDeleted: false });
          console.log("⚠️  SupportTeam 'TEST_TEAM' already exists (race-detected) — left untouched.");
        } else throw err;
      }
    }

    ////////////////////////////////////////////////////////
    // 3. SupportRoutingRule — fully wildcard (no geo/category/
    // priority/language/requesterType filters) except a direct
    // targetTeamRef override, per the routingResolution.service.js
    // audit above. targetQueueRef intentionally left null.
    ////////////////////////////////////////////////////////
    let rule = await SupportRoutingRule.findOne({ name: "Test Routing Rule (Fixture)", isDeleted: false });
    if (rule) {
      console.log("⚠️  SupportRoutingRule 'Test Routing Rule (Fixture)' already exists — left untouched.");
    } else {
      rule = await SupportRoutingRule.create({
        name: "Test Routing Rule (Fixture)",
        isActive: true,
        rulePriority: 0,
        targetTeamRef: team._id,
        targetQueueRef: null,
        isDeleted: false,
      });
      console.log("✅ SupportRoutingRule 'Test Routing Rule (Fixture)' created.");
    }

    ////////////////////////////////////////////////////////
    // 4. SupportAgentProfile — links the AGENT fixture into the
    // test team, eligible for the test category/language.
    ////////////////////////////////////////////////////////
    let profile = await SupportAgentProfile.findOne({ userRef: agentUser._id, isDeleted: false });
    if (profile) {
      console.log("⚠️  SupportAgentProfile for the AGENT fixture already exists — left untouched.");
    } else {
      try {
        profile = await SupportAgentProfile.create({
          userRef: agentUser._id,
          teamRefs: [team._id],
          primaryTeamRef: team._id,
          categoryRefs: [category._id],
          languages: ["en"],
          isActive: true,
          maxActiveTickets: 5,
          availabilityStatus: AGENT_AVAILABILITY_STATUS.AVAILABLE,
          isDeleted: false,
        });
        console.log("✅ SupportAgentProfile for the AGENT fixture created.");
      } catch (err) {
        if (err.code === 11000) {
          profile = await SupportAgentProfile.findOne({ userRef: agentUser._id, isDeleted: false });
          console.log("⚠️  SupportAgentProfile for the AGENT fixture already exists (race-detected) — left untouched.");
        } else throw err;
      }
    }

    ////////////////////////////////////////////////////////
    // 5. Redis presence — exact existing key/value, DEV-only,
    // no TTL (none exists to reuse).
    ////////////////////////////////////////////////////////
    await redis.set(presenceKey(agentUser._id.toString()), AGENT_AVAILABILITY_STATUS.AVAILABLE);
    console.log(`✅ Redis presence set: ${presenceKey(agentUser._id.toString())} = ${AGENT_AVAILABILITY_STATUS.AVAILABLE}`);

    console.log(`
====================================================
SUPPORT TEST CONFIG (development/test only)
====================================================
SupportCategory : ${category._id} (TEST_GENERAL)
SupportTeam     : ${team._id} (TEST_TEAM)
SupportRoutingRule : ${rule._id}
SupportAgentProfile : ${profile._id} (agent: ${agentUser._id})
====================================================
`);

    process.exit(0);
  } catch (err) {
    console.error("❌ SEED FAILED:", err.message);
    process.exit(1);
  } finally {
    try { await redis.quit(); } catch {}
    await mongoose.disconnect();
  }
};

run();
