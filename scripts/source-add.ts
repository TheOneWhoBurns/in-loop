#!/usr/bin/env tsx
/**
 * Add a source for a topic.
 * Usage: tsx scripts/source-add.ts <data_dir> <topic_id> <url> <name> [rating] [notes]
 */
import { initDB } from "../src/db.js";

const [, , dataDir, topicIdStr, url, name, ratingStr, notes] = process.argv;

if (!dataDir || !topicIdStr || !url || !name) {
  console.error("Usage: source-add.ts <data_dir> <topic_id> <url> <name> [rating] [notes]");
  process.exit(1);
}

const db = initDB(dataDir);
db.prepare(
  `INSERT OR IGNORE INTO sources (topic_id, url, name, rating, discovered_by, notes)
   VALUES (?, ?, ?, ?, 'agent', ?)`,
).run(parseInt(topicIdStr), url, name, parseFloat(ratingStr || "0.5"), notes || "");

console.log(`Source added: ${name} (${url})`);
