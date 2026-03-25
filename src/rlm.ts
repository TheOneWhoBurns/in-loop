/**
 * RLM — Recursive Language Model for information recall.
 *
 * Custom implementation. Context is stored in SQLite and queried
 * via tool scripts that the agent calls. Supports keyword search,
 * type filtering, topic scoping, date ranges, and recency scoring.
 */

import type { DB } from "./db.js";

export interface RLMEntry {
  type: string;
  topicId?: number | null;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface RLMQuery {
  query?: string;
  types?: string[];
  topicId?: number;
  limit?: number;
  since?: string;
  until?: string;
}

export interface RLMResult {
  id: number;
  type: string;
  topicId: number | null;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  score: number;
}

export function rlmStore(db: DB, entry: RLMEntry): void {
  db.prepare(
    "INSERT INTO rlm_entries (type, topic_id, content, metadata) VALUES (?, ?, ?, ?)",
  ).run(
    entry.type,
    entry.topicId ?? null,
    entry.content,
    JSON.stringify(entry.metadata || {}),
  );
}

export function rlmRecall(db: DB, q: RLMQuery): RLMResult[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (q.types && q.types.length > 0) {
    conditions.push(`type IN (${q.types.map(() => "?").join(",")})`);
    params.push(...q.types);
  }

  if (q.topicId !== undefined) {
    conditions.push("(topic_id = ? OR topic_id IS NULL)");
    params.push(q.topicId);
  }

  if (q.since) {
    conditions.push("created_at >= ?");
    params.push(q.since);
  }

  if (q.until) {
    conditions.push("created_at <= ?");
    params.push(q.until);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = q.limit || 20;
  // Fetch a larger window so keyword scoring can find relevant older entries
  const fetchLimit = q.query ? limit * 5 : limit;

  const entries = db
    .prepare(
      `SELECT id, type, topic_id as topicId, content, metadata, created_at as createdAt
       FROM rlm_entries ${where}
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params, fetchLimit) as Array<{
    id: number;
    type: string;
    topicId: number | null;
    content: string;
    metadata: string;
    createdAt: string;
  }>;

  const queryTerms = (q.query || "").toLowerCase().split(/\s+/).filter(Boolean);

  return entries
    .map((entry) => {
      let score = 0.5;

      if (queryTerms.length > 0) {
        const lower = entry.content.toLowerCase();
        const matches = queryTerms.filter((t) => lower.includes(t)).length;
        score = matches / queryTerms.length;
      }

      // Recency boost
      const ageHours =
        (Date.now() - new Date(entry.createdAt).getTime()) / 3_600_000;
      score += Math.max(0, 0.1 * (1 - ageHours / 168)); // 168h = 1 week

      return {
        ...entry,
        metadata: JSON.parse(entry.metadata),
        score: Math.min(1, score),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
