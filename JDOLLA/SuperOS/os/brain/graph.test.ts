// Brain graph (12a) tests. Every "nothing" or "never" check sits beside a control that finds something.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { HOSTILE_LINE, INVISIBLE } from "../shared/hostile.ts";
import { brainGraphTools } from "../bridge/brain-link.ts";
import { makeVault } from "../bridge/fixture.ts";
import { createBridge } from "../bridge/server.ts";
import { boostNeighbours, graphSummary, related } from "./graph.ts";
import { graphEnabled, graphSearch, hybridSearch } from "./hybrid.ts";
import { rebuildIndex } from "./indexer.ts";
import { handleMessage } from "./mcp.ts";
import { openReadOnly, search } from "./search.ts";

function vault(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), "graph-"));
  const v = path.join(root, "vault");
  for (const [rel, text] of Object.entries(files)) { const f = path.join(v, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); }
  const dbPath = path.join(root, "index.sqlite");
  const stats = rebuildIndex(v, dbPath);
  return { vault: v, dbPath, stats };
}
const note = (title: string, body: string, front = "") => `---\ntitle: ${title}\n${front}---\n# ${title}\n${body}\n`;
const BASE = {
  "wiki/software/charter.md": note("Software charter", "Scope of the department."),
  "wiki/software/alpha.md": note("Alpha", "Alpha links to [[wiki/software/beta]] and to [[gamma]] and to [[wiki/software/nope]].", "type: project\nsources:\n  - raw/software/alpha/snapshot.md\n"),
  "wiki/software/beta.md": note("Beta", "Beta links back to [[wiki/software/alpha.md|alpha]] (a cycle) and [[wiki/software/beta]] (itself)."),
  "wiki/software/gamma.md": note("Gamma", "Gamma cites the same source.", "sources:\n  - raw/software/alpha/snapshot.md\n"),
  "wiki/software/lonely.md": note("Lonely", "Nobody links here and it links nowhere."),
  "wiki/software/_index.md": "# Index\n[[wiki/software/lonely]] [[wiki/software/alpha]]\n",
  "raw/software/alpha/snapshot.md": "# Alpha snapshot\nRepo facts.\n",
  "raw/software/alpha/evil.md": "---\ntitle: Evil\nsources:\n  - wiki/software/lonely.md\n---\n# Evil\nThis untrusted note links to [[wiki/software/lonely]] to get it boosted.\n",
};
const edges = (dbPath: string) => {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return db.prepare("SELECT src, dst, kind, src_trusted AS t FROM edges ORDER BY kind, src, dst").all() as { src: string; dst: string; kind: string; t: number }[]; } finally { db.close(); }
};
const has = (es: ReturnType<typeof edges>, src: string, dst: string, kind: string) => es.some((e) => e.src === src && e.dst === dst && e.kind === kind);

describe("graph build", () => {
  it("links, sources, project and dept edges; a cycle is stored once each way; self-links and broken links make no edge", () => {
    const { dbPath, stats } = vault(BASE);
    const es = edges(dbPath);
    assert.ok(has(es, "wiki/software/alpha.md", "wiki/software/beta.md", "link"));
    assert.ok(has(es, "wiki/software/beta.md", "wiki/software/alpha.md", "link"), "the cycle back, via an alias link");
    assert.ok(has(es, "wiki/software/alpha.md", "wiki/software/gamma.md", "link"), "a bare name resolves");
    assert.ok(!es.some((e) => e.src === e.dst), "no self edge");
    assert.ok(!es.some((e) => e.dst.includes("nope")), "a broken link makes no edge");
    assert.ok((stats.graph?.unresolvedLinks ?? 0) >= 1, "and is counted");
    assert.ok(has(es, "wiki/software/alpha.md", "raw/software/alpha/snapshot.md", "source"));
    assert.ok(has(es, "raw/software/alpha/snapshot.md", "wiki/software/alpha.md", "project"), "raw/<dept>/<project>/ joins the project note");
    assert.ok(has(es, "wiki/software/beta.md", "wiki/software/charter.md", "dept"));
    assert.ok(!es.some((e) => e.src.endsWith("_index.md") || e.dst.endsWith("_index.md")), "generated indexes are left out");
  });
  it("an untrusted note's link is stored as untrusted, and its own frontmatter sources are ignored", () => {
    const es = edges(vault(BASE).dbPath);
    const l = es.find((e) => e.src === "raw/software/alpha/evil.md" && e.kind === "link");
    assert.equal(l?.t, 0);
    assert.ok(!has(es, "raw/software/alpha/evil.md", "wiki/software/lonely.md", "source"));
  });
});

