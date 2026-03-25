import { ImapFlow } from "imapflow";
import { createTransport, type Transporter } from "nodemailer";
import { simpleParser, type ParsedMail } from "mailparser";
import type { EmailConfig } from "../config.js";

export interface IncomingEmail {
  from: string;
  subject: string;
  text: string;
  html?: string;
  date: Date;
  messageId?: string;
}

export class EmailGateway {
  private imap: ImapFlow | null = null;
  private smtp: Transporter | null = null;
  private config: EmailConfig;
  private onEmail: (email: IncomingEmail) => Promise<void>;
  private polling = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    config: EmailConfig,
    onEmail: (email: IncomingEmail) => Promise<void>,
  ) {
    this.config = config;
    this.onEmail = onEmail;
  }

  async start(): Promise<void> {
    // Setup SMTP transport
    this.smtp = createTransport({
      host: this.config.smtp.host,
      port: this.config.smtp.port,
      secure: this.config.smtp.secure,
      auth: this.config.smtp.auth,
    });

    // Setup IMAP
    this.imap = new ImapFlow({
      host: this.config.imap.host,
      port: this.config.imap.port,
      secure: this.config.imap.secure,
      auth: this.config.imap.auth,
      logger: false,
    });

    await this.imap.connect();
    console.log("📬 Email gateway connected");

    // Start polling for new messages
    this.polling = true;
    await this.poll();
    this.pollTimer = setInterval(() => this.poll(), 30_000); // 30s default
  }

  async stop(): Promise<void> {
    this.polling = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.imap) await this.imap.logout();
  }

  private async poll(): Promise<void> {
    if (!this.imap || !this.polling) return;

    try {
      const lock = await this.imap.getMailboxLock("INBOX");
      try {
        // Fetch unseen messages
        for await (const msg of this.imap.fetch({ seen: false }, { source: true })) {
          const parsed: ParsedMail = await simpleParser(msg.source);

          const email: IncomingEmail = {
            from: parsed.from?.value?.[0]?.address || "unknown",
            subject: parsed.subject || "(no subject)",
            text: parsed.text || "",
            html: parsed.html || undefined,
            date: parsed.date || new Date(),
            messageId: parsed.messageId,
          };

          // Mark as seen
          await this.imap!.messageFlagsAdd(msg.seq, ["\\Seen"], { uid: false });

          // Route to agent
          await this.onEmail(email);
        }
      } finally {
        lock.release();
      }
    } catch (err) {
      console.error("Email poll error:", err);
    }
  }

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    if (!this.smtp) throw new Error("SMTP not initialized");

    await this.smtp.sendMail({
      from: this.config.imap.auth.user,
      to,
      subject,
      html,
    });
  }

  async reply(to: string, subject: string, body: string): Promise<void> {
    await this.sendEmail(to, `Re: ${subject}`, `<p>${body}</p>`);
  }
}
