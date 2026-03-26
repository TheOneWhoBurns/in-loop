/**
 * Agent CLI runner — shared by daemon and tool scripts.
 * Executes prompts via the configured agent CLI (Claude Code, Codex, etc.).
 */

import { execFile } from "child_process";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { AgentCLIConfig } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

export const ALLOWED_TOOLS = "Bash(tsx:*),WebSearch,WebFetch,Read,Write";

export const DEFAULT_AGENT_CLI: AgentCLIConfig = {
  command: "claude",
  promptArgs: ["-p"],
  toolsArgs: ["--allowedTools"],
};

export function runAgent(
  agentCLI: AgentCLIConfig,
  prompt: string,
  timeoutMs: number,
): Promise<void> {
  const args = [
    ...agentCLI.promptArgs,
    prompt,
    ...(agentCLI.toolsArgs.length > 0 ? [...agentCLI.toolsArgs, ALLOWED_TOOLS] : []),
    "--dangerously-skip-permissions",
  ];

  return new Promise((resolve, reject) => {
    const child = execFile(
      agentCLI.command,
      args,
      { cwd: PROJECT_ROOT, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });
}

export async function loadPrompt(name: string): Promise<string> {
  return readFile(join(PROJECT_ROOT, `prompts/${name}`), "utf-8");
}
