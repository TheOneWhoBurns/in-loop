/**
 * RLM Store — persists context entries to SQLite.
 *
 * Entry types:
 * - email_interaction: User ↔ agent email exchanges
 * - think_daily: Daily research reasoning traces
 * - think_weekly: Weekly curation reasoning traces
 * - topic: Topic metadata snapshots
 * - source_eval: Agent's source evaluations
 * - influence: Weekly influence notes
 */

import type { DB } from "../db/index.js";

export interface StoredEntry {
  id?: number;
  type: string;
  topicId?: number;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export class RLMStore {
  private db: DB;

  constructor(db: DB) {
    this.db = db;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rlm_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        topic_id INTEGER,
        content TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_rlm_type ON rlm_entries(type);
      CREATE INDEX IF NOT EXISTS idx_rlm_topic ON rlm_entries(topic_id);
      CREATE INDEX IF NOT EXISTS idx_rlm_created ON rlm_entries(created_at);
    `);
  }

  save(entry: Omit<StoredEntry, "id" | "createdAt">): void {
    this.db
      .prepare(
        "INSERT INTO rlm_entries (type, topic_id, content, metadata) VALUES (?, ?, ?, ?)",
      )
      .run(
        entry.type,
        entry.topicId ?? null,
        entry.content,
        JSON.stringify(entry.metadata || {}),
      );
  }

  /**
   * Get recent entries by type, optionally filtered by topic.
   */
  getRecent(
    type: string,
    limit: number,
    topicId?: number,
  ): StoredEntry[] {
    if (topicId !== undefined) {
      return this.db
        .prepare(
          `SELECT * FROM rlm_entries
           WHERE type = ? AND topic_id = ?
           ORDER BY created_at DESC LIMIT ?`,
        )
        .all(type, topicId, limit) as StoredEntry[];
    }

    return this.db
      .prepare(
        `SELECT * FROM rlm_entries
         WHERE type = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(type, limit) as StoredEntry[];
  }

  /**
   * Full-text search across all entries.
   * Uses SQLite LIKE for now — can be upgraded to FTS5 later.
   */
  search(query: string, limit: number): StoredEntry[] {
    const terms = query.split(/\s+/).filter(Boolean);
    const where = terms.map(() => "content LIKE ?").join(" AND ");
    const params = terms.map((t) => `%${t}%`);

    return this.db
      .prepare(
        `SELECT * FROM rlm_entries
         WHERE ${where}
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...params, limit) as StoredEntry[];
  }
}
