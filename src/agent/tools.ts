/**
 * Tool definitions and executors for all three agent loops.
 */

import type { DB } from "../db/index.js";
import type { RLM } from "../rlm/index.js";
import type { ToolDefinition } from "../llm/client.js";
import { scrape } from "../scraper/index.js";

// ─── Loop 1: Email Agent Tools ───────────────────────────────────────────────

export const emailAgentTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "add_topic",
      description:
        "Register a new topic for the user's newsletter with optional per-topic preferences and example sources",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Topic name" },
          preferences: {
            type: "string",
            description:
              "Per-topic preferences (e.g. preferred language, depth, tone)",
          },
          example_sources: {
            type: "array",
            items: { type: "string" },
            description: "Example URLs the user likes for this topic",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_topic",
      description: "Update an existing topic's preferences or sources",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Topic name to update" },
          preferences: { type: "string", description: "Updated preferences" },
          sources: {
            type: "array",
            items: { type: "string" },
            description: "Updated example sources",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_topic",
      description: "Remove a topic from the newsletter",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Topic name to remove" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_topics",
      description: "List all active topics with their preferences",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "respond_to_user",
      description: "Send an email response back to the user",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Response message text" },
        },
        required: ["message"],
      },
    },
  },
];

// ─── Loop 2: Daily Research Tools ────────────────────────────────────────────

export const dailyResearchTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "scrape",
      description:
        "Scrape a URL for content using Scrapling. Returns extracted text, headlines, and links.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to scrape" },
          extract: {
            type: "string",
            enum: ["headlines", "full", "links"],
            description: "What to extract",
          },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search",
      description:
        "Search Google or an aggregator for news. Use nuanced queries, not just '[topic] news'.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query (be specific and nuanced)",
          },
          source: {
            type: "string",
            enum: ["google", "reddit", "hackernews"],
            description: "Where to search",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tag_candidate",
      description: "Tag an article as a candidate for this week's newsletter",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          summary: { type: "string" },
          relevance_score: {
            type: "number",
            description: "0.0 to 1.0 relevance score",
          },
          source_name: {
            type: "string",
            description: "Name of the source site",
          },
          source_url: {
            type: "string",
            description: "Base URL of the source site",
          },
        },
        required: ["title", "url", "relevance_score"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_source",
      description: "Add a new source to the preferred sources for this topic",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          name: { type: "string" },
          rating: {
            type: "number",
            description: "Initial rating 0.0-1.0",
          },
          notes: {
            type: "string",
            description: "Why this source is worth tracking",
          },
        },
        required: ["url", "name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "think",
      description:
        "Write your reasoning to persistent storage so future agent instances can read it",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "Your reasoning and analysis",
          },
        },
        required: ["content"],
      },
    },
  },
];

// ─── Loop 3: Weekly Curator Tools ────────────────────────────────────────────

export const weeklyCuratorTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "think",
      description: "Write your reasoning to persistent storage",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string" },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "filter_candidate",
      description:
        "Mark a candidate as filtered out (superseded, stale, or duplicate)",
      parameters: {
        type: "object",
        properties: {
          candidate_id: { type: "number" },
          reason: {
            type: "string",
            enum: ["superseded", "stale", "duplicate", "low_relevance"],
          },
          superseded_by: {
            type: "number",
            description: "ID of the candidate that supersedes this one",
          },
        },
        required: ["candidate_id", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_source_rating",
      description:
        "Update a source's rating based on this week's performance",
      parameters: {
        type: "object",
        properties: {
          source_id: { type: "number" },
          new_rating: { type: "number" },
          reason: { type: "string" },
        },
        required: ["source_id", "new_rating"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_source_criteria",
      description:
        "Update the agent-written source criteria for a topic",
      parameters: {
        type: "object",
        properties: {
          topic_id: { type: "number" },
          criteria: {
            type: "string",
            description: "Updated criteria text",
          },
        },
        required: ["topic_id", "criteria"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_influence_note",
      description:
        "Write guidance for next week's daily research subagents",
      parameters: {
        type: "object",
        properties: {
          topic_id: { type: "number" },
          content: {
            type: "string",
            description: "Guidance for next week's research",
          },
        },
        required: ["topic_id", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compose_newsletter",
      description: "Compose the final newsletter from curated data",
      parameters: {
        type: "object",
        properties: {
          sections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                topic_name: { type: "string" },
                vibe_text: { type: "string" },
                article_ids: {
                  type: "array",
                  items: { type: "number" },
                  description: "IDs of selected candidates",
                },
              },
              required: ["topic_name", "vibe_text", "article_ids"],
            },
          },
          cross_topic_notes: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["sections"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_newsletter",
      description: "Send the composed newsletter to the user",
      parameters: {
        type: "object",
        properties: {
          newsletter_html: { type: "string" },
        },
        required: ["newsletter_html"],
      },
    },
  },
];

// ─── Tool Executors ──────────────────────────────────────────────────────────

export function createEmailToolExecutor(db: DB, rlm: RLM, sendReply: (msg: string) => Promise<void>) {
  return async (name: string, args: Record<string, unknown>): Promise<string> => {
    switch (name) {
      case "add_topic": {
        const stmt = db.prepare(
          "INSERT INTO topics (name, preferences, example_sources) VALUES (?, ?, ?)",
        );
        stmt.run(
          args.name as string,
          JSON.stringify(args.preferences || ""),
          JSON.stringify(args.example_sources || []),
        );
        return `Topic "${args.name}" added successfully.`;
      }

      case "update_topic": {
        const updates: string[] = [];
        const values: unknown[] = [];
        if (args.preferences !== undefined) {
          updates.push("preferences = ?");
          values.push(JSON.stringify(args.preferences));
        }
        if (args.sources !== undefined) {
          updates.push("example_sources = ?");
          values.push(JSON.stringify(args.sources));
        }
        if (updates.length === 0) return "Nothing to update.";
        updates.push("updated_at = datetime('now')");
        values.push(args.name as string);
        db.prepare(
          `UPDATE topics SET ${updates.join(", ")} WHERE name = ?`,
        ).run(...values);
        return `Topic "${args.name}" updated.`;
      }

      case "remove_topic": {
        db.prepare("DELETE FROM topics WHERE name = ?").run(args.name as string);
        return `Topic "${args.name}" removed.`;
      }

      case "list_topics": {
        const topics = db
          .prepare("SELECT name, preferences, example_sources FROM topics")
          .all() as Array<{ name: string; preferences: string; example_sources: string }>;
        if (topics.length === 0) return "No topics registered yet.";
        return topics
          .map(
            (t) =>
              `• ${t.name} (prefs: ${t.preferences}, sources: ${t.example_sources})`,
          )
          .join("\n");
      }

      case "respond_to_user": {
        await sendReply(args.message as string);
        return "Response sent.";
      }

      default:
        return `Unknown tool: ${name}`;
    }
  };
}
