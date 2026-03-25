/**
 * Shared helpers for tool scripts in scripts/.
 * Reduces boilerplate for DB init, arg parsing, and error handling.
 */

import { initDB, type DB } from "./db.js";

/** Print usage message and exit. */
export function usage(msg: string): never {
  console.error(msg);
  process.exit(1);
}

/** Get DB from first argv positional arg (data_dir). */
export function getDB(): { db: DB; dataDir: string } {
  const dataDir = process.argv[2];
  if (!dataDir) usage("First argument must be data_dir");
  return { db: initDB(dataDir), dataDir };
}

/**
 * Parse --flag value pairs from argv (after the positional args).
 * Handles value-less flags (like --all) correctly.
 */
export function parseFlags(args: string[]): Record<string, string | true> {
  const flags: Record<string, string | true> = {};

  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) continue;
    const key = args[i].slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i++;
    }
  }

  return flags;
}

/**
 * Parse the [topic_id] <content> optional-positional pattern
 * used by think.ts and rlm-store.ts.
 */
export function parseOptionalTopicAndContent(
  args: string[],
): { topicId: number | null; content: string } {
  if (args.length >= 2 && !isNaN(parseInt(args[0]))) {
    return { topicId: parseInt(args[0]), content: args[1] };
  }
  return { topicId: null, content: args[0] };
}

/** Escape a string for safe HTML interpolation. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
