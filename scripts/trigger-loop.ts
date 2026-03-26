#!/usr/bin/env tsx
/**
 * Manually trigger a loop for testing.
 *
 * Usage:
 *   tsx scripts/trigger-loop.ts <data_dir> --loop <1|2|3>
 *
 * Loop 1: Process unread emails (polls IMAP, passes to agent)
 * Loop 2: Daily research (runs for all topics or --topic <id>)
 * Loop 3: Weekly newsletter (curates and sends)
 */

import { loadConfig } from "../src/config.js";
import { initDB } from "../src/db.js";
import { pollForNewEmails } from "../src/email.js";
import { parseFlags } from "../src/script-helpers.js";
import { runAgent, loadPrompt, DEFAULT_AGENT_CLI } from "../src/agent.js";

const flags = parseFlags(process.argv.slice(2));
const loop = flags.loop;

if (!loop || loop === true || !["1", "2", "3"].includes(loop)) {
  console.error("Usage: tsx scripts/trigger-loop.ts <data_dir> --loop <1|2|3> [--topic <id>]");
  process.exit(1);
}

const config = await loadConfig();
const db = initDB(config.dataDir);
const agentCLI = config.agentCLI ?? DEFAULT_AGENT_CLI;

if (loop === "1") {
  console.log("🔄 Triggering Loop 1: Email processing...");
  const emails = await pollForNewEmails(config.email);
  if (emails.length === 0) {
    console.log("📭 No unread emails.");
  } else {
    const template = await loadPrompt("loop1-email.md");
    for (const email of emails) {
      console.log(`📧 Processing: ${email.from} — ${email.subject}`);
      const prompt = template
        .replace("{EMAIL_FROM}", email.from)
        .replace("{EMAIL_SUBJECT}", email.subject)
        .replace("{EMAIL_BODY}", email.text)
        .replace("{EMAIL_DATE}", email.date)
        .replaceAll("{DATA_DIR}", config.dataDir);
      await runAgent(agentCLI, prompt, 120_000);
    }
  }
} else if (loop === "2") {
  console.log("🔄 Triggering Loop 2: Daily research...");
  const topicFilter = flags.topic && flags.topic !== true ? parseInt(flags.topic) : null;

  const topics = topicFilter
    ? (db.prepare("SELECT id, name FROM topics WHERE id = ?").all(topicFilter) as Array<{ id: number; name: string }>)
    : (db.prepare("SELECT id, name FROM topics").all() as Array<{ id: number; name: string }>);

  if (topics.length === 0) {
    console.log("📭 No topics to research.");
  } else {
    const template = await loadPrompt("loop2-daily.md");
    for (const topic of topics) {
      console.log(`🔍 Researching: ${topic.name}`);
      const prompt = template
        .replaceAll("{TOPIC_ID}", String(topic.id))
        .replaceAll("{TOPIC_NAME}", topic.name)
        .replaceAll("{DATA_DIR}", config.dataDir);
      await runAgent(agentCLI, prompt, 300_000);
    }
  }
} else if (loop === "3") {
  console.log("🔄 Triggering Loop 3: Weekly newsletter...");
  const template = await loadPrompt("loop3-weekly.md");
  const prompt = template
    .replaceAll("{DATA_DIR}", config.dataDir)
    .replaceAll("{USER_EMAIL}", config.email.userEmail);
  await runAgent(agentCLI, prompt, 600_000);
}

db.close();
console.log("✅ Done.");