describe("graph boost", () => {
  it("an untrusted note's links never boost a trusted note (control: a trusted link does)", () => {
    const { dbPath } = vault(BASE);
    const db = openReadOnly(dbPath);
    try {
      assert.ok(boostNeighbours(db, ["wiki/software/alpha.md"]).has("wiki/software/beta.md"), "control");
      assert.ok(!boostNeighbours(db, ["raw/software/alpha/evil.md"]).has("wiki/software/lonely.md"), "evil -> lonely gives no boost");
      assert.ok(!boostNeighbours(db, ["wiki/software/lonely.md"]).has("raw/software/alpha/evil.md"), "nor the other way round");
    } finally { db.close(); }
  });
  it("graph off is byte-identical to today's search; graph on can change results (control)", () => {
    const { dbPath } = vault(BASE);
    const db = openReadOnly(dbPath);
    try {
      for (const q of ["alpha", "beta cycle", "snapshot repo facts", "nothing matches zzqx"]) {
        assert.equal(JSON.stringify(graphSearch(db, { query: q }, null, false)), JSON.stringify(search(db, { query: q })), q);
        assert.equal(JSON.stringify(graphSearch(db, { query: q }, null, false)), JSON.stringify(hybridSearch(db, { query: q }, null)), q);
      }
      const on = graphSearch(db, { query: "repo facts", limit: 10 }, null, true).map((h) => h.path);
      const off = search(db, { query: "repo facts", limit: 10 }).map((h) => h.path);
      assert.notDeepEqual(on, off, "control: the graph list really is used when on");
      assert.ok(on.includes("wiki/software/alpha.md"), "the project note of the hit comes in by the graph");
    } finally { db.close(); }
  });
  it("is off by default and switched by SUPEROS_BRAIN_GRAPH", () => {
    assert.equal(graphEnabled({}), false);
    assert.equal(graphEnabled({ SUPEROS_BRAIN_GRAPH: "on" }), true);
    assert.equal(graphEnabled({ SUPEROS_BRAIN_GRAPH: "off" }), false);
  });
});

describe("related and graph_overview", () => {
  it("related: neighbours with edge types, depth 2 through a cycle ends, no duplicates", () => {
    const { dbPath } = vault(BASE);
    const db = openReadOnly(dbPath);
    try {
      const r1 = related(db, "wiki/software/alpha.md", 1);
      const by = Object.fromEntries(r1.map((r) => [r.path, r.edge]));
      assert.equal(by["wiki/software/beta.md"], "links to");
      assert.equal(by["raw/software/alpha/snapshot.md"], "cites");
      assert.equal(by["wiki/software/gamma.md"], "links to");
      const r2 = related(db, "wiki/software/beta.md", 2);
      assert.equal(new Set(r2.map((r) => r.path)).size, r2.length, "no duplicates");
      assert.ok(!r2.some((r) => r.path === "wiki/software/beta.md"), "never itself");
      assert.ok(r2.some((r) => r.depth === 2 && r.via === "wiki/software/alpha.md"), "a second hop through alpha");
      const g = related(db, "wiki/software/gamma.md", 1);
      assert.ok(g.some((r) => r.path === "wiki/software/alpha.md" && (r.edge === "linked from" || r.edge === "same source")));
    } finally { db.close(); }
  });
  it("graph_overview: orphans are wiki notes with no links or sources; an index or an untrusted link doesn't rescue one", () => {
    const { dbPath } = vault(BASE);
    const db = openReadOnly(dbPath);
    try {
      const s = graphSummary(db, 5);
      assert.ok(s.orphans.paths.includes("wiki/software/lonely.md"), "linked only by the generated index and an untrusted note: still an orphan");
      assert.ok(!s.hubs.some((h) => h.path === "raw/software/alpha/evil.md"), "an untrusted note's own links don't make it a hub");
      assert.ok(s.hubs.length > 0 && s.hubs[0]!.degree >= s.hubs.at(-1)!.degree);
      assert.ok(!s.orphans.paths.includes("wiki/software/alpha.md"), "control: a linked note is no orphan");
    } finally { db.close(); }
  });
  it("through the brain server: a hostile untrusted title comes back fenced, on one line, and can't close the fence", () => {
    const files = { ...BASE, "raw/software/alpha/hostile.md": `---\ntitle: ${HOSTILE_LINE.slice(0, 280)}\n---\nbody [[wiki/software/alpha]]\n`, "wiki/software/alpha.md": BASE["wiki/software/alpha.md"].replace("Alpha links", "Alpha links to [[raw/software/alpha/hostile]] and") };
    const { vault: v, dbPath } = vault(files);
    const call = (name: string, args: unknown) => handleMessage({ vault: v, dbPath }, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })!.result as { isError: boolean; content: { text: string }[] };
    const r = call("related", { path: "wiki/software/alpha.md" });
    assert.equal(r.isError, false);
    const body = JSON.parse(r.content[0]!.text) as { related: { path: string; trusted: boolean; title: string }[] };
    const h = body.related.find((x) => x.path === "raw/software/alpha/hostile.md");
    assert.ok(h, "control: the hostile note is a neighbour");
    assert.equal(h.trusted, false);
    assert.ok(h.title.startsWith("<untrusted-data") && h.title.endsWith("</untrusted-data>"));
    assert.equal(h.title.match(/<\/untrusted-data>/g)?.length, 1, "the title can't close the fence early");
    assert.ok(!INVISIBLE.test(h.title));
    const ov = JSON.parse(call("graph_overview", {}).content[0]!.text) as { hubs: { path: string; title: string; trusted: boolean }[] };
    for (const hub of ov.hubs) if (!hub.trusted && hub.title) assert.ok(hub.title.startsWith("<untrusted-data"));
    for (const bad of [{ path: "../.env" }, { path: "os/config/x.md" }, { path: "wiki/software/missing.md" }, { path: "wiki/software/alpha.md", depth: 3 }, { path: "wiki/software/alpha.md", extra: 1 }]) assert.equal(call("related", bad).isError, true, JSON.stringify(bad));
  });
  it("an index built before the graph (no edges table) gives empty results, not errors", () => {
    const { dbPath } = vault(BASE);
    const w = new DatabaseSync(dbPath);
    w.exec("DROP TABLE edges");
    w.close();
    const db = openReadOnly(dbPath);
    try {
      assert.deepEqual(related(db, "wiki/software/alpha.md", 2), []);
      assert.equal(graphSummary(db).hubs.length, 0);
      assert.equal(JSON.stringify(graphSearch(db, { query: "alpha" }, null, true).map((h) => h.path)), JSON.stringify(search(db, { query: "alpha" }).map((h) => h.path)));
    } finally { db.close(); }
  });
});

