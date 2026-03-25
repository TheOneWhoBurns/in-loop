# inloop — Architecture

**BYOK LLM-powered personal newsletter agent. The entire UI surface is email.**

A user creates a dedicated email address (e.g. `inloopagent@protonmail.com`), points inloop at it, and emails that address to manage topics. The agent runs persistently on the user's machine, researches topics daily, and sends a curated weekly newsletter — all through email.

---

## Core Principles

- **Email is the only UI.** No web dashboard, no CLI interaction after setup. The user emails the agent, the agent emails back.
- **BYOK (Bring Your Own Key).** The "key" is a CLI agent — Claude Code, or any future agent CLI. Users bring whatever they already pay for (subscriptions OR API keys). This works with Claude Pro, Claude Max, Claude Team, API keys — anything that powers the agent CLI.
- **Agent-driven research.** The LLM doesn't just summarize — it intelligently discovers sources, evaluates them, reads multilingually, and curates with taste.
- **Runs on top of an agent CLI.** Inspired by [rlm-minimal](https://github.com/alexzhang13/rlm-minimal): the project is **code (tools) + prompts (markdown instructions)**. The agent CLI (Claude Code) is the runtime that executes them.
- **Custom RLM.** Implements Recursive Language Model patterns for information recall across agent sessions without context rot.

---

## How It Works

inloop is **not** a standalone LLM application. It runs **on top of** an agent CLI (currently Claude Code). The architecture is:

```
┌──────────────────────────────────────────┐
│  Agent CLI (Claude Code)                 │
│  - Already authenticated (sub or API key)│
│  - Handles LLM inference                 │
│  - Executes tool calls                   │
│  - Manages context                       │
├──────────────────────────────────────────┤
│  inloop (this project)                   │
│  - Prompt files (what the agent does)    │
│  - Tool scripts (scrape, email, DB, RLM) │
│  - Cron triggers (when loops run)        │
│  - Config + data (SQLite, ~/.config/)    │
└──────────────────────────────────────────┘
```

The agent CLI is invoked programmatically:
```bash
# Loop 1: Handle incoming email
claude -p "$(cat prompts/loop1-email.md)" --allowedTools "Bash(scripts/*)"

# Loop 2: Daily research for a topic
claude -p "$(cat prompts/loop2-daily.md)" --allowedTools "Bash(scripts/*)"

# Loop 3: Weekly newsletter
claude -p "$(cat prompts/loop3-weekly.md)" --allowedTools "Bash(scripts/*)"
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Agent Runtime | Claude Code (or any compatible agent CLI) |
| Tools | TypeScript scripts invoked by the agent |
| Email In | IMAP via `imapflow` |
| Email Out | SMTP via `nodemailer` |
| Web Scraping | [Scrapling](https://github.com/D4Vinci/Scrapling) (Python, called as subprocess) |
| Database | SQLite via `better-sqlite3` |
| Scheduling | System cron / `node-cron` |
| Click Tracking | Optional — Cloudflare Tunnel (free) + local redirect server |
| Info Recall | Custom RLM implementation |

---

## Agentic Loops

There are three loops. Each loop is **one agent CLI invocation** — the agent is "woken up" with a prompt file, has access to tool scripts, and runs to completion. When we say "THINK", we mean the agent writes its reasoning to persistent text (via a tool) so future instances can read it.

### Loop 1: Email Gateway + Main Agent

**Trigger:** New email arrives (detected by the daemon polling IMAP every ~30s)

**Invocation:** The daemon detects a new email, formats it, and invokes the agent CLI with the email content injected into the Loop 1 prompt.

**Behavior:** The raw email is passed directly to the agent — no pre-parsing of intent. The agent decides freely what to do and how to respond.

**Tools available (as scripts the agent can call via Bash):**
- `scripts/topic-add.ts` — Register a new topic with per-topic preferences
- `scripts/topic-update.ts` — Update a topic's preferences or sources
- `scripts/topic-remove.ts` — Remove a topic
- `scripts/topic-list.ts` — List all active topics with their preferences
- `scripts/email-reply.ts` — Send an email response to the user
- `scripts/rlm-store.ts` — Store context in RLM
- `scripts/rlm-recall.ts` — Query RLM for relevant context

**Notes:**
- Preferences are **per-topic**, not global. A user who wants Japanese yield news has different source preferences than their TTRPG homebrew topic.
- The agent responds naturally and freely. Most of the time it's "Got it, I'll keep you in the loop on X" but it has full flexibility.
- All interactions are stored in RLM for future context.

### Loop 2: Daily Research Subagent

**Trigger:** Cron, once per day, runs once **per topic**.

**Invocation:** The daemon (or system cron) iterates over topics and invokes the agent CLI once per topic, with that topic's context injected into the Loop 2 prompt.

**Input context (loaded from RLM + DB and injected into prompt):**
- Topic definition + per-topic user preferences
- Previously sent news (to avoid repeats)
- Preferred sources + agent-assigned source ratings
- Agent-written source criteria (what makes a good source for this topic)
- Previous days' THINK outputs from this week

**Steps (one continuous agent session):**

1. **THINK** — Write reasoning about the current state of the topic. What's likely happening? What should I look for? What gaps exist?

2. **SCRAPE** — Hit preferred sources via Scrapling (calls `scripts/scrape.ts` which invokes Python).
   - Extract headlines, dates, summaries
   - Handle multilingual content natively (e.g., read Japanese financial news in Japanese for a "Japanese yield" topic)

3. **SEARCH** — Find gaps via:
   - Google (nuanced queries formed from topic context, NOT just "[topic] news today")
   - Reddit, Hacker News, and other aggregators
   - Discover new blogs/sites the user hasn't seen

4. **THINK** — Evaluate novel sources found. Worth adding to preferred list? Score against source criteria. Write reasoning.

5. **TAG** — Mark articles as candidates for the weekly newsletter with relevance scores (calls `scripts/candidate-tag.ts`).

6. **STORE** — Persist THINK outputs, candidates, and source updates (calls `scripts/rlm-store.ts`).

**Key design point on sources:**
Even if the user provides example sources (e.g., "I like goblinpunch.blogspot.com for TTRPG"), the agent treats those as a **jumping-off point only**. The agent must discover novel sources — especially ones the user hasn't read before. For niche topics with infrequent posters (like a blog that posts every 2 months), the agent samples broadly across many sources.

### Loop 3: Weekly Newsletter Agent

**Trigger:** Cron, once per week (e.g., Sunday evening).

**Invocation:** The daemon (or system cron) invokes the agent CLI with all topics' weekly data injected into the Loop 3 prompt.

**Input context:**
- All topics + all daily candidates from the week
- All daily THINK outputs from this week
- Last week's click data (which links the user actually opened)
- User's per-topic preferences
- Current source criteria per topic

**Steps (one continuous agent session):**

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

8. **ASSEMBLE** — Build the newsletter email (calls `scripts/newsletter-compose.ts`).

9. **SEND** — Send the newsletter (calls `scripts/email-send.ts`).

---

## RLM (Recursive Language Model) — Custom Implementation

We implement RLM ourselves for inloop's specific recall needs.

**Core idea:** Context is too large to fit in one prompt. Instead of stuffing everything in, the agent treats stored information as an external environment it can programmatically query via tool scripts.

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
Agents call `scripts/rlm-recall.ts` with query parameters — search terms, topic filter, date range, entry type. The RLM layer handles relevance scoring so agents get what they need without context rot.

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
├── ARCHITECTURE.md             ← You are here
├── prompts/
│   ├── loop1-email.md          # Prompt for email agent (Loop 1)
│   ├── loop2-daily.md          # Prompt for daily research (Loop 2)
│   └── loop3-weekly.md         # Prompt for weekly curator (Loop 3)
├── scripts/
│   ├── topic-add.ts            # Add a topic
│   ├── topic-update.ts         # Update a topic
│   ├── topic-remove.ts         # Remove a topic
│   ├── topic-list.ts           # List topics
│   ├── email-reply.ts          # Send email reply
│   ├── email-send.ts           # Send newsletter email
│   ├── scrape.ts               # Scrape a URL (invokes Scrapling)
│   ├── scrape.py               # Scrapling Python wrapper
│   ├── candidate-tag.ts        # Tag an article as candidate
│   ├── candidate-list.ts       # List candidates for a topic/week
│   ├── candidate-filter.ts     # Mark candidate as filtered
│   ├── source-add.ts           # Add a source
│   ├── source-update.ts        # Update source rating
│   ├── source-list.ts          # List sources for a topic
│   ├── newsletter-compose.ts   # Compose newsletter HTML
│   ├── rlm-store.ts            # Store entry in RLM
│   ├── rlm-recall.ts           # Query RLM
│   ├── think.ts                # Store a THINK output
│   ├── influence-write.ts      # Write influence note
│   └── influence-read.ts       # Read influence notes
├── src/
│   ├── daemon.ts               # Persistent daemon: IMAP polling + cron
│   ├── config.ts               # Configuration loading
│   ├── db.ts                   # SQLite connection + schema
│   ├── rlm.ts                  # RLM store + recall logic
│   ├── email.ts                # IMAP + SMTP helpers
│   ├── scraper.ts              # Scrapling subprocess orchestration
│   ├── composer.ts             # Newsletter HTML composition
│   └── tracker.ts              # Click tracking redirect server
├── install/
│   ├── wizard.ts               # CLI wizard (human-guided install)
│   └── skill.md                # Claude Code skill (automated install)
├── requirements.txt            # Python dependencies (scrapling)
└── .gitignore
```

---

## Installation (Two Paths)

### Path 1: CLI Wizard (for humans)

```bash
npx inloop install
```

Interactive terminal wizard that walks through:
1. Agent CLI check (is Claude Code installed and authenticated?)
2. Email account config (IMAP/SMTP host, port, credentials)
3. Personal email (where newsletters go)
4. Optional: Cloudflare Tunnel for click tracking
5. Python/Scrapling installation check
6. Schedule preferences (daily research time, weekly newsletter day/time)
7. Config saved to `~/.config/inloop/config.json`

### Path 2: Claude Code Skill (automated)

```
/install-inloop
```

A Claude Code skill that does everything the wizard does, but autonomously:
- Detects the environment
- Asks the user for email credentials
- Configures IMAP/SMTP
- Checks/installs Python and Scrapling
- Sets up the config
- Starts the daemon

---

## Setup Flow (Post-Install)

1. The daemon starts (via `npx inloop` or system service)
2. It polls IMAP for new emails every ~30s
3. User sends first email: "Keep me in the loop about Japanese bond yields"
4. Loop 1 fires → agent adds topic → replies "Got it"
5. Next morning, Loop 2 fires → agent researches the topic
6. End of week, Loop 3 fires → agent curates and sends the newsletter

---

## Key Design Decisions

1. **Runs on top of an agent CLI, not an SDK.** This enables BYOK with subscriptions (Claude Pro/Max) not just API keys. The `@ai-sdk/*` packages only work with API keys.

2. **No intent parsing before the agent.** Raw emails go straight to the LLM. The agent is smart enough to figure out what the user wants.

3. **Per-topic preferences.** Not global. Each topic has its own sources, criteria, and user preferences.

4. **Source criteria are agent-written.** The most critical part of the system. The agent develops and constantly re-evaluates what makes a good source for each topic, based on user feedback (clicks), content quality, and topic evolution.

5. **THINK = written text.** All reasoning is persisted as text so future agent instances can read it. This is how continuity works across daily/weekly runs without sharing a context window.

6. **Scrapling over Puppeteer.** Many news sites and blogs block headless browsers. Scrapling is purpose-built for anti-detection scraping.

7. **One newsletter, all topics.** The weekly email contains all topics in sections, not one email per topic.

8. **Cross-topic awareness only in weekly.** Daily research runs per-topic in isolation. Cross-pollination happens at the weekly curation stage.

9. **Tools are standalone scripts.** Each tool is a self-contained TypeScript script that reads args, does one thing, and outputs results. The agent CLI calls them via Bash. This keeps tools testable independently of the agent.
