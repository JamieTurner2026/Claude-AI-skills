import { test } from "node:test";
import assert from "node:assert/strict";
import { handleToolMessage, offeredTools } from "./mcp.ts";
import { vaultStats } from "./vault_stats.ts";
import { SECRETS, TODAY, makeToolVault, put, text } from "./vault-fixture.ts";

type Result = {
  today: string; truncated: boolean; folders: Record<string, number>; departments: Array<{ slug: string; wiki: number; raw: number; outputs: number }>;
  notes: { total: number; withoutSources: { count: number; paths: string[] }; notUpdatedIn60Days: { count: number; notes: Array<{ path: string; updated: string }> } };
};
const run = (ctx: ReturnType<typeof makeToolVault>["ctx"]): Result => vaultStats.run(vaultStats.input.parse({}), ctx) as Result;

test("counts per folder (links, dot entries, os/, logs/, raw/sessions and outputs/_work are not counted)", () => {
  const { ctx } = makeToolVault();
  const r = run(ctx);
  assert.equal(r.today, TODAY);
  assert.deepEqual(r.folders, { wiki: 10, raw: 1, outputs: 2, depts: 2, skills: 1, docs: 0, reports: 5, daily: 0, projects: 0, proposals: 0, evals: 0, inbox: 0 });
  assert.ok(!("os" in r.folders) && !("logs" in r.folders));
});

test("counts per department: notes (without generated indexes), raw files and outputs named for it", () => {
  const { ctx } = makeToolVault();
  assert.deepEqual(run(ctx).departments, [
    { slug: "ai", wiki: 4, raw: 0, outputs: 1 },
    { slug: "software", wiki: 2, raw: 1, outputs: 1 },
  ]);
});

test("notes with no sources: and notes not updated in 60 days (frontmatter date, else the file's day; day 60 is fine, day 61 is stale)", () => {
  const { ctx } = makeToolVault();
  const r = run(ctx);
  assert.equal(r.notes.total, 7, "wiki notes without the generated indexes and the directives checklist");
  assert.deepEqual(r.notes.withoutSources, { count: 2, paths: ["wiki/ai/undated.md", "wiki/software/b.md"] });
  assert.deepEqual(r.notes.notUpdatedIn60Days, { count: 3, notes: [
    { path: "wiki/ai/d61.md", updated: "2026-09-16" },
    { path: "wiki/ai/undated.md", updated: "2026-01-01" },
    { path: "wiki/software/b.md", updated: "2025-01-01" },
  ] });
  assert.ok(!text(r.notes.notUpdatedIn60Days).includes("d60"), "exactly 60 days old is not stale");
});

test("only counts, names and dates come back, never a body or a secret; lists are capped at 50", () => {
  const { vault, ctx } = makeToolVault();
  for (let i = 0; i < 70; i++) put(vault, `wiki/ai/n${i}.md`, "---\ntitle: x\nupdated: 2020-01-01\n---\nBODYSECRET");
  const r = run(ctx);
  assert.equal(r.notes.withoutSources.count, 72);
  assert.equal(r.notes.withoutSources.paths.length, 50);
  assert.equal(r.notes.notUpdatedIn60Days.notes.length, 50);
  const all = text(r);
  for (const s of SECRETS) assert.ok(!all.includes(s), `${s} must not appear`);
  assert.ok(text(run(makeToolVault().ctx)).length < 3000, "a small vault gives a small answer");
});

test("arguments: none allowed", () => {
  const { ctx } = makeToolVault();
  const offered = offeredTools("vault_stats");
  const call = (args: unknown) => handleToolMessage(offered, ctx, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "vault_stats", arguments: args } }) as { result: { isError: boolean } };
  assert.equal(call({}).result.isError, false, "control");
  for (const bad of [{ dept: "ai" }, { path: "wiki" }, { x: 1 }]) assert.equal(call(bad).result.isError, true, JSON.stringify(bad));
});
