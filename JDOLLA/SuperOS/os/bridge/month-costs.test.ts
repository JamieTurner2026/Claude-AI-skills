// The month-costs routine: "monthly 1 08:10" in the scheduler, the built-in run through the bridge (no model, $0, writes
// reports/YYYY-MM_costs.md, never overwrites), and the Health strip's "this month" figure.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatHealth } from "../shared/health.ts";
import type { HealthView } from "../shared/health.ts";
import { makeVault } from "./fixture.ts";
import { dueRoutines, latestSlot, parseSchedule } from "./scheduler.ts";
import { createBridge } from "./server.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fake = path.join(here, "fake-claude.ts");
const NY = "America/New_York";
const ENTRY = { id: "month-costs", name: "Monthly costs", schedule: "monthly 1 08:10", enabled: false, builtin: "month-costs" };

test("scheduler: 'monthly <1-28> HH:MM' parses; anything else (0, 29, 31, no zero pad on the time, junk) is refused", () => {
  assert.deepEqual(parseSchedule("monthly 1 08:10"), { ok: true, schedule: { kind: "monthly", dom: 1, hour: 8, minute: 10 } });
  assert.deepEqual(parseSchedule("monthly 28 23:59"), { ok: true, schedule: { kind: "monthly", dom: 28, hour: 23, minute: 59 } });
  assert.equal((parseSchedule("monthly 07 00:00") as { ok: true; schedule: { dom: number } }).schedule.dom, 7);
  for (const bad of ["monthly 0 08:10", "monthly 29 08:10", "monthly 31 08:10", "monthly 1 8:10", "monthly 1 24:00", "monthly 08:10", "monthly first 08:10", "monthly 1 08:10 x", "yearly 1 08:10"]) assert.equal(parseSchedule(bad).ok, false, bad);
  assert.match((parseSchedule("monthly 31 08:10") as { reason: string }).reason, /monthly <1-28> HH:MM/);
});

test("scheduler: the slot is the 1st at 08:10 local; the latest slot is found across month and year ends and DST", () => {
  const s = (parseSchedule("monthly 1 08:10") as { schedule: Parameters<typeof latestSlot>[0] }).schedule;
  const at = (iso: string) => new Date(latestSlot(s, Date.parse(iso), NY) as number).toISOString();
  assert.equal(at("2026-11-01T13:30:00Z"), "2026-11-01T13:10:00.000Z", "Nov 1 2026 is the day the clocks go back (2am): 08:10 is already EST, 13:10Z");
  assert.equal(at("2026-11-01T13:09:59Z"), "2026-10-01T12:10:00.000Z", "a second before: still October's slot (08:10 EDT, 12:10Z)");
  assert.equal(at("2026-11-30T23:00:00Z"), "2026-11-01T13:10:00.000Z");
  assert.equal(at("2026-12-01T13:10:00Z"), "2026-12-01T13:10:00.000Z", "Dec 1 08:10 EST is 13:10Z (the clocks went back)");
  assert.equal(at("2027-01-15T00:00:00Z"), "2027-01-01T13:10:00.000Z", "across the year end");
  assert.equal(at("2026-03-31T12:00:00Z"), "2026-03-01T13:10:00.000Z", "March 1 is still EST");
  assert.equal(at("2026-04-01T12:10:00Z"), "2026-04-01T12:10:00.000Z", "April 1 08:10 EDT");
});

