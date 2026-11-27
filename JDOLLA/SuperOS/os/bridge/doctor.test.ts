import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  checkBackup, checkClaude, checkLogDir, checkPort, checkSandbox, checkScheduler, cleanVersion, findOnPath, formatDoctor, logDirFor,
  readSafeEnv, realDeps, runDoctor, type DoctorDeps,
} from "./doctor.ts";
import { brainIndexPath, main } from "./doctor-cli.ts";
import { defaultIndexPath } from "../brain/indexer.ts";

const SECRET = "sk-ant-DOCTORCANARY-9931";

/** A fake machine: files are a set of paths (any style), nothing touches the real disk or network. */
function fake(over: Partial<DoctorDeps> & { files?: Record<string, string>; dirs?: string[] } = {}): DoctorDeps {
  const vault = over.vault ?? "/v";
  const files: Record<string, string> = over.files ?? {
    "/v/CLAUDE.md": "#", "/v/routines/routines.json": "[]", "/v/os/.env": `SUPEROS_PORT=4317\nAPI_KEY=${SECRET}\n`,
    "/usr/bin/claude": "", "/home/jay/.superos/brain/index.sqlite": "",
    "/v/.git/config": "[core]\n\trepositoryformatversion = 0\n[remote \"origin\"]\n\turl = https://github.com/jay/brain.git\n",
    "/v/logs/blender-check.json": JSON.stringify({ ok: true, version: "4.0.2", at: "2026-11-20T12:00:00Z", checks: [] }),
  };
  const dirs = new Set(over.dirs ?? ["/v/depts", "/v/wiki", "/v/logs", "/v/.git"]);
  return {
    platform: "linux", env: { PATH: "/usr/local/bin:/usr/bin", HOME: "/home/jay" }, nodeVersion: "v22.18.0", vault, osDir: `${vault}/os`,
    now: new Date("2026-11-22T12:00:00Z"),
    exists: (p) => p in files || dirs.has(p),
    isDir: (p) => dirs.has(p),
    readText: (p) => { const t = files[p]; if (t === undefined) throw new Error("ENOENT"); return t; },
    mtimeMs: () => Date.parse("2026-11-22T09:00:00Z"),
    listDir: (p) => (p.endsWith("depts") ? ["software.md", "ai.md"] : []),
    runVersion: () => ({ ok: true, out: "2.1.0 (Claude Code)\n" }),
    portFree: async () => true,
    probeWrite: () => ({ ok: true }),
    claudeBinFromConfig: () => undefined,
    backupRemote: () => "https://github.com/jay/brain.git",
    brainIndexPath: () => "/home/jay/.superos/brain/index.sqlite",
    embeddingsRuntime: () => true,
    sandboxHas: () => true,
    ...over,
  };
}

