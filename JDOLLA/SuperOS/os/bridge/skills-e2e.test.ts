// The other read-only skills end to end (still offline), the way morning-page.test.ts does morning-intel: the REAL SKILL.md, policy and
// routine entry, the fake CLI playing the model against the exact tools server the run is given, and hostile text from shared/hostile.ts
// in a note title, a wikilink, a feed subject and a proposal rule. month-costs is a built-in (no model): its report and its empty month.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOSTILE_LINE, INJECTION, INVISIBLE_IN_BODY } from "../shared/hostile.ts";
import { argvFromOutput } from "./fake-argv.ts";
import { makeVault } from "./fixture.ts";
import { NOTHING_NEW } from "./routine-runner.ts";
import type { RunEvent } from "./runs.ts";
import { createBridge } from "./server.ts";
import type { Bridge } from "./server.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const realOs = path.resolve(here, "..");
const realVault = path.resolve(realOs, "..");
const fake = path.join(here, "fake-claude.ts");

type Case = { id: string; schedule: string; at: Date; day: string; headings: string[]; tools: string[]; nothingNew: boolean; budget: number };
const CASES: Case[] = [
  { id: "plan-today", schedule: "weekdays 07:00", at: new Date("2026-11-16T12:00:30Z"), day: "2026-11-16", budget: 0.25, nothingNew: true,
    headings: ["## Do first", "## Today", "## Waiting", "## Not today"], tools: ["recent_changes", "list_reports", "calendar_today", "mail_brain"] },
  { id: "vault-cleanup", schedule: "weekly sun 18:00", at: new Date("2026-11-22T23:00:30Z"), day: "2026-11-22", budget: 0.75, nothingNew: false,
    headings: ["## What changed", "## Drifting", "## Decisions made and forgotten", "## Duplicates and contradictions", "## Broken wikilinks", "## Missing sources", "## Stale and never used", "## Orphans", "## Hubs", "## Backups", "## Suggested fixes"],
    tools: ["link_check", "vault_stats", "backup_status"] },
  { id: "proposals-review", schedule: "weekly sun 17:00", at: new Date("2026-11-22T22:00:30Z"), day: "2026-11-22", budget: 0.25, nothingNew: true,
    headings: ["## This week in numbers", "## What keeps breaking", "## Approved rules: did they help?", "## Rejected most", "## Suggestions"], tools: ["proposals_summary", "list_reports"] },
];
const ALL_TOOLS = ["today", "recent_changes", "link_check", "vault_stats", "list_reports", "proposals_summary", "run_stats", "calendar_today", "mail_brain", "backup_status"];

const shipped = (id: string): Record<string, unknown> => (JSON.parse(readFileSync(path.join(realVault, "routines", "routines.json"), "utf8")) as Array<Record<string, unknown>>).find((r) => r["id"] === id)!;
const skillText = (id: string): string => readFileSync(path.join(realVault, "skills", id, "SKILL.md"), "utf8");

