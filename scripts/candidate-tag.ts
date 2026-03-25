#!/usr/bin/env tsx
/**
 * Tag an article as a candidate for the weekly newsletter.
 * Usage: tsx scripts/candidate-tag.ts <data_dir> <topic_id> <title> <url> <relevance_score> [summary] [source_url]
 */
import { initDB } from "../src/db.js";

const [, , dataDir, topicIdStr, title, url, scoreStr, summary, sourceUrl] = process.argv;

if (!dataDir || !topicIdStr || !title || !url || !scoreStr) {
  console.error("Usage: candidate-tag.ts <data_dir> <topic_id> <title> <url> <score> [summary] [source_url]");
  process.exit(1);
}

const db = initDB(dataDir);
const topicId = parseInt(topicIdStr);
const score = parseFloat(scoreStr);

let sourceId: number | null = null;
if (sourceUrl) {
  const source = db.prepare(
    "SELECT id FROM sources WHERE url = ? AND topic_id = ?",
  ).get(sourceUrl, topicId) as { id: number } | undefined;
  sourceId = source?.id ?? null;
}

db.prepare(
  `INSERT INTO candidates (topic_id, source_id, title, url, summary, relevance_score)
   VALUES (?, ?, ?, ?, ?, ?)`,
).run(topicId, sourceId, title, url, summary || "", score);

console.log(`Candidate tagged: "${title}" (score: ${score})`);
