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
import { graphSummary, graphVotes, related } from "./graph.ts";
import { connectedEnabled, connectedNotes, graphEnabled, graphSearch, hybridSearch, RERANK_POOL, rerank } from "./hybrid.ts";
import { rebuildIndex } from "./indexer.ts";
import { handleMessage } from "./mcp.ts";
import { openReadOnly, search, type SearchHit } from "./search.ts";

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

describe("graph votes", () => {
  it("an untrusted note's links never vote for a trusted note (control: a trusted link does)", () => {
    const { dbPath } = vault(BASE);
    const db = openReadOnly(dbPath);
    try {
      assert.ok(graphVotes(db, ["wiki/software/alpha.md"]).has("wiki/software/beta.md"), "control");
      assert.ok(!graphVotes(db, ["raw/software/alpha/evil.md"]).has("wiki/software/lonely.md"), "evil -> lonely gives no vote");
      assert.ok(!graphVotes(db, ["wiki/software/lonely.md"]).has("raw/software/alpha/evil.md"), "nor the other way round");
      assert.ok(!graphVotes(db, ["wiki/software/beta.md"]).has("wiki/software/charter.md"), "dept edges never vote");
    } finally { db.close(); }
  });
  it("a 40-link hub's vote is smaller than a 2-link note's (control: without the 39 other links they are equal)", () => {
    const files = (crowd: number): Record<string, string> => {
      const f: Record<string, string> = {
        "wiki/x/seed.md": note("Seed", "See [[wiki/x/hub]] and [[wiki/x/small]]."),
        "wiki/x/hub.md": note("Hub", "A hub."),
        "wiki/x/small.md": note("Small", "Small links to [[wiki/x/other]]."),
        "wiki/x/other.md": note("Other", "Other."),
      };
      for (let i = 0; i < crowd; i++) f[`wiki/x/n${i}.md`] = note(`N${i}`, "Points at [[wiki/x/hub]].");
      return f;
    };
    const score = (crowd: number) => {
      const db = openReadOnly(vault(files(crowd)).dbPath);
      try { const v = graphVotes(db, ["wiki/x/seed.md"]); return { hub: v.get("wiki/x/hub.md")!.score, small: v.get("wiki/x/small.md")!.score }; } finally { db.close(); }
    };
    const busy = score(39);
    assert.ok(busy.hub < busy.small, `hub ${busy.hub} < small ${busy.small}`);
    assert.ok(busy.hub < busy.small / 2, "by a clear margin");
    const quiet = score(0);
    assert.equal(quiet.hub, quiet.small, "control: same degree, same vote");
  });
});

/** A ranking by hand over a real edges table: d is first, a and b link each other, c and far are unlinked, e is linked from d only. */
const RR = {
  "wiki/x/d.md": note("D", "Dee. Links to [[wiki/x/e]]."),
  "wiki/x/a.md": note("A", "Aye. Links to [[wiki/x/b]]."),
  "wiki/x/b.md": note("B", "Bee."),
  "wiki/x/c.md": note("C", "Cee."),
  "wiki/x/e.md": note("E", "Not a candidate."),
  "raw/x/evil.md": "# Evil\nLinks to [[wiki/x/c]] to get it lifted.\n",
};
const hit = (p: string, score: number, id: number): SearchHit => ({ id, path: p, heading: "", dept: "x", type: "concept", title: p, updated: "", trusted: p.startsWith("wiki/"), snippet: "", score });
const ranked = (scores: number[], paths = ["wiki/x/d.md", "wiki/x/a.md", "wiki/x/b.md", "wiki/x/c.md"]) => paths.map((p, i) => hit(p, scores[i]!, i + 1));

