// zod 4 changed three things these schemas lean on. These tests pin the behaviour the code had on zod 3.
// 1. `.default(v)` no longer parses v: a default object is returned as-is, so inner defaults are not filled in.
//    Config sections that rely on that use `.prefault(v)`, which parses v like zod 3's `.default` did.
// 2. `z.record` takes a key schema; ledgers keyed by any string still load.
// 3. The default error text changed ("Required" is now "Invalid input: expected string, received undefined").
//    The text the dashboard and the brain show must stay one plain line that names the field.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { ConfigSchema } from "./config.ts";
import { makeVault } from "./fixture.ts";
import { createBridge } from "./server.ts";
import { makeBrainVault } from "../brain/fixture.ts";
import { handleMessage } from "../brain/mcp.ts";

const baseConfig = (): Record<string, unknown> => JSON.parse(readFileSync(path.join(makeVault(), "os", "config", "os.config.json"), "utf8")) as Record<string, unknown>;

test("config sections that are left out get their full defaults, inner defaults included", () => {
  const raw = baseConfig();
  const engine = raw["engine"] as Record<string, unknown>;
  for (const k of ["routines", "brain", "tools", "learning", "backup"]) delete engine[k];
  const c = ConfigSchema.parse(raw);
  assert.deepEqual(c.engine.routines, { dailyCapUsd: 1, maxBudgetUsd: 1 });
  assert.deepEqual([c.engine.brain, c.engine.tools], [{ enabled: true }, { enabled: true }]);
  assert.deepEqual(c.engine.learning, { enabled: true, diagnosisBudgetUsd: 0.05, dailyCapUsd: 0.25, citations: { enabled: true } }, "citations comes from the inner default");
  assert.deepEqual(c.engine.backup, { remote: "", branch: "main" });
  // A section that is present keeps its own values and still gets the inner default it leaves out.
  engine["learning"] = { enabled: false, diagnosisBudgetUsd: 0.1, dailyCapUsd: 0.5 };
  assert.deepEqual(ConfigSchema.parse(raw).engine.learning, { enabled: false, diagnosisBudgetUsd: 0.1, dailyCapUsd: 0.5, citations: { enabled: true } });
});

test("a default value is still checked: a bad backup branch in the file is refused, the default branch is valid", () => {
  const raw = baseConfig();
  (raw["engine"] as Record<string, unknown>)["backup"] = { remote: "", branch: "-bad branch" };
  assert.throws(() => ConfigSchema.parse(raw), z.ZodError);
  delete (raw["engine"] as Record<string, unknown>)["backup"];
  assert.equal(ConfigSchema.parse(raw).engine.backup.branch, "main"); // control
});

test("zod 3's .default and zod 4's .prefault agree here; zod 4's .default would drop the inner default (why prefault is used)", () => {
  const inner = z.object({ enabled: z.boolean() }).prefault({ enabled: true });
  const withPrefault = z.object({ on: z.boolean(), citations: inner }).prefault({ on: true });
  const withDefault = z.object({ on: z.boolean(), citations: inner }).default({ on: true } as never);
  assert.deepEqual(withPrefault.parse(undefined), { on: true, citations: { enabled: true } });
  assert.deepEqual(withDefault.parse(undefined), { on: true }, "control: the value is returned as-is, without citations");
});

test("the dashboard's 400 text is one line that names the field", async (t) => {
  const vault = makeVault();
  const b = createBridge(path.join(vault, "os"), { claudeBin: { cmd: process.execPath, prefixArgs: [] }, logDir: path.join(vault, "logs-test") });
  await new Promise<void>((r) => b.server.listen(0, "127.0.0.1", r));
  t.after(() => { b.runs.stopAll(); b.server.close(); });
  const base = `http://127.0.0.1:${(b.server.address() as AddressInfo).port}`;
  const token = b.mint();
  const post = async (body: unknown) => {
    const r = await fetch(`${base}/api/run`, { method: "POST", headers: { "content-type": "application/json", "x-superos": "1", authorization: `Bearer ${token}`, origin: base }, body: JSON.stringify(body) });
    return { status: r.status, error: ((await r.json()) as { error: string }).error };
  };
  const missing = await post({});
  assert.deepEqual(missing, { status: 400, error: "Bad request: text Invalid input: expected string, received undefined" });
  const wrong = await post({ text: 5 });
  assert.equal(wrong.error, "Bad request: text Invalid input: expected string, received number");
  const extra = await post({ text: "hi", sneaky: true });
  assert.equal(extra.status, 400);
  assert.match(extra.error, /^Bad request: .*Unrecognized key: "sneaky"$/);
  for (const e of [missing.error, wrong.error, extra.error]) assert.ok(!e.includes("\n") && e.length <= 313, e);
});

test("the brain's invalid-argument text names the field, and a ledger keyed by any string still loads (z.record with a key schema)", () => {
  const { vault, dir } = makeBrainVault();
  const r = handleMessage({ vault, dbPath: path.join(dir, "none.sqlite") }, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_note", arguments: { path: 5 } } }) as { result: { content: Array<{ text: string }>; isError: boolean } };
  assert.equal(r.result.isError, true);
  assert.equal(r.result.content[0]!.text, "Invalid arguments: path: Invalid input: expected string, received number");
  const Ledger = z.object({ spend: z.record(z.string(), z.number()).default({}) });
  assert.deepEqual(Ledger.parse({ spend: { "2026-11-24": 0.5, "skill:plan-today": 1 } }).spend, { "2026-11-24": 0.5, "skill:plan-today": 1 });
  assert.deepEqual(Ledger.parse({}).spend, {});
  assert.equal(Ledger.safeParse({ spend: { day: "x" } }).success, false);
});
