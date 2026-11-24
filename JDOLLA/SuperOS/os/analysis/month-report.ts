// The month-costs routine's work: compute last month's costs and write reports/YYYY-MM_costs.md. No model, no cost.
// Never overwrites: a second report for the same month becomes -v2, -v3 ...; the write goes through the vault generators'
// guarded path check (only under reports/, real paths, no links out).
import { closeSync, mkdirSync, openSync, realpathSync, writeSync } from "node:fs";
import path from "node:path";
import { safeTarget } from "../vault/generate.ts";
import { formatMonth, monthFromLogDir, previousMonth, currentMonth } from "./month.ts";
import type { MonthCaps } from "./month.ts";

export type MonthReportResult = { status: "done" | "nothing" | "failed"; message: string; rel: string | null };

export function writeMonthReport(o: { vault: string; logDir: string; timezone: string; now: Date; caps: MonthCaps; month?: string }): MonthReportResult {
  try {
    const month = o.month ?? previousMonth(currentMonth(o.now, o.timezone)); // run on the 1st: the month that just ended
    const stats = monthFromLogDir(o.logDir, month, o.timezone, o.now, o.caps);
    if (stats.empty) return { status: "nothing", message: `No runs were logged in ${month}, so no report was written.`, rel: null };
    const text = `<!-- Written by the month-costs routine. Costs and counts only: no prompt or file name. -->\n\n${formatMonth(stats)}\n`;
    const vaultReal = realpathSync(o.vault);
    for (let v = 1; v <= 50; v++) {
      const rel = `reports/${month}_costs${v === 1 ? "" : `-v${v}`}.md`;
      const abs = safeTarget(vaultReal, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      try {
        const fd = openSync(abs, "wx"); // fails if it exists: never overwrites
        try { writeSync(fd, text); } finally { closeSync(fd); }
        return { status: "done", message: `Wrote ${rel} (${stats.totals.costUsd.toFixed(2)} USD over ${stats.totals.runs} runs).`, rel };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw e;
      }
    }
    return { status: "failed", message: `There are already 50 cost reports for ${month}; none was written.`, rel: null };
  } catch (e) {
    return { status: "failed", message: `The cost report could not be written: ${(e instanceof Error ? e.message : "unknown").replace(/[\r\n]+/g, " ").slice(0, 120)}`, rel: null };
  }
}
