#!/usr/bin/env tsx
/**
 * List sources for a topic.
 * Usage: tsx scripts/source-list.ts <data_dir> <topic_id>
 */
import { initDB } from "../src/db.js";

const [, , dataDir, topicIdStr] = process.argv;

if (!dataDir || !topicIdStr) {
  console.error("Usage: source-list.ts <data_dir> <topic_id>");
  process.exit(1);
}

const db = initDB(dataDir);
const sources = db.prepare(
  "SELECT * FROM sources WHERE topic_id = ? ORDER BY rating DESC",
).all(parseInt(topicIdStr)) as Array<{
  id: number;
  url: string;
  name: string;
  rating: number;
  discovered_by: string;
  notes: string;
}>;

if (sources.length === 0) {
  console.log("No sources for this topic.");
} else {
  for (const s of sources) {
    console.log(`[${s.id}] ${s.name} (${s.url})`);
    console.log(`    Rating: ${s.rating} | Found by: ${s.discovered_by}`);
    if (s.notes) console.log(`    Notes: ${s.notes}`);
    console.log();
  }
}
