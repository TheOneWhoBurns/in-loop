# /install-inloop

Install and configure inloop — a personal newsletter agent where email is the only UI.

## What You Need To Do

You are an agent CLI (Claude Code, Codex, etc.). The user wants you to set up inloop on this machine.

### 1. Check Prerequisites

```bash
node --version    # Need >= 18
python3 --version # Need for Scrapling
```

If Node.js is missing, install it. If Python3 is missing, tell the user.

### 2. Clone & Install

If not already in the inloop directory:

```bash
git clone https://github.com/TheOneWhoBurns/in-loop.git
cd in-loop
npm install
```

If already in the directory, just `npm install`.

### 3. Install Scrapling

```bash
pip install scrapling
```

### 4. Detect Agent CLI

Check which agent CLI is running this skill. Try these in order:

| CLI | Check | Prompt Args | Tools Args |
|-----|-------|-------------|------------|
| Claude Code | `claude --version` | `["-p"]` | `["--allowedTools"]` |
| Codex CLI | `codex --version` | `["exec"]` | `[]` |

Use the first one found. If none found, default to Claude Code.

### 5. Ask 3 Questions

Only ask for:
1. **Agent Gmail address** — the dedicated Gmail for the agent (e.g. `agent.in.loop@gmail.com`)
2. **App password** — the 16-char Gmail app password (user needs 2FA enabled)
3. **Personal email** — where newsletters get sent

Everything else uses sensible defaults (Gmail IMAP on 993, SMTP on 587/STARTTLS).

### 6. Set Environment Variable

Add the app password to `~/.bashrc`:

```bash
echo 'export INLOOP_APP_PASSWORD="<app_password>"' >> ~/.bashrc
source ~/.bashrc
```

### 7. Write Config

Write to `~/.config/inloop/config.json`:

```json
{
  "dataDir": "~/.config/inloop/data",
  "email": {
    "imap": {
      "host": "imap.gmail.com",
      "port": 993,
      "secure": true,
      "auth": { "user": "<agent_email>", "pass": "${INLOOP_APP_PASSWORD}" }
    },
    "smtp": {
      "host": "smtp.gmail.com",
      "port": 587,
      "secure": false,
      "auth": { "user": "<agent_email>", "pass": "${INLOOP_APP_PASSWORD}" }
    },
    "userEmail": "<personal_email>"
  },
  "agentCLI": {
    "command": "<detected_command>",
    "promptArgs": ["<detected_args>"],
    "toolsArgs": ["<detected_args>"]
  },
  "schedule": {
    "dailyResearch": "0 6 * * *",
    "weeklyNewsletter": "0 18 * * 0"
  },
  "pollInterval": 30
}
```

Make sure to create the directory: `mkdir -p ~/.config/inloop/data`

### 8. Start the Daemon

```bash
npm start
```

The daemon will start polling for emails. Tell the user: "Send an email to <agent_email> to add your first topic!"
