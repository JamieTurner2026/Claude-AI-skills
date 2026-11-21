import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, symlinkSync } from "node:fs";
import { handleToolMessage, offeredTools } from "./mcp.ts";
import { listReports } from "./list_reports.ts";
import { SECRETS, makeToolVault, put, text } from "./vault-fixture.ts";

type Result = { total: number; truncated: boolean; reports: Array<{ name: string; skill: string | null; date: string }> };
const run = (ctx: ReturnType<typeof makeToolVault>["ctx"], input: object): Result => listReports.run(listReports.input.parse(input), ctx) as Result;

test("newest first with name, skill and date; -v2 ranks above the original; a name with no date uses the file's day", () => {
  const { ctx } = makeToolVault();
  const r = run(ctx, { limit: 50 });
  assert.deepEqual(r.reports, [
    { name: "2026-11-16_vault-cleanup-v2.md", skill: "vault-cleanup", date: "2026-11-16" },
    { name: "2026-11-16_vault-cleanup.md", skill: "vault-cleanup", date: "2026-11-16" },
    { name: "2026-11-15_plan-today.md", skill: "plan-today", date: "2026-11-15" },
    { name: "notes.md", skill: null, date: "2026-11-12" },
  ]);
  assert.deepEqual([r.total, r.truncated], [4, false]);
  assert.ok(!text(r).includes("_index"), "the generated index is not a report");
});

test("limit trims the list and says so; the names are all it returns", () => {
  const { ctx } = makeToolVault();
  const r = run(ctx, { limit: 2 });
  assert.deepEqual([r.reports.length, r.total, r.truncated], [2, 4, true]);
  for (const rep of r.reports) assert.deepEqual(Object.keys(rep).sort(), ["date", "name", "skill"]);
  for (const s of SECRETS) assert.ok(!text(r).includes(s), `${s} must not appear`);
});

test("a link in reports/ is never listed, nor is a reports/ that is itself a link", () => {
  const { vault, outside, ctx } = makeToolVault();
  assert.ok(!text(run(ctx, { limit: 50 })).includes("linkreport"), "the linked file is skipped");
  // reports/ replaced by a link to an outside folder: nothing is followed
  put(outside, "reports-dir/2026-11-16_evil.md", "# OUTSIDETITLE");
  rmSync(`${vault}/reports`, { recursive: true, force: true });
  symlinkSync(`${outside}/reports-dir`, `${vault}/reports`);
  assert.deepEqual(run(ctx, { limit: 50 }), { total: 0, truncated: false, reports: [] });
});

test("arguments: limit 1 to 50 only, unknown arguments refused", () => {
  const { ctx } = makeToolVault();
  const offered = offeredTools("list_reports");
  const call = (args: unknown) => handleToolMessage(offered, ctx, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_reports", arguments: args } }) as { result: { isError: boolean } };
  assert.equal(call({ limit: 5 }).result.isError, false, "control");
  for (const bad of [{}, { limit: 0 }, { limit: 51 }, { limit: 2.5 }, { limit: "5" }, { limit: 5, dir: "../os" }, { limit: 5, path: "reports" }]) assert.equal(call(bad).result.isError, true, JSON.stringify(bad));
});
