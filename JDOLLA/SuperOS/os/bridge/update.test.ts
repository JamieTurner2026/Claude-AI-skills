// `npm run update`: real git against a temp clone with a local bare remote; npm is a recorded stand-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MSG_DETACHED, MSG_DIRTY, MSG_DIVERGED, MSG_NOT_A_CLONE, MSG_NO_NPM, MSG_NO_UPSTREAM, findNpmCli, realExec, runUpdate, type Exec } from "./update.ts";

const ID = ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false"];
function g(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", [...ID, ...args], { cwd, encoding: "utf8", shell: false, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" } });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
const put = (root: string, rel: string, text: string) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text); };

/** A bare "GitHub" remote, the PC's clone (vault at JDOLLA/SuperOS inside it, as on Jay's PC) and another machine's clone. */
function setup() {
  const base = mkdtempSync(path.join(tmpdir(), "update-"));
  const remote = path.join(base, "remote.git");
  g(base, "init", "--bare", "-b", "main", remote);
  const seed = path.join(base, "seed");
  g(base, "init", "-b", "main", seed);
  put(seed, ".gitignore", "JDOLLA/SuperOS/os/.env\nJDOLLA/SuperOS/os/node_modules/\n");
  put(seed, "JDOLLA/SuperOS/wiki/a.md", "# A\n");
  put(seed, "JDOLLA/SuperOS/os/package.json", "{}\n");
  g(seed, "add", "-A"); g(seed, "commit", "-m", "seed"); g(seed, "remote", "add", "origin", remote); g(seed, "push", "-u", "origin", "main");
  const pc = path.join(base, "pc"); g(base, "clone", remote, pc);
  const other = path.join(base, "other"); g(base, "clone", remote, other);
  const vault = path.join(pc, "JDOLLA", "SuperOS");
  const osDir = path.join(vault, "os");
  put(pc, "JDOLLA/SuperOS/os/.env", "SECRET=keep-me\n"); // git-ignored: must survive byte for byte
  return { base, remote, pc, other, vault, osDir };
}
/** The other machine pushes one new note to the remote. */
function pushFromOther(other: string, rel = "JDOLLA/SuperOS/wiki/b.md") {
  put(other, rel, "# B\n"); g(other, "add", "-A"); g(other, "commit", "-m", "from other"); g(other, "push", "origin", "main");
  return g(other, "rev-parse", "HEAD");
}

const NPM_CLI = path.join(tmpdir(), "fake-npm", "npm-cli.js");
/** Real git (captured), recorded npm. `npmCode` picks each npm step's exit code. */
function harness(e: ReturnType<typeof setup>, npmCode: (args: string[]) => number = () => 0, npmCli: string | null = NPM_CLI) {
  const npmCalls: { args: string[]; cwd: string }[] = [];
  const gitCalls: string[][] = [];
  const lines: string[] = [];
  const exec: Exec = (cmd, args, o) => {
    if (cmd === process.execPath && args[0] === NPM_CLI) {
      const a = args.slice(1);
      npmCalls.push({ args: a, cwd: o.cwd });
      return { code: npmCode(a), stdout: "", stderr: "" };
    }
    assert.equal(cmd, "git", "only git and node npm-cli.js are ever started");
    gitCalls.push([...args]);
    return realExec(cmd, args, { ...o, inherit: false });
  };
  const run = () => runUpdate({ vault: e.vault, osDir: e.osDir, npmCli, node: process.execPath, exec, out: (l) => lines.push(l) });
  return { run, npmCalls, gitCalls, lines };
}

