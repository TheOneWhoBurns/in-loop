/**
 * Click Tracker — tiny HTTP redirect server for tracking link clicks.
 *
 * Newsletter links are wrapped: /click/:candidateId?url=<actual_url>
 * When clicked, logs the click in the DB and redirects to the actual URL.
 *
 * Optional: exposed via Cloudflare Tunnel (free) so links work from any device.
 */

import { createServer, type Server } from "http";
import type { TrackingConfig } from "../config.js";
import type { DB } from "../db/index.js";

export class ClickTracker {
  private server: Server | null = null;
  private config: TrackingConfig;
  private db: DB;

  constructor(config: TrackingConfig, db: DB) {
    this.config = config;
    this.db = db;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url || "/", `http://localhost:${this.config.port}`);

      // Health check
      if (url.pathname === "/health") {
        res.writeHead(200);
        res.end("ok");
        return;
      }

      // Click redirect: /click/:candidateId?url=<actual_url>
      const match = url.pathname.match(/^\/click\/(\d+)$/);
      if (match) {
        const candidateId = parseInt(match[1], 10);
        const targetUrl = url.searchParams.get("url");

        if (!targetUrl) {
          res.writeHead(400);
          res.end("Missing url parameter");
          return;
        }

        // Log the click
        try {
          this.db
            .prepare("UPDATE candidates SET clicked = 1 WHERE id = ?")
            .run(candidateId);
          console.log(`🖱️  Click tracked: candidate ${candidateId}`);
        } catch (err) {
          console.error("Click tracking error:", err);
        }

        // Redirect
        res.writeHead(302, { Location: targetUrl });
        res.end();
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    return new Promise((resolve) => {
      this.server!.listen(this.config.port, "127.0.0.1", () => {
        console.log(`🖱️  Click tracker running on port ${this.config.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => resolve());
      });
    }
  }
}
