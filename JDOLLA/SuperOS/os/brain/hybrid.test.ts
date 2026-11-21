// Hybrid search tests. A fake embedder stands in for the model, so nothing is ever downloaded here.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { compareEval } from "./embed-cli.ts";
import { loadLocalEmbedder, tryLoadEmbedder, type Embedder } from "./embeddings.ts";
import type { EvalFile } from "./eval.ts";
import { makeBrainVault } from "./fixture.ts";
import { embedIndex, hybridSearch, rrf, vectorCoverage } from "./hybrid.ts";
import { rebuildIndex } from "./indexer.ts";
import { handleMessage } from "./mcp.ts";
import { makeQueryVectorizer } from "./query-vectors.ts";
import { openReadOnly, search } from "./search.ts";

// Words map to "concepts", so synonyms land on the same dimension. Deterministic, 64 dimensions, normalised.
const CONCEPTS: Record<string, string> = { car: "car", cars: "car", automobile: "car", vehicle: "car", servo: "motor", motor: "motor", drive: "motor", ocean: "sea", sea: "sea", marine: "sea" };
class FakeEmbedder implements Embedder {
  readonly dimensions = 64;
  calls = 0;
  readonly id: string;
  constructor(id = "fake@1") { this.id = id; }
  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    this.calls++;
    return texts.map((t) => {
      const v = new Float32Array(this.dimensions);
      for (const w of t.toLowerCase().match(/[a-z]+/g) ?? []) {
        const c = CONCEPTS[w] ?? w;
        let h = 0;
        for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        v[h % this.dimensions]! += CONCEPTS[w] ? 3 : 1;
      }
      const n = Math.hypot(...v) || 1;
      return v.map((x) => x / n);
    });
  }
}

function setup() {
  const { vault, dir } = makeBrainVault();
  const w = (rel: string, text: string) => { const f = path.join(vault, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); };
  w("wiki/software/garage.md", "# Garage app\nA tool to compare used cars for sale and track each car's price.\n");
  w("raw/strategy/ocean.md", "# Shipping notes\nMarine freight schedules across the sea.\n");
  const dbPath = path.join(dir, "index.sqlite");
  rebuildIndex(vault, dbPath);
  return { vault, dir, dbPath };
}
async function embedAll(dbPath: string, e: Embedder) { const db = new DatabaseSync(dbPath); try { return await embedIndex(db, e); } finally { db.close(); } }
async function hybrid(dbPath: string, e: Embedder, query: string, o: object = {}) {
  const [v] = await e.embed([query]);
  const db = openReadOnly(dbPath);
  try { return hybridSearch(db, { query, ...o }, { model: e.id, vector: v! }); } finally { db.close(); }
}
const kw = (dbPath: string, query: string, o: object = {}) => { const db = openReadOnly(dbPath); try { return search(db, { query, ...o }); } finally { db.close(); } };

describe("rrf", () => {
  it("matches a hand count and breaks ties by id", () => {
    const r = rrf([[1, 2, 3], [3, 1]], 60);
    assert.deepEqual(r.map((x) => x.id), [1, 3, 2]);
    assert.ok(Math.abs(r[0]!.score - (1 / 61 + 1 / 62)) < 1e-12);
    assert.ok(Math.abs(r[1]!.score - (1 / 63 + 1 / 61)) < 1e-12);
    assert.deepEqual(rrf([[5], [4]]).map((x) => x.id), [4, 5]);
  });
});

