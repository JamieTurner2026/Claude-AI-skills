// Skills widget routes: GET /api/skills and POST /api/skills/:name/run. Fake Claude CLI, so nothing costs money.
// Every "refused" check has a control beside it that must succeed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeVault } from "./fixture.ts";
import { buildPrompt, cleanInput, localDate } from "./routine-runner.ts";
import type { Routine } from "./routine-runner.ts";
import type { RunInfo } from "./runs.ts";
import { createBridge } from "./server.ts";
import type { Bridge } from "./server.ts";

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-claude.ts");
const skill = (name: string, tier: string, budget: string | null, body: string): string =>
  `---\nname: ${name}\ndescription: The ${name} skill.\n---\n# ${name}\n\nDepartment: Test. ${tier ? `Tier: **${tier}**` : ""} ${budget ? `Suggested budget: **$${budget} per run**` : ""}\n\n${body}\n`;
const SKILLS: Record<string, string> = {
  "plan-today": skill("plan-today", "T2, read-only", "0.25", "LIST_THE_DIRECTIVES"),
  "make-draft": skill("make-draft", "T3", "1.00", "DELIVER"),
  "big-budget": skill("big-budget", "T2, read-only", "5.00", "TOO_BIG"),
  mystery: skill("mystery", "", null, "NO_TIER_OR_BUDGET_LINE"),
  "fail-me": skill("fail-me", "T2, read-only", "0.25", "FAIL"),
};

type Env = { b: Bridge; vault: string; logs: string; base: string; token: string; day: string; close: () => void };
async function setup(routines: object[] = []): Promise<Env> {
  const vault = makeVault();
  const logs = mkdtempSync(path.join(tmpdir(), "skill-logs-"));
  writeFileSync(path.join(vault, "routines/routines.json"), JSON.stringify(routines));
  for (const [name, text] of Object.entries(SKILLS)) { mkdirSync(path.join(vault, "skills", name), { recursive: true }); writeFileSync(path.join(vault, "skills", name, "SKILL.md"), text); }
  const b = createBridge(path.join(vault, "os"), { claudeBin: { cmd: process.execPath, prefixArgs: [fake] }, logDir: logs });
  await new Promise<void>((r) => b.server.listen(0, "127.0.0.1", r));
  return { b, vault, logs, base: `http://127.0.0.1:${(b.server.address() as AddressInfo).port}`, token: b.mint(), day: localDate(new Date(), "America/New_York"), close: () => { b.runs.stopAll(); b.server.close(); } };
}

const hdr = (e: Env, extra: Record<string, string> = {}) => ({ "content-type": "application/json", "x-superos": "1", authorization: `Bearer ${e.token}`, ...extra });
const run = (e: Env, name: string, body: unknown = {}, headers: Record<string, string> = {}) => fetch(`${e.base}/api/skills/${name}/run`, { method: "POST", headers: hdr(e, headers), body: JSON.stringify(body) });
const getJson = async <T>(e: Env, p: string): Promise<T> => (await (await fetch(e.base + p, { headers: { authorization: `Bearer ${e.token}` } })).json()) as T;
const ledger = (e: Env) => JSON.parse(readFileSync(path.join(e.logs, "routine-ledger.json"), "utf8")) as { lastRunAt: Record<string, string>; spend: Record<string, number>; lastResult: Record<string, { status: string; note: string }> };
const noLedger = (e: Env) => !existsSync(path.join(e.logs, "routine-ledger.json"));
const noRuns = (e: Env) => assert.equal(e.b.runs.list().length, 0, "nothing was started");

function ended(e: Env, id: string): Promise<void> {
  if (e.b.runs.list().find((r) => r.id === id)?.status !== "running") return Promise.resolve();
  return new Promise((resolve) => { e.b.runs.subscribe(id, (ev) => { if (ev.type === "status" && ev.status !== "running") resolve(); }); });
}
const argvOf = (e: Env, id: string): string[] => JSON.parse(/ARGV:(.*)/.exec(e.b.runs.list().find((r) => r.id === id)!.output)?.[1] ?? "[]");
const flag = (argv: string[], f: string): string | undefined => argv[argv.indexOf(f) + 1];

