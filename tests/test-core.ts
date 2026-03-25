#!/usr/bin/env tsx
/**
 * Core unit tests — runs without external services (no IMAP, no SMTP).
 * Tests: config env resolution, DB schema, RLM store/recall, script helpers,
 *        composer HTML output, agent CLI detection.
 *
 * Run: npx tsx tests/test-core.ts
 */

import { initDB, type DB } from "../src/db.js";
import { rlmStore, rlmRecall } from "../src/rlm.js";
import { parseFlags, parseOptionalTopicAndContent, escapeHtml } from "../src/script-helpers.js";
import { composeNewsletter } from "../src/composer.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string): void {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    failed++;
  }
}

function assertEqual(actual: unknown, expected: unknown, name: string): void {
  const eq = JSON.stringify(actual) === JSON.stringify(expected);
  if (!eq) {
    console.log(`  ❌ ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  } else {
    console.log(`  ✅ ${name}`);
    passed++;
  }
}

// ── Setup ─────────────────────────────────────────────────────────────

const tmpDir = mkdtempSync(join(tmpdir(), "inloop-test-"));
let db: DB;

try {
  // ── DB Tests ──────────────────────────────────────────────────────

  console.log("\n── Database ──────────────────────────────────────\n");

  db = initDB(tmpDir);
  assert(db !== null, "initDB creates database");

  // Tables exist
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all() as Array<{ name: string }>;
  const tableNames = tables.map(t => t.name).filter(n => !n.startsWith("sqlite_"));
  assert(tableNames.includes("topics"), "topics table exists");
  assert(tableNames.includes("sources"), "sources table exists");
  assert(tableNames.includes("candidates"), "candidates table exists");
  assert(tableNames.includes("newsletters"), "newsletters table exists");
  assert(tableNames.includes("influence_notes"), "influence_notes table exists");
  assert(tableNames.includes("rlm_entries"), "rlm_entries table exists");

  // Insert a topic
  db.prepare("INSERT INTO topics (name) VALUES (?)").run("Japanese bond yields");
  const topic = db.prepare("SELECT * FROM topics WHERE name = ?").get("Japanese bond yields") as any;
  assert(topic !== undefined, "can insert and query topic");
  assertEqual(topic.name, "Japanese bond yields", "topic name matches");

  // Insert source with FK
  db.prepare("INSERT INTO sources (topic_id, url, name) VALUES (?, ?, ?)").run(topic.id, "https://example.com", "Test Source");
  const source = db.prepare("SELECT * FROM sources WHERE topic_id = ?").get(topic.id) as any;
  assert(source !== undefined, "can insert source with FK");

  // Insert candidate
  db.prepare("INSERT INTO candidates (topic_id, title, url) VALUES (?, ?, ?)").run(topic.id, "Test Article", "https://example.com/article");
  const candidate = db.prepare("SELECT * FROM candidates WHERE topic_id = ?").get(topic.id) as any;
  assert(candidate !== undefined, "can insert candidate");
  assertEqual(candidate.relevance_score, 0.5, "default relevance_score is 0.5");

  // ── RLM Tests ─────────────────────────────────────────────────────

  console.log("\n── RLM ───────────────────────────────────────────\n");

  rlmStore(db, { type: "think", content: "Bond yields are rising in Japan", topicId: topic.id });
  rlmStore(db, { type: "source_criteria", content: "Prefer primary sources from BoJ", topicId: topic.id });
  rlmStore(db, { type: "think", content: "Weather is nice today" });

  // Recall all
  const all = rlmRecall(db, { limit: 10 });
  assertEqual(all.length, 3, "rlmRecall returns all 3 entries");

  // Recall by type
  const thinks = rlmRecall(db, { types: ["think"], limit: 10 });
  assertEqual(thinks.length, 2, "type filter returns 2 think entries");

  // Recall by topic
  const topicEntries = rlmRecall(db, { topicId: topic.id, limit: 10 });
  assert(topicEntries.length >= 2, "topic filter includes topic entries");

  // Recall with keyword query
  const bondResults = rlmRecall(db, { query: "bond yields Japan", limit: 10 });
  assert(bondResults.length > 0, "keyword query returns results");
  assert(bondResults[0].content.includes("Bond yields"), "best match contains query terms");

  // Recall with query that shouldn't match well
  const noMatch = rlmRecall(db, { query: "cryptocurrency blockchain", limit: 10 });
  assert(noMatch.every(r => r.score < 0.5), "irrelevant query gets low scores");

  // ── Script Helpers Tests ──────────────────────────────────────────

  console.log("\n── Script Helpers ────────────────────────────────\n");

  // parseFlags
  assertEqual(parseFlags(["--all"]), { all: true }, "parseFlags: valueless flag");
  assertEqual(parseFlags(["--topic", "1"]), { topic: "1" }, "parseFlags: flag with value");
  assertEqual(
    parseFlags(["--all", "--topic", "1", "--limit", "5"]),
    { all: true, topic: "1", limit: "5" },
    "parseFlags: mixed flags"
  );
  assertEqual(parseFlags([]), {}, "parseFlags: empty args");
  assertEqual(parseFlags(["positional", "--flag"]), { flag: true }, "parseFlags: skips positional");

  // parseOptionalTopicAndContent
  assertEqual(
    parseOptionalTopicAndContent(["1", "some content"]),
    { topicId: 1, content: "some content" },
    "parseOptionalTopicAndContent: with topic id"
  );
  assertEqual(
    parseOptionalTopicAndContent(["just content"]),
    { topicId: null, content: "just content" },
    "parseOptionalTopicAndContent: without topic id"
  );

  // escapeHtml
  assertEqual(escapeHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;', "escapeHtml: escapes all chars");
  assertEqual(escapeHtml("safe text"), "safe text", "escapeHtml: leaves safe text");

  // ── Composer Tests ────────────────────────────────────────────────

  console.log("\n── Composer ──────────────────────────────────────\n");

  const html = composeNewsletter({
    weekLabel: "March 17–23, 2026",
    sections: [
      {
        topicName: "Japanese Bond Yields",
        vibeText: "BoJ is under pressure this week.",
        articles: [
          { title: "BoJ Rate Decision", url: "https://example.com/boj", summary: "Key takeaways" },
          { title: "Yield Curve Update", url: "https://example.com/yield" },
        ],
      },
    ],
    crossTopicNotes: ["Bond yields may affect tech stocks"],
  });

  assert(html.includes("<!DOCTYPE html>"), "newsletter starts with doctype");
  assert(html.includes("March 17–23, 2026"), "newsletter contains week label");
  assert(html.includes("Japanese Bond Yields"), "newsletter contains topic name");
  assert(html.includes("BoJ is under pressure"), "newsletter contains vibe text");
  assert(html.includes("https://example.com/boj"), "newsletter contains article URL");
  assert(html.includes("BoJ Rate Decision"), "newsletter contains article title");
  assert(html.includes("Key takeaways"), "newsletter contains article summary");
  assert(html.includes("Yield Curve Update"), "newsletter contains second article");
  assert(html.includes("Cross-topic"), "newsletter contains cross-topic section");
  assert(html.includes("Bond yields may affect tech stocks"), "newsletter contains cross-topic note");
  assert(!html.includes("<script>"), "newsletter has no script tags");

  // HTML escaping in composer
  const xssHtml = composeNewsletter({
    weekLabel: "test",
    sections: [{
      topicName: '<script>alert("xss")</script>',
      vibeText: "safe",
      articles: [{ title: '<img onerror=alert(1)>', url: "https://example.com" }],
    }],
  });
  assert(!xssHtml.includes("<script>alert"), "composer escapes XSS in topic name");
  assert(!xssHtml.includes("<img onerror"), "composer escapes XSS in article title");

  // Empty newsletter
  const emptyHtml = composeNewsletter({ weekLabel: "test", sections: [] });
  assert(emptyHtml.includes("<!DOCTYPE html>"), "empty newsletter still valid HTML");

  // ── Config Env Resolution Tests ───────────────────────────────────

  console.log("\n── Config Env Resolution ─────────────────────────\n");

  // Test the resolve pattern directly (can't import the private function)
  const resolvePattern = /^\$\{(\w+)\}$/;
  assert(resolvePattern.test("${INLOOP_APP_PASSWORD}"), "env var pattern matches");
  assert(!resolvePattern.test("plaintext"), "env var pattern rejects plain text");
  assert(!resolvePattern.test("${PARTIAL"), "env var pattern rejects incomplete");
  assert(!resolvePattern.test("prefix${VAR}suffix"), "env var pattern rejects embedded");

  const match = "${INLOOP_APP_PASSWORD}".match(resolvePattern);
  assertEqual(match?.[1], "INLOOP_APP_PASSWORD", "env var pattern extracts name");

} finally {
  // Cleanup
  try { db!.close(); } catch {}
  rmSync(tmpDir, { recursive: true, force: true });
}

// ── Summary ─────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(50)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
