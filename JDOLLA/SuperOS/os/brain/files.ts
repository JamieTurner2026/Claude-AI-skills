// Which vault files the brain may read. Path safety comes from os/bridge/guards.ts, not from rules rewritten here.
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { GuardError, MAX_READ, resolveVaultFile } from "../bridge/guards.ts";

export const BRAIN_EXT: ReadonlySet<string> = new Set([".md", ".txt"]);
export const BRAIN_ROOTS = ["wiki", "raw"] as const;

export function isTrusted(relPath: string): boolean {
  return relPath.split("/")[0] === "wiki";
}

/** Vault-relative path (forward slashes) -> real path, or throws GuardError. wiki/ and raw/ only. */
export function resolveBrainFile(vault: string, rel: unknown): string {
  if (typeof rel !== "string") throw new GuardError("Bad path.");
  const first = rel.replace(/\\/g, "/").split("/")[0]?.toLowerCase() ?? "";
  if (!(BRAIN_ROOTS as readonly string[]).includes(first)) throw new GuardError("The brain only reads wiki/ and raw/.");
  const real = resolveVaultFile(vault, rel, BRAIN_EXT); // blocks .env, dot-folders, links out, os/, logs/, bad types
  if (statSync(real).size > MAX_READ) throw new GuardError("File is too large for the brain.");
  return real;
}

export function readBrainFile(vault: string, rel: string): { real: string; text: string } {
  const real = resolveBrainFile(vault, rel);
  return { real, text: readFileSync(real, "utf8") };
}

export function toVaultRel(vaultRoot: string, abs: string): string {
  return path.relative(vaultRoot, abs).split(path.sep).join("/");
}
