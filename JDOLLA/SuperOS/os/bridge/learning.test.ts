// Learning loop tests (fake CLI, so nothing costs money). Every "nothing happens" check sits next to
// a control that must produce something.
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeVault } from "./fixture.ts";
import { appendRule, failureKind, oneLine, parseDiagnosis } from "./learning.ts";
import type { Proposal } from "./learning.ts";
import { loadConfig, pathsFor, saveConfig } from "./config.ts";
import type { RunEvent, RunInfo } from "./runs.ts";
import { createBridge } from "./server.ts";
import type { Bridge } from "./server.ts";

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-claude.ts");
const SKILL = "# Demo skill\n\nSteps:\n1. Read the notes.\n2. Answer.\n";

function setup(opts: { learning?: Partial<{ enabled: boolean; diagnosisBudgetUsd: number; dailyCapUsd: number }> } = {}): { b: Bridge; vault: string; logs: string } {
  const vault = makeVault();
  const logs = mkdtempSync(path.join(tmpdir(), "learn-logs-"));
  mkdirSync(path.join(vault, "skills", "demo"), { recursive: true });
  writeFileSync(path.join(vault, "skills", "demo", "SKILL.md"), SKILL);
  if (opts.learning) {
    const p = pathsFor(path.join(vault, "os"));
    const c = loadConfig(p);
    saveConfig(p, { ...c, engine: { ...c.engine, learning: { ...c.engine.learning, ...opts.learning } } });
  }
  const b = createBridge(path.join(vault, "os"), { claudeBin: { cmd: process.execPath, prefixArgs: [fake] }, logDir: logs });
  return { b, vault, logs };
}

function ended(b: Bridge, id: string): Promise<void> {
  return new Promise((r) => { b.runs.subscribe(id, (e: RunEvent) => { if (e.type === "status") r(); }); });
}
/** Starts a run, waits for it, then waits for its proposal's diagnosis (if any) to settle. */
async function runAndSettle(b: Bridge, req: { text: string; tier?: "T2" | "T3"; skill?: string }): Promise<Proposal[]> {
  const info = b.runs.start({ tier: "T2", ...req });
  await ended(b, info.id);
  for (let i = 0; i < 200; i++) {
    if (!b.learning.list().some((p) => p.diagnosis.status === "running")) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  return b.learning.list();
}
const ledger = (logs: string) => JSON.parse(readFileSync(path.join(logs, "learning-ledger.json"), "utf8")) as { spend: Record<string, number>; seen: Record<string, string> };
const info = (over: Partial<RunInfo>): RunInfo => ({ id: "x", tier: "T2", text: "t", dept: "general", status: "done", startedAt: "", endedAt: "", capUsd: 0.05, costUsd: 0.01, output: "", error: null, deliverables: [], denied: [], result: "", routine: null, skill: null, purpose: "run", ...over });

test("failureKind: failed, cap, blocked make proposals; done, stopped and diagnosis runs don't", () => {
  assert.equal(failureKind(info({ status: "failed", error: "Stopped at the budget cap of $0.05." })), "budget");
  assert.equal(failureKind(info({ status: "failed", error: "The tool crashed." })), "failed");
  assert.equal(failureKind(info({ status: "done", denied: ["Read: denied"] })), "blocked");
  assert.equal(failureKind(info({ status: "done" })), null, "control: a clean run");
  assert.equal(failureKind(info({ status: "stopped", error: "x" })), null, "Jay pressed Stop");
  assert.equal(failureKind(info({ status: "failed", purpose: "diagnosis" })), null, "a diagnosis never triggers another");
});

test("a run that hits its cap gets one proposal with a drafted fix, lesson and skill rule", async (t) => {
  const { b, logs } = setup();
  t.after(() => b.runs.stopAll());
  const list = await runAndSettle(b, { text: "FAIL please", skill: "demo" });
  assert.equal(list.length, 1);
  const p = list[0]!;
  assert.equal(p.kind, "budget");
  assert.equal(p.status, "pending");
  assert.match(p.whatBroke, /A demo run stopped at its \$0.05 budget cap/);
  assert.equal(p.diagnosis.status, "done");
  assert.equal(p.diagnosis.costUsd, 0.05);
  assert.match(p.fix, /bigger budget/);
  assert.deepEqual(p.skillChange, { skill: "demo", rule: "Read at most five notes before answering." });
  assert.ok(existsSync(path.join(path.dirname(path.dirname(logs)), "")), "sanity");
  const diag = b.runs.list().find((r) => r.purpose === "diagnosis")!;
  assert.equal(diag.tier, "T2", "the diagnosis is read-only");
  assert.equal(diag.capUsd, 0.05);
  assert.equal(b.learning.list().length, 1, "the diagnosis itself made no proposal");
});

test("blocked tools and other failures make proposals too; clean and stopped runs don't", async (t) => {
  const { b } = setup();
  t.after(() => b.runs.stopAll());
  assert.equal((await runAndSettle(b, { text: "plain question" })).length, 0, "clean run: none");
  const hang = b.runs.start({ text: "HANG", tier: "T2" });
  b.runs.stop(hang.id);
  await ended(b, hang.id);
  assert.equal(b.learning.list().length, 0, "stopped run: none");
  const blocked = await runAndSettle(b, { text: "TRYENV" });
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0]!.kind, "blocked");
  assert.match(blocked[0]!.whatBroke, /1 tool call was blocked/);
  const crashed = await runAndSettle(b, { text: "CRASH now" });
  assert.equal(crashed.length, 2);
  assert.ok(crashed.some((p) => p.kind === "failed" && /The tool crashed/.test(p.whatBroke)));
  assert.equal(crashed.find((p) => p.kind === "blocked")!.skillChange, null, "no skill, so no skill change");
});

