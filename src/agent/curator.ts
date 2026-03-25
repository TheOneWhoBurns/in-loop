/**
 * Loop 3: Weekly Newsletter Agent — curates and sends the weekly newsletter.
 *
 * One continuous LLM inference call that:
 * THINKs → FILTERs → THINKs → CURATEs → CROSS-TOPICs →
 * RE-EVALUATEs sources → INFLUENCEs next week → ASSEMBLEs → SENDs
 */

import type { DB } from "../db/index.js";
import type { RLM } from "../rlm/index.js";
import type { InloopConfig } from "../config.js";
import { runAgentLoop } from "../llm/client.js";
import { LOOP3_WEEKLY_CURATOR } from "../llm/prompts.js";
import { weeklyCuratorTools } from "./tools.js";
import {
  composeNewsletter,
  type NewsletterData,
  type NewsletterSection,
} from "../email/composer.js";
import { EmailGateway } from "../email/gateway.js";

interface Candidate {
  id: number;
  topic_id: number;
  title: string;
  url: string;
  summary: string;
  relevance_score: number;
  found_date: string;
  clicked: number;
}

interface Topic {
  id: number;
  name: string;
  preferences: string;
  source_criteria: string;
}

export async function runWeeklyCuration(
  config: InloopConfig,
  db: DB,
  rlm: RLM,
): Promise<void> {
  console.log("📰 Starting weekly newsletter curation...");

  const topics = db.prepare("SELECT * FROM topics").all() as Topic[];
  if (topics.length === 0) {
    console.log("📭 No topics to curate.");
    return;
  }

  // Gather all candidates from this week
  const weekStart = getWeekStart();
  const candidates = db
    .prepare(
      `SELECT * FROM candidates
       WHERE found_date >= ? AND superseded_by IS NULL
       ORDER BY topic_id, relevance_score DESC`,
    )
    .all(weekStart) as Candidate[];

  // Gather think logs from this week
  const weeklyThinks = db
    .prepare(
      `SELECT * FROM think_logs
       WHERE loop_type = 'daily' AND created_at >= ?
       ORDER BY created_at`,
    )
    .all(weekStart) as Array<{
    topic_id: number;
    content: string;
    created_at: string;
  }>;

  // Get last week's click data
  const lastWeekStart = getWeekStart(-1);
  const clickData = db
    .prepare(
      `SELECT c.title, c.url, c.clicked, t.name as topic_name
       FROM candidates c
       JOIN topics t ON c.topic_id = t.id
       WHERE c.included_in_newsletter = 1 AND c.found_date >= ? AND c.found_date < ?`,
    )
    .all(lastWeekStart, weekStart) as Array<{
    title: string;
    url: string;
    clicked: number;
    topic_name: string;
  }>;

  // Build prompt context
  const systemPrompt = LOOP3_WEEKLY_CURATOR
    .replace(
      "{weekly_candidates}",
      topics
        .map((t) => {
          const topicCandidates = candidates.filter((c) => c.topic_id === t.id);
          return `## ${t.name}\n${topicCandidates.map((c) => `[ID:${c.id}] ${c.title} (${c.url}) — score: ${c.relevance_score} — ${c.summary}`).join("\n") || "No candidates this week."}`;
        })
        .join("\n\n"),
    )
    .replace(
      "{weekly_thinks}",
      weeklyThinks
        .map((t) => `[${t.created_at}] Topic ${t.topic_id}: ${t.content}`)
        .join("\n---\n") || "No daily reasoning this week.",
    )
    .replace(
      "{click_data}",
      clickData.length > 0
        ? clickData
            .map(
              (c) =>
                `• [${c.clicked ? "CLICKED" : "not clicked"}] ${c.topic_name}: ${c.title}`,
            )
            .join("\n")
        : "No click data from last week (first newsletter or tracking disabled).",
    )
    .replace(
      "{all_preferences}",
      topics.map((t) => `• ${t.name}: ${t.preferences || "None"}`).join("\n"),
    )
    .replace(
      "{all_source_criteria}",
      topics.map((t) => `• ${t.name}: ${t.source_criteria || "Not yet developed"}`).join("\n"),
    );

  // Create tool executor
  const executor = createCuratorToolExecutor(config, db, rlm, topics, candidates);

  // Run the agent loop
  await runAgentLoop(
    [{ role: "system", content: systemPrompt }],
    weeklyCuratorTools,
    executor,
  );

  console.log("✅ Weekly newsletter sent!");
}

