// GET /api/brain/graph (12a): what a dashboard panel may show about the note graph. Counts and the top hubs as
// path, a cleaned one-line title and whether the note is trusted. Never a note's text. A missing or damaged index is
// { available: false }, never an error page.
import { graphSummary, type EdgeKind } from "../brain/graph.ts";
import { isTrusted } from "../brain/files.ts";
import { openReadOnly } from "../brain/search.ts";

export interface BrainGraphView {
  available: boolean;
  notes: number; orphans: number;
  edges: Record<EdgeKind, number>;
  hubs: { path: string; title: string; trusted: boolean; degree: number }[];
}

const oneLine = (s: string): string => s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 120);
const EMPTY: BrainGraphView = { available: false, notes: 0, orphans: 0, edges: { link: 0, source: 0, project: 0, dept: 0 }, hubs: [] };

export function brainGraphView(dbPath: string, limit = 10): BrainGraphView {
  let db;
  try { db = openReadOnly(dbPath); } catch { return EMPTY; }
  try {
    const s = graphSummary(db, limit);
    const title = db.prepare("SELECT title FROM documents WHERE path = ? ORDER BY chunk LIMIT 1");
    return {
      available: true, notes: s.notes, orphans: s.orphans.total, edges: s.edges,
      hubs: s.hubs.map((h) => ({ path: h.path, title: oneLine(String((title.get(h.path) as { title?: string } | undefined)?.title ?? "")), trusted: isTrusted(h.path), degree: h.degree })),
    };
  } catch { return EMPTY; } finally { db.close(); }
}
