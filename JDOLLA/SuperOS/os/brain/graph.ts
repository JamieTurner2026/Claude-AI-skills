// Local brain graph (Phase 12a): how notes connect, built during `brain -- index` from the files alone. No model, no
// network. Stored in the index's `edges` table. Edge kinds:
//   link     a [[wikilink]] in the source note (same parser as the link_check tool)
//   source   a trusted note's frontmatter `sources` entry (raw/ notes' own frontmatter is never used)
//   project  a file under raw/<dept>/<project>/ -> the project note wiki/<dept>/<project>.md (from the folder layout)
//   dept     a note -> its department charter wiki/<dept>/charter.md (weak; never used to boost search)
// The generated indexes (_index.md, _master-index.md) are left out: they link to everything by design.
// Untrusted (raw/) notes can be link targets, and their own links are stored, but edges they author never boost search.
import type { DatabaseSync } from "node:sqlite";
import { extractLinks } from "../tools/link_check.ts";
import { parseFront } from "../tools/vault.ts";

export const EDGES_SQL = `
CREATE TABLE IF NOT EXISTS edges (
  src TEXT NOT NULL, dst TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('link', 'source', 'project', 'dept')),
  src_trusted INTEGER NOT NULL CHECK (src_trusted IN (0, 1)),
  PRIMARY KEY (src, dst, kind)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS edges_dst ON edges(dst);
`;
export type EdgeKind = "link" | "source" | "project" | "dept";
export const GENERATED_NOTES = new Set(["_index.md", "_master-index.md"]);

export interface GraphNote { rel: string; trusted: boolean; text: string; type: string }
export interface GraphStats { edges: number; byKind: Record<EdgeKind, number>; unresolvedLinks: number }

const baseName = (rel: string): string => rel.slice(rel.lastIndexOf("/") + 1);
const noExt = (rel: string): string => rel.replace(/\.(md|txt)$/i, "");

/** Resolves link text to an indexed note path, Obsidian-style: full path with or without .md, or a unique bare name. */
function resolver(paths: readonly string[]): (target: string) => string | null {
  const exact = new Map<string, string>();
  const bare = new Map<string, string | null>(); // null = ambiguous
  for (const p of paths) {
    const l = p.toLowerCase();
    exact.set(l, p);
    exact.set(noExt(l), p);
    const b = noExt(baseName(l));
    bare.set(b, bare.has(b) && bare.get(b) !== p ? null : p);
  }
  return (raw) => {
    const key = raw.replace(/\\/g, "/").replace(/^\/+/, "").trim().toLowerCase();
    if (!key || key.split("/").includes("..")) return null;
    if (key.includes("/")) return exact.get(key) ?? null;
    return exact.get(key) ?? bare.get(key) ?? null;
  };
}

/** Rebuilds the edges table for the given notes. Call inside the index transaction. */
export function buildGraph(db: DatabaseSync, notes: readonly GraphNote[]): GraphStats {
  db.exec(EDGES_SQL);
  db.exec("DELETE FROM edges");
  const nodes = notes.filter((n) => !GENERATED_NOTES.has(baseName(n.rel)));
  const resolve = resolver(nodes.map((n) => n.rel));
  const known = new Set(nodes.map((n) => n.rel));
  const byKind: Record<EdgeKind, number> = { link: 0, source: 0, project: 0, dept: 0 };
  let unresolvedLinks = 0;
  const ins = db.prepare("INSERT OR IGNORE INTO edges(src, dst, kind, src_trusted) VALUES (?,?,?,?)");
  const add = (src: string, dst: string, kind: EdgeKind, trusted: boolean): void => {
    if (src === dst || !known.has(dst)) return;
    if (Number(ins.run(src, dst, kind, trusted ? 1 : 0).changes)) byKind[kind]++;
  };
  const projectNotes = new Set(nodes.filter((n) => n.trusted && n.type === "project").map((n) => n.rel));
  for (const n of nodes) {
    for (const t of extractLinks(n.text)) {
      const dst = resolve(t);
      if (dst) add(n.rel, dst, "link", n.trusted); else unresolvedLinks++;
    }
    if (n.trusted) {
      for (const s of parseFront(n.text.slice(0, 8192)).sources ?? []) { const dst = resolve(s); if (dst) add(n.rel, dst, "source", true); }
    }
    const seg = n.rel.split("/");
    const dept = seg[1] ?? "";
    // Project membership comes from the folder layout Jay controls, never from a raw note's own text.
    if (seg[0] === "raw" && seg.length >= 4) {
      const hub = `wiki/${dept}/${seg[2]}.md`;
      if (projectNotes.has(hub)) add(n.rel, hub, "project", true);
    }
    const charter = `wiki/${dept}/charter.md`;
    if (dept && n.rel !== charter) add(n.rel, charter, "dept", true);
  }
  return { edges: byKind.link + byKind.source + byKind.project + byKind.dept, byKind, unresolvedLinks };
}

