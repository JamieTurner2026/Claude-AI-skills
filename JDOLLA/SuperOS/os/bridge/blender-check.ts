// `npm run blender:check`: does the Blender on this PC do what the Blender skills assume? Verify first, never assume:
// Jay's PC has Blender 4.0.2 while some workflows target 5.x, so every claim here is a measured value.
// Blender is found by argv (never a shell): os/config/os.local.json `blenderBin`, then the BLENDER variable, then PATH,
// then the newest C:\Program Files\Blender Foundation\Blender X.Y\blender.exe. It runs headless with factory settings
// (`-b --factory-startup --python-exit-code 1`), in a temp folder that is always removed, 120 s at most, with no network.
// Checks, each with a measured value:
//   - exit-code control: a script that fails must make Blender exit non-zero, or no other result can be trusted;
//   - version: `blender --version` equals bpy.app.version, and is at least MIN_BLENDER;
//   - the default cube is 2 × 2 × 2 (within 1e-6) and its mesh has 8 vertices;
//   - a 64 × 64 Workbench render is a real PNG of that size and not one flat colour (decoded here, in Node);
//   - a .glb export of the cube holds 1 mesh, 24 vertices and bounds ±1. glTF stores a vertex per face corner for flat
//     faces: 8 corners × 3 faces = 24 (measured with Blender 4.2 and 5.0);
//   - which Eevee engine id this version accepts. Measured: BLENDER_EEVEE_NEXT on 4.2, BLENDER_EEVEE on 5.0. 4.0 and 4.1
//     predate Eevee Next, so BLENDER_EEVEE (release notes; no 4.0 build could be run here). A skill reads this, never guesses;
//   - the total time.
// It writes blender-check.json in the log folder (version, path, checks, time, date; nothing from the scene) for the
// doctor's "Blender (optional)" row. Exit 0 = every check passed, 1 = a check failed, 2 = Blender not found.
import { spawn as nodeSpawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { findOnPath } from "./doctor.ts";

export const MIN_BLENDER = [4, 0] as const;
export const TIMEOUT_MS = 120_000;
export const REPORT_FILE = "blender-check.json";
export const RENDER_SIZE = 64;
export const GLB_CUBE_VERTICES = 24;
const TOL = 1e-6;

export type BlenderBin = { cmd: string; prefixArgs: string[] };
export type Found = { bin: BlenderBin; path: string; source: "os.local.json" | "BLENDER" | "PATH" | "Program Files" };
export type CheckRow = { id: string; label: string; status: "pass" | "fail" | "skip"; value: string };
export type Report = { ok: boolean; version: string | null; path: string; source: Found["source"]; checks: CheckRow[]; durationMs: number; at: string; eevee: string | null };

// ---------- finding Blender ----------

export type FindDeps = { platform: string; env: NodeJS.ProcessEnv; exists: (p: string) => boolean; listDir: (p: string) => string[]; localBlenderBin: () => string | undefined };

/** Blender's folder names under Program Files ("Blender 4.0", "Blender 5.2"), newest first. */
export function programFilesCandidates(d: FindDeps): string[] {
  if (d.platform !== "win32") return [];
  const root = path.win32.join(d.env["ProgramFiles"] ?? "C:\\Program Files", "Blender Foundation");
  const ver = (n: string) => (/^Blender (\d+)\.(\d+)$/.exec(n) ?? []).slice(1).map(Number);
  return d.listDir(root).filter((n) => ver(n).length === 2)
    .sort((a, b) => { const [x, y] = [ver(a), ver(b)]; return y[0]! - x[0]! || y[1]! - x[1]!; })
    .map((n) => path.win32.join(root, n, "blender.exe"));
}

export function findBlender(d: FindDeps): Found | null {
  const as = (p: string, source: Found["source"]): Found => ({ bin: { cmd: p, prefixArgs: [] }, path: p, source });
  const local = d.localBlenderBin();
  if (local) return d.exists(local) ? as(local, "os.local.json") : null; // a set path that is wrong is not silently replaced
  const env = d.env["BLENDER"];
  if (env) return d.exists(env) ? as(env, "BLENDER") : null;
  for (const n of d.platform === "win32" ? ["blender.exe"] : ["blender"]) {
    const p = findOnPath(n, d);
    if (p) return as(p, "PATH");
  }
  for (const p of programFilesCandidates(d)) if (d.exists(p)) return as(p, "Program Files");
  return null;
}

// ---------- reading what Blender wrote ----------

/** Decodes an 8-bit, non-interlaced PNG (grey, grey+alpha, RGB or RGBA) and counts its distinct pixel values. */
export function pngStats(buf: Buffer): { width: number; height: number; colours: number } {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) throw new Error("not a PNG");
  let pos = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  const idat: Buffer[] = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos), kind = buf.toString("ascii", pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]!; type = data[9]!; interlace = data[12]!; }
    else if (kind === "IDAT") idat.push(data);
    else if (kind === "IEND") break;
    pos += 12 + len;
  }
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (depth !== 8 || interlace !== 0 || !channels) throw new Error(`unsupported PNG (depth ${depth}, colour type ${type}, interlace ${interlace})`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error("PNG data is short");
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!, row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[o + x - channels]! : 0, b = y > 0 ? out[o - stride + x]! : 0, c = x >= channels && y > 0 ? out[o - stride + x - channels]! : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      out[o + x] = (row[x]! + pred) & 0xff;
    }
  }
  const seen = new Set<string>();
  for (let i = 0; i < out.length && seen.size < 1000; i += channels) seen.add(out.subarray(i, i + channels).toString("hex"));
  return { width, height, colours: seen.size };
}

