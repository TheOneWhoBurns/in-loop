#!/usr/bin/env tsx
/**
 * Remove a topic.
 * Usage: tsx scripts/topic-remove.ts <data_dir> <name>
 */
import { initDB } from "../src/db.js";

const [, , dataDir, name] = process.argv;
if (!dataDir || !name) {
  console.error("Usage: topic-remove.ts <data_dir> <name>");
  process.exit(1);
}

const db = initDB(dataDir);
const result = db.prepare("DELETE FROM topics WHERE name = ?").run(name);
console.log(result.changes > 0 ? `Topic "${name}" removed.` : `Topic "${name}" not found.`);
