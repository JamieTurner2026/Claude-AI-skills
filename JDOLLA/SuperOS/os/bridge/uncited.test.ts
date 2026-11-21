// 7e: an answer that came from the brain but names no vault note becomes a learning-loop proposal ("uncited").
// Fake Claude CLI only. Every "no proposal" case has a control that does make one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRAIN_HINT } from "./brain-link.ts";
import { loadConfig, pathsFor, saveConfig } from "./config.ts";
import { makeVault } from "./fixture.ts";
import { UNCITED_RULE, isUncitedAnswer, namesVaultSource } from "./learning.ts";
import type { Proposal } from "./learning.ts";
import type { InternalRunOptions, RunInfo } from "./runs.ts";
import { createBridge } from "./server.ts";
import type { Bridge } from "./server.ts";

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-claude.ts");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- the detector ----------

test("namesVaultSource: a vault path with a known extension, or a [[wikilink]], counts; nothing else does", () => {
  for (const yes of [
    "see wiki/software/api-bible.md", "(source: wiki/software/api-bible.md)", "`raw/industrial/charter/brief.md`.", "[the note](wiki/ai/charter.md)",
    "depts/software.md", "reports/2026-11-16_plan-today.md", "outputs/2026-11/2026-11-16_ai_x.pdf", "projects/davidson-blessons.md", "raw/a/b/data.json", "wiki/a/chart.PNG",
    "wiki/a b.md is odd but wiki/ok.txt is fine", "[[wiki/software/api-bible]]", "[[api-bible]]", "[[wiki/a|alias]]", "see [[Home]] and more", "First line\nwiki/x/y.md\nlast",
  ]) assert.ok(namesVaultSource(yes), yes);
  for (const no of [
    "", "The bridge listens on port 4317.", "wiki/software/api-bible", "wiki/software/", "wiki/a.exe", "wiki/a.md5", "os/config/os.config.json", "os/README.md", "logs/run.md",
    "Twiki/a.md", "mywiki/a.md", "https://example.com/wiki/a.md", "../wiki/a.md", "./wiki/a.md", "[[ ]]", "[[]]", "[[unclosed", "[x] and [y]", "a [[b\nc]] d", "raw/", "the wiki/ folder",
  ]) assert.ok(!namesVaultSource(no), JSON.stringify(no));
  const t0 = Date.now();
  assert.equal(namesVaultSource("wiki/".repeat(20_000)), false);
  assert.equal(namesVaultSource("[[".repeat(20_000)), false);
  assert.ok(Date.now() - t0 < 1000, "adversarial text is checked quickly");
});

const info = (over: Partial<RunInfo>): RunInfo => ({ id: "x", tier: "T2", text: "t", dept: "general", status: "done", startedAt: "", endedAt: "", capUsd: 0.05, costUsd: 0.01, output: "", error: null, deliverables: [], denied: [], result: "The port is 4317.", routine: null, skill: null, purpose: "run", toolsUsed: ["mcp__superos-brain__search"], notesOpened: [], ...over });

test("isUncitedAnswer: only a finished ordinary T2 run that read the brain and named nothing", () => {
  assert.equal(isUncitedAnswer(info({})), true, "control");
  assert.equal(isUncitedAnswer(info({ toolsUsed: ["mcp__superos-brain__get_note"] })), true, "get_note alone also counts");
  for (const [label, over] of [
    ["T3", { tier: "T3" }], ["failed", { status: "failed" }], ["stopped", { status: "stopped" }], ["running", { status: "running" }], ["diagnosis", { purpose: "diagnosis" }], ["inbox triage", { dept: "inbox" }],
    ["NOTHING_NEW", { result: "NOTHING_NEW" }], ["NOTHING_NEW with spaces", { result: "  NOTHING_NEW\n" }], ["empty answer", { result: "" }], ["no answer", { result: null }],
    ["no brain", { toolsUsed: ["Read", "mcp__superos-tools__today"] }], ["no tools", { toolsUsed: [] }], ["cited by path", { result: "See wiki/a.md" }], ["cited by link", { result: "See [[wiki/a]]" }],
  ] as Array<[string, Partial<RunInfo>]>) assert.equal(isUncitedAnswer(info(over)), false, label);
});

// ---------- through the bridge ----------

