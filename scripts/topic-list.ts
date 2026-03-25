#!/usr/bin/env tsx
/**
 * List all topics with their preferences and sources.
 * Usage: tsx scripts/topic-list.ts <data_dir>
 */
import { initDB } from "../src/db.js";

const [, , dataDir] = process.argv;
if (!dataDir) {
  console.error("Usage: topic-list.ts <data_dir>");
  process.exit(1);
}

const db = initDB(dataDir);
const topics = db.prepare("SELECT * FROM topics ORDER BY created_at").all() as Array<{
  id: number;
  name: string;
  preferences: string;
  example_sources: string;
  source_criteria: string;
}>;

if (topics.length === 0) {
  console.log("No topics registered.");
} else {
  for (const t of topics) {
    console.log(`[${t.id}] ${t.name}`);
    console.log(`    Preferences: ${t.preferences}`);
    console.log(`    Example sources: ${t.example_sources}`);
    if (t.source_criteria) console.log(`    Source criteria: ${t.source_criteria}`);
    console.log();
  }
}
