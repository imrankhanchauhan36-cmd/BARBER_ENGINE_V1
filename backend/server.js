import "dotenv/config";
import http from "http";
import mongoose from "mongoose"; // ← IMPROVEMENT-2: needed for DB close + health check
import app from "./app.js";
import connectDB from "./config/db.js";
import redis from "./config/redis.js";
import { startAutoCompleteJob } from "./jobs/autoComplete.job.js";
import { startAutoStartJob } from "./jobs/autoStart.job.js";
import { startCustomerArrivalJob } from "./jobs/customerArrival.job.js";
import { startHoldExpiryJob } from "./jobs/holdExpiry.job.js";
import { startReminderJob } from "./jobs/reminder.job.js";
import { startServiceOverdueJob } from "./jobs/serviceOverdue.job.js";
import { startSlaScannerJob } from "./jobs/slaScanner.job.js"; // ← Phase G Step 10 — wires up the Step 6-8 SLA scanner/escalation/notification chain, previously file-only
import { initSocket } from "./socket/index.js";

//////////////////////////////////////////////////////////////
// 🔑 STEP 1: LOAD ENVIRONMENT VARIABLES
//////////////////////////////////////////////////////////////


//////////////////////////////////////////////////////////////
// 🔑 STEP 2: CONNECT DATABASE (MongoDB)
//////////////////////////////////////////////////////////////

connectDB();

//////////////////////////////////////////////////////////////
// 🔑 STEP 3: REDIS LIFECYCLE LOGGING
//////////////////////////////////////////////////////////////

redis.on("connect",     () => console.log("🧠 Redis Connected (Session Store Ready)"));
redis.on("ready",       () => console.log("⚡ Redis Ready for Operations"));
redis.on("error",  (err) => console.error("❌ Redis Connection Error:", err.message));
redis.on("reconnecting",() => console.warn("🔄 Redis Reconnecting..."));

//////////////////////////////////////////////////////////////
// 🔑 STEP 4: PORT CONFIGURATION
//////////////////////////////////////////////////////////////

const PORT = process.env.PORT || 6060;

//////////////////////////////////////////////////////////////
// 📡 STEP 5: CREATE HTTP SERVER
// Must be created before Socket.IO attaches to it.
//////////////////////////////////////////////////////////////

const httpServer = http.createServer(app);

//////////////////////////////////////////////////////////////
// 📡 STEP 6: INITIALIZE SOCKET.IO — FAIL-FAST SAFE
//
// IMPROVEMENT-4: wrapped in try/catch so a bad socket config
// causes a clean process.exit(1) instead of a silent crash or
// a server that starts without realtime capability.
//////////////////////////////////////////////////////////////

let io;
try {
  io = initSocket(httpServer);
  console.log("✅ Socket.IO initialized");
} catch (err) {
  console.error("❌ Socket.IO init failed:", err.message);
  process.exit(1);
}

//////////////////////////////////////////////////////////////
// 📡 STEP 7: MAKE SOCKET AVAILABLE INSIDE CONTROLLERS
//
// Any controller can now emit via:
//   const io = req.app.get("io");
//   io.to(`salon:${salonId}`).emit("booking:confirmed", payload);
//////////////////////////////////////////////////////////////

app.set("io", io);

//////////////////////////////////////////////////////////////
// 🚀 STEP 7b: START HOLD EXPIRY BACKGROUND JOB
//
// Started here (after initSocket) because the job needs the
// io instance to emit realtime events when HOLDs expire.
// Runs once immediately on startup (clears stale HOLDs from
// any downtime) then every 30 seconds on the interval.
//////////////////////////////////////////////////////////////

const holdExpiryJob = startHoldExpiryJob(io);

//////////////////////////////////////////////////////////////
// 🚀 STEP 7c: START CUSTOMER ARRIVAL BACKGROUND JOB
//
// Monitors CONFIRMED bookings where the customer has not arrived
// within their grace window (arrivalGraceUntil). Flags them with
// customerDelayedAt and emits booking:customerDelayed so the salon
// dashboard can display the delayed badge and prompt owner action.
//
// Started after holdExpiryJob — both need io, both are independent.
// Returns a { stop } controller used in graceful shutdown.
//////////////////////////////////////////////////////////////

const customerArrivalJob = startCustomerArrivalJob(io);

//////////////////////////////////////////////////////////////
// 🚀 STEP 7d: START SERVICE OVERDUE BACKGROUND JOB
//
// Monitors ONGOING bookings running past their expected duration.
// Flag-only — never transitions status. See jobs/serviceOverdue.job.js.
//
// Started after customerArrivalJob — both need io, both independent.
// Returns a { stop } controller used in graceful shutdown.
//////////////////////////////////////////////////////////////

const serviceOverdueJob = startServiceOverdueJob(io);

//////////////////////////////////////////////////////////////
// 🚀 STEP 7e: START AUTO COMPLETE BACKGROUND JOB
//
// Automatically completes an ONGOING booking that has been
// overdue long enough with no owner action. Reuses the same
// transitionBookingStatus/WalletBalanceService/NotificationService
// every manual completion uses. See jobs/autoComplete.job.js.
//
// Started after serviceOverdueJob — both need io, both independent.
// Returns a { stop } controller used in graceful shutdown.
//////////////////////////////////////////////////////////////

const autoCompleteJob = startAutoCompleteJob(io);

