#!/usr/bin/env tsx
/**
 * Store a THINK output (reasoning trace).
 * Usage: tsx scripts/think.ts <data_dir> <loop_type> [topic_id] <content>
 * loop_type: daily | weekly | email
 */
import { initDB } from "../src/db.js";
import { rlmStore } from "../src/rlm.js";

const args = process.argv.slice(2);
const dataDir = args[0];
const loopType = args[1];

if (!dataDir || !loopType) {
  console.error("Usage: think.ts <data_dir> <loop_type> [topic_id] <content>");
  process.exit(1);
}

const db = initDB(dataDir);

let topicId: number | null = null;
let content: string;

if (args.length === 4 && !isNaN(parseInt(args[2]))) {
  topicId = parseInt(args[2]);
  content = args[3];
} else {
  content = args[2];
}

// Store in think_logs table
db.prepare(
  "INSERT INTO think_logs (loop_type, topic_id, content) VALUES (?, ?, ?)",
).run(loopType, topicId, content);

// Also store in RLM
rlmStore(db, {
  type: `think_${loopType}`,
  topicId,
  content,
});

console.log(`Reasoning stored (${loopType}${topicId ? `, topic ${topicId}` : ""}).`);
