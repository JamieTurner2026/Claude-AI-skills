// Builds the health report (shared/health.ts). Read-only: stats the brain index file and counts rows in it; every
// other number is handed in by the bridge. Nothing here reads a note, a setting or a path into the answer.
import { statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { HealthView } from "../shared/health.ts";
import type { RoutineStatus } from "./routine-runner.ts";
import type { RunInfo } from "./runs.ts";

/** markStale() sets the index's modified time to 1970; that means "rebuild on the next run", not "old". */
const STALE_MARK_MS = 1000;

export function brainHealth(dbPath: string, nowMs: number): HealthView["brain"] {
  let mtimeMs: number;
  try { mtimeMs = statSync(dbPath).mtimeMs; } catch { return { present: false, indexAgeSec: null, stale: false, embeddings: false, embeddedChunks: 0 }; }
  let embeddedChunks = 0;
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'vectors'").get()) {
        embeddedChunks = Number((db.prepare("SELECT COUNT(*) AS n FROM vectors").get() as { n: number | bigint }).n);
      }
    } finally { db.close(); }
  } catch { embeddedChunks = 0; }
  const stale = mtimeMs <= STALE_MARK_MS;
  return { present: true, indexAgeSec: stale ? null : Math.max(0, Math.round((nowMs - mtimeMs) / 1000)), stale, embeddings: embeddedChunks > 0, embeddedChunks };
}

export type HealthInput = {
  version: string; startedAtMs: number; now: Date; routines: RoutineStatus; runs: readonly RunInfo[]; brainDb: string; pendingProposals: number;
  /** The last backup's record (backup/record.ts), or null if none yet. Only its time and one-word result are shown. */
  backup: { at: string; status: "pushed" | "nothing" | "refused" | "failed" } | null;
  /** Spend so far this calendar month, in dollars. */
  monthUsd: number;
};

export function buildHealth(d: HealthInput): HealthView {
  // The learning loop's background diagnosis runs are not "the last run" Jay asks about.
  const last = [...d.runs].filter((r) => r.startedAt && r.purpose !== "diagnosis").sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
  const cap = d.routines.dailyCapUsd;
  const spent = d.routines.spentTodayUsd;
  return {
    ok: true,
    version: d.version,
    uptimeSec: Math.max(0, Math.round((d.now.getTime() - d.startedAtMs) / 1000)),
    scheduler: { on: d.routines.schedulerOn, routinesOn: d.routines.routines.filter((r) => r.enabled).length, routinesTotal: d.routines.routines.length },
    spend: { todayUsd: Math.round(spent * 10_000) / 10_000, capUsd: cap, pct: cap > 0 ? Math.round((spent / cap) * 1000) / 10 : 0 },
    lastRun: last ? { status: last.status, tier: last.tier, at: last.endedAt || last.startedAt } : null,
    brain: brainHealth(d.brainDb, d.now.getTime()),
    proposals: { pending: d.pendingProposals },
    month: { spendUsd: Math.round(d.monthUsd * 100) / 100 },
    backup: d.backup ? { at: d.backup.at, status: d.backup.status } : null, // the message text stays out of the strip
  };
}
