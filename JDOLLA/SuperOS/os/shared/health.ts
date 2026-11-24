// The bridge's health report (GET /api/health) and the pure helpers that read it. No node imports: the dashboard
// strip, `npm run status` and the tests all use these. The report holds counts, states and times only: never a note
// body, a path or a setting's value.
export type HealthView = {
  ok: true;
  version: string;
  uptimeSec: number;
  scheduler: { on: boolean; routinesOn: number; routinesTotal: number };
  /** Spend today against the daily routine cap (the same ledger the Routines widget shows). */
  spend: { todayUsd: number; capUsd: number; pct: number };
  lastRun: { status: string; tier: "T2" | "T3"; at: string } | null;
  brain: { present: boolean; indexAgeSec: number | null; stale: boolean; embeddings: boolean; embeddedChunks: number };
  proposals: { pending: number };
  /** Everything spent so far this calendar month (Jay's time zone), from the run log: dollars only. */
  month: { spendUsd: number };
  /** The last vault backup: when, and its one-word result (pushed, nothing, refused, failed). Null until one has run. */
  backup: { at: string; status: "pushed" | "nothing" | "refused" | "failed" } | null;
};

export const INDEX_WARN_SEC = 24 * 3600;
export const SPEND_WARN_PCT = 80;

/** What deserves a warning colour: scheduler off, index over a day old, today's spend over 80% of the cap, a failed or refused backup. */
export function healthWarnings(h: HealthView): string[] {
  const out: string[] = [];
  if (!h.scheduler.on) out.push("Scheduler is off");
  if (h.brain.indexAgeSec !== null && h.brain.indexAgeSec > INDEX_WARN_SEC) out.push("Brain index is over 1 day old");
  if (h.spend.pct > SPEND_WARN_PCT) out.push(`Spend is at ${Math.round(h.spend.pct)}% of today's cap`);
  if (h.backup && (h.backup.status === "failed" || h.backup.status === "refused")) out.push(`Last backup ${h.backup.status === "failed" ? "failed" : "was refused"}`);
  return out;
}

export function formatAge(sec: number): string {
  if (sec < 90) return `${Math.max(0, Math.round(sec))}s`;
  if (sec < 5400) return `${Math.round(sec / 60)}m`;
  if (sec < 172_800) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86_400)}d`;
}

/** A short two-column table for the terminal. */
export function formatHealth(h: HealthView, now: Date = new Date()): string {
  const rows: Array<[string, string]> = [
    ["Bridge", `running, version ${h.version}, up ${formatAge(h.uptimeSec)}`],
    ["Scheduler", h.scheduler.on ? "on" : "OFF"],
    ["Routines", `${h.scheduler.routinesOn} of ${h.scheduler.routinesTotal} on`],
    ["Spend today", `$${h.spend.todayUsd.toFixed(2)} of $${h.spend.capUsd.toFixed(2)} (${Math.round(h.spend.pct)}%)`],
    ["Last run", h.lastRun ? `${h.lastRun.status} (${h.lastRun.tier}), ${formatAge((now.getTime() - Date.parse(h.lastRun.at)) / 1000)} ago` : "none yet"],
    ["Brain index", !h.brain.present ? "not built yet" : h.brain.stale ? "marked stale, rebuilds on the next run" : `${formatAge(h.brain.indexAgeSec ?? 0)} old`],
    ["Embeddings", h.brain.embeddings ? `present (${h.brain.embeddedChunks} chunks)` : "not set up"],
    ["Proposals", `${h.proposals.pending} pending`],
    ["This month", `$${h.month.spendUsd.toFixed(2)} spent`],
    ["Backup", h.backup ? `${h.backup.status}, ${formatAge((now.getTime() - Date.parse(h.backup.at)) / 1000)} ago` : "never run"],
  ];
  const width = Math.max(...rows.map((r) => r[0].length));
  const lines = rows.map(([k, v]) => `${k.padEnd(width)}  ${v}`);
  const warns = healthWarnings(h);
  return [...lines, ...(warns.length ? ["", ...warns.map((w) => `WARNING: ${w}`)] : [])].join("\n");
}
