/**
 * Loop 2: Daily Research Subagent — runs once per day per topic.
 *
 * One continuous LLM inference call that:
 * THINKs → SCRAPEs → SEARCHes → THINKs → TAGs → STOREs
 */

import type { DB } from "../db/index.js";
import type { RLM } from "../rlm/index.js";
import { runAgentLoop } from "../llm/client.js";
import { LOOP2_DAILY_RESEARCH } from "../llm/prompts.js";
import { dailyResearchTools } from "./tools.js";
import { scrape } from "../scraper/index.js";

interface Topic {
  id: number;
  name: string;
  preferences: string;
  example_sources: string;
  source_criteria: string;
}

export async function runDailyResearch(db: DB, rlm: RLM): Promise<void> {
  const topics = db.prepare("SELECT * FROM topics").all() as Topic[];

  if (topics.length === 0) {
    console.log("📭 No topics to research.");
    return;
  }

  for (const topic of topics) {
    console.log(`🔍 Researching topic: ${topic.name}`);
    await researchTopic(topic, db, rlm);
  }
}

async function researchTopic(
  topic: Topic,
  db: DB,
  rlm: RLM,
): Promise<void> {
  // Gather context for the prompt
  const sources = db
    .prepare("SELECT * FROM sources WHERE topic_id = ? ORDER BY rating DESC")
    .all(topic.id) as Array<{
    id: number;
    url: string;
    name: string;
    rating: number;
    notes: string;
  }>;

  const sentNews = db
    .prepare(
      `SELECT c.title, c.url FROM candidates c
       WHERE c.topic_id = ? AND c.included_in_newsletter = 1
       ORDER BY c.created_at DESC LIMIT 50`,
    )
    .all(topic.id) as Array<{ title: string; url: string }>;

  const previousThinks = await rlm.recall({
    query: `daily research ${topic.name}`,
    types: ["think_daily"],
    topicId: topic.id,
    limit: 7, // Last 7 days
  });

  const influenceNotes = db
    .prepare(
      `SELECT content FROM influence_notes
       WHERE topic_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .all(topic.id) as Array<{ content: string }>;

  // Build the system prompt
  const systemPrompt = LOOP2_DAILY_RESEARCH
    .replace("{topic_name}", topic.name)
    .replace("{topic_preferences}", topic.preferences || "None specified")
    .replace("{example_sources}", topic.example_sources || "None")
    .replace(
      "{preferred_sources}",
      sources.length > 0
        ? sources
            .map((s) => `• ${s.name} (${s.url}) — rating: ${s.rating} — ${s.notes}`)
            .join("\n")
        : "No preferred sources yet. Start by checking the example sources and discovering new ones.",
    )
    .replace("{source_criteria}", topic.source_criteria || "No criteria yet. Develop initial criteria based on the topic and user preferences.")
    .replace(
      "{previous_thinks}",
      previousThinks.map((t) => t.content).join("\n---\n") || "No previous reasoning this week.",
    )
    .replace(
      "{sent_news}",
      sentNews.map((n) => `• ${n.title} (${n.url})`).join("\n") || "Nothing sent yet.",
    )
    .replace(
      "{influence_notes}",
      influenceNotes.map((n) => n.content).join("\n") || "No guidance from last week's curator.",
    );

  // Create tool executor
  const executor = createResearchToolExecutor(topic.id, db, rlm);

  // Run the agent loop
  await runAgentLoop(
    [{ role: "system", content: systemPrompt }],
    dailyResearchTools,
    executor,
  );

  console.log(`✅ Finished researching: ${topic.name}`);
}

function createResearchToolExecutor(
  topicId: number,
  db: DB,
  rlm: RLM,
) {
  return async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> => {
    switch (name) {
      case "scrape": {
        try {
          const result = await scrape(
            args.url as string,
            (args.extract as string) || "headlines",
          );
          return result;
        } catch (err) {
          return `Scrape failed: ${err}`;
        }
      }

      case "search": {
        // TODO: Implement Google/Reddit/HN search via Scrapling or APIs
        const source = (args.source as string) || "google";
        const query = args.query as string;
        try {
          const result = await scrape(
            source === "reddit"
              ? `https://www.reddit.com/search/?q=${encodeURIComponent(query)}&sort=new`
              : source === "hackernews"
                ? `https://hn.algolia.com/?q=${encodeURIComponent(query)}`
                : `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=nws`,
            "headlines",
          );
          return result;
        } catch (err) {
          return `Search failed: ${err}`;
        }
      }

      case "tag_candidate": {
        const sourceId = args.source_url
          ? (
              db
                .prepare("SELECT id FROM sources WHERE url = ? AND topic_id = ?")
                .get(args.source_url, topicId) as { id: number } | undefined
            )?.id ?? null
          : null;

        db.prepare(
          `INSERT INTO candidates (topic_id, source_id, title, url, summary, relevance_score)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          topicId,
          sourceId,
          args.title as string,
          args.url as string,
          (args.summary as string) || "",
          args.relevance_score as number,
        );
        return `Candidate tagged: "${args.title}" (score: ${args.relevance_score})`;
      }

      case "add_source": {
        db.prepare(
          `INSERT OR IGNORE INTO sources (topic_id, url, name, rating, discovered_by, notes)
           VALUES (?, ?, ?, ?, 'agent', ?)`,
        ).run(
          topicId,
          args.url as string,
          args.name as string,
          (args.rating as number) || 0.5,
          (args.notes as string) || "",
        );
        return `Source added: ${args.name} (${args.url})`;
      }

      case "think": {
        db.prepare(
          "INSERT INTO think_logs (loop_type, topic_id, content) VALUES ('daily', ?, ?)",
        ).run(topicId, args.content as string);

        await rlm.store({
          type: "think_daily",
          topicId,
          content: args.content as string,
        });
        return "Reasoning stored.";
      }

      default:
        return `Unknown tool: ${name}`;
    }
  };
}
