// `npm run update`: one safe command to bring the PC up to date (PC-SETUP §2 and §9).
// Order: the git tree must be clean, then `git pull --ff-only`, then `npm ci`, `npm run doctor`, `npm run smoke`.
// It never merges, rebases, resets or forces; it stops at the first failed step and says so in one plain line.
// git and npm run as argument lists with shell: false. npm is started as `node npm-cli.js`, so Windows never
// needs npm.cmd (which cannot start without a shell). Nothing here reads or writes .env, notes or the brain index:
// a pull only changes tracked files, and the tree is clean before it runs.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type ExecResult = { code: number | null; stdout: string; stderr: string };
/** Runs one program with an argument list. `inherit` shows its output live (npm steps); otherwise output is captured. */
export type Exec = (cmd: string, args: readonly string[], opts: { cwd: string; inherit: boolean }) => ExecResult;
export type Step = { name: string; ok: boolean; detail: string };
export type UpdateResult = { ok: boolean; steps: Step[]; before: string | null; after: string | null };
export type UpdateDeps = {
  /** The vault folder (JDOLLA/SuperOS). git runs here; it may be a subfolder of the clone. */
  vault: string;
  /** The vault's os/ folder, where npm runs. */
  osDir: string;
  /** Path to npm-cli.js, or null when npm was not found next to node. */
  npmCli: string | null;
  node: string;
  exec: Exec;
  out: (line: string) => void;
};

export const MSG_DIRTY = "You have local changes: commit or stash them first. Nothing was changed.";
export const MSG_DIVERGED = "Your copy and GitHub have both changed, so a fast-forward is not possible. Nothing was changed. Ask Claude to merge them (PC-SETUP §2).";
export const MSG_NOT_A_CLONE = "This vault folder is not a git clone, so it cannot update itself. Nothing was changed. See PC-SETUP §2.";
export const MSG_NO_GIT = "git is not installed (or not on PATH) on this PC. Install Git for Windows, then try again. Nothing was changed.";
export const MSG_DETACHED = "The clone is not on a branch (detached HEAD). Run git switch main first. Nothing was changed.";
export const MSG_NO_UPSTREAM = "This branch does not track a branch on GitHub, so there is nothing to pull from. Run git switch main first. Nothing was changed.";
export const MSG_NO_NPM = "npm was not found next to this Node. Reinstall Node.js 22 (PC-SETUP §1). Nothing was changed.";

/** git hooks and fsmonitor are off for every call: an update never runs code from the repo's .git folder. */
const GIT_SAFE = ["-c", `core.hooksPath=${os.devNull}`, "-c", "core.fsmonitor=false"];

/**
 * Where npm-cli.js is. `npm run` sets npm_execpath to it; otherwise it sits next to node
 * (Windows: <node dir>\node_modules\npm, elsewhere: <prefix>/lib/node_modules/npm).
 */
