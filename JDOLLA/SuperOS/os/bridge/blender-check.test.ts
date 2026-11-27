// `npm run blender:check` (bridge/blender-check.ts), with a fake Blender (bridge/fake-blender.ts) as the binary: nothing
// here needs Blender. The check's Python was run for real on bpy 4.2.0 and 5.0.1 while it was written (see the PR).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { CHECK_PY, GLB_CUBE_VERTICES, MIN_BLENDER, findBlender, glbStats, pngStats, programFilesCandidates, runBlenderCheck, type FindDeps, type Found, type Spawn } from "./blender-check.ts";
import { BLENDER_FRESH_DAYS, checkBlender, type DoctorDeps } from "./doctor.ts";
import { LocalConfigSchema } from "./config.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(HERE, "fake-blender.ts");
const fake = (mode: string): Found => ({ bin: { cmd: process.execPath, prefixArgs: [FAKE, mode] }, path: "/fake/blender", source: "PATH" });
const tmpRoot = () => mkdtempSync(path.join(tmpdir(), "bc-root-"));
const byId = (r: { checks: Array<{ id: string; status: string; value: string }> }) => Object.fromEntries(r.checks.map((c) => [c.id, c]));

describe("the check, against a fake Blender", () => {
  it("passes when everything is as measured on real Blender, and leaves no temp folder (control)", async () => {
    const root = tmpRoot();
    const r = await runBlenderCheck(fake("ok"), { tmpRoot: root });
    assert.equal(r.ok, true, JSON.stringify(r.checks));
    assert.equal(r.version, "4.0.2");
    assert.equal(r.eevee, "BLENDER_EEVEE");
    const c = byId(r);
    assert.deepEqual(Object.keys(c), ["exit-code", "version", "cube", "render", "glb", "eevee", "time"]);
    assert.match(c["exit-code"]!.value, /a failing script exits 1/);
    assert.match(c["version"]!.value, /--version 4\.0\.2, bpy\.app\.version 4\.0\.2; minimum 4\.0/);
    assert.match(c["cube"]!.value, /dimensions 2 × 2 × 2 .*mesh vertices 8/);
    assert.match(c["render"]!.value, /64 × 64 PNG, \d+\+? distinct colours/);
    assert.match(c["glb"]!.value, /1 mesh, 24 vertices .*bounds ±1/);
    assert.deepEqual(readdirSync(root), [], "the temp folder is removed");
  });

  it("the exit-code control: if a failing script exits 0, nothing else is run or trusted", async () => {
    const r = await runBlenderCheck(fake("noexit"), { tmpRoot: tmpRoot() });
    assert.equal(r.ok, false);
    const c = byId(r);
    assert.equal(c["exit-code"]!.status, "fail");
    assert.match(c["exit-code"]!.value, /exits 0 \(must be non-zero\)/);
    for (const id of ["version", "cube", "render", "glb"]) assert.equal(c[id]!.status, "skip", `${id} is not trusted`);
  });

  it("a wrong cube, a flat render, an old or mismatched version each fail their own row, the rest pass", async () => {
    const cases: Array<[string, string, RegExp]> = [
      ["cube3", "cube", /dimensions 3 × 3 × 3/],
      ["flat", "render", /1 distinct colour \(one flat colour\)/],
      ["old", "version", /3\.6\.5.*\(too old\)/],
      ["mismatch", "version", /--version 4\.0\.2, bpy\.app\.version 4\.1\.0 \(they differ\)/],
    ];
    for (const [mode, id, value] of cases) {
      const r = await runBlenderCheck(fake(mode), { tmpRoot: tmpRoot() });
      const c = byId(r);
      assert.equal(r.ok, false, mode);
      assert.equal(c[id]!.status, "fail", `${mode}: ${id}`);
      assert.match(c[id]!.value, value);
      if (mode === "cube3") assert.equal(c["glb"]!.status, "fail", "the export's bounds are ±1.5, not ±1");
      const others = r.checks.filter((x) => x.id !== id && !(mode === "cube3" && x.id === "glb"));
      assert.ok(others.every((x) => x.status === "pass"), `${mode}: only ${id} fails (${JSON.stringify(others.filter((x) => x.status !== "pass"))})`);
    }
  });

  it("a Blender that crashes after printing a good result fails, and says so (seen with the bpy 4.2 module under software EGL)", async () => {
    const r = await runBlenderCheck(fake("crash"), { tmpRoot: tmpRoot() });
    const c = byId(r);
    assert.equal(r.ok, false);
    assert.equal(c["run"]!.status, "fail");
    assert.match(c["run"]!.value, /exited 139 after printing its result: a Blender that crashes does not pass/);
    assert.equal(c["cube"]!.status, "skip", "a crashed run's numbers are not used");
  });

  it("a Blender that never finishes is killed at the time limit and fails, and the temp folder is still removed", async () => {
    const root = tmpRoot();
    const t0 = Date.now();
    const r = await runBlenderCheck(fake("hang"), { tmpRoot: root, timeoutMs: 3000 });
    assert.ok(Date.now() - t0 < 10_000, "it did not wait for ever");
    const c = byId(r);
    assert.equal(r.ok, false);
    assert.equal(c["run"]!.status, "fail");
    assert.match(c["run"]!.value, /timed out after 3 s/);
    assert.deepEqual(readdirSync(root), []);
  });

  it("runs Blender by argv with shell: false: factory settings, the exit code on, the script and the temp folder", async () => {
    const calls: Array<{ cmd: string; args: string[]; shell: unknown }> = [];
    const spy = ((cmd: string, args: string[], o: { shell?: unknown }) => { calls.push({ cmd, args, shell: o.shell }); return spawn(cmd, args, o as Parameters<typeof spawn>[2]); }) as unknown as Spawn;
    await runBlenderCheck(fake("ok"), { spawn: spy, tmpRoot: tmpRoot() });
    assert.equal(calls.length, 3, "the control, --version and the check");
    assert.ok(calls.every((c) => c.shell === false && c.cmd === process.execPath));
    const blenderArgs = calls.map((c) => c.args.slice(2)); // after the fake's own path and mode
    assert.deepEqual(blenderArgs[0]!.slice(0, 5), ["-b", "--factory-startup", "--python-exit-code", "1", "--python"]);
    assert.match(blenderArgs[0]![5]!, /assert_false\.py$/);
    assert.deepEqual(blenderArgs[1], ["--version"]);
    assert.deepEqual(blenderArgs[2]!.slice(0, 5), ["-b", "--factory-startup", "--python-exit-code", "1", "--python"]);
    assert.match(blenderArgs[2]![5]!, /check\.py$/);
    assert.equal(blenderArgs[2]![6], "--");
    assert.equal(path.dirname(blenderArgs[2]![5]!), blenderArgs[2]![7], "the output folder is the script's own temp folder");
  });

  it("the Python uses only API that 4.0 has: Workbench for the render, the Eevee id looked up by trying, no 5.x names", () => {
    assert.match(CHECK_PY, /render\.engine = "BLENDER_WORKBENCH"/);
    assert.match(CHECK_PY, /for cand in \("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"\)/);
    assert.doesNotMatch(CHECK_PY, /import requests|urllib|socket|http/, "no network");
    assert.deepEqual([...MIN_BLENDER], [4, 0]);
    assert.equal(GLB_CUBE_VERTICES, 24);
  });
});