describe("doctor checks", () => {
  it("a ready machine passes every row and exits 0 (control)", async () => {
    const lines: string[] = [];
    const code = await main([], fake(), (s) => lines.push(s));
    assert.equal(code, 0);
    const checks = await runDoctor(fake());
    assert.deepEqual(checks.map((c) => c.status), Array(12).fill("pass"), JSON.stringify(checks.filter((c) => c.status !== "pass")));
    assert.match(lines.join("\n"), /12 pass, 0 warn, 0 fail/);
  });

  it("every non-pass row names the PC-SETUP section that fixes it", async () => {
    const d = fake({ files: {}, dirs: [], nodeVersion: "v20.11.1", embeddingsRuntime: () => false, sandboxHas: () => false, portFree: async () => false, env: { PATH: "", SUPEROS_SCHEDULER: "off" } });
    const checks = await runDoctor(d);
    const bad = checks.filter((c) => c.status !== "pass");
    assert.ok(bad.length >= 8, `only ${bad.length} non-pass rows`);
    for (const c of bad) assert.match(c.fix ?? "", /^PC-SETUP (§\d+|Troubleshooting)/, c.id);
    assert.ok(formatDoctor(checks).includes("→ PC-SETUP §1"));
  });

  it("Node older than 22.18 fails; 22.18 and 24.x pass", async () => {
    const st = async (v: string) => (await runDoctor(fake({ nodeVersion: v })))[0]?.status;
    assert.equal(await st("v22.17.9"), "fail");
    assert.equal(await st("v18.20.0"), "fail");
    assert.equal(await st("v22.18.0"), "pass");
    assert.equal(await st("v24.1.0"), "pass");
  });

  it("a missing Claude CLI fails and the command exits 1", async () => {
    const d = fake({ env: { PATH: "/usr/local/bin:/opt/none" } });
    const c = checkClaude(d);
    assert.equal(c.status, "fail");
    assert.match(c.detail, /not found on PATH/);
    assert.match(c.fix ?? "", /PC-SETUP §1/);
    assert.equal(await main([], d, () => {}), 1);
  });

  it("a CLI that is found but fails or hangs on --version fails", () => {
    const c = checkClaude(fake({ runVersion: () => ({ ok: false, error: "timed out after 5 s" }) }));
    assert.equal(c.status, "fail");
    assert.match(c.detail, /timed out after 5 s/);
  });

  it("engine.claudeBin pointing at cli.js runs it with this Node, no shell, argv only", () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const d = fake({ claudeBinFromConfig: () => "/opt/claude/cli.js", files: { "/opt/claude/cli.js": "" }, runVersion: (cmd, args) => { calls.push({ cmd, args }); return { ok: true, out: "2.1.0" }; } });
    assert.equal(checkClaude(d).status, "pass");
    assert.deepEqual(calls, [{ cmd: process.execPath, args: ["/opt/claude/cli.js", "--version"] }]);
  });

  it("the version line is cut to one printable line", () => {
    assert.equal(cleanVersion("\u001b[32m2.1.0 (Claude Code)\u001b[0m\nsecond line " + SECRET), "[32m2.1.0 (Claude Code)[0m");
    assert.ok(cleanVersion("x".repeat(500)).length <= 80);
  });
});

describe("Windows paths (as text)", () => {
  const winEnv = { Path: "C:\\Program Files\\nodejs;\"C:\\Users\\Jay\\.local\\bin\";C:\\Users\\Jay\\AppData\\Roaming\\npm", PATHEXT: ".COM;.EXE;.BAT;.CMD", LOCALAPPDATA: "C:\\Users\\Jay\\AppData\\Local" };

  it("finds claude.exe on a ;-separated Path with quoted entries", () => {
    const files = new Set(["C:\\Users\\Jay\\.local\\bin\\claude.exe"]);
    const hit = findOnPath("claude.exe", { platform: "win32", env: winEnv, exists: (p) => files.has(p) });
    assert.equal(hit, "C:\\Users\\Jay\\.local\\bin\\claude.exe");
    const d = fake({ platform: "win32", env: winEnv, exists: (p) => files.has(p) });
    assert.equal(checkClaude(d).status, "pass");
  });

  it("an npm claude.cmd alone warns that it cannot start without a shell", () => {
    const files = new Set(["C:\\Users\\Jay\\AppData\\Roaming\\npm\\claude.cmd"]);
    const c = checkClaude(fake({ platform: "win32", env: winEnv, exists: (p) => files.has(p) }));
    assert.equal(c.status, "warn");
    assert.match(c.detail, /claude\.cmd, which cannot start without a shell/);
    assert.match(c.fix ?? "", /cli\.js/);
  });

  it("the log folder is %LOCALAPPDATA%\\JDOLLA\\logs", () => {
    assert.equal(logDirFor({ platform: "win32", env: winEnv, vault: "C:\\Users\\Jay\\JDOLLA" }), "C:\\Users\\Jay\\AppData\\Local\\JDOLLA\\logs");
    assert.equal(logDirFor({ platform: "linux", env: {}, vault: "/v" }), "/v/logs");
  });

  it("native Windows: Bash is refused without WSL2 (warn, not fail)", () => {
    const c = checkSandbox(fake({ platform: "win32", env: winEnv }));
    assert.equal(c.status, "warn");
    assert.match(c.detail, /refused on native Windows/);
    assert.match(c.detail, /WSL2/);
  });
});

