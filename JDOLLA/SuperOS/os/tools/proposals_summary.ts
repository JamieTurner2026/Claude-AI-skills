// proposals_summary: what the learning loop has seen in the last N days. Counts by kind and status, the
// failures that keep repeating (by kind and skill), the skills with the most rejected proposals, and the
// rules Jay approved with how often that skill failed before and after. Counts, dates, skill names and
// the short approved rule only: never a proposal's run output, error text, prompt or diagnosis.
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ScriptTool } from "./registry.ts";
import { UNTRUSTED_NOTE, fence } from "../brain/present.ts";
import { MAX_READ_BYTES, scanVault, vaultRoot } from "./vault.ts";

const DAY_MS = 86_400_000;
const LIST_CAP = 10;
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

// Only the fields this tool needs. Anything else in a proposal is ignored; a file that doesn't fit is counted as skipped.
const Stored = z.object({
  createdAt: z.string().datetime({ offset: true }),
  status: z.enum(["pending", "approved", "rejected"]),
  decidedAt: z.string().datetime({ offset: true }).nullable(),
  kind: z.enum(["budget", "failed", "blocked", "move", "uncited", "tune"]),
  run: z.object({ skill: z.string().nullable(), routine: z.string().nullable().optional() }).passthrough(),
  skillChange: z.object({ skill: z.string(), rule: z.string() }).nullable().optional(),
}).passthrough();
export type Stored = z.infer<typeof Stored>;

const oneLine = (s: string, max: number): string => s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
const skillOf = (p: Stored): string => (p.run.skill && SLUG.test(p.run.skill) ? p.run.skill : "(typed request)");
const isFailure = (p: Stored): boolean => p.kind === "budget" || p.kind === "failed" || p.kind === "blocked";

export function readProposals(vault: string): { items: Stored[]; skipped: number; truncated: boolean } {
  const root = vaultRoot(vault);
  const { files, truncated } = scanVault(vault, ["proposals"]); // links and dot entries already skipped
  const items: Stored[] = [];
  let skipped = 0;
  for (const f of files) {
    if (!f.rel.toLowerCase().endsWith(".json")) continue;
    if (f.size > MAX_READ_BYTES) { skipped++; continue; }
    try {
      const parsed = Stored.safeParse(JSON.parse(readFileSync(path.join(root, f.rel), "utf8")));
      if (parsed.success) items.push(parsed.data); else skipped++;
    } catch { skipped++; }
  }
  return { items, skipped, truncated };
}

/** Median days from creation to decision over decided proposals, rounded to 0.1; null when none was decided. */
export function medianDaysToDecision(items: readonly Stored[]): number | null {
  const d = items.filter((p) => p.status !== "pending" && p.decidedAt).map((p) => (Date.parse(p.decidedAt!) - Date.parse(p.createdAt)) / DAY_MS).filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (!d.length) return null;
  const mid = Math.floor(d.length / 2);
  const m = d.length % 2 ? d[mid]! : (d[mid - 1]! + d[mid]!) / 2;
  return Math.round(m * 10) / 10;
}

export const LEARNED_HEADING = "## Learned rules";

/** Learned rules per skill: the "- " bullets under "## Learned rules" in skills/<name>/SKILL.md. Counts only, never the text. */
export function countLearnedRules(vault: string): { skill: string; rules: number }[] {
  const root = vaultRoot(vault);
  const out: { skill: string; rules: number }[] = [];
  for (const f of scanVault(vault, ["skills"]).files) {
    const m = /^skills\/([a-z0-9][a-z0-9-]{0,39})\/SKILL\.md$/.exec(f.rel);
    if (!m || f.size > MAX_READ_BYTES) continue;
    let text: string;
    try { text = readFileSync(path.join(root, f.rel), "utf8"); } catch { continue; }
    const lines = text.split(/\r?\n/);
    const at = lines.findIndex((l) => l.trim() === LEARNED_HEADING);
    if (at < 0) continue;
    let rules = 0;
    for (let i = at + 1; i < lines.length && !/^#{1,2} /.test(lines[i]!); i++) if (/^- \S/.test(lines[i]!)) rules++;
    if (rules) out.push({ skill: m[1]!, rules });
  }
  return out.sort((a, b) => b.rules - a.rules || (a.skill < b.skill ? -1 : 1));
}

const count = <T extends string>(xs: T[]): Record<string, number> => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});

