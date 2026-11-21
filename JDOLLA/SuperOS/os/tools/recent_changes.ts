// recent_changes: notes (wiki/) and outputs changed in the last N days, newest first. Path, title and date only.
// Days are calendar days in Jay's time zone, and today counts as day 1 (so days = 1 means today). Never returns a body.
import { z } from "zod";
import type { ScriptTool } from "./registry.ts";
import { DeptArg, GENERATED, checkDept, clean, dateMinus, localDate, outputDept, parseFront, readHead, scanVault } from "./vault.ts";

const MAX_RESULTS = 100;

export const recentChanges: ScriptTool = {
  name: "recent_changes",
  description: "Notes in wiki/ and files in outputs/ changed in the last N days (today is day 1), newest first, as path, title and date. Optional dept filters to one department. Names only, never contents.",
  input: z.object({ days: z.number().int().min(1).max(60), dept: DeptArg }).strict(),
  inputSchema: {
    type: "object",
    properties: { days: { type: "integer", minimum: 1, maximum: 60 }, dept: { type: "string", description: "Department slug, for example industrial" } },
    required: ["days"],
    additionalProperties: false,
  },
  run(input, ctx) {
    const { days, dept } = input as { days: number; dept?: string };
    const check = checkDept(ctx.vault, dept);
    if (!check.ok) return { error: check.error };
    const today = localDate(ctx.now().getTime(), ctx.timezone);
    const since = dateMinus(today, days - 1);
    const { files, truncated } = scanVault(ctx.vault, ["wiki", "outputs"]);
    const changes: Array<{ path: string; title: string; date: string; ms: number }> = [];
    for (const f of files) {
      const name = f.rel.slice(f.rel.lastIndexOf("/") + 1);
      if (GENERATED.has(name)) continue;
      const isNote = f.top === "wiki";
      if (isNote && !name.toLowerCase().endsWith(".md")) continue;
      if (dept !== undefined && (isNote ? !f.rel.startsWith(`wiki/${dept}/`) : outputDept(name) !== dept)) continue;
      const date = localDate(f.mtimeMs, ctx.timezone);
      if (date < since || date > today) continue;
      let title = name.replace(/\.[^.]+$/, "");
      if (isNote) { try { title = parseFront(readHead(ctx.vault, f.rel)).title ?? title; } catch { /* unreadable: use the file name */ } }
      changes.push({ path: f.rel, title: clean(title), date, ms: f.mtimeMs });
    }
    changes.sort((a, b) => b.ms - a.ms || (a.path < b.path ? -1 : 1));
    return {
      today, since, days, total: changes.length, truncated: changes.length > MAX_RESULTS || truncated,
      changes: changes.slice(0, MAX_RESULTS).map(({ path, title, date }) => ({ path, title, date })),
    };
  },
};
