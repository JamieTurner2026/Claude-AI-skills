// Deny rules for a run. --restricted makes the CLI ignore the vault's .claude/settings.json, so the
// bridge reads that file itself and restates its rules with absolute paths, plus built-in rules that
// always apply. A missing or broken settings file fails closed: no run starts without the rules.
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PolicyError } from "./policy.ts";

/** Permission rules: "//" + absolute path, forward slashes. */
export function absRule(p: string): string {
  const fwd = p.split(path.sep).join("/").replace(/\\/g, "/").replace(/\/+$/, "");
  return "/" + (fwd.startsWith("/") ? fwd : "/" + fwd);
}

const FILE_TOOLS = /^(Read|Edit|Write|Glob|Grep|NotebookEdit)\((.+)\)$/;

/** Rewrites one rule so it means the same place whatever folder the run starts in. */
export function rewriteRule(rule: string, vault: string): string {
  const m = FILE_TOOLS.exec(rule);
  if (!m?.[1] || m[2] === undefined) return rule; // Bash(...) and others are not paths: keep as written
  const target = m[2];
  if (target.startsWith("//") || target.startsWith("~/")) return rule; // already absolute or home-relative
  const base = absRule(vault);
  const rel = target.startsWith("/") ? target : "/" + target; // "/x" is vault-relative; "x" too
  return `${m[1]}(${base}${rel})`;
}

export function builtinDenyRules(vault: string): string[] {
  const v = absRule(vault);
  const targets = [`${v}/**/.env*`, `${v}/.env*`, `${v}/os/**`, `${v}/.claude/**`, `${v}/logs/**`, `${v}/.git/**`];
  return targets.flatMap((t) => [`Read(${t})`, `Edit(${t})`, `Write(${t})`]);
}

const VaultSettings = z.object({ permissions: z.object({ deny: z.array(z.string().min(1).max(300)).max(500) }).passthrough() }).passthrough();

export function vaultDenyRules(vault: string): string[] {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path.join(vault, ".claude", "settings.json"), "utf8")); } catch {
    throw new PolicyError("The vault's .claude/settings.json is missing or not valid JSON, so no run can start.");
  }
  const parsed = VaultSettings.safeParse(raw);
  if (!parsed.success) throw new PolicyError("The vault's .claude/settings.json has no valid permissions.deny list, so no run can start.");
  return parsed.data.permissions.deny.map((r) => rewriteRule(r, vault));
}

export function allDenyRules(vault: string): string[] {
  return [...new Set([...builtinDenyRules(vault), ...vaultDenyRules(vault)])];
}
