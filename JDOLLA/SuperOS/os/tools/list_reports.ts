// list_reports: reports/ newest first, as name, skill and date. Names only, never contents.
// Report files are named YYYY-MM-DD_<skill>[-vN].md by the bridge; anything else shows skill null.
import { z } from "zod";
import type { ScriptTool } from "./registry.ts";
import { localDate, scanVault } from "./vault.ts";

export const listReports: ScriptTool = {
  name: "list_reports",
  description: "The newest reports in reports/, newest first, as file name, the skill that wrote it, and its date. Names only, never contents.",
  input: z.object({ limit: z.number().int().min(1).max(50) }).strict(),
  inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 } }, required: ["limit"], additionalProperties: false },
  run(input, ctx) {
    const { limit } = input as { limit: number };
    const { files, truncated } = scanVault(ctx.vault, ["reports"]);
    const reports = files
      .filter((f) => f.rel.toLowerCase().endsWith(".md") && f.rel.slice(f.rel.lastIndexOf("/") + 1) !== "_index.md")
      .map((f) => {
        const name = f.rel.slice("reports/".length);
        const m = /^(\d{4}-\d{2}-\d{2})_(.+?)(?:-v\d+)?\.md$/i.exec(name);
        const version = Number(/-v(\d+)\.md$/i.exec(name)?.[1] ?? 1);
        return { name, skill: m?.[2] ?? null, date: m?.[1] ?? localDate(f.mtimeMs, ctx.timezone), version };
      })
      // Newest first: by date, then -v3 before -v2 before the original, then by name.
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.version - a.version || (a.name < b.name ? 1 : -1)))
      .map(({ name, skill, date }) => ({ name, skill, date }));
    return { total: reports.length, truncated: reports.length > limit || truncated, reports: reports.slice(0, limit) };
  },
};
