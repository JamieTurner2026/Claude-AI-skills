// Note usage (ROADMAP 7c): which notes runs actually open through the brain's get_note.
// One JSON line per get_note: { t: ISO time, path: vault-relative note path }. Nothing else, ever:
// no query text, no arguments, no note text. The file lives next to the index (outside the vault),
// so Jay's notes are never rewritten. Size-capped with one rotated copy. Writing never throws.

import { appendFileSync, existsSync, readFileSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { defaultIndexPath } from "./indexer.ts";

/** Rotate once the live file would pass this size. One older copy (usage.1.jsonl) is kept. */
export const MAX_USAGE_BYTES = 512 * 1024;
const MAX_READ_BYTES = 4 * MAX_USAGE_BYTES;

/** Only plain note paths under wiki/ or raw/ are ever logged. */
const NOTE_PATH = /^(?:wiki|raw)\/[^\u0000-\u001f\u007f\\]+\.md$/i;

export function usagePathFor(dbPath: string): string {
  return path.join(path.dirname(dbPath), "usage.jsonl");
}

/** Beside SUPEROS_BRAIN_DB when set, else beside the default index (~/.superos/brain/). */
export function defaultUsagePath(env: NodeJS.ProcessEnv = process.env): string {
  return usagePathFor(env["SUPEROS_BRAIN_DB"] ?? defaultIndexPath());
}

export function isLoggablePath(rel: string): boolean {
  return rel.length <= 400 && NOTE_PATH.test(rel) && !rel.split("/").some((p) => p === "" || p.startsWith("."));
}

/** Appends one usage line. Returns false (and writes nothing) for a path it will not log or on any I/O error. */
export function recordUse(file: string, rel: string, now: Date = new Date(), maxBytes = MAX_USAGE_BYTES): boolean {
  if (!isLoggablePath(rel)) return false;
  const line = JSON.stringify({ t: now.toISOString(), path: rel }) + "\n";
  try {
    if (existsSync(file) && statSync(file).size + line.length > maxBytes) renameSync(file, rotatedPath(file));
    appendFileSync(file, line, { mode: 0o600 });
    return true;
  } catch {
    return false; // usage is a nicety; get_note must still answer
  }
}

export function rotatedPath(file: string): string {
  return file.replace(/\.jsonl$/, "") + ".1.jsonl";
}

const Line = z.object({ t: z.string().datetime(), path: z.string() }).strict();

export type NoteUse = { count: number; last: string };
export type UsageMap = Map<string, NoteUse>;

/** Reads the rotated copy and the live file. Bad lines and unloggable paths are skipped, never trusted. */
export function readUsage(file: string): UsageMap {
  const out: UsageMap = new Map();
  for (const f of [rotatedPath(file), file]) {
    let text: string;
    try {
      if (!existsSync(f) || statSync(f).size > MAX_READ_BYTES) continue;
      text = readFileSync(f, "utf8");
    } catch { continue; }
    for (const raw of text.split("\n")) {
      if (!raw.trim()) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { continue; }
      const r = Line.safeParse(parsed);
      if (!r.success || !isLoggablePath(r.data.path)) continue;
      const prev = out.get(r.data.path);
      out.set(r.data.path, { count: (prev?.count ?? 0) + 1, last: !prev || r.data.t > prev.last ? r.data.t : prev.last });
    }
  }
  return out;
}

export type UsageSummary = {
  opens: number;
  notesUsed: number;
  used: { path: string; count: number; last: string }[];
  /** Known wiki notes with no recorded use (only when a list of known notes was given). */
  neverUsed: string[];
};

export function summarizeUsage(usage: UsageMap, knownNotes: readonly string[] = []): UsageSummary {
  const used = [...usage.entries()].map(([p, u]) => ({ path: p, ...u })).sort((a, b) => b.count - a.count || b.last.localeCompare(a.last) || a.path.localeCompare(b.path));
  // Generated files and folders (_index.md, _master-index.md, _learnings/) are not notes anyone opens on purpose.
  const neverUsed = [...new Set(knownNotes)].filter((p) => p.startsWith("wiki/") && !p.split("/").some((seg) => seg.startsWith("_")) && !usage.has(p)).sort();
  return { opens: used.reduce((n, u) => n + u.count, 0), notesUsed: used.length, used, neverUsed };
}

export function formatUsage(s: UsageSummary, limit = 20): string {
  const lines = [`Note usage: ${s.opens} opens of ${s.notesUsed} notes (get_note only; queries are never recorded)`];
  if (s.used.length) {
    lines.push("", "Most used:");
    for (const u of s.used.slice(0, limit)) lines.push(`  ${String(u.count).padStart(4)}  ${u.last.slice(0, 10)}  ${u.path}`);
  }
  lines.push("", `Never used (wiki notes): ${s.neverUsed.length}`);
  for (const p of s.neverUsed.slice(0, limit)) lines.push(`  ${p}`);
  if (s.neverUsed.length > limit) lines.push(`  … and ${s.neverUsed.length - limit} more`);
  return lines.join("\n");
}
