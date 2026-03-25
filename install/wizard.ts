#!/usr/bin/env tsx
/**
 * CLI Installation Wizard — guides a human through setting up inloop.
 *
 * Run: npx inloop install  OR  tsx install/wizard.ts
 *
 * Only 3 questions:
 *   1. Agent Gmail address
 *   2. App password
 *   3. Personal email (where newsletters go)
 *
 * Everything else is auto-detected or uses sensible defaults.
 */

import { createInterface } from "readline";
import { execSync, spawn } from "child_process";
import { join } from "path";
import { homedir } from "os";
import { appendFile, readFile, open } from "fs/promises";
import { saveConfig, type InloopConfig } from "../src/config.js";

const rl = createInterface({ input: process.stdin, output: process.stdout });

// Buffer lines so piped input doesn't get lost
const lineQueue: string[] = [];
const lineWaiters: Array<(line: string) => void> = [];
rl.on("line", (line) => {
  const waiter = lineWaiters.shift();
  if (waiter) waiter(line.trim());
  else lineQueue.push(line.trim());
});

function ask(q: string): Promise<string> {
  process.stdout.write(q);
  const buffered = lineQueue.shift();
  if (buffered !== undefined) return Promise.resolve(buffered);
  return new Promise((resolve) => lineWaiters.push(resolve));
}

// ── Agent CLI detection ───────────────────────────────────────────────

interface AgentCLI {
  name: string;
  command: string;
  /** Args to run a one-shot prompt */
  promptArgs: string[];
  /** Args for allowed tools */
  toolsArgs: string[];
  version: string;
}

const KNOWN_CLIS: Array<{
  name: string;
  command: string;
  versionFlag: string;
  promptArgs: string[];
  toolsArgs: string[];
}> = [
  {
    name: "Claude Code",
    command: "claude",
    versionFlag: "--version",
    promptArgs: ["-p"],
    toolsArgs: ["--allowedTools"],
  },
  {
    name: "OpenAI Codex",
    command: "codex",
    versionFlag: "--version",
    promptArgs: ["exec"],
    toolsArgs: [],
  },
];

function detectAgentCLIs(): AgentCLI[] {
  const found: AgentCLI[] = [];
  for (const cli of KNOWN_CLIS) {
    try {
      const version = execSync(`${cli.command} ${cli.versionFlag} 2>&1`, {
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      found.push({
        name: cli.name,
        command: cli.command,
        promptArgs: cli.promptArgs,
        toolsArgs: cli.toolsArgs,
        version,
      });
    } catch {
      // Not installed
    }
  }
  return found;
}

// ── Prereq checks ────────────────────────────────────────────────────

function checkPrereqs(): void {
  // Node is obviously present if we're running

  try {
    execSync("python3 --version", { stdio: "pipe" });
    console.log("  ✅ Python3");
  } catch {
    console.log("  ⚠️  Python3 not found — needed for web scraping");
  }

  try {
    execSync("python3 -c 'import scrapling'", { stdio: "pipe" });
    console.log("  ✅ Scrapling");
  } catch {
    console.log("  ⚠️  Scrapling not found — run: pip install scrapling");
  }
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log(`
╔════════════════════════════════════════════╗
║  🔄 inloop — Installation Wizard          ║
║  Personal newsletter agent. Email is UI.   ║
╚════════════════════════════════════════════╝
`);

  // Detect agent CLIs — hard requirement
  console.log("── Agent CLI Detection ───────────────────────────\n");
  const clis = detectAgentCLIs();

  if (clis.length === 0) {
    console.log("  ❌ No agent CLI found.\n");
    console.log("  inloop runs on top of an agent CLI. Install and authenticate one:\n");
    console.log("    Claude Code:  npm i -g @anthropic-ai/claude-code && claude login");
    console.log("    Codex CLI:    npm i -g @openai/codex\n");
    rl.close();
    process.exit(1);
  }

  for (const cli of clis) {
    console.log(`  ✅ ${cli.name}: ${cli.version}`);
  }

  // Check other prereqs
  console.log("\n── Prerequisites ─────────────────────────────────\n");
  checkPrereqs();

  // 3 questions
  console.log("\n── Email Setup ───────────────────────────────────\n");
  console.log("inloop needs a dedicated Gmail account for the agent.");
  console.log("Create one and enable 2FA → App Passwords.\n");

  const agentEmail = await ask("Agent Gmail address: ");
  const appPassword = await ask("App password (16 chars, no spaces): ");
  const userEmail = await ask("Your personal email: ");

  // Set env var for the app password
  const bashrc = join(homedir(), ".bashrc");
  const envLine = `\nexport INLOOP_APP_PASSWORD="${appPassword}"\n`;

  try {
    const existing = await readFile(bashrc, "utf-8").catch(() => "");
    if (!existing.includes("INLOOP_APP_PASSWORD")) {
      await appendFile(bashrc, envLine);
      console.log(`\n  ✅ Added INLOOP_APP_PASSWORD to ${bashrc}`);
    } else {
      console.log(`\n  ℹ️  INLOOP_APP_PASSWORD already in ${bashrc}`);
    }
  } catch {
    console.log(`\n  ⚠️  Could not write to ${bashrc}`);
    console.log(`  Add manually: export INLOOP_APP_PASSWORD="${appPassword}"`);
  }

  // Set it for the current process too
  process.env.INLOOP_APP_PASSWORD = appPassword;

  // Write config — Gmail defaults hardcoded
  const config: InloopConfig = {
    dataDir: join(homedir(), ".config", "inloop", "data"),
    email: {
      imap: {
        host: "imap.gmail.com",
        port: 993,
        secure: true,
        auth: { user: agentEmail, pass: "${INLOOP_APP_PASSWORD}" },
      },
      smtp: {
        host: "smtp.gmail.com",
        port: 587,
        secure: false, // STARTTLS
        auth: { user: agentEmail, pass: "${INLOOP_APP_PASSWORD}" },
      },
      userEmail,
    },
    schedule: {
      dailyResearch: "0 6 * * *",
      weeklyNewsletter: "0 18 * * 0",
    },
    pollInterval: 30,
  };

  // Save agent CLI info if detected
  if (clis.length > 0) {
    (config as any).agentCLI = {
      command: clis[0].command,
      promptArgs: clis[0].promptArgs,
      toolsArgs: clis[0].toolsArgs,
    };
  }

  await saveConfig(config);

  const logFile = join(config.dataDir, "daemon.log");

  console.log(`
╔════════════════════════════════════════════╗
║  ✅ Setup complete!                        ║
╚════════════════════════════════════════════╝

  Agent email:    ${agentEmail}
  Your email:     ${userEmail}

  Schedule:
    📰 Daily research     Every day at 6:00 AM
    📬 Weekly newsletter   Every Sunday at 6:00 PM

  Daemon log:     ${logFile}

Send your first email to ${agentEmail}:
  "Keep me in the loop about Japanese bond yields"
`);

  rl.close();

  // Start the daemon in the background — detached, output to log file
  const log = await open(logFile, "a");
  const child = spawn("npx", ["tsx", "src/daemon.ts"], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
  });
  child.unref();
  await log.close();

  console.log("  🔄 Daemon started (PID %d). Logs: tail -f %s\n", child.pid, logFile);
}

main().catch((err) => {
  console.error("Wizard error:", err);
  process.exit(1);
});
