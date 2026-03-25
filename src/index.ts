#!/usr/bin/env node

import { loadConfig, isFirstRun } from "./config.js";
import { initDB } from "./db/index.js";
import { EmailGateway } from "./email/gateway.js";
import { CoreAgent } from "./agent/core.js";
import { startScheduler } from "./scheduler/cron.js";
import { ClickTracker } from "./tracker/clicks.js";
import { RLM } from "./rlm/index.js";

async function main() {
  console.log("🔄 inloop — starting up...");

  // First run → setup wizard
  if (await isFirstRun()) {
    console.log("First run detected. Running setup wizard...");
    const { runWizard } = await import("./setup/wizard.js");
    await runWizard();
  }

  const config = await loadConfig();
  const db = initDB(config.dataDir);
  const rlm = new RLM(db);
  const agent = new CoreAgent(config, db, rlm);

  // Start email gateway (IMAP polling + SMTP)
  const gateway = new EmailGateway(config.email, async (email) => {
    await agent.handleIncomingEmail(email);
  });
  await gateway.start();

  // Start click tracker if configured
  if (config.tracking?.enabled) {
    const tracker = new ClickTracker(config.tracking, db);
    await tracker.start();
  }

  // Start daily research + weekly newsletter cron
  startScheduler(config, db, rlm);

  console.log("✅ inloop is running. Waiting for emails...");

  // Keep alive
  process.on("SIGINT", async () => {
    console.log("\n🛑 Shutting down...");
    await gateway.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
