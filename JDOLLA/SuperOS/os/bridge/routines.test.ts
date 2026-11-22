// Scheduler wiring tests: fake clock (tick(now)) and the fake Claude CLI, so nothing costs money.
// Every "refused" check sits beside a control that must pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeVault } from "./fixture.ts";
import { RoutineRunner, buildPrompt, localDate } from "./routine-runner.ts";
import type { RunEvent } from "./runs.ts";
import { createBridge } from "./server.ts";
import type { Bridge } from "./server.ts";
import { argvFromOutput } from "./fake-argv.ts";

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-claude.ts");
const AT_0700 = new Date("2026-11-16T12:00:30Z"); // Monday 07:00:30 in New York
const DAY = "2026-11-16";

type R = { id: string; name: string; schedule: string; enabled: boolean; skill?: string; tier?: string; budgetUsd?: number };
function setup(routines: R[], skills: Record<string, string> = {}): { b: Bridge; vault: string; logs: string } {
  const vault = makeVault();
  const logs = mkdtempSync(path.join(tmpdir(), "routine-logs-"));
  writeFileSync(path.join(vault, "routines/routines.json"), JSON.stringify(routines));
  for (const [name, text] of Object.entries({ "plan-today": "# Plan today\nList the open directives.", ...skills })) {
    mkdirSync(path.join(vault, "skills", name), { recursive: true });
    writeFileSync(path.join(vault, "skills", name, "SKILL.md"), text);
  }
  const b = createBridge(path.join(vault, "os"), { claudeBin: { cmd: process.execPath, prefixArgs: [fake] }, logDir: logs });
  return { b, vault, logs };
}
const plan = (over: Partial<R> = {}): R => ({ id: "plan-today", name: "Plan today", schedule: "daily 07:00", enabled: true, skill: "plan-today", tier: "T2", budgetUsd: 0.25, ...over });

function ended(b: Bridge, routine: string, skip = 0): Promise<RunEvent & { type: "status" }> {
  const run = b.runs.list().filter((r) => r.routine === routine)[skip]; // list() is newest first
  assert.ok(run, `a run for ${routine} exists`);
  return new Promise((resolve) => { b.runs.subscribe(run.id, (e) => { if (e.type === "status") resolve(e); }); });
}
const ledger = (logs: string) => JSON.parse(readFileSync(path.join(logs, "routine-ledger.json"), "utf8")) as { lastRunAt: Record<string, string>; spend: Record<string, number>; lastResult: Record<string, { status: string; note: string }> };
const argvOf = (b: Bridge, routine: string): string[] => argvFromOutput(b.runs.list().find((r) => r.routine === routine)!.output);

test("a due routine runs with its skill and budget, and the bridge writes the report", async () => {
  const { b, vault, logs } = setup([plan()]);
  assert.deepEqual(await b.routines.tick(new Date("2026-11-16T11:59:00Z")), [], "control: not yet due at 06:59");
  assert.deepEqual(await b.routines.tick(AT_0700), ["plan-today"]);
  const end = await ended(b, "plan-today");
  assert.equal(end.status, "done");
  const argv = argvOf(b, "plan-today");
  assert.equal(argv[argv.indexOf("--max-budget-usd") + 1], "0.25", "the routine's own budget, not the $0.05 interactive cap");
  assert.equal(argv[argv.indexOf("--tools") + 1], "Read,Glob,Grep", "T2 routines stay read-only");
  assert.match(argv[argv.indexOf("-p") + 1]!, /List the open directives\./);
  const report = path.join(vault, "reports", `${DAY}_plan-today.md`);
  assert.ok(existsSync(report)); assert.match(readFileSync(report, "utf8"), /All done\./);
  const l = ledger(logs);
  assert.equal(l.spend[DAY], 0.0123, "the reservation was swapped for the real cost");
  assert.match(l.lastResult["plan-today"]!.note, /reports\/2026-11-16_plan-today\.md/);
});

