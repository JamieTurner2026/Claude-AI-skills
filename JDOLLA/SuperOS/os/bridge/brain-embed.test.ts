// Fresh vectors before runs: the bridge's pre-run rebuild also embeds new chunks, in the background, capped
// in time, only when local meaning search is already set up. A fake embedder stands in: nothing downloads.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Embedder } from "../brain/embeddings.ts";
import { hybridSearch } from "../brain/hybrid.ts";
import { openReadOnly } from "../brain/search.ts";
import { BrainLink, localEmbedderLoader } from "./brain-link.ts";
import { pathsFor } from "./config.ts";

const CONCEPTS: Record<string, string> = { car: "car", cars: "car", automobile: "car", vehicle: "car", boat: "boat", ship: "boat", vessel: "boat" };
function fakeEmbedder(opts: { onEmbed?: (n: number) => void | Promise<void> } = {}): Embedder & { batches: number[] } {
  const batches: number[] = [];
  return {
    id: "fake@1", dimensions: 32, batches,
    async embed(texts) {
      batches.push(texts.length);
      await opts.onEmbed?.(texts.length);
      return texts.map((t) => {
        const v = new Float32Array(32);
        for (const w of t.toLowerCase().match(/[a-z]+/g) ?? []) {
          const c = CONCEPTS[w] ?? w;
          let h = 0;
          for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
          v[h % 32]! += CONCEPTS[w] ? 3 : 1;
        }
        const n = Math.hypot(...v) || 1;
        return v.map((x) => x / n);
      });
    },
  };
}

function setup(notes = 3) {
  const root = mkdtempSync(path.join(tmpdir(), "brain-embed-"));
  const vault = path.join(root, "vault");
  const w = (rel: string, text: string) => { const f = path.join(vault, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); };
  mkdirSync(path.join(vault, "os"), { recursive: true });
  w("wiki/software/garage.md", "# Garage app\nCompare used cars for sale.\n");
  for (let i = 0; i < notes; i++) w(`wiki/ai/note${i}.md`, `# Note ${i}\nPlain words number ${i}.\n`);
  return { root, vault, w, dbPath: path.join(root, "index.sqlite") };
}
const vectorCount = (dbPath: string): number => {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'vectors'").get()) return 0;
    return Number((db.prepare("SELECT count(*) AS n FROM vectors").get() as { n: number }).n);
  } finally { db.close(); }
};
async function meaningFind(dbPath: string, e: Embedder, query: string): Promise<string[]> {
  const [v] = await e.embed([query]);
  const db = openReadOnly(dbPath);
  try { return hybridSearch(db, { query }, { model: e.id, vector: v! }).map((h) => h.path); } finally { db.close(); }
}

