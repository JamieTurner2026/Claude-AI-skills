// brain -- eval --graph (Phase 12b): graph re-rank off vs on, for the vault's own questions and the graph practice set.
// The practice set is invented notes in evals/brain/graph-practice/, indexed together with a copy of the vault's wiki/
// and raw/ in a temp folder (removed in finally), so the real notes are the distractors. Jay's index is only read.
import { cpSync, existsSync, lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { tryLoadEmbedder, type Embedder } from "./embeddings.ts";
import { distinctPaths, indexedPaths, loadEvalFile, runEval, type EvalFile, type EvalReport } from "./eval.ts";
import { embedIndex, graphSearch, MIN_SIMILARITY, RERANK_GATE, RERANK_LAMBDA, vectorCoverage, VECTORS_SQL, type RerankOptions } from "./hybrid.ts";
import { rebuildIndex } from "./indexer.ts";
import { openReadOnly } from "./search.ts";

export const PRACTICE_DIR = path.join("evals", "brain", "graph-practice");
export const PRACTICE_QUESTIONS = path.join("evals", "brain", "graph-questions.json");
/** λ in RRF-vote units (one rank step near the top is about 0.00027), gate as a share of the top score; Infinity = no gate. */
export const LAMBDAS = [0.00025, 0.0005, 0.001, 0.002, 0.003, 0.004] as const;
export const GATES = { keyword: [0.25, 0.5, 0.75, Infinity], hybrid: [0.05, 0.1, 0.25, Infinity] } as const;

const copyable = (src: string): boolean => { const b = path.basename(src); return !b.startsWith(".") && !lstatSync(src).isSymbolicLink(); };

/**
 * Builds the practice index in `dir`: the vault's wiki/ and raw/, plus the practice notes on top. Vectors already
 * computed in `realDb` are copied (same model, same text, same key) so only the practice notes need embedding.
 */
export async function buildPracticeIndex(vault: string, dir: string, realDb: string | null, embedder: Embedder | null): Promise<string> {
  const v = path.join(dir, "vault");
  for (const root of ["wiki", "raw"]) {
    const from = path.join(vault, root);
    if (existsSync(from)) cpSync(from, path.join(v, root), { recursive: true, filter: copyable });
    const practice = path.join(vault, PRACTICE_DIR, root);
    if (existsSync(practice)) cpSync(practice, path.join(v, root), { recursive: true, filter: copyable });
  }
  const dbPath = path.join(dir, "practice.sqlite");
  rebuildIndex(v, dbPath);
  if (embedder) {
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(VECTORS_SQL);
      if (realDb && existsSync(realDb)) {
        db.prepare("ATTACH DATABASE ? AS real").run(realDb);
        try {
          if (db.prepare("SELECT 1 FROM real.sqlite_master WHERE type = 'table' AND name = 'vectors'").get()) db.exec("INSERT OR IGNORE INTO vectors SELECT * FROM real.vectors");
        } finally { db.exec("DETACH DATABASE real"); }
      }
      await embedIndex(db, embedder);
    } finally { db.close(); }
  }
  return dbPath;
}

export interface Config { label: string; graph: boolean; opts: RerankOptions }
export interface SweepRow { config: Config; text: EvalReport; graph: EvalReport; allMrr: number; textDrops: string[]; trapDrops: string[]; passes: boolean }
export interface ModeSweep { mode: "keyword" | "hybrid"; off: SweepRow; rows: SweepRow[]; best: SweepRow | null }
export interface GraphSweep { note: string; k: number; modes: ModeSweep[]; chosen: { lambda: number; gate: { keyword: number; hybrid: number } }; verdict: string }
const shippedRow = (m: ModeSweep, c: GraphSweep["chosen"]): SweepRow | undefined => m.rows.find((r) => r.config.opts.lambda === c.lambda && r.config.opts.gate === c.gate[m.mode]);

const TRAPS = new Set(["g11", "g12"]);
const worse = (a: number | null, b: number | null): boolean => (a === null ? false : b === null || b > a);
const allMrr = (a: EvalReport, b: EvalReport): number => (a.mrr * a.questions + b.mrr * b.questions) / (a.questions + b.questions);

/**
 * Runs both question sets under graph off and every (λ, gate) on the grid. A config passes when graph-kind hit@k and
 * MRR both rise, no question of the vault's own set gets a worse rank, and MRR over both sets doesn't fall.
 */
