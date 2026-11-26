// CLI paths that touch embeddings: index --embeddings (the only one that may download), search --hybrid, eval --compare.
import { DatabaseSync } from "node:sqlite";
import { embeddingsDir, installRuntime, installedRuntimeVersion, loadLocalEmbedder, pinnedRuntimeVersion, runtimeState, tryLoadEmbedder, type Embedder } from "./embeddings.ts";
import { formatReport, indexedPaths, keywordRanker, runEval, type EvalFile, type EvalReport } from "./eval.ts";
import { embedIndex, graphSearch, hybridSearch, vectorCoverage } from "./hybrid.ts";
import { rebuildIndex } from "./indexer.ts";
import { openReadOnly, type SearchHit, type SearchInput } from "./search.ts";
import { distinctPaths } from "./eval.ts";

/** Opt-in setup: installs the pinned runtime and downloads the model if needed, then embeds every chunk. */
export async function indexWithEmbeddings(vault: string, dbPath: string, embedder?: Embedder): Promise<void> {
  const s = rebuildIndex(vault, dbPath);
  console.log(`indexed ${s.files} files, ${s.chunks} chunks${s.recreated ? " [new index]" : ""}`);
  const base = embeddingsDir();
  if (!embedder) {
    const state = runtimeState(base);
    if (state === "outdated") { console.log(`updating the embedding runtime in ${base} from transformers ${installedRuntimeVersion(base)} to ${pinnedRuntimeVersion()} (a few hundred MB; vectors from the old runtime are replaced, never mixed)`); installRuntime(base); }
    else if (state === "missing") { console.log(`installing the embedding runtime into ${base} (one time, a few hundred MB)`); installRuntime(base); }
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

export interface GraphComparison { rows: { label: string; report: EvalReport }[]; note: string }

/** Graph off vs on, for keyword search and (when embeddings are set up) hybrid search. Same questions, same index. */
export async function compareGraph(file: EvalFile, dbPath: string, k: number, embedder?: Embedder | null): Promise<GraphComparison> {
  const e = embedder === undefined ? await tryLoadEmbedder() : { embedder, note: embedder ? `embeddings: ${embedder.id}` : "embeddings unavailable; keyword search only" };
  const db = openReadOnly(dbPath);
  try {
    const known = indexedPaths(db);
    let vec: ((q: string) => { model: string; vector: Float32Array } | null) | null = null;
    if (e.embedder && vectorCoverage(db, e.embedder.id) >= 1) {
      const vecs = await e.embedder.embed(file.questions.map((q) => q.query));
      const byQuery = new Map(file.questions.map((q, i) => [q.query, vecs[i]!]));
      const model = e.embedder.id;
      vec = (q) => { const v = byQuery.get(q); return v ? { model, vector: v } : null; };
    }
    const ranker = (graph: boolean, withVec: boolean) => (query: string) => distinctPaths(graphSearch(db, { query, limit: 50 }, withVec && vec ? vec(query) : null, graph).map((h) => h.path));
    const rows = [
      { label: "keyword", report: runEval(file, ranker(false, false), k, known) },
      { label: "keyword+graph", report: runEval(file, ranker(true, false), k, known) },
      ...(vec ? [{ label: "hybrid", report: runEval(file, ranker(false, true), k, known) }, { label: "hybrid+graph", report: runEval(file, ranker(true, true), k, known) }] : []),
    ];
    return { rows, note: vec ? e.note : `${e.note}; hybrid rows skipped` };
  } finally { db.close(); }
}

export function formatGraphComparison(c: GraphComparison): string {
  const k = c.rows[0]!.report.k;
  const lines = [c.note, `  ${"ranker".padEnd(14)} hit@1  hit@${k}  MRR    (by style: hit@${k})`];
  for (const { label, report: r } of c.rows) {
    const at1 = r.results.filter((x) => x.rank === 1).length / r.questions;
    lines.push(`  ${label.padEnd(14)} ${f3(at1)}  ${f3(r.hitAtK)}  ${f3(r.mrr)}  ${Object.entries(r.byStyle).map(([s, b]) => `${s} ${f3(b.hitAtK)}`).join(", ")}`);
  }
  // Every question whose rank changed when the graph was switched on.
  for (let i = 0; i + 1 < c.rows.length; i += 2) {
    const off = c.rows[i]!.report, on = c.rows[i + 1]!.report;
    const changed = off.results.map((a, j) => [a, on.results[j]!] as const).filter(([a, b]) => a.rank !== b.rank).map(([a, b]) => `${a.id} ${a.rank ?? "-"}→${b.rank ?? "-"}`);
    lines.push(`  ${c.rows[i + 1]!.label} vs ${c.rows[i]!.label}: ${changed.length ? changed.join(", ") : "no question changed rank"}`);
  }
  return lines.join("\n");
}