export function findNpmCli(env: NodeJS.ProcessEnv, nodePath: string, platform: string = process.platform, exists: (p: string) => boolean = existsSync): string | null {
  const p = platform === "win32" ? path.win32 : path.posix;
  const dir = p.dirname(nodePath);
  const candidates = [
    env["npm_execpath"],
    p.join(dir, "node_modules", "npm", "bin", "npm-cli.js"),
    p.join(dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const c of candidates) if (c && p.basename(c).toLowerCase() === "npm-cli.js" && exists(c)) return c;
  return null;
}

const firstLine = (s: string) => (s.trim().split(/\r?\n/).find((l) => l.trim()) ?? "").trim().slice(0, 300);

export function runUpdate(d: UpdateDeps): UpdateResult {
  const steps: Step[] = [];
  const res: UpdateResult = { ok: false, steps, before: null, after: null };
  const say = (s: Step) => { steps.push(s); d.out(`  ${s.ok ? "PASS" : "FAIL"}  ${s.name}  ${s.detail}`); return s.ok; };
  const git = (...args: string[]) => d.exec("git", [...GIT_SAFE, ...args], { cwd: d.vault, inherit: false });
  const npm = (...args: string[]) => d.exec(d.node, [d.npmCli as string, ...args], { cwd: d.osDir, inherit: true });

  d.out("JDOLLA$ update (git pull --ff-only, npm ci, doctor, smoke)");
  d.out("");

  // 1. Clean tree. Untracked files count: a new note is PC work too.
  const st = git("status", "--porcelain");
  if (st.code === null) { say({ name: "clean tree", ok: false, detail: MSG_NO_GIT }); return res; }
  if (st.code !== 0) { say({ name: "clean tree", ok: false, detail: MSG_NOT_A_CLONE }); return res; }
  if (st.stdout.trim() !== "") { say({ name: "clean tree", ok: false, detail: MSG_DIRTY }); return res; }
  const branch = git("symbolic-ref", "-q", "--short", "HEAD");
  if (branch.code !== 0 || !branch.stdout.trim()) { say({ name: "clean tree", ok: false, detail: MSG_DETACHED }); return res; }
  if (!d.npmCli) { say({ name: "clean tree", ok: false, detail: MSG_NO_NPM }); return res; }
  say({ name: "clean tree", ok: true, detail: `on ${branch.stdout.trim()}, no local changes` });

  // 2. Fast-forward only. A refusal leaves the clone exactly as it was.
  res.before = git("rev-parse", "HEAD").stdout.trim() || null;
  // --no-rebase too: a pull.rebase=true setting must not turn this into a rebase.
  const pull = git("pull", "--no-rebase", "--ff-only");
  if (pull.code !== 0) {
    const why = `${pull.stderr}\n${pull.stdout}`;
    const detail = pull.code === null ? MSG_NO_GIT
      : /not possible to fast-forward|diverg|non-fast-forward/i.test(why) ? MSG_DIVERGED
      : /no tracking information|no such ref was fetched|does not track/i.test(why) ? MSG_NO_UPSTREAM
      : `git pull failed: ${firstLine(why) || `exit ${pull.code}`}. Nothing was changed.`;
    say({ name: "git pull --ff-only", ok: false, detail });
    return res;
  }
  res.after = git("rev-parse", "HEAD").stdout.trim() || null;
  const moved = res.before !== res.after;
  say({ name: "git pull --ff-only", ok: true, detail: moved ? `${res.before?.slice(0, 7)} -> ${res.after?.slice(0, 7)}` : "already up to date" });

  // 3-5. Dependencies, then the PC checks. Each must pass before the next.
  for (const [name, args] of [["npm ci", ["ci"]], ["npm run doctor", ["run", "doctor"]], ["npm run smoke", ["run", "smoke"]]] as const) {
    const r = npm(...args);
    if (r.code !== 0) {
      const hint = name === "npm ci" ? "Stop the bridge if it is running (files in use), then run npm run update again."
        : name === "npm run doctor" ? "Fix the FAIL rows above (each names its PC-SETUP section), then run npm run update again."
        : "Don't start the bridge: send Claude the FAIL lines above.";
      say({ name, ok: false, detail: `failed (exit ${r.code ?? "none"}). ${hint}` });
      return res;
    }
    say({ name, ok: true, detail: "ok" });
  }
  res.ok = true;
  return res;
}

/** The real runner: argument list, never a shell; git messages in English so refusals can be recognised. */
export const realExec: Exec = (cmd, args, { cwd, inherit }) => {
  const r = spawnSync(cmd, [...args], {
    cwd, shell: false, windowsHide: true, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    stdio: inherit ? ["ignore", "inherit", "inherit"] : ["ignore", "pipe", "pipe"],
    env: { ...process.env, LC_ALL: "C", LANG: "C", GIT_TERMINAL_PROMPT: "0" },
  });
  if (r.error) return { code: null, stdout: "", stderr: String(r.error.message) };
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};
