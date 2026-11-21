// CLI paths that touch embeddings: index --embeddings (the only one that may download), search --hybrid, eval --compare.
import { DatabaseSync } from "node:sqlite";
import { embeddingsDir, installRuntime, loadLocalEmbedder, runtimeInstalled, tryLoadEmbedder, type Embedder } from "./embeddings.ts";
import { formatReport, indexedPaths, keywordRanker, runEval, type EvalFile, type EvalReport } from "./eval.ts";
import { embedIndex, hybridSearch, vectorCoverage } from "./hybrid.ts";
import { rebuildIndex } from "./indexer.ts";
import { openReadOnly, type SearchHit, type SearchInput } from "./search.ts";
import { distinctPaths } from "./eval.ts";

/** Opt-in setup: installs the pinned runtime and downloads the model if needed, then embeds every chunk. */
export async function indexWithEmbeddings(vault: string, dbPath: string, embedder?: Embedder): Promise<void> {
  const s = rebuildIndex(vault, dbPath);
  console.log(`indexed ${s.files} files, ${s.chunks} chunks${s.recreated ? " [new index]" : ""}`);
  const base = embeddingsDir();
  if (!embedder) {
    if (!runtimeInstalled(base)) { console.log(`installing the embedding runtime into ${base} (one time, a few hundred MB)`); installRuntime(base); }
    console.log("loading the local model (first time: downloads about 23 MB)");
    embedder = await loadLocalEmbedder({ allowDownload: true, base });
  }
  const db = new DatabaseSync(dbPath);
  try {
    const t0 = Date.now();
    const e = await embedIndex(db, embedder);
    console.log(`embeddings: ${e.embedded} new, ${e.cached} cached, ${e.pruned} pruned (${e.chunks} chunks, ${embedder.id}, ${Date.now() - t0} ms)\nmodel and runtime: ${base}`);
  } finally { db.close(); }
}

/** Query vector for hybrid search, or null with a note (logged to stderr) when embeddings can't be used. */
export async function queryVector(dbPath: string, query: string, embedder?: Embedder | null): Promise<{ model: string; vector: Float32Array } | null> {
  const e = embedder === undefined ? await tryLoadEmbedder() : { embedder, note: "" };
  if (!e.embedder) { console.error(`brain: ${e.note}`); return null; }
  const db = openReadOnly(dbPath);
  try {
    if (vectorCoverage(db, e.embedder.id) === 0) { console.error("brain: the index has no vectors yet (run: npm run brain -- index --embeddings); keyword search only"); return null; }
  } finally { db.close(); }
  const [vector] = await e.embedder.embed([query]);
  return vector ? { model: e.embedder.id, vector } : null;
}

export async function hybridSearchCli(dbPath: string, input: SearchInput, embedder?: Embedder | null): Promise<SearchHit[]> {
  const q = await queryVector(dbPath, input.query, embedder);
  const db = openReadOnly(dbPath);
  try { return hybridSearch(db, input, q); } finally { db.close(); }
}

export interface Comparison { keyword: EvalReport; hybrid: EvalReport | null; note: string }

/** Runs the eval with keyword search and, when embeddings are available, with hybrid search on the same set. */
export async function compareEval(file: EvalFile, dbPath: string, k: number, embedder?: Embedder | null): Promise<Comparison> {
  const e = embedder === undefined ? await tryLoadEmbedder() : { embedder, note: embedder ? `embeddings: ${embedder.id}` : "embeddings unavailable; keyword search only" };
  const db = openReadOnly(dbPath);
  try {
    const known = indexedPaths(db);
    const keyword = runEval(file, keywordRanker(db), k, known);
    if (!e.embedder) return { keyword, hybrid: null, note: e.note };
    const cov = vectorCoverage(db, e.embedder.id);
    if (cov < 1) return { keyword, hybrid: null, note: `vectors cover ${(cov * 100).toFixed(0)}% of chunks (run: npm run brain -- index --embeddings); hybrid not scored` };
    const vecs = await e.embedder.embed(file.questions.map((q) => q.query));
    const byQuery = new Map(file.questions.map((q, i) => [q.query, vecs[i]!]));
    const model = e.embedder.id;
    const hybrid = runEval(file, (query) => {
      const v = byQuery.get(query);
      return distinctPaths(hybridSearch(db, { query, limit: 50 }, v ? { model, vector: v } : null).map((h) => h.path));
    }, k, known);
    return { keyword, hybrid, note: e.note };
  } finally { db.close(); }
}

const f3 = (n: number): string => n.toFixed(3);
const delta = (a: number, b: number): string => `${b - a >= 0 ? "+" : ""}${(b - a).toFixed(3)}`;

export function formatComparison(c: Comparison): string {
  if (!c.hybrid) return `${formatReport(c.keyword, "keyword")}\n${c.note}`;
  const k = c.keyword.k;
  const rows = [["all", c.keyword, c.hybrid] as const, ...Object.keys(c.keyword.byStyle).map((s) => [s, c.keyword.byStyle[s]!, c.hybrid!.byStyle[s]!] as const)];
  const lines = [`${c.note}`, `             keyword hit@${k} / MRR    hybrid hit@${k} / MRR    change`];
  for (const [name, a, b] of rows) lines.push(`  ${name.padEnd(10)}  ${f3(a.hitAtK)} / ${f3(a.mrr)}        ${f3(b.hitAtK)} / ${f3(b.mrr)}        ${delta(a.hitAtK, b.hitAtK)} / ${delta(a.mrr, b.mrr)}`);
  return `${lines.join("\n")}\n\n${formatReport(c.hybrid, "hybrid")}`;
}
