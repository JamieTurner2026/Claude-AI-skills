// npm run analyse:learning [-- --days 30] [--json]   Learning-loop scorecard. Read-only.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { formatLearning, learningStats } from "./learning.ts";

const Days = z.coerce.number().int().min(1).max(365);
const USAGE = "Usage: npm run analyse:learning -- [--days 30] [--json]";

/** No --days means every proposal. Accepts `--days 7`, `--days=7` and `--json`; anything else is refused. */
export function parseLearningArgs(argv: string[]): { days: number | null; json: boolean } | { error: string } {
  let days: unknown = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--days") days = argv[++i] ?? "";
    else if (a.startsWith("--days=")) days = a.slice(7);
    else if (a === "--json") json = true;
    else return { error: `Unknown option: ${a.slice(0, 30)}. ${USAGE}` };
  }
  if (days === null) return { days: null, json };
  if (typeof days !== "string" || !/^\d{1,3}$/.test(days)) return { error: "--days must be a whole number from 1 to 365." };
  const d = Days.safeParse(days);
  return d.success ? { days: d.data, json } : { error: "--days must be a whole number from 1 to 365." };
}

if (import.meta.main) {
  const args = parseLearningArgs(process.argv.slice(2));
  if ("error" in args) { console.error(args.error); process.exit(2); }
  const vault = process.env["SUPEROS_VAULT"] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const stats = learningStats(vault, new Date(), args.days);
  console.log(args.json ? JSON.stringify(stats, null, 2) : formatLearning(stats));
}
