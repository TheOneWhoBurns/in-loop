#!/usr/bin/env node

import { execFile } from "child_process";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import cron from "node-cron";
import { loadConfig, isFirstRun, type InloopConfig } from "./config.js";
import { initDB, type DB } from "./db.js";
import { pollForNewEmails } from "./email.js";
import { ClickTracker } from "./tracker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

const ALLOWED_TOOLS = "Bash(tsx:*)";
const MAX_CONCURRENT_TOPICS = 3;

/** Default to Claude Code if no agentCLI configured */
const DEFAULT_AGENT_CLI = {
  command: "claude",
  promptArgs: ["-p"],
  toolsArgs: ["--allowedTools"],
};

// Prompt templates — loaded once at startup
let promptLoop1 = "";
let promptLoop2 = "";
let promptLoop3 = "";

async function loadPrompts(): Promise<void> {
  [promptLoop1, promptLoop2, promptLoop3] = await Promise.all([
    readFile(join(PROJECT_ROOT, "prompts/loop1-email.md"), "utf-8"),
    readFile(join(PROJECT_ROOT, "prompts/loop2-daily.md"), "utf-8"),
    readFile(join(PROJECT_ROOT, "prompts/loop3-weekly.md"), "utf-8"),
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
  const db = initDB(config.dataDir);
  initAgentCLI(config);
  await loadPrompts();

  if (config.tracking?.enabled) {
    const tracker = new ClickTracker(config.tracking, db);
    await tracker.start();
  }

  let polling = false;
  const emailPoll = async () => {
    if (polling) return;
    polling = true;
    try {
      console.log("📫 Polling for new emails...");
      const newEmails = await pollForNewEmails(config.email);
      console.log(`   Found ${newEmails.length} unread email(s)`);
      for (const email of newEmails) {
        await triggerLoop1(email, config);
      }
    } catch (err) {
      console.error("Email poll error:", err);
    } finally {
      polling = false;
    }
  };

  setInterval(emailPoll, (config.pollInterval || 30) * 1000);
  await emailPoll();

  cron.schedule(config.schedule.dailyResearch, async () => {
    console.log("⏰ Daily research triggered");
    await triggerLoop2(config, db);
  });

  cron.schedule(config.schedule.weeklyNewsletter, async () => {
    console.log("⏰ Weekly newsletter triggered");
    await triggerLoop3(config);
  });

  console.log("✅ inloop is running. Waiting for emails...");
  console.log(`   Daily research: ${config.schedule.dailyResearch}`);
  console.log(`   Weekly newsletter: ${config.schedule.weeklyNewsletter}`);

  process.on("SIGINT", () => {
    console.log("\n🛑 Shutting down...");
    db.close();
    process.exit(0);
  });
}

let agentCLI = DEFAULT_AGENT_CLI;

function initAgentCLI(config: InloopConfig): void {
  if (config.agentCLI) {
    agentCLI = config.agentCLI;
  }
}

function runAgent(prompt: string, timeoutMs: number): Promise<void> {
  const args = [
    ...agentCLI.promptArgs,
    prompt,
    ...(agentCLI.toolsArgs.length > 0 ? [...agentCLI.toolsArgs, ALLOWED_TOOLS] : []),
  ];

  return new Promise((resolve, reject) => {
    const child = execFile(
      agentCLI.command,
      args,
      { cwd: PROJECT_ROOT, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });
}

async function triggerLoop1(
  email: { from: string; subject: string; text: string; date: string },
  config: InloopConfig,
): Promise<void> {
  console.log(`📧 Processing email from ${email.from}: ${email.subject}`);

  const prompt = promptLoop1
    .replace("{EMAIL_FROM}", email.from)
    .replace("{EMAIL_SUBJECT}", email.subject)
    .replace("{EMAIL_BODY}", email.text)
    .replace("{EMAIL_DATE}", email.date)
    .replaceAll("{DATA_DIR}", config.dataDir);

  try {
    await runAgent(prompt, 120_000);
  } catch (err) {
    console.error("Loop 1 agent error:", err);
  }
}

async function triggerLoop2(config: InloopConfig, db: DB): Promise<void> {
  const topics = db
    .prepare("SELECT id, name FROM topics")
    .all() as Array<{ id: number; name: string }>;

  if (topics.length === 0) {
    console.log("📭 No topics to research.");
    return;
  }

  // Run topics in parallel with bounded concurrency
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
          await runAgent(prompt, 300_000);
        } catch (err) {
          console.error(`Loop 2 error for "${topic.name}":`, err);
        }
      }),
    );
  }
}

async function triggerLoop3(config: InloopConfig): Promise<void> {
  const prompt = promptLoop3
    .replaceAll("{DATA_DIR}", config.dataDir)
    .replaceAll("{USER_EMAIL}", config.email.userEmail);

  try {
    await runAgent(prompt, 600_000);
  } catch (err) {
    console.error("Loop 3 error:", err);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