type Env = { b: Bridge; vault: string; logs: string; base: string; token: string; tick: (days?: number) => void; close: () => void };
async function setup(opts: { skills?: string[]; configure?: (c: ReturnType<typeof loadConfig>) => ReturnType<typeof loadConfig> } = {}): Promise<Env> {
  const vault = makeVault();
  mkdirSync(path.join(vault, "skills"), { recursive: true });
  for (const s of opts.skills ?? []) { mkdirSync(path.join(vault, "skills", s), { recursive: true }); writeFileSync(path.join(vault, "skills", s, "SKILL.md"), `---\nname: ${s}\ndescription: demo\n---\n# ${s}\n\nBody text.\n`); }
  const paths = pathsFor(path.join(vault, "os"));
  if (opts.configure) saveConfig(paths, opts.configure(loadConfig(paths)));
  const logs = mkdtempSync(path.join(tmpdir(), "uncited-logs-"));
  let now = Date.parse("2026-11-16T15:00:00Z");
  const b = createBridge(paths.os, { claudeBin: { cmd: process.execPath, prefixArgs: [fake] }, logDir: logs, brainDbPath: path.join(logs, "brain.sqlite"), now: () => new Date(now) });
  await new Promise<void>((r) => b.server.listen(0, "127.0.0.1", r));
  return { b, vault, logs, base: `http://127.0.0.1:${(b.server.address() as AddressInfo).port}`, token: b.mint(), tick: (days = 1) => { now += days * 86_400_000; }, close: () => { b.runs.stopAll(); b.server.close(); } };
}
async function go(e: Env, req: { text: string; tier?: "T2" | "T3"; skill?: string; dept?: string }, internal: InternalRunOptions = {}): Promise<RunInfo> {
  const run = e.b.runs.start({ text: req.text, tier: req.tier ?? "T2", ...(req.skill ? { skill: req.skill } : {}), ...(req.dept ? { dept: req.dept } : {}) }, internal);
  if (e.b.runs.get(run.id)?.status === "running") await new Promise<void>((resolve) => { e.b.runs.subscribe(run.id, (ev) => { if (ev.type === "status" && ev.status !== "running") resolve(); }); });
  await sleep(60); // let the end listeners (the learning loop) finish
  return e.b.runs.get(run.id)!;
}
const proposals = (e: Env): Proposal[] => e.b.learning.list();
const post = (e: Env, p: string) => fetch(e.base + p, { method: "POST", headers: { "content-type": "application/json", "x-superos": "1", authorization: `Bearer ${e.token}` }, body: "{}" });
const argvOf = (r: RunInfo): string[] => JSON.parse(/ARGV:(.*)/.exec(r.output)?.[1] ?? "[]");
const Q = "What port does the bridge use?";

test("an uncited brain answer makes exactly one proposal: facts only, no diagnosis, no cost", async (t) => {
  const e = await setup(); t.after(e.close);
  const run = await go(e, { text: `${Q} BRAINANSWER` });
  assert.equal(run.status, "done");
  assert.deepEqual(run.toolsUsed, ["mcp__superos-brain__search", "mcp__superos-brain__get_note"], "unique tool names, in the order first used");
  assert.deepEqual(run.notesOpened, ["wiki/software/api-bible.md"], "an opened note is recorded once; a path with .. is never recorded");
  const ps = proposals(e);
  assert.equal(ps.length, 1);
  const p = ps[0]!;
  assert.deepEqual([p.kind, p.status, p.skillChange, p.move, p.diagnosis.status, p.diagnosis.runId, p.diagnosis.costUsd], ["uncited", "pending", null, null, "skipped", null, null]);
  assert.equal(p.whatBroke, `Answered from the brain without naming a source note. Request: "${Q} BRAINANSWER". Notes it opened: wiki/software/api-bible.md.`);
  assert.match(p.fix, /name its note by vault path/);
  assert.match(p.learning, /cannot be checked/);
  assert.equal(p.run.id, run.id);
  assert.equal(e.b.runs.list().length, 1, "no diagnosis run was started");
  assert.equal(e.b.learning.spentToday(), 0, "and nothing was spent on one");
  // the dashboard sees it through the usual route
  const view = (await (await fetch(`${e.base}/api/proposals`, { headers: { authorization: `Bearer ${e.token}` } })).json()) as { proposals: Array<{ kind: string }> };
  assert.deepEqual(view.proposals.map((x) => x.kind), ["uncited"]);
  const runs = (await (await fetch(`${e.base}/api/runs`, { headers: { authorization: `Bearer ${e.token}` } })).json()) as { runs: Array<{ toolsUsed: string[]; notesOpened: string[] }> };
  assert.deepEqual(runs.runs[0]?.toolsUsed, ["mcp__superos-brain__search", "mcp__superos-brain__get_note"]);
});

test("a cited answer makes none: by path, and separately by [[link]]; a web address or an uncited folder does not count as a source", async (t) => {
  for (const [token, expected] of [["CITEPATH", 0], ["CITELINK", 0], ["CITEURL", 1], ["CITEOS", 1], ["", 1]] as const) {
    const e = await setup(); t.after(e.close);
    await go(e, { text: `${Q} BRAINANSWER ${token}` });
    assert.equal(proposals(e).length, expected, token || "uncited control");
  }
});