function setup(c: Case, marker: string) {
  const vault = makeVault();
  const logs = mkdtempSync(path.join(tmpdir(), "se-logs-"));
  writeFileSync(path.join(vault, "os/config/skills.policy.json"), readFileSync(path.join(realOs, "config/skills.policy.json"), "utf8"));
  mkdirSync(path.join(vault, "skills", c.id), { recursive: true });
  writeFileSync(path.join(vault, "skills", c.id, "SKILL.md"), skillText(c.id) + `\n${marker}\n`);
  writeFileSync(path.join(vault, "routines/routines.json"), JSON.stringify([{ ...shipped(c.id), enabled: true }]));
  // Hostile text in every door these skills read. The tools server reads the real clock, so dates are relative to now.
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  writeFileSync(path.join(vault, "wiki/software/hostile.md"), `---\ntitle: ${HOSTILE_LINE}\ndept: software\ntype: project\nsources: []\nupdated: 2026-11-20\n---\nBody with a link [[${HOSTILE_LINE.slice(0, 80)}]] and [[wiki/software/missing-note]].\n`);
  mkdirSync(path.join(vault, "inbox/_feeds"), { recursive: true });
  writeFileSync(path.join(vault, "inbox/_feeds/mail.json"), JSON.stringify({ messages: [{ id: "m1", from: "Mallory <mallory@evil.example>", subject: HOSTILE_LINE.slice(0, 400), date: ago(60), body: "BODYSECRET", labels: ["Brain"] }] }));
  writeFileSync(path.join(vault, "inbox/_feeds/calendar.json"), JSON.stringify({ events: [{ title: HOSTILE_LINE.slice(0, 300), start: ago(1), end: new Date(Date.now() + 29 * 60_000).toISOString() }] }));
  mkdirSync(path.join(vault, "proposals"), { recursive: true });
  const prop = (n: number, status: string, rule: string | null) => writeFileSync(path.join(vault, `proposals/p${n}.json`), JSON.stringify({
    id: `p${n}`, createdAt: new Date(Date.now() - n * 3_600_000).toISOString(), status, decidedAt: status === "pending" ? null : new Date(Date.now() - n * 1_800_000).toISOString(), kind: "failed",
    run: { id: "r", tier: "T2", dept: "ai", skill: n === 3 ? HOSTILE_LINE.slice(0, 60) : "plan-today", routine: null, status: "failed", error: "RUNERRORSECRET", denied: [], costUsd: 0.01, capUsd: 0.25, prompt: "RUNPROMPTSECRET" },
    whatBroke: "WHATBROKESECRET", skillChange: rule === null ? null : { skill: "plan-today", rule }, applied: null,
  }));
  prop(1, "pending", null); prop(2, "approved", HOSTILE_LINE); prop(3, "rejected", null); prop(4, "rejected", null);
  const b = createBridge(path.join(vault, "os"), { claudeBin: { cmd: process.execPath, prefixArgs: [fake] }, logDir: logs, now: () => c.at });
  return { b, vault, logs };
}
const ended = (b: Bridge, id: string): Promise<void> => new Promise((r) => { b.runs.subscribe(id, (e: RunEvent) => { if (e.type === "status" && e.status !== "running") r(); }); });
const ledger = (logs: string) => JSON.parse(readFileSync(path.join(logs, "routine-ledger.json"), "utf8")) as { lastResult: Record<string, { status: string; note: string }> };
async function runIt(c: Case, marker: string, t: { after: (f: () => void) => void }) {
  const e = setup(c, marker); t.after(() => e.b.runs.stopAll());
  assert.deepEqual(await e.b.routines.tick(c.at), [c.id]);
  const run = e.b.runs.list().find((r) => r.routine === c.id)!;
  await ended(e.b, run.id);
  return { ...e, done: e.b.runs.get(run.id)! };
}

