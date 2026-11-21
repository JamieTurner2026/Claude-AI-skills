// Plain-text report for the CLI. Numbers only plus the cleaned 80-character request prefixes.
import type { Bucket, Named, Stats, Suggestion } from "./run-stats.ts";

const usd = (n: number) => `$${n.toFixed(4)}`;
const pct = (n: number | null) => (n === null ? "-" : `${Math.round(n * 100)}%`);
const row = (name: string, b: Bucket) =>
  `  ${name.padEnd(26)} ${String(b.runs).padStart(5)} runs  ${usd(b.costUsd).padStart(9)}  failed ${pct(b.failureRate).padStart(4)}  cap hits ${b.capHits}  blocked calls ${b.blockedCalls}`;
const list = (title: string, items: Named[]) => (items.length ? [title, ...items.map((i) => row(i.name, i))] : [title, "  (none)"]);

export function formatReport(s: Stats, suggestions: Suggestion[] = []): string {
  const out: string[] = [];
  out.push(`Run analysis: the last ${s.days} days (${s.from.slice(0, 10)} to ${s.to.slice(0, 10)})`);
  out.push(`Log lines read: ${s.lines}; unreadable lines skipped: ${s.malformed}${s.truncated ? "; log was longer than 20 MB so only the newest part was read" : ""}`);
  if (s.empty) { out.push("", "No runs were logged in this window."); return out.join("\n"); }
  out.push("", `Total spend ${usd(s.totals.costUsd)} over ${s.totals.runs} runs. Failure rate ${pct(s.totals.failureRate)}, stop rate ${pct(s.totals.stopRate)}.`);
  out.push("", "Spend per tier", row("T2 (quick)", s.byTier.T2), row("T3 (task)", s.byTier.T3));
  out.push("", "By purpose", row("runs", s.byPurpose.run), row("learning-loop diagnoses", s.byPurpose.diagnosis), row("typed requests", s.typed));
  out.push("", ...list("Spend per skill", s.bySkill));
  out.push("", ...list("Spend per routine", s.byRoutine));
  out.push("", "Most expensive requests");
  if (s.expensive.length === 0) out.push("  (none)");
  for (const e of s.expensive) out.push(`  ${usd(e.costUsd)}  ${e.tier}  ${e.status.padEnd(7)}  ${e.what}`);
  out.push("", `Blocked tool calls: ${s.blocked.calls} in ${s.blocked.runs} runs`);
  out.push("", `Caps hit: run budget ${s.caps.runCapHits}, daily routine cap ${s.caps.dailyRoutineCapHits}, diagnosis cap ${s.caps.diagnosisCapHits}`);
  if (suggestions.length) { out.push("", "Suggested changes (you edit the config yourself)"); for (const g of suggestions) out.push(`  - ${g.observation} ${g.fix}`); }
  return out.join("\n");
}
