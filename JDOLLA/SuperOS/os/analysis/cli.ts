// npm run analyse:runs [-- --days 30]   Prints where the money went and what keeps failing. Read-only.
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, logDir, pathsFor } from "../bridge/config.ts";
import { formatReport } from "./format.ts";
import { statsFromLogDir, suggestChanges } from "./run-stats.ts";

const Days = z.coerce.number().int().min(1).max(365);

/** Returns the days asked for, or an error message. Accepts `--days 7` and `--days=7`; anything else is refused. */
export function parseArgs(argv: string[]): { days: number } | { error: string } {
  let days: unknown = 30;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--days") { days = argv[++i]; }
    else if (a.startsWith("--days=")) { days = a.slice(7); }
    else return { error: `Unknown option: ${a.slice(0, 30)}. Usage: npm run analyse:runs -- [--days 30]` };
  }
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
  const stats = statsFromLogDir(dir, new Date(), args.days);
  if (stats.problem) console.error(`Note: ${stats.problem}`);
  console.log(formatReport(stats, suggestChanges(stats, { routineMaxBudgetUsd: cfg.engine.routines.maxBudgetUsd, dailyCapUsd: cfg.engine.routines.dailyCapUsd, t2CapUsd: cfg.engine.t2.maxBudgetUsd })));
}
