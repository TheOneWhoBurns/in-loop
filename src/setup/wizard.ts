/**
 * First-run setup wizard.
 *
 * Walks the user through:
 * 1. LLM provider setup (via byok-llm wizard)
 * 2. Email account configuration (IMAP/SMTP)
 * 3. Optional click tracking (Cloudflare Tunnel)
 * 4. Python/Scrapling check
 */

import { createInterface } from "readline";
import { setupWizard as byokWizard } from "byok-llm";
import { saveConfig, type InloopConfig } from "../config.js";

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function askDefault(question: string, defaultValue: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(`${question} [${defaultValue}]: `, (answer) => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

export async function runWizard(): Promise<void> {
  console.log("\n🔄 Welcome to inloop setup!\n");
  console.log("I'll help you configure your personal newsletter agent.\n");

  // Step 1: LLM provider
  console.log("── Step 1: LLM Provider ──────────────────────────\n");
  console.log("inloop uses byok-llm to manage your API keys.");
  console.log("You can use any supported provider (OpenAI, Anthropic, Groq, etc.)\n");
  await byokWizard({ appName: "inloop" });

  // Step 2: Email
  console.log("\n── Step 2: Email Account ─────────────────────────\n");
  console.log("Create a dedicated email for your inloop agent.");
  console.log("Example: inloopagent@protonmail.com, myagent@gmail.com\n");

  const imapHost = await ask("IMAP host (e.g. imap.gmail.com): ");
  const imapPort = await askDefault("IMAP port", "993");
  const smtpHost = await ask("SMTP host (e.g. smtp.gmail.com): ");
  const smtpPort = await askDefault("SMTP port", "465");
  const emailUser = await ask("Email address (login): ");
  const emailPass = await ask("Email password / app password: ");
  const userEmail = await ask("YOUR personal email (where newsletters go): ");

  // Step 3: Click tracking
  console.log("\n── Step 3: Click Tracking (Optional) ────────────\n");
  console.log("Track which newsletter links you click to improve curation.");
  console.log("Requires Cloudflare Tunnel (free) for links to work from any device.\n");
  const enableTracking = (await askDefault("Enable click tracking?", "n")).toLowerCase() === "y";

  let trackingConfig = undefined;
  if (enableTracking) {
    const trackingPort = await askDefault("Tracking server port", "3847");
    const publicUrl = await ask("Public URL (from Cloudflare Tunnel, or leave blank): ");
    trackingConfig = {
      enabled: true,
      port: parseInt(trackingPort),
      publicUrl: publicUrl || undefined,
    };
  }

  // Step 4: Schedule
  console.log("\n── Step 4: Schedule ──────────────────────────────\n");
  const dailyCron = await askDefault("Daily research cron", "0 6 * * *");
  const weeklyCron = await askDefault("Weekly newsletter cron", "0 18 * * 0");

  // Step 5: Python check
  console.log("\n── Step 5: Python / Scrapling ────────────────────\n");
  console.log("Checking Python installation...");

  const { execSync } = await import("child_process");
  try {
    execSync("python3 --version", { stdio: "pipe" });
    console.log("✅ Python3 found");
  } catch {
    console.log("⚠️  Python3 not found. Scrapling won't work without it.");
    console.log("   Install Python3 and run: pip install scrapling");
  }

  try {
    execSync("python3 -c 'import scrapling'", { stdio: "pipe" });
    console.log("✅ Scrapling installed");
  } catch {
    console.log("⚠️  Scrapling not found. Installing...");
    try {
      execSync("pip install scrapling", { stdio: "inherit" });
      console.log("✅ Scrapling installed");
    } catch {
      console.log("⚠️  Failed to install Scrapling. Install manually: pip install scrapling");
    }
  }

  // Save config
  const config: InloopConfig = {
    dataDir: "",
    email: {
      imap: {
        host: imapHost,
        port: parseInt(imapPort),
        secure: true,
        auth: { user: emailUser, pass: emailPass },
      },
      smtp: {
        host: smtpHost,
        port: parseInt(smtpPort),
        secure: true,
        auth: { user: emailUser, pass: emailPass },
      },
      userEmail,
    },
    tracking: trackingConfig,
    schedule: {
      dailyResearch: dailyCron,
      weeklyNewsletter: weeklyCron,
    },
    pollInterval: 30,
  };

  await saveConfig(config);

  console.log("\n✅ Setup complete! inloop is ready to go.");
  console.log(`\n📧 Send an email to ${emailUser} to add your first topic.`);
  console.log('   Example: "Keep me in the loop about Japanese bond yields"\n');

  rl.close();
}
