// Builds the exact command line for a T2 or T3 run. Pure: no I/O.
// The request text is always ONE argument and no shell is ever used, so shell syntax in a
// request ("; rm -rf ~", "$(whoami)") reaches Claude as plain text and is never executed.
import path from "node:path";
import type { OsConfig } from "./config.ts";

export type RunTier = "T2" | "T3";

/** T2 reads only. T3 may also write, but only inside its own work folder (no Bash until step g). */
export const T2_TOOLS = ["Read", "Glob", "Grep"] as const;
export const T3_TOOLS = ["Read", "Glob", "Grep", "Write", "Edit"] as const;

export class BudgetError extends Error {}

/** The spend cap for a run: the config cap, or a lower one the request asks for. Never higher. */
export function capFor(tier: RunTier, config: OsConfig, requested?: number): number {
  const max = tier === "T2" ? config.engine.t2.maxBudgetUsd : config.engine.t3.maxBudgetUsd;
  if (requested === undefined) return max;
  if (!Number.isFinite(requested) || requested <= 0) throw new BudgetError("The budget must be more than $0.");
  if (requested > max) throw new BudgetError(`The budget can't be more than the ${tier} cap of $${max}.`);
  return requested;
}

/** Permission rules use forward slashes and "//" for an absolute path. */
function absRule(p: string): string {
  const fwd = p.split(path.sep).join("/").replace(/\/+$/, "");
  return "/" + (fwd.startsWith("/") ? fwd : "/" + fwd);
}

/**
 * Deny rules passed with --settings. --restricted ignores the vault's own settings files, so the
 * important ones are restated here with absolute paths: never read .env files, the OS code, the
 * Claude config, logs or the bridge's secret.
 */
export function denySettings(vault: string): string {
  const v = absRule(vault);
  const targets = [`${v}/**/.env*`, `${v}/.env*`, `${v}/os/**`, `${v}/.claude/**`, `${v}/logs/**`, `${v}/.git/**`];
  const deny = targets.flatMap((t) => [`Read(${t})`, `Edit(${t})`, `Write(${t})`]);
  return JSON.stringify({ permissions: { deny } });
}

export type ArgsInput = { tier: RunTier; text: string; budgetUsd: number; vault: string; workDir: string };

export function buildClaudeArgs(input: ArgsInput, config: OsConfig): { args: string[]; cwd: string } {
  if (typeof input.text !== "string" || !input.text.trim()) throw new Error("Empty request.");
  const common = [
    "-p", input.text,
    "--output-format", "stream-json", "--verbose",
    "--max-budget-usd", String(input.budgetUsd),
    "--no-session-persistence",
    // Strip inherited config: no user or project settings, hooks or MCP servers; code-running tools removed.
    "--restricted", "--strict-mcp-config",
    "--settings", denySettings(input.vault),
  ];
  if (input.tier === "T2") {
    const t2 = config.engine.t2;
    return { cwd: input.vault, args: [...common, "--model", t2.model, "--effort", t2.effort, "--tools", T2_TOOLS.join(",")] };
  }
  const t3 = config.engine.t3;
  // Never let the config hand a run more freedom than "accept edits" (no bypass modes).
  if (!["acceptEdits", "default", "plan"].includes(t3.permissionMode)) throw new Error(`Permission mode "${t3.permissionMode}" is not allowed for runs.`);
  return {
    cwd: input.workDir,
    args: [...common, "--model", t3.model, "--effort", t3.effort, "--permission-mode", t3.permissionMode, "--tools", T3_TOOLS.join(",")],
  };
}