test("no proposal for: no brain use, T3, a failed run (it gets the failure proposal instead), a diagnosis run, inbox triage, NOTHING_NEW", async () => {
  const cases: Array<[string, { text: string; tier?: "T2" | "T3"; dept?: string }, InternalRunOptions, string[]]> = [
    ["control: uncited brain answer", { text: `${Q} BRAINANSWER` }, {}, ["uncited"]],
    ["T2 that did not use the brain", { text: Q }, {}, []],
    ["T3", { text: `${Q} BRAINANSWER`, tier: "T3" }, {}, []],
    ["failed run", { text: `${Q} BRAINFAIL` }, {}, ["failed"]],
    ["a diagnosis run", { text: `${Q} BRAINANSWER` }, { purpose: "diagnosis" }, []],
    ["inbox triage", { text: `${Q} BRAINANSWER`, dept: "inbox" }, {}, []],
    ["NOTHING_NEW", { text: `${Q} BRAINNOTHING` }, {}, []],
  ];
  for (const [label, req, internal, kinds] of cases) {
    const e = await setup();
    try {
      await go(e, req, internal);
      await sleep(150); // a failure's own diagnosis run is quick but separate
      assert.deepEqual(proposals(e).map((p) => p.kind), kinds, label);
    } finally { e.close(); }
  }
});

test("a finished run that also had tool calls blocked gets the 'blocked' proposal, not 'uncited' (one proposal per run)", async (t) => {
  const e = await setup(); t.after(e.close);
  const run = await go(e, { text: `${Q} BRAINDENIED` });
  await sleep(150);
  assert.deepEqual([run.status, run.denied.length > 0], ["done", true]);
  assert.equal(isUncitedAnswer(run), true, "on its own this answer would count");
  assert.deepEqual(proposals(e).map((p) => p.kind), ["blocked"]);
});

test("dedup: the same subject on the same day makes one proposal; a different skill or the next day makes another", async (t) => {
  const e = await setup({ skills: ["demo", "other"] }); t.after(e.close);
  await go(e, { text: `${Q} BRAINANSWER` });
  await go(e, { text: `Another question BRAINANSWER` });
  assert.equal(proposals(e).length, 1, "same subject (a typed question), same day");
  await go(e, { text: "BRAINANSWER", skill: "demo" });
  await go(e, { text: "BRAINANSWER again", skill: "demo" });
  assert.equal(proposals(e).length, 2, "a skill is its own subject, once a day");
  await go(e, { text: "BRAINANSWER", skill: "other" });
  assert.equal(proposals(e).length, 3);
  e.tick(1);
  await go(e, { text: `${Q} BRAINANSWER` });
  assert.equal(proposals(e).length, 4, "the next day it can be proposed again");
});

