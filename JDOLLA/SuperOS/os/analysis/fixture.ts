// A router.jsonl fixture for the analysis tests: fixed "now", known numbers, and malformed lines mixed in.
export const NOW = new Date("2026-11-21T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

type R = { days: number; tier?: "T2" | "T3"; status?: string; cost?: number | null; cap?: number; denied?: number; purpose?: string; skill?: string | null; routine?: string | null; capHit?: boolean; request?: string | null };
export const result = (r: R): string => JSON.stringify({
  at: ago(r.days), kind: "result", id: `r${Math.random().toString(36).slice(2, 8)}`, tier: r.tier ?? "T2", status: r.status ?? "done", costUsd: r.cost ?? 0.01, capUsd: r.cap ?? 0.05,
  ms: 100, exit: 0, denied: r.denied ?? 0, purpose: r.purpose ?? "run", skill: r.skill ?? null, routine: r.routine ?? null, dept: "general", capHit: r.capHit ?? false, request: r.request ?? null,
});

export const BAD_LINES = [
  "this is not json",
  "{\"at\":\"2026-11-20T00:00:00Z\",\"kind\":\"result\",\"id\":\"cut",       // truncated mid-write
  "[1,2,3]",
  "null",
  JSON.stringify({ at: ago(1), kind: "result", id: "x", tier: "T9", status: "done" }),          // bad tier
  JSON.stringify({ at: "not a date", kind: "result", id: "y", tier: "T2", status: "done" }),     // bad date
  JSON.stringify({ at: ago(1), kind: "result", id: "z", tier: "T2", status: "done", costUsd: -5 }), // negative cost
  "x".repeat(25_000),                                                                            // absurd line
  "",
];

/** 30-day-ish log. Totals are worked out in the test, not here. */
export function fixtureLog(): string {
  const L: string[] = [];
  // plan-today: routine runs, hit its cap 4 times, 1 other failure, 2 done.
  for (const d of [1, 2, 3, 4]) L.push(result({ days: d, tier: "T3", status: "failed", cost: 0.3, cap: 0.3, skill: "plan-today", routine: "plan-today", capHit: true }));
  L.push(result({ days: 5, tier: "T3", status: "failed", cost: 0.1, cap: 0.3, skill: "plan-today", routine: "plan-today" }));
  L.push(result({ days: 6, tier: "T3", cost: 0.2, cap: 0.3, skill: "plan-today", routine: "plan-today" }));
  L.push(result({ days: 7, tier: "T3", cost: 0.2, cap: 0.3, skill: "plan-today", routine: "plan-today" }));
  // vault-cleanup: 5 finished, 3 failed (60%), blocked calls 6 in 2 runs
  for (const d of [8, 9, 10]) L.push(result({ days: d, tier: "T3", status: "failed", cost: 0.05, cap: 0.5, skill: "vault-cleanup", denied: 3 }));
  for (const d of [11, 12]) L.push(result({ days: d, tier: "T3", cost: 0.05, cap: 0.5, skill: "vault-cleanup" }));
  // typed requests, the dearest one first
  L.push(result({ days: 2, cost: 0.55, cap: 2, tier: "T3", status: "done", request: "Summarise\nthe <b>whole</b> vault for me and also [[link]] everything you can find about the charter and the brief and more" }));
  L.push(result({ days: 3, cost: 0.02, request: "what is today" }));
  L.push(result({ days: 3, status: "stopped", cost: 0.004, request: "never mind" }));
  // an old run outside a 30-day window
  L.push(result({ days: 45, cost: 9, request: "ancient" }));
  // a diagnosis
  L.push(result({ days: 2, purpose: "diagnosis", cost: 0.03, cap: 0.05 }));
  // caps: 3 daily routine skips, 1 diagnosis skip, one old skip
  for (const d of [1, 2, 3]) L.push(JSON.stringify({ at: ago(d), kind: "routine-skipped", id: "plan-today", note: "Daily cap reached ($2.00 of $2.00)." }));
  L.push(JSON.stringify({ at: ago(40), kind: "routine-skipped", id: "plan-today", note: "Daily cap reached (old)." }));
  L.push(JSON.stringify({ at: ago(1), kind: "proposal", id: "p", diagnosis: "skipped-cap" }));
  L.push(JSON.stringify({ at: ago(1), kind: "route", tier: "T2" })); // unrelated kinds are fine
  // shuffle bad lines in
  const out: string[] = [];
  L.forEach((l, i) => { out.push(l); if (i % 3 === 0) out.push(BAD_LINES[(i / 3) % BAD_LINES.length] as string); });
  return out.join("\n") + "\n";
}
