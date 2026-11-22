import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WARN_AFTER_DAYS, summarize } from "../backup/summary.ts";
import type { BackupRecord } from "../backup/record.ts";
import { handleToolMessage, offeredTools } from "./mcp.ts";
import { backupStatus } from "./backup_status.ts";
import { makeToolVault } from "./vault-fixture.ts";
import type { ToolContext } from "./registry.ts";

const NOW = new Date("2026-11-22T12:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const rec = (status: BackupRecord["status"], okDaysAgo: number | null, atDaysAgo = 0): BackupRecord => ({ at: ago(atDaysAgo), status, message: "SECRET MESSAGE /vault/path", files: 3, lastOkAt: okDaysAgo === null ? null : ago(okDaysAgo) });

function ctxWith(record: unknown | null): ToolContext {
  const { ctx } = makeToolVault();
  const logs = mkdtempSync(path.join(tmpdir(), "bs-logs-"));
  if (record !== null) writeFileSync(path.join(logs, "backup-status.json"), typeof record === "string" ? record : JSON.stringify(record));
  return { ...ctx, now: () => NOW, logDir: logs };
}
const call = (ctx: ToolContext, args: unknown = {}) => handleToolMessage(offeredTools("backup_status"), ctx, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "backup_status", arguments: args } }) as { result: { content: Array<{ text: string }>; isError: boolean } };

test("summarize: result, whole days since the last success, and a warning only after 3 days", () => {
  assert.deepEqual(summarize(null, NOW), { ran: false, lastResult: null, lastSuccessAt: null, daysSinceSuccess: null, warning: null });
  const fresh = summarize(rec("pushed", 0), NOW);
  assert.deepEqual([fresh.ran, fresh.lastResult?.status, fresh.daysSinceSuccess, fresh.warning], [true, "pushed", 0, null]);
  assert.equal(summarize(rec("pushed", 2), NOW).warning, null, "2 days: fine");
  assert.equal(summarize(rec("failed", 3, 0), NOW).warning, null, "exactly 3 days: not yet");
  assert.equal(WARN_AFTER_DAYS, 3);
  const old = summarize(rec("failed", 3.5, 0), NOW);
  assert.deepEqual([old.daysSinceSuccess, old.warning], [3, "The last successful backup was 3 days ago."]);
  assert.equal(summarize(rec("refused", 10, 0), NOW).warning, "The last successful backup was 10 days ago.");
  assert.equal(summarize(rec("refused", null, 0), NOW).warning, "No backup has succeeded yet (the last attempt was refused).");
  assert.equal(summarize(rec("pushed", -1, 0), NOW).daysSinceSuccess, 0, "a clock a day ahead is never negative");
});

test("backup_status tool: reads the record, adds nothing from it but one-word results and dates", () => {
  const out = JSON.parse(call(ctxWith(rec("failed", 5, 1))).result.content[0]!.text) as Record<string, unknown>;
  assert.deepEqual(Object.keys(out).sort(), ["daysSinceSuccess", "lastResult", "lastSuccessAt", "ran", "warning"]);
  assert.deepEqual([out["ran"], out["daysSinceSuccess"], out["warning"]], [true, 5, "The last successful backup was 5 days ago."]);
  assert.deepEqual(out["lastResult"], { at: ago(1), status: "failed" });
  const text = JSON.stringify(out);
  assert.ok(!text.includes("SECRET") && !text.includes("/vault/path"), "the record's message never leaves");
  const ok = JSON.parse(call(ctxWith(rec("pushed", 0))).result.content[0]!.text) as { warning: string | null };
  assert.equal(ok.warning, null, "control: a fresh success has no warning");
});

test("backup_status tool: no record, a damaged record, no log folder and a linked log folder are all 'ran: false', never an error", () => {
  for (const ctx of [ctxWith(null), ctxWith("{broken"), ctxWith({ at: 5 })]) assert.equal((JSON.parse(call(ctx).result.content[0]!.text) as { ran: boolean }).ran, false);
  const { ctx } = makeToolVault();
  assert.equal((JSON.parse(call({ ...ctx, now: () => NOW }).result.content[0]!.text) as { ran: boolean }).ran, false, "no log folder in the context");
  assert.equal(call(ctxWith(null)).result.isError, false);
  void mkdirSync; void symlinkSync;
});

test("backup_status tool: takes no argument", () => {
  const ctx = ctxWith(rec("pushed", 0));
  for (const bad of [{ path: "x" }, { days: 3 }, { dir: "/etc" }]) assert.equal(call(ctx, bad).result.isError, true, JSON.stringify(bad));
  assert.equal(call(ctx, {}).result.isError, false, "control");
  assert.equal((backupStatus.inputSchema as { additionalProperties?: boolean }).additionalProperties, false);
});
