// vault CLI: npm run vault -- build [--dry-run]
import path from "node:path";
import { parseArgs } from "node:util";
import { pathsFor } from "../bridge/config.ts";
import { buildAll } from "./generate.ts";

const USAGE = "usage: vault build [--dry-run]\n  build            write the generated files (indexes, project hubs, today's daily note)\n  build --dry-run  show what would be written, write nothing";

function main(argv: string[]): number {
  let parsed;
  try { parsed = parseArgs({ args: argv, allowPositionals: true, options: { "dry-run": { type: "boolean" } } }); } catch { console.error(USAGE); return 2; }
  if (parsed.positionals.length !== 1 || parsed.positionals[0] !== "build") { console.error(USAGE); return 2; }
  const paths = pathsFor(path.resolve(import.meta.dirname, ".."));
  try {
    const r = buildAll(paths, new Date(), { dryRun: parsed.values["dry-run"] === true });
    const verb = (a: string): string => (r.dryRun ? (a === "create" ? "would create" : a === "update" ? "would update" : a) : a === "create" ? "created" : a === "update" ? "updated" : a);
    for (const f of r.files) console.log(`${verb(f.action).padEnd(12)} ${f.path}${f.reason ? `  (${f.reason})` : ""}`);
    const c = r.counts;
    console.log(`${r.dryRun ? "dry run, nothing written: " : ""}${c.create} ${r.dryRun ? "to create" : "created"}, ${c.update} ${r.dryRun ? "to update" : "updated"}, ${c.unchanged} unchanged, ${c.skipped} skipped (${r.date})`);
    return 0;
  } catch (e) {
    console.error(`vault: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
