// Local embeddings for the brain (Phase 7a). Opt-in: nothing here runs unless embeddings were set up with
// `npm run brain -- index --embeddings`, and only that command may download anything.
// Runtime and model files live outside the vault: ~/.superos/brain/embeddings/{runtime,models}.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface Embedder {
  /** Stable id of the model, stored with every vector so a model change forces a re-embed. */
  readonly id: string;
  readonly dimensions: number;
  embed(texts: readonly string[]): Promise<Float32Array[]>;
}

/** The one supported model: small, CPU-only, about 23 MB quantized, 384 dimensions. */
export const LOCAL_MODEL = { name: "Xenova/all-MiniLM-L6-v2", dtype: "q8", dimensions: 384 } as const;
export const LOCAL_MODEL_ID = `${LOCAL_MODEL.name}@${LOCAL_MODEL.dtype}`;
const RUNTIME_PKG = "@huggingface/transformers";

export function embeddingsDir(): string {
  if (process.env["SUPEROS_EMBED_DIR"]) return process.env["SUPEROS_EMBED_DIR"];
  const brain = process.env["SUPEROS_BRAIN_DIR"] ?? path.join(process.env["USERPROFILE"] ?? process.env["HOME"] ?? ".", ".superos", "brain");
  return path.join(brain, "embeddings");
}
const runtimeDir = (base: string): string => path.join(base, "runtime");
const modelsDir = (base: string): string => path.join(base, "models");

export function runtimeInstalled(base = embeddingsDir()): boolean {
  return existsSync(path.join(runtimeDir(base), "node_modules", ...RUNTIME_PKG.split("/"), "package.json"));
}
export function modelPresent(base = embeddingsDir()): boolean {
  return existsSync(path.join(modelsDir(base), ...LOCAL_MODEL.name.split("/"), "onnx", "model_quantized.onnx"));
}

/**
 * Installs the pinned runtime from os/brain/embed-runtime (package.json plus lockfile, so versions and
 * integrity hashes are fixed). --ignore-scripts: no install scripts run; the CPU build ships in the package.
 */
export function installRuntime(base = embeddingsDir()): void {
  const dir = runtimeDir(base);
  mkdirSync(dir, { recursive: true });
  const src = path.join(import.meta.dirname, "embed-runtime");
  for (const f of ["package.json", "package-lock.json"]) copyFileSync(path.join(src, f), path.join(dir, f));
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawnSync(npm, ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev"], { cwd: dir, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`installing the embedding runtime failed (npm exit ${r.status ?? r.error?.message})`);
}

interface TransformersLike {
  env: { cacheDir: string; localModelPath: string; allowRemoteModels: boolean; allowLocalModels: boolean };
  pipeline(task: string, model: string, opts: object): Promise<(texts: string[], o: object) => Promise<{ dims: number[]; data: Float32Array }>>;
}

/**
 * Loads the local model. allowDownload is true only for `index --embeddings`; everywhere else (search, eval,
 * runs) it is false, so a missing model fails fast instead of reaching the network.
 */
export async function loadLocalEmbedder(opts: { allowDownload: boolean; base?: string }): Promise<Embedder> {
  const base = opts.base ?? embeddingsDir();
  if (!runtimeInstalled(base)) throw new Error("embedding runtime not installed (run: npm run brain -- index --embeddings)");
  if (!opts.allowDownload && !modelPresent(base)) throw new Error("embedding model not downloaded (run: npm run brain -- index --embeddings)");
  const req = createRequire(path.join(runtimeDir(base), "package.json"));
  const mod = (await import(pathToFileURL(req.resolve(RUNTIME_PKG)).href)) as TransformersLike & { default?: TransformersLike };
  const t = mod.env ? mod : (mod.default as TransformersLike);
  mkdirSync(modelsDir(base), { recursive: true });
  t.env.cacheDir = modelsDir(base);
  t.env.localModelPath = modelsDir(base);
  t.env.allowLocalModels = true;
  t.env.allowRemoteModels = opts.allowDownload;
  const fe = await t.pipeline("feature-extraction", LOCAL_MODEL.name, { dtype: LOCAL_MODEL.dtype });
  return {
    id: LOCAL_MODEL_ID,
    dimensions: LOCAL_MODEL.dimensions,
    async embed(texts) {
      if (!texts.length) return [];
      const out = await fe(texts.map((s) => s.slice(0, 1200)), { pooling: "mean", normalize: true });
      const d = out.dims[1] ?? LOCAL_MODEL.dimensions;
      return texts.map((_, i) => out.data.slice(i * d, (i + 1) * d));
    },
  };
}

/** Never throws: returns null and a reason when embeddings can't be used, so callers fall back to keywords. */
export async function tryLoadEmbedder(opts: { base?: string } = {}): Promise<{ embedder: Embedder | null; note: string }> {
  try {
    const embedder = await loadLocalEmbedder({ allowDownload: false, ...opts });
    return { embedder, note: `embeddings: ${embedder.id}` };
  } catch (e) {
    return { embedder: null, note: `embeddings unavailable (${e instanceof Error ? e.message : String(e)}); keyword search only` };
  }
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}
