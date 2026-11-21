// Assembles the bridge's own MCP servers for one run: the second brain (search, get_note) and the
// safe script tools (os/tools/). Each run gets only these servers, only the tool names its policy
// allows, and nothing that runs a shell.
import path from "node:path";
import { BRAIN_HINT, BRAIN_SERVER, BRAIN_TOOLS } from "./brain-link.ts";
import type { McpServer } from "./brain-link.ts";
import { TOOLS_SERVER, mcpToolName } from "../tools/registry.ts";
import type { ScriptToolName } from "../tools/registry.ts";

/** The tools server that ships with this bridge (never a file the vault could swap in). */
export const TOOLS_SERVER_SCRIPT = path.join(import.meta.dirname, "..", "tools", "mcp.ts");
export const TOOLS_HINT = "Named tools from superos-tools are safe scripts run by Jay's bridge (for example `today` gives the real date in his time zone, and the vault tools return file names, titles, dates and counts, never contents). Use them instead of guessing.";

export function toolsServer(names: readonly ScriptToolName[], timezone: string, vault: string, logs = ""): McpServer {
  return { command: process.execPath, args: [TOOLS_SERVER_SCRIPT], env: { SUPEROS_TOOLS: names.join(","), SUPEROS_TZ: timezone, SUPEROS_VAULT: vault, ...(logs ? { SUPEROS_LOGS: logs } : {}) } };
}

export type RunMcp = { config: string; allowedTools: string[]; hint: string };

/** null when the run gets neither the brain nor any script tool. */
export function buildRunMcp(input: { brain: McpServer | null; tools: readonly ScriptToolName[]; timezone: string; vault: string; logDir?: string }): RunMcp | null {
  const servers: Record<string, McpServer> = {};
  const allowed: string[] = [];
  const hints: string[] = [];
  if (input.brain) { servers[BRAIN_SERVER] = input.brain; allowed.push(...BRAIN_TOOLS); hints.push(BRAIN_HINT); }
  if (input.tools.length) { servers[TOOLS_SERVER] = toolsServer(input.tools, input.timezone, input.vault, input.logDir ?? ""); allowed.push(...input.tools.map(mcpToolName)); hints.push(TOOLS_HINT); }
  if (!allowed.length) return null;
  return { config: JSON.stringify({ mcpServers: servers }), allowedTools: allowed, hint: hints.join(" ") };
}