describe("os/.env: existence only, never a secret", () => {
  it("only the SUPEROS_PORT and SUPEROS_SCHEDULER lines are read", () => {
    assert.deepEqual(readSafeEnv(`API_KEY=${SECRET}\nSUPEROS_PORT=5005\nSUPEROS_SCHEDULER="off"\nSUPEROS_ROUTER_KEY=${SECRET}`), { port: "5005", scheduler: "off" });
  });

  it("text and JSON output never contain a value from .env", async () => {
    const d = fake({ files: { "/v/CLAUDE.md": "#", "/v/routines/routines.json": "[]", "/usr/bin/claude": "", "/v/os/.env": `API_KEY=${SECRET}\nSUPEROS_SCHEDULER=off\nPASSWORD=${SECRET}\n` } });
    for (const flags of [[], ["--json"]]) {
      const out: string[] = [];
      await main(flags, d, (s) => out.push(s));
      assert.ok(!out.join("\n").includes("DOCTORCANARY"), `leak with ${flags.join(" ")}`);
    }
    assert.equal(checkScheduler(d).status, "warn");
  });

  it("a missing .env warns with §4", async () => {
    const c = (await runDoctor(fake({ files: { "/v/CLAUDE.md": "#", "/v/routines/routines.json": "[]", "/usr/bin/claude": "" } }))).find((x) => x.id === "env");
    assert.equal(c?.status, "warn");
    assert.match(c?.fix ?? "", /§4/);
  });
});

describe("vault, logs, port, brain", () => {
  it("lists every missing piece of the vault layout", async () => {
    const c = (await runDoctor(fake({ files: { "/v/routines/routines.json": "{not json", "/usr/bin/claude": "" }, dirs: ["/v/depts"] , listDir: () => [] }))).find((x) => x.id === "vault");
    assert.equal(c?.status, "fail");
    for (const m of ["CLAUDE.md", "depts/*.md", "wiki/", "not valid JSON"]) assert.ok(c?.detail.includes(m), m);
  });

  it("the real probe writes one file in the log folder and removes it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "doctor-vault-"));
    mkdirSync(path.join(dir, "logs"));
    const d = realDeps(dir, path.join(dir, "os"), { claudeBinFromConfig: () => undefined, brainIndexPath: () => "/nope", embeddingsRuntime: () => false });
    assert.equal(checkLogDir({ ...d, platform: "linux", env: {} }).status, "pass");
    assert.deepEqual(readdirSync(path.join(dir, "logs")), [], "probe file left behind");
    assert.deepEqual(d.probeWrite(path.join(dir, "missing")).ok, false);
  });

  it("a port already in use warns; a free one passes (real socket, 127.0.0.1 only)", async () => {
    const busy = createServer();
    await new Promise<void>((r) => busy.listen(0, "127.0.0.1", r));
    const port = (busy.address() as AddressInfo).port;
    try {
      const real = realDeps("/v", "/v/os", { claudeBinFromConfig: () => undefined, brainIndexPath: () => "/x", embeddingsRuntime: () => false });
      const c = await checkPort(fake({ env: { SUPEROS_PORT: String(port) }, portFree: real.portFree }));
      assert.equal(c.status, "warn");
      assert.match(c.detail, new RegExp(`127\\.0\\.0\\.1:${port} is in use`));
      assert.match(c.fix ?? "", /SUPEROS_PORT/);
    } finally { busy.close(); }
    const c2 = await checkPort(fake({ env: { SUPEROS_PORT: String(port) }, portFree: realDeps("/v", "/v/os", { claudeBinFromConfig: () => undefined, brainIndexPath: () => "/x", embeddingsRuntime: () => false }).portFree }));
    assert.equal(c2.status, "pass");
  });

  it("brain index age is shown; a missing index and missing embeddings only warn", async () => {
    const ok = (await runDoctor(fake())).find((x) => x.id === "brain");
    assert.match(ok?.detail ?? "", /built 3 h ago/);
    const checks = await runDoctor(fake({ brainIndexPath: () => "/none.sqlite", embeddingsRuntime: () => false }));
    assert.equal(checks.find((x) => x.id === "brain")?.status, "warn");
    assert.equal(checks.find((x) => x.id === "embeddings")?.status, "warn");
    assert.equal(checks.some((x) => x.status === "fail"), false);
  });

  it("the doctor's brain index path matches the brain's own rule", () => {
    assert.equal(brainIndexPath(process.env), defaultIndexPath());
    assert.equal(brainIndexPath({ SUPEROS_BRAIN_DB: "/x/i.sqlite" }), "/x/i.sqlite");
  });
});

