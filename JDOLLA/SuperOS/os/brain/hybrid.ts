// Hybrid search (Phase 7a): FTS5 keyword ranking plus local-vector ranking, merged by reciprocal rank fusion.
// Vectors live in the same sqlite index, in a cache keyed by a hash of the model and the chunk text, so the
// keyword-only rebuild that runs before every run (it renumbers documents) never throws vectors away.
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { dot, type Embedder } from "./embeddings.ts";
import { SearchInput, search, type SearchHit } from "./search.ts";
import { boostNeighbours } from "./graph.ts";

export const VECTORS_SQL = `CREATE TABLE IF NOT EXISTS vectors (
  key TEXT PRIMARY KEY, model TEXT NOT NULL, dim INTEGER NOT NULL, vec BLOB NOT NULL
)`;
/** RRF constant from the original paper; damps the weight of rank 1 versus rank 2. */
export const RRF_K = 60;
/** How deep each list goes before fusion. */
const DEPTH = 50;
/**
 * A vector match below this cosine similarity gets no vote in the fusion. Without it, the top 50 vector
 * matches always vote, even when every one of them is near noise (all-MiniLM-L6-v2 puts unrelated
 * sentences around 0 to 0.2), and those weak votes can push a strong keyword hit out of the results.
 * 0.15: the highest floor at which no eval question got worse (sweep in docs/STATUS.md, 2026-11-22).
 */
export const MIN_SIMILARITY = 0.15;

interface DocRow { id: number; path: string; heading: string; dept: string; type: string; title: string; updated: string; trusted: number; text: string }

export const embedText = (r: Pick<DocRow, "title" | "heading" | "text">): string => `${r.heading || r.title}\n${r.text}`;
export const vectorKey = (model: string, text: string): string => createHash("sha256").update(`${model}\n${text}`).digest("hex");

const toBlob = (v: Float32Array): Uint8Array => new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
const fromBlob = (b: Uint8Array): Float32Array => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

function hasVectorTable(db: DatabaseSync): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'vectors'").get();
}

export interface EmbedStats { chunks: number; embedded: number; cached: number; pruned: number; /** chunks left for next time (deadline reached) */ remaining?: number }
export interface EmbedOptions { batch?: number; /** stop starting new batches after this time (ms since epoch); leftovers wait for the next call */ deadline?: number; now?: () => number }