describe("vectors in the index", () => {
  it("embeds every chunk once; a second run and a keyword-only rebuild reuse them", async () => {
    const { vault, dbPath } = setup();
    const e = new FakeEmbedder();
    const first = await embedAll(dbPath, e);
    assert.ok(first.chunks > 0 && first.embedded === first.chunks && first.cached === 0);
    assert.deepEqual(await embedAll(dbPath, e), { chunks: first.chunks, embedded: 0, cached: first.chunks, pruned: 0 });
    rebuildIndex(vault, dbPath); // what the bridge does before every run: renumbers documents, keyword only
    const db = openReadOnly(dbPath);
    try { assert.equal(vectorCoverage(db, e.id), 1); } finally { db.close(); }
    assert.equal((await embedAll(dbPath, e)).embedded, 0);
  });
  it("a changed note re-embeds only its chunk and prunes the old vector; a new model replaces the old one", async () => {
    const { vault, dbPath } = setup();
    const e = new FakeEmbedder();
    await embedAll(dbPath, e);
    writeFileSync(path.join(vault, "wiki/software/garage.md"), "# Garage app\nNow it also tracks vehicle repairs.\n");
    rebuildIndex(vault, dbPath);
    const s = await embedAll(dbPath, e);
    assert.equal(s.embedded, 1);
    assert.equal(s.pruned, 1);
    const s2 = await embedAll(dbPath, new FakeEmbedder("fake@2"));
    assert.equal(s2.embedded, s2.chunks);
    assert.equal(s2.pruned, s2.chunks); // every fake@1 vector removed
  });
  it("refuses vectors of the wrong size or count", async () => {
    const { dbPath } = setup();
    const bad: Embedder = { id: "bad", dimensions: 64, embed: async (t) => t.map(() => new Float32Array(3)) };
    await assert.rejects(embedAll(dbPath, bad), /dimensions/);
    const short: Embedder = { id: "short", dimensions: 64, embed: async () => [] };
    await assert.rejects(embedAll(dbPath, short), /wrong number/);
  });
});

