/**
 * AgentMail client — REST API for reading/sending, WebSocket for real-time push.
 * Replaces IMAP polling with instant WebSocket notifications.
 */

import type { ParsedEmail } from "./email.js";

const API_BASE = "https://api.agentmail.to/v0";
const WS_URL = "wss://ws.agentmail.to/v0";

export interface AgentMailConfig {
  apiKey: string;
  inboxId: string; // e.g. "claudio.in.loop@agentmail.to"
}

interface AgentMailListMessage {
  message_id: string;
  from: string;
  to: string[];
  subject: string;
  preview: string;
  created_at: string;
  labels: string[];
}

interface AgentMailFullMessage extends AgentMailListMessage {
  text?: string;
  html?: string;
  extracted_text?: string;
}

async function apiFetch(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AgentMail API ${res.status}: ${body}`);
  }

  return res;
}

function encodeMessageId(messageId: string): string {
  return encodeURIComponent(messageId);
}

/**
 * Fetch all unread messages from the inbox, then mark them as read.
 */
export async function fetchNewEmails(config: AgentMailConfig): Promise<ParsedEmail[]> {
  const inboxPath = `/inboxes/${encodeURIComponent(config.inboxId)}`;

  // List unread messages
  const listRes = await apiFetch(`${inboxPath}/messages?labels=unread`, config.apiKey);
  const listData = await listRes.json() as { messages: AgentMailListMessage[] };

  if (!listData.messages || listData.messages.length === 0) return [];

  // Fetch full content for each message (list only has preview)
  const emails: ParsedEmail[] = [];
  for (const msg of listData.messages) {
    try {
      const fullRes = await apiFetch(
        `${inboxPath}/messages/${encodeMessageId(msg.message_id)}`,
        config.apiKey,
      );
      const full = await fullRes.json() as AgentMailFullMessage;

      emails.push({
        from: full.from || "unknown",
        subject: full.subject || "(no subject)",
        text: full.text || full.extracted_text || full.preview || "",
        html: full.html || undefined,
        date: full.created_at || new Date().toISOString(),
        messageId: full.message_id,
      });

      // Mark as read by removing "unread" label
      await apiFetch(
        `${inboxPath}/messages/${encodeMessageId(msg.message_id)}`,
        config.apiKey,
        { method: "PATCH", body: JSON.stringify({ remove_labels: ["unread"] }) },
      ).catch((err) => console.error(`Failed to mark ${msg.message_id} as read:`, err));
    } catch (err) {
      console.error(`Failed to fetch message ${msg.message_id}:`, err);
    }
  }

  return emails;
}

/**
 * Send an email via AgentMail REST API.
 */
export async function sendEmail(
  config: AgentMailConfig,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  await apiFetch(
    `/inboxes/${encodeURIComponent(config.inboxId)}/messages/send`,
    config.apiKey,
    {
      method: "POST",
      body: JSON.stringify({ to: [to], subject, html }),
    },
  );
}

/**
 * Start listening for new emails via lightweight polling.
 * Checks every `intervalMs` (default 60s) for unread messages.
 *
 * We use polling instead of WebSocket because AgentMail's WS drops
 * connections frequently with Node.js's built-in WebSocket client.
 * At 60s intervals this is ~1,440 lightweight API calls/day — well
 * within limits and far gentler than the old 30s IMAP reconnect cycle.
 */
export function startPolling(
  config: AgentMailConfig,
  onNewMessage: () => void,
  intervalMs = 60_000,
): { close: () => void } {
  let closed = false;

  async function check() {
    if (closed) return;
    try {
      const res = await apiFetch(
        `/inboxes/${encodeURIComponent(config.inboxId)}/messages?labels=unread`,
        config.apiKey,
      );
      const data = await res.json() as { count: number };
      if (data.count > 0) {
        onNewMessage();
      }
    } catch (err) {
      console.error("📫 Poll check error:", err);
    }
  }

  const timer = setInterval(check, intervalMs);
  // Initial check immediately
  check();

  return {
    close: () => {
      closed = true;
      clearInterval(timer);
    },
  };
}
