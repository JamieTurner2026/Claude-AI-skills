// PC rehearsal: START-HERE.md, line by line, on a fresh clone in a temp folder, the closest the cloud gets to Jay's PC.
// Run by .github/workflows/pc-rehearsal.yml on windows-latest (by hand and weekly), and by hand anywhere:
//   node JDOLLA/SuperOS/os/bridge/pc-rehearsal.ts <repo checkout> <work folder> <output folder>
// Only Node built-ins: it runs from the checkout before anything is installed.
//
// What is stubbed, and only this:
//   - the Claude CLI: claudeBin in the clone's (git-ignored) os/config/os.local.json points at a wrapper around
//     bridge/fake-claude.ts, the way PC-SETUP §1 sets an npm-installed CLI. No question is asked (§8 costs money).
//   - the embedding download (START-HERE step 4): skipped, with a note. It is ~520 MB from the internet.
// Everything else is the real command, in the clone, with HOME/USERPROFILE moved into the work folder so the runner's
// own profile is never touched. `npm run autostart` is only ever run with --dry-run, and the run checks afterwards that
// no logon task exists. `npm run open` is skipped (it opens a browser).
// Each step's output is saved, scrubbed of the work folder, the runner's paths and the user name, to <output>/NN-*.log,
// with summary.md and summary.json. Exit 0 when every step passed, 1 otherwise.
import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type Step = { n: string; name: string; doc: string; result: "PASS" | "FAIL" | "SKIP"; exit: number | null; seconds: number; notes: string[] };