//////////////////////////////////////////////////////////////
// 🚀 STEP 7f: START REMINDER BACKGROUND JOB (Booking Engine V2 — Phase 6)
//
// Sends 30-min and 5-min appointment reminders to the customer.
// No io needed — notification only, no socket emit.
//////////////////////////////////////////////////////////////

const reminderJob = startReminderJob();

//////////////////////////////////////////////////////////////
// 🚀 STEP 7g: START AUTO START BACKGROUND JOB (Booking Engine V2 — Phase 6)
//
// Auto-transitions a CHECKED_IN booking to ONGOING once startTime
// arrives, if the owner forgot to tap "Start Service".
//////////////////////////////////////////////////////////////

const autoStartJob = startAutoStartJob(io);

//////////////////////////////////////////////////////////////
// 🚀 STEP 7h: START SLA SCANNER BACKGROUND JOB (Phase G Step 10)
//
// Periodically discovers SupportTicket records whose first-response
// or resolution SLA has newly reached WARNING/BREACHED, persists each
// newly detected event exactly once (Step 6), escalates newly-
// detected breaches (Step 7), and delivers the IN_APP notification +
// Socket.IO event for all three (Step 8). The job file itself has
// existed since Step 6 but was never registered here — this is the
// only change needed to make Steps 6-8 actually run in a live
// environment; no logic in jobs/slaScanner.job.js changed.
// Needs `io` for its Socket.IO emits, same as serviceOverdueJob/
// holdExpiryJob above.
//////////////////////////////////////////////////////////////

const slaScannerJob = startSlaScannerJob(io);

//////////////////////////////////////////////////////////////
// 🚀 STEP 8: START SERVER
//////////////////////////////////////////////////////////////

const server = httpServer.listen(PORT, () => {
  console.log("--------------------------------------------------");
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`🗄️  MongoDB:     ${mongoose.connection.readyState === 1 ? "connected" : "connecting..."}`);
  console.log(`🧠 Redis:       ${redis.isReady ? "connected" : "unavailable"}`);
  console.log("📡 Socket.IO:   READY");
  console.log("⚙️  Jobs:        Hold Expiry + Customer Arrival + Service Overdue + Auto Complete + Reminder + Auto Start + SLA Scanner RUNNING");
  console.log("📡 System Mode: Enterprise Ready (1 Lakh+ Scale)");
  console.log("--------------------------------------------------");
});

//////////////////////////////////////////////////////////////
// 🛑 STEP 9: GRACEFUL SHUTDOWN
//
// Order matters:
//   1. Stop accepting new HTTP connections  (server.close)
//   2. Close Socket.IO — drain open sockets (await io.close)
//   3. Close MongoDB — flush pending writes (await mongoose.connection.close)
//   4. Quit Redis     — flush pending cmds  (await redis.quit)
//   5. Exit cleanly
//
// This order prevents:
//   - New requests landing on a half-shutdown server
//   - Realtime events emitting after DB is closed
//   - Pending DB writes being lost
//   - Container restart issues in Docker / Kubernetes
//////////////////////////////////////////////////////////////

const shutdown = async (signal) => {
  console.log(`\n⚠️  ${signal} received — graceful shutdown initiated...`);

  // Stop accepting new HTTP connections
  server.close(async () => {
    try {

      // Stop background workers first — prevents any in-flight DB
      // writes from racing against MongoDB closing below.
      holdExpiryJob.stop();
      console.log("✅ Hold expiry job stopped");

      customerArrivalJob.stop();
      console.log("✅ Customer arrival job stopped");

      serviceOverdueJob.stop();
      console.log("✅ Service overdue job stopped");

      autoCompleteJob.stop();
      console.log("✅ Auto complete job stopped");

      reminderJob.stop();
      console.log("✅ Reminder job stopped");

      autoStartJob.stop();
      console.log("✅ Auto start job stopped");

      slaScannerJob.stop();
      console.log("✅ SLA scanner job stopped");

      // Drain all open sockets before closing the DB — ensures no
      // realtime emit fires against a closed MongoDB connection.
      await new Promise((resolve) => io.close(resolve));
      console.log("✅ Socket.IO closed");

      // IMPROVEMENT-2: close MongoDB — prevents hanging connections
      // and corrupted state on container restart.
      await mongoose.connection.close();
      console.log("✅ MongoDB disconnected");

      // Close Redis last — notifications / caching layer
      await redis.quit();
      console.log("✅ Redis disconnected");

      console.log("✅ Server shutdown complete");
      process.exit(0);

    } catch (err) {
      console.error("❌ Shutdown error:", err.message);
      process.exit(1);
    }
  });

  // Force-kill if graceful shutdown hangs beyond 15 seconds
  // (e.g. stuck DB query, unresponsive Redis)
  setTimeout(() => {
    console.error("❌ Shutdown timed out — forcing exit");
    process.exit(1);
  }, 15_000).unref(); // .unref() so the timer itself doesn't keep the process alive
};

//////////////////////////////////////////////////////////////
// 🛑 HANDLE TERMINATION SIGNALS
//////////////////////////////////////////////////////////////

process.on("SIGINT",  () => shutdown("SIGINT"));   // Ctrl+C in terminal
process.on("SIGTERM", () => shutdown("SIGTERM"));  // Docker / Kubernetes stop

// Catch unhandled promise rejections — log and exit rather than silently hang
process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection:", reason);
  shutdown("unhandledRejection");
});

// Catch uncaught exceptions — always fatal, shutdown cleanly
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err.message);
  shutdown("uncaughtException");
});