import { test } from "node:test";
import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
import path from "node:path";
import { handleToolMessage, offeredTools } from "./mcp.ts";
import { proposalsSummary } from "./proposals_summary.ts";
import { makeToolVault, put, text } from "./vault-fixture.ts";

// NOW in the fixture is 2026-11-16T15:00Z.
type P = { id: string; createdAt: string; status: "pending" | "approved" | "rejected"; decidedAt?: string | null; kind: string; skill: string | null; rule?: string };
const proposal = (p: P) => JSON.stringify({
  id: p.id, createdAt: p.createdAt, status: p.status, decidedAt: p.decidedAt ?? null, kind: p.kind,
  run: { id: "r1", tier: "T2", dept: "ai", skill: p.skill, routine: null, status: "failed", error: "PROPSECRET error text", denied: [], costUsd: 0.01, capUsd: 0.25, prompt: "PROPSECRET prompt" },
  whatBroke: "PROPSECRET what broke", diagnosis: { status: "done", note: "PROPSECRET diagnosis", runId: null, costUsd: 0.01 },
  fix: "PROPSECRET fix", learning: "PROPSECRET lesson", skillChange: p.rule ? { skill: p.skill, rule: p.rule } : null, applied: null, move: null,
});
const PROPOSALS: P[] = [
  { id: "p1", createdAt: "2026-11-10T12:00:00Z", status: "pending", kind: "failed", skill: "plan-today" },
  { id: "p2", createdAt: "2026-11-12T12:00:00Z", status: "rejected", decidedAt: "2026-11-12T13:00:00Z", kind: "failed", skill: "plan-today" },
  { id: "p3", createdAt: "2026-11-14T08:00:00Z", status: "approved", decidedAt: "2026-11-14T12:00:00Z", kind: "failed", skill: "plan-today", rule: "Call the today tool\nbefore anything else. " + "x".repeat(300) },
  { id: "p4", createdAt: "2026-11-15T10:00:00Z", status: "rejected", decidedAt: "2026-11-15T11:00:00Z", kind: "budget", skill: "vault-cleanup" },
  { id: "p5", createdAt: "2026-11-16T10:00:00Z", status: "pending", kind: "blocked", skill: null },
  { id: "p6", createdAt: "2026-11-15T20:00:00Z", status: "approved", decidedAt: "2026-11-15T21:00:00Z", kind: "move", skill: null },
  { id: "p7", createdAt: "2026-11-16T09:00:00Z", status: "pending", kind: "failed", skill: "plan-today" },
  { id: "old", createdAt: "2026-09-01T12:00:00Z", status: "rejected", decidedAt: "2026-09-01T13:00:00Z", kind: "failed", skill: "plan-today" },
];

function setup() {
  const t = makeToolVault();
  for (const p of PROPOSALS) put(t.vault, `proposals/2026-11_${p.id}.json`, proposal(p));
  put(t.vault, "proposals/README.md", "# proposals\nPROPSECRET in a readme");
  put(t.vault, "proposals/broken.json", "{not json PROPSECRET");
  put(t.vault, "proposals/other-shape.json", JSON.stringify({ hello: "PROPSECRET" }));
  put(t.vault, "proposals/huge.json", proposal({ id: "big", createdAt: "2026-11-16T10:00:00Z", status: "rejected", kind: "failed", skill: "huge-skill", rule: "x".repeat(600 * 1024) })); // valid, but over the size cap
  put(t.vault, "proposals/.hidden.json", proposal({ id: "hid", createdAt: "2026-11-16T10:00:00Z", status: "rejected", kind: "failed", skill: "hidden-skill" }));
  put(t.outside, "outside.json", proposal({ id: "out", createdAt: "2026-11-16T10:00:00Z", status: "rejected", kind: "failed", skill: "outside-skill" }));
  symlinkSync(path.join(t.outside, "outside.json"), path.join(t.vault, "proposals", "linked.json"));
  return t;
}
type Out = {
  days: number; from: string; to: string; total: number; byKind: Record<string, number>; byStatus: Record<string, number>;
  repeatedFailures: { title: string; kind: string; skill: string; count: number; firstSeen: string; lastSeen: string }[];
  mostRejected: { skill: string; approved: number; rejected: number; pending: number }[];
  approvedRules: { skill: string; rule: string; approvedOn: string; daysSince: number; failuresBefore: number; failuresSince: number }[];
  skipped: number; truncated: boolean;
};
const run = (ctx: ReturnType<typeof makeToolVault>["ctx"], days: number): Out => proposalsSummary.run(proposalsSummary.input.parse({ days }), ctx) as Out;

test("counts by kind and status inside the window; older proposals are left out", () => {
  const { ctx } = setup();
  const r = run(ctx, 30);
  assert.deepEqual([r.days, r.from, r.to, r.total], [30, "2026-10-17", "2026-11-16", 7]);
  assert.deepEqual(r.byKind, { failed: 4, budget: 1, blocked: 1, move: 1 });
  assert.deepEqual(r.byStatus, { pending: 3, rejected: 2, approved: 2 });
  const day = run(ctx, 1); // since 2026-11-15T15:00Z
  assert.deepEqual([day.total, day.byKind], [3, { blocked: 1, move: 1, failed: 1 }]);
});