test("happy path: fast-forwards to the remote, then npm ci, doctor and smoke run in os/, in order; .env is untouched", () => {
  const e = setup();
  const target = pushFromOther(e.other);
  const envBefore = readFileSync(path.join(e.osDir, ".env"));
  const h = harness(e);
  const r = h.run();
  assert.equal(r.ok, true, h.lines.join("\n"));
  assert.equal(g(e.pc, "rev-parse", "HEAD"), target, "the clone is now at the remote's commit");
  assert.equal(r.after, target);
  assert.ok(existsSync(path.join(e.vault, "wiki", "b.md")), "the new note arrived");
  assert.deepEqual(readFileSync(path.join(e.osDir, ".env")), envBefore, ".env byte for byte");
  assert.deepEqual(h.npmCalls.map((c) => c.args), [["ci"], ["run", "doctor"], ["run", "smoke"]]);
  assert.ok(h.npmCalls.every((c) => c.cwd === e.osDir));
  assert.deepEqual(r.steps.map((s) => [s.name, s.ok]), [["clean tree", true], ["git pull --ff-only", true], ["npm ci", true], ["npm run doctor", true], ["npm run smoke", true]]);
  assert.ok(h.lines.some((l) => /^ {2}PASS {2}git pull --ff-only {2}[0-9a-f]{7} -> [0-9a-f]{7}$/.test(l)), "a pass line per step");
  // Never a merge, rebase, reset or force; hooks always off.
  const flat = h.gitCalls.map((a) => a.join(" "));
  assert.ok(flat.some((a) => / pull --no-rebase --ff-only$/.test(a)));
  assert.ok(flat.every((a) => !/\b(merge|rebase|reset|checkout|stash|clean)\b(?!-)/.test(a.replace("--no-rebase", "")) && !/--force|-f\b/.test(a)), flat.join("\n"));
  assert.ok(h.gitCalls.every((a) => a[0] === "-c" && a[1]!.startsWith("core.hooksPath=")));
  // A second run finds nothing new and says so.
  const again = harness(e).run();
  assert.equal(again.ok, true);
  assert.equal(again.steps[1]?.detail, "already up to date");
});

test("a dirty tree is refused before anything runs: changed or new files stay, nothing is pulled, npm never starts", () => {
  const e = setup();
  pushFromOther(e.other);
  const head = g(e.pc, "rev-parse", "HEAD");
  // control: the clean clone gets past the first step
  const ctl = harness(e, () => 1).run();
  assert.equal(ctl.steps[0]?.ok, true);
  g(e.pc, "reset", "--hard", head); // undo the control's pull
  for (const dirty of [() => put(e.pc, "JDOLLA/SuperOS/wiki/a.md", "# A, edited on the PC\n"), () => put(e.pc, "JDOLLA/SuperOS/wiki/new.md", "# new\n")]) {
    g(e.pc, "checkout", "--", "."); spawnSync("git", ["clean", "-fdq", "--", "JDOLLA/SuperOS/wiki"], { cwd: e.pc });
    dirty();
    const before = readFileSync(path.join(e.vault, "wiki", "a.md"), "utf8");
    const h = harness(e);
    const r = h.run();
    assert.equal(r.ok, false);
    assert.deepEqual([r.steps.length, r.steps[0]?.name, r.steps[0]?.detail], [1, "clean tree", MSG_DIRTY]);
    assert.ok(h.lines.includes(`  FAIL  clean tree  ${MSG_DIRTY}`));
    assert.equal(g(e.pc, "rev-parse", "HEAD"), head, "nothing pulled");
    assert.equal(readFileSync(path.join(e.vault, "wiki", "a.md"), "utf8"), before, "PC work untouched");
    assert.equal(h.npmCalls.length, 0);
    assert.ok(!h.gitCalls.some((a) => a.includes("pull")));
  }
});

test("a clone that diverged from the remote is never merged: the pull is refused and the local commit stays", () => {
  const e = setup();
  const remoteHead = pushFromOther(e.other);
  put(e.pc, "JDOLLA/SuperOS/wiki/pc.md", "# PC\n"); g(e.pc, "add", "-A"); g(e.pc, "commit", "-m", "PC work");
  const local = g(e.pc, "rev-parse", "HEAD");
  const h = harness(e);
  const r = h.run();
  assert.equal(r.ok, false);
  assert.deepEqual([r.steps[1]?.name, r.steps[1]?.detail], ["git pull --ff-only", MSG_DIVERGED]);
  assert.equal(g(e.pc, "rev-parse", "HEAD"), local, "HEAD unchanged");
  assert.equal(g(e.pc, "rev-list", "--merges", "HEAD"), "", "no merge commit");
  assert.equal(g(e.remote, "rev-parse", "main"), remoteHead, "the remote is untouched");
  assert.equal(g(e.pc, "status", "--porcelain"), "", "no half-done merge or rebase left behind");
  assert.equal(h.npmCalls.length, 0);
});

test("a pull.rebase=true setting still cannot rebase: the pull stays fast-forward only", () => {
  const e = setup();
  pushFromOther(e.other);
  g(e.pc, "config", "pull.rebase", "true");
  put(e.pc, "JDOLLA/SuperOS/wiki/pc.md", "# PC\n"); g(e.pc, "add", "-A"); g(e.pc, "commit", "-m", "PC work");
  const local = g(e.pc, "rev-parse", "HEAD");
  const r = harness(e).run();
  assert.equal(r.steps[1]?.detail, MSG_DIVERGED);
  assert.equal(g(e.pc, "rev-parse", "HEAD"), local, "not rebased onto the remote");
});

