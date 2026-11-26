// Brain retrieval eval: hit@k and MRR over evals/brain/questions.json.
// A "ranker" turns a query into vault paths, best first. Keyword search is one ranker; 7a adds hybrid.
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { search } from "./search.ts";

export const EvalFile = z.object({
  version: z.literal(1),
  about: z.string().optional(),
  questions: z.array(z.object({
    id: z.string().regex(/^[\w-]{1,40}$/),
    style: z.enum(["keyword", "paraphrase", "synonym"]),
    /** "graph": the answer is reached through a link or shared source from the note the words match (12b practice set). */
    kind: z.enum(["text", "graph"]).optional(),
    query: z.string().min(1).max(300),
    relevant: z.array(z.string().regex(/^(wiki|raw)\/[\w./-]+\.(md|txt)$/)).min(1),
  }).strict()).min(1),
}).strict();
export type EvalFile = z.infer<typeof EvalFile>;
export type Question = EvalFile["questions"][number];
export type Ranker = (query: string) => string[];

/** Hit list depth used for MRR. Rank beyond this counts as a miss. */
export const MRR_DEPTH = 20;

export function loadEvalFile(file: string): EvalFile {
  const parsed = EvalFile.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) throw new Error(`${file} is not a valid eval file: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
  const ids = new Set<string>();
  for (const q of parsed.data.questions) {
    if (ids.has(q.id)) throw new Error(`${file}: duplicate question id ${q.id}`);
    ids.add(q.id);
  }
  return parsed.data;
}

/** Distinct paths in first-seen order (search returns chunks, so one note can appear many times). */
export function distinctPaths(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

/** Keyword-only ranker over the FTS5 index (the baseline). */
export function keywordRanker(db: DatabaseSync): Ranker {
  return (query) => distinctPaths(search(db, { query, limit: 50 }).map((h) => h.path));
}

export interface QuestionResult { id: string; style: Question["style"]; kind: "text" | "graph"; query: string; rank: number | null; top: string[]; relevant: string[] }
export interface EvalReport { k: number; questions: number; hitAtK: number; mrr: number; byStyle: Record<string, { n: number; hitAtK: number; mrr: number }>; byKind: Record<string, { n: number; hitAtK: number; mrr: number }>; results: QuestionResult[]; unknownPaths: string[] }

/** rank = 1-based position of the first relevant note among the first MRR_DEPTH distinct notes, else null. */
export function scoreQuestion(q: Question, ranked: readonly string[], k: number): QuestionResult {
  const list = distinctPaths(ranked).slice(0, MRR_DEPTH);
  const i = list.findIndex((p) => q.relevant.includes(p));
  return { id: q.id, style: q.style, kind: q.kind ?? "text", query: q.query, rank: i < 0 ? null : i + 1, top: list.slice(0, k), relevant: q.relevant };
}

const summarise = (rs: QuestionResult[], k: number) => ({
  n: rs.length,
  hitAtK: rs.length ? rs.filter((r) => r.rank !== null && r.rank <= k).length / rs.length : 0,
  mrr: rs.length ? rs.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / rs.length : 0,
});

/** knownPaths: paths present in the index; a relevant path outside it is reported, since that question can never score. */
export function runEval(file: EvalFile, rank: Ranker, k: number, knownPaths?: ReadonlySet<string>): EvalReport {
  if (!Number.isInteger(k) || k < 1 || k > MRR_DEPTH) throw new Error(`k must be 1 to ${MRR_DEPTH}`);
  const results = file.questions.map((q) => scoreQuestion(q, rank(q.query), k));
  const unknownPaths = knownPaths ? [...new Set(file.questions.flatMap((q) => q.relevant))].filter((p) => !knownPaths.has(p)).sort() : [];
  const byStyle: EvalReport["byStyle"] = {};
  for (const style of ["keyword", "paraphrase", "synonym"] as const) {
    const rs = results.filter((r) => r.style === style);
    if (rs.length) byStyle[style] = summarise(rs, k);
  }
  const byKind: EvalReport["byKind"] = {};
  for (const kind of ["text", "graph"] as const) {
    const rs = results.filter((r) => r.kind === kind);
    if (rs.length) byKind[kind] = summarise(rs, k);
  }
  const all = summarise(results, k);
  return { k, questions: all.n, hitAtK: all.hitAtK, mrr: all.mrr, byStyle, byKind, results, unknownPaths };
}

export function indexedPaths(db: DatabaseSync): Set<string> {
  return new Set((db.prepare("SELECT DISTINCT path FROM documents").all() as { path: string }[]).map((r) => r.path));
}

const f3 = (n: number): string => n.toFixed(3);

export function formatReport(r: EvalReport, label: string): string {
  const lines = [`${label}: ${r.questions} questions, hit@${r.k} ${f3(r.hitAtK)}, MRR ${f3(r.mrr)}`];
  for (const [style, s] of Object.entries(r.byStyle)) lines.push(`  ${style.padEnd(10)} n=${s.n}  hit@${r.k} ${f3(s.hitAtK)}  MRR ${f3(s.mrr)}`);
  const misses = r.results.filter((x) => x.rank === null || x.rank > r.k);
  if (misses.length) {
    lines.push(`  missed in top ${r.k}:`);
    for (const m of misses) lines.push(`    ${m.id} (${m.rank ? `rank ${m.rank}` : "not found"}) "${m.query}" -> ${m.top.slice(0, 3).join(", ") || "no results"}`);
  }
  if (r.unknownPaths.length) lines.push(`  WARNING: ${r.unknownPaths.length} relevant paths are not in the index: ${r.unknownPaths.join(", ")}`);
  return lines.join("\n");
}
