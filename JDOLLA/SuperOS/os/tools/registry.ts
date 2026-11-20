// Safe tools layer (the "Tools" in WAT): named, tested scripts a run can call through the bridge.
// A run never gets a command line. Each tool is a plain function with a zod-checked input, and it
// only receives what ToolContext hands it. To add a tool: write tools/<name>.ts with a test, add it
// to TOOLS below, and allow it by name in os/config/skills.policy.json ("scriptTools").
import type { z } from "zod";
import { today } from "./today.ts";

export type ToolContext = { timezone: string; now: () => Date };

export type ScriptTool = {
  name: string;
  description: string;
  /** Validates the call's arguments before run() sees them. */
  input: z.ZodType<unknown>;
  /** The same shape as JSON Schema, for the MCP tools/list reply. */
  inputSchema: Record<string, unknown>;
  run: (input: unknown, ctx: ToolContext) => unknown;
};

export const TOOLS: readonly ScriptTool[] = [today];
export const SCRIPT_TOOL_NAMES = ["today"] as const;
export type ScriptToolName = (typeof SCRIPT_TOOL_NAMES)[number];
export const TOOLS_SERVER = "superos-tools";
export const mcpToolName = (name: string) => `mcp__${TOOLS_SERVER}__${name}`;