test("the list needs a session and shows each skill's tier and budget; unknown lines show as unknown", async (t) => {
  const e = await setup(); t.after(e.close);
  assert.equal((await fetch(`${e.base}/api/skills`)).status, 401);
  assert.equal((await fetch(`${e.base}/api/skills`, { headers: { authorization: "Bearer nope" } })).status, 401);
  const v = await getJson<{ skills: Array<{ name: string; tier: string; tierKnown: boolean; budgetUsd: number; budgetKnown: boolean; description: string }>; dailyCapUsd: number; maxBudgetUsd: number; spentTodayUsd: number }>(e, "/api/skills");
  assert.deepEqual(v.skills.map((s) => s.name), ["big-budget", "fail-me", "make-draft", "mystery", "plan-today"]);
  const by = Object.fromEntries(v.skills.map((s) => [s.name, s]));
  assert.deepEqual([by["plan-today"]?.tier, by["plan-today"]?.budgetUsd, by["plan-today"]?.tierKnown], ["T2", 0.25, true]);
  assert.deepEqual([by["make-draft"]?.tier, by["make-draft"]?.budgetUsd], ["T3", 1]);
  assert.deepEqual([by["mystery"]?.tier, by["mystery"]?.budgetUsd, by["mystery"]?.tierKnown, by["mystery"]?.budgetKnown], ["T2", 0.05, false, false]);
  assert.equal(by["plan-today"]?.description, "The plan-today skill.");
  assert.deepEqual([v.dailyCapUsd, v.maxBudgetUsd, v.spentTodayUsd], [1, 1, 0]);
});

test("a T2 skill runs with its own budget, read-only tools, its text and Jay's input; the bridge writes the report", async (t) => {
  const e = await setup(); t.after(e.close);
  const res = await run(e, "plan-today", { input: "focus on Friday" });
  assert.equal(res.status, 202);
  const { run: info } = (await res.json()) as { run: RunInfo };
  assert.deepEqual([info.tier, info.skill, info.routine, info.capUsd], ["T2", "plan-today", null, 0.25]);
  await ended(e, info.id);
  assert.equal(e.b.runs.list().find((r) => r.id === info.id)?.status, "done");
  const argv = argvOf(e, info.id);
  assert.equal(flag(argv, "--max-budget-usd"), "0.25", "the skill's own budget, not the $0.05 interactive cap");
  assert.equal(flag(argv, "--tools"), "Read,Glob,Grep", "T2 stays read-only");
  const prompt = flag(argv, "-p") ?? "";
  assert.match(prompt, /You are running the skill "plan-today"/);
  assert.match(prompt, /LIST_THE_DIRECTIVES/);
  assert.match(prompt, /<<<INPUT\n\nfocus on Friday\n\nINPUT>>>/);
  const reports = readdirSync(path.join(e.vault, "reports"));
  assert.deepEqual(reports, [`${e.day}_plan-today.md`]);
  assert.match(readFileSync(path.join(e.vault, "reports", reports[0]!), "utf8"), /Written by the plan-today skill/);
  assert.equal(ledger(e).spend[e.day], 0.0123, "the reserved budget was swapped for the real cost");
  // and it shows up in the Runs widget's data
  const list = await getJson<{ runs: Array<{ id: string; skill: string | null; status: string }> }>(e, "/api/runs");
  assert.deepEqual(list.runs.map((r) => [r.id, r.skill, r.status]), [[info.id, "plan-today", "done"]]);
  assert.equal((await getJson<{ skills: Array<{ name: string; lastResult: { status: string } | null }> }>(e, "/api/skills")).skills.find((s) => s.name === "plan-today")?.lastResult?.status, "done");
});

test("a skill with no readable tier or budget line runs as T2 with $0.05", async (t) => {
  const e = await setup(); t.after(e.close);
  const { run: info } = (await (await run(e, "mystery")).json()) as { run: RunInfo };
  assert.deepEqual([info.tier, info.capUsd], ["T2", 0.05]);
  await ended(e, info.id);
  assert.equal(flag(argvOf(e, info.id), "--max-budget-usd"), "0.05");
});

