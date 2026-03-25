/**
 * Scraper — orchestrates Scrapling (Python) as a subprocess.
 *
 * Scrapling handles anti-bot detection, JS rendering, and
 * works on sites that block Puppeteer/headless browsers.
 *
 * Communication: JSON over stdout.
 */

import { spawn } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRAPE_SCRIPT = join(__dirname, "../../scripts/scrape.py");

export interface ScrapeResult {
  url: string;
  headlines: Array<{ text: string; link?: string }>;
  fullText?: string;
  links?: Array<{ text: string; href: string }>;
  error?: string;
}

/**
 * Scrape a URL using Scrapling.
 *
 * @param url - URL to scrape
 * @param extract - What to extract: "headlines", "full", or "links"
 * @returns Formatted string result for the LLM
 */
export async function scrape(
  url: string,
  extract: string = "headlines",
): Promise<string> {
  const result = await runScraplingProcess(url, extract);

  if (result.error) {
    return `Error scraping ${url}: ${result.error}`;
  }

  switch (extract) {
    case "headlines":
      if (!result.headlines || result.headlines.length === 0) {
        return `No headlines found on ${url}`;
      }
      return result.headlines
        .map(
          (h) => `• ${h.text}${h.link ? ` → ${h.link}` : ""}`,
        )
        .join("\n");

    case "full":
      return result.fullText || `No text content extracted from ${url}`;

    case "links":
      if (!result.links || result.links.length === 0) {
        return `No links found on ${url}`;
      }
      return result.links
        .map((l) => `• ${l.text} → ${l.href}`)
        .join("\n");

    default:
      return `Unknown extract mode: ${extract}`;
  }
}

function runScraplingProcess(
  url: string,
  extract: string,
): Promise<ScrapeResult> {
  return new Promise((resolve) => {
    const proc = spawn("python3", [SCRAPE_SCRIPT, url, extract], {
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0 || !stdout.trim()) {
        resolve({
          url,
          headlines: [],
          error: stderr || `Process exited with code ${code}`,
        });
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ url, headlines: [], error: `Invalid JSON: ${stdout}` });
      }
    });

    proc.on("error", (err) => {
      resolve({ url, headlines: [], error: err.message });
    });
  });
}
