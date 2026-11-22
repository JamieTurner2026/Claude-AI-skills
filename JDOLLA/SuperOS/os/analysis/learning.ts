// Learning-loop scorecard (Phase 10c). Read-only: proposals/ and skills/*/SKILL.md through the vault tools'
// safe readers. Per kind: made, approved, rejected, pending and the median days to a decision; plus the
// skills with the most learned rules. Counts and skill names only, never proposal text.
import { countLearnedRules, medianDaysToDecision, readProposals, type Stored } from "../tools/proposals_summary.ts";

const DAY_MS = 86_400_000;
export const KINDS = ["failed", "budget", "blocked", "uncited", "move", "tune"] as const;

export interface KindRow { kind: string; made: number; approved: number; rejected: number; pending: number; medianDaysToDecision: number | null }
export interface LearningStats {
  days: number | null; from: string | null; to: string;
  total: KindRow;
  byKind: KindRow[];
  learnedRules: { skill: string; rules: number }[];
  approvedRuleProposals: { skill: string; approved: number }[];
  skipped: number; truncated: boolean;
}

function row(kind: string, items: readonly Stored[]): KindRow {
  return {
    kind,
    made: items.length,
    approved: items.filter((p) => p.status === "approved").length,
    rejected: items.filter((p) => p.status === "rejected").length,
    pending: items.filter((p) => p.status === "pending").length,
    medianDaysToDecision: medianDaysToDecision(items),
  };
}

/** days: only proposals created in the last N days; null for all of them. */
export function learningStats(vault: string, now: Date, days: number | null): LearningStats {
  const { items, skipped, truncated } = readProposals(vault);
  const t = now.getTime();
  const from = days === null ? null : t - days * DAY_MS;
  const inWindow = items.filter((p) => { const c = Date.parse(p.createdAt); return c <= t && (from === null || c >= from); });
  const kinds = [...KINDS, ...new Set(inWindow.map((p) => p.kind).filter((k) => !(KINDS as readonly string[]).includes(k)))];
  const approvedBySkill = new Map<string, number>();
  for (const p of inWindow) if (p.status === "approved" && p.skillChange && /^[a-z0-9][a-z0-9-]{0,39}$/.test(p.skillChange.skill)) approvedBySkill.set(p.skillChange.skill, (approvedBySkill.get(p.skillChange.skill) ?? 0) + 1);
  return {
    days, from: from === null ? null : new Date(from).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10),
    total: row("all", inWindow),
    byKind: kinds.map((k) => row(k, inWindow.filter((p) => p.kind === k))).filter((r) => r.made > 0),
    learnedRules: countLearnedRules(vault).slice(0, 10),
    approvedRuleProposals: [...approvedBySkill].map(([skill, approved]) => ({ skill, approved })).sort((a, b) => b.approved - a.approved || (a.skill < b.skill ? -1 : 1)).slice(0, 10),
    skipped, truncated,
  };
}

const med = (n: number | null): string => (n === null ? "-" : `${n} d`);
const line = (r: KindRow): string => `  ${r.kind.padEnd(8)} ${String(r.made).padStart(5)} ${String(r.approved).padStart(9)} ${String(r.rejected).padStart(9)} ${String(r.pending).padStart(8)} ${med(r.medianDaysToDecision).padStart(15)}`;

export function formatLearning(s: LearningStats): string {
  const out = [`Learning-loop scorecard: ${s.days === null ? "all proposals" : `proposals from the last ${s.days} days (${s.from} to ${s.to})`}`];
  if (s.skipped || s.truncated) out.push(`Unreadable or oversized proposal files skipped: ${s.skipped}${s.truncated ? "; the vault had too many files, so the scan stopped early" : ""}`);
  if (!s.total.made) { out.push("", "No proposals in this window."); }
  else {
    out.push("", "  kind      made  approved  rejected  pending  median to decide", ...s.byKind.map(line), line(s.total));
  }
  out.push("", "Skills with the most learned rules (in SKILL.md)");
  out.push(...(s.learnedRules.length ? s.learnedRules.map((r) => `  ${r.skill.padEnd(26)} ${r.rules}`) : ["  (none yet)"]));
  if (s.approvedRuleProposals.length) out.push("", "Approved proposals that added a rule, in this window", ...s.approvedRuleProposals.map((r) => `  ${r.skill.padEnd(26)} ${r.approved}`));
  return out.join("\n");
}