/** A .glb's meshes, and the first primitive's POSITION count and bounds. */
export function glbStats(buf: Buffer): { meshes: number; vertices: number; min: number[]; max: number[] } {
  if (buf.length < 20 || buf.toString("ascii", 0, 4) !== "glTF" || buf.readUInt32LE(4) !== 2) throw new Error("not a glTF 2 binary");
  const len = buf.readUInt32LE(12);
  if (buf.toString("ascii", 16, 20) !== "JSON") throw new Error("the first chunk is not JSON");
  const j = JSON.parse(buf.toString("utf8", 20, 20 + len)) as { meshes?: Array<{ primitives: Array<{ attributes: { POSITION?: number } }> }>; accessors?: Array<{ count: number; min?: number[]; max?: number[] }> };
  const pos = j.meshes?.[0]?.primitives[0]?.attributes.POSITION;
  const acc = pos === undefined ? undefined : j.accessors?.[pos];
  return { meshes: j.meshes?.length ?? 0, vertices: acc?.count ?? 0, min: acc?.min ?? [], max: acc?.max ?? [] };
}

// ---------- the scripts Blender runs ----------

export const ASSERT_PY = 'assert False, "exit-code control: this must make Blender exit non-zero"\n';

/** Runs inside Blender. Prints one BLENDERCHECK:{json} line of measured values; writes render.png and cube.glb. */
export const CHECK_PY = `import bpy, sys, os, json
out = sys.argv[sys.argv.index("--") + 1]
res = {"version": list(bpy.app.version)}
cube = bpy.data.objects.get("Cube")
res["dims"] = list(cube.dimensions) if cube else None
res["meshVertices"] = len(cube.data.vertices) if cube else None
sc = bpy.context.scene
eevee = None
for cand in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try:
        sc.render.engine = cand
        eevee = cand
        break
    except TypeError:
        pass
res["eevee"] = eevee
sc.render.engine = "BLENDER_WORKBENCH"
sc.render.resolution_x = ${RENDER_SIZE}
sc.render.resolution_y = ${RENDER_SIZE}
sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGBA"
sc.render.image_settings.color_depth = "8"
sc.render.filepath = os.path.join(out, "render.png")
bpy.ops.render.render(write_still=True)
for o in sc.objects:
    o.select_set(o == cube)
bpy.context.view_layer.objects.active = cube
bpy.ops.export_scene.gltf(filepath=os.path.join(out, "cube.glb"), export_format="GLB", use_selection=True)
print("BLENDERCHECK:" + json.dumps(res))
`;

// ---------- running it ----------

export type Spawn = typeof nodeSpawn;
type RunResult = { code: number | null; signal?: string | null; out: string; timedOut: boolean; error?: string };

/** One Blender start, by argv with shell: false, killed when the time left runs out. */
function runOnce(spawn: Spawn, bin: BlenderBin, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    let out = "", timedOut = false, done = false;
    const finish = (r: RunResult) => { if (!done) { done = true; clearTimeout(t); resolve(r); } };
    const child = spawn(bin.cmd, [...bin.prefixArgs, ...args], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const t = setTimeout(() => { timedOut = true; try { child.kill("SIGKILL"); } catch { /* gone */ } }, Math.max(1, timeoutMs));
    child.stdout?.on("data", (d: Buffer) => { if (out.length < 1_000_000) out += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { if (out.length < 1_000_000) out += d.toString(); });
    child.on("error", (e) => finish({ code: null, out, timedOut, error: e.message }));
    child.on("close", (code, signal) => finish({ code, signal, out, timedOut }));
  });
}