function createCuratorToolExecutor(
  config: InloopConfig,
  db: DB,
  rlm: RLM,
  topics: Topic[],
  candidates: Candidate[],
) {
  let newsletterHtml = "";

  return async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> => {
    switch (name) {
      case "think": {
        db.prepare(
          "INSERT INTO think_logs (loop_type, content) VALUES ('weekly', ?)",
        ).run(args.content as string);

        await rlm.store({
          type: "think_weekly",
          content: args.content as string,
        });
        return "Reasoning stored.";
      }

      case "filter_candidate": {
        const reason = args.reason as string;
        const candidateId = args.candidate_id as number;

        if (reason === "superseded" && args.superseded_by) {
          db.prepare(
            "UPDATE candidates SET superseded_by = ? WHERE id = ?",
          ).run(args.superseded_by as number, candidateId);
        }
        // Mark as not to be included
        db.prepare(
          "UPDATE candidates SET relevance_score = -1 WHERE id = ?",
        ).run(candidateId);

        return `Candidate ${candidateId} filtered out: ${reason}`;
      }

      case "update_source_rating": {
        db.prepare("UPDATE sources SET rating = ? WHERE id = ?").run(
          args.new_rating as number,
          args.source_id as number,
        );
        return `Source ${args.source_id} rating updated to ${args.new_rating}`;
      }

      case "update_source_criteria": {
        db.prepare(
          "UPDATE topics SET source_criteria = ?, updated_at = datetime('now') WHERE id = ?",
        ).run(args.criteria as string, args.topic_id as number);
        return `Source criteria updated for topic ${args.topic_id}`;
      }

      case "write_influence_note": {
        const weekStart = getWeekStart();
        db.prepare(
          "INSERT INTO influence_notes (topic_id, week_start, content) VALUES (?, ?, ?)",
        ).run(
          args.topic_id as number,
          weekStart,
          args.content as string,
        );
        return `Influence note stored for topic ${args.topic_id}`;
      }

      case "compose_newsletter": {
        const sections = (
          args.sections as Array<{
            topic_name: string;
            vibe_text: string;
            article_ids: number[];
          }>
        ).map((s) => {
          const articles = s.article_ids
            .map((id) => candidates.find((c) => c.id === id))
            .filter(Boolean)
            .map((c) => ({
              title: c!.title,
              url: wrapLink(c!.url, c!.id, config),
              summary: c!.summary,
            }));

          // Mark as included
          for (const id of s.article_ids) {
            db.prepare(
              "UPDATE candidates SET included_in_newsletter = 1 WHERE id = ?",
            ).run(id);
          }

          return {
            topicName: s.topic_name,
            vibeText: s.vibe_text,
            articles,
          } satisfies NewsletterSection;
        });

        const data: NewsletterData = {
          sections,
          crossTopicNotes: (args.cross_topic_notes as string[]) || [],
          weekLabel: formatWeekLabel(),
        };

        newsletterHtml = composeNewsletter(data);
        return `Newsletter composed with ${sections.length} sections, ${sections.reduce((a, s) => a + s.articles.length, 0)} total articles.`;
      }

      case "send_newsletter": {
        const html = (args.newsletter_html as string) || newsletterHtml;
        if (!html) return "Error: No newsletter HTML to send.";

        // Store the newsletter
        const topicIds = topics.map((t) => t.id);
        db.prepare(
          "INSERT INTO newsletters (topics_included, full_html) VALUES (?, ?)",
        ).run(JSON.stringify(topicIds), html);

        // Send via email gateway
        const gateway = new EmailGateway(config.email, async () => {});
        await gateway.start();
        await gateway.sendEmail(
          config.email.userEmail,
          `🔄 inloop — ${formatWeekLabel()}`,
          html,
        );
        await gateway.stop();

        return "Newsletter sent!";
      }

      default:
        return `Unknown tool: ${name}`;
    }
  };
}

function wrapLink(url: string, candidateId: number, config: InloopConfig): string {
  if (config.tracking?.enabled && config.tracking?.publicUrl) {
    return `${config.tracking.publicUrl}/click/${candidateId}?url=${encodeURIComponent(url)}`;
  }
  return url;
}

function getWeekStart(weeksAgo = 0): string {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(now.setDate(diff - weeksAgo * 7));
  return monday.toISOString().split("T")[0];
}

function formatWeekLabel(): string {
  const start = new Date(getWeekStart());
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "long", day: "numeric" });

  return `${fmt(start)}–${fmt(end)}, ${start.getFullYear()}`;
}
