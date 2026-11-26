// brain -- bench: a synthetic vault at real size, in a temp folder, to measure the index and search honestly.
// Seeded, invented text only, never the real vault or index, and the temp folder is removed in finally.
// It measures index build time, index size and search latency with the graph off and on (on: re-rank + connected list). (Retrieval quality at this
// size, with generated questions, is the separate queued bench task.)
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { connectedNotes, graphSearch } from "./hybrid.ts";
import { rebuildIndex } from "./indexer.ts";
import { openReadOnly } from "./search.ts";

const DEPTS = ["software", "security", "ai", "gamedev", "industrial", "strategy", "creative"] as const;
const WORDS: Record<(typeof DEPTS)[number], string[]> = {
  software: ["deploy", "react", "api", "endpoint", "bug", "refactor", "typescript", "database", "cache", "pipeline", "vercel", "supabase", "router", "schema"],
  security: ["firewall", "token", "audit", "phishing", "vpn", "encryption", "subnet", "patch", "incident", "malware", "access", "certificate", "threat", "scan"],
  ai: ["embedding", "prompt", "agent", "memory", "retrieval", "model", "eval", "context", "vector", "tool", "skill", "brain", "index", "rerank"],
  gamedev: ["shader", "level", "sprite", "physics", "camera", "blender", "unreal", "racing", "checkpoint", "texture", "animation", "collision", "lighting", "garage"],
  industrial: ["servo", "plc", "conveyor", "sensor", "ladder", "fault", "alarm", "robot", "torque", "encoder", "station", "operator", "hmi", "fixture"],
  strategy: ["roadmap", "budget", "milestone", "priority", "risk", "pricing", "customer", "launch", "metric", "quarter", "decision", "scope", "review", "plan"],
  creative: ["palette", "logo", "poster", "concept", "style", "character", "mood", "typography", "sketch", "frame", "story", "lighting", "brand", "colour"],
};

/** Small seeded PRNG (mulberry32), so every run builds the same vault. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface SynthSize { wiki: number; sessions: number; mail: number; projects: number }
export const FULL: SynthSize = { wiki: 2000, sessions: 500, mail: 200, projects: 35 };
export const SMALL: SynthSize = { wiki: 220, sessions: 55, mail: 25, projects: 7 };

/** Writes the synthetic vault under dir/vault and returns its path and the queries to time. */
export function synthVault(dir: string, size: SynthSize, seed = 12): { vault: string; queries: string[]; notes: number } {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const vault = path.join(dir, "vault");
  const w = (rel: string, text: string) => { const f = path.join(vault, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); };
  const sentence = (d: (typeof DEPTS)[number], n: number) => Array.from({ length: n }, () => pick(WORDS[d])).join(" ") + ".";
  const wiki: string[] = [];
  let notes = 0;
  for (const d of DEPTS) { w(`wiki/${d}/charter.md`, `---\ntitle: ${d} charter\ndept: ${d}\ntype: concept\n---\n# ${d} charter\n${sentence(d, 30)}\n`); notes++; }
  const projects: { d: (typeof DEPTS)[number]; slug: string }[] = [];
  for (let i = 0; i < size.projects; i++) {
    const d = DEPTS[i % DEPTS.length]!;
    const slug = `project-${i}`;
    projects.push({ d, slug });
    w(`raw/${d}/${slug}/2026-11-14_repo-snapshot.md`, `# ${slug} snapshot\n${sentence(d, 60)}\n`);
    notes++;
  }
  for (let i = 0; i < size.wiki; i++) {
    const d = DEPTS[i % DEPTS.length]!;
    const proj = i < size.projects ? projects[i]! : null;
    const rel = proj ? `wiki/${proj.d}/${proj.slug}.md` : `wiki/${d}/note-${i}.md`;
    const dd = proj ? proj.d : d;
    const links = Array.from({ length: 1 + Math.floor(r() * 4) }, () => (wiki.length ? `[[${pick(wiki).replace(/\.md$/, "")}]]` : "")).join(" ");
    const src = proj ? `sources:\n  - raw/${proj.d}/${proj.slug}/2026-11-14_repo-snapshot.md\n` : "";
    const body = Array.from({ length: 4 + Math.floor(r() * 8) }, () => sentence(dd, 8 + Math.floor(r() * 10))).join(" ");
    w(rel, `---\ntitle: ${pick(WORDS[dd])} ${pick(WORDS[dd])} ${i}\ndept: ${dd}\ntype: ${proj ? "project" : "concept"}\n${src}updated: 2026-11-01\n---\n# ${pick(WORDS[dd])} notes ${i}\n${body}\n\n## Related\n${links}\n`);
    wiki.push(rel);
    notes++;
  }
  for (let i = 0; i < size.sessions; i++) {
    const d = pick(DEPTS);
    w(`raw/sessions/claude-code/2026-10-${String(1 + (i % 28)).padStart(2, "0")}_session-${i}.md`, `---\ntitle: session ${i}\ntype: session\n---\n# session ${i}\n### Jay\n\n${sentence(d, 40)}\n\n### Claude\n\n${sentence(d, 120)}\n`);
    notes++;
  }
  for (let i = 0; i < size.mail; i++) {
    const d = pick(DEPTS);
    w(`raw/mail/2026-11/2026-11-${String(1 + (i % 28)).padStart(2, "0")}_mail-${i}.md`, `---\ntitle: mail ${i}\ntype: mail\ntrusted: false\n---\n# mail ${i}\n## Snippet\n\n${sentence(d, 30)}\n`);
    notes++;
  }
  const queries = Array.from({ length: 200 }, () => { const d = pick(DEPTS); return `${pick(WORDS[d])} ${pick(WORDS[d])}${r() < 0.5 ? ` ${pick(WORDS[d])}` : ""}`; });
  return { vault, queries, notes };
}