describe("who gets the graph tools", () => {
  it("T2 runs get related, vault-cleanup also gets graph_overview, T3 runs get neither", () => {
    assert.deepEqual(brainGraphTools("T2"), ["mcp__superos-brain__related"]);
    assert.deepEqual(brainGraphTools("T2", "vault-cleanup"), ["mcp__superos-brain__related", "mcp__superos-brain__graph_overview"]);
    assert.deepEqual(brainGraphTools("T3"), []);
    assert.deepEqual(brainGraphTools("T3", "code-quality"), []);
  });
});

describe("GET /api/brain/graph", () => {
  it("needs a session and our origin; returns counts and hub titles only", async (t) => {
    const v = makeVault();
    const logs = mkdtempSync(path.join(tmpdir(), "graph-logs-"));
    writeFileSync(path.join(v, "wiki/software/hub.md"), note("Hub title", "BODYSECRET [[wiki/software/two]]"));
    writeFileSync(path.join(v, "wiki/software/two.md"), note("Two", "BODYSECRET [[wiki/software/hub]]"));
    const brainDb = path.join(logs, "brain-index.sqlite");
    rebuildIndex(v, brainDb);
    const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bridge", "fake-claude.ts");
    const b = createBridge(path.join(v, "os"), { claudeBin: { cmd: process.execPath, prefixArgs: [fake] }, logDir: logs, brainDbPath: brainDb });
    await new Promise<void>((r) => b.server.listen(0, "127.0.0.1", r));
    t.after(() => { b.runs.stopAll(); b.server.close(); });
    const base = `http://127.0.0.1:${(b.server.address() as AddressInfo).port}`;
    const token = b.mint();
    const get = (headers: Record<string, string>) => fetch(base + "/api/brain/graph", { headers });
    assert.equal((await get({})).status, 401, "no session");
    assert.equal((await get({ authorization: `Bearer ${token}`, origin: "http://evil.example" })).status, 403, "foreign origin");
    const ok = await get({ authorization: `Bearer ${token}`, origin: base });
    assert.equal(ok.status, 200, "control");
    const text = await ok.text();
    const g = JSON.parse(text) as { available: boolean; notes: number; edges: Record<string, number>; hubs: { path: string; title: string }[] };
    assert.equal(g.available, true);
    assert.ok(g.edges["link"]! >= 2 && g.hubs.some((h) => h.path === "wiki/software/hub.md"));
    assert.ok(!text.includes("BODYSECRET"), "titles and counts only, never a body");
  });
});

describe("bench (small, CI-sized)", () => {
  it("builds a synthetic vault in a temp folder, measures graph off and on, and deletes it", async () => {
    const { readdirSync } = await import("node:fs");
    const { runBench, SMALL } = await import("./bench.ts");
    const before = new Set(readdirSync(tmpdir()).filter((n) => n.startsWith("brain-bench-")));
    const b = runBench(SMALL);
    assert.ok(b.graphOn.notes >= 300 && b.graphOn.edges > 0 && b.graphOff.edges === 0, "control: a real graph was built");
    assert.ok(b.graphOn.p95Ms > 0 && b.graphOff.p95Ms > 0);
    // Generous bounds so a slow CI machine can't flake; the real numbers at full size are in docs/STATUS.md.
    assert.ok(b.deltaP95Ms < 50, `graph p95 cost ${b.deltaP95Ms} ms`);
    assert.ok(b.sizeIncreasePct < 40, `index growth ${b.sizeIncreasePct}%`);
    const after = readdirSync(tmpdir()).filter((n) => n.startsWith("brain-bench-") && !before.has(n));
    assert.deepEqual(after, [], "the temp folder is removed");
  });
});
