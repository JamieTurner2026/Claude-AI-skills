import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NOW, fixtureLog } from "../analysis/fixture.ts";
import { handleToolMessage, offeredTools } from "./mcp.ts";
import { runStats } from "./run_stats.ts";
import { makeToolVault } from "./vault-fixture.ts";
import type { ToolContext } from "./registry.ts";

function ctxWithLog(text?: string): ToolContext {
  const { ctx } = makeToolVault();
  const logs = mkdtempSync(path.join(tmpdir(), "rs-logs-"));
  if (text !== undefined) writeFileSync(path.join(logs, "router.jsonl"), text);
  return { ...ctx, now: () => NOW, logDir: logs };
}
const call = (ctx: ToolContext, args: unknown) => handleToolMessage(offeredTools("run_stats"), ctx, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "run_stats", arguments: args } }) as { result: { content: Array<{ text: string }>; isError: boolean } };

test("run_stats: same numbers as the report, from the fixture with its malformed lines", () => {
  const r = runStats.run({ days: 30 }, ctxWithLog(fixtureLog())) as { bySkill: Array<{ name: string; costUsd: number; capHits: number }>; malformed: number; caps: { dailyRoutineCapHits: number }; problem: string | null };
  assert.equal(r.bySkill.find((s) => s.name === "plan-today")!.costUsd, 1.7);
  assert.equal(r.bySkill.find((s) => s.name === "plan-today")!.capHits, 4);
  assert.ok(r.malformed >= 3);
  assert.equal(r.caps.dailyRoutineCapHits, 3);
  assert.equal(r.problem, null);
});

test("run_stats: arguments are strict, and no path or folder can be passed", () => {
  const ctx = ctxWithLog(fixtureLog());
  for (const bad of [{}, { days: 0 }, { days: 366 }, { days: 1.5 }, { days: "30" }, { days: 7, dir: "/etc" }, { days: 7, path: "../x" }, { days: 7, logDir: "/tmp" }]) {
    assert.equal(call(ctx, bad).result.isError, true, JSON.stringify(bad));
  }
  assert.equal(call(ctx, { days: 7 }).result.isError, false, "control");
  assert.equal((runStats.inputSchema as { additionalProperties?: boolean }).additionalProperties, false);
});

test("run_stats: no log, an empty log, a symlinked log and no log folder all answer safely", () => {
  assert.equal((runStats.run({ days: 30 }, ctxWithLog()) as { empty: boolean }).empty, true);
  assert.equal((runStats.run({ days: 30 }, ctxWithLog("")) as { empty: boolean }).empty, true);
  const ctx = ctxWithLog();
  const real = path.join(mkdtempSync(path.join(tmpdir(), "rs-real-")), "x.jsonl");
  writeFileSync(real, fixtureLog());
  symlinkSync(real, path.join(ctx.logDir!, "router.jsonl"));
  const linked = runStats.run({ days: 30 }, ctx) as { empty: boolean; problem: string | null; totals: { runs: number } };
  assert.deepEqual([linked.empty, linked.totals.runs, typeof linked.problem], [true, 0, "string"]);
  const { ctx: plain } = makeToolVault();
  assert.equal((runStats.run({ days: 30 }, plain) as { empty: boolean }).empty, true, "a context with no log folder");
});

test("run_stats: the answer is numbers and short cleaned request prefixes, no ids or full text", () => {
  const text = JSON.stringify(runStats.run({ days: 30 }, ctxWithLog(fixtureLog())));
  assert.ok(!/"id":/.test(text), "no run ids");
  assert.ok(!text.includes("whole</b>") && !text.includes("[["), "markup is stripped from request prefixes");
  assert.ok(text.includes("Summarise the whole vault"), "control: the cleaned prefix is there");
});