test("a failed step stops the rest: npm ci failing means no doctor or smoke; doctor failing means no smoke", () => {
  const e = setup();
  const ci = harness(e, (a) => (a[0] === "ci" ? 1 : 0));
  const r1 = ci.run();
  assert.equal(r1.ok, false);
  assert.deepEqual(ci.npmCalls.map((c) => c.args), [["ci"]]);
  assert.match(r1.steps.at(-1)!.detail, /^failed \(exit 1\)\. Stop the bridge/);
  const doc = harness(e, (a) => (a[1] === "doctor" ? 1 : 0));
  const r2 = doc.run();
  assert.deepEqual(doc.npmCalls.map((c) => c.args), [["ci"], ["run", "doctor"]]);
  assert.deepEqual([r2.ok, r2.steps.at(-1)?.name], [false, "npm run doctor"]);
  const smoke = harness(e, (a) => (a[1] === "smoke" ? 2 : 0));
  const r3 = smoke.run();
  assert.deepEqual([r3.ok, r3.steps.at(-1)?.name, r3.steps.length], [false, "npm run smoke", 5]);
});

test("plain refusals: not a clone, a detached HEAD, no upstream, npm missing; each changes nothing", () => {
  const plain = mkdtempSync(path.join(tmpdir(), "update-plain-"));
  mkdirSync(path.join(plain, "os"));
  const notClone = harness({ ...setup(), vault: plain, osDir: path.join(plain, "os") }).run();
  assert.deepEqual([notClone.ok, notClone.steps[0]?.detail], [false, MSG_NOT_A_CLONE]);

  const e = setup();
  g(e.pc, "checkout", "-q", "--detach");
  assert.equal(harness(e).run().steps[0]?.detail, MSG_DETACHED);
  g(e.pc, "checkout", "-q", "main");

  g(e.pc, "switch", "-q", "-c", "local-only");
  const noUp = harness(e);
  const r = noUp.run();
  assert.deepEqual([r.steps[1]?.name, r.steps[1]?.detail], ["git pull --ff-only", MSG_NO_UPSTREAM]);
  assert.equal(noUp.npmCalls.length, 0);
  g(e.pc, "switch", "-q", "main");

  pushFromOther(e.other);
  const head = g(e.pc, "rev-parse", "HEAD");
  const noNpm = harness(e, () => 0, null);
  const n = noNpm.run();
  assert.deepEqual([n.ok, n.steps[0]?.detail], [false, MSG_NO_NPM]);
  assert.equal(g(e.pc, "rev-parse", "HEAD"), head, "checked before pulling: nothing changed");
});

test("findNpmCli: npm_execpath only when it is npm-cli.js, else next to node on Windows and elsewhere; null when absent", () => {
  const win = "C:\\Program Files\\nodejs\\node.exe";
  const winCli = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
  assert.equal(findNpmCli({}, win, "win32", (p) => p === winCli), winCli);
  assert.equal(findNpmCli({ npm_execpath: "C:\\x\\npm-cli.js" }, win, "win32", () => true), "C:\\x\\npm-cli.js");
  assert.equal(findNpmCli({ npm_execpath: "C:\\x\\pnpm.cjs" }, win, "win32", (p) => p === winCli), winCli, "another package manager is not used");
  assert.equal(findNpmCli({ npm_execpath: "C:\\Program Files\\nodejs\\npm.cmd" }, win, "win32", () => true), winCli, "never npm.cmd");
  const nix = "/usr/local/bin/node";
  assert.equal(findNpmCli({}, nix, "linux", (p) => p === "/usr/local/lib/node_modules/npm/bin/npm-cli.js"), "/usr/local/lib/node_modules/npm/bin/npm-cli.js");
  assert.equal(findNpmCli({}, nix, "linux", () => false), null);
  assert.ok(findNpmCli(process.env, process.execPath), "control: found on this machine");
});

test("the real runner never uses a shell, and npm is started through node, never npm.cmd", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "update.ts"), "utf8").replace(/\r\n/g, "\n"); // a Windows checkout has CRLF
  assert.match(src, /spawnSync\(cmd, \[\.\.\.args\], \{\n\s+cwd, shell: false,/);
  assert.ok(!/shell: true/.test(src));
  assert.ok(!/spawn(Sync)?\(\s*["']npm/.test(src) && !/["']npm\.cmd["']/i.test(src), "npm is never spawned by name, and npm.cmd is never named");
  assert.ok(!/["'`][^"'`\n]*\.env\b/.test(src.replace(/\/\/.*$/gm, "")), "no string in the code names a .env file");
});