const pct = (xs: number[], p: number): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0; };
const round = (n: number, d = 2): number => Math.round(n * 10 ** d) / 10 ** d;

export interface BenchRun { notes: number; chunks: number; edges: number; indexMs: number; indexBytes: number; p50Ms: number; p95Ms: number }
export interface BenchReport { size: SynthSize; graphOff: BenchRun; graphOn: BenchRun; deltaP95Ms: number; sizeIncreasePct: number }

function timeQueries(dbPath: string, queries: string[], graph: boolean): { p50: number; p95: number } {
  const db = openReadOnly(dbPath);
  try {
    // graph on = what a search through the brain server costs since 12b: the re-rank plus the connected list.
    const one = (q: string) => { const hits = graphSearch(db, { query: q }, null, graph); if (graph) connectedNotes(db, hits, { query: q }); };
    for (const q of queries.slice(0, 20)) one(q); // warm-up
    const ms = queries.map((q) => { const t0 = performance.now(); one(q); return performance.now() - t0; });
    return { p50: pct(ms, 50), p95: pct(ms, 95) };
  } finally { db.close(); }
}

/** Builds the synthetic vault, indexes it without and with the graph, and times the same queries. Cleans up in finally. */
export function runBench(size: SynthSize = FULL): BenchReport {
  const dir = mkdtempSync(path.join(tmpdir(), "brain-bench-"));
  try {
    const { vault, queries, notes } = synthVault(dir, size);
    const one = (graph: boolean): BenchRun => {
      const dbPath = path.join(dir, `index-${graph ? "on" : "off"}.sqlite`);
      const t0 = performance.now();
      const s = rebuildIndex(vault, dbPath, { graph });
      const indexMs = performance.now() - t0;
      const q = timeQueries(dbPath, queries, graph);
      return { notes, chunks: s.chunks, edges: s.graph?.edges ?? 0, indexMs: round(indexMs, 0), indexBytes: statSync(dbPath).size, p50Ms: round(q.p50), p95Ms: round(q.p95) };
    };
    const graphOff = one(false);
    const graphOn = one(true);
    return { size, graphOff, graphOn, deltaP95Ms: round(graphOn.p95Ms - graphOff.p95Ms), sizeIncreasePct: round(((graphOn.indexBytes - graphOff.indexBytes) / graphOff.indexBytes) * 100, 1) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export function formatBench(b: BenchReport): string {
  const row = (label: string, r: BenchRun) => `  ${label.padEnd(10)} ${String(r.indexMs).padStart(7)} ms  ${(r.indexBytes / 1024 / 1024).toFixed(2).padStart(6)} MB  p50 ${r.p50Ms.toFixed(2)} ms  p95 ${r.p95Ms.toFixed(2)} ms  edges ${r.edges}`;
  return [
    `Brain bench: synthetic vault of ${b.graphOn.notes} notes, ${b.graphOn.chunks} chunks (invented text, temp folder, deleted after)`,
    "             index time   size     search (200 keyword queries)",
    row("graph off", b.graphOff),
    row("graph on", b.graphOn),
    `  graph cost: p95 ${b.deltaP95Ms >= 0 ? "+" : ""}${b.deltaP95Ms} ms, index ${b.sizeIncreasePct >= 0 ? "+" : ""}${b.sizeIncreasePct}% bigger (targets: at most +5 ms, at most +20%)`,
  ].join("\n");
}