test("the most repeated failure comes first, grouped by kind and skill; move proposals are not failures", () => {
  const { ctx } = setup();
  const r = run(ctx, 30);
  assert.deepEqual(r.repeatedFailures[0], { title: "failed · plan-today", kind: "failed", skill: "plan-today", count: 4, firstSeen: "2026-11-10", lastSeen: "2026-11-16" });
  assert.deepEqual(r.repeatedFailures.map((g) => g.title).sort(), ["blocked · (typed request)", "budget · vault-cleanup", "failed · plan-today"]);
});

test("skills with the most rejected proposals", () => {
  const { ctx } = setup();
  assert.deepEqual(run(ctx, 30).mostRejected, [
    { skill: "plan-today", approved: 1, rejected: 1, pending: 2 },
    { skill: "vault-cleanup", approved: 0, rejected: 1, pending: 0 },
  ]);
});

test("approved rules show failures before and since, with the rule on one short line", () => {
  const { ctx } = setup();
  const [rule, ...rest] = run(ctx, 30).approvedRules;
  assert.equal(rest.length, 0, "the approved move has no rule");
  assert.deepEqual({ ...rule!, rule: undefined }, { skill: "plan-today", rule: undefined, approvedOn: "2026-11-14", daysSince: 2, failuresBefore: 3, failuresSince: 1 });
  assert.ok(rule!.rule.startsWith("Call the today tool before anything else."));
  assert.ok(rule!.rule.length <= 160 && !rule!.rule.includes("\n"));
  assert.deepEqual(run(ctx, 1).approvedRules, [], "approved two days ago: outside a 1-day window");
});

test("never returns run output, errors, prompts or diagnoses; bad, huge, hidden and linked files are skipped", () => {
  const { ctx } = setup();
  const r = run(ctx, 90);
  assert.ok(!text(r).includes("PROPSECRET"), "no free text from a proposal");
  assert.ok(!text(r).includes("hidden-skill") && !text(r).includes("outside-skill"), "dot files and links are never read");
  assert.ok(!text(r).includes("huge-skill"), "a file over the size cap is not read, even if it is a valid proposal");
  assert.equal(r.skipped, 3, "broken, other-shape and huge");
});

test("arguments: days 1 to 90 only, unknown arguments refused", () => {
  const { ctx } = setup();
  const offered = offeredTools("proposals_summary");
  const call = (args: unknown) => handleToolMessage(offered, ctx, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "proposals_summary", arguments: args } }) as { result: { isError: boolean } };
  assert.equal(call({ days: 7 }).result.isError, false, "control");
  for (const bad of [{}, { days: 0 }, { days: 91 }, { days: 1.5 }, { days: "7" }, { days: 7, dir: "../os" }]) assert.equal(call(bad).result.isError, true, JSON.stringify(bad));
});

test("an empty or missing proposals/ folder is a zero summary, not an error", () => {
  const { ctx } = makeToolVault();
  const r = run(ctx, 7);
  assert.deepEqual([r.total, r.repeatedFailures, r.mostRejected, r.approvedRules, r.skipped], [0, [], [], [], 0]);
});

test("the real policy offers proposals_summary to the proposals-review skill only", async () => {
  const { loadPolicy, scriptToolsFor } = await import("../bridge/policy.ts");
  const { pathsFor } = await import("../bridge/config.ts");
  const policy = loadPolicy(pathsFor(path.resolve(import.meta.dirname, "..")));
  assert.ok(scriptToolsFor(policy, "proposals-review").includes("proposals_summary"), "control: the skill gets it");
  assert.ok(!scriptToolsFor(policy).includes("proposals_summary"), "a typed request does not");
  for (const other of Object.keys(policy.skills).filter((s) => s !== "proposals-review")) {
    assert.ok(!scriptToolsFor(policy, other).includes("proposals_summary"), other);
  }
});

test("the shipped routine is valid, weekly on Sunday 17:00, T2 at $0.25, switched off, and its skill draft exists", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const { RoutineSchema } = await import("../bridge/routine-runner.ts");
  const { parseSchedule } = await import("../bridge/scheduler.ts");
  const vault = path.resolve(import.meta.dirname, "../..");
  const all = JSON.parse(readFileSync(path.join(vault, "routines/routines.json"), "utf8")) as unknown[];
  const r = RoutineSchema.parse(all.find((x) => (x as { id?: string }).id === "proposals-review"));
  assert.deepEqual([r.enabled, r.skill, r.tier, r.budgetUsd], [false, "proposals-review", "T2", 0.25]);
  assert.deepEqual(parseSchedule(r.schedule), { ok: true, schedule: { kind: "weekly", day: 0, hour: 17, minute: 0 } });
  assert.ok(existsSync(path.join(vault, "skills/proposals-review/SKILL.md")));
});