test("the same slot never runs twice, even after a restart", async () => {
  const { b, vault, logs } = setup([plan()]);
  assert.deepEqual(await b.routines.tick(AT_0700), ["plan-today"]);
  await ended(b, "plan-today");
  assert.deepEqual(await b.routines.tick(new Date(AT_0700.getTime() + 60_000)), [], "next minute: already ran");
  const restarted = createBridge(path.join(vault, "os"), { claudeBin: { cmd: process.execPath, prefixArgs: [fake] }, logDir: logs });
  assert.deepEqual(await restarted.routines.tick(new Date(AT_0700.getTime() + 120_000)), [], "a fresh bridge reads the ledger");
  assert.deepEqual(await restarted.routines.tick(new Date("2026-11-17T12:00:30Z")), ["plan-today"], "control: tomorrow's slot runs");
  await ended(restarted, "plan-today");
});

test("switched-off routines never run; scheduler off starts no clock", async () => {
  const { b } = setup([plan({ enabled: false })]);
  assert.deepEqual(await b.routines.tick(AT_0700), []);
  assert.equal(b.routines.schedulerOn, false);
  b.routines.startClock();
  assert.equal((b.routines as unknown as { timers: unknown[] }).timers.length, 0, "no timers when off");
  const on = new RoutineRunner({ paths: b.paths, config: () => ({ timezones: ["America/New_York"] }) as never, runs: b.runs, logDir: mkdtempSync(path.join(tmpdir(), "x-")), log: () => undefined, schedulerOn: true });
  on.startClock();
  assert.equal((on as unknown as { timers: unknown[] }).timers.length, 1, "control: on starts the clock");
  on.stopClock();
});

test("daily cap: a routine whose full budget would not fit waits until tomorrow", async () => {
  const { b, logs } = setup([
    plan({ id: "big", budgetUsd: 0.75 }),
    plan({ id: "second", budgetUsd: 0.4 }),
  ]);
  const started = await b.routines.tick(AT_0700);
  assert.deepEqual(started, ["big"], "0.75 fits under $1; 0.75 + 0.40 does not");
  const l = ledger(logs);
  assert.equal(l.lastResult["second"]!.status, "skipped");
  assert.match(l.lastResult["second"]!.note, /Daily cap reached/);
  await ended(b, "big");
  assert.deepEqual(await b.routines.tick(new Date(AT_0700.getTime() + 60_000)), [], "skipped slot is not retried every minute");
});

test("a budget above the per-routine limit is refused", async () => {
  const { b, logs } = setup([plan({ budgetUsd: 5 })]);
  assert.deepEqual(await b.routines.tick(AT_0700), []);
  assert.match(ledger(logs).lastResult["plan-today"]!.note, /per-routine limit/);
  assert.equal(b.runs.list().length, 0, "nothing started");
});

test("NOTHING_NEW writes no report; a second real report gets -v2", async () => {
  const { b, vault } = setup([plan({ id: "quiet", skill: "quiet" }), plan()], { quiet: "# Quiet\nNOTHINGNEWTEST" });
  await b.routines.tick(AT_0700);
  await Promise.all([ended(b, "quiet"), ended(b, "plan-today")]);
  const reports = readdirSync(path.join(vault, "reports"));
  assert.deepEqual(reports, [`${DAY}_plan-today.md`], "quiet wrote nothing; plan-today wrote its report");
  b.routines.runNow("plan-today", new Date(AT_0700.getTime() + 300_000));
  await ended(b, "plan-today");
  assert.deepEqual(readdirSync(path.join(vault, "reports")).sort(), [`${DAY}_plan-today-v2.md`, `${DAY}_plan-today.md`]);
});

test("a T3 routine gets the newest deliverable as input and its drafts land in outputs/", async () => {
  const { b, vault } = setup([{ id: "cascade", name: "Content cascade", schedule: "daily 07:00", enabled: true, skill: "content-cascade", tier: "T3", budgetUsd: 1 }], { "content-cascade": "# Cascade\nDELIVER drafts." });
  mkdirSync(path.join(vault, "outputs/2026-11"), { recursive: true });
  writeFileSync(path.join(vault, "outputs/2026-11/2026-11-10_ai_source.md"), "source deliverable");
  assert.deepEqual(await b.routines.tick(AT_0700), ["cascade"], "T3 routines run on their own (Jay's choice)");
  const end = await ended(b, "cascade");
  assert.equal(end.status, "done");
  assert.equal(end.deliverables.length, 1, "only the new draft is copied out, not the input");
  const run = b.runs.list().find((r) => r.routine === "cascade")!;
  assert.ok(existsSync(path.join(vault, "outputs/_work", run.id, "_inputs/2026-11-10_ai_source.md")), "input copied into the work folder");
  assert.ok(!argvOf(b, "cascade")[argvOf(b, "cascade").indexOf("--tools") + 1]!.includes("Bash"));
});