/** Embeds every chunk that has no vector for this model yet, and drops vectors no chunk uses any more. */
export async function embedIndex(db: DatabaseSync, embedder: Embedder, opts: EmbedOptions = {}): Promise<EmbedStats> {
  const batch = opts.batch ?? 32;
  const now = opts.now ?? Date.now;
  db.exec(VECTORS_SQL);
  const rows = db.prepare("SELECT id, title, heading, text FROM documents ORDER BY id").all() as unknown as DocRow[];
  const have = new Set((db.prepare("SELECT key FROM vectors WHERE model = ?").all(embedder.id) as { key: string }[]).map((r) => r.key));
  const wanted = new Map<string, string>();
  for (const r of rows) { const t = embedText(r); wanted.set(vectorKey(embedder.id, t), t); }
  const missing = [...wanted].filter(([k]) => !have.has(k));
  const ins = db.prepare("INSERT OR REPLACE INTO vectors(key, model, dim, vec) VALUES (?,?,?,?)");
  let done = 0;
  for (let i = 0; i < missing.length; i += batch) {
    if (opts.deadline !== undefined && now() >= opts.deadline) break;
    const part = missing.slice(i, i + batch);
    const vecs = await embedder.embed(part.map(([, t]) => t));
    if (vecs.length !== part.length) throw new Error("embedder returned the wrong number of vectors");
    db.exec("BEGIN");
    try {
      part.forEach(([k], j) => {
        const v = vecs[j]!;
        if (v.length !== embedder.dimensions) throw new Error(`vector has ${v.length} dimensions, expected ${embedder.dimensions}`);
        ins.run(k, embedder.id, v.length, toBlob(v));
      });
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    done += part.length;
  }
  let pruned = 0;
  const del = db.prepare("DELETE FROM vectors WHERE key = ?");
  for (const k of have) if (!wanted.has(k)) { del.run(k); pruned++; }
  const other = db.prepare("DELETE FROM vectors WHERE model != ?").run(embedder.id);
  const left = missing.length - done;
  return { chunks: rows.length, embedded: done, cached: wanted.size - missing.length, pruned: pruned + Number(other.changes), ...(left ? { remaining: left } : {}) };
}

/** Share of chunks that have a vector for this model (0 when the table is missing). */
export function vectorCoverage(db: DatabaseSync, model: string): number {
  if (!hasVectorTable(db)) return 0;
  const rows = db.prepare("SELECT title, heading, text FROM documents").all() as unknown as DocRow[];
  if (!rows.length) return 0;
  const have = new Set((db.prepare("SELECT key FROM vectors WHERE model = ?").all(model) as { key: string }[]).map((r) => r.key));
  return rows.filter((r) => have.has(vectorKey(model, embedText(r)))).length / rows.length;
}

/** Chunks ranked by cosine similarity to the query vector (vectors are normalised, so dot = cosine). */
export function vectorRank(db: DatabaseSync, model: string, query: Float32Array, input: SearchInput, minSimilarity = MIN_SIMILARITY): { row: DocRow; score: number }[] {
  if (!hasVectorTable(db)) return [];
  const p = SearchInput.parse(input);
  const vecs = new Map((db.prepare("SELECT key, vec FROM vectors WHERE model = ?").all(model) as { key: string; vec: Uint8Array }[]).map((r) => [r.key, r.vec]));
  const rows = db.prepare("SELECT id, path, heading, dept, type, title, updated, trusted, text FROM documents").all() as unknown as DocRow[];
  const out: { row: DocRow; score: number }[] = [];
  for (const r of rows) {
    if (p.dept && r.dept !== p.dept) continue;
    if (p.trustedOnly && Number(r.trusted) !== 1) continue;
    const b = vecs.get(vectorKey(model, embedText(r)));
    if (!b) continue;
    const score = dot(query, fromBlob(b));
    if (score >= minSimilarity) out.push({ row: r, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, DEPTH);
}

/** Reciprocal rank fusion over ids: score(d) = sum over lists of 1 / (RRF_K + rank). */
export function rrf(lists: readonly (readonly number[])[], k = RRF_K, weights?: readonly number[]): { id: number; score: number }[] {
  const s = new Map<number, number>();
  lists.forEach((list, li) => { const w = weights?.[li] ?? 1; list.forEach((id, i) => s.set(id, (s.get(id) ?? 0) + w / (k + i + 1))); });
  return [...s].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score || a.id - b.id);
}

const snippetOf = (text: string): string => text.replace(/\s+/g, " ").slice(0, 220);

/**
 * Hybrid search. With no query vector (no model, or a failure loading it) this is exactly keyword search.
 * Same filters and same SearchHit shape as search(), so callers and fencing do not change.
 */
export function hybridSearch(db: DatabaseSync, raw: SearchInput, query: { model: string; vector: Float32Array } | null, minSimilarity = MIN_SIMILARITY): SearchHit[] {
  const input = SearchInput.parse(raw);
  const kw = search(db, { ...input, limit: DEPTH });
  if (!query) return kw.slice(0, input.limit);
  const vr = vectorRank(db, query.model, query.vector, input, minSimilarity);
  if (!vr.length) return kw.slice(0, input.limit);
  const byId = new Map<number, SearchHit>(kw.map((h) => [h.id, h]));
  for (const { row, score } of vr) {
    if (!byId.has(row.id)) {
      byId.set(row.id, { id: row.id, path: row.path, heading: row.heading, dept: row.dept, type: row.type, title: row.title, updated: row.updated, trusted: Number(row.trusted) === 1, snippet: snippetOf(row.text), score: -score });
    }
  }
  return rrf([kw.map((h) => h.id), vr.map((v) => v.row.id)]).slice(0, input.limit).map((f) => ({ ...byId.get(f.id)!, score: -f.score }));
}

// ---------- graph-aware search (Phase 12a) ----------

/** How many of the top fused hits seed the graph list, and how much a graph vote weighs against a keyword or vector vote. */
export const GRAPH_SEEDS = 5;
export const GRAPH_WEIGHT = 0.5;

/** Graph boost on or off. Default from the eval (docs/STATUS.md); SUPEROS_BRAIN_GRAPH=on|off overrides. */
export const GRAPH_DEFAULT = false;
export function graphEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env["SUPEROS_BRAIN_GRAPH"];
  return v === "on" ? true : v === "off" ? false : GRAPH_DEFAULT;
}

/**
 * Search with an optional graph list. graph=false is exactly hybridSearch (and so exactly keyword search with no
 * query vector). graph=true adds a third RRF list: notes one hop from the top hits, over edges a trusted note authored.
 */
export function graphSearch(db: DatabaseSync, raw: SearchInput, query: { model: string; vector: Float32Array } | null, graph: boolean, minSimilarity = MIN_SIMILARITY): SearchHit[] {
  if (!graph) return hybridSearch(db, raw, query, minSimilarity);
  const input = SearchInput.parse(raw);
  const kw = search(db, { ...input, limit: DEPTH });
  const vr = query ? vectorRank(db, query.model, query.vector, input, minSimilarity) : [];
  const byId = new Map<number, SearchHit>(kw.map((h) => [h.id, h]));
  const hitOf = (row: DocRow, score: number): SearchHit => ({ id: row.id, path: row.path, heading: row.heading, dept: row.dept, type: row.type, title: row.title, updated: row.updated, trusted: Number(row.trusted) === 1, snippet: snippetOf(row.text), score });
  for (const { row, score } of vr) if (!byId.has(row.id)) byId.set(row.id, hitOf(row, -score));
  const lists = [kw.map((h) => h.id), ...(vr.length ? [vr.map((v) => v.row.id)] : [])];
  const base = rrf(lists);
  const seeds: string[] = [];
  for (const f of base) { const p = byId.get(f.id)!.path; if (!seeds.includes(p)) seeds.push(p); if (seeds.length >= GRAPH_SEEDS) break; }
  const near = boostNeighbours(db, seeds);
  if (!near.size) return base.slice(0, input.limit).map((f) => ({ ...byId.get(f.id)!, score: -f.score }));
  // One chunk per neighbour note (its first), filtered like every other hit.
  const first = db.prepare("SELECT id, path, heading, dept, type, title, updated, trusted, text FROM documents WHERE path = ? ORDER BY chunk LIMIT 1");
  const graphList: number[] = [];
  for (const [p] of [...near].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
    const row = first.get(p) as unknown as DocRow | undefined;
    if (!row || (input.dept && row.dept !== input.dept) || (input.trustedOnly && Number(row.trusted) !== 1)) continue;
    if (!byId.has(row.id)) byId.set(row.id, hitOf(row, 0));
    graphList.push(row.id);
    if (graphList.length >= DEPTH) break;
  }
  return rrf([...lists, graphList], RRF_K, [...lists.map(() => 1), GRAPH_WEIGHT]).slice(0, input.limit).map((f) => ({ ...byId.get(f.id)!, score: -f.score }));
}
