/**
 * Email helpers — used by tool scripts in scripts/.
 *
 * Supports two backends:
 * - AgentMail (agentmail.to) — uses REST API
 * - Standard IMAP/SMTP — uses imapflow + nodemailer
 *
 * The backend is auto-detected from the config host.
 */

import { createTransport } from "nodemailer";
import type { EmailConfig } from "./config.js";

export interface ParsedEmail {
  from: string;
  subject: string;
  text: string;
  html?: string;
  date: string;
  messageId?: string;
}

function isAgentMail(config: EmailConfig): boolean {
  return config.smtp.host.includes("agentmail.to");
}

/**
 * Send an email — auto-detects AgentMail vs standard SMTP.
 */
export async function sendEmail(
  config: EmailConfig,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  if (isAgentMail(config)) {
    await sendViaAgentMail(config, to, subject, html);
  } else {
    await sendViaSMTP(config, to, subject, html);
  }
}

async function sendViaAgentMail(
  config: EmailConfig,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const apiKey = config.smtp.auth.pass;
  const inboxId = config.imap.auth.user;

  const res = await fetch(
    `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inboxId)}/messages/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: [to], subject, html }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AgentMail send failed (${res.status}): ${body}`);
  }
}

async function sendViaSMTP(
  config: EmailConfig,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const transport = createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.auth,
  });

  await transport.sendMail({
    from: config.smtp.auth.user,
    to,
    subject,
    html,
  });

  transport.close();
}

/**
 * Poll for new emails — standard IMAP only.
 * For AgentMail, the daemon uses the REST API directly via agentmail.ts.
 * This function is kept for the trigger-loop.ts script with non-AgentMail providers.
 */
export async function pollForNewEmails(config: EmailConfig): Promise<ParsedEmail[]> {
  if (isAgentMail(config)) {
    return pollViaAgentMail(config);
  }

  // Standard IMAP — dynamic import to avoid loading imapflow/mailparser
  // when using AgentMail
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");

  const imap = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: config.imap.auth,
    logger: false,
    disableCompression: true,
  });

  const emails: ParsedEmail[] = [];
  imap.on("error", (err: Error) => {
    console.error("IMAP connection error:", err.message);
  });

  try {
    await imap.connect();
    const lock = await imap.getMailboxLock("INBOX");

    try {
      const messages: Array<{ seq: number; source: Buffer }> = [];
      for await (const msg of imap.fetch({ seen: false }, { source: true })) {
        messages.push({ seq: msg.seq, source: msg.source });
      }

      for (const msg of messages) {
        const parsed = await simpleParser(msg.source);
        emails.push({
          from: parsed.from?.value?.[0]?.address || "unknown",
          subject: parsed.subject || "(no subject)",
          text: parsed.text || "",
          html: parsed.html || undefined,
          date: (parsed.date || new Date()).toISOString(),
          messageId: parsed.messageId,
        });
      }

      if (messages.length > 0) {
        const seqRange = messages.map((m) => m.seq).join(",");
        await imap.messageFlagsAdd(seqRange, ["\\Seen"], { uid: false });
      }
    } finally {
      lock.release();
    }
  } finally {
    await imap.logout().catch(() => {});
  }

  return emails;
}

async function pollViaAgentMail(config: EmailConfig): Promise<ParsedEmail[]> {
  const apiKey = config.imap.auth.pass;
  const inboxId = config.imap.auth.user;
  const base = `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inboxId)}`;
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

  // List unread messages
  const listRes = await fetch(`${base}/messages?labels=unread`, { headers });
  if (!listRes.ok) throw new Error(`AgentMail list failed (${listRes.status})`);

  const listData = await listRes.json() as { messages: Array<{ message_id: string; from: string; subject: string; preview: string; created_at: string }> };
  if (!listData.messages || listData.messages.length === 0) return [];

  // Fetch full content and mark as read
  const emails: ParsedEmail[] = [];
  for (const msg of listData.messages) {
    const msgPath = `${base}/messages/${encodeURIComponent(msg.message_id)}`;
    const fullRes = await fetch(msgPath, { headers });
    if (!fullRes.ok) { console.error(`Failed to fetch ${msg.message_id}`); continue; }
    const full = await fullRes.json() as { text?: string; html?: string; extracted_text?: string; from: string; subject: string; created_at: string; message_id: string };

    emails.push({
      from: full.from || "unknown",
      subject: full.subject || "(no subject)",
      text: full.text || full.extracted_text || msg.preview || "",
      html: full.html || undefined,
      date: full.created_at || new Date().toISOString(),
      messageId: full.message_id,
    });

    // Remove "unread" label
    await fetch(msgPath, {
      method: "PATCH", headers,
      body: JSON.stringify({ remove_labels: ["unread"] }),
    }).catch(() => {});
  }

  return emails;
}
