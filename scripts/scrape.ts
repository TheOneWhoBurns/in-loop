#!/usr/bin/env tsx
/**
 * Scrape a URL using Scrapling (Python subprocess).
 * Usage: tsx scripts/scrape.ts <url> [headlines|full|links]
 */
import { spawn } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const [, , url, mode = "headlines"] = process.argv;

if (!url) {
  console.error("Usage: scrape.ts <url> [headlines|full|links]");
  process.exit(1);
}

const proc = spawn("python3", [join(__dirname, "scrape.py"), url, mode], {
  timeout: 30_000,
});

let stdout = "";
let stderr = "";
proc.stdout.on("data", (d) => (stdout += d));
proc.stderr.on("data", (d) => (stderr += d));

proc.on("close", (code) => {
  if (code !== 0) {
    console.error(`Scrape failed (exit ${code}): ${stderr}`);
    process.exit(1);
  }
  try {
    const result = JSON.parse(stdout);
    if (result.error) {
      console.error(`Scrape error: ${result.error}`);
      process.exit(1);
    }
    // Pretty-print for the agent to read
    if (mode === "headlines" && result.headlines) {
      for (const h of result.headlines) {
        console.log(`• ${h.text}${h.link ? ` → ${h.link}` : ""}`);
      }
    } else if (mode === "full") {
      console.log(result.fullText || "No text extracted.");
    } else if (mode === "links" && result.links) {
      for (const l of result.links) {
        console.log(`• ${l.text} → ${l.href}`);
      }
    }
  } catch {
    console.log(stdout); // Output raw if not JSON
  }
});
