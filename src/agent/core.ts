/**
 * Loop 1: Main Agent — handles incoming user emails.
 *
 * The raw email is passed directly to the LLM (no pre-parsing).
 * The agent decides what to do and responds freely.
 */

import type { InloopConfig } from "../config.js";
import type { DB } from "../db/index.js";
import type { RLM } from "../rlm/index.js";
import type { IncomingEmail } from "../email/gateway.js";
import { EmailGateway } from "../email/gateway.js";
import { runAgentLoop } from "../llm/client.js";
import { LOOP1_EMAIL_AGENT } from "../llm/prompts.js";
import { emailAgentTools, createEmailToolExecutor } from "./tools.js";

export class CoreAgent {
  private config: InloopConfig;
  private db: DB;
  private rlm: RLM;
  private gateway: EmailGateway | null = null;

  constructor(config: InloopConfig, db: DB, rlm: RLM) {
    this.config = config;
    this.db = db;
    this.rlm = rlm;
  }

  setGateway(gateway: EmailGateway): void {
    this.gateway = gateway;
  }

  async handleIncomingEmail(email: IncomingEmail): Promise<void> {
    console.log(`📧 New email from ${email.from}: ${email.subject}`);

    // Build context from RLM
    const rlmContext = await this.rlm.recall({
      query: `user email: ${email.subject} ${email.text}`,
      types: ["email_interaction", "topic"],
      limit: 10,
    });

    const systemPrompt = LOOP1_EMAIL_AGENT.replace(
      "{rlm_context}",
      rlmContext.map((r) => r.content).join("\n---\n") || "No previous interactions.",
    );

    const userMessage = [
      `From: ${email.from}`,
      `Subject: ${email.subject}`,
      `Date: ${email.date.toISOString()}`,
      "",
      email.text,
    ].join("\n");

    // Create tool executor with reply capability
    const sendReply = async (msg: string) => {
      if (this.gateway) {
        await this.gateway.reply(
          email.from,
          email.subject,
          msg,
        );
      }
    };

    const executor = createEmailToolExecutor(this.db, this.rlm, sendReply);

    // Run the agent loop (one continuous inference call)
    const result = await runAgentLoop(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      emailAgentTools,
      executor,
    );

    // Store interaction in RLM
    await this.rlm.store({
      type: "email_interaction",
      content: `User: ${email.subject}\n${email.text}\n\nAgent response: ${result}`,
      metadata: { from: email.from, date: email.date.toISOString() },
    });

    console.log(`✅ Handled email: ${email.subject}`);
  }
}