const cmpVer = (a: number[], b: readonly number[]) => { for (let i = 0; i < b.length; i++) if ((a[i] ?? 0) !== b[i]) return (a[i] ?? 0) - b[i]!; return 0; };

export async function runBlenderCheck(found: Found, opts: { spawn?: Spawn; timeoutMs?: number; now?: () => Date; tmpRoot?: string } = {}): Promise<Report> {
  const spawn = opts.spawn ?? nodeSpawn, budget = opts.timeoutMs ?? TIMEOUT_MS, now = opts.now ?? (() => new Date());
  const t0 = Date.now();
  const left = () => budget - (Date.now() - t0);
  const checks: CheckRow[] = [];
  const row = (id: string, label: string, ok: boolean | "skip", value: string) => checks.push({ id, label, status: ok === "skip" ? "skip" : ok ? "pass" : "fail", value });
  const tmp = mkdtempSync(path.join(opts.tmpRoot ?? tmpdir(), "blender-check-"));
  let version: string | null = null, eevee: string | null = null;
  try {
    const head = ["-b", "--factory-startup", "--python-exit-code", "1", "--python"];
    // 1. The exit-code control. If a failing script exits 0, a passing one proves nothing.
    writeFileSync(path.join(tmp, "assert_false.py"), ASSERT_PY);
    const ctl = await runOnce(spawn, found.bin, [...head, path.join(tmp, "assert_false.py")], left());
    const ctlOk = !ctl.timedOut && !ctl.error && ctl.code !== 0 && ctl.code !== null;
    row("exit-code", "Exit-code control", ctlOk, ctl.timedOut ? "timed out" : ctl.error ? `could not start: ${ctl.error.slice(0, 80)}` : `a failing script exits ${ctl.code}${ctl.code === 0 ? " (must be non-zero)" : ""}`);

    // 2. The version Blender says, from --version.
    const v = ctlOk ? await runOnce(spawn, found.bin, ["--version"], left()) : null;
    const said = v ? (/Blender (\d+)\.(\d+)(?:\.(\d+))?/.exec(v.out) ?? []).slice(1, 4).map((x) => Number(x ?? 0)) : [];

    // 3. The scene checks, in Blender.
    const main = ctlOk && left() > 0 ? await (writeFileSync(path.join(tmp, "check.py"), CHECK_PY), runOnce(spawn, found.bin, [...head, path.join(tmp, "check.py"), "--", tmp], left())) : null;
    const line = main?.out.split(/\r?\n/).reverse().find((l) => l.startsWith("BLENDERCHECK:"));
    let res: { version?: number[]; dims?: number[] | null; meshVertices?: number | null; eevee?: string | null } = {};
    try { if (line) res = JSON.parse(line.slice("BLENDERCHECK:".length)) as typeof res; } catch { /* reported below */ }
    const skip = !ctlOk ? "not run: the exit-code control failed, so no result can be trusted" : null;
    const ran = main && !main.timedOut && main.code === 0 && line;
    if (!skip && !ran) row("run", "Check script", false, main?.timedOut ? `timed out after ${Math.round(budget / 1000)} s` : main?.error ? `could not start: ${main.error.slice(0, 80)}` : `${main?.code === null ? `crashed (${main?.signal ?? "no exit code"})` : `exited ${main?.code ?? "?"}`} ${line ? "after printing its result: a Blender that crashes does not pass" : "without a result"}`);

    const bpyV = res.version ?? [];
    version = said.length ? said.join(".") : bpyV.length ? bpyV.join(".") : null;
    if (skip || !ran) row("version", "Version", "skip", skip ?? "not measured");
    else {
      const same = said.length === 3 && bpyV.length === 3 && said.every((x, i) => x === bpyV[i]);
      const atLeast = cmpVer(bpyV, MIN_BLENDER) >= 0;
      row("version", "Version", same && atLeast, `--version ${said.join(".") || "?"}, bpy.app.version ${bpyV.join(".")}${same ? "" : " (they differ)"}; minimum ${MIN_BLENDER.join(".")}${atLeast ? "" : " (too old)"}`);
    }
    if (skip || !ran) row("cube", "Default cube", "skip", skip ?? "not measured");
    else {
      const dims = res.dims ?? [];
      const ok = dims.length === 3 && dims.every((x) => Math.abs(x - 2) <= TOL) && res.meshVertices === 8;
      row("cube", "Default cube", ok, `dimensions ${dims.map((x) => +x.toFixed(6)).join(" × ") || "none"} (want 2 × 2 × 2 ± ${TOL}); mesh vertices ${res.meshVertices ?? "none"} (want 8)`);
    }
    if (skip || !ran) row("render", "Workbench render", "skip", skip ?? "not measured");
    else {
      const f = path.join(tmp, "render.png");
      try {
        const s = pngStats(readFileSync(f));
        row("render", "Workbench render", s.width === RENDER_SIZE && s.height === RENDER_SIZE && s.colours > 1, `${s.width} × ${s.height} PNG, ${s.colours >= 1000 ? "1000+" : s.colours} distinct colour${s.colours === 1 ? " (one flat colour)" : "s"}`);
      } catch (e) { row("render", "Workbench render", false, existsSync(f) ? `unreadable: ${(e as Error).message}` : "no render.png was written"); }
    }
    if (skip || !ran) row("glb", "glTF export", "skip", skip ?? "not measured");
    else {
      const f = path.join(tmp, "cube.glb");
      try {
        const g = glbStats(readFileSync(f));
        const bounds = g.min.length === 3 && g.max.length === 3 && g.min.every((x) => Math.abs(x + 1) <= TOL) && g.max.every((x) => Math.abs(x - 1) <= TOL);
        row("glb", "glTF export", g.meshes === 1 && g.vertices === GLB_CUBE_VERTICES && bounds, `${g.meshes} mesh, ${g.vertices} vertices (want ${GLB_CUBE_VERTICES}: 8 corners × 3 faces), bounds ${bounds ? "±1" : `${JSON.stringify(g.min)}..${JSON.stringify(g.max)}`}`);
      } catch (e) { row("glb", "glTF export", false, existsSync(f) ? `unreadable: ${(e as Error).message}` : "no cube.glb was written"); }
    }
    eevee = ran ? res.eevee ?? null : null;
    if (ran) row("eevee", "Eevee engine id", eevee !== null, eevee ?? "neither BLENDER_EEVEE_NEXT nor BLENDER_EEVEE is accepted");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const durationMs = Date.now() - t0;
  row("time", "Total time", durationMs <= budget, `${(durationMs / 1000).toFixed(1)} s (limit ${budget / 1000} s)`);
  return { ok: checks.every((c) => c.status === "pass"), version, path: found.path, source: found.source, checks, durationMs, at: now().toISOString(), eevee };
}

export function formatReport(r: Report): string {
  const mark = { pass: "PASS", fail: "FAIL", skip: "SKIP" } as const;
  const w = Math.max(...r.checks.map((c) => c.label.length));
  return [`Blender check: ${r.path} (${r.source})`, "", ...r.checks.map((c) => `  ${mark[c.status]}  ${c.label.padEnd(w)}  ${c.value}`), "",
    r.ok ? `PASS  Blender ${r.version} does what the Blender skills need.` : "FAIL  Fix the FAIL rows before using the Blender skills (PC-SETUP §3.4)."].join("\n");
}

// ---------- the command ----------

if (import.meta.main) {
  const { loadLocalConfig, logDir, pathsFor } = await import("./config.ts");
  const paths = pathsFor(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  let local: string | undefined;
  try { local = loadLocalConfig(paths).blenderBin; } catch (e) { console.error(`os/config/os.local.json is not valid: ${(e as Error).message.slice(0, 200)}`); process.exit(1); }
  const found = findBlender({ platform: process.platform, env: process.env, exists: existsSync, listDir: (p) => { try { return readdirSync(p); } catch { return []; } }, localBlenderBin: () => local });
  if (!found) {
    console.error(local || process.env["BLENDER"] ? `Blender not found at ${local ?? process.env["BLENDER"]}.` : "Blender not found (looked at os.local.json blenderBin, BLENDER, PATH and Program Files).");
    console.error("PC-SETUP §3.4: install Blender, or set blenderBin in os/config/os.local.json.");
    process.exit(2);
  }
  console.log(`Checking ${found.path} (found by ${found.source}); this takes up to ${TIMEOUT_MS / 1000} s...`);
  const report = await runBlenderCheck(found);
  const dir = logDir(paths);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, REPORT_FILE), JSON.stringify(report, null, 2) + "\n");
  console.log(formatReport(report));
  console.log(`\nReport: ${path.join(dir, REPORT_FILE)}`);
  process.exitCode = report.ok ? 0 : 1;
}
