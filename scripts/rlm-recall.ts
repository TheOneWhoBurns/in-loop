#!/usr/bin/env tsx
/**
 * Query RLM for relevant context.
 * Usage: tsx scripts/rlm-recall.ts <data_dir> [--query <text>] [--type <type>] [--topic <id>] [--since <date>] [--limit <n>]
 */
import { getDB, parseFlags } from "../src/script-helpers.js";
import { rlmRecall, type RLMQuery } from "../src/rlm.js";

const { db } = getDB();
const flags = parseFlags(process.argv.slice(3));

const q: RLMQuery = {};
if (flags.query && flags.query !== true) q.query = flags.query;
if (flags.type && flags.type !== true) q.types = [flags.type];
if (flags.topic && flags.topic !== true) q.topicId = parseInt(flags.topic);
if (flags.since && flags.since !== true) q.since = flags.since;
if (flags.until && flags.until !== true) q.until = flags.until;
if (flags.limit && flags.limit !== true) q.limit = parseInt(flags.limit);

const results = rlmRecall(db, q);

if (results.length === 0) {
  console.log("No matching entries found.");
} else {
  for (const r of results) {
    console.log(`--- [${r.type}] score:${r.score.toFixed(2)} ${r.createdAt} ---`);
    console.log(r.content);
    console.log();
  }
}
