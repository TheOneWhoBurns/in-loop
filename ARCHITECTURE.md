# inloop — Architecture

**BYOK LLM-powered personal newsletter agent. The entire UI surface is email.**

A user creates a dedicated email address (e.g. on [AgentMail](https://agentmail.to)), points inloop at it, and emails that address to manage topics. The agent runs persistently, researches topics daily, and sends a curated weekly newsletter — all through email.

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
│  - Daemon (email + cron triggers)        │
│  - Config + data (SQLite, ~/.config/)    │
└──────────────────────────────────────────┘
```

The agent CLI is invoked programmatically by the daemon:
```bash
claude -p "<prompt with context>" --allowedTools "Bash(tsx:*),WebSearch,WebFetch,Read,Write" --dangerously-skip-permissions
```

Each loop is one agent invocation. The agent runs autonomously to completion.

---

## Email Backend

inloop supports two email backends, auto-detected from config:

### AgentMail (recommended)
- REST API for reading and sending emails
- Polling every 60s via lightweight API call (`GET /messages?labels=unread`)
- Mark as read via `PATCH /messages/{id}` with `remove_labels: ["unread"]`
- Send via `POST /messages/send`
- No IMAP/SMTP needed — pure HTTP

### Standard IMAP/SMTP (fallback)
- IMAP via `imapflow` for receiving
- SMTP via `nodemailer` for sending
- `disableCompression: true` required under tsx (ESM transform conflicts with DEFLATE)
- Messages must be collected before running any IMAP commands (ImapFlow limitation: commands inside `for await` fetch loop deadlock)

The backend is selected automatically based on the SMTP host in the config.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Agent Runtime | Claude Code (or any compatible agent CLI) |
| Tools | TypeScript scripts invoked by the agent via Bash |
| Email (preferred) | AgentMail REST API |
| Email (fallback) | IMAP via `imapflow` / SMTP via `nodemailer` |
| Web Research | WebSearch + WebFetch (Claude Code built-in tools) |
| Web Scraping | [Scrapling](https://github.com/D4Vinci/Scrapling) (Python, called as subprocess) |
| Database | SQLite via `better-sqlite3` |
| Scheduling | `node-cron` |
| Click Tracking | Optional — local HTTP redirect server |
| Info Recall | Custom RLM implementation |

---

## Agentic Loops

There are three loops. Each loop is **one agent CLI invocation** — the agent is "woken up" with a prompt file, has access to tool scripts plus web search/fetch, and runs to completion. When we say "THINK", we mean the agent writes its reasoning to persistent storage (via a tool) so future instances can read it.

### Loop 1: Email Gateway + Main Agent

**Trigger:** New email arrives (detected by the daemon polling AgentMail every ~60s)

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
- Preferences are **per-topic**, not global. A user who wants Japanese yield news has different source preferences than their F1 topic.
- The agent responds naturally and freely. Most of the time it's "Got it, I'll keep you in the loop on X" but it has full flexibility.
- All interactions are stored in RLM for future context.

### Loop 2: Daily Research Subagent

**Trigger:** Cron, once per day, runs once **per topic** (with bounded concurrency of 3).

**Invocation:** The daemon iterates over topics and invokes the agent CLI once per topic, with that topic's context injected into the Loop 2 prompt.

**Input context (loaded from RLM + DB and injected into prompt):**
- Topic definition + per-topic user preferences
- Previously sent news (to avoid repeats)
- Preferred sources + agent-assigned source ratings
- Agent-written source criteria (what makes a good source for this topic)
- Previous days' THINK outputs from this week

**Steps (one continuous agent session):**

1. **THINK** — Write reasoning about the current state of the topic. What's likely happening? What should I look for? What gaps exist?

2. **SEARCH** — Use WebSearch and WebFetch to find current news. Form nuanced queries from topic context, NOT just "[topic] news today".

3. **SCRAPE** — Hit preferred sources via Scrapling (calls `scripts/scrape.ts` which invokes Python).
   - Extract headlines, dates, summaries
   - Handle multilingual content natively

4. **THINK** — Evaluate novel sources found. Worth adding to preferred list? Score against source criteria. Write reasoning.

5. **TAG** — Mark articles as candidates for the weekly newsletter with relevance scores (calls `scripts/candidate-tag.ts`).

6. **STORE** — Persist THINK outputs, candidates, and source updates.

**Key design point on sources:**
Even if the user provides example sources (e.g., "I like the Financial Times"), the agent treats those as a **jumping-off point only**. The agent must discover novel sources — especially ones the user hasn't read before. For niche topics with infrequent posters, the agent samples broadly across many sources.

### Loop 3: Weekly Newsletter Agent

**Trigger:** Cron, once per week (e.g., Sunday evening).

**Invocation:** The daemon invokes the agent CLI with all topics' weekly data injected into the Loop 3 prompt.

**Input context:**
- All topics + all daily candidates from the week
- All daily THINK outputs from this week
- Last week's click data (which links the user actually opened)
- User's per-topic preferences
- Current source criteria per topic

**Steps (one continuous agent session):**

1. **THINK** — Review click patterns from last week. What did the user engage with?

2. **FILTER** — Per topic, apply temporal and logical deduplication:
   - If Monday's candidate says "PM goes missing" and Thursday's says "PM found dead," only include Thursday's.
   - Cross-topic deduplication (if two topics surface the same article, mention it once).

3. **CURATE** — Per topic:
   - Select final articles (title + link)
   - Write a short "vibe of the week" flavor text

4. **CROSS-TOPIC** — Notice intersections between topics and mention them.

5. **RE-EVALUATE SOURCE CRITERIA** — Boost sources that produce clicked articles, demote stale ones, adjust for topic evolution.

6. **INFLUENCE** — Write guidance for next week's daily subagents (e.g., "Dig deeper into BoJ policy responses").

7. **ASSEMBLE** — Build the newsletter HTML (calls `scripts/newsletter-compose.ts` or writes directly).

8. **SEND** — Send the newsletter (calls `scripts/email-send.ts`).

---

## RLM (Recursive Language Model) — Custom Implementation

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
Agents call `scripts/rlm-recall.ts` with query parameters — search terms, topic filter, date range, entry type. The RLM layer handles keyword matching and recency scoring so agents get what they need without context rot.

---

## Click Tracking (Optional)

**Purpose:** Know which newsletter links the user actually clicked, to refine future curation.

**How it works:**
- Newsletter links are wrapped through a local redirect server
- When user clicks → server logs the click → redirects to actual URL
- A [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (free) exposes the server so links work from any device

**Setup:** Handled by the setup wizard. If user declines → plain links, no tracking. Entirely optional.

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

-- Agent reasoning traces (stored via RLM)
rlm_entries:
  id, type, topic_id, content (TEXT),
  metadata (JSON), created_at

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
├── README.md
├── ARCHITECTURE.md             ← You are here
├── src/
│   ├── daemon.ts               # Main daemon: email polling + cron scheduling
│   ├── agent.ts                # Agent CLI runner (shared by daemon + scripts)
│   ├── agentmail.ts            # AgentMail REST API client
│   ├── email.ts                # Email helpers (AgentMail + IMAP/SMTP fallback)
│   ├── config.ts               # Config loading + env var resolution
│   ├── db.ts                   # SQLite schema + connection
│   ├── rlm.ts                  # RLM store + recall logic
│   ├── composer.ts             # Newsletter HTML composition
│   ├── tracker.ts              # Click tracking redirect server
│   └── script-helpers.ts       # Shared utilities for tool scripts
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
│   ├── influence-read.ts       # Read influence notes
│   └── trigger-loop.ts         # Manually trigger loops for testing
├── tests/
│   └── test-core.ts            # Unit tests (46 tests)
├── install/
│   ├── wizard.ts               # CLI setup wizard (3 questions)
│   └── skill.md                # Claude Code skill for automated setup
├── Dockerfile
├── .dockerignore
├── requirements.txt            # Python dependencies (scrapling)
└── .gitignore
```

---

## Installation

### Setup wizard (3 questions)

```bash
git clone https://github.com/TheOneWhoBurns/in-loop.git
cd in-loop
npm install
npm run install-wizard
```

The wizard:
1. Detects installed agent CLIs (Claude Code, Codex) — hard-stops if none found
2. Asks for agent email address, API key/app password, and personal email
3. Writes config to `~/.config/inloop/config.json`
4. Starts the daemon in the background

### Claude Code skill (automated)

If you're already in Claude Code:
```
/install-inloop
```

---

## Key Design Decisions

1. **Runs on top of an agent CLI, not an SDK.** This enables BYOK with subscriptions (Claude Pro/Max) not just API keys.

2. **No intent parsing before the agent.** Raw emails go straight to the LLM. The agent decides what to do.

3. **Per-topic preferences.** Not global. Each topic has its own sources, criteria, and user preferences.

4. **Source criteria are agent-written.** The agent develops and re-evaluates what makes a good source for each topic, based on user feedback (clicks), content quality, and topic evolution.

5. **THINK = written text.** All reasoning is persisted so future agent instances can read it. Continuity across sessions without sharing a context window.

6. **AgentMail over Gmail.** Gmail disables accounts for automated IMAP access. AgentMail is purpose-built for agents and won't flag your account.

7. **One newsletter, all topics.** The weekly email contains all topics in sections, not one email per topic.

8. **Cross-topic awareness only in weekly.** Daily research runs per-topic in isolation. Cross-pollination happens at the weekly curation stage.

9. **Tools are standalone scripts.** Each tool is a self-contained TypeScript script. The agent calls them via Bash. Testable independently.

10. **Agent runs with `--dangerously-skip-permissions`.** The agent subprocess needs to read/write files, search the web, and execute scripts without human approval. It runs fully autonomous.