test("for a skill: the proposal carries the rule; Approve appends it exactly once; decided once; a later proposal does not add it twice", async (t) => {
  const e = await setup({ skills: ["demo"] }); t.after(e.close);
  await go(e, { text: "BRAINANSWER", skill: "demo" });
  const p = proposals(e)[0]!;
  assert.deepEqual(p.skillChange, { skill: "demo", rule: UNCITED_RULE });
  assert.equal(UNCITED_RULE, "Name the vault note (path or [[link]]) for every claim you take from the vault.");
  const skillFile = path.join(e.vault, "skills/demo/SKILL.md");
  const before = readFileSync(skillFile, "utf8");
  assert.equal((await post(e, `/api/proposals/${p.id}/approve`)).status, 200);
  const after = readFileSync(skillFile, "utf8");
  assert.equal(after, `${before}\n## Learned rules\n- ${UNCITED_RULE} (approved 2026-11-16, from proposals/${p.id}.json)\n`, "append-only: everything before is kept as it was");
  const note = readFileSync(path.join(e.vault, "wiki/_learnings", `${p.id}.md`), "utf8");
  assert.match(note, /title: "Uncited answer: demo/);
  assert.match(note, /\*\*Rule added to\*\* \[\[skills\/demo\/SKILL\]\]/);
  const again = await post(e, `/api/proposals/${p.id}/approve`);
  assert.equal(again.status, 409);
  assert.equal(readFileSync(skillFile, "utf8"), after, "a second approve changes nothing");
  assert.equal((await post(e, `/api/proposals/${p.id}/reject`)).status, 409);
  // the next day the skill is flagged again; approving that one must not repeat the rule
  e.tick(1);
  await go(e, { text: "BRAINANSWER", skill: "demo" });
  const second = proposals(e).find((x) => x.id !== p.id)!;
  const res = await post(e, `/api/proposals/${second.id}/approve`);
  assert.equal(res.status, 200);
  assert.equal(readFileSync(skillFile, "utf8").split(UNCITED_RULE).length - 1, 1, "the rule is in the skill once");
  assert.match(((await res.json()) as { proposal: Proposal }).proposal.applied?.note ?? "", /already has this rule/);
});

test("Reject changes nothing; an uncited proposal for a typed question has no skill to change", async (t) => {
  const e = await setup({ skills: ["demo"] }); t.after(e.close);
  await go(e, { text: `${Q} BRAINANSWER` });
  const p = proposals(e)[0]!;
  const skillBefore = readFileSync(path.join(e.vault, "skills/demo/SKILL.md"), "utf8");
  assert.equal((await post(e, `/api/proposals/${p.id}/reject`)).status, 200);
  assert.equal(readFileSync(path.join(e.vault, "skills/demo/SKILL.md"), "utf8"), skillBefore);
  assert.equal(existsSync(path.join(e.vault, "wiki/_learnings", `${p.id}.md`)), false);
  assert.equal(proposals(e)[0]?.status, "rejected");
});

test("config: citations default on; the switch turns it off; learning off also turns it off", async () => {
  const dflt = pathsFor(path.join(makeVault(), "os"));
  assert.equal(loadConfig(dflt).engine.learning.citations.enabled, true, "default for a config that has no learning block");
  const v = makeVault();
  const p = pathsFor(path.join(v, "os"));
  const c = loadConfig(p);
  saveConfig(p, { ...c, engine: { ...c.engine, learning: { enabled: true, diagnosisBudgetUsd: 0.05, dailyCapUsd: 0.25, citations: { enabled: true } } } });
  const raw = JSON.parse(readFileSync(p.config, "utf8"));
  delete raw.engine.learning.citations;
  writeFileSync(p.config, JSON.stringify(raw));
  assert.equal(loadConfig(p).engine.learning.citations.enabled, true, "an existing config with a learning block but no citations still parses, on");
  const variants: Array<[string, (c: ReturnType<typeof loadConfig>) => ReturnType<typeof loadConfig>, number]> = [
    ["on (control)", (x) => x, 1],
    ["citations off", (x) => ({ ...x, engine: { ...x.engine, learning: { ...x.engine.learning, citations: { enabled: false } } } }), 0],
    ["learning off", (x) => ({ ...x, engine: { ...x.engine, learning: { ...x.engine.learning, enabled: false } } }), 0],
  ];
  for (const [label, configure, expected] of variants) {
    const e = await setup({ configure });
    try { await go(e, { text: `${Q} BRAINANSWER` }); assert.equal(proposals(e).length, expected, label); } finally { e.close(); }
  }
});

test("the brain hint asks for sources, and it is in the run's command line (only when the brain is on)", async (t) => {
  assert.match(BRAIN_HINT, /Every claim you take from the vault must name its note, by vault path \(for example wiki\/software\/api-bible\.md\) or as a \[\[wikilink\]\]\./);
  const e = await setup(); t.after(e.close);
  const run = await go(e, { text: Q });
  const argv = argvOf(run);
  assert.equal(argv[argv.indexOf("--append-system-prompt") + 1]?.includes("must name its note, by vault path"), true);
  const off = await setup({ configure: (c) => ({ ...c, engine: { ...c.engine, brain: { enabled: false } } }) });
  try { assert.ok(!argvOf(await go(off, { text: Q })).join(" ").includes("must name its note")); } finally { off.close(); }
});

test("toolsUsed is capped and unique; notes it opened are plain vault paths only", async (t) => {
  const e = await setup(); t.after(e.close);
  const run = await go(e, { text: `${Q} BRAINMANY` });
  assert.equal(run.toolsUsed.length, 30);
  assert.deepEqual(run.toolsUsed.slice(0, 2), ["mcp__superos-brain__search", "mcp__superos-brain__get_note"]);
  assert.equal(new Set(run.toolsUsed).size, 30);
  assert.deepEqual(run.notesOpened, ["wiki/software/api-bible.md"]);
});

test("a failed brain run still gets only the normal failure proposal", async (t) => {
  const e = await setup(); t.after(e.close);
  await go(e, { text: `${Q} BRAINFAIL` });
  await sleep(200);
  const ps = proposals(e);
  assert.deepEqual(ps.map((p) => p.kind), ["failed"]);
  assert.ok(readdirSync(path.join(e.vault, "proposals")).filter((n) => n.endsWith(".json")).length === 1);
});
