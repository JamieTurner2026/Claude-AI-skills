// START-HERE.md is the one screen Jay follows on the PC. Every command it names must exist, every § it points at must be a
// real heading in PC-SETUP.md, it must stay one screen, and the pages that should link to it must.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { runAutostart, type Env } from "./autostart.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const osDir = path.resolve(here, "..");
const vault = path.resolve(osDir, "..");
const read = (...p: string[]) => readFileSync(path.join(...p), "utf8");
const START = read(vault, "START-HERE.md");
const scripts = (JSON.parse(read(osDir, "package.json")) as { scripts: Record<string, string> }).scripts;
const NPM_BUILTIN = new Set(["install", "ci"]); // npm's own commands, not package scripts

/** Every `npm ...` command in backticks, as { words after npm }. */
function commands(text: string): string[][] {
  return [...text.matchAll(/`(npm [^`]+)`/g)].map((m) => (m[1] as string).split(/\s+/).slice(1));
}

test("START-HERE is one screen: at most 20 lines, none longer than 400 characters, numbered steps 0 to 8 in order", () => {
  const lines = START.split("\n").filter((l) => l.trim() !== "");
  assert.ok(lines.length <= 20, `${lines.length} lines`);
  assert.ok(START.split("\n").every((l) => l.length <= 400));
  assert.deepEqual([...START.matchAll(/^(\d)\. /gm)].map((m) => Number(m[1])), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test("every npm command it names exists in package.json (scripts) or is one of npm's own; brain subcommands exist in the brain CLI", () => {
  const cmds = commands(START);
  assert.ok(cmds.length >= 9, `control: found ${cmds.length} commands`);
  for (const c of cmds) {
    const [first, second] = c;
    if (first === "run") assert.ok(second && scripts[second], `npm run ${second} is not a script`);
    else if (first === "test" || first === "start") assert.ok(scripts[first], `npm ${first} is not a script`);
    else assert.ok(first && NPM_BUILTIN.has(first), `unknown npm command: ${c.join(" ")}`);
  }
  const brain = read(osDir, "brain", "cli.ts");
  for (const c of cmds.filter((x) => x[0] === "run" && x[1] === "brain")) {
    const sub = c[c.indexOf("--") + 1];
    assert.ok(sub && new RegExp(`(?:argv\\[0\\] === |cmd === )"${sub}"|\\b${sub}\\b[^\\n]*\\n`).test(brain) && /usage: brain <[^>]*>/.exec(brain)?.[0].includes(sub), `brain subcommand ${sub}`);
  }
  // The steps the master list requires, in order.
  const order = ["npm run update", "npm run doctor", "npm test", "npm run brain -- index --embeddings", "npm run brain -- import-sessions", "npm run autostart", "npm start", "npm run open", "npm run status"];
  let at = -1;
  for (const o of order) { const i = START.indexOf(`\`${o}`); assert.ok(i > at, `${o} is present and in order`); at = i; }
});

test("a command that does not exist would be caught (negative control)", () => {
  const fakeCmds = commands("`npm run nothing-here` and `npm run doctor`");
  assert.equal(fakeCmds.filter((c) => c[0] === "run" && !scripts[c[1] as string]).length, 1);
});

