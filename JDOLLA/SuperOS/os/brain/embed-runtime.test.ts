// The opt-in embedding runtime (11c): pinned exactly, free of the sharp advisory, and never mixed with vectors from
// another runtime version. Nothing here installs or downloads: the runtime folder is faked on disk.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { LOCAL_MODEL, installedRuntimeVersion, loadLocalEmbedder, localModelId, pinnedRuntimeVersion, runtimeInstalled, runtimeState, type Embedder } from "./embeddings.ts";
import { makeBrainVault } from "./fixture.ts";
import { embedIndex, vectorCoverage } from "./hybrid.ts";
import { rebuildIndex } from "./indexer.ts";
import { checkEmbeddings, type DoctorDeps } from "../bridge/doctor.ts";

const RUNTIME = path.join(path.dirname(fileURLToPath(import.meta.url)), "embed-runtime");
const lock = JSON.parse(readFileSync(path.join(RUNTIME, "package-lock.json"), "utf8")) as { packages: Record<string, { version?: string; dependencies?: Record<string, string> }> };
const semver = (v: string): number[] => (/^(\d+)\.(\d+)\.(\d+)/.exec(v) ?? []).slice(1).map(Number);
const atLeast = (v: string, min: string) => { const [a, b] = [semver(v), semver(min)]; for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!; return !/-/.test(v); };

/** A fake runtime folder holding just the transformers package.json, at the given version (or none). */
function fakeBase(version: string | null): string {
  const base = mkdtempSync(path.join(tmpdir(), "embed-rt-"));
  if (version) {
    const pkg = path.join(base, "runtime", "node_modules", "@huggingface", "transformers");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "@huggingface/transformers", version }));
  }
  return base;
}

describe("the pinned runtime", () => {
  it("is one exact transformers version, the lockfile installs exactly it, and its sharp is past the advisory", () => {
    const v = pinnedRuntimeVersion();
    assert.match(v, /^\d+\.\d+\.\d+$/, "exact, no ^ or ~");
    assert.equal(lock.packages["node_modules/@huggingface/transformers"]?.version, v);
    const sharp = lock.packages["node_modules/sharp"]?.version;
    // GHSA-f88m-g3jw-g9cj and friends: sharp <= 0.35.5-rc.1. Either no sharp at all, or 0.35.5 or later.
    assert.ok(sharp === undefined || atLeast(sharp, "0.35.5"), `sharp ${sharp} is a vulnerable version`);
    assert.equal(atLeast("0.35.5-rc.1", "0.35.5"), false, "control: the release candidate counts as vulnerable");
  });
});

describe("runtime state", () => {
  it("missing, outdated (an older PC setup) and ok are told apart; only the pinned version counts as installed", () => {
    const pinned = pinnedRuntimeVersion();
    assert.deepEqual([runtimeState(fakeBase(null)), runtimeInstalled(fakeBase(null))], ["missing", false]);
    const old = fakeBase("3.8.1");
    assert.deepEqual([runtimeState(old), installedRuntimeVersion(old), runtimeInstalled(old)], ["outdated", "3.8.1", false]);
    assert.deepEqual([runtimeState(fakeBase(pinned)), runtimeInstalled(fakeBase(pinned))], ["ok", true]);
  });

  it("an outdated runtime is refused before anything loads, with both versions and the fix in the message", async () => {
    await assert.rejects(loadLocalEmbedder({ allowDownload: false, base: fakeBase("3.8.1") }), new RegExp(`embedding runtime is 3\\.8\\.1, this version needs ${pinnedRuntimeVersion().replace(/\./g, "\\.")} \\(run: npm run brain -- index --embeddings\\)`));
    await assert.rejects(loadLocalEmbedder({ allowDownload: false, base: fakeBase(null) }), /embedding runtime not installed/);
  });
});

describe("vectors from two runtimes are never mixed", () => {
  it("the id names the model and the runtime version", () => {
    assert.equal(localModelId("4.3.2"), `${LOCAL_MODEL.name}@${LOCAL_MODEL.dtype}+transformers@4.3.2`);
    assert.notEqual(localModelId("3.8.1"), localModelId("4.3.2"));
  });

  it("re-indexing under a new runtime id replaces every old vector; search sees none of the new id until then", async () => {
    const { vault, dir } = makeBrainVault();
    const dbPath = path.join(dir, "index.sqlite");
    rebuildIndex(vault, dbPath);
    const fake = (id: string, fill: number): Embedder => ({ id, dimensions: 4, embed: async (t) => t.map(() => new Float32Array([fill, 0, 0, 0])) });
    const db = new DatabaseSync(dbPath);
    try {
      const first = await embedIndex(db, fake(localModelId("3.8.1"), 1));
      assert.ok(first.embedded > 0);
      assert.equal(vectorCoverage(db, localModelId("4.3.2")), 0, "the new runtime sees no usable vectors yet (keyword search, with a reason)");
      const second = await embedIndex(db, fake(localModelId("4.3.2"), 0.5));
      assert.deepEqual([second.embedded, second.cached, second.pruned], [first.embedded, 0, first.embedded], "all re-embedded, none reused, all old pruned");
      const models = db.prepare("SELECT DISTINCT model FROM vectors").all() as Array<{ model: string }>;
      assert.deepEqual(models.map((m) => m.model), [localModelId("4.3.2")]);
      assert.equal(vectorCoverage(db, localModelId("4.3.2")), 1);
    } finally { db.close(); }
  });
});

describe("the doctor", () => {
  it("tells an outdated runtime from a missing one, and names the fix", () => {
    const row = (r: boolean | "outdated") => checkEmbeddings({ embeddingsRuntime: () => r } as unknown as DoctorDeps);
    assert.deepEqual([row(true).status, row(false).status, row("outdated").status], ["pass", "warn", "warn"]);
    assert.match(row("outdated").detail, /out of date/);
    assert.match(row("outdated").fix ?? "", /index --embeddings/);
    assert.match(row(false).detail, /not set up/);
  });
});
