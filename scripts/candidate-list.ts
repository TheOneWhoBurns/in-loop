#!/usr/bin/env tsx
/**
 * List candidates for a topic, optionally filtered by week.
 * Usage: tsx scripts/candidate-list.ts <data_dir> [--topic <id>] [--week <YYYY-MM-DD>] [--all]
 */
import { initDB } from "../src/db.js";

const args = process.argv.slice(2);
const dataDir = args[0];
if (!dataDir) {
  console.error("Usage: candidate-list.ts <data_dir> [--topic <id>] [--week <YYYY-MM-DD>] [--all]");
  process.exit(1);
}

const db = initDB(dataDir);
const conditions: string[] = [];
const params: unknown[] = [];

for (let i = 1; i < args.length; i += 2) {
  if (args[i] === "--topic") {
    conditions.push("c.topic_id = ?");
    params.push(parseInt(args[i + 1]));
  } else if (args[i] === "--week") {
    conditions.push("c.found_date >= ?");
    params.push(args[i + 1]);
  } else if (args[i] === "--all") {
    i--; // no value
  }
}

// Default: only non-superseded
if (!args.includes("--all")) {
  conditions.push("c.superseded_by IS NULL");
  conditions.push("c.relevance_score >= 0");
}

const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

const candidates = db.prepare(
  `SELECT c.*, t.name as topic_name FROM candidates c
   JOIN topics t ON c.topic_id = t.id
   ${where}
   ORDER BY c.relevance_score DESC`,
).all(...params) as Array<{
  id: number;
  topic_name: string;
  title: string;
  url: string;
  summary: string;
  relevance_score: number;
  found_date: string;
  included_in_newsletter: number;
  clicked: number;
}>;

if (candidates.length === 0) {
  console.log("No candidates found.");
} else {
  for (const c of candidates) {
    const flags = [
      c.included_in_newsletter ? "SENT" : "",
      c.clicked ? "CLICKED" : "",
    ].filter(Boolean).join(",");

    console.log(`[${c.id}] (${c.topic_name}) ${c.title}`);
    console.log(`    URL: ${c.url}`);
    console.log(`    Score: ${c.relevance_score} | Date: ${c.found_date}${flags ? ` | ${flags}` : ""}`);
    if (c.summary) console.log(`    ${c.summary}`);
    console.log();
  }
}