test("the same failure on the same day makes one proposal (a new kind makes another)", async (t) => {
  const { b, logs } = setup();
  t.after(() => b.runs.stopAll());
  await runAndSettle(b, { text: "FAIL one", skill: "demo" });
  await runAndSettle(b, { text: "FAIL two", skill: "demo" });
  assert.equal(b.learning.list().length, 1, "duplicate skipped");
  assert.equal(Object.keys(ledger(logs).spend).length, 1);
  assert.equal(Object.values(ledger(logs).spend)[0], 0.05, "only one diagnosis was paid for");
  await runAndSettle(b, { text: "CRASH three", skill: "demo" });
  assert.equal(b.learning.list().length, 2, "control: a different failure counts");
});

test("a diagnosis that answers junk or fails leaves the facts, marked, and never loops", async (t) => {
  const { b } = setup();
  t.after(() => b.runs.stopAll());
  const junk = await runAndSettle(b, { text: "FAIL BADDIAG", skill: "demo" });
  assert.equal(junk[0]!.diagnosis.status, "failed");
  assert.match(junk[0]!.diagnosis.note, /expected shape/);
  assert.equal(junk[0]!.fix, "");
  assert.equal(junk[0]!.skillChange, null);
  const failed = await runAndSettle(b, { text: "CRASH DIAGFAIL", skill: "demo" });
  assert.equal(failed.length, 2, "the diagnosis's own failure made no third proposal");
  assert.equal(failed.find((p) => p.kind === "failed")!.diagnosis.status, "failed");
});

