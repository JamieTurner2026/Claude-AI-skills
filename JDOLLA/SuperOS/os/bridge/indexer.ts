// Fills OsState from the vault. Reads only; never writes. Vault text is data, never instructions.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type { Department, Directive, MicroApp, OsState, Routine, Skill } from "../shared/types.ts";
import type { OsConfig, Paths } from "./config.ts";

const MAX_FILE = 512 * 1024;
const SLUG = /^[a-z][a-z0-9-]{0,39}$/;

function readText(file: string): string {
  if (statSync(file).size > MAX_FILE) throw new Error(`file too large: ${path.basename(file)}`);
  return readFileSync(file, "utf8");
}

/** Counts files under dir, skipping names that start with "_" or "." and never following links. */
export function countFiles(dir: string, ext?: string, limit = 50_000): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  const stack = [dir];
  while (stack.length && n < limit) {
    const cur = stack.pop() as string;
    for (const e of readdirSync(cur, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name.startsWith("_")) continue;
      if (e.isDirectory()) stack.push(path.join(cur, e.name));
      else if (e.isFile() && (!ext || e.name.toLowerCase().endsWith(ext))) n++;
    }
  }
  return n;
}

export function parseDepartment(slug: string, text: string): Omit<Department, "noteCount"> {
  const lines = text.split(/\r?\n/);
  const title = (lines.find((l) => l.startsWith("# ")) ?? `# ${slug}`).slice(2).replace(/:\s*router\s*$/i, "").trim();
  const summary = (lines.find((l) => l.trim() && !l.startsWith("#")) ?? "").trim().slice(0, 300);
  const skills: Skill[] = [];
  let section = "";
  for (const line of lines) {
    if (line.startsWith("## ")) { section = line.slice(3).trim().toLowerCase(); continue; }
    if (section !== "skills") continue;
    const m = /^- `\/([a-z0-9][a-z0-9-]{0,39})`(?::\s*(.{0,200}))?/.exec(line);
    if (m?.[1]) skills.push({ name: m[1], description: (m[2] ?? "").trim() });
  }
  return { slug, name: title.slice(0, 120), summary, skills };
}

export function directiveId(index: number, text: string): string {
  return `${index}-${createHash("sha256").update(text).digest("hex").slice(0, 8)}`;
}

/** Directive lines are "- [ ] text" or "- [x] text". Index counts directive lines only. */
export const DIRECTIVE_LINE = /^- \[( |x|X)\] (.{1,300})$/;

export function parseDirectives(text: string): Directive[] {
  const out: Directive[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = DIRECTIVE_LINE.exec(line);
    if (m?.[2] === undefined) continue;
    const body = m[2].trim();
    out.push({ id: directiveId(out.length, body), text: body, done: m[1] !== " " });
  }
  return out;
}

const RoutineSchema = z.object({
  id: z.string().min(1).max(60), name: z.string().min(1).max(120),
  schedule: z.string().max(120).default(""), enabled: z.boolean().default(true),
});
const AppSchema = z.object({ id: z.string().min(1).max(60), name: z.string().min(1).max(120), url: z.string().max(500).default("") });

function readJsonArray<T>(file: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, label: string, warnings: string[]): T[] {
  if (!existsSync(file)) return [];
  try {
    return z.array(schema).max(500).parse(JSON.parse(readText(file)));
  } catch {
    warnings.push(`${label} could not be read; showing none.`);
    return [];
  }
}

export function buildState(p: Paths, config: OsConfig, now: Date = new Date()): OsState {
  const warnings: string[] = [];
  const departments: Department[] = [];
  const deptDir = path.join(p.vault, "depts");
  if (existsSync(deptDir)) {
    for (const f of readdirSync(deptDir).sort()) {
      if (!f.endsWith(".md")) continue;
      const slug = f.slice(0, -3);
      if (!SLUG.test(slug)) { warnings.push(`Skipped department file with an unusual name: ${f.slice(0, 60)}`); continue; }
      try {
        const parsed = parseDepartment(slug, readText(path.join(deptDir, f)));
        departments.push({ ...parsed, noteCount: countFiles(path.join(p.vault, "wiki", slug), ".md") });
      } catch {
        warnings.push(`Department ${slug} could not be read.`);
      }
    }
  } else warnings.push("No depts/ folder found in the vault.");

  let directives: Directive[] = [];
  const dirFile = path.join(p.vault, "wiki", "directives.md");
  if (existsSync(dirFile)) {
    try { directives = parseDirectives(readText(dirFile)); } catch { warnings.push("wiki/directives.md could not be read."); }
  }

  return {
    owner: config.owner,
    brand: config.brand,
    timezones: config.timezones,
    generatedAt: now.toISOString(),
    departments,
    counts: {
      wiki: departments.reduce((n, d) => n + d.noteCount, 0),
      raw: countFiles(path.join(p.vault, "raw")),
      outputs: config.artifactRoots.reduce((n, r) => n + countFiles(path.join(p.vault, r)), 0),
    },
    directives,
    routines: readJsonArray<Routine>(path.join(p.vault, "routines", "routines.json"), RoutineSchema, "routines/routines.json", warnings),
    apps: readJsonArray<MicroApp>(path.join(p.vault, "apps", "apps.json"), AppSchema, "apps/apps.json", warnings),
    layout: config.layout,
    warnings,
  };
}
