#!/usr/bin/env tsx
/**
 * CLI Installation Wizard — guides a human through setting up inloop.
 *
 * Run: npx inloop install  OR  tsx install/wizard.ts
 */

import { createInterface } from "readline";
import { execSync } from "child_process";
import { join } from "path";
import { homedir } from "os";
import { saveConfig, type InloopConfig } from "../src/config.js";

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));
}

function askDefault(q: string, def: string): Promise<string> {
  return new Promise((resolve) =>
    rl.question(`${q} [${def}]: `, (a) => resolve(a.trim() || def)),
  );
}

async function main() {
  console.log(`
╔════════════════════════════════════════════╗
║  🔄 inloop — Installation Wizard          ║
║  Personal newsletter agent. Email is UI.   ║
╚════════════════════════════════════════════╝
`);

  // Step 1: Agent CLI check
  console.log("── Step 1: Agent CLI ─────────────────────────────\n");
  console.log("inloop runs on top of an agent CLI (currently Claude Code).");
  console.log("Checking if Claude Code is installed...\n");

  try {
    const version = execSync("claude --version 2>&1", { encoding: "utf-8" }).trim();
    console.log(`✅ Claude Code found: ${version}\n`);
  } catch {
    console.log("⚠️  Claude Code not found.");
    console.log("   Install it: npm install -g @anthropic-ai/claude-code");
    console.log("   Then authenticate: claude login\n");
    const cont = await ask("Continue anyway? (y/n): ");
    if (cont.toLowerCase() !== "y") {
      rl.close();
      process.exit(1);
    }
  }

  // Step 2: Email account
  console.log("── Step 2: Email Account ─────────────────────────\n");
  console.log("Create a dedicated email for your inloop agent.");
  console.log("Example: inloopagent@protonmail.com\n");

  const imapHost = await ask("IMAP host (e.g. imap.gmail.com): ");
  const imapPort = await askDefault("IMAP port", "993");
  const smtpHost = await ask("SMTP host (e.g. smtp.gmail.com): ");
  const smtpPort = await askDefault("SMTP port", "465");
  const emailUser = await ask("Email address (login): ");
  const emailPass = await ask("Email password / app password: ");

  // Step 3: Personal email
  console.log("\n── Step 3: Your Personal Email ───────────────────\n");
  const userEmail = await ask("Your personal email (where newsletters go): ");

  // Step 4: Click tracking
  console.log("\n── Step 4: Click Tracking (Optional) ────────────\n");
  console.log("Track which links you click to improve future curation.");
  console.log("Needs Cloudflare Tunnel (free) for links to work on mobile.\n");
  const enableTracking = (await askDefault("Enable click tracking?", "n")).toLowerCase() === "y";

  let trackingConfig = undefined;
  if (enableTracking) {
    const port = await askDefault("Tracking server port", "3847");
    const publicUrl = await ask("Public URL (from cloudflared, or blank to skip): ");
    trackingConfig = {
      enabled: true,
      port: parseInt(port),
      publicUrl: publicUrl || undefined,
    };
  }

  // Step 5: Schedule
  console.log("\n── Step 5: Schedule ──────────────────────────────\n");
  const dailyCron = await askDefault("Daily research time (cron)", "0 6 * * *");
  const weeklyCron = await askDefault("Weekly newsletter time (cron)", "0 18 * * 0");

  // Step 6: Python/Scrapling
  console.log("\n── Step 6: Python & Scrapling ────────────────────\n");

  try {
    execSync("python3 --version", { stdio: "pipe" });
    console.log("✅ Python3 found");
  } catch {
    console.log("⚠️  Python3 not found. Install it for web scraping.");
  }

  try {
    execSync("python3 -c 'import scrapling'", { stdio: "pipe" });
    console.log("✅ Scrapling installed");
  } catch {
    console.log("⚠️  Scrapling not installed.");
    const install = await askDefault("Install now? (pip install scrapling)", "y");
    if (install.toLowerCase() === "y") {
      try {
        execSync("pip install scrapling", { stdio: "inherit" });
      } catch {
        console.log("⚠️  Install failed. Run manually: pip install scrapling");
      }
    }
  }

  // Step 7: Node dependencies
  console.log("\n── Step 7: Node Dependencies ─────────────────────\n");
  try {
    execSync("npm install", { stdio: "inherit", cwd: process.cwd() });
    console.log("✅ Dependencies installed");
  } catch {
    console.log("⚠️  npm install failed. Run manually.");
  }

  // Save config
  const config: InloopConfig = {
    dataDir: join(homedir(), ".config", "inloop", "data"),
    email: {
      imap: { host: imapHost, port: parseInt(imapPort), secure: true, auth: { user: emailUser, pass: emailPass } },
      smtp: { host: smtpHost, port: parseInt(smtpPort), secure: true, auth: { user: emailUser, pass: emailPass } },
      userEmail,
    },
    tracking: trackingConfig,
    schedule: { dailyResearch: dailyCron, weeklyNewsletter: weeklyCron },
    pollInterval: 30,
  };

  await saveConfig(config);

  console.log(`
╔════════════════════════════════════════════╗
║  ✅ Setup complete!                        ║
╚════════════════════════════════════════════╝

Start inloop:   npm run dev
Agent email:    ${emailUser}
Your email:     ${userEmail}

Send your first email to ${emailUser}:
  "Keep me in the loop about Japanese bond yields"
`);

  rl.close();
}

main().catch((err) => {
  console.error("Wizard error:", err);
  process.exit(1);
});