describe("hybrid search", () => {
  it("control: with no query vector it is exactly keyword search", () => {
    const { dbPath } = setup();
    const db = openReadOnly(dbPath);
    try {
      for (const q of ["servo alarm", "garage", "nothing matches zzqx"]) {
        assert.deepEqual(hybridSearch(db, { query: q }, null), search(db, { query: q }), q);
      }
    } finally { db.close(); }
  });
  it("finds a note by meaning that keyword search misses", async () => {
    const { dbPath } = setup();
    const e = new FakeEmbedder();
    await embedAll(dbPath, e);
    assert.ok(!kw(dbPath, "automobile").some((h) => h.path === "wiki/software/garage.md"), "fixture: keyword search must miss it");
    const hits = await hybrid(dbPath, e, "automobile");
    assert.equal(hits[0]?.path, "wiki/software/garage.md");
    assert.equal(hits[0]?.trusted, true);
  });
  it("keeps keyword hits that match exactly", async () => {
    const { dbPath } = setup();
    const e = new FakeEmbedder();
    await embedAll(dbPath, e);
    assert.equal((await hybrid(dbPath, e, "servo alarm 42"))[0]?.path, "wiki/industrial/servo.md");
  });
  it("respects trustedOnly and dept for vector-only hits too", async () => {
    const { dbPath } = setup();
    const e = new FakeEmbedder();
    await embedAll(dbPath, e);
    assert.ok((await hybrid(dbPath, e, "ocean")).some((h) => h.path === "raw/strategy/ocean.md" && !h.trusted), "control: the raw/ note is found");
    assert.ok((await hybrid(dbPath, e, "ocean", { trustedOnly: true })).every((h) => h.trusted && !h.path.startsWith("raw/")));
    assert.ok((await hybrid(dbPath, e, "automobile", { dept: "industrial" })).every((h) => h.dept === "industrial"));
  });
  it("a raw/ note found only by meaning still comes back fenced as untrusted from the brain server", async () => {
    const { vault, dbPath } = setup();
    const e = new FakeEmbedder();
    await embedAll(dbPath, e);
    const [v] = await e.embed(["ocean"]);
    const reply = handleMessage({ vault, dbPath, vectors: new Map([["ocean", { model: e.id, vector: v! }]]) }, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search", arguments: { query: "ocean" } } });
    const body = JSON.parse((reply!.result as { content: { text: string }[] }).content[0]!.text) as { hits: { path: string; trusted: boolean; snippet: string }[] };
    const h = body.hits.find((x) => x.path === "raw/strategy/ocean.md");
    assert.ok(h, "the raw/ note must be returned for this to mean anything");
    assert.equal(h.trusted, false);
    assert.ok(h.snippet.startsWith('<untrusted-data source="raw/strategy/ocean.md">') && h.snippet.endsWith("</untrusted-data>"));
  });
});

describe("opt-in and fallback", () => {
  it("with no runtime installed, loading fails fast and writes nothing", async () => {
    const base = mkdtempSync(path.join(tmpdir(), "embed-"));
    await assert.rejects(loadLocalEmbedder({ allowDownload: false, base }), /runtime not installed/);
    const r = await tryLoadEmbedder({ base });
    assert.equal(r.embedder, null);
    assert.match(r.note, /keyword search only/);
    assert.deepEqual(readdirSync(base), []);
  });
  it("with the runtime present but no model, a search-time load refuses instead of downloading", async () => {
    const base = mkdtempSync(path.join(tmpdir(), "embed-"));
    const pkg = path.join(base, "runtime", "node_modules", "@huggingface", "transformers");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "@huggingface/transformers", main: "missing.js" }));
    await assert.rejects(loadLocalEmbedder({ allowDownload: false, base }), /model not downloaded/);
    assert.deepEqual(readdirSync(base), ["runtime"]); // no models/ folder: nothing was fetched
  });
  it("the server's query vectorizer never throws and falls back to keywords", async () => {
    const { dbPath } = setup();
    const e = new FakeEmbedder();
    const logs: string[] = [];
    const msg = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search", arguments: { query: "automobile" } } };
    let loads = 0;
    const failing = makeQueryVectorizer(async () => { loads++; throw new Error("boom"); }, (s) => logs.push(s));
    assert.equal(await failing(dbPath, msg), null);
    assert.equal(await failing(dbPath, msg), null);
    assert.equal(loads, 1, "a failed load is not retried on every query");
    assert.match(logs.join("\n"), /keyword search only/);
    const working = makeQueryVectorizer(async () => ({ embedder: e, note: "ok" }), () => {});
    assert.equal(await working(dbPath, msg), null, "no vectors in the index yet: keyword search");
    await embedAll(dbPath, e);
    assert.ok((await working(dbPath, msg))?.get("automobile"), "control: with vectors it embeds the query");
    assert.equal(await working(dbPath, { ...msg, params: { name: "get_note", arguments: { path: "wiki/x.md" } } }), null);
    process.env["SUPEROS_BRAIN_HYBRID"] = "off";
    try { assert.equal(await working(dbPath, msg), null); } finally { delete process.env["SUPEROS_BRAIN_HYBRID"]; }
    const throwing = makeQueryVectorizer(async () => ({ embedder: { id: e.id, dimensions: 64, embed: async () => { throw new Error("oom"); } }, note: "ok" }), (s) => logs.push(s));
    assert.equal(await throwing(dbPath, msg), null);
  });
});

describe("eval: keyword vs hybrid", () => {
  const ef: EvalFile = { version: 1, questions: [
    { id: "a", style: "keyword", query: "servo alarm 42", relevant: ["wiki/industrial/servo.md"] },
    { id: "b", style: "synonym", query: "automobile", relevant: ["wiki/software/garage.md"] },
  ] };
  it("scores both on the same set, and hybrid wins the synonym question", async () => {
    const { dbPath } = setup();
    const e = new FakeEmbedder();
    await embedAll(dbPath, e);
    const c = await compareEval(ef, dbPath, 1, e);
    assert.equal(c.keyword.byStyle["synonym"]?.hitAtK, 0);
    assert.equal(c.hybrid?.byStyle["synonym"]?.hitAtK, 1);
    assert.equal(c.hybrid?.byStyle["keyword"]?.hitAtK, 1);
  });
  it("without embeddings (or with missing vectors) only keyword is scored, with a note", async () => {
    const { dbPath } = setup();
    const none = await compareEval(ef, dbPath, 1, null);
    assert.equal(none.hybrid, null);
    const partial = await compareEval(ef, dbPath, 1, new FakeEmbedder());
    assert.equal(partial.hybrid, null);
    assert.match(partial.note, /cover 0%/);
  });
});
