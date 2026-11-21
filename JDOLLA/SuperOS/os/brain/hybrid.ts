// Hybrid search (Phase 7a): FTS5 keyword ranking plus local-vector ranking, merged by reciprocal rank fusion.
// Vectors live in the same sqlite index, in a cache keyed by a hash of the model and the chunk text, so the
// keyword-only rebuild that runs before every run (it renumbers documents) never throws vectors away.
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { dot, type Embedder } from "./embeddings.ts";
import { SearchInput, search, type SearchHit } from "./search.ts";

export const VECTORS_SQL = `CREATE TABLE IF NOT EXISTS vectors (
  key TEXT PRIMARY KEY, model TEXT NOT NULL, dim INTEGER NOT NULL, vec BLOB NOT NULL
)`;
/** RRF constant from the original paper; damps the weight of rank 1 versus rank 2. */
export const RRF_K = 60;
/** How deep each list goes before fusion. */
const DEPTH = 50;

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
export function vectorRank(db: DatabaseSync, model: string, query: Float32Array, input: SearchInput): { row: DocRow; score: number }[] {
  if (!hasVectorTable(db)) return [];
  const p = SearchInput.parse(input);
  const vecs = new Map((db.prepare("SELECT key, vec FROM vectors WHERE model = ?").all(model) as { key: string; vec: Uint8Array }[]).map((r) => [r.key, r.vec]));
  const rows = db.prepare("SELECT id, path, heading, dept, type, title, updated, trusted, text FROM documents").all() as unknown as DocRow[];
  const out: { row: DocRow; score: number }[] = [];
  for (const r of rows) {
    if (p.dept && r.dept !== p.dept) continue;
    if (p.trustedOnly && Number(r.trusted) !== 1) continue;
    const b = vecs.get(vectorKey(model, embedText(r)));
    if (b) out.push({ row: r, score: dot(query, fromBlob(b)) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, DEPTH);
}

/** Reciprocal rank fusion over ids: score(d) = sum over lists of 1 / (RRF_K + rank). */
export function rrf(lists: readonly (readonly number[])[], k = RRF_K): { id: number; score: number }[] {
  const s = new Map<number, number>();
  for (const list of lists) list.forEach((id, i) => s.set(id, (s.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...s].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score || a.id - b.id);
}

const snippetOf = (text: string): string => text.replace(/\s+/g, " ").slice(0, 220);

/**
 * Hybrid search. With no query vector (no model, or a failure loading it) this is exactly keyword search.
 * Same filters and same SearchHit shape as search(), so callers and fencing do not change.
 */
export function hybridSearch(db: DatabaseSync, raw: SearchInput, query: { model: string; vector: Float32Array } | null): SearchHit[] {
  const input = SearchInput.parse(raw);
  const kw = search(db, { ...input, limit: DEPTH });
  if (!query) return kw.slice(0, input.limit);
  const vr = vectorRank(db, query.model, query.vector, input);
  if (!vr.length) return kw.slice(0, input.limit);
  const byId = new Map<number, SearchHit>(kw.map((h) => [h.id, h]));
  for (const { row, score } of vr) {
    if (!byId.has(row.id)) {
      byId.set(row.id, { id: row.id, path: row.path, heading: row.heading, dept: row.dept, type: row.type, title: row.title, updated: row.updated, trusted: Number(row.trusted) === 1, snippet: snippetOf(row.text), score: -score });
    }
  }
  return rrf([kw.map((h) => h.id), vr.map((v) => v.row.id)]).slice(0, input.limit).map((f) => ({ ...byId.get(f.id)!, score: -f.score }));
}