const hasEdges = (db: DatabaseSync): boolean => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'edges'").get();

/**
 * How much one edge votes, by kind (12b). A wikilink is a deliberate pointer; a shared source is weaker; folder-layout
 * project membership weaker still. Dept edges never vote: every note in a department has one.
 */
export const EDGE_WEIGHT: Readonly<Record<Exclude<EdgeKind, "dept">, number>> = { link: 1, source: 0.6, project: 0.3 };
const VOTE_KINDS = "('link','source','project')";

export interface Vote { score: number; via: string }

/**
 * Graph votes from `seeds` (the top text hits) to their neighbours, over edges a trusted note authored. Each edge
 * between a seed and a note adds EDGE_WEIGHT[kind] / log2(1 + degree of the busier end), so a charter or project hub
 * that touches everything votes weakly and is voted for weakly. A seed is never voted for by itself, but seeds vote
 * for each other. `via` is the seed that gave the biggest share.
 */
export function graphVotes(db: DatabaseSync, seeds: readonly string[]): Map<string, Vote> {
  const out = new Map<string, Vote & { best: number }>();
  if (!seeds.length || !hasEdges(db)) return new Map();
  const nb = db.prepare(`SELECT dst AS n, kind FROM edges WHERE src = ? AND src_trusted = 1 AND kind IN ${VOTE_KINDS}
    UNION ALL SELECT src AS n, kind FROM edges WHERE dst = ? AND src_trusted = 1 AND kind IN ${VOTE_KINDS}`);
  const deg = db.prepare(`SELECT (SELECT count(*) FROM edges WHERE src = ?1 AND src_trusted = 1 AND kind IN ${VOTE_KINDS})
    + (SELECT count(*) FROM edges WHERE dst = ?1 AND src_trusted = 1 AND kind IN ${VOTE_KINDS}) AS d`);
  const degrees = new Map<string, number>();
  const degreeOf = (p: string): number => {
    let d = degrees.get(p);
    if (d === undefined) { d = Number((deg.get(p) as { d: number }).d); degrees.set(p, d); }
    return d;
  };
  for (const s of new Set(seeds)) {
    for (const r of nb.all(s, s) as { n: string; kind: Exclude<EdgeKind, "dept"> }[]) {
      if (r.n === s) continue;
      const v = EDGE_WEIGHT[r.kind] / Math.log2(1 + Math.max(degreeOf(s), degreeOf(r.n), 1));
      const cur = out.get(r.n) ?? { score: 0, via: s, best: 0 };
      cur.score += v;
      if (v > cur.best) { cur.best = v; cur.via = s; }
      out.set(r.n, cur);
    }
  }
  return new Map([...out].map(([p, { score, via }]) => [p, { score, via }]));
}

export type RelationLabel = "links to" | "linked from" | "cites" | "cited by" | "same source" | "same project";
export interface Related { path: string; edge: RelationLabel; depth: 1 | 2; via?: string }
const PER_HOP = 25;
const MAX_RELATED = 50;

