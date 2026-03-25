#!/usr/bin/env tsx
/**
 * Query RLM for relevant context.
 * Usage: tsx scripts/rlm-recall.ts <data_dir> [--query <text>] [--type <type>] [--topic <id>] [--since <date>] [--limit <n>]
 */
import { initDB } from "../src/db.js";
import { rlmRecall } from "../src/rlm.js";
import type { RLMQuery } from "../src/rlm.js";

const args = process.argv.slice(2);
const dataDir = args[0];

if (!dataDir) {
  console.error("Usage: rlm-recall.ts <data_dir> [--query <text>] [--type <type>] [--topic <id>] [--since <date>] [--limit <n>]");
  process.exit(1);
}

const db = initDB(dataDir);
const q: RLMQuery = {};

for (let i = 1; i < args.length; i += 2) {
  switch (args[i]) {
    case "--query": q.query = args[i + 1]; break;
    case "--type":
      q.types = q.types || [];
      q.types.push(args[i + 1]);
      break;
    case "--topic": q.topicId = parseInt(args[i + 1]); break;
    case "--since": q.since = args[i + 1]; break;
    case "--until": q.until = args[i + 1]; break;
    case "--limit": q.limit = parseInt(args[i + 1]); break;
  }
}

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
