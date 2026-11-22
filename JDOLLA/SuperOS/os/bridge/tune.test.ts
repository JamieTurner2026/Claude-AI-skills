// Run analysis (10b) through the bridge: result log lines carry what the analysis needs, "Suggest changes" writes
// "tune" proposals (3 a week, no repeats, no cost), and approving one records a decision and changes nothing else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { NOW, fixtureLog, result } from "../analysis/fixture.ts";
import { statsFromLogDir } from "../analysis/run-stats.ts";
import { TUNES_PER_WEEK, TUNE_NOTICE, isoWeek } from "./learning.ts";
import { makeVault } from "./fixture.ts";
import { createBridge } from "./server.ts";

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-claude.ts");
type P = { id: string; kind: string; status: string; whatBroke: string; fix: string; learning: string; applied: { note: string } | null; diagnosis: { status: string; costUsd: number | null }; tune: { key: string; kind: string } | null };

async function setup(log: string | null = fixtureLog()) {
  const clock = { now: NOW };
  const vault = makeVault();
  const logs = mkdtempSync(path.join(tmpdir(), "tune-logs-"));
  if (log !== null) writeFileSync(path.join(logs, "router.jsonl"), log);
  const b = createBridge(path.join(vault, "os"), { claudeBin: { cmd: process.execPath, prefixArgs: [fake] }, logDir: logs, now: () => clock.now });
  await new Promise<void>((r) => b.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(b.server.address() as AddressInfo).port}`;
  const token = b.mint();
  const hdr = { "content-type": "application/json", "x-superos": "1", authorization: `Bearer ${token}`, origin: base };
  const post = (p: string, body: unknown = {}) => fetch(base + p, { method: "POST", headers: hdr, body: JSON.stringify(body) });
  const proposals = async () => ((await (await fetch(base + "/api/proposals", { headers: { authorization: `Bearer ${token}` } })).json()) as { proposals: P[] }).proposals;
  return { b, vault, logs, clock, post, proposals, close: () => { b.runs.stopAll(); b.server.close(); } };
}
function tree(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) tree(f, base, out); else out[path.relative(base, f)] = `${statSync(f).size}:${readFileSync(f, "utf8").length}:${readFileSync(f, "utf8")}`;
  }
  return out;
}

test("isoWeek: ISO weeks across a year boundary", () => {
  assert.equal(isoWeek("2026-11-21"), "2026-W47");
  assert.equal(isoWeek("2026-11-22"), "2026-W47", "Sunday belongs to the week that began Monday");
  assert.equal(isoWeek("2026-11-23"), "2026-W48");
  assert.equal(isoWeek("2027-01-01"), "2026-W53");
  assert.equal(isoWeek("2024-12-30"), "2025-W01");
});

test("suggest: writes tune proposals with fixed text, no diagnosis run and no cost; the plan-today example is among them", async (t) => {
  const e = await setup(); t.after(e.close);
  const res = await e.post("/api/analysis/suggest", {});
  assert.equal(res.status, 200);
  const out = (await res.json()) as { found: number; created: number };
  assert.ok(out.found >= 4, "plan-today budget, vault-cleanup failure rate, daily cap, blocked");
  assert.equal(out.created, TUNES_PER_WEEK, "capped at 3");
  const ps = await e.proposals();
  assert.equal(ps.length, 3);
  assert.ok(ps.every((p) => p.kind === "tune" && p.status === "pending" && p.diagnosis.status === "skipped" && p.diagnosis.costUsd === null && p.learning === ""));
  const budget = ps.find((p) => p.tune?.key === "budget|skill:plan-today")!;
  assert.match(budget.whatBroke, /plan-today hit its budget cap 4 times in 30 days/);
  assert.match(budget.fix, /Raise plan-today's budget to \$0\.45/);
  assert.equal(e.b.runs.list().length, 0, "no run was started: no cost");
});

test("suggest: at most 3 a week, never the same suggestion twice, and next week brings the rest", async (t) => {
  const e = await setup(); t.after(e.close);
  const first = (await (await e.post("/api/analysis/suggest")).json()) as { created: number; skippedWeekly: number; skippedDuplicate: number };
  assert.deepEqual([first.created, first.skippedWeekly > 0], [3, true]);
  const again = (await (await e.post("/api/analysis/suggest")).json()) as { created: number; skippedWeekly: number; skippedDuplicate: number };
  assert.equal(again.created, 0, "same week: still capped");
  assert.equal(again.skippedDuplicate, 3, "and the three made already are recognised as repeats");
  assert.equal((await e.proposals()).length, 3);
  // Eight days later it is a new ISO week: the one suggestion that was held back now comes through; the first three are repeats.
  e.clock.now = new Date(NOW.getTime() + 8 * 86_400_000);
  const next = (await (await e.post("/api/analysis/suggest")).json()) as { found: number; created: number; skippedDuplicate: number };
  assert.ok(next.found >= 1, "control: the old log is still inside the window");
  assert.equal(next.created, next.found - 3 > 0 ? Math.min(3, next.found - 3) : 0, "only suggestions not made before");
  assert.equal(next.skippedDuplicate, 3);
  assert.equal((await e.proposals()).length, 3 + next.created);
});

test("approve records the decision only: config, skills, routines and every other file are byte-for-byte unchanged", async (t) => {
  const e = await setup(); t.after(e.close);
  await e.post("/api/analysis/suggest");
  const p = (await e.proposals())[0]!;
  const before = tree(e.vault);
  const res = await e.post(`/api/proposals/${p.id}/approve`);
  assert.equal(res.status, 200);
  const done = ((await res.json()) as { proposal: P }).proposal;
  assert.deepEqual([done.status, done.applied?.note], ["approved", "Decision recorded. Nothing was changed; edit the config yourself."]);
  const after = tree(e.vault);
  const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]);
  assert.deepEqual(changed, [`proposals/${p.id}.json`], "only the proposal file itself changed");
  assert.ok(!existsDir(path.join(e.vault, "wiki", "_learnings", `${p.id}.md`)), "no learning note");
  assert.equal((await e.post(`/api/proposals/${p.id}/approve`)).status, 409, "decided once");
});

function existsDir(f: string): boolean { try { statSync(f); return true; } catch { return false; } }

test("reject records a rejection and still stops the same suggestion coming back for 4 weeks", async (t) => {
  const e = await setup(); t.after(e.close);
  await e.post("/api/analysis/suggest");
  const p = (await e.proposals())[0]!;
  assert.equal((await e.post(`/api/proposals/${p.id}/reject`)).status, 200);
  const again = (await (await e.post("/api/analysis/suggest")).json()) as { skippedDuplicate: number };
  assert.ok(again.skippedDuplicate >= 3);
  assert.equal((await e.proposals()).filter((x) => x.tune?.key === p.tune!.key).length, 1);
});

test("suggest: route guards (needs the session, rejects bad bodies), an empty or missing log is fine, and nothing is created for a healthy log", async (t) => {
  const e = await setup(null); t.after(e.close);
  const none = await e.post("/api/analysis/suggest");
  assert.equal(none.status, 200);
  assert.deepEqual(await none.json(), { days: 30, found: 0, created: 0, skippedWeekly: 0, skippedDuplicate: 0 });
  for (const bad of [{ days: 0 }, { days: 366 }, { days: "x" }, { days: 7, dir: "/etc" }, { extra: 1 }]) assert.equal((await e.post("/api/analysis/suggest", bad)).status, 400, JSON.stringify(bad));
  const base = `http://127.0.0.1:${(e.b.server.address() as AddressInfo).port}`;
  assert.equal((await fetch(`${base}/api/analysis/suggest`, { method: "POST", headers: { "content-type": "application/json", "x-superos": "1" }, body: "{}" })).status, 401, "no session");
  const healthy = await setup([1, 2, 3, 4, 5, 6].map((d) => result({ days: d, skill: "ok", cost: 0.01 })).join("\n")); t.after(healthy.close);
  assert.equal(((await (await healthy.post("/api/analysis/suggest")).json()) as { found: number }).found, 0, "control: nothing wrong, nothing suggested");
});

