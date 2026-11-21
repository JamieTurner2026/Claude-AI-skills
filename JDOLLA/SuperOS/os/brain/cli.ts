// brain CLI: index | search <query> | get <path> | stats | eval | import-sessions.   npm run brain -- search "servo alarm"
import path from "node:path";
import { parseArgs } from "node:util";
import { GuardError } from "../bridge/guards.ts";
import { readBrainFile } from "./files.ts";
import { defaultIndexPath, rebuildIndex } from "./indexer.ts";
import { fence } from "./present.ts";
import { indexCounts, openReadOnly, search } from "./search.ts";
import { isTrusted } from "./files.ts";
import { runImportCommand } from "./import-cli.ts";
import { compareEval, formatComparison, hybridSearchCli, indexWithEmbeddings } from "./embed-cli.ts";
import { formatReport, indexedPaths, keywordRanker, loadEvalFile, runEval } from "./eval.ts";
import { formatUsage, readUsage, summarizeUsage, usagePathFor } from "./usage.ts";

const USAGE = `usage: brain <index|search|get|stats|eval|usage|import-sessions> [args]
  index [--embeddings]   rebuild the index from wiki/ and raw/; --embeddings also sets up local meaning
                         search (one-time download, files in ~/.superos/brain/embeddings)
  search <query> [--dept d] [--limit n] [--trusted] [--json] [--hybrid]
  get <vault-path>       print one note
  eval [--k 5] [--questions <file>] [--json] [--compare]   (--compare: keyword vs hybrid)
                         retrieval eval: hit@k and MRR (default questions: <vault>/evals/brain/questions.json)
  usage [--json]         which notes runs opened (get_note), and wiki notes never opened; reads only
  import-sessions [--claude-code <dir>] [--claude-ai <conversations.json>] [--dry-run]
                         import past sessions into raw/sessions/ (redacted, never overwritten)
  --vault <dir>  --db <file>   (defaults: this vault, ~/.superos/brain/index.sqlite)`;

async function main(argv: string[]): Promise<number> {
  if (argv[0] === "import-sessions") return runImportCommand(argv.slice(1));
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: { vault: { type: "string" }, db: { type: "string" }, dept: { type: "string" }, limit: { type: "string" }, trusted: { type: "boolean" }, json: { type: "boolean" }, k: { type: "string" }, questions: { type: "string" }, embeddings: { type: "boolean" }, hybrid: { type: "boolean" }, compare: { type: "boolean" } },
  });
  const [cmd, ...rest] = positionals;
  const vault = values.vault ?? process.env["SUPEROS_VAULT"] ?? path.resolve(import.meta.dirname, "../..");
  const dbPath = values.db ?? process.env["SUPEROS_BRAIN_DB"] ?? defaultIndexPath();
  try {
    if (cmd === "index" && values.embeddings) { await indexWithEmbeddings(vault, dbPath); return 0; }
    if (cmd === "index") {
      const s = rebuildIndex(vault, dbPath);
      console.log(`indexed ${s.files} files, ${s.chunks} chunks (${s.untrustedFiles} untrusted raw/ files, ${s.skipped} skipped)${s.recreated ? " [new index]" : ""}\n${dbPath}`);
      return 0;
    }
    if (cmd === "search") {
      const query = rest.join(" ");
      const input = { query, ...(values.dept ? { dept: values.dept } : {}), ...(values.limit ? { limit: Number(values.limit) } : {}), trustedOnly: values.trusted === true };
      const pre = values.hybrid ? await hybridSearchCli(dbPath, input) : null;
      const db = openReadOnly(dbPath);
      try {
        const hits = pre ?? search(db, input);
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
    if (cmd === "eval") {
      const file = loadEvalFile(values.questions ?? path.join(vault, "evals", "brain", "questions.json"));
      const k = values.k ? Number(values.k) : 5;
      if (values.compare) {
        const c = await compareEval(file, dbPath, k);
        console.log(values.json ? JSON.stringify(c, null, 2) : formatComparison(c));
        return c.keyword.unknownPaths.length ? 1 : 0;
      }
      const db = openReadOnly(dbPath);
      try {
        const report = runEval(file, keywordRanker(db), k, indexedPaths(db));
        console.log(values.json ? JSON.stringify({ ranker: "keyword", ...report }, null, 2) : formatReport(report, "keyword"));
        return report.unknownPaths.length ? 1 : 0;
      } finally { db.close(); }
    }
    if (cmd === "usage") {
      let known: string[] = [];
      try { const db = openReadOnly(dbPath); try { known = [...indexedPaths(db)]; } finally { db.close(); } } catch { /* no index: list used notes only */ }
      const s = summarizeUsage(readUsage(usagePathFor(dbPath)), known);
      console.log(values.json ? JSON.stringify(s, null, 2) : formatUsage(s));
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

process.exitCode = await main(process.argv.slice(2));
