#!/usr/bin/env tsx
/**
 * Update a topic's preferences or sources.
 * Usage: tsx scripts/topic-update.ts <data_dir> <name> [--preferences <json>] [--sources <json>]
 */
import { initDB } from "../src/db.js";

const args = process.argv.slice(2);
const dataDir = args[0];
const name = args[1];

if (!dataDir || !name) {
  console.error("Usage: topic-update.ts <data_dir> <name> [--preferences <json>] [--sources <json>]");
  process.exit(1);
}

const db = initDB(dataDir);
const updates: string[] = [];
const values: unknown[] = [];

for (let i = 2; i < args.length; i += 2) {
  if (args[i] === "--preferences") {
    updates.push("preferences = ?");
    values.push(args[i + 1]);
  } else if (args[i] === "--sources") {
    updates.push("example_sources = ?");
    values.push(args[i + 1]);
  }
}

if (updates.length === 0) {
  console.log("Nothing to update.");
  process.exit(0);
}

updates.push("updated_at = datetime('now')");
values.push(name);

db.prepare(`UPDATE topics SET ${updates.join(", ")} WHERE name = ?`).run(...values);
console.log(`Topic "${name}" updated.`);
