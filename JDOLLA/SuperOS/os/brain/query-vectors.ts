// Query vectors for the brain server. The model is loaded once, lazily, and never downloaded here.
// Anything that goes wrong (no runtime, no model, no vectors in the index, SUPEROS_BRAIN_HYBRID=off) means
// "no vector", and the server answers with keyword search. A run never fails because of embeddings.
import { DatabaseSync } from "node:sqlite";
import { tryLoadEmbedder, type Embedder } from "./embeddings.ts";

export type QueryVectors = Map<string, { model: string; vector: Float32Array }>;
type Loader = () => Promise<{ embedder: Embedder | null; note: string }>;

function searchQueryOf(msg: unknown): string | null {
  const m = msg as { method?: unknown; params?: { name?: unknown; arguments?: { query?: unknown } } } | null;
  if (!m || m.method !== "tools/call" || m.params?.name !== "search") return null;
  const q = m.params.arguments?.query;
  return typeof q === "string" && q.trim() ? q.trim() : null;
}

function hasVectors(dbPath: string, model: string): boolean {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'vectors'").get()) return false;
    return !!db.prepare("SELECT 1 FROM vectors WHERE model = ? LIMIT 1").get(model);
  } catch { return false; } finally { db?.close(); }
}

export function makeQueryVectorizer(load: Loader = tryLoadEmbedder, log: (s: string) => void = (s) => process.stderr.write(`superos-brain: ${s}\n`)) {
  let loading: Promise<Embedder | null> | null = null;
  return async function searchQueryVector(dbPath: string, msg: unknown): Promise<QueryVectors | null> {
    const query = searchQueryOf(msg);
    if (!query || process.env["SUPEROS_BRAIN_HYBRID"] === "off") return null;
    try {
      loading ??= load().then((r) => { log(r.note); return r.embedder; }, (e: unknown) => { log(`embeddings unavailable (${String(e)}); keyword search only`); return null; });
      const embedder = await loading;
      if (!embedder || !hasVectors(dbPath, embedder.id)) return null;
      const [vector] = await embedder.embed([query]);
      return vector ? new Map([[query, { model: embedder.id, vector }]]) : null;
    } catch (e) {
      log(`query embedding failed (${e instanceof Error ? e.message : String(e)}); keyword search for this query`);
      return null;
    }
  };
}

export const searchQueryVector = makeQueryVectorizer();
