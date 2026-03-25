#!/usr/bin/env tsx
/**
 * Add a topic. Called by the agent.
 * Usage: tsx scripts/topic-add.ts <data_dir> <name> [preferences] [sources_json]
 */
import { initDB } from "../src/db.js";

const [, , dataDir, name, preferences, sourcesJson] = process.argv;

if (!dataDir || !name) {
  console.error("Usage: topic-add.ts <data_dir> <name> [preferences] [sources_json]");
  process.exit(1);
}

const db = initDB(dataDir);
db.prepare(
  "INSERT INTO topics (name, preferences, example_sources) VALUES (?, ?, ?)",
).run(name, preferences || "{}", sourcesJson || "[]");

console.log(`Topic "${name}" added.`);
