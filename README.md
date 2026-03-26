# inloop

**Personal newsletter agent. Email is the only UI.**

You email the agent your interests. It researches them daily, curates articles, and sends you a weekly newsletter — all through email. No dashboards, no apps, no feeds to check.

inloop runs on top of [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (or any agent CLI). You bring your own subscription or API key.

## How it works

```
You ──email──> Agent inbox ──> Claude Code processes it
                                    │
                              ┌─────┴─────┐
                              │  3 loops  │
                              └─────┬─────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
        Loop 1: Email         Loop 2: Daily         Loop 3: Weekly
        "Add F1 news"        Research topics       Curate & send
        → adds topic,         → search web,         newsletter to
          replies "Got it"      score articles        your inbox
```

1. **Email the agent** — "Keep me in the loop about Ecuadorian news" → topic added, agent replies confirming
2. **Daily research runs automatically** — the agent searches the web, discovers sources, scores articles
3. **Weekly newsletter arrives in your inbox** — curated, cross-referenced, with per-topic "vibe of the week"

## Quick start

**Prerequisites:** [Node.js](https://nodejs.org/) 18+ and [Claude Code](https://docs.anthropic.com/en/docs/claude-code) authenticated.

```bash
git clone https://github.com/TheOneWhoBurns/in-loop.git
cd in-loop
npm install
npm run install-wizard
```

The wizard asks 3 questions:
1. Agent email address (e.g. from [AgentMail](https://agentmail.to))
2. API key or app password
3. Your personal email (where newsletters go)

Then it starts the daemon. You're done — email the agent to add topics.

## Email providers

inloop needs an email account for the agent. Recommended providers:

| Provider | Cost | Notes |
|----------|------|-------|
| **[AgentMail](https://agentmail.to)** | Free tier (3 inboxes) | Built for AI agents. REST API + WebSocket. Best choice. |
| **[Mailbox.org](https://mailbox.org)** | ~$3/mo | Standard IMAP/SMTP. No automation ban. |
| **Gmail** | Free | Works but may disable accounts for "bot-like" activity. Not recommended. |

> **Note:** Gmail disabled our test account after automated IMAP polling. AgentMail is purpose-built for this use case and won't flag your account.

## Architecture

inloop is **code + prompts on top of an agent CLI**. It's not a standalone LLM app — Claude Code is the runtime.

```
┌──────────────────────────────────┐
│  Agent CLI (Claude Code)         │
│  Handles: LLM inference, tools  │
├──────────────────────────────────┤
│  inloop                          │
│  - Prompt files (3 loops)        │
│  - Tool scripts (scrape, DB)     │
│  - Daemon (cron + email)         │
│  - SQLite database               │
└──────────────────────────────────┘
```

**Three agentic loops:**

- **Loop 1 — Email gateway**: Incoming email → agent processes it freely (add/remove topics, update preferences, reply)
- **Loop 2 — Daily research**: Per-topic web research → discover sources → score candidates → store in DB
- **Loop 3 — Weekly newsletter**: Curate best articles → deduplicate → write "vibe" summaries → compose HTML → send

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design.

## Project structure

```
in-loop/
├── src/
│   ├── daemon.ts          # Main daemon: email polling + cron scheduling
│   ├── agent.ts           # Agent CLI runner (shared by daemon + scripts)
│   ├── agentmail.ts       # AgentMail REST API client
│   ├── email.ts           # Email helpers (AgentMail + IMAP/SMTP fallback)
│   ├── config.ts          # Config loading + env var resolution
│   ├── db.ts              # SQLite schema + connection
│   ├── rlm.ts             # RLM (Recursive Language Model) for recall
│   ├── composer.ts        # Newsletter HTML composition
│   ├── tracker.ts         # Optional click tracking server
│   └── script-helpers.ts  # Shared utilities for tool scripts
├── prompts/
│   ├── loop1-email.md     # Email processing prompt
│   ├── loop2-daily.md     # Daily research prompt
│   └── loop3-weekly.md    # Weekly newsletter prompt
├── scripts/               # Tool scripts invoked by the agent
│   ├── topic-*.ts         # Topic management
│   ├── email-*.ts         # Email sending
│   ├── candidate-*.ts     # Article candidate management
│   ├── source-*.ts        # Source management
│   ├── rlm-*.ts           # RLM store/recall
│   ├── scrape.ts          # Web scraping (via Scrapling)
│   ├── think.ts           # Persist agent reasoning
│   └── trigger-loop.ts    # Manually trigger loops for testing
├── install/
│   ├── wizard.ts          # Setup wizard
│   └── skill.md           # Claude Code skill for setup
├── tests/
│   └── test-core.ts       # Unit tests (46 tests)
└── package.json
```

## Commands

```bash
npm start              # Start the daemon
npm test               # Run unit tests (46 tests)
npm run install-wizard # Run the setup wizard
npm run build          # Compile TypeScript
```

**Manual loop triggers (for testing):**

```bash
tsx scripts/trigger-loop.ts --loop 1           # Process unread emails
tsx scripts/trigger-loop.ts --loop 2           # Daily research (all topics)
tsx scripts/trigger-loop.ts --loop 2 --topic 1 # Research one topic
tsx scripts/trigger-loop.ts --loop 3           # Send weekly newsletter
```

## Tech stack

| Component | Technology |
|-----------|-----------|
| Agent runtime | Claude Code (or any agent CLI) |
| Email (preferred) | AgentMail REST API + polling |
| Email (fallback) | IMAP/SMTP via imapflow + nodemailer |
| Database | SQLite via better-sqlite3 |
| Scheduling | node-cron |
| Web scraping | [Scrapling](https://github.com/D4Vinci/Scrapling) (Python) |
| Click tracking | Optional HTTP redirect server |

## License

MIT
