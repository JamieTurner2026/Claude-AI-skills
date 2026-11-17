// brain CLI: index | search <query> | get <path> | stats.   npm run brain -- search "servo alarm"
import path from "node:path";
import { parseArgs } from "node:util";
import { GuardError } from "../bridge/guards.ts";
import { readBrainFile } from "./files.ts";
import { defaultIndexPath, rebuildIndex } from "./indexer.ts";
import { fence } from "./present.ts";
import { indexCounts, openReadOnly, search } from "./search.ts";
import { isTrusted } from "./files.ts";

const USAGE = `usage: brain <index|search|get|stats> [args]
  index                  rebuild the index from wiki/ and raw/
  search <query> [--dept d] [--limit n] [--trusted] [--json]
  get <vault-path>       print one note
  --vault <dir>  --db <file>   (defaults: this vault, ~/.superos/brain/index.sqlite)`;

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: { vault: { type: "string" }, db: { type: "string" }, dept: { type: "string" }, limit: { type: "string" }, trusted: { type: "boolean" }, json: { type: "boolean" } },
  });
  const [cmd, ...rest] = positionals;
  const vault = values.vault ?? process.env["SUPEROS_VAULT"] ?? path.resolve(import.meta.dirname, "../..");
  const dbPath = values.db ?? process.env["SUPEROS_BRAIN_DB"] ?? defaultIndexPath();
  try {
    if (cmd === "index") {
      const s = rebuildIndex(vault, dbPath);
      console.log(`indexed ${s.files} files, ${s.chunks} chunks (${s.untrustedFiles} untrusted raw/ files, ${s.skipped} skipped)${s.recreated ? " [new index]" : ""}\n${dbPath}`);
      return 0;
    }
    if (cmd === "search") {
      const query = rest.join(" ");
      const db = openReadOnly(dbPath);
      try {
        const hits = search(db, { query, ...(values.dept ? { dept: values.dept } : {}), ...(values.limit ? { limit: Number(values.limit) } : {}), trustedOnly: values.trusted === true });
        if (values.json) console.log(JSON.stringify(hits.map((h) => ({ ...h, snippet: fence(h.snippet, h.trusted, h.path) })), null, 2));
        else if (!hits.length) console.log("no results");
        else for (const h of hits) console.log(`${h.trusted ? "  " : "! "}${h.path}  [${h.dept}/${h.type}]  ${h.heading}\n    ${h.snippet.replace(/\s+/g, " ")}`);
      } finally { db.close(); }
      return 0;
    }
    if (cmd === "get") {
      const rel = rest[0] ?? "";
      const { text } = readBrainFile(vault, rel);
      console.log(fence(text, isTrusted(rel.replace(/\\/g, "/")), rel));
      return 0;
    }
    if (cmd === "stats") {
      const db = openReadOnly(dbPath);
      try { console.log(JSON.stringify(indexCounts(db))); } finally { db.close(); }
      return 0;
    }
    console.error(USAGE);
    return 2;
  } catch (e) {
    if (e instanceof GuardError) { console.error(e.message); return 1; }
    const m = e instanceof Error ? e.message : String(e);
    console.error(/unable to open|integrity|schema|no such|malformed|not a database/i.test(m) ? "Index missing or damaged. Run: npm run brain -- index" : `brain: ${m}`);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
