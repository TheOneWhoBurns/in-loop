#!/usr/bin/env tsx
/**
 * Send an email reply to the user.
 * Usage: tsx scripts/email-reply.ts <to> <subject> <body>
 */
import { loadConfig } from "../src/config.js";
import { sendEmail } from "../src/email.js";

const [, , to, subject, body] = process.argv;

if (!to || !subject || !body) {
  console.error("Usage: email-reply.ts <to> <subject> <body>");
  process.exit(1);
}

const config = await loadConfig();
await sendEmail(config.email, to, `Re: ${subject}`, `<p>${body}</p>`);
console.log(`Reply sent to ${to}.`);
