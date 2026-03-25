import { readFile, access, mkdir } from "fs/promises";
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

export interface InloopConfig {
  dataDir: string;
  email: EmailConfig;
  tracking?: TrackingConfig;
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

  // Ensure data dir exists
  config.dataDir = config.dataDir || join(CONFIG_DIR, "data");
  await mkdir(config.dataDir, { recursive: true });

  return config;
}

export async function saveConfig(config: InloopConfig): Promise<void> {
  const { writeFile } = await import("fs/promises");
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

export { CONFIG_DIR, CONFIG_FILE };
