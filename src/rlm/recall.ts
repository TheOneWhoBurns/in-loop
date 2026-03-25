/**
 * RLM Recall — query stored context intelligently.
 *
 * Combines type-based filtering, topic scoping, date ranges,
 * and keyword matching to find the most relevant context
 * for any agent instance.
 *
 * Future enhancement: add embedding-based semantic search.
 */

import type { DB } from "../db/index.js";

export interface RecallQuery {
  /** Free-text query for keyword matching */
  query?: string;
  /** Filter by entry types */
  types?: string[];
  /** Filter by topic */
  topicId?: number;
  /** Max entries to return */
  limit?: number;
  /** Only entries after this date */
  since?: string;
  /** Only entries before this date */
  until?: string;
}

export interface RecallResult {
  id: number;
  type: string;
  topicId: number | null;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  relevanceScore: number;
}

export class RLMRecall {
  private db: DB;

  constructor(db: DB) {
    this.db = db;
  }

  query(q: RecallQuery): RecallResult[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    // Type filter
    if (q.types && q.types.length > 0) {
      conditions.push(`type IN (${q.types.map(() => "?").join(",")})`);
      params.push(...q.types);
    }

    // Topic filter
    if (q.topicId !== undefined) {
      conditions.push("(topic_id = ? OR topic_id IS NULL)");
      params.push(q.topicId);
    }

    // Date range
    if (q.since) {
      conditions.push("created_at >= ?");
      params.push(q.since);
    }
    if (q.until) {
      conditions.push("created_at <= ?");
      params.push(q.until);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = q.limit || 20;

    // Get entries
    const entries = this.db
      .prepare(
        `SELECT id, type, topic_id as topicId, content, metadata, created_at as createdAt
         FROM rlm_entries ${where}
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...params, limit) as Array<{
      id: number;
      type: string;
      topicId: number | null;
      content: string;
      metadata: string;
      createdAt: string;
    }>;

    // Score entries by keyword relevance
    const queryTerms = (q.query || "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    return entries.map((entry) => {
      let relevanceScore = 0.5; // Base score

      if (queryTerms.length > 0) {
        const contentLower = entry.content.toLowerCase();
        const matches = queryTerms.filter((t) =>
          contentLower.includes(t),
        ).length;
        relevanceScore = matches / queryTerms.length;
      }

      // Recency boost: newer entries get a small boost
      const ageHours =
        (Date.now() - new Date(entry.createdAt).getTime()) / (1000 * 60 * 60);
      const recencyBoost = Math.max(0, 0.1 * (1 - ageHours / (24 * 7)));
      relevanceScore += recencyBoost;

      return {
        ...entry,
        metadata: JSON.parse(entry.metadata),
        relevanceScore: Math.min(1, relevanceScore),
      };
    }).sort((a, b) => b.relevanceScore - a.relevanceScore);
  }
}