test("every PC-SETUP § it points at is a real heading there", () => {
  const setup = read(vault, "docs", "PC-SETUP.md");
  // Headings ("## 6b. ..." / "### 5.2 ...") and the bold step labels in section 3 ("**3.1 Install ...**").
  const heads = new Set([...setup.matchAll(/^(?:#{2,3} |\*\*)(\d+(?:\.\d+)?b?)\.? /gm)].map((m) => m[1]));
  const refs = [...START.matchAll(/§(\d+(?:\.\d+)?b?)/g)].map((m) => m[1] as string);
  assert.ok(refs.length >= 9, `control: found ${refs.length} references`);
  for (const r of refs) assert.ok(heads.has(r), `PC-SETUP has no section ${r}`);
  assert.ok(!heads.has("99"), "control: a made-up section is not found");
});

test("Home.md and docs/_index.md link to START-HERE, and STATUS has the three sections", () => {
  assert.match(read(vault, "Home.md"), /\[\[START-HERE\]\]/);
  assert.match(read(vault, "docs", "_index.md"), /\[\[START-HERE\]\]/);
  const status = read(vault, "docs", "STATUS.md");
  const heads = [...status.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(heads.slice(0, 3), ["What works now", "Untested on Windows or the PC", "Waits on Jay"]);
  for (const must of ["private Brain repo", "Gmail", "Calendar", "huggingface"]) assert.ok(status.includes(must), must);
});

// Found by the PC rehearsal (.github/workflows/pc-rehearsal.yml): START-HERE said `npm run autostart`, which only prints
// the usage line; the download size and the test's last line did not match what really happens.
/** The exit code `npm run autostart -- <args>` gives, on a non-Windows Env so nothing can be installed. 2 = usage. */
function autostartExit(args: string[]): number {
  const env: Env = { platform: "linux", osDir, nodePath: process.execPath, user: "u", domain: "", systemRoot: "C:\\Windows", home: tmpdir(), stateFile: path.join(mkdtempSync(path.join(tmpdir(), "as-")), "a.json"), tmp: tmpdir() };
  return runAutostart(args, env, () => { throw new Error("nothing may run"); }, () => undefined);
}

test("every `npm run autostart` the PC reads (START-HERE, PC-SETUP, the Setup checklist) is a command autostart accepts", () => {
  const texts = [START, read(vault, "docs", "PC-SETUP.md"), read(osDir, "bridge", "setup.ts")];
  const found = texts.flatMap((t) => [...t.matchAll(/npm run autostart((?: -- [a-z-]+(?: --[a-z-]+)*)?)/g)].map((m) => (m[1] ?? "").replace(/^ -- /, "").split(" ").filter(Boolean)));
  assert.ok(found.length >= 5, `control: found ${found.length}`);
  for (const args of found) assert.equal(autostartExit(args), 0, `npm run autostart ${args.length ? "-- " + args.join(" ") : ""} only prints the usage line`);
  assert.equal(autostartExit([]), 2, "control: plain `npm run autostart` is refused with the usage line");
});

test("START-HERE's download size is PC-SETUP §5.2's runtime plus model", () => {
  const start = Number(/about (\d+) MB, once/.exec(START)?.[1]);
  const sec = read(vault, "docs", "PC-SETUP.md").split("### 5.2")[1]!.split("### 5.3")[0]!;
  const runtime = Number(/runtime \(about (\d+) MB\)/.exec(sec)?.[1]), model = Number(/model \(about (\d+) MB\)/.exec(sec)?.[1]);
  assert.ok(runtime > 0 && model > 0, "control: PC-SETUP §5.2 names both sizes");
  assert.ok(Math.abs(start - (runtime + model)) <= 10, `START-HERE says ${start} MB, PC-SETUP ${runtime} + ${model} MB`);
});

test("the last line the docs promise for npm test is what node --test prints in a terminal (the spec reporter)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "spec-"));
  writeFileSync(path.join(dir, "one.test.mjs"), 'import { test } from "node:test"; test("one", () => {});\n');
  const r = spawnSync(process.execPath, ["--test", "--test-reporter=spec", "one.test.mjs"], { cwd: dir, encoding: "utf8", env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "NODE_TEST_CONTEXT")), NODE_OPTIONS: "", NO_COLOR: "1" } }); // a nested runner would report to this one
  assert.match(r.stdout, /^ℹ fail 0$/m, "node --test in a terminal ends with ℹ fail 0");
  assert.doesNotMatch(r.stdout, /^# fail 0$/m, "control: not the TAP line");
  assert.match(START, /`ℹ fail 0`/);
  assert.match(read(vault, "docs", "PC-SETUP.md"), /`npm test` end with `ℹ fail 0`/);
});