describe("graph re-rank", () => {
  it("reorders close text hits by their links: b, linked from a, passes d", () => {
    const db = openReadOnly(vault(RR).dbPath);
    try {
      const hits = ranked([-10, -9.8, -9.6, -9.4]);
      assert.deepEqual(rerank(db, hits, { lambda: 0.002, gate: 0.25 }).map((h) => h.path), ["wiki/x/a.md", "wiki/x/b.md", "wiki/x/d.md", "wiki/x/c.md"]);
    } finally { db.close(); }
  });
  it("never adds a note that was not a text candidate, and never drops one (control: the linked note is listed as connected)", () => {
    const db = openReadOnly(vault(RR).dbPath);
    try {
      const hits = ranked([-10, -9.8, -9.6, -9.4]);
      const out = rerank(db, hits, { lambda: 10, gate: Infinity });
      assert.deepEqual(out.map((h) => h.id).sort(), hits.map((h) => h.id).sort(), "a permutation of the input");
      assert.ok(!out.some((h) => h.path === "wiki/x/e.md"), "e is linked from the top hit but is not a candidate");
      assert.ok(connectedNotes(db, hits, { query: "x" }).some((c) => c.path === "wiki/x/e.md" && c.via === "wiki/x/d.md"), "control");
      // Past the pool nothing moves, even when it is linked.
      const many = Array.from({ length: RERANK_POOL + 2 }, (_, i) => hit(i === RERANK_POOL + 1 ? "wiki/x/b.md" : `wiki/x/f${i}.md`, -10 + i * 0.01, i + 1));
      many[0] = hit("wiki/x/a.md", -10, 1);
      assert.equal(rerank(db, many, { lambda: 10, gate: Infinity }), many, "b is 12th: outside the pool, so the list is returned as it was");
    } finally { db.close(); }
  });
  it("leaves a clear text winner alone (control: with no gate the same hits move)", () => {
    const db = openReadOnly(vault(RR).dbPath);
    try {
      const clear = ranked([-10, -3, -2.9, -2.8]);
      assert.equal(rerank(db, clear, { lambda: 0.002, gate: 0.25 }), clear, "gap 0.71: gate closed, the very same list back");
      assert.notDeepEqual(rerank(db, clear, { lambda: 0.002, gate: Infinity }).map((h) => h.path), clear.map((h) => h.path), "control");
    } finally { db.close(); }
  });
  it("ignores untrusted edges: a raw note in the top 3 linking to c does not lift c (control: a trusted link lifts b)", () => {
    const db = openReadOnly(vault(RR).dbPath);
    try {
      const hits = ranked([-10, -9.9, -9.8, -9.7], ["wiki/x/d.md", "raw/x/evil.md", "wiki/x/b.md", "wiki/x/c.md"]);
      assert.equal(rerank(db, hits, { lambda: 10, gate: Infinity }), hits, "no trusted edge among the seeds and pool: unchanged");
      const ctl = ranked([-10, -9.9, -9.8, -9.7], ["wiki/x/a.md", "wiki/x/d.md", "wiki/x/c.md", "wiki/x/b.md"]);
      const moved = rerank(db, ctl, { lambda: 0.002, gate: Infinity }).map((h) => h.path);
      assert.ok(moved.indexOf("wiki/x/b.md") < moved.indexOf("wiki/x/d.md"), `control: b (linked from a) passes d: ${moved.join(" ")}`);
    } finally { db.close(); }
  });
  it("graph off is byte-identical to today's search, through real search on the fixture", () => {
    const { dbPath } = vault(BASE);
    const db = openReadOnly(dbPath);
    try {
      for (const q of ["alpha", "beta cycle", "snapshot repo facts", "nothing matches zzqx"]) {
        assert.equal(JSON.stringify(graphSearch(db, { query: q }, null, false)), JSON.stringify(search(db, { query: q })), q);
        assert.equal(JSON.stringify(graphSearch(db, { query: q }, null, false)), JSON.stringify(hybridSearch(db, { query: q }, null)), q);
        const on = graphSearch(db, { query: q, limit: 50 }, null, true, undefined, { lambda: 10, gate: Infinity });
        assert.deepEqual(on.map((h) => h.id).sort(), search(db, { query: q, limit: 50 }).map((h) => h.id).sort(), `on: same hits, maybe reordered (${q})`);
      }
    } finally { db.close(); }
  });
  it("is on by default after the 12b eval, and switched by SUPEROS_BRAIN_GRAPH; connected is on unless switched off", () => {
    assert.equal(graphEnabled({}), true);
    assert.equal(graphEnabled({ SUPEROS_BRAIN_GRAPH: "off" }), false);
    assert.equal(graphEnabled({ SUPEROS_BRAIN_GRAPH: "on" }), true);
    assert.equal(connectedEnabled({}), true);
    assert.equal(connectedEnabled({ SUPEROS_BRAIN_CONNECTED: "off" }), false);
  });
  it("search through the brain server: a hostile untrusted title in 'connected' comes back fenced, on one line", () => {
    const files = { ...BASE, "raw/software/alpha/hostile.md": `---\ntitle: ${HOSTILE_LINE.slice(0, 280)}\n---\nquiet body\n`, "wiki/software/alpha.md": BASE["wiki/software/alpha.md"].replace("Alpha links", "Alpha links to [[raw/software/alpha/hostile]] and") };
    const { vault: v, dbPath } = vault(files);
    const r = handleMessage({ vault: v, dbPath }, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search", arguments: { query: "alpha links", limit: 2 } } })!.result as { isError: boolean; content: { text: string }[] };
    assert.equal(r.isError, false);
    const body = JSON.parse(r.content[0]!.text) as { hits: { path: string }[]; connected?: { path: string; trusted: boolean; title: string; via: string }[] };
    const h = body.connected?.find((c) => c.path === "raw/software/alpha/hostile.md");
    assert.ok(h, "control: the hostile note is connected to the top hit");
    assert.ok(!body.hits.some((x) => x.path === h.path), "connected lists only notes not in the hits");
    assert.equal(h.trusted, false);
    assert.ok(h.title.startsWith("<untrusted-data") && h.title.endsWith("</untrusted-data>"));
    assert.equal(h.title.match(/<\/untrusted-data>/g)?.length, 1, "the title can't close the fence early");
    assert.ok(!INVISIBLE.test(h.title));
    const trustedOnly = JSON.parse((handleMessage({ vault: v, dbPath }, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search", arguments: { query: "alpha links", limit: 2, trustedOnly: true } } })!.result as { content: { text: string }[] }).content[0]!.text) as { connected?: { trusted: boolean }[] };
    assert.ok(!(trustedOnly.connected ?? []).some((c) => !c.trusted), "trustedOnly: no raw/ note in connected either");
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
