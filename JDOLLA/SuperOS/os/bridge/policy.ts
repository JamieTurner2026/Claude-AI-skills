// Skill policy: which tools a run may use. Tools are granted by exact name only.
// Missing or invalid policy fails closed: runs are refused, never started with guessed tools.
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Paths } from "./config.ts";
import { SCRIPT_TOOL_NAMES } from "../tools/registry.ts";
import type { ScriptToolName } from "../tools/registry.ts";

export class PolicyError extends Error {}

export const KNOWN_TOOLS = ["Read", "Glob", "Grep", "Write", "Edit", "Bash", "WebFetch", "WebSearch", "NotebookEdit", "TodoWrite"] as const;
export type ToolName = (typeof KNOWN_TOOLS)[number];

/** T2 is read-only whatever the policy says. */
export const T2_TOOLS: readonly ToolName[] = ["Read", "Glob", "Grep"];

const ToolList = z.array(z.enum(KNOWN_TOOLS)).max(10);
/** Named script tools (os/tools/) by exact name; an unknown name makes the whole policy invalid. */
const ScriptToolList = z.array(z.enum(SCRIPT_TOOL_NAMES)).max(20);
export const PolicySchema = z.object({
  defaultTools: ToolList.min(1),
  /** Script tools every run gets. */
  scriptTools: ScriptToolList.default(["today"]),
  skills: z.record(z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/), z.object({ tools: ToolList.default([]), scriptTools: ScriptToolList.optional() }).strict()).default({}),
}).strict();
export type Policy = z.infer<typeof PolicySchema>;

export function policyPath(p: Paths): string { return path.join(p.os, "config", "skills.policy.json"); }

export function loadPolicy(p: Paths): Policy {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(policyPath(p), "utf8")); } catch { throw new PolicyError("The skill policy (os/config/skills.policy.json) is missing or not valid JSON, so no run can start."); }
  const parsed = PolicySchema.safeParse(raw);
  if (!parsed.success) throw new PolicyError("The skill policy is invalid: " + parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ").slice(0, 200));
  return parsed.data;
}

/** Tools for a T3 run: the defaults plus what a named skill lists. Unknown skill names get the defaults only. */
export function t3Tools(policy: Policy, skill?: string): ToolName[] {
  const extra = skill ? policy.skills[skill]?.tools ?? [] : [];
  return [...new Set([...policy.defaultTools, ...extra])];
}

/** Script tools for a run: the defaults plus what a named skill lists. */
export function scriptToolsFor(policy: Policy, skill?: string): ScriptToolName[] {
  const extra = skill ? policy.skills[skill]?.scriptTools ?? [] : [];
  return [...new Set([...policy.scriptTools, ...extra])];
}
