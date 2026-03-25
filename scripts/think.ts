#!/usr/bin/env tsx
/**
 * Store a THINK output (reasoning trace).
 * Usage: tsx scripts/think.ts <data_dir> <loop_type> [topic_id] <content>
 * loop_type: daily | weekly | email
 */
import { getDB, parseOptionalTopicAndContent } from "../src/script-helpers.js";
import { rlmStore } from "../src/rlm.js";

const { db } = getDB();
const loopType = process.argv[3];

if (!loopType) {
  console.error("Usage: think.ts <data_dir> <loop_type> [topic_id] <content>");
  process.exit(1);
}

const { topicId, content } = parseOptionalTopicAndContent(process.argv.slice(4));

rlmStore(db, {
  type: `think_${loopType}`,
  topicId,
  content,
});

console.log(`Reasoning stored (${loopType}${topicId ? `, topic ${topicId}` : ""}).`);
