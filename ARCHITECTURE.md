# inloop — Architecture

**BYOK LLM-powered personal newsletter agent. The entire UI surface is email.**

A user creates a dedicated email address (e.g. `inloopagent@protonmail.com`), points inloop at it, and emails that address to manage topics. The agent runs persistently on the user's machine, researches topics daily, and sends a curated weekly newsletter — all through email.

---

## Core Principles

- **Email is the only UI.** No web dashboard, no CLI interaction after setup. The user emails the agent, the agent emails back.
- **BYOK (Bring Your Own Key).** Uses `byok-llm` for API key management. Works with any supported LLM provider.
- **Agent-driven research.** The LLM doesn't just summarize — it intelligently discovers sources, evaluates them, reads multilingually, and curates with taste.
- **Runs locally.** Inspired by [OpenClaw](https://github.com/openclaw/openclaw)'s pattern: persistent local agent, messaging platform as UI. Here, email replaces Telegram/WhatsApp.
- **Custom RLM.** Implements Recursive Language Model patterns for information recall across agent sessions without context rot.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js / TypeScript |
| LLM Keys | `byok-llm` (npm) |
| Email In | IMAP via `imapflow` |
| Email Out | SMTP via `nodemailer` |
| Web Scraping | [Scrapling](https://github.com/D4Vinci/Scrapling) (Python, called as subprocess) |
| Database | SQLite via `better-sqlite3` |
| Scheduling | `node-cron` |
| Click Tracking | Optional — Cloudflare Tunnel (free) + local redirect server |

---

## Agentic Loops

There are three loops. Each loop is **one continuous LLM inference call** — the agent is "woken up" and runs to completion. When we say "THINK", we mean the agent writes its reasoning to persistent text so future instances can read it.

### Loop 1: Email Gateway + Main Agent

**Trigger:** New email arrives (IMAP polled every ~30s)

**Behavior:** The raw email is passed directly to the agent — no pre-parsing of intent. The agent decides freely what to do and how to respond.

**Tools available:**
- `add_topic(name, preferences?, example_sources?)` — Register a new topic with per-topic preferences
- `update_topic(name, preferences?, sources?)` — Update a topic's preferences or sources
- `remove_topic(name)` — Remove a topic
- `list_topics()` — List all active topics with their preferences
- `respond_to_user(message)` — Send an email response to the user

**Notes:**
- Preferences are **per-topic**, not global. A user who wants Japanese yield news has different source preferences than their TTRPG homebrew topic.
- The agent responds naturally and freely. Most of the time it's "Got it, I'll keep you in the loop on X" but it has full flexibility.
- All interactions are stored in RLM for future context.

### Loop 2: Daily Research Subagent

**Trigger:** Cron, once per day, runs once **per topic**.

**Input context (loaded from RLM + DB):**
- Topic definition + per-topic user preferences
- Previously sent news (to avoid repeats)
- Preferred sources + agent-assigned source ratings
- Agent-written source criteria (what makes a good source for this topic)
- Previous days' THINK outputs from this week

**Steps (one continuous inference call):**

1. **THINK** — Write reasoning about the current state of the topic. What's likely happening? What should I look for? What gaps exist?

2. **SCRAPE** — Hit preferred sources via Scrapling.
   - Extract headlines, dates, summaries
   - Handle multilingual content natively (e.g., read Japanese financial news in Japanese for a "Japanese yield" topic)

3. **SEARCH** — Find gaps via:
   - Google (nuanced queries formed from topic context, NOT just "[topic] news today")
   - Reddit, Hacker News, and other aggregators
   - Discover new blogs/sites the user hasn't seen

4. **THINK** — Evaluate novel sources found. Worth adding to preferred list? Score against source criteria. Write reasoning.

5. **TAG** — Mark articles as candidates for the weekly newsletter with relevance scores. Store in DB.

6. **STORE** — Persist THINK outputs, candidates, and source updates to RLM + DB.

**Key design point on sources:**
Even if the user provides example sources (e.g., "I like goblinpunch.blogspot.com for TTRPG"), the agent treats those as a **jumping-off point only**. The agent must discover novel sources — especially ones the user hasn't read before. For niche topics with infrequent posters (like a blog that posts every 2 months), the agent samples broadly across many sources.

### Loop 3: Weekly Newsletter Agent

**Trigger:** Cron, once per week (e.g., Sunday evening).

**Input context:**
- All topics + all daily candidates from the week
- All daily THINK outputs from this week
- Last week's click data (which links the user actually opened)
- User's per-topic preferences
- Current source criteria per topic

**Steps (one continuous inference call):**

1. **THINK** — Review click patterns from last week. What did the user engage with? What does this say about their real preferences vs stated preferences?

2. **FILTER** — Per topic, apply temporal and logical deduplication:
   - If Monday's candidate says "PM goes missing" and Thursday's says "PM found dead in river," the weekly should only include Thursday's (it supersedes Monday's).
   - Remove stale or subsumed stories.
   - Cross-topic deduplication (if "Japanese yields" and "global macro" both surface the same BoJ article, mention it once with cross-reference).

3. **THINK** — Write reasoning about filtering decisions. Why was each article kept or dropped?

4. **CURATE** — Per topic:
   - Select final articles (title + link, wrapped for click tracking if enabled)
   - Write a short "vibe of the week" flavor text about the overall feel/direction

5. **CROSS-TOPIC** — Notice intersections between topics and mention them.

6. **RE-EVALUATE SOURCE CRITERIA** (runs in-context, not as a separate loop):
   - Sources that produced clicked articles → boost
   - Sources that never produce selected articles → demote
   - Topic has evolved → adjust criteria
   - Write updated criteria for each topic

7. **INFLUENCE** — Write guidance for next week's daily subagents:
   - E.g., "Dig deeper into BoJ policy responses"
   - E.g., "Explore more indie TTRPG blogs, the mainstream ones were stale this week"

8. **ASSEMBLE** — Build the newsletter email (all topics in one email).

9. **SEND** — SMTP to user.

---

## RLM (Recursive Language Model) — Custom Implementation

We implement RLM ourselves for inloop's specific recall needs.

**Core idea:** Context is too large to fit in one prompt. Instead of stuffing everything in, the agent treats stored information as an external environment it can programmatically query.

**What gets stored:**
- Topic definitions and per-topic preferences
- Source lists, ratings, and agent-written source criteria
- Daily THINK outputs (reasoning traces)
- Weekly THINK outputs and filtering decisions
- Candidate articles and their scores
- Sent newsletters (what was already covered)
- Click data (user engagement feedback)
- Weekly influence notes (guidance for next week's dailies)

**How agents recall:**
Agents are given tools to query stored context — search, filter by topic, filter by date range, retrieve specific documents. The RLM layer handles chunking and relevance so agents get what they need without context rot.

---

## Click Tracking (Optional)

**Purpose:** Know which newsletter links the user actually clicked, to refine future curation.

**How it works:**
- Newsletter links are wrapped through a local redirect server
- When user clicks → local server logs the click → redirects to actual URL
- A [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (free) exposes the local server so links work from any device

**Setup:** Handled by the setup wizard. If user declines or setup fails → plain links, no tracking. The feature is entirely optional.

**Anti-spam:** Simple redirect links don't trigger spam filters. No tracking pixels, no hidden images.

---

## Data Model (SQLite)

```sql
-- Topics the user is tracking
topics:
  id, name, preferences (JSON), example_sources (JSON),
  source_criteria (TEXT — agent-written),
  created_at, updated_at

-- Sources discovered and rated by the agent
sources:
  id, topic_id, url, name, rating (REAL),
  discovered_by (user | agent), notes (TEXT),
  last_checked_at, created_at

-- Daily candidate articles
candidates:
  id, topic_id, source_id, title, url, summary,
  relevance_score (REAL), found_date,
  included_in_newsletter (BOOL), clicked (BOOL),
  superseded_by (candidate_id, nullable)

-- Sent newsletters
newsletters:
  id, sent_at, topics_included (JSON),
  full_html (TEXT)

-- Agent reasoning traces
think_logs:
  id, loop_type (daily | weekly | email),
  topic_id (nullable), content (TEXT),
  created_at

-- Weekly influence notes for next week's dailies
influence_notes:
  id, topic_id, week_start, content (TEXT),
  created_at
```

---

## Project Structure

```
in-loop/
├── package.json
├── tsconfig.json
├── ARCHITECTURE.md          ← You are here
├── src/
│   ├── index.ts             # Main entry — persistent daemon
│   ├── config.ts            # Configuration loading
│   ├── email/
│   │   ├── gateway.ts       # IMAP polling + SMTP sending
│   │   └── composer.ts      # Compose newsletter HTML
│   ├── agent/
│   │   ├── core.ts          # Main agent (Loop 1) — handles user emails
│   │   ├── researcher.ts    # Daily research subagent (Loop 2)
│   │   ├── curator.ts       # Weekly newsletter agent (Loop 3)
│   │   └── tools.ts         # Agent tool definitions
│   ├── scraper/
│   │   └── index.ts         # Orchestrates Scrapling subprocess
│   ├── rlm/
│   │   ├── index.ts         # RLM public API
│   │   ├── store.ts         # Write context to storage
│   │   └── recall.ts        # Query/retrieve context
│   ├── llm/
│   │   ├── client.ts        # LLM API calls (uses byok-llm for keys)
│   │   └── prompts.ts       # System prompts for each loop
│   ├── db/
│   │   ├── index.ts         # SQLite connection
│   │   └── schema.ts        # Table creation + migrations
│   ├── tracker/
│   │   └── clicks.ts        # Click tracking redirect server
│   └── scheduler/
│       └── cron.ts          # Daily + weekly cron scheduling
├── scripts/
│   ├── scrape.py            # Scrapling Python wrapper
│   └── requirements.txt     # Python dependencies
└── .gitignore
```

---

## Setup Flow

1. `npx inloop` or `npm start` launches the setup wizard on first run
2. Wizard walks through:
   - LLM provider setup (via `byok-llm` interactive wizard)
   - Email account config (IMAP/SMTP host, port, credentials)
   - Optional: Cloudflare Tunnel for click tracking
   - Python/Scrapling installation check
3. Config saved to `~/.config/inloop/config.json`
4. Agent starts running persistently
5. User sends first email: "Keep me in the loop about X"

---

## Key Design Decisions

1. **No intent parsing before the agent.** Raw emails go straight to the LLM. The agent is smart enough to figure out what the user wants.

2. **Per-topic preferences.** Not global. Each topic has its own sources, criteria, and user preferences.

3. **Source criteria are agent-written.** The most critical part of the system. The agent develops and constantly re-evaluates what makes a good source for each topic, based on user feedback (clicks), content quality, and topic evolution.

4. **THINK = written text.** All reasoning is persisted as text so future agent instances can read it. This is how continuity works across daily/weekly runs without sharing a context window.

5. **Scrapling over Puppeteer.** Many news sites and blogs block headless browsers. Scrapling is purpose-built for anti-detection scraping.

6. **One newsletter, all topics.** The weekly email contains all topics in sections, not one email per topic.

7. **Cross-topic awareness only in weekly.** Daily research runs per-topic in isolation. Cross-pollination happens at the weekly curation stage.
