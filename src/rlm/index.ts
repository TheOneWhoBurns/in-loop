/**
 * RLM — Recursive Language Model for information recall.
 *
 * Custom implementation for inloop's needs. The core idea:
 * instead of stuffing everything into the context window,
 * the agent treats stored information as an external environment
 * it can programmatically query.
 *
 * Stores reasoning traces, topic data, email interactions,
 * source evaluations, and more — then provides structured
 * recall by type, topic, date range, and semantic relevance.
 */

import type { DB } from "../db/index.js";
import { RLMStore, type StoredEntry } from "./store.js";
import { RLMRecall, type RecallQuery, type RecallResult } from "./recall.js";

export class RLM {
  private store: RLMStore;
  private recall_: RLMRecall;

  constructor(db: DB) {
    this.store = new RLMStore(db);
    this.recall_ = new RLMRecall(db);
  }

  /**
   * Store a new entry in the RLM.
   */
  async store(entry: Omit<StoredEntry, "id" | "createdAt">): Promise<void> {
    this.store.save(entry);
  }

  /**
   * Recall entries matching the query.
   * Returns the most relevant entries, scored and ranked.
   */
  async recall(query: RecallQuery): Promise<RecallResult[]> {
    return this.recall_.query(query);
  }
}

export type { StoredEntry, RecallQuery, RecallResult };
