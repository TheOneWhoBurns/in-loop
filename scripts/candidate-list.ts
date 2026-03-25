#!/usr/bin/env tsx
/**
 * List candidates for a topic, optionally filtered by week.
 * Usage: tsx scripts/candidate-list.ts <data_dir> [--topic <id>] [--week <YYYY-MM-DD>] [--all]
 */
import { getDB, parseFlags } from "../src/script-helpers.js";

const { db } = getDB();
const flags = parseFlags(process.argv.slice(3));

const conditions: string[] = [];
const params: unknown[] = [];

if (flags.topic && flags.topic !== true) {
  conditions.push("c.topic_id = ?");
  params.push(parseInt(flags.topic));
}
if (flags.week && flags.week !== true) {
  conditions.push("c.found_date >= ?");
  params.push(flags.week);
}

if (!flags.all) {
  conditions.push("c.superseded_by IS NULL");
  conditions.push("c.relevance_score >= 0");
}

const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

const candidates = db.prepare(
  `SELECT c.id, c.title, c.url, c.summary, c.relevance_score, c.found_date,
          c.included_in_newsletter, c.clicked, t.name as topic_name
   FROM candidates c
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
    const tags = [
      c.included_in_newsletter ? "SENT" : "",
      c.clicked ? "CLICKED" : "",
    ].filter(Boolean).join(",");

    console.log(`[${c.id}] (${c.topic_name}) ${c.title}`);
    console.log(`    URL: ${c.url}`);
    console.log(`    Score: ${c.relevance_score} | Date: ${c.found_date}${tags ? ` | ${tags}` : ""}`);
    if (c.summary) console.log(`    ${c.summary}`);
    console.log();
  }
}
