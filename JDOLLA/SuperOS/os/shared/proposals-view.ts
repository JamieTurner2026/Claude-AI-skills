// Proposals widget logic (10d): filter chips, the one-line "why", and the keyboard state machine.
// Pure and dependency-free so the browser widget and the node tests share it. Approving still goes
// through the bridge's normal route; the keyboard only ever asks first, then calls the same decide().
import type { ProposalView } from "./types.ts";

export type Kind = ProposalView["kind"];
export const KINDS: readonly Kind[] = ["failed", "budget", "blocked", "move", "uncited", "tune"];
export const KIND_LABEL: Record<Kind, string> = { failed: "Failed", budget: "Budget", blocked: "Blocked", move: "Move", uncited: "Uncited", tune: "Tune" };
export type Filter = Kind | "all";

/** Counts per kind across the list, plus "all". Every kind is present, zero when none. */
export function countByKind(list: readonly Pick<ProposalView, "kind">[]): Record<Filter, number> {
  const out = { all: list.length, failed: 0, budget: 0, blocked: 0, move: 0, uncited: 0, tune: 0 } as Record<Filter, number>;
  for (const p of list) if (p.kind in out) out[p.kind]++;
  return out;
}

/** Pending first (newest first), then decided ones (newest first), narrowed to one kind unless "all". */
export function visible<T extends Pick<ProposalView, "kind" | "status" | "createdAt">>(list: readonly T[], filter: Filter): T[] {
  const kept = filter === "all" ? [...list] : list.filter((p) => p.kind === filter);
  const newest = (a: T, b: T) => b.createdAt.localeCompare(a.createdAt);
  return [...kept.filter((p) => p.status === "pending").sort(newest), ...kept.filter((p) => p.status !== "pending").sort(newest)];
}

const TUNE_WHY: Record<string, string> = {
  "budget": "runs keep stopping at their budget cap",
  "failure-rate": "runs fail more often than they should",
  "daily-cap": "the daily cap keeps being reached",
  "blocked": "tool calls keep being blocked",
};

/** One plain line saying why a tune or uncited card exists, built only from stored fields. Null for other kinds. */
export function whyLine(p: Pick<ProposalView, "kind" | "tune" | "run">): string | null {
  if (p.kind === "tune" && p.tune) {
    const why = TUNE_WHY[p.tune.kind] ?? `the "${p.tune.kind}" rule fired`;
    return `Why: ${why} for ${p.tune.subject} (run analysis, last 30 days).`;
  }
  if (p.kind === "uncited") {
    return `Why: the answer used your notes but named none of them${p.run.skill ? `; approving adds a rule to /${p.run.skill}` : ""}.`;
  }
  return null;
}

// ---------- keyboard: j/k move, a/r ask, then y/Enter confirms or n/Escape cancels ----------

export type KeyItem = { id: string; pending: boolean; busy?: boolean };
export type KeyState = { index: number; ask: { id: string; decision: "approve" | "reject" } | null };
export type KeyResult = { state: KeyState; decide?: { id: string; decision: "approve" | "reject" }; handled: boolean };

export const START: KeyState = { index: 0, ask: null };

/**
 * One key press. a/r never decide on their own: they only ask, and only y or Enter on the same open
 * question decides. Any other key while asking cancels the question. Items that are not pending, or
 * are still being diagnosed (busy), cannot be asked about.
 */
export function onKey(s: KeyState, key: string, items: readonly KeyItem[]): KeyResult {
  const clamp = (i: number) => Math.max(0, Math.min(items.length - 1, i));
  const index = items.length ? clamp(s.index) : 0;
  if (s.ask) {
    if (key === "y" || key === "Enter") {
      const still = items.find((x) => x.id === s.ask?.id && x.pending && !x.busy);
      return still ? { state: { index, ask: null }, decide: s.ask, handled: true } : { state: { index, ask: null }, handled: true };
    }
    return { state: { index, ask: null }, handled: key === "n" || key === "Escape" };
  }
  if (!items.length) return { state: START, handled: false };
  if (key === "j" || key === "ArrowDown") return { state: { index: clamp(index + 1), ask: null }, handled: true };
  if (key === "k" || key === "ArrowUp") return { state: { index: clamp(index - 1), ask: null }, handled: true };
  if (key === "a" || key === "r") {
    const it = items[index];
    if (!it || !it.pending || it.busy) return { state: { index, ask: null }, handled: true };
    return { state: { index, ask: { id: it.id, decision: key === "a" ? "approve" : "reject" } }, handled: true };
  }
  return { state: { index, ask: null }, handled: false };
}

/** Keys typed into a text field or with a modifier never reach the widget's shortcuts. */
export function ignoreKey(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; targetTag?: string; editable?: boolean }): boolean {
  return Boolean(e.ctrlKey || e.metaKey || e.altKey || e.editable || (e.targetTag && /^(INPUT|TEXTAREA|SELECT)$/i.test(e.targetTag)));
}
