#!/usr/bin/env tsx
/**
 * Send a newsletter email.
 * Usage: tsx scripts/email-send.ts <to> <subject> <html_file>
 * The html_file path contains the newsletter HTML.
 */
import { readFileSync } from "fs";
import { loadConfig } from "../src/config.js";
import { sendEmail } from "../src/email.js";

const [, , to, subject, htmlFile] = process.argv;

if (!to || !subject || !htmlFile) {
  console.error("Usage: email-send.ts <to> <subject> <html_file>");
  process.exit(1);
}

const html = readFileSync(htmlFile, "utf-8");
const config = await loadConfig();
await sendEmail(config.email, to, subject, html);
console.log(`Email sent to ${to}: ${subject}`);