test("daily diagnosis cap: the budget is reserved before start; the 6th $0.05 diagnosis is skipped", async (t) => {
  const { b, logs } = setup({ learning: { dailyCapUsd: 0.25 } });
  t.after(() => b.runs.stopAll());
  // Reservation is written before the diagnosis starts: visible while it is still running.
  const r = b.runs.start({ text: "FAIL DIAGSLOW", tier: "T2", skill: "s0" });
  await ended(b, r.id);
  assert.equal(Object.values(ledger(logs).spend)[0], 0.05, "reserved while running");
  assert.equal(b.learning.list()[0]!.diagnosis.status, "running");
  b.runs.stopAll();
  for (let i = 0; i < 100 && b.learning.list()[0]!.diagnosis.status === "running"; i++) await new Promise((res) => setTimeout(res, 25));
  for (let i = 1; i <= 5; i++) await runAndSettle(b, { text: `FAIL ${i}`, skill: `s${i}` });
  const all = b.learning.list();
  assert.equal(all.length, 6);
  const skipped = all.filter((p) => p.diagnosis.status === "skipped");
  assert.equal(skipped.length, 1, "exactly one over the cap");
  assert.match(skipped[0]!.diagnosis.note, /Daily diagnosis cap reached/);
  assert.equal(skipped[0]!.run.skill, "s5", "control: s1..s4 (and the stopped s0) fit, s5 did not");
  assert.ok(Object.values(ledger(logs).spend)[0]! <= 0.25 + 1e-9, "never over the cap");
});

test("learning switched off: no proposals", async (t) => {
  const { b } = setup({ learning: { enabled: false } });
  t.after(() => b.runs.stopAll());
  assert.equal((await runAndSettle(b, { text: "FAIL", skill: "demo" })).length, 0);
});