test("scheduler: due once per month, only when enabled, not mid-month, and enabling it mid-month does not fire at once", () => {
  const r = [{ ...ENTRY, enabled: true }];
  const due = (iso: string, last: Record<string, string> = {}) => dueRoutines(r, last, new Date(iso), { timezone: NY }).due.length;
  assert.equal(due("2026-11-01T13:09:00Z", { "month-costs": "2026-10-01T12:11:00Z" }), 0, "08:09: not yet");
  assert.equal(due("2026-11-01T13:10:30Z", { "month-costs": "2026-10-01T12:11:00Z" }), 1, "08:10: due");
  assert.equal(due("2026-11-01T13:11:30Z", { "month-costs": "2026-11-01T13:10:30Z" }), 0, "already ran this month's slot");
  assert.equal(due("2026-11-17T12:00:00Z", { "month-costs": "2026-11-01T13:10:30Z" }), 0, "mid-month: nothing");
  assert.equal(due("2026-11-17T12:00:00Z"), 0, "never run, enabled mid-month: the slot is long past the grace window");
  assert.equal(due("2026-11-01T13:30:00Z"), 1, "never run, enabled 20 minutes after the slot: inside the grace window");
  assert.equal(due("2026-11-03T12:00:00Z", { "month-costs": "2026-10-01T12:11:00Z" }), 1, "the PC was off on the 1st: one catch-up run");
  assert.equal(dueRoutines([{ ...ENTRY, enabled: false }], {}, new Date("2026-11-01T12:10:30Z"), { timezone: NY }).due.length, 0, "switched off: never");
});

const lineAt = (at: string, cost: number, over: object = {}) => JSON.stringify({ at, kind: "result", id: `r${cost}`, tier: "T2", status: "done", costUsd: cost, capUsd: 0.05, ms: 1, exit: 0, denied: 0, purpose: "run", skill: null, routine: null, dept: "general", capHit: false, request: "SECRETPROMPT", ...over });

