// Read-only search over the brain index.
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { verifyIndex } from "./schema.ts";

export const SearchInput = z.object({
  query: z.string().trim().min(1).max(300),
  limit: z.number().int().min(1).max(50).default(8),
  dept: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/).optional(),
  trustedOnly: z.boolean().default(false),
}).strict();
export type SearchInput = z.input<typeof SearchInput>;

export interface SearchHit {
  path: string;
  heading: string;
  dept: string;
  type: string;
  title: string;
  updated: string;
  trusted: boolean;
  snippet: string;
  score: number;
}

/** Turns free text into a safe FTS5 query: words only, each quoted. Operators and punctuation are dropped. */
export function toFtsQuery(q: string, joiner: " AND " | " OR " = " AND "): string | null {
  const words = q.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 16) ?? [];
  return words.length ? words.map((w) => `"${w}"`).join(joiner) : null;
}

export function openReadOnly(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { verifyIndex(db); } catch (e) { db.close(); throw e; }
  return db;
}

export function search(db: DatabaseSync, raw: SearchInput): SearchHit[] {
  const input = SearchInput.parse(raw);
  const sql = `SELECT path, heading, dept, type, title, updated, trusted,
      snippet(docs_fts, 6, '[', ']', ' … ', 24) AS snippet, bm25(docs_fts, 0, 0, 0, 4, 2, 0, 1, 0) AS score
    FROM docs_fts WHERE docs_fts MATCH ?${input.dept ? " AND dept = ?" : ""}${input.trustedOnly ? " AND trusted = '1'" : ""}
    ORDER BY score LIMIT ?`;
  const run = (match: string): SearchHit[] => {
    const args: (string | number)[] = [match];
    if (input.dept) args.push(input.dept);
    args.push(input.limit);
    return (db.prepare(sql).all(...args) as Record<string, unknown>[]).map((r) => ({
      path: String(r["path"]), heading: String(r["heading"]), dept: String(r["dept"]), type: String(r["type"]),
      title: String(r["title"]), updated: String(r["updated"]), trusted: String(r["trusted"]) === "1",
      snippet: String(r["snippet"]), score: Number(r["score"]),
    }));
  };
  const and = toFtsQuery(input.query);
  if (!and) return [];
  const hits = run(and);
  if (hits.length) return hits;
  const or = toFtsQuery(input.query, " OR ");
  return or && or !== and ? run(or) : [];
}

export function indexCounts(db: DatabaseSync): { chunks: number; files: number; untrustedChunks: number } {
  const r = db.prepare("SELECT count(*) AS c, count(DISTINCT path) AS f, sum(trusted = 0) AS u FROM documents").get() as Record<string, number | null>;
  return { chunks: Number(r["c"] ?? 0), files: Number(r["f"] ?? 0), untrustedChunks: Number(r["u"] ?? 0) };
}
