// npm run analyse:runs [-- --days 30]        Prints where the money went and what keeps failing. Read-only.
// npm run analyse:runs -- --month [YYYY-MM]  Totals a calendar month (Jay's time zone; default: this month). Costs and counts only.
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, logDir, pathsFor } from "../bridge/config.ts";
import { formatReport } from "./format.ts";
import { MONTH, currentMonth, formatMonth, monthFromLogDir } from "./month.ts";
import { statsFromLogDir, suggestChanges } from "./run-stats.ts";

const Days = z.coerce.number().int().min(1).max(365);
const USAGE = "Usage: npm run analyse:runs -- [--days 30 | --month [YYYY-MM]]";

/** `month: null` means "this month". `--days` and `--month` cannot be mixed. */
export function parseArgs(argv: string[]): { days: number } | { month: string | null } | { error: string } {
  let days: unknown = 30;
  let daysSet = false;
  let month: string | null | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--days") { days = argv[++i]; daysSet = true; }
    else if (a.startsWith("--days=")) { days = a.slice(7); daysSet = true; }
    else if (a === "--month") {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) { month = next; i++; } else month = null;
      if (month !== null && !MONTH.test(month)) return { error: "--month must look like 2026-11 (a year, a dash and a month from 01 to 12)." };
    }
    else if (a.startsWith("--month=")) { month = a.slice(8); if (!MONTH.test(month)) return { error: "--month must look like 2026-11 (a year, a dash and a month from 01 to 12)." }; }
    else return { error: `Unknown option: ${a.slice(0, 30)}. ${USAGE}` };
  }
  if (month !== undefined) return daysSet ? { error: `Use --days or --month, not both. ${USAGE}` } : { month };
  if (typeof days === "string" && !/^\d{1,3}$/.test(days)) return { error: "--days must be a whole number from 1 to 365." };
  const d = Days.safeParse(days);
  return d.success ? { days: d.data } : { error: "--days must be a whole number from 1 to 365." };
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  if ("error" in args) { console.error(args.error); process.exit(2); }
  const paths = pathsFor(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const cfg = loadConfig(paths);
  const dir = logDir(paths);
  if ("month" in args) {
    const tz = cfg.timezones[0] ?? "America/New_York";
    const now = new Date();
    const stats = monthFromLogDir(dir, args.month ?? currentMonth(now, tz), tz, now, { routineDailyCapUsd: cfg.engine.routines.dailyCapUsd, learningDailyCapUsd: cfg.engine.learning.dailyCapUsd });
    if (stats.problem) console.error(`Note: ${stats.problem}`);
    console.log(formatMonth(stats));
  } else {
    const stats = statsFromLogDir(dir, new Date(), args.days);
    if (stats.problem) console.error(`Note: ${stats.problem}`);
    console.log(formatReport(stats, suggestChanges(stats, { routineMaxBudgetUsd: cfg.engine.routines.maxBudgetUsd, dailyCapUsd: cfg.engine.routines.dailyCapUsd, t2CapUsd: cfg.engine.t2.maxBudgetUsd })));
  }
}
