/**
 * SQLite database — single file, used by both the daemon and tool scripts.
 */

import BetterSqlite3 from "better-sqlite3";
import { join } from "path";

export type DB = BetterSqlite3.Database;

export function initDB(dataDir: string): DB {
  const dbPath = join(dataDir, "inloop.sqlite");
  const db = new BetterSqlite3(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  createTables(db);
  return db;
}

function createTables(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      preferences TEXT DEFAULT '{}',
      example_sources TEXT DEFAULT '[]',
      source_criteria TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      name TEXT DEFAULT '',
      rating REAL DEFAULT 0.5,
      discovered_by TEXT DEFAULT 'agent',
      notes TEXT DEFAULT '',
      last_checked_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      source_id INTEGER REFERENCES sources(id),
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      summary TEXT DEFAULT '',
      relevance_score REAL DEFAULT 0.5,
      found_date TEXT DEFAULT (date('now')),
      included_in_newsletter INTEGER DEFAULT 0,
      clicked INTEGER DEFAULT 0,
      superseded_by INTEGER REFERENCES candidates(id),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS newsletters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sent_at TEXT DEFAULT (datetime('now')),
      topics_included TEXT DEFAULT '[]',
      full_html TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS influence_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      week_start TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rlm_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      topic_id INTEGER,
      content TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_candidates_topic_date ON candidates(topic_id, found_date);
    CREATE INDEX IF NOT EXISTS idx_sources_topic ON sources(topic_id);
    CREATE INDEX IF NOT EXISTS idx_rlm_type ON rlm_entries(type);
    CREATE INDEX IF NOT EXISTS idx_rlm_topic ON rlm_entries(topic_id);
  `);
}