test("the result log line carries tier, status, cost, cap, purpose, skill, routine, capHit and an 80-character request for typed runs only", async (t) => {
  const e = await setup(null); t.after(e.close);
  const long = "tell me about the charter " + "x".repeat(200);
  const info = e.b.runs.start({ tier: "T2", text: long });
  await new Promise<void>((r) => e.b.runs.subscribe(info.id, (ev) => { if (ev.type === "status" && ev.status !== "running") r(); }));
  const skillRun = e.b.runs.start({ tier: "T2", text: "secret skill input that must not be logged", skill: "demo" } as Parameters<typeof e.b.runs.start>[0]);
  await new Promise<void>((r) => e.b.runs.subscribe(skillRun.id, (ev) => { if (ev.type === "status" && ev.status !== "running") r(); }));
  const lines = readFileSync(path.join(e.logs, "router.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l["kind"] === "result");
  const typed = lines.find((l) => l["id"] === info.id)!;
  assert.deepEqual([typed["purpose"], typed["skill"], typed["routine"], typed["capHit"], typed["tier"], typed["status"]], ["run", null, null, false, "T2", "done"]);
  assert.equal(typeof typed["request"], "string");
  assert.equal((typed["request"] as string).length, 80);
  assert.ok((typed["request"] as string).startsWith("tell me about the charter"));
  const sk = lines.find((l) => l["id"] === skillRun.id);
  if (sk) assert.equal(sk["request"], null, "a skill's input is not logged");
  assert.ok(!readFileSync(path.join(e.logs, "router.jsonl"), "utf8").includes("secret skill input"));
});

test("the dashboard widget says it on the card: the notice text matches the bridge's", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app", "widgets", "proposals.ts"), "utf8");
  assert.ok(src.includes(JSON.stringify(TUNE_NOTICE)), "app/widgets/proposals.ts carries the same notice as TUNE_NOTICE");
  assert.match(TUNE_NOTICE, /never changes config/);
});