describe("finding Blender", () => {
  const deps = (over: Partial<FindDeps> & { files?: string[] } = {}): FindDeps => {
    const files = new Set(over.files ?? []);
    return { platform: "win32", env: { PATH: "C:\\Windows" }, exists: (p) => files.has(p), listDir: () => [], localBlenderBin: () => undefined, ...over };
  };
  it("os.local.json, then BLENDER, then PATH, then the newest Program Files folder; not found is null", () => {
    const pf = "C:\\Program Files\\Blender Foundation";
    const list = (p: string) => (p === pf ? ["Blender 3.6", "Blender 4.0", "Blender 4.10", "notes.txt"] : []);
    assert.deepEqual(programFilesCandidates(deps({ listDir: list })), [`${pf}\\Blender 4.10\\blender.exe`, `${pf}\\Blender 4.0\\blender.exe`, `${pf}\\Blender 3.6\\blender.exe`], "4.10 is newer than 4.0 (numbers, not text)");
    const all = [`${pf}\\Blender 4.0\\blender.exe`, "C:\\Tools\\blender.exe", "D:\\b\\blender.exe", "E:\\mine\\blender.exe"];
    const d = (o: Partial<FindDeps>) => deps({ files: all, listDir: list, ...o });
    assert.equal(findBlender(d({ localBlenderBin: () => "E:\\mine\\blender.exe", env: { BLENDER: "D:\\b\\blender.exe", PATH: "C:\\Tools" } }))?.source, "os.local.json");
    assert.equal(findBlender(d({ env: { BLENDER: "D:\\b\\blender.exe", PATH: "C:\\Tools" } }))?.source, "BLENDER");
    assert.equal(findBlender(d({ env: { PATH: "C:\\Tools" } }))?.path, "C:\\Tools\\blender.exe");
    assert.equal(findBlender(d({ env: { PATH: "" } }))?.path, `${pf}\\Blender 4.0\\blender.exe`, "4.10 is listed but not installed, so 4.0");
    assert.equal(findBlender(deps({ env: { PATH: "" } })), null, "not found");
    assert.equal(findBlender(d({ localBlenderBin: () => "E:\\missing.exe" })), null, "a set path that is wrong is never quietly replaced");
  });
  it("os.local.json accepts blenderBin and still refuses unknown keys", () => {
    assert.deepEqual(LocalConfigSchema.parse({ blenderBin: "C:\\Blender\\blender.exe" }), { blenderBin: "C:\\Blender\\blender.exe" });
    assert.throws(() => LocalConfigSchema.parse({ blender: "x" }));
  });
  it("the command exits 2 when Blender is not found, and says where it looked", () => {
    const env = { ...process.env, PATH: "", BLENDER: "", ProgramFiles: mkdtempSync(path.join(tmpdir(), "nopf-")) };
    delete (env as Record<string, string | undefined>)["BLENDER"];
    const r = spawnSync(process.execPath, [path.join(HERE, "blender-check.ts")], { env, encoding: "utf8" });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /Blender not found .*PATH and Program Files/);
  });
});

