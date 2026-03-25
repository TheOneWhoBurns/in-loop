#!/usr/bin/env node

/**
 * inloop daemon — persistent process that:
 * 1. Polls IMAP for new emails → invokes agent CLI (Loop 1)
 * 2. Runs daily research cron → invokes agent CLI per topic (Loop 2)
 * 3. Runs weekly newsletter cron → invokes agent CLI (Loop 3)
 * 4. Optionally runs click tracking server
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import cron from "node-cron";
import { loadConfig, isFirstRun, type InloopConfig } from "./config.js";
import { initDB, type DB } from "./db.js";
import { pollForNewEmails } from "./email.js";
import { ClickTracker } from "./tracker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

async function main() {
  console.log("🔄 inloop — starting up...");

  if (await isFirstRun()) {
    console.error("No config found. Run the setup first:");
    console.error("  npx inloop install   (CLI wizard)");
    console.error("  or use /install-inloop in Claude Code");
    process.exit(1);
  }

  const config = await loadConfig();
  const db = initDB(config.dataDir);

  // Start click tracker if configured
  if (config.tracking?.enabled) {
    const tracker = new ClickTracker(config.tracking, db);
    await tracker.start();
  }

  // Poll for new emails → trigger Loop 1
  let polling = false;
  const emailPoll = async () => {
    if (polling) return;
    polling = true;
    try {
      const newEmails = await pollForNewEmails(config.email);
      for (const email of newEmails) {
        await triggerLoop1(email, config, db);
      }
    } catch (err) {
      console.error("Email poll error:", err);
    } finally {
      polling = false;
    }
  };

  setInterval(emailPoll, (config.pollInterval || 30) * 1000);
  await emailPoll(); // Initial poll

  // Daily research cron → trigger Loop 2
  cron.schedule(config.schedule.dailyResearch, async () => {
    console.log("⏰ Daily research triggered");
    await triggerLoop2(config, db);
  });

  // Weekly newsletter cron → trigger Loop 3
  cron.schedule(config.schedule.weeklyNewsletter, async () => {
    console.log("⏰ Weekly newsletter triggered");
    await triggerLoop3(config, db);
  });

  console.log("✅ inloop is running. Waiting for emails...");
  console.log(`   Daily research: ${config.schedule.dailyResearch}`);
  console.log(`   Weekly newsletter: ${config.schedule.weeklyNewsletter}`);

  process.on("SIGINT", () => {
    console.log("\n🛑 Shutting down...");
    process.exit(0);
  });
}

/**
 * Loop 1: Handle incoming email.
 * Invokes agent CLI with the email content injected into the prompt.
 */
async function triggerLoop1(
  email: { from: string; subject: string; text: string; date: string },
  config: InloopConfig,
  db: DB,
): Promise<void> {
  console.log(`📧 Processing email from ${email.from}: ${email.subject}`);

  const promptTemplate = readFileSync(
    join(PROJECT_ROOT, "prompts/loop1-email.md"),
    "utf-8",
  );

  // Inject email content into prompt
  const prompt = promptTemplate
    .replace("{EMAIL_FROM}", email.from)
    .replace("{EMAIL_SUBJECT}", email.subject)
    .replace("{EMAIL_BODY}", email.text)
    .replace("{EMAIL_DATE}", email.date)
    .replace("{DATA_DIR}", config.dataDir);

  try {
    execSync(`claude -p ${shellEscape(prompt)} --allowedTools "Bash(tsx:*)"`, {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      timeout: 120_000,
    });
  } catch (err) {
    console.error("Loop 1 agent error:", err);
  }
}

/**
 * Loop 2: Daily research per topic.
 * Invokes agent CLI once per topic with context injected.
 */
async function triggerLoop2(config: InloopConfig, db: DB): Promise<void> {
  const topics = db
    .prepare("SELECT * FROM topics")
    .all() as Array<{ id: number; name: string }>;

  if (topics.length === 0) {
    console.log("📭 No topics to research.");
    return;
  }

  const promptTemplate = readFileSync(
    join(PROJECT_ROOT, "prompts/loop2-daily.md"),
    "utf-8",
  );

  for (const topic of topics) {
    console.log(`🔍 Researching: ${topic.name}`);

    const prompt = promptTemplate
      .replace("{TOPIC_ID}", String(topic.id))
      .replace("{TOPIC_NAME}", topic.name)
      .replace("{DATA_DIR}", config.dataDir);

    try {
      execSync(`claude -p ${shellEscape(prompt)} --allowedTools "Bash(tsx:*)"`, {
        cwd: PROJECT_ROOT,
        stdio: "inherit",
        timeout: 300_000, // 5 min per topic
      });
    } catch (err) {
      console.error(`Loop 2 error for "${topic.name}":`, err);
    }
  }
}

/**
 * Loop 3: Weekly newsletter curation.
 * Invokes agent CLI with all topics' data.
 */
async function triggerLoop3(config: InloopConfig, db: DB): Promise<void> {
  const promptTemplate = readFileSync(
    join(PROJECT_ROOT, "prompts/loop3-weekly.md"),
    "utf-8",
  );

  const prompt = promptTemplate
    .replace("{DATA_DIR}", config.dataDir)
    .replace("{USER_EMAIL}", config.email.userEmail);

  try {
    execSync(`claude -p ${shellEscape(prompt)} --allowedTools "Bash(tsx:*)"`, {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      timeout: 600_000, // 10 min
    });
  } catch (err) {
    console.error("Loop 3 error:", err);
  }
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