async function setup(opts: { enabled?: boolean; now: Date; lines?: string[] }) {
  const vault = makeVault();
  const logs = mkdtempSync(path.join(tmpdir(), "mcr-logs-"));
  writeFileSync(path.join(vault, "routines/routines.json"), JSON.stringify([{ ...ENTRY, enabled: opts.enabled === true }]));
  writeFileSync(path.join(logs, "router.jsonl"), (opts.lines ?? []).join("\n") + "\n");
  const b = createBridge(path.join(vault, "os"), { claudeBin: { cmd: process.execPath, prefixArgs: [fake] }, logDir: logs, now: () => opts.now });
  await new Promise<void>((r) => b.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(b.server.address() as AddressInfo).port}`;
  const token = b.mint();
  const hdr = { "content-type": "application/json", "x-superos": "1", authorization: `Bearer ${token}`, origin: base };
  const post = (p: string) => fetch(base + p, { method: "POST", headers: hdr, body: "{}" });
  const health = async () => (await (await fetch(base + "/api/health", { headers: { authorization: `Bearer ${token}` } })).json()) as HealthView;
  const result = async () => {
    for (let i = 0; i < 400; i++) {
      const r = b.routines.status().routines.find((x) => x.id === "month-costs")?.lastResult;
      if (r && r.status !== "running") return r;
      await new Promise((res) => setTimeout(res, 25));
    }
    throw new Error("the routine never finished");
  };
  return { b, vault, logs, post, health, result, close: () => { b.runs.stopAll(); b.server.close(); } };
}

test("the shipped month-costs routine: monthly 1 08:10, built in (no skill, no tier, no model), switched OFF", () => {
  const list = JSON.parse(readFileSync(path.join(here, "..", "..", "routines", "routines.json"), "utf8")) as Array<Record<string, unknown>>;
  assert.deepEqual(list.find((r) => r["id"] === "month-costs"), { id: "month-costs", name: "Monthly costs", schedule: "monthly 1 08:10", enabled: false, builtin: "month-costs" });
});

test("Run now writes last month's report (no model, $0), a second run adds -v2 and leaves the first alone; the prompt never appears", async (t) => {
  const e = await setup({ now: new Date("2026-11-01T12:10:30Z"), lines: [lineAt("2026-10-31T03:00:00Z", 0.3), lineAt("2026-10-15T16:00:00Z", 0.2, { routine: "plan-today", skill: "plan-today", tier: "T3" }), lineAt("2026-11-01T05:00:00Z", 5)] });
  t.after(e.close);
  const res = await e.post("/api/routines/month-costs/run");
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { run: null });
  const r = await e.result();
  assert.deepEqual([r.status, r.costUsd, r.runId, e.b.runs.list().length], ["done", 0, null, 0], "no model run, no cost");
  assert.match(r.note, /^Wrote reports\/2026-10_costs\.md \(0\.50 USD over 2 runs\)\.$/);
  const file = path.join(e.vault, "reports", "2026-10_costs.md");
  const text = readFileSync(file, "utf8");
  assert.match(text, /\*\*Total spend \$0\.5000\*\* over 2 runs/, "October only: the Nov 1 run is November's");
  assert.ok(!text.includes("SECRETPROMPT") && !text.includes("5.0000"));
  await e.post("/api/routines/month-costs/run");
  for (let i = 0; i < 200 && !existsSync(path.join(e.vault, "reports", "2026-10_costs-v2.md")); i++) await new Promise((res) => setTimeout(res, 25));
  assert.deepEqual(readdirSync(path.join(e.vault, "reports")).sort(), ["2026-10_costs-v2.md", "2026-10_costs.md"]);
  assert.equal(readFileSync(file, "utf8"), text, "the first report was not overwritten");
});

test("an empty month writes no file and says so; the scheduler runs it on the 1st at 08:10 only when switched on", async (t) => {
  const off = await setup({ now: new Date("2026-11-01T12:10:30Z"), lines: [lineAt("2026-10-15T16:00:00Z", 0.2)] }); t.after(off.close);
  assert.deepEqual(await off.b.routines.tick(new Date("2026-11-01T13:10:30Z")), [], "switched off: never");
  assert.ok(!existsSync(path.join(off.vault, "reports")) || readdirSync(path.join(off.vault, "reports")).length === 0);
  const on = await setup({ enabled: true, now: new Date("2026-11-01T12:10:30Z"), lines: [lineAt("2026-10-15T16:00:00Z", 0.2)] }); t.after(on.close);
  assert.deepEqual(await on.b.routines.tick(new Date("2026-11-01T13:10:30Z")), ["month-costs"]);
  assert.equal((await on.result()).status, "done");
  assert.ok(existsSync(path.join(on.vault, "reports", "2026-10_costs.md")));
  assert.deepEqual(await on.b.routines.tick(new Date("2026-11-01T13:12:30Z")), [], "the slot is used up");
  const empty = await setup({ now: new Date("2026-12-01T13:10:30Z"), lines: [lineAt("2026-10-15T16:00:00Z", 0.2)] }); t.after(empty.close);
  await empty.post("/api/routines/month-costs/run");
  const r = await empty.result();
  assert.deepEqual([r.status, /No runs were logged in 2026-11/.test(r.note)], ["done", true]);
  assert.ok(!existsSync(path.join(empty.vault, "reports")) || readdirSync(path.join(empty.vault, "reports")).length === 0, "no file for an empty month");
});

test("Health: 'this month' is the spend so far this calendar month in Jay's time zone, and the strip and the table show it", async (t) => {
  const now = new Date("2026-11-20T16:00:00Z");
  const e = await setup({ now, lines: [lineAt("2026-11-01T04:00:00Z", 0.25), lineAt("2026-11-19T12:00:00Z", 0.5), lineAt("2026-11-01T03:59:00Z", 40), lineAt("2026-12-01T05:00:00Z", 80)] }); t.after(e.close);
  const h = await e.health();
  assert.equal(h.month.spendUsd, 0.75, "Nov 1 00:00 EDT counts; Oct 31 23:59 EDT and Dec 1 do not");
  assert.match(formatHealth(h), /^This month\s+\$0\.75 spent$/m);
  const empty = await setup({ now, lines: [] }); t.after(empty.close);
  assert.equal((await empty.health()).month.spendUsd, 0);
  const main = readFileSync(path.join(here, "..", "app", "main.ts"), "utf8");
  assert.match(main, /chip\("This month", `\$\$\{v\.month\.spendUsd\.toFixed\(2\)\}`, false\)/);
  assert.ok(!JSON.stringify(h).includes("SECRETPROMPT"));
});