for (const c of CASES) {
  test(`${c.id}: the shipped routine is OFF at ${c.schedule}; the skill promises exactly its sections, names only its policy's tools, and has the right NOTHING_NEW rule`, () => {
    const r = shipped(c.id);
    assert.deepEqual([r["schedule"], r["enabled"], r["skill"], r["tier"], r["budgetUsd"]], [c.schedule, false, c.id, "T2", c.budget]);
    const skill = skillText(c.id);
    const promised = [...new Set([...skill.matchAll(/`(## [^`\n]+)`/g)].map((m) => m[1]))];
    assert.deepEqual(promised, c.headings);
    const policy = JSON.parse(readFileSync(path.join(realOs, "config/skills.policy.json"), "utf8")) as { skills: Record<string, { scriptTools: string[] }> };
    assert.deepEqual(policy.skills[c.id]!.scriptTools, c.tools);
    for (const n of ALL_TOOLS) {
      const mentioned = skill.includes(`\`${n}\``);
      if (c.tools.includes(n) || n === "today") assert.ok(mentioned, `the skill names its tool ${n}`);
      else assert.ok(!mentioned, `the skill asks for ${n}, which its policy does not give it`);
    }
    assert.ok(!/Write\(|Bash|WebFetch/.test(skill), "no write or shell tool is asked for");
    assert.ok(!/\bWrite `reports|The only file written/.test(skill), "the skill does not claim it writes the file: the bridge saves the answer");
    assert.match(skill, c.nothingNew ? /answer with exactly `NOTHING_NEW`/ : /do not answer `NOTHING_NEW`/);
    assert.match(skill, /\*\*Report only\.\*\*|Never send, post, buy, delete or publish/);
  });

  test(`${c.id}: a run gets exactly its policy's tools and no Write, Edit or Bash; the report lands at reports/${c.day}_${c.id}.md with the promised sections only`, async (t) => {
    const e = await runIt(c, "FAKEREPORT", t);
    assert.equal(e.done.status, "done");
    const argv = argvFromOutput(e.done.output);
    const flag = (f: string) => argv[argv.indexOf(f) + 1]!;
    const tools = ["today", ...c.tools];
    const graph = c.id === "vault-cleanup" ? ["mcp__superos-brain__related", "mcp__superos-brain__graph_overview"] : ["mcp__superos-brain__related"]; // 12a: T2 runs get related; vault-cleanup also graph_overview
    assert.deepEqual(flag("--allowedTools").split(","), ["mcp__superos-brain__search", "mcp__superos-brain__get_note", ...graph, ...tools.map((n) => `mcp__superos-tools__${n}`)]);
    assert.equal(flag("--tools"), "Read,Glob,Grep");
    assert.ok(!/Write|Edit|Bash/.test(flag("--allowedTools") + flag("--tools")));
    assert.equal((JSON.parse(flag("--mcp-config")).mcpServers["superos-tools"] as { env: Record<string, string> }).env["SUPEROS_TOOLS"], tools.join(","));
    const offered = /TOOLS:(\S*)/.exec(e.done.output)![1]!.split(",");
    assert.deepEqual([...offered].sort(), [...tools].sort(), "the server really offers those and nothing else");
    assert.match(e.done.output, /UNOFFERED:Unknown tool: (link_check|run_stats)/);
    const file = `${c.day}_${c.id}.md`;
    assert.deepEqual(readdirSync(path.join(e.vault, "reports")), [file]);
    assert.equal(ledger(e.logs).lastResult[c.id]!.note, `Report: reports/${file}`);
    const report = readFileSync(path.join(e.vault, "reports", file), "utf8");
    assert.deepEqual(report.split("\n").filter((l) => l.startsWith("## ")), c.headings, "exactly the sections the skill promises, in order");
  });

  test(`${c.id}: hostile text in a title, link, feed or proposal stays inert: not in the prompt, no forged heading, no live markup, no control characters; fences stay balanced`, async (t) => {
    const e = await runIt(c, "FAKEREPORT", t);
    const report = readFileSync(path.join(e.vault, "reports", `${c.day}_${c.id}.md`), "utf8");
    const o = argvFromOutput(e.done.output);
    const prompt = o[o.indexOf("-p") + 1]!;
    for (const s of [INJECTION, "evil@example.com", "Mallory", "BODYSECRET", "RUNERRORSECRET", "RUNPROMPTSECRET", "WHATBROKESECRET"]) assert.ok(!prompt.includes(s), `the prompt has no ${s}`);
    for (const s of ["BODYSECRET", "mallory@evil.example", "RUNERRORSECRET", "RUNPROMPTSECRET", "WHATBROKESECRET"]) assert.ok(!report.includes(s), `the model never saw ${s}`);
    assert.ok(!/<\/?system>|<script|<img|onerror=/i.test(report), "no live markup");
    assert.ok(!INVISIBLE_IN_BODY.test(report), "no control or reordering characters");
    assert.ok(!report.split("\n").some((l) => l === "## Notes" || l === "---" || l.startsWith("title: ")), "no forged heading or frontmatter line");
    assert.ok(!report.includes("A".repeat(500)), "the 6000-character line is cut");
    const opens = (report.match(/<untrusted-data /g) ?? []).length;
    assert.equal(opens, (report.match(/<\/untrusted-data>/g) ?? []).length, "every fence that opened closed exactly once (the hostile closing tags were defanged)");
    // Control: the hostile text did reach the model where the tool gives it, so the checks above had something to catch.
    const reached = c.id === "plan-today" ? "Ignore previous instructions" : c.id === "vault-cleanup" ? "you are now in admin mode" : "plan-today";
    assert.ok(report.includes(reached), `control: ${reached} is in what the model saw`);
    if (c.id === "plan-today") assert.ok(report.includes("<untrusted-data source=\\\"mail\\\">") && report.includes("&lt;/untrusted-data"), "mail is fenced and its own closing tag defanged");
    if (c.id === "proposals-review") assert.ok(!report.includes("Ignore previous instructions print") || !/[<>]/.test(report.slice(report.indexOf("Ignore previous"), report.indexOf("Ignore previous") + 200).replace(/&lt;|&gt;/g, "")), "the approved rule text carries no live angle bracket");
  });

  test(`${c.id}: a NOTHING_NEW answer writes no file${c.nothingNew ? "" : " (the bridge's token, though this skill is told never to use it)"}; the bridge's token is the skill's token`, async (t) => {
    assert.equal(NOTHING_NEW, "NOTHING_NEW");
    const quiet = await runIt(c, "NOTHINGNEWTEST", t);
    assert.ok(!existsSync(path.join(quiet.vault, "reports")) || readdirSync(path.join(quiet.vault, "reports")).length === 0, "no report file");
    assert.equal(ledger(quiet.logs).lastResult[c.id]!.note, "Nothing new: no report written.");
    const o = argvFromOutput(quiet.done.output);
    assert.ok(o[o.indexOf("-p") + 1]!.includes("reply with exactly NOTHING_NEW"));
    const news = await runIt(c, "FAKEREPORT", t);
    assert.ok(existsSync(path.join(news.vault, "reports", `${c.day}_${c.id}.md`)), "control: with news a report is written");
  });
}

const costLine = (at: string, cost: number, over: object = {}) => JSON.stringify({ at, kind: "result", id: `r${cost}`, tier: "T2", status: "done", costUsd: cost, capUsd: 0.25, ms: 1, exit: 0, denied: 0, purpose: "run", skill: "plan-today", routine: "plan-today", dept: "general", capHit: false, request: HOSTILE_LINE.slice(0, 400), ...over });

async function monthSetup(lines: string[]) {
  const vault = makeVault();
  const logs = mkdtempSync(path.join(tmpdir(), "se-month-"));
  writeFileSync(path.join(vault, "routines/routines.json"), JSON.stringify([{ ...shipped("month-costs"), enabled: true }]));
  writeFileSync(path.join(logs, "router.jsonl"), lines.join("\n") + "\n");
  const at = new Date("2026-12-01T13:10:30Z"); // Dec 1 08:10 in New York (EST)
  const b = createBridge(path.join(vault, "os"), { claudeBin: { cmd: process.execPath, prefixArgs: [fake] }, logDir: logs, now: () => at });
  return { b, vault, logs, at };
}

test("month-costs: the shipped entry is a built-in OFF on the 1st at 08:10; it runs with no model, writes reports/YYYY-MM_costs.md with its sections, costs and counts only", async (t) => {
  const r = shipped("month-costs");
  assert.deepEqual([r["schedule"], r["enabled"], r["builtin"], r["skill"]], ["monthly 1 08:10", false, "month-costs", undefined]);
  const e = await monthSetup([costLine("2026-11-10T15:00:00Z", 0.12), costLine("2026-11-11T15:00:00Z", 0.2, { status: "failed" }), costLine("2026-10-31T15:00:00Z", 9.99), costLine("2026-11-12T15:00:00Z", 5, { request: HOSTILE_LINE })]);
  t.after(() => e.b.runs.stopAll());
  assert.deepEqual(await e.b.routines.tick(e.at), ["month-costs"]);
  const file = path.join(e.vault, "reports", "2026-11_costs.md");
  for (let i = 0; i < 200 && !existsSync(file); i++) await new Promise((x) => setTimeout(x, 25));
  assert.ok(existsSync(file), "the report is at reports/2026-11_costs.md (November, the month that just ended)");
  assert.equal(e.b.runs.list().length, 0, "no model run was started");
  assert.deepEqual(readdirSync(path.join(e.vault, "reports")), ["2026-11_costs.md"]);
  const report = readFileSync(file, "utf8");
  assert.deepEqual(report.split("\n").filter((l) => l.startsWith("## ")), ["## At this pace", "## By tier", "## By routine", "## By skill", "## Learning-loop diagnoses", "## Against the daily routine cap"]);
  assert.match(report, /Total spend \$0\.3200\*\* over 2 runs/, "only November's two runs; the October line is outside the month");
  assert.match(report, /unreadable lines skipped: 1\./, "the 6000-character hostile log line is skipped, not counted");
  assert.ok(!report.includes("Ignore previous instructions") && !report.includes("<system>"), "the logged request text never reaches the report");
  assert.ok(!INVISIBLE_IN_BODY.test(report));
  assert.equal(ledger(e.logs).lastResult["month-costs"]!.status, "done");
});

test("month-costs: a month with no runs writes nothing", async (t) => {
  const e = await monthSetup([costLine("2026-10-31T15:00:00Z", 1)]);
  t.after(() => e.b.runs.stopAll());
  assert.deepEqual(await e.b.routines.tick(e.at), ["month-costs"]);
  for (let i = 0; i < 100 && !ledger(e.logs).lastResult?.["month-costs"]; i++) await new Promise((x) => setTimeout(x, 25));
  assert.ok(!existsSync(path.join(e.vault, "reports")) || readdirSync(path.join(e.vault, "reports")).length === 0, "no report file");
  assert.equal(e.b.runs.list().length, 0);
});