describe("fresh vectors before runs", () => {
  it("a note added later becomes findable by meaning after the next rebuild", async () => {
    const { vault, w, dbPath } = setup();
    const e = fakeEmbedder();
    const logs: string[] = [];
    const link = new BrainLink({ paths: pathsFor(path.join(vault, "os")), dbPath, log: (l) => logs.push(String(l["kind"])), loadEmbedder: async () => e });
    assert.equal(link.ensureFresh(), true);
    await link.embeddingDone();
    w("wiki/strategy/harbor.md", "# Harbor plan\nWhere to moor the vessel in winter.\n");
    assert.ok(!(await meaningFind(dbPath, e, "boat")).includes("wiki/strategy/harbor.md"), "control: not found before the rebuild");
    link.markStale();
    assert.equal(link.ensureFresh(), true);
    const s = await link.embeddingDone();
    assert.equal(s?.embedded, 1, "only the new chunk is embedded");
    assert.equal((await meaningFind(dbPath, e, "boat"))[0], "wiki/strategy/harbor.md");
    assert.ok(logs.includes("brain-embed"));
  });

  it("the run does not wait: ensureFresh returns while embedding is still going", async () => {
    const { vault, dbPath } = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const e = fakeEmbedder({ onEmbed: () => gate });
    const link = new BrainLink({ paths: pathsFor(path.join(vault, "os")), dbPath, log: () => undefined, loadEmbedder: async () => e });
    const t0 = Date.now();
    assert.equal(link.ensureFresh(), true);
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(vectorCount(dbPath), 0, "nothing written yet: the embedder is still busy");
    release();
    await link.embeddingDone();
    assert.ok(vectorCount(dbPath) > 0);
  });

  it("the time cap stops new batches, and the next rebuild finishes the rest", async () => {
    const { vault, dbPath } = setup(30);
    let clock = 1_000_000;
    const e = fakeEmbedder({ onEmbed: () => { clock += 2_000; } }); // each batch "takes" 2 s
    const logs: Record<string, unknown>[] = [];
    const link = new BrainLink({ paths: pathsFor(path.join(vault, "os")), dbPath, log: (l) => logs.push(l), now: () => clock, loadEmbedder: async () => e, embedBudgetMs: 5_000 });
    link.ensureFresh();
    const first = await link.embeddingDone();
    assert.equal(e.batches.length, 3, "batches start at 0 s, 2 s and 4 s; none at 6 s");
    assert.ok((first?.remaining ?? 0) > 0);
    assert.ok(logs.some((l) => l["kind"] === "brain-embed" && Number(l["remaining"]) > 0));
    link.markStale();
    link.ensureFresh();
    const second = await link.embeddingDone();
    assert.equal(second?.cached, first?.embedded, "the first pass's vectors were kept");
    for (let i = 0; i < 5 && (second?.remaining ?? 0) > 0; i++) { link.markStale(); link.ensureFresh(); await link.embeddingDone(); }
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const chunks = Number((db.prepare("SELECT count(*) AS n FROM documents").get() as { n: number }).n);
      assert.equal(vectorCount(dbPath), chunks, "every chunk embedded after enough rebuilds");
    } finally { db.close(); }
  });

  it("not set up: a silent no-op that writes no vectors and logs nothing about embeddings", async () => {
    const { vault, dbPath } = setup();
    const logs: string[] = [];
    let loads = 0;
    const link = new BrainLink({ paths: pathsFor(path.join(vault, "os")), dbPath, log: (l) => logs.push(String(l["kind"])), loadEmbedder: async () => { loads++; return null; } });
    assert.equal(link.ensureFresh(), true);
    await link.embeddingDone();
    assert.equal(vectorCount(dbPath), 0);
    assert.deepEqual(logs, ["brain-index"]);
    link.markStale(); link.ensureFresh(); await link.embeddingDone();
    assert.equal(loads, 2, "checked again on the next rebuild, so setting it up later works without a restart");
  });

  it("the default loader never downloads: with no runtime it returns null and creates nothing", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "embed-dir-"));
    const prev = process.env["SUPEROS_EMBED_DIR"];
    process.env["SUPEROS_EMBED_DIR"] = dir;
    try {
      assert.equal(await localEmbedderLoader(), null);
      assert.deepEqual(readdirSync(dir), []);
      const pkg = path.join(dir, "runtime", "node_modules", "@huggingface", "transformers");
      mkdirSync(pkg, { recursive: true });
      writeFileSync(path.join(pkg, "package.json"), "{}");
      assert.equal(await localEmbedderLoader(), null, "runtime but no model: still a no-op, no fetch");
      assert.deepEqual(readdirSync(dir), ["runtime"]);
    } finally { if (prev === undefined) delete process.env["SUPEROS_EMBED_DIR"]; else process.env["SUPEROS_EMBED_DIR"] = prev; }
  });

  it("an embedder that fails is logged and never breaks the run", async () => {
    const { vault, dbPath } = setup();
    const logs: string[] = [];
    const bad: Embedder = { id: "bad", dimensions: 32, embed: async () => { throw new Error("out of memory"); } };
    const link = new BrainLink({ paths: pathsFor(path.join(vault, "os")), dbPath, log: (l) => logs.push(String(l["kind"])), loadEmbedder: async () => bad });
    assert.equal(link.ensureFresh(), true);
    assert.equal(await link.embeddingDone(), null);
    assert.ok(logs.includes("brain-embed-failed"));
    assert.equal(link.ensureFresh(), true, "the index itself is still fine");
  });

  it("one embedding at a time: a second rebuild during the first does not start another", async () => {
    const { vault, dbPath } = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let active = 0, maxActive = 0;
    const e = fakeEmbedder({ onEmbed: async () => { active++; maxActive = Math.max(maxActive, active); await gate; active--; } });
    const link = new BrainLink({ paths: pathsFor(path.join(vault, "os")), dbPath, log: () => undefined, loadEmbedder: async () => e });
    link.ensureFresh();
    link.markStale();
    link.ensureFresh();
    release();
    await link.embeddingDone();
    assert.equal(maxActive, 1);
  });
});
