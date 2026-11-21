import { test } from "node:test";
import assert from "node:assert/strict";
import { handleToolMessage, offeredTools } from "./mcp.ts";
import { recentChanges } from "./recent_changes.ts";
import { SECRETS, TODAY, makeToolVault, put, text } from "./vault-fixture.ts";

type Result = { today: string; since: string; days: number; total: number; truncated: boolean; changes: Array<{ path: string; title: string; date: string }>; error?: string };
const run = (ctx: ReturnType<typeof makeToolVault>["ctx"], input: object): Result => recentChanges.run(recentChanges.input.parse(input), ctx) as Result;

test("days = 1 is today only: newest first, path, title and date and nothing else", () => {
  const { ctx } = makeToolVault();
  const r = run(ctx, { days: 1 });
  assert.deepEqual([r.today, r.since, r.total, r.truncated], [TODAY, TODAY, 4, false]);
  assert.deepEqual(r.changes.map((c) => c.path), ["wiki/software/a.md", "wiki/_learnings/lesson.md", "wiki/directives.md", "outputs/2026-11/2026-11-16_software_plan.md"]);
  assert.deepEqual(r.changes[0], { path: "wiki/software/a.md", title: "Alpha note", date: TODAY });
  assert.equal(r.changes[3]?.title, "2026-11-16_software_plan", "an output's title is its file name");
  for (const c of r.changes) assert.deepEqual(Object.keys(c).sort(), ["date", "path", "title"]);
});

test("the window is calendar days with today as day 1 (6 days excludes the note from 6 days ago, 7 includes it)", () => {
  const { ctx } = makeToolVault();
  const six = run(ctx, { days: 6 });
  const seven = run(ctx, { days: 7 });
  assert.equal(six.since, "2026-11-11");
  assert.ok(!six.changes.some((c) => c.path === "wiki/software/b.md"));
  assert.equal(seven.since, "2026-11-10");
  assert.ok(seven.changes.some((c) => c.path === "wiki/software/b.md" && c.date === "2026-11-10"));
  assert.ok(seven.changes.some((c) => c.path === "outputs/2026-11/2026-11-10_ai_old.pdf"));
  assert.ok(seven.changes.some((c) => c.path === "wiki/ai/c.md" && c.date === "2026-11-15"));
});

test("dates are the owner's day, not UTC's", () => {
  const { vault, ctx } = makeToolVault();
  put(vault, "wiki/ai/late.md", "---\ntitle: Late\n---\n", "2026-11-17T03:00:00Z");   // 22:00 on the 16th in New York
  put(vault, "wiki/ai/early.md", "---\ntitle: Early\n---\n", "2026-11-16T04:00:00Z"); // 23:00 on the 15th in New York
  const r = run({ ...ctx, now: () => new Date("2026-11-17T03:30:00Z") }, { days: 1 }); // still the 16th in New York
  assert.equal(r.today, TODAY);
  assert.ok(r.changes.some((c) => c.path === "wiki/ai/late.md" && c.date === TODAY), "03:00Z on the 17th is the 16th at home");
  assert.ok(!r.changes.some((c) => c.path === "wiki/ai/early.md"), "04:00Z on the 16th is the 15th at home");
});

test("dept filters notes by folder and outputs by the department in the file name", () => {
  const { ctx } = makeToolVault();
  const sw = run(ctx, { days: 7, dept: "software" });
  assert.deepEqual(sw.changes.map((c) => c.path).sort(), ["outputs/2026-11/2026-11-16_software_plan.md", "wiki/software/a.md", "wiki/software/b.md"]);
  const ai = run(ctx, { days: 7, dept: "ai" });
  assert.deepEqual(ai.changes.map((c) => c.path).sort(), ["outputs/2026-11/2026-11-10_ai_old.pdf", "wiki/ai/c.md"]);
  assert.match(run(ctx, { days: 7, dept: "finance" }).error ?? "", /Unknown department "finance". Known: ai, software/);
});

test("never lists or reads what it must not: .env, dot entries, os/, logs/, raw/sessions, outputs/_work, generated indexes, and links out of the vault", () => {
  const { ctx } = makeToolVault();
  const all = text(run(ctx, { days: 60 }));
  for (const s of SECRETS) assert.ok(!all.includes(s), `${s} must not appear`);
  for (const bad of [".env", ".hidden", "os/", "logs/", "sessions", "_work", "_index", "_master-index", "link.md", "linkdir", "outside"]) assert.ok(!all.includes(bad), `${bad} must not appear`);
  assert.ok(all.includes("wiki/software/a.md"), "control: a normal note is listed");
});

test("results are capped at 100, newest first, and say so", () => {
  const { vault, ctx } = makeToolVault();
  for (let i = 0; i < 130; i++) put(vault, `wiki/ai/bulk-${String(i).padStart(3, "0")}.md`, "---\ntitle: Bulk\n---\n", `2026-11-16T${String(5 + Math.floor(i / 20)).padStart(2, "0")}:${String(i % 20).padStart(2, "0")}:00Z`);
  const r = run(ctx, { days: 1 });
  assert.deepEqual([r.changes.length, r.truncated], [100, true]);
  assert.ok(r.total >= 134);
  assert.equal(r.changes[0]?.path, "wiki/software/a.md", "still newest first");
});

test("titles are plain text: markup in a title cannot make a link or a tag", () => {
  const { vault, ctx } = makeToolVault();
  put(vault, "wiki/ai/evil.md", "---\ntitle: \"Evil [[os/.env]] <b>bold</b> `x`\"\n---\n", "2026-11-16T14:45:00Z");
  const t = run(ctx, { days: 1 }).changes.find((c) => c.path === "wiki/ai/evil.md")?.title;
  assert.equal(t, "Evil os/.env bold x");
});

test("arguments: days 1 to 60 only, unknown arguments refused, as a run's tools server sees them", () => {
  const { ctx } = makeToolVault();
  const offered = offeredTools("recent_changes");
  const call = (args: unknown) => handleToolMessage(offered, ctx, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "recent_changes", arguments: args } }) as { result: { isError: boolean; content: { text: string }[] } };
  assert.equal(call({ days: 3 }).result.isError, false, "control");
  for (const bad of [{}, { days: 0 }, { days: 61 }, { days: 1.5 }, { days: "3" }, { days: 3, path: "/etc" }, { days: 3, dept: "../os" }, { days: 3, dept: "A" }, { days: 3, extra: 1 }, null]) assert.equal(call(bad).result.isError, true, JSON.stringify(bad));
  assert.equal(JSON.parse(call({ days: 3 }).result.content[0]!.text).today, TODAY);
});
