// Lists the skill drafts in skills/<name>/SKILL.md for the Skills widget: name, description, tier and suggested budget.
// Reads only; never runs anything. A SKILL.md that cannot be understood is still listed, with "unknown" values and
// the safe defaults (T2, $0.05), so one bad file never hides the others.
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Paths } from "./config.ts";

export const SKILL_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const MAX_SKILL_BYTES = 64 * 1024;
const MAX_SKILLS = 200;
/** Used when a skill's tier or budget line cannot be read. */
export const UNKNOWN_TIER = "T2" as const;
export const UNKNOWN_BUDGET_USD = 0.05;

export type SkillEntry = {
  name: string;
  description: string;
  tier: "T2" | "T3";
  tierKnown: boolean;
  budgetUsd: number;
  budgetKnown: boolean;
  /** False when the file cannot be read or is too large; the Run button is disabled. */
  runnable: boolean;
  /** Plain-English note about anything odd in the file, or null. */
  problem: string | null;
};

const TIER = /\bTier:\s*\*\*(T[23])\b/;
const BUDGET = /\bbudget:\s*\*\*\$(\d{1,3}(?:\.\d{1,2})?)(?![\d.])/i;

/** Understands one SKILL.md. Never throws: anything it cannot read becomes "unknown" plus a note. */
export function parseSkill(name: string, text: string): SkillEntry {
  const problems: string[] = [];
  const fm = /^---\r?\n([\s\S]{0,4000}?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  let fmName = "";
  let description = "";
  if (!fm?.[1]) problems.push("no frontmatter (name and description)");
  else {
    for (const line of fm[1].split(/\r?\n/)) {
      const kv = /^(name|description):[ \t]*(.{0,2000})$/.exec(line);
      if (kv?.[1] === "name") fmName = (kv[2] ?? "").trim();
      else if (kv?.[1] === "description") description = (kv[2] ?? "").trim();
    }
    if (!description) problems.push("no description");
    if (fmName && fmName !== name) problems.push(`its name "${fmName.slice(0, 40)}" does not match the folder`);
  }
  const body = fm ? text.slice(fm[0].length) : text;
  const t = TIER.exec(body)?.[1];
  const b = BUDGET.exec(body)?.[1];
  const budget = b === undefined ? NaN : Number(b);
  const budgetKnown = Number.isFinite(budget) && budget > 0 && budget <= 100;
  if (!t) problems.push('no readable "Tier: **T2" or "**T3" line');
  if (!budgetKnown) problems.push('no readable "budget: **$0.25" line');
  return {
    name,
    description: description.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").trim().slice(0, 400),
    tier: t === "T3" ? "T3" : UNKNOWN_TIER,
    tierKnown: t !== undefined,
    budgetUsd: budgetKnown ? budget : UNKNOWN_BUDGET_USD,
    budgetKnown,
    runnable: true,
    problem: problems.length ? `Shown with defaults: ${problems.join("; ")}.` : null,
  };
}

const blocked = (name: string, why: string): SkillEntry => ({
  name, description: "", tier: UNKNOWN_TIER, tierKnown: false, budgetUsd: UNKNOWN_BUDGET_USD, budgetKnown: false, runnable: false, problem: `Cannot run: ${why}.`,
});

/** Every `skills/<name>/SKILL.md`. Folders with bad names, links and folders without a SKILL.md are skipped. */
export function listSkills(paths: Paths): SkillEntry[] {
  const dir = path.join(paths.vault, "skills");
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out: SkillEntry[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= MAX_SKILLS) break;
    if (!e.isDirectory() || !SKILL_SLUG.test(e.name)) continue; // links and odd names are not skills
    const file = path.join(dir, e.name, "SKILL.md");
    let st;
    try { st = lstatSync(file); } catch { continue; } // no SKILL.md: not a skill
    if (!st.isFile()) { out.push(blocked(e.name, "SKILL.md is not a regular file")); continue; }
    if (st.size > MAX_SKILL_BYTES) { out.push(blocked(e.name, "SKILL.md is too large")); continue; }
    try { out.push(parseSkill(e.name, readFileSync(file, "utf8"))); } catch { out.push(blocked(e.name, "SKILL.md cannot be read")); }
  }
  return out;
}

export function findSkill(paths: Paths, name: string): SkillEntry | null {
  return SKILL_SLUG.test(name) ? listSkills(paths).find((s) => s.name === name) ?? null : null;
}
