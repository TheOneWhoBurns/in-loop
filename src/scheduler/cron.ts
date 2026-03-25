/**
 * Scheduler — runs daily research and weekly newsletter cron jobs.
 */

import cron from "node-cron";
import type { InloopConfig } from "../config.js";
import type { DB } from "../db/index.js";
import type { RLM } from "../rlm/index.js";
import { runDailyResearch } from "../agent/researcher.js";
import { runWeeklyCuration } from "../agent/curator.js";

export function startScheduler(
  config: InloopConfig,
  db: DB,
  rlm: RLM,
): void {
  // Daily research (default: 6am every day)
  cron.schedule(config.schedule.dailyResearch, async () => {
    console.log("⏰ Daily research cron triggered");
    try {
      await runDailyResearch(db, rlm);
    } catch (err) {
      console.error("Daily research failed:", err);
    }
  });

  // Weekly newsletter (default: 6pm Sunday)
  cron.schedule(config.schedule.weeklyNewsletter, async () => {
    console.log("⏰ Weekly newsletter cron triggered");
    try {
      await runWeeklyCuration(config, db, rlm);
    } catch (err) {
      console.error("Weekly newsletter failed:", err);
    }
  });

  console.log(
    `📅 Scheduler started:\n` +
      `   Daily research: ${config.schedule.dailyResearch}\n` +
      `   Weekly newsletter: ${config.schedule.weeklyNewsletter}`,
  );
}
