// Builds the exact command line for a T2 or T3 run. Pure: no I/O (policy, rules and sandbox status
// are passed in). The request text is always ONE argument and no shell is ever used, so shell syntax
// in a request ("; rm -rf ~", "$(whoami)") reaches Claude as plain text and is never executed.
import type { OsConfig } from "./config.ts";
import { T2_TOOLS } from "./policy.ts";
import type { ToolName } from "./policy.ts";
import { BRAIN_HINT, BRAIN_TOOLS } from "./brain-link.ts";
import { sandboxSettings } from "./sandbox.ts";
import type { SandboxStatus } from "./sandbox.ts";

export { T2_TOOLS };
export type RunTier = "T2" | "T3";

export class BudgetError extends Error {}
export class ContainmentError extends Error {}

/** The spend cap for a run: the config cap, or a lower one the request asks for. Never higher. */
export function capFor(tier: RunTier, config: OsConfig, requested?: number): number {
  const max = tier === "T2" ? config.engine.t2.maxBudgetUsd : config.engine.t3.maxBudgetUsd;
  if (requested === undefined) return max;
  if (!Number.isFinite(requested) || requested <= 0) throw new BudgetError("The budget must be more than $0.");
  if (requested > max) throw new BudgetError(`The budget can't be more than the ${tier} cap of $${max}.`);
  return requested;
}

/** The --settings JSON for a run: deny rules always; sandbox settings whenever Bash is offered. */
export function runSettings(vault: string, deny: string[], withSandbox: boolean): string {
  return JSON.stringify({ permissions: { deny }, ...(withSandbox ? { sandbox: sandboxSettings(vault) } : {}) });
}

export type ArgsInput = {
  tier: RunTier; text: string; budgetUsd: number; vault: string; workDir: string;
  /** T3 tools from the skill policy (T2 ignores this and is always read-only). */
  t3Tools: readonly ToolName[];
  deny: string[];
  sandbox: SandboxStatus;
  /** --mcp-config JSON for the second brain, or null to run without it. */
  brainMcpConfig?: string | null;
};

export function buildClaudeArgs(input: ArgsInput, config: OsConfig): { args: string[]; cwd: string } {
  if (typeof input.text !== "string" || !input.text.trim()) throw new Error("Empty request.");
  if (!input.deny.length) throw new ContainmentError("No deny rules: refusing to start a run without them.");
  const tools = input.tier === "T2" ? [...T2_TOOLS] : [...input.t3Tools];
  const wantsBash = tools.includes("Bash");
  // Never fall back to unsandboxed commands: no sandbox, no Bash.
  if (wantsBash && !input.sandbox.available) throw new ContainmentError(`This run needs Bash, which only runs inside a sandbox. ${input.sandbox.reason}`);
  const common = [
    "-p", input.text,
    "--output-format", "stream-json", "--verbose",
    "--max-budget-usd", String(input.budgetUsd),
    "--no-session-persistence",
    // Strip inherited config: no user or project settings, hooks or MCP servers; code-running tools removed unless named.
    "--restricted", "--strict-mcp-config",
    "--settings", runSettings(input.vault, input.deny, wantsBash),
    "--tools", tools.join(","),
    // The second brain: only its server (--strict-mcp-config ignores every other MCP config), only its two
    // read-only tools pre-approved. --allowedTools never holds a file tool; file access stays under --tools and the deny rules.
    ...(input.brainMcpConfig ? ["--mcp-config", input.brainMcpConfig, "--allowedTools", BRAIN_TOOLS.join(","), "--append-system-prompt", BRAIN_HINT] : []),
  ];
  if (input.tier === "T2") {
    const t2 = config.engine.t2;
    return { cwd: input.vault, args: [...common, "--model", t2.model, "--effort", t2.effort] };
  }
  const t3 = config.engine.t3;
  // Never let the config hand a run more freedom than "accept edits" (no bypass modes).
  if (!["acceptEdits", "default", "plan"].includes(t3.permissionMode)) throw new Error(`Permission mode "${t3.permissionMode}" is not allowed for runs.`);
  return { cwd: input.workDir, args: [...common, "--model", t3.model, "--effort", t3.effort, "--permission-mode", t3.permissionMode] };
}