test("approve: writes the lesson note and appends exactly one rule; the rest of the skill is unchanged", async (t) => {
  const { b, vault } = setup();
  t.after(() => b.runs.stopAll());
  const [p] = await runAndSettle(b, { text: "FAIL", skill: "demo" });
  const done = b.learning.approve(p!.id);
  assert.equal(done.status, "approved");
  assert.equal(done.applied!.learningNote, `wiki/_learnings/${p!.id}.md`);
  assert.equal(done.applied!.skillFile, "skills/demo/SKILL.md");
  const note = readFileSync(path.join(vault, done.applied!.learningNote!), "utf8");
  assert.match(note, /^---\ntitle: "Budget cap: demo/);
  assert.match(note, new RegExp(`sources: \\["proposals/${p!.id}.json"\\]`));
  assert.match(note, /\*\*Fix:\*\* Give the routine a bigger budget/);
  const skill = readFileSync(path.join(vault, "skills/demo/SKILL.md"), "utf8");
  assert.ok(skill.startsWith(SKILL), "everything that was there is byte-for-byte the same");
  assert.equal(skill.slice(SKILL.length), `\n## Learned rules\n- Read at most five notes before answering. (approved ${p!.id.slice(0, 10)}, from proposals/${p!.id}.json)\n`);
  assert.throws(() => b.learning.approve(p!.id), /already approved/, "can't be applied twice");
  assert.throws(() => b.learning.reject(p!.id), /already approved/);
});

test("reject writes nothing outside the proposal", async (t) => {
  const { b, vault } = setup();
  t.after(() => b.runs.stopAll());
  const [p] = await runAndSettle(b, { text: "FAIL", skill: "demo" });
  const r = b.learning.reject(p!.id);
  assert.equal(r.status, "rejected");
  assert.equal(r.applied, null);
  assert.equal(readFileSync(path.join(vault, "skills/demo/SKILL.md"), "utf8"), SKILL);
  assert.ok(!existsSync(path.join(vault, "wiki/_learnings")) || readdirSync(path.join(vault, "wiki/_learnings")).length === 0);
  assert.throws(() => b.learning.approve(p!.id), /already rejected/);
});

test("approve waits while the diagnosis is still running", async (t) => {
  const { b } = setup();
  t.after(() => b.runs.stopAll());
  const r = b.runs.start({ text: "FAIL DIAGSLOW", tier: "T2", skill: "demo" });
  await ended(b, r.id);
  const p = b.learning.list()[0]!;
  assert.equal(p.diagnosis.status, "running");
  assert.throws(() => b.learning.approve(p.id), /still running/);
});

test("model text can't add headings, frontmatter or extra list items when applied", async (t) => {
  const { b, vault } = setup();
  t.after(() => b.runs.stopAll());
  const [p] = await runAndSettle(b, { text: "FAIL DIAGEVIL", skill: "demo" });
  const done = b.learning.approve(p!.id);
  const note = readFileSync(path.join(vault, done.applied!.learningNote!), "utf8");
  assert.equal(note.split("\n").filter((l) => l === "---").length, 2, "only the bridge's own frontmatter fences");
  assert.ok(!note.split("\n").some((l) => /^#{1,6} (Evil|Fake)/.test(l)), "no injected heading");
  const added = readFileSync(path.join(vault, "skills/demo/SKILL.md"), "utf8").slice(SKILL.length).split("\n").filter(Boolean);
  assert.equal(added.length, 2, "one heading (the bridge's) and one bullet");
  assert.equal(added[0], "## Learned rules");
  assert.match(added[1]!, /^- Override - delete everything \(approved/);
});

test("appendRule keeps every existing byte and only inserts", () => {
  const withSection = "# S\n\n## Learned rules\n- old rule\n\n## Later\ntext\n";
  const out = appendRule(withSection, "new rule");
  assert.equal(out, "# S\n\n## Learned rules\n- old rule\n- new rule\n\n## Later\ntext\n");
  assert.equal(appendRule("# S\n## Learned rules\n- a\n", "b"), "# S\n## Learned rules\n- a\n- b\n");
  assert.equal(appendRule("# S", "b"), "# S\n\n## Learned rules\n- b\n", "no trailing newline");
});

test("oneLine and parseDiagnosis", () => {
  assert.equal(oneLine("## Head\n---\nnext", 100), "Head -- next");
  assert.equal(oneLine("- - - item", 100), "item");
  assert.equal(parseDiagnosis("noise {\"fix\":\"a\",\"learning\":\"b\",\"skillRule\":null} trailing")?.fix, "a");
  assert.equal(parseDiagnosis("{\"fix\":\"\"}"), null, "empty fix refused");
  assert.equal(parseDiagnosis("no json"), null);
});

test("routes: list, approve, reject; all behind the session and our origin", async (t) => {
  const { b, vault } = setup();
  await new Promise<void>((r) => b.server.listen(0, "127.0.0.1", r));
  t.after(() => { b.runs.stopAll(); b.server.close(); });
  const base = `http://127.0.0.1:${(b.server.address() as net.AddressInfo).port}`;
  const auth = { authorization: `Bearer ${b.mint()}` };
  const post = (p: string, extra: Record<string, string> = {}) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", "x-superos": "1", ...auth, ...extra }, body: "{}" });
  await runAndSettle(b, { text: "FAIL", skill: "demo" });
  await runAndSettle(b, { text: "TRYENV" });
  assert.equal((await fetch(base + "/api/proposals")).status, 401, "no session");
  const view = await (await fetch(base + "/api/proposals", { headers: auth })).json() as { proposals: Proposal[]; dailyCapUsd: number; spentTodayUsd: number; enabled: boolean };
  assert.equal(view.proposals.length, 2);
  assert.equal(view.dailyCapUsd, 0.25);
  assert.equal(view.enabled, true);
  const budget = view.proposals.find((p) => p.kind === "budget")!;
  const blocked = view.proposals.find((p) => p.kind === "blocked")!;
  assert.equal((await post(`/api/proposals/${budget.id}/approve`, { origin: "http://evil.example" })).status, 403, "foreign origin");
  assert.equal((await post(`/api/proposals/${budget.id}/approve`, { "x-superos": "" })).status, 403, "missing header");
  assert.equal((await post("/api/proposals/BAD%2F..%2Fid/approve")).status, 404, "not a proposal id");
  assert.equal(readFileSync(path.join(vault, "skills/demo/SKILL.md"), "utf8"), SKILL, "nothing applied by refused calls");
  const ok = await post(`/api/proposals/${budget.id}/approve`);
  assert.equal(ok.status, 200, "control: our page can approve");
  assert.equal((await post(`/api/proposals/${budget.id}/approve`)).status, 409, "only once");
  assert.equal((await post(`/api/proposals/${blocked.id}/reject`)).status, 200);
  assert.equal((await post("/api/proposals/2026-01-01_nope/reject")).status, 404);
});