export async function sweepGraph(vault: string, dbPath: string, k: number, opts: { embedder?: Embedder | null; questions?: EvalFile; practice?: EvalFile } = {}): Promise<GraphSweep> {
  const text = opts.questions ?? loadEvalFile(path.join(vault, "evals", "brain", "questions.json"));
  const practice = opts.practice ?? loadEvalFile(path.join(vault, PRACTICE_QUESTIONS));
  const e = opts.embedder === undefined ? await tryLoadEmbedder() : { embedder: opts.embedder, note: opts.embedder ? `embeddings: ${opts.embedder.id}` : "embeddings unavailable; keyword search only" };
  const dir = mkdtempSync(path.join(tmpdir(), "brain-graph-eval-"));
  try {
    const realDb = openReadOnly(dbPath);
    const embedder = e.embedder && vectorCoverage(realDb, e.embedder.id) >= 1 ? e.embedder : null;
    realDb.close();
    const pDbPath = await buildPracticeIndex(vault, dir, dbPath, embedder);
    const vecs = new Map<string, Float32Array>();
    if (embedder) {
      const qs = [...text.questions, ...practice.questions].map((q) => q.query);
      (await embedder.embed(qs)).forEach((v, i) => vecs.set(qs[i]!, v));
    }
    const real = openReadOnly(dbPath), prac = openReadOnly(pDbPath);
    try {
      const modes: ModeSweep[] = [];
      for (const mode of embedder ? (["keyword", "hybrid"] as const) : (["keyword"] as const)) {
        const run = (db: DatabaseSync, file: EvalFile, c: Config) => runEval(file, (query) => {
          const v = mode === "hybrid" ? vecs.get(query) : undefined;
          return distinctPaths(graphSearch(db, { query, limit: 50 }, v && embedder ? { model: embedder.id, vector: v } : null, c.graph, MIN_SIMILARITY, c.opts).map((h) => h.path));
        }, k, indexedPaths(db));
        const configs: Config[] = [{ label: "off", graph: false, opts: {} }];
        for (const gate of GATES[mode]) for (const lambda of LAMBDAS) configs.push({ label: `λ ${lambda} gate ${gate === Infinity ? "none" : gate}`, graph: true, opts: { lambda, gate } });
        const rows: SweepRow[] = [];
        let off: SweepRow | null = null;
        for (const c of configs) {
          const t = run(real, text, c), g = run(prac, practice, c);
          const r: SweepRow = { config: c, text: t, graph: g, allMrr: allMrr(t, g), textDrops: [], trapDrops: [], passes: false };
          if (off) {
            r.textDrops = t.results.filter((x, i) => worse(off!.text.results[i]!.rank, x.rank)).map((x, i) => `${x.id} ${off!.text.results.find((o) => o.id === x.id)!.rank ?? "-"}→${x.rank ?? "-"}`);
            r.trapDrops = g.results.filter((x, i) => TRAPS.has(x.id) && worse(off!.graph.results[i]!.rank, x.rank)).map((x) => x.id);
            r.passes = g.hitAtK > off.graph.hitAtK && g.mrr > off.graph.mrr && !r.textDrops.length && r.allMrr >= off.allMrr;
            rows.push(r);
          } else off = r;
        }
        const best = rows.filter((r) => r.passes).sort((a, b) => b.allMrr - a.allMrr || b.graph.mrr - a.graph.mrr)[0] ?? null;
        modes.push({ mode, off: off!, rows, best });
      }
      const chosen = { lambda: RERANK_LAMBDA, gate: RERANK_GATE };
      const passingChosen = modes.every((m) => shippedRow(m, chosen)?.passes);
      const setting = `λ ${chosen.lambda}, keyword gate ${chosen.gate.keyword}, hybrid gate ${chosen.gate.hybrid}`;
      const verdict = passingChosen
        ? `the shipped setting (${setting}) passes in every mode measured: the re-rank may be turned on`
        : `the shipped setting (${setting}) does not pass in every mode measured: keep the re-rank off`;
      return { note: embedder ? e.note : `${e.note}; hybrid rows skipped`, k, modes, chosen, verdict };
    } finally { real.close(); prac.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const f3 = (n: number): string => n.toFixed(3);

export function formatSweep(s: GraphSweep): string {
  const lines = [s.note, `Graph re-rank sweep: vault questions (text) on your index, practice questions (graph) on a temp copy plus the practice notes.`];
  for (const m of s.modes) {
    lines.push("", `${m.mode}`, `  ${"setting".padEnd(26)} text hit@${s.k}/MRR   graph hit@${s.k}/MRR  all MRR  text drops  traps worse  passes`);
    for (const r of [m.off, ...m.rows]) {
      lines.push(`  ${r.config.label.padEnd(26)} ${f3(r.text.hitAtK)}/${f3(r.text.mrr)}    ${f3(r.graph.hitAtK)}/${f3(r.graph.mrr)}    ${f3(r.allMrr)}    ${String(r.textDrops.length).padStart(3)}        ${String(r.trapDrops.length).padStart(3)}        ${r === m.off ? "-" : r.passes ? "yes" : "no"}`);
    }
    lines.push(`  best passing: ${m.best ? m.best.config.label : "none"}`);
    const changed = (r: SweepRow) => r.graph.results.map((x, i) => [m.off.graph.results[i]!, x] as const).filter(([a, b]) => a.rank !== b.rank).map(([a, b]) => `${a.id} ${a.rank ?? "-"}→${b.rank ?? "-"}`);
    const shipped = shippedRow(m, s.chosen);
    const textChanged = (r: SweepRow) => r.text.results.map((x, i) => [m.off.text.results[i]!, x] as const).filter(([a, b]) => a.rank !== b.rank).map(([a, b]) => `${a.id} ${a.rank ?? "-"}→${b.rank ?? "-"}`);
    if (shipped) lines.push(`  shipped setting: graph questions ${changed(shipped).join(", ") || "unchanged"}; vault questions ${textChanged(shipped).join(", ") || "unchanged"}`);
    lines.push(`  graph off ranks: ${m.off.graph.results.map((x) => `${x.id} ${x.rank ?? "-"}`).join(", ")}`);
  }
  lines.push("", `Verdict: ${s.verdict}.`);
  return lines.join("\n");
}
