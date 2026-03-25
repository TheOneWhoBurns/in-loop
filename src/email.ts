/**
 * Email helpers — IMAP polling and SMTP sending.
 * Used by the daemon and by tool scripts.
 */

import { ImapFlow } from "imapflow";
import { createTransport } from "nodemailer";
import { simpleParser } from "mailparser";
import type { EmailConfig } from "./config.js";

export interface ParsedEmail {
  from: string;
  subject: string;
  text: string;
  html?: string;
  date: string;
  messageId?: string;
}

/**
 * Poll IMAP for unseen messages, mark them as seen, return parsed emails.
 */
export async function pollForNewEmails(config: EmailConfig): Promise<ParsedEmail[]> {
  const imap = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: config.imap.auth,
    logger: false,
  });

  const emails: ParsedEmail[] = [];

  // Prevent unhandled 'error' events from crashing the process
  imap.on("error", (err: Error) => {
    console.error("IMAP connection error:", err.message);
  });

  try {
    await imap.connect();
    const lock = await imap.getMailboxLock("INBOX");

    try {
      for await (const msg of imap.fetch({ seen: false }, { source: true })) {
        const parsed = await simpleParser(msg.source);
        emails.push({
          from: parsed.from?.value?.[0]?.address || "unknown",
          subject: parsed.subject || "(no subject)",
          text: parsed.text || "",
          html: parsed.html || undefined,
          date: (parsed.date || new Date()).toISOString(),
          messageId: parsed.messageId,
        });
        await imap.messageFlagsAdd(msg.seq, ["\\Seen"], { uid: false });
      }
    } finally {
      lock.release();
    }
  } finally {
    await imap.logout().catch(() => {});
  }

  return emails;
}

/**
 * Send an email via SMTP.
 */
export async function sendEmail(
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