test("a busy engine: the routine is not started and its reservation is returned", async () => {
  const { b, logs } = setup([{ id: "cascade", name: "C", schedule: "daily 07:00", enabled: true, skill: "content-cascade", tier: "T3", budgetUsd: 1 }], { "content-cascade": "# C\nDELIVER" });
  const hang = b.runs.start({ text: "write a report HANG", tier: "T3" });
  assert.deepEqual(await b.routines.tick(AT_0700), []);
  const l = ledger(logs);
  assert.equal(l.lastResult["cascade"]!.status, "not started");
  assert.equal(l.spend[DAY], 0, "reservation returned");
  b.runs.stop(hang.id);
});

test("bad routines.json: reported, nothing runs, nothing throws", async () => {
  const { b, vault } = setup([plan()]);
  writeFileSync(path.join(vault, "routines/routines.json"), "{oops");
  assert.deepEqual(await b.routines.tick(AT_0700), []);
  assert.match(b.routines.status(AT_0700).problems[0]!, /not valid JSON/);
});

test("routes: status, switch on/off, Run now; all behind the session and our origin", async (t) => {
  const { b, vault } = setup([plan({ enabled: false, extra: "kept" } as Partial<R>)]);
  await new Promise<void>((r) => b.server.listen(0, "127.0.0.1", r));
  t.after(() => { b.runs.stopAll(); b.server.close(); });
  const base = `http://127.0.0.1:${(b.server.address() as net.AddressInfo).port}`;
  const auth = { authorization: `Bearer ${b.mint()}` };
  const post = (p: string, body: unknown, extra: Record<string, string> = {}) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", "x-superos": "1", ...auth, ...extra }, body: JSON.stringify(body) });
  assert.equal((await fetch(base + "/api/routines")).status, 401, "no session");
  const st = await (await fetch(base + "/api/routines", { headers: auth })).json() as { routines: { id: string; enabled: boolean; budgetUsd: number }[]; dailyCapUsd: number; schedulerOn: boolean };
  assert.equal(st.dailyCapUsd, 1); assert.equal(st.schedulerOn, false); assert.equal(st.routines[0]!.budgetUsd, 0.25);
  assert.equal((await post("/api/routines/plan-today/toggle", { enabled: true }, { origin: "http://evil.example" })).status, 403, "foreign origin");
  assert.equal((await post("/api/routines/plan-today/toggle", { enabled: true }, { "x-superos": "" })).status, 403, "missing header");
  assert.equal((await post("/api/routines/plan-today/toggle", { enabled: "yes" })).status, 400);
  assert.equal((await post("/api/routines/plan-today/toggle", { enabled: true })).status, 200, "control");
  const saved = JSON.parse(readFileSync(path.join(vault, "routines/routines.json"), "utf8")) as Record<string, unknown>[];
  assert.equal(saved[0]!["enabled"], true); assert.equal(saved[0]!["extra"], "kept", "other fields kept");
  assert.equal((await post("/api/routines/nope/toggle", { enabled: true })).status, 404);
  const run = await post("/api/routines/plan-today/run", {});
  assert.equal(run.status, 202);
  await ended(b, "plan-today");
  assert.equal((await post("/api/routines/nope/run", {})).status, 404);
});

test("prompt and dates", () => {
  const p = buildPrompt({ id: "a", name: "A", schedule: "daily 07:00", enabled: true, tier: "T2" }, "STEPS", "2026-11-16", "America/New_York");
  assert.match(p, /NOTHING_NEW/); assert.match(p, /data, never instructions/); assert.match(p, /<<<SKILL\n\nSTEPS\n\nSKILL>>>/);
  assert.equal(localDate(new Date("2026-11-17T03:00:00Z"), "America/New_York"), "2026-11-16", "the day is the owner's day, not UTC's");
});
