#!/usr/bin/env tsx
/**
 * Store an entry in RLM.
 * Usage: tsx scripts/rlm-store.ts <data_dir> <type> [topic_id] <content>
 */
import { initDB } from "../src/db.js";
import { rlmStore } from "../src/rlm.js";

const args = process.argv.slice(2);
const dataDir = args[0];
const type = args[1];

if (!dataDir || !type) {
  console.error("Usage: rlm-store.ts <data_dir> <type> [topic_id] <content>");
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

rlmStore(db, { type, topicId, content });
console.log(`RLM entry stored (type: ${type}).`);
