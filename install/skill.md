# /install-inloop

Install and configure inloop — a personal newsletter agent where email is the only UI.

## What You Need To Do

You are Claude Code. The user wants you to set up inloop on this machine. Do the following steps:

### 1. Check Prerequisites

```bash
node --version    # Need >= 18
python3 --version # Need for Scrapling
claude --version  # Should be you!
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
# or
pip3 install scrapling
```

### 4. Configure Email

Ask the user for their **dedicated agent email** credentials. They need to have created an email account for the agent (e.g. `inloopagent@protonmail.com`, `myagent@gmail.com`).

You need:
- IMAP host and port (e.g. `imap.gmail.com:993`)
- SMTP host and port (e.g. `smtp.gmail.com:465`)
- Email address (login)
- Password or app password
- The user's PERSONAL email (where newsletters get sent)

Common providers:
| Provider | IMAP | SMTP |
|----------|------|------|
| Gmail | imap.gmail.com:993 | smtp.gmail.com:465 |
| Protonmail (Bridge) | 127.0.0.1:1143 | 127.0.0.1:1025 |
| Outlook | outlook.office365.com:993 | smtp.office365.com:587 |
| Yahoo | imap.mail.yahoo.com:993 | smtp.mail.yahoo.com:465 |

### 5. Write Config

Write the config file to `~/.config/inloop/config.json`:

```json
{
  "dataDir": "~/.config/inloop/data",
  "email": {
    "imap": {
      "host": "<imap_host>",
      "port": <port>,
      "secure": true,
      "auth": { "user": "<email>", "pass": "<password>" }
    },
    "smtp": {
      "host": "<smtp_host>",
      "port": <port>,
      "secure": true,
      "auth": { "user": "<email>", "pass": "<password>" }
    },
    "userEmail": "<personal_email>"
  },
  "schedule": {
    "dailyResearch": "0 6 * * *",
    "weeklyNewsletter": "0 18 * * 0"
  },
  "pollInterval": 30
}
```

Make sure to create the directory first: `mkdir -p ~/.config/inloop/data`

### 6. Test Email Connection

Try polling for emails to verify the config works:

```bash
cd <inloop_directory>
tsx -e "
import { loadConfig } from './src/config.js';
import { pollForNewEmails } from './src/email.js';
const config = await loadConfig();
const emails = await pollForNewEmails(config.email);
console.log('Connection OK! Found', emails.length, 'unread emails.');
"
```

### 7. Start the Daemon

```bash
npm run dev
```

Tell the user: "Send an email to <agent_email> to add your first topic!"

### 8. Optional: Click Tracking

Ask if they want click tracking. If yes:
1. Pick a port (default 3847)
2. Install cloudflared: `brew install cloudflare/cloudflare/cloudflared` (mac) or apt equivalent
3. Create tunnel: `cloudflared tunnel --url http://localhost:3847`
4. Add to config: `"tracking": { "enabled": true, "port": 3847, "publicUrl": "<tunnel_url>" }`