test("a T3 skill without confirm asks first and starts nothing; with confirm it runs, with default tools and no Bash", async (t) => {
  const e = await setup(); t.after(e.close);
  for (const body of [{}, { confirm: false }]) {
    const ask = await run(e, "make-draft", body);
    assert.equal(ask.status, 409);
    const data = (await ask.json()) as { needsConfirm: boolean; capUsd: number; error: string };
    assert.deepEqual([data.needsConfirm, data.capUsd], [true, 1]);
    assert.match(data.error, /Run this\? .*up to \$1/);
  }
  assert.equal((await run(e, "make-draft", { confirm: "yes" })).status, 400, "only a real true counts");
  noRuns(e);
  assert.ok(noLedger(e), "an unconfirmed ask reserves no money");
  // control: with confirm the same call starts
  const ok = await run(e, "make-draft", { confirm: true });
  assert.equal(ok.status, 202);
  const { run: info } = (await ok.json()) as { run: RunInfo };
  assert.deepEqual([info.tier, info.capUsd, info.skill, info.routine], ["T3", 1, "make-draft", null]);
  await ended(e, info.id);
  assert.equal(e.b.runs.list().find((r) => r.id === info.id)?.status, "done");
  const tools = flag(argvOf(e, info.id), "--tools") ?? "";
  assert.ok(tools.includes("Write") && !tools.includes("Bash"), tools);
});

test("a budget above the per-run limit is refused before anything is reserved or started", async (t) => {
  const e = await setup(); t.after(e.close);
  const res = await run(e, "big-budget");
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /above the limit of \$1/);
  noRuns(e);
  assert.ok(noLedger(e));
  assert.equal((await run(e, "plan-today")).status, 202, "control: a skill within the limit runs");
});

test("skill runs share the daily routine cap with routines and add to the same spend", async (t) => {
  const e = await setup(); t.after(e.close);
  mkdirSync(e.logs, { recursive: true });
  writeFileSync(path.join(e.logs, "routine-ledger.json"), JSON.stringify({ lastRunAt: {}, lastResult: {}, spend: { [e.day]: 0.9 } }));
  const over = await run(e, "plan-today"); // 0.9 + 0.25 > 1
  assert.equal(over.status, 429);
  assert.match(((await over.json()) as { error: string }).error, /Daily cap reached/);
  noRuns(e);
  // A T3 skill that cannot fit is refused before Jay is asked to confirm (a $1.00 skill under a $1 cap needs a day with no spend).
  writeFileSync(path.join(e.logs, "routine-ledger.json"), JSON.stringify({ lastRunAt: {}, lastResult: {}, spend: { [e.day]: 0.01 } }));
  const t3 = await run(e, "make-draft", {});
  assert.equal(t3.status, 429, "not 409: it would be wrong to ask for a confirmation that cannot succeed");
  assert.equal((await run(e, "make-draft", { confirm: true })).status, 429);
  noRuns(e);
  writeFileSync(path.join(e.logs, "routine-ledger.json"), JSON.stringify({ lastRunAt: {}, lastResult: {}, spend: { [e.day]: 0.5 } }));
  const { run: info } = (await (await run(e, "plan-today")).json()) as { run: RunInfo }; // control: 0.5 + 0.25 fits
  assert.ok(info.id);
  assert.ok(Math.abs(e.b.routines.status().spentTodayUsd - 0.75) < 1e-9, "the reservation shows in the routines' spend too");
  await ended(e, info.id);
  assert.ok(Math.abs(ledger(e).spend[e.day]! - (0.5 + 0.0123)) < 1e-9);
});

test("bad, odd and unknown names are refused; a good one works", async (t) => {
  const e = await setup(); t.after(e.close);
  for (const name of ["Bad_Name", "..%2Fetc", "%2e%2e", "a".repeat(41), "has%20space", "-lead", "UPPER", "a".repeat(120)]) {
    const res = await run(e, name);
    assert.ok(res.status >= 400 && res.status < 500, `${name} -> ${res.status}`);
  }
  assert.equal((await run(e, "no-such-skill")).status, 404);
  noRuns(e);
  assert.ok(noLedger(e));
  assert.equal((await run(e, "plan-today")).status, 202);
});

