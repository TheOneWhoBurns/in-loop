import type Database from "better-sqlite3";

export function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      preferences TEXT DEFAULT '{}',    -- JSON: per-topic user preferences
      example_sources TEXT DEFAULT '[]', -- JSON: user-provided example sources
      source_criteria TEXT DEFAULT '',   -- Agent-written criteria for what makes a good source
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      name TEXT DEFAULT '',
      rating REAL DEFAULT 0.5,          -- 0.0 to 1.0, agent-assigned
      discovered_by TEXT DEFAULT 'agent', -- 'user' or 'agent'
      notes TEXT DEFAULT '',             -- Agent notes about this source
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
      topics_included TEXT DEFAULT '[]', -- JSON array of topic ids
      full_html TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS think_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loop_type TEXT NOT NULL,           -- 'daily', 'weekly', 'email'
      topic_id INTEGER REFERENCES topics(id),
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS influence_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      week_start TEXT NOT NULL,          -- ISO date of week start
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_candidates_topic_date ON candidates(topic_id, found_date);
    CREATE INDEX IF NOT EXISTS idx_candidates_included ON candidates(included_in_newsletter);
    CREATE INDEX IF NOT EXISTS idx_think_logs_loop ON think_logs(loop_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_sources_topic ON sources(topic_id);
    CREATE INDEX IF NOT EXISTS idx_influence_notes_topic_week ON influence_notes(topic_id, week_start);
  `);
}