describe("reading what Blender wrote", () => {
  it("pngStats decodes the filters and counts colours; glbStats reads the mesh; junk is refused", () => {
    const row = (f: number, px: number[]) => [f, ...px];
    const ihdr = (w: number, h: number) => { const b = Buffer.alloc(13); b.writeUInt32BE(w, 0); b.writeUInt32BE(h, 4); b.set([8, 2, 0, 0, 0], 8); return b; };
    const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); return Buffer.concat([l, Buffer.from(t), d, Buffer.alloc(4)]); };
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // 2 × 2 RGB: row 0 raw (red, green), row 1 Up-filtered (+0 → the same two colours).
    const raw = Buffer.from([...row(0, [255, 0, 0, 0, 255, 0]), ...row(2, [0, 0, 0, 0, 0, 0])]);
    const png = Buffer.concat([sig, chunk("IHDR", ihdr(2, 2)), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
    assert.deepEqual(pngStats(png), { width: 2, height: 2, colours: 2 });
    assert.throws(() => pngStats(Buffer.from("not a png at all, really not one")), /not a PNG/);
    assert.throws(() => glbStats(Buffer.from("glTX............................")), /not a glTF 2 binary/);
  });
});

describe("the doctor's Blender row reads the report only", () => {
  const at = (iso: string) => new Date(iso);
  const doc = (report: unknown, now = "2026-11-27T12:00:00Z"): DoctorDeps => ({
    platform: "linux", env: {}, vault: "/v", now: at(now),
    exists: (p: string) => report !== undefined && p === "/v/logs/blender-check.json",
    readText: () => (typeof report === "string" ? report : JSON.stringify(report)),
  }) as unknown as DoctorDeps;
  const ok = (when: string, extra: object = {}) => ({ ok: true, version: "4.0.2", at: when, checks: [], ...extra });
  it("PASS within 30 days, WARN when missing or older, FAIL when the last check failed, WARN on junk", () => {
    assert.equal(checkBlender(doc(ok("2026-11-27T08:00:00Z"))).detail, "Blender 4.0.2 passed today");
    assert.equal(checkBlender(doc(ok("2026-11-27T08:00:00Z"))).status, "pass");
    assert.equal(checkBlender(doc(ok("2026-10-29T12:00:00Z"))).status, "pass", `exactly ${BLENDER_FRESH_DAYS} days old is still fresh`);
    const old = checkBlender(doc(ok("2026-10-27T12:00:00Z")));
    assert.deepEqual([old.status, old.detail], ["warn", "Blender 4.0.2 last passed 31 days ago (older than 30 days)"]);
    assert.equal(checkBlender(doc(undefined)).status, "warn");
    assert.match(checkBlender(doc(undefined)).fix ?? "", /npm run blender:check/);
    const failed = checkBlender(doc({ ok: false, version: "4.0.2", at: "2026-11-27T08:00:00Z", checks: [{ id: "exit-code", status: "fail" }, { id: "version", status: "skip" }] }));
    assert.deepEqual([failed.status, failed.detail], ["fail", "Blender 4.0.2: the last check failed (exit-code), today"]);
    assert.equal(checkBlender(doc("{ not json")).status, "warn");
    assert.equal(checkBlender(doc({ ok: "yes", at: "x" })).status, "warn");
    assert.equal(checkBlender(doc(ok("2026-11-27T08:00:00Z", { version: "<script>" }))).detail, "Blender ? passed today", "the report's text is not echoed");
  });
  it("it never starts Blender: the doctor has no way to (its deps hold no spawn), and the CLI writes the report it reads", () => {
    const deps = doc(ok("2026-11-27T08:00:00Z")) as unknown as Record<string, unknown>;
    assert.ok(!("spawn" in deps) && !("runVersion" in deps));
    const dir = mkdtempSync(path.join(tmpdir(), "bc-logs-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "blender-check.json"), JSON.stringify(ok("2026-11-27T08:00:00Z")));
    assert.ok(existsSync(path.join(dir, "blender-check.json")));
  });
});