test("same session, origin and header checks as every other write; bad bodies are refused", async (t) => {
  const e = await setup(); t.after(e.close);
  const bare = (headers: Record<string, string>) => fetch(`${e.base}/api/skills/plan-today/run`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });
  assert.equal((await bare({ "x-superos": "1" })).status, 401, "no session");
  assert.equal((await bare({ authorization: "Bearer nope", "x-superos": "1" })).status, 401, "bad session");
  assert.equal((await bare({ authorization: `Bearer ${e.token}` })).status, 403, "no x-superos header");
  assert.equal((await run(e, "plan-today", {}, { origin: "http://evil.example" })).status, 403, "wrong origin");
  assert.equal((await fetch(`${e.base}/api/skills/plan-today/run`, { method: "POST", headers: { authorization: `Bearer ${e.token}`, "x-superos": "1", "content-type": "text/plain" }, body: "{}" })).status, 415);
  assert.equal((await run(e, "plan-today", { input: "x".repeat(501) })).status, 400, "input too long");
  assert.equal((await run(e, "plan-today", { text: "extra field" })).status, 400, "unknown field");
  assert.equal((await run(e, "plan-today", { input: 5 })).status, 400);
  noRuns(e);
  assert.ok(noLedger(e));
  assert.equal((await run(e, "plan-today", {}, { origin: e.base })).status, 202, "control: everything right works");
});

test("a skill run never marks a scheduled routine of the same name as done", async (t) => {
  const routine = { id: "plan-today", name: "Plan today", schedule: "weekdays 07:00", enabled: true, skill: "plan-today", tier: "T2", budgetUsd: 0.25 };
  const e = await setup([routine]); t.after(e.close);
  const { run: info } = (await (await run(e, "plan-today")).json()) as { run: RunInfo };
  await ended(e, info.id);
  const l = ledger(e);
  assert.equal(l.lastRunAt["plan-today"], undefined, "the routine's slot is untouched");
  assert.ok(l.lastRunAt["skill:plan-today"]);
  // control: the routine's own Run now does mark it
  const second = e.b.routines.runNow("plan-today");
  await ended(e, second.id);
  assert.ok(ledger(e).lastRunAt["plan-today"]);
});

test("a failed skill run gets a learning proposal that names the skill, not a routine", async (t) => {
  const e = await setup(); t.after(e.close);
  const { run: info } = (await (await run(e, "fail-me")).json()) as { run: RunInfo };
  await ended(e, info.id);
  let found;
  for (let i = 0; i < 40 && !found; i++) { found = e.b.learning.list().find((p) => p.run.id === info.id); if (!found) await new Promise((r) => setTimeout(r, 50)); }
  assert.ok(found, "a proposal was drafted");
  assert.deepEqual([found.run.skill, found.run.routine, found.kind], ["fail-me", null, "budget"]);
});

test("prompt and input: Jay's input is one plain line and cannot close its fence; routine prompts are unchanged", () => {
  assert.equal(cleanInput("  hello \n\t world  "), "hello world");
  assert.equal(cleanInput("a <<<SKILL b >>> c\u0000d e"), "a SKILL b c d e");
  assert.equal(cleanInput("   "), undefined);
  assert.equal(cleanInput(undefined), undefined);
  assert.equal(cleanInput("x".repeat(900))?.length, 500);
  const skillRun: Routine = { id: "skill:demo", name: "demo", schedule: "", enabled: true, skill: "demo", tier: "T2", budgetUsd: 0.25 };
  const p = buildPrompt(skillRun, "STEPS", "2026-11-16", "America/New_York", { input: "do X" });
  assert.match(p, /^You are running the skill "demo" for Jay's JDOLLA\$ vault, started by Jay from the dashboard\. Today is 2026-11-16/);
  assert.match(p, /<<<INPUT\n\ndo X\n\nINPUT>>>/);
  assert.equal(p.match(/INPUT>>>/g)?.length, 1);
  assert.ok(!buildPrompt(skillRun, "STEPS", "2026-11-16", "America/New_York").includes("<<<INPUT"), "no input, no input block");
  const routine: Routine = { ...skillRun, id: "plan-today", name: "Plan today" };
  assert.match(buildPrompt(routine, "STEPS", "2026-11-16", "America/New_York"), /^You are running the scheduled routine "Plan today" for Jay's JDOLLA\$ vault\. Today is 2026-11-16/);
});
