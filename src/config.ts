import { readFile, writeFile, access, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export interface EmailConfig {
  imap: {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
  };
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
  };
  /** The user's personal email (where newsletters go) */
  userEmail: string;
}

export interface TrackingConfig {
  enabled: boolean;
  port: number;
  /** Public URL base for tracked links (e.g. via Cloudflare Tunnel) */
  publicUrl?: string;
}

export interface AgentCLIConfig {
  /** Binary name (e.g. "claude", "codex") */
  command: string;
  /** Args to pass a one-shot prompt (e.g. ["-p"] for claude, ["exec"] for codex) */
  promptArgs: string[];
  /** Args to restrict allowed tools (e.g. ["--allowedTools"] for claude) */
  toolsArgs: string[];
}

export interface InloopConfig {
  dataDir: string;
  email: EmailConfig;
  tracking?: TrackingConfig;
  /** Which agent CLI to use. Auto-detected by wizard. */
  agentCLI?: AgentCLIConfig;
  /** Cron expressions */
  schedule: {
    dailyResearch: string; // e.g. "0 6 * * *" (6am daily)
    weeklyNewsletter: string; // e.g. "0 18 * * 0" (6pm Sunday)
  };
  /** IMAP poll interval in seconds */
  pollInterval: number;
}

const CONFIG_DIR = join(homedir(), ".config", "inloop");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export async function isFirstRun(): Promise<boolean> {
  try {
    await access(CONFIG_FILE);
    return false;
  } catch {
    return true;
  }
}

export async function loadConfig(): Promise<InloopConfig> {
  const raw = await readFile(CONFIG_FILE, "utf-8");
  const config = JSON.parse(raw) as InloopConfig;

  config.dataDir = config.dataDir || join(CONFIG_DIR, "data");
  await mkdir(config.dataDir, { recursive: true });

  // Resolve env var references in auth passwords (e.g. "${INLOOP_APP_PASSWORD}")
  resolveEnvVars(config);

  return config;
}

function resolveEnvVars(config: InloopConfig): void {
  const resolve = (val: string): string => {
    const match = val.match(/^\$\{(\w+)\}$/);
    if (match) {
      const envVal = process.env[match[1]];
      if (!envVal) throw new Error(`Environment variable ${match[1]} is not set`);
      return envVal;
    }
    return val;
  };

  config.email.imap.auth.pass = resolve(config.email.imap.auth.pass);
  config.email.smtp.auth.pass = resolve(config.email.smtp.auth.pass);
}

export async function saveConfig(config: InloopConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

export { CONFIG_DIR, CONFIG_FILE };