/** Every spelling of a private string a log can hold: as given, forward slashes, JSON-escaped, and case-folded on Windows. */
export function variants(s: string): string[] {
  const out = new Set([s, s.replace(/\\/g, "/"), s.replace(/\\/g, "\\\\"), s.replace(/\//g, "\\")]);
  return [...out].filter((v) => v.length >= 3).sort((a, b) => b.length - a.length);
}

/** Replace each secret-ish string (longest first) with its label, case-insensitively. Labels are like <work>. */
export function scrub(text: string, secrets: Array<[string, string]>): string {
  const pairs = secrets.flatMap(([value, label]) => variants(value).map((v) => [v, label] as const)).sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [v, label] of pairs) out = out.replace(new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), label);
  return out;
}

/** Strings that must never reach the saved logs: the work folder, the runner's real home and user name, and 8.3 names. */
export function secretsFor(work: string, realHome: string, user: string): Array<[string, string]> {
  const list: Array<[string, string]> = [[work, "<work>"], [realHome, "<home>"]];
  try { const r = realpathSync.native(work); if (r !== work) list.push([r, "<work>"]); } catch { /* not there yet */ }
  if (process.env["RUNNER_TEMP"]) list.push([process.env["RUNNER_TEMP"], "<runner-temp>"]);
  if (process.env["GITHUB_WORKSPACE"]) list.push([process.env["GITHUB_WORKSPACE"], "<checkout>"]);
  // Windows short names (C:\Users\RUNNER~1) and the user name on its own, last, so the longer paths match first.
  list.push(["RUNNER~1", "<user>"]);
  if (user.length >= 3) list.push([user, "<user>"]);
  return list;
}

/** "# fail 0" (TAP, when output goes to a file or CI) or "ℹ fail 0" (spec, in a terminal): node --test's last count line. */
export function testCounts(out: string): { pass: number; fail: number } | null {
  const pass = /^(?:# |ℹ )pass (\d+)$/m.exec(out), fail = /^(?:# |ℹ )fail (\d+)$/m.exec(out);
  return pass && fail ? { pass: Number(pass[1]), fail: Number(fail[1]) } : null;
}

const win = process.platform === "win32";

type Ctx = { clone: string; osDir: string; out: string; env: NodeJS.ProcessEnv; secrets: Array<[string, string]>; steps: Step[] };

/** One command the way Jay types it: in PowerShell on Windows (bash elsewhere), in os/. */
function sh(ctx: Ctx, cmd: string, cwd = ctx.osDir, timeoutMs = 20 * 60_000): SpawnSyncReturns<string> {
  return win
    ? spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], { cwd, env: ctx.env, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 })
    : spawnSync("bash", ["-c", cmd], { cwd, env: ctx.env, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
}
const git = (args: string[], cwd: string, env: NodeJS.ProcessEnv) => spawnSync("git", args, { cwd, env, encoding: "utf8" });

function record(ctx: Ctx, n: string, name: string, doc: string, log: string, exit: number | null, t0: number, checks: Array<[boolean, string]>, extraNotes: string[] = []): Step {
  const failed = checks.filter(([ok]) => !ok).map(([, why]) => `FAIL: ${why}`);
  const passed = checks.filter(([ok]) => ok).map(([, why]) => `ok: ${why}`);
  const step: Step = { n, name, doc, result: failed.length ? "FAIL" : "PASS", exit, seconds: Math.round((Date.now() - t0) / 100) / 10, notes: [...failed, ...extraNotes, ...passed] };
  const file = path.join(ctx.out, `${n.padStart(2, "0").replace(/\W/g, "-")}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-|-$/g, "")}.log`);
  writeFileSync(file, scrub(`$ ${name}\n(exit ${exit})\n\n${log}\n\n${step.notes.join("\n")}\n`, ctx.secrets));
  ctx.steps.push(step);
  console.log(`${step.result}  ${n}. ${name}${failed.length ? `\n      ${failed.join("\n      ")}` : ""}`);
  return step;
}

function run(ctx: Ctx, n: string, cmd: string, doc: string, checks: (out: string, exit: number | null) => Array<[boolean, string]>, cwd?: string): string {
  const t0 = Date.now();
  const r = sh(ctx, cmd, cwd);
  const out = `${r.stdout ?? ""}${r.stderr ? `\n--- stderr ---\n${r.stderr}` : ""}${r.error ? `\n--- error ---\n${r.error.message}` : ""}`;
  record(ctx, n, cmd, doc, out, r.status, t0, checks(out, r.status));
  return out;
}

function skip(ctx: Ctx, n: string, name: string, doc: string, why: string): void {
  ctx.steps.push({ n, name, doc, result: "SKIP", exit: null, seconds: 0, notes: [why] });
  writeFileSync(path.join(ctx.out, `${n}-skipped.log`), `$ ${name}\nSKIPPED: ${why}\n`);
  console.log(`SKIP  ${n}. ${name}: ${why}`);
}

const clean = (ctx: Ctx): [boolean, string] => {
  const s = git(["status", "--porcelain"], ctx.clone, ctx.env).stdout.trim();
  return [s === "", s === "" ? "the working tree is still clean (so `npm run update` can pull)" : `the working tree is dirty: ${s.split("\n").slice(0, 5).join("; ")}`];
};

async function startAndStatus(ctx: Ctx): Promise<void> {
  const t0 = Date.now();
  // npm start in the background, the way a second PowerShell window would hold it. Its pid line names the bridge's own pid.
  const child = win
    ? spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "npm start"], { cwd: ctx.osDir, env: ctx.env, stdio: ["ignore", "pipe", "pipe"] })
    : spawn("bash", ["-c", "npm start"], { cwd: ctx.osDir, env: ctx.env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = "";
  child.stdout.on("data", (d: Buffer) => { log += d.toString(); });
  child.stderr.on("data", (d: Buffer) => { log += d.toString(); });
  const pid = await new Promise<number | null>((resolve) => {
    const t = setInterval(() => {
      const m = /bridge running on http:\/\/127\.0\.0\.1:(\d+) \(pid (\d+)\)/.exec(log);
      if (m) { clearInterval(t); resolve(Number(m[2])); }
      else if (Date.now() - t0 > 90_000 || child.exitCode !== null) { clearInterval(t); resolve(null); }
    }, 250);
  });
  const port = /127\.0\.0\.1:(\d+)/.exec(log)?.[1];
  record(ctx, "7", "npm start (in the background)", "START-HERE 7, PC-SETUP §6", log, null, t0, [
    [pid !== null, "it printed `JDOLLA$ bridge running on http://127.0.0.1:<port> (pid N)` (PC-SETUP §6)"],
    [port === "4317", `it listens on the documented port 4317 (got ${port ?? "none"})`],
    [/Open the dashboard with: npm run open/.test(log), "it says how to open the dashboard (`npm run open`)"],
  ]);
  skip(ctx, "7b", "npm run open", "START-HERE 7, PC-SETUP §7", "opens a browser, which a CI runner has no one to look at; the dashboard is checked by `npm run smoke` (in step 1) and `npm run a11y`.");

  if (pid !== null) {
    run(ctx, "8", "npm run status", "START-HERE 8, PC-SETUP §9.2", (out, exit) => [
      [exit === 0, `it exits 0 while the bridge is healthy (got ${exit})`],
      [/1\.0\.0|version/i.test(out), "the table shows the version"],
      [!/not running/.test(out), "it does not say not running"],
    ]);
    // Stop it by pid, as Jay would close the window. Then the status check must say "not running" and exit 1.
    const t1 = Date.now();
    const kill = win ? spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8" }) : spawnSync("kill", [String(pid)], { encoding: "utf8" });
    const gone = await new Promise<boolean>((resolve) => {
      const t = setInterval(() => {
        let alive = true;
        try { process.kill(pid, 0); } catch { alive = false; }
        if (!alive) { clearInterval(t); resolve(true); } else if (Date.now() - t1 > 20_000) { clearInterval(t); resolve(false); }
      }, 250);
    });
    record(ctx, "8b", `stop the bridge by its pid`, "START-HERE 7 (Ctrl+C in that window)", `${kill.stdout ?? ""}${kill.stderr ?? ""}`, kill.status, t1, [[gone, "the bridge process is gone"]]);
    run(ctx, "8c", "npm run status", "PC-SETUP §9.2", (out, exit) => [
      [exit === 1, `with the bridge stopped it exits 1 (got ${exit})`],
      [/not running/.test(out), "it prints `not running`"],
    ]);
  }
  try { if (win) spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"]); else process.kill(-(child.pid ?? 0), "SIGTERM"); } catch { /* already gone */ }
}

export async function rehearse(source: string, work: string, out: string): Promise<Step[]> {
  mkdirSync(work, { recursive: true });
  mkdirSync(out, { recursive: true });
  const realHome = process.env["USERPROFILE"] ?? process.env["HOME"] ?? userInfo().homedir;
  const home = path.join(work, "home");
  mkdirSync(home, { recursive: true });
  const base: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, GIT_TERMINAL_PROMPT: "0", npm_config_update_notifier: "false", npm_config_fund: "false" };
  for (const k of Object.keys(base)) if (/^(GITHUB_TOKEN|ACTIONS_|INPUT_)/.test(k)) delete base[k];
  // Git in a temp HOME has no identity and no global config; give the rehearsal's own commit one, and nothing else.
  const gitEnv = { ...base, GIT_AUTHOR_NAME: "rehearsal", GIT_AUTHOR_EMAIL: "rehearsal@localhost", GIT_COMMITTER_NAME: "rehearsal", GIT_COMMITTER_EMAIL: "rehearsal@localhost" };
  const ctx: Ctx = { clone: path.join(work, "pc", "Claude-AI-skills"), osDir: path.join(work, "pc", "Claude-AI-skills", "JDOLLA", "SuperOS", "os"), out, env: base, secrets: secretsFor(work, realHome, userInfo().username), steps: [] };

  // "GitHub": a bare repo holding this commit as main. After the clone it gains one newer commit, so step 1 really pulls.
  const origin = path.join(work, "origin.git");
  const setup: string[] = [];
  const g = (args: string[], cwd: string, env = gitEnv) => { const r = git(args, cwd, env); setup.push(`$ git ${args.join(" ")}\n${r.stdout}${r.stderr}`); if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr}`); return r.stdout.trim(); };
  g(["init", "--bare", "-q", origin], work);
  g(["push", "-q", origin, "HEAD:refs/heads/main"], source);
  g(["--git-dir", origin, "symbolic-ref", "HEAD", "refs/heads/main"], work);

  // Step 0: git clone, then npm install (the stub is written first, as PC-SETUP §1 comes before §3.1).
  let t0 = Date.now();
  const cl = git(["clone", "-q", origin, ctx.clone], work, base);
  record(ctx, "0a", "git clone <origin> (START-HERE uses the GitHub URL; here the origin is a local copy of this commit)", "START-HERE 0, PC-SETUP §2", `${cl.stdout}${cl.stderr}`, cl.status, t0, [
    [cl.status === 0 && existsSync(ctx.osDir), "the clone has JDOLLA/SuperOS/os"],
  ]);
  if (cl.status !== 0) return ctx.steps;
  const fakeDir = path.join(work, "fake-claude");
  mkdirSync(fakeDir, { recursive: true });
  const wrapper = path.join(fakeDir, "cli.mjs");
  writeFileSync(wrapper, `// Stand-in for the Claude Code CLI's cli.js (PC rehearsal only).\nawait import(${JSON.stringify(pathToFileURL(path.join(ctx.osDir, "bridge", "fake-claude.ts")).href)});\n`);
  writeFileSync(path.join(ctx.osDir, "config", "os.local.json"), JSON.stringify({ claudeBin: wrapper }, null, 2) + "\n");
  ctx.steps.push({ n: "0b", name: "stub the Claude CLI: claudeBin in os/config/os.local.json points at the fake", doc: "PC-SETUP §1", result: "PASS", exit: null, seconds: 0, notes: ["STUB: the fake CLI stands in for Claude Code; no question is asked (§8 costs money)."] });
  const nodeV = sh(ctx, "node --version").stdout.trim();
  run(ctx, "0c", "npm install", "START-HERE 0, PC-SETUP §3.1", (_o, exit) => [
    [exit === 0, `it exits 0 (got ${exit})`],
    [/^v(2[2-9]|[3-9]\d)\./.test(nodeV), `Node is 22.18 or newer (${nodeV})`],
    clean(ctx),
  ]);

  // The newer commit on "GitHub", made in a scratch clone so the PC clone never sees it until it pulls.
  const scratch = path.join(work, "scratch");
  g(["clone", "-q", origin, scratch], work);
  g(["commit", "-q", "--allow-empty", "-m", "rehearsal: a newer commit on origin"], scratch);
  g(["push", "-q", "origin", "HEAD:main"], scratch);
  const newest = g(["rev-parse", "HEAD"], scratch);
  writeFileSync(path.join(out, "00-setup.log"), scrub(setup.join("\n"), ctx.secrets));

  // Step 1: npm run update. It pulls the newer commit (ff-only), runs npm ci, the doctor and the smoke check.
  run(ctx, "1", "npm run update", "START-HERE 1, PC-SETUP §2", (o, exit) => {
    const head = git(["rev-parse", "HEAD"], ctx.clone, base).stdout.trim();
    return [
      [exit === 0, `it exits 0 (got ${exit})`],
      [head === newest, "it fast-forwarded to the newer commit on origin"],
      [/PASS/.test(o) && !/FAIL/.test(o), "every line says PASS"],
      [/npm ci/.test(o), "it ran `npm ci` (START-HERE: installs)"],
      [/doctor/i.test(o) && /smoke/i.test(o), "it ran the doctor and the smoke check"],
      clean(ctx),
    ];
  });

  // Step 2: the doctor. Exit 0 = no FAIL row (WARN is fine: no Bash sandbox on Windows, no meaning search, no backup).
  run(ctx, "2", "npm run doctor", "START-HERE 2, PC-SETUP §3.2", (o, exit) => [
    [exit === 0, `no FAIL row, exit 0 (got ${exit})`],
    [/PASS\s+Claude CLI/.test(o), "the Claude CLI row passes (through os.local.json)"],
    [/WARN|PASS/.test(o), "it printed check rows"],
  ]);
  run(ctx, "2b", "npm run doctor -- --json", "PC-SETUP §3.2", (o, exit) => {
    let ok = false;
    try { const j = JSON.parse(o.slice(o.indexOf("{"), o.lastIndexOf("}") + 1)) as unknown; ok = typeof j === "object" && j !== null; } catch { /* below */ }
    return [[exit === 0, `exit 0 (got ${exit})`], [ok, "the output is JSON"]];
  });

  // Step 3: npm test (and npm run check, which goes with it).
  run(ctx, "3a", "npm run check", "START-HERE 3, PC-SETUP §3.3", (_o, exit) => [[exit === 0, `no type errors, exit 0 (got ${exit})`]]);
  run(ctx, "3b", "npm test", "START-HERE 3, PC-SETUP §3.3", (o, exit) => {
    const c = testCounts(o);
    return [[exit === 0, `exit 0 (got ${exit})`], [c !== null && c.fail === 0, `it ends with a fail 0 line (${c ? `pass ${c.pass}, fail ${c.fail}` : "no count line"})`], [c !== null && c.pass > 0, "tests ran"]];
  });

  // Step 4: meaning search, skipped: the one command that downloads (~520 MB).
  skip(ctx, "4", "npm run brain -- index --embeddings", "START-HERE 4, PC-SETUP §5.2", "STUB: skipped on purpose, it downloads a ~500 MB runtime and a 23 MB model. The runtime's pin and the outdated-runtime path are covered by brain/embed-runtime.test.ts.");

  // Step 5: import sessions (none on a fresh runner), then the index.
  run(ctx, "5a", "npm run brain -- import-sessions --dry-run", "START-HERE 5, PC-SETUP §5.3", (_o, exit) => [[exit === 0, `exit 0 (got ${exit})`], clean(ctx)]);
  run(ctx, "5b", "npm run brain -- import-sessions", "START-HERE 5, PC-SETUP §5.3", (_o, exit) => [[exit === 0, `exit 0 (got ${exit})`], clean(ctx)]);
  run(ctx, "5c", "npm run brain -- index", "START-HERE 5, PC-SETUP §5.1", (o, exit) => [
    [exit === 0, `exit 0 (got ${exit})`],
    [/indexed \d+ files, \d+ chunks/.test(o), "it prints `indexed N files, M chunks` (PC-SETUP §5.1)"],
  ]);

  // Step 6: autostart, plan only. --dry-run always only prints; afterwards no task may exist.
  run(ctx, "6", "npm run autostart -- install --dry-run", "START-HERE 6, PC-SETUP §6b", (o, exit) => {
    const checks: Array<[boolean, string]> = [[exit === 0, `exit 0 (got ${exit})`], [/nothing changed/i.test(o), "it says nothing changed"]];
    if (win) {
      checks.push([/schtasks\.exe/i.test(o) && /JDOLLA SuperOS bridge/.test(o), "it shows the schtasks.exe command and the task name"]);
      const q = spawnSync("schtasks.exe", ["/Query", "/TN", "JDOLLA SuperOS bridge"], { encoding: "utf8" });
      checks.push([q.status !== 0, "no logon task was installed on the runner"]);
    }
    return checks;
  });
  run(ctx, "6b", "npm run autostart -- status", "PC-SETUP §6b", (o, exit) => [[exit === 0, `exit 0 (got ${exit})`], [win ? /No task named/.test(o) : /only installed automatically on Windows/.test(o), "it reports no task"]]);

  // Steps 7 and 8: start, status, stop by pid, status again.
  await startAndStatus(ctx);
  return ctx.steps;
}

export function summary(steps: Step[]): string {
  const rows = steps.map((s) => `| ${s.n} | ${s.result} | \`${s.name.replace(/\|/g, "\\|")}\` | ${s.doc} | ${s.notes.filter((x) => !x.startsWith("ok: ")).join("<br>").replace(/\|/g, "\\|") || "as documented"} |`);
  const c = (r: Step["result"]) => steps.filter((s) => s.result === r).length;
  return [`# PC rehearsal (${process.platform}, Node ${process.version})`, "", `${c("PASS")} passed, ${c("FAIL")} failed, ${c("SKIP")} skipped.`, "", "| Step | Result | Command | Doc | Notes |", "|---|---|---|---|---|", ...rows, ""].join("\n");
}

if (import.meta.main) {
  const [source, work, out] = process.argv.slice(2);
  if (!source || !work || !out) { console.error("usage: node bridge/pc-rehearsal.ts <repo checkout> <work folder> <output folder>"); process.exit(2); }
  const steps = await rehearse(path.resolve(source), path.resolve(work), path.resolve(out)).catch((e: Error) => { console.error(`setup failed: ${e.message}`); return [] as Step[]; });
  const md = summary(steps);
  const secrets = secretsFor(path.resolve(work), process.env["USERPROFILE"] ?? process.env["HOME"] ?? "", userInfo().username);
  writeFileSync(path.join(out, "summary.md"), scrub(md, secrets));
  writeFileSync(path.join(out, "summary.json"), scrub(JSON.stringify(steps, null, 2), secrets));
  if (process.env["GITHUB_STEP_SUMMARY"]) writeFileSync(process.env["GITHUB_STEP_SUMMARY"], scrub(md, secrets), { flag: "a" });
  // The scrub is checked, not trusted: no saved file may still hold the user name or the work folder.
  const leaks = readdirLeaks(out, secrets);
  for (const l of leaks) console.error(`LEAK  ${l}`);
  console.log(`\n${md}`);
  process.exitCode = steps.length && steps.every((s) => s.result !== "FAIL") && !leaks.length ? 0 : 1;
}

function readdirLeaks(dir: string, secrets: Array<[string, string]>): string[] {
  const found: string[] = [];
  for (const f of readdirSync(dir)) {
    const text = readFileSync(path.join(dir, f), "utf8");
    for (const [v, label] of secrets) for (const s of variants(v)) if (text.toLowerCase().includes(s.toLowerCase())) found.push(`${f} still holds ${label}`);
  }
  return [...new Set(found)];
}
