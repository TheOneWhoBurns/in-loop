#!/usr/bin/env node

import cron from "node-cron";
import { loadConfig, isFirstRun, type InloopConfig } from "./config.js";
import { initDB, type DB } from "./db.js";
import { ClickTracker } from "./tracker.js";
import { runAgent, loadPrompt, DEFAULT_AGENT_CLI } from "./agent.js";
import { fetchNewEmails, startPolling, type AgentMailConfig } from "./agentmail.js";
import type { AgentCLIConfig } from "./config.js";

const MAX_CONCURRENT_TOPICS = 3;

let promptLoop1 = "";
let promptLoop2 = "";
let promptLoop3 = "";

async function loadPrompts(): Promise<void> {
  [promptLoop1, promptLoop2, promptLoop3] = await Promise.all([
    loadPrompt("loop1-email.md"),
    loadPrompt("loop2-daily.md"),
    loadPrompt("loop3-weekly.md"),
  ]);
}

async function main() {
  console.log("🔄 inloop — starting up...");

  if (await isFirstRun()) {
    console.error("No config found. Run the setup first:");
    console.error("  tsx install/wizard.ts");
    process.exit(1);
  }

  const config = await loadConfig();
  const agentCLI: AgentCLIConfig = config.agentCLI ?? DEFAULT_AGENT_CLI;
  await loadPrompts();
  const db = initDB(config.dataDir);

  let tracker: ClickTracker | null = null;
  if (config.tracking?.enabled) {
    tracker = new ClickTracker(config.tracking, db);
    await tracker.start();
  }

  // Build AgentMail config from email config
  const mailConfig: AgentMailConfig = {
    apiKey: config.email.imap.auth.pass, // API key stored as IMAP password
    inboxId: config.email.imap.auth.user, // inbox address stored as IMAP user
  };

  // Process any emails that arrived while we were offline
  let processing = false;
  const processNewEmails = async () => {
    if (processing) return;
    processing = true;
    try {
      const emails = await fetchNewEmails(mailConfig);
      if (emails.length > 0) {
        console.log(`📫 ${emails.length} new email(s) received`);
        for (const email of emails) {
          await triggerLoop1(email, config, agentCLI);
        }
      }
    } catch (err) {
      console.error("Email processing error:", err);
    } finally {
      processing = false;
    }
  };

  await processNewEmails();

  // Poll for new emails every 60s via lightweight API check
  const poller = startPolling(mailConfig, () => {
    processNewEmails();
  });

  const cronOpts = config.timezone ? { timezone: config.timezone } : {};

  cron.schedule(config.schedule.dailyResearch, async () => {
    console.log("⏰ Daily research triggered");
    await triggerLoop2(config, db, agentCLI);
  }, cronOpts);

  cron.schedule(config.schedule.weeklyNewsletter, async () => {
    console.log("⏰ Weekly newsletter triggered");
    await triggerLoop3(config, agentCLI);
  }, cronOpts);

  const tz = config.timezone || "UTC";
  console.log("✅ inloop is running. Checking for emails every 60s...");
  console.log(`   Inbox: ${mailConfig.inboxId}`);
  console.log(`   Timezone: ${tz}`);
  console.log(`   Daily research: ${config.schedule.dailyResearch} (${tz})`);
  console.log(`   Weekly newsletter: ${config.schedule.weeklyNewsletter} (${tz})`);

  process.on("SIGINT", async () => {
    console.log("\n🛑 Shutting down...");
    poller.close();
    if (tracker) await tracker.stop();
    db.close();
    process.exit(0);
  });
}

async function triggerLoop1(
  email: { from: string; subject: string; text: string; date: string },
  config: InloopConfig,
  agentCLI: AgentCLIConfig,
): Promise<void> {
  console.log(`📧 Processing email from ${email.from}: ${email.subject}`);

  const prompt = promptLoop1
    .replace("{EMAIL_FROM}", email.from)
    .replace("{EMAIL_SUBJECT}", email.subject)
    .replace("{EMAIL_BODY}", email.text)
    .replace("{EMAIL_DATE}", email.date)
    .replaceAll("{DATA_DIR}", config.dataDir);

  try {
    await runAgent(agentCLI, prompt, 120_000);
  } catch (err) {
    console.error("Loop 1 agent error:", err);
  }
}

async function triggerLoop2(config: InloopConfig, db: DB, agentCLI: AgentCLIConfig): Promise<void> {
  const topics = db
    .prepare("SELECT id, name FROM topics")
    .all() as Array<{ id: number; name: string }>;

  if (topics.length === 0) {
    console.log("📭 No topics to research.");
    return;
  }

  const chunks: Array<typeof topics> = [];
  for (let i = 0; i < topics.length; i += MAX_CONCURRENT_TOPICS) {
    chunks.push(topics.slice(i, i + MAX_CONCURRENT_TOPICS));
  }

  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (topic) => {
        console.log(`🔍 Researching: ${topic.name}`);
        const prompt = promptLoop2
          .replaceAll("{TOPIC_ID}", String(topic.id))
          .replaceAll("{TOPIC_NAME}", topic.name)
          .replaceAll("{DATA_DIR}", config.dataDir);

        try {
          await runAgent(agentCLI, prompt, 300_000);
        } catch (err) {
          console.error(`Loop 2 error for "${topic.name}":`, err);
        }
      }),
    );
  }
}

async function triggerLoop3(config: InloopConfig, agentCLI: AgentCLIConfig): Promise<void> {
  const prompt = promptLoop3
    .replaceAll("{DATA_DIR}", config.dataDir)
    .replaceAll("{USER_EMAIL}", config.email.userEmail);

  try {
    await runAgent(agentCLI, prompt, 600_000);
  } catch (err) {
    console.error("Loop 3 error:", err);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