function hop(db: DatabaseSync, p: string): { path: string; edge: RelationLabel }[] {
  const rows = (sql: string, ...a: string[]) => (db.prepare(sql).all(...a) as { n: string }[]).map((r) => r.n);
  const out: { path: string; edge: RelationLabel }[] = [];
  const push = (edge: RelationLabel, ns: string[]) => { for (const n of ns) if (n !== p) out.push({ path: n, edge }); };
  push("links to", rows("SELECT dst AS n FROM edges WHERE src = ? AND kind = 'link' ORDER BY dst", p));
  push("linked from", rows("SELECT src AS n FROM edges WHERE dst = ? AND kind = 'link' ORDER BY src", p));
  push("cites", rows("SELECT dst AS n FROM edges WHERE src = ? AND kind = 'source' ORDER BY dst", p));
  push("cited by", rows("SELECT src AS n FROM edges WHERE dst = ? AND kind = 'source' ORDER BY src", p));
  push("same source", rows("SELECT DISTINCT b.src AS n FROM edges a JOIN edges b ON a.dst = b.dst AND b.kind = 'source' WHERE a.src = ? AND a.kind = 'source' ORDER BY n", p));
  push("same project", rows(`SELECT n FROM (SELECT dst AS n FROM edges WHERE src = ?1 AND kind = 'project'
    UNION SELECT src AS n FROM edges WHERE dst = ?1 AND kind = 'project'
    UNION SELECT b.src AS n FROM edges a JOIN edges b ON a.dst = b.dst AND b.kind = 'project' WHERE a.src = ?1 AND a.kind = 'project') ORDER BY n`, p));
  const seen = new Set<string>();
  return out.filter((r) => (seen.has(r.path) ? false : (seen.add(r.path), true))).slice(0, PER_HOP);
}

/** Neighbours of a note, up to two hops, with how they connect. Paths and edge labels only. */
export function related(db: DatabaseSync, path: string, depth: 1 | 2 = 1): Related[] {
  if (!hasEdges(db)) return [];
  const first = hop(db, path);
  const out: Related[] = first.map((r) => ({ ...r, depth: 1 }));
  if (depth === 2) {
    const seen = new Set([path, ...first.map((r) => r.path)]);
    for (const r of first) {
      for (const s of hop(db, r.path)) {
        if (seen.has(s.path)) continue;
        seen.add(s.path);
        out.push({ ...s, depth: 2, via: r.path });
        if (out.length >= MAX_RELATED) return out;
      }
    }
  }
  return out.slice(0, MAX_RELATED);
}

export interface GraphSummary {
  notes: number; edges: Record<EdgeKind, number>;
  orphans: { total: number; paths: string[] };
  hubs: { path: string; degree: number }[];
}

/** Whole-graph view: counts, wiki notes with no trusted links or sources in or out, and the most connected notes. Paths only. */
export function graphSummary(db: DatabaseSync, limit = 10): GraphSummary {
  const notes = (db.prepare("SELECT DISTINCT path FROM documents").all() as { path: string }[]).map((r) => r.path).filter((p) => !GENERATED_NOTES.has(baseName(p)));
  const edges: Record<EdgeKind, number> = { link: 0, source: 0, project: 0, dept: 0 };
  if (!hasEdges(db)) return { notes: notes.length, edges, orphans: { total: 0, paths: [] }, hubs: [] };
  for (const r of db.prepare("SELECT kind, count(*) AS c FROM edges GROUP BY kind").all() as { kind: EdgeKind; c: number }[]) edges[r.kind] = Number(r.c);
  const degree = new Map<string, number>();
  // Only edges a trusted note authored count, as for the search boost: raw/ notes can't make a hub or hide an orphan.
  for (const r of db.prepare("SELECT src, dst FROM edges WHERE kind IN ('link', 'source') AND src_trusted = 1").all() as { src: string; dst: string }[]) {
    degree.set(r.src, (degree.get(r.src) ?? 0) + 1);
    degree.set(r.dst, (degree.get(r.dst) ?? 0) + 1);
  }
  const orphanPaths = notes.filter((p) => p.startsWith("wiki/") && !degree.has(p)).sort();
  const hubs = [...degree].filter(([p]) => notes.includes(p)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, limit).map(([path, d]) => ({ path, degree: d }));
  return { notes: notes.length, edges, orphans: { total: orphanPaths.length, paths: orphanPaths.slice(0, 50) }, hubs };
}
