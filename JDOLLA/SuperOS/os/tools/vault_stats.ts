// vault_stats: counts per folder and department, wiki notes with no sources, and notes not updated in 60 days.
// Counts, names and dates only; never a body.
import { z } from "zod";
import type { ScriptTool } from "./registry.ts";
import { DateOnly, GENERATED, TOP_FOLDERS, daysBetween, knownDepts, localDate, outputDept, parseFront, readHead, scanVault } from "./vault.ts";

const STALE_DAYS = 60;
const LIST_CAP = 50;

export const vaultStats: ScriptTool = {
  name: "vault_stats",
  description: "Counts of files per folder and per department, wiki notes with no sources, and notes not updated in 60 days. Counts, file names and dates only, never contents.",
  input: z.object({}).strict(),
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  run(_input, ctx) {
    const today = localDate(ctx.now().getTime(), ctx.timezone);
    const { files, truncated } = scanVault(ctx.vault, TOP_FOLDERS);
    const folders: Record<string, number> = Object.fromEntries(TOP_FOLDERS.map((t) => [t, 0]));
    for (const f of files) folders[f.top] = (folders[f.top] ?? 0) + 1;
    const depts = knownDepts(ctx.vault).map((slug) => ({
      slug,
      wiki: files.filter((f) => f.rel.startsWith(`wiki/${slug}/`) && !GENERATED.has(f.rel.slice(f.rel.lastIndexOf("/") + 1))).length,
      raw: files.filter((f) => f.rel.startsWith(`raw/${slug}/`)).length,
      outputs: files.filter((f) => f.top === "outputs" && outputDept(f.rel.slice(f.rel.lastIndexOf("/") + 1)) === slug).length,
    }));
    // Notes: wiki markdown, except the generated indexes and the directives checklist (not a distilled note).
    const notes = files.filter((f) => f.top === "wiki" && f.rel.toLowerCase().endsWith(".md") && !GENERATED.has(f.rel.slice(f.rel.lastIndexOf("/") + 1)) && f.rel !== "wiki/directives.md");
    const noSources: string[] = [];
    const stale: Array<{ path: string; updated: string }> = [];
    let noSourcesTotal = 0;
    let staleTotal = 0;
    for (const f of notes) {
      let front: ReturnType<typeof parseFront> = {};
      try { front = parseFront(readHead(ctx.vault, f.rel)); } catch { /* unreadable: counts as no sources and uses the file date */ }
      if (!front.sources?.length) { noSourcesTotal++; if (noSources.length < LIST_CAP) noSources.push(f.rel); }
      const updated = front.updated && DateOnly.test(front.updated) ? front.updated : localDate(f.mtimeMs, ctx.timezone);
      if (daysBetween(updated, today) > STALE_DAYS) { staleTotal++; if (stale.length < LIST_CAP) stale.push({ path: f.rel, updated }); }
    }
    return {
      today, truncated, folders, departments: depts,
      notes: { total: notes.length, withoutSources: { count: noSourcesTotal, paths: noSources }, notUpdatedIn60Days: { count: staleTotal, notes: stale } },
    };
  },
};
