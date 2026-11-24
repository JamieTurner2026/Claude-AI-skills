// brain import-mail [--dry-run] [--vault <dir>] [--ledger <file>]
import path from "node:path";
import { parseArgs } from "node:util";
import { loadConfig, logDir, pathsFor } from "../bridge/config.ts";
import { importMail } from "./mail-import.ts";

export function runMailCommand(argv: string[]): number {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, allowPositionals: false, options: { "dry-run": { type: "boolean" }, vault: { type: "string" }, ledger: { type: "string" } } }));
  } catch (e) { console.error(`import-mail: ${e instanceof Error ? e.message : String(e)}`); return 2; }
  const osDir = path.resolve(import.meta.dirname, "..");
  const paths = pathsFor(osDir);
  const vault = values.vault ?? process.env["SUPEROS_VAULT"] ?? paths.vault;
  const ledgerPath = values.ledger ?? path.join(logDir(paths), "mail-import.json");
  let tz = "America/New_York";
  try { tz = loadConfig(paths).timezones[0] ?? tz; } catch { /* default zone */ }
  const dryRun = values["dry-run"] === true;
  try {
    const r = importMail({ vault, ledgerPath, dryRun, tz });
    if (r.problem) console.error(`mail feed: ${r.problem}`);
    let fresh = 0, dup = 0, red = 0;
    for (const it of r.items) {
      if (it.status === "already-imported") { dup++; continue; }
      fresh++; red += it.redactions;
      console.log(`${dryRun ? "would write" : "wrote"} ${it.file}  [redacted ${it.redactions}]`);
    }
    console.log(`${dryRun ? "DRY RUN, nothing written. " : ""}${fresh} new, ${dup} already imported, ${red} redactions${r.dropped ? `, ${r.dropped} feed items skipped (not labelled Brain, or malformed)` : ""}.`);
    if (!dryRun && fresh) console.log("Run `npm run brain -- index` to make them searchable (runs do this on their own).");
    return 0;
  } catch (e) { console.error(`import-mail: ${e instanceof Error ? e.message : String(e)}`); return 1; }
}