export const proposalsSummary: ScriptTool = {
  name: "proposals_summary",
  description: "Summary of proposals/ from the last N days: counts by kind and status, the most repeated failures (kind and skill), the skills with the most rejected proposals, rules Jay approved with how often that skill failed before and since, the median days to a decision, and learned-rule counts per skill. Counts, dates, skill names and short rule text only; never run output or error text.",
  input: z.object({ days: z.number().int().min(1).max(90) }).strict(),
  inputSchema: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 90 } }, required: ["days"], additionalProperties: false },
  run(input, ctx) {
    const { days } = input as { days: number };
    const now = ctx.now().getTime();
    const from = now - days * DAY_MS;
    const { items, skipped, truncated } = readProposals(ctx.vault);
    const t = (s: string): number => Date.parse(s);
    const inWindow = items.filter((p) => t(p.createdAt) >= from && t(p.createdAt) <= now);

    const groups = new Map<string, { kind: string; skill: string; count: number; first: string; last: string }>();
    for (const p of inWindow.filter(isFailure)) {
      const key = `${p.kind}|${skillOf(p)}`;
      const g = groups.get(key) ?? { kind: p.kind, skill: skillOf(p), count: 0, first: p.createdAt, last: p.createdAt };
      g.count++;
      if (p.createdAt < g.first) g.first = p.createdAt;
      if (p.createdAt > g.last) g.last = p.createdAt;
      groups.set(key, g);
    }
    const repeatedFailures = [...groups.values()]
      .sort((a, b) => b.count - a.count || (a.last < b.last ? 1 : -1))
      .slice(0, LIST_CAP)
      .map((g) => ({ title: `${g.kind} · ${g.skill}`, kind: g.kind, skill: g.skill, count: g.count, firstSeen: g.first.slice(0, 10), lastSeen: g.last.slice(0, 10) }));

    const bySkill = new Map<string, { approved: number; rejected: number; pending: number }>();
    for (const p of inWindow) {
      const s = bySkill.get(skillOf(p)) ?? { approved: 0, rejected: 0, pending: 0 };
      s[p.status]++;
      bySkill.set(skillOf(p), s);
    }
    const mostRejected = [...bySkill].filter(([, s]) => s.rejected > 0)
      .sort((a, b) => b[1].rejected - a[1].rejected || (a[0] < b[0] ? -1 : 1))
      .slice(0, LIST_CAP)
      .map(([skill, s]) => ({ skill, ...s }));

    // Approved rules decided in the window. Before = that skill's failures in the `days` before approval;
    // since = its failures after approval. Equal-length windows are not guaranteed: daysSince says how long "since" is.
    const approvedRules = items
      .filter((p) => p.status === "approved" && p.skillChange && p.decidedAt && t(p.decidedAt) >= from && t(p.decidedAt) <= now && SLUG.test(p.skillChange.skill))
      .sort((a, b) => (a.decidedAt! < b.decidedAt! ? 1 : -1))
      .slice(0, LIST_CAP)
      .map((p) => {
        const at = t(p.decidedAt!);
        const skill = p.skillChange!.skill;
        const failures = items.filter((q) => isFailure(q) && skillOf(q) === skill);
        return {
          skill,
          rule: fence(oneLine(p.skillChange!.rule, 160), false, "proposal"), // the rule was drafted from a run that may have read hostile text: fenced data
          approvedOn: p.decidedAt!.slice(0, 10),
          daysSince: Math.max(0, Math.floor((now - at) / DAY_MS)),
          failuresBefore: failures.filter((q) => t(q.createdAt) < at && t(q.createdAt) >= at - days * DAY_MS).length,
          failuresSince: failures.filter((q) => t(q.createdAt) > at && t(q.createdAt) <= now).length,
        };
      });

    return {
      days,
      notice: UNTRUSTED_NOTE,
      from: new Date(from).toISOString().slice(0, 10),
      to: new Date(now).toISOString().slice(0, 10),
      total: inWindow.length,
      byKind: count(inWindow.map((p) => p.kind)),
      byStatus: count(inWindow.map((p) => p.status)),
      repeatedFailures,
      mostRejected,
      approvedRules,
      medianDaysToDecision: medianDaysToDecision(inWindow),
      learnedRules: countLearnedRules(ctx.vault).slice(0, LIST_CAP),
      skipped,
      truncated,
    };
  },
};
