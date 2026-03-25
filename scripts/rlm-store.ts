#!/usr/bin/env tsx
/**
 * Store an entry in RLM.
 * Usage: tsx scripts/rlm-store.ts <data_dir> <type> [topic_id] <content>
 */
import { getDB, parseOptionalTopicAndContent } from "../src/script-helpers.js";
import { rlmStore } from "../src/rlm.js";

const { db } = getDB();
const type = process.argv[3];

if (!type) {
  console.error("Usage: rlm-store.ts <data_dir> <type> [topic_id] <content>");
  process.exit(1);
}

const { topicId, content } = parseOptionalTopicAndContent(process.argv.slice(4));

rlmStore(db, { type, topicId, content });
console.log(`RLM entry stored (type: ${type}).`);