describe("vault backup row", () => {
  const row = async (over: Partial<DoctorDeps> & { files?: Record<string, string>; dirs?: string[] }) => (await runDoctor(fake(over))).find((c) => c.id === "backup")!;
  const files = (cfg: string): Record<string, string> => ({ "/v/CLAUDE.md": "#", "/v/routines/routines.json": "[]", "/v/os/.env": "", "/usr/bin/claude": "", "/home/jay/.superos/brain/index.sqlite": "", "/v/.git/config": cfg });
  const PRIVATE_CFG = '[remote "origin"]\n\turl = https://github.com/jay/brain.git\n';

  it("own repo, a remote that passes the backup's own check: pass (control)", async () => {
    const c = await row({});
    assert.equal(c.status, "pass");
    assert.match(c.detail, /own git repo: yes; remote: set, passes the check/);
  });
  it("no remote named: warn, optional, with the PC-SETUP step", async () => {
    const c = await row({ backupRemote: () => "" });
    assert.equal(c.status, "warn");
    assert.match(c.detail, /^not set up \(optional\); own git repo: yes; remote: not set$/);
    assert.match(c.fix ?? "", /§10\.1/);
  });
  it("a remote that fails the check (wrong spelling, file path, the public repo) warns with the reason; an unreadable config warns", async () => {
    for (const [remote, re] of [["http://github.com/a/b.git", /must look like https:\/\/github\.com/], ["/tmp/x.git", /must look like/], ["https://github.com/JamieTurner2026/Claude-AI-skills.git", /public code repo/]] as const) {
      const c = await row({ backupRemote: () => remote });
      assert.equal(c.status, "warn", remote);
      assert.match(c.detail, re, remote);
      assert.ok(!c.detail.includes(remote), "the URL itself is never printed");
    }
    assert.equal((await row({ backupRemote: () => null })).status, "warn");
  });
  it("the vault is not its own git repo: warn with the git init step", async () => {
    const c = await row({ files: files(""), dirs: ["/v/depts", "/v/wiki", "/v/logs"] });
    assert.equal(c.status, "warn");
    assert.match(c.detail, /own git repo: no; remote: set, passes the check/);
    assert.match(c.fix ?? "", /git init/);
  });
  it("the vault's own git config points at the public repo: fail, in any spelling, and the URL is not printed", async () => {
    for (const url of ["https://github.com/JamieTurner2026/Claude-AI-skills.git", "git@github.com:jamieturner2026/claude-ai-skills.git", "https://tok:secret@github.com/JamieTurner2026/Claude-AI-skills"]) {
      const c = await row({ files: files(`[remote "origin"]\n\turl = ${url}\n`) });
      assert.equal(c.status, "fail", url);
      assert.match(c.detail, /points at the public code repo/);
      assert.ok(!JSON.stringify(c).includes("secret") && !c.detail.includes("github.com"), "no URL or token in the output");
    }
    assert.equal((await row({ files: files(PRIVATE_CFG) })).status, "pass", "control: a private origin");
  });
  it("it never contacts the network and starts no process: no runVersion call and nothing but file reads", async () => {
    const calls: string[] = [];
    const d = fake({ runVersion: (cmd) => { calls.push(cmd); return { ok: true, out: "x" }; }, portFree: async () => { calls.push("port"); return true; } });
    const c = checkBackup(d);
    assert.equal(c.status, "pass");
    assert.deepEqual(calls, [], "checkBackup touched neither a process nor a socket");
    const src = readFileSync(path.join(import.meta.dirname, "doctor.ts"), "utf8");
    const body = src.slice(src.indexOf("export function checkBackup"), src.indexOf("export async function runDoctor"));
    assert.ok(!/fetch\(|node:http|node:net|spawn|execFile|execSync|child_process|runVersion|git ls-remote/.test(body.replace(/\/\*[\s\S]*?\*\//g, "")), "no process or network call in the backup check");
  });
});

describe("npm run doctor", () => {
  const launcher = path.join(import.meta.dirname, "doctor.mjs");
  it("--json prints parseable rows; a bad argument exits 2", () => {
    const r = spawnSync(process.execPath, [launcher, "--json"], { encoding: "utf8" });
    assert.ok(r.status === 0 || r.status === 1, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.checks.length, 12);
    assert.equal(j.fails, j.checks.filter((c: { status: string }) => c.status === "fail").length);
    assert.equal(spawnSync(process.execPath, [launcher, "--fix"], { encoding: "utf8" }).status, 2);
  });
});
