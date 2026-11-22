// npm run backup [-- --dry-run]
//   --dry-run  lists what would be committed and pushes nothing.
//   (no flag)  commits the allowed vault content and pushes it to engine.backup.remote.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, logDir, pathsFor } from "../bridge/config.ts";
import { runBackup } from "./backup.ts";
import { writeBackupRecord } from "./record.ts";

export function parseArgs(argv: string[]): { dryRun: boolean } | { error: string } {
  let dryRun = false;
  for (const a of argv) {
    if (a === "--dry-run") dryRun = true;
    else return { error: `Unknown option: ${a.slice(0, 30)}. Usage: npm run backup -- [--dry-run]` };
  }
  return { dryRun };
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  if ("error" in args) { console.error(args.error); process.exit(2); }
  const paths = pathsFor(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const cfg = loadConfig(paths);
  const now = new Date();
  const r = await runBackup({ vault: paths.vault, remote: cfg.engine.backup.remote, branch: cfg.engine.backup.branch, timezone: cfg.timezones[0] ?? "America/New_York", now, dryRun: args.dryRun });
  if (!args.dryRun) writeBackupRecord(logDir(paths), r, now);
  console.log(r.message);
  for (const f of r.files) console.log(`  ${f.change.padEnd(8)} ${f.path}`);
  process.exit(r.status === "failed" ? 1 : r.status === "refused" ? 2 : 0);
}
