// Run engine tests. Every run uses fake-claude.ts, so nothing here costs money or calls Claude.
// Each "blocked" check sits next to a control that must succeed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildClaudeArgs, capFor } from "./claude-args.ts";
import { builtinDenyRules } from "./deny-rules.ts";
import { loadConfig, pathsFor } from "./config.ts";
import { makeVault } from "./fixture.ts";
import { deliverableName, slugify } from "./runs.ts";
import type { RunEvent, RunInfo } from "./runs.ts";
import { createBridge } from "./server.ts";
import type { Bridge } from "./server.ts";
import { argvFromOutput } from "./fake-argv.ts";

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-claude.ts");
let bridge: Bridge, base: string, token: string, vault: string, logs: string;

before(async () => {
  vault = makeVault();
  logs = mkdtempSync(path.join(tmpdir(), "superos-logs-"));
  bridge = createBridge(path.join(vault, "os"), { claudeBin: { cmd: process.execPath, prefixArgs: [fake] }, logDir: logs });
  await new Promise<void>((r) => bridge.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(bridge.server.address() as net.AddressInfo).port}`;
  token = bridge.mint();
});
after(() => { bridge.runs.stopAll(); bridge.server.close(); });

const run = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + "/api/run", { method: "POST", headers: { "content-type": "application/json", "x-superos": "1", authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify(body) });
const T2 = "what does the software department do?";
const T3 = (extra: string) => `write a short summary report about the vault ${extra}`;

/** Resolves with the final status event of a run. */
function finished(id: string, timeoutMs = 8000): Promise<RunEvent & { type: "status" }> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("run did not finish")), timeoutMs);
    const unsub = bridge.runs.subscribe(id, (e) => { if (e.type === "status") { clearTimeout(t); unsub?.(); resolve(e); } });
  });
}
const startOk = async (body: unknown): Promise<RunInfo> => {
  const r = await run(body);
  assert.equal(r.status, 202, JSON.stringify(await r.clone().json()));
  return ((await r.json()) as { run: RunInfo }).run;
};
const argvOf = (output: string): string[] => argvFromOutput(output);

test("exact command line per tier", () => {
  const p = pathsFor(path.join(vault, "os"));
  const config = loadConfig(p);
  const base = { vault: p.vault, workDir: "/w", t3Tools: ["Read", "Glob", "Grep", "Write", "Edit"] as const, deny: builtinDenyRules(p.vault), sandbox: { available: false, reason: "test" } };
  const t2 = buildClaudeArgs({ ...base, tier: "T2", text: "hi", budgetUsd: 0.05 }, config);
  assert.equal(t2.cwd, p.vault);
  for (const flag of ["-p", "--restricted", "--strict-mcp-config", "--no-session-persistence", "--settings"]) assert.ok(t2.args.includes(flag), flag);
  assert.equal(t2.args[t2.args.indexOf("--tools") + 1], "Read,Glob,Grep");
  assert.equal(t2.args[t2.args.indexOf("--model") + 1], "haiku");
  assert.equal(t2.args[t2.args.indexOf("--max-budget-usd") + 1], "0.05");
  assert.ok(!t2.args.includes("acceptEdits") && !t2.args.includes("--bare") && !t2.args.join(" ").includes("Bash"));
  const t3 = buildClaudeArgs({ ...base, tier: "T3", text: "hi", budgetUsd: 2 }, config);
  assert.equal(t3.cwd, "/w");
  assert.equal(t3.args[t3.args.indexOf("--permission-mode") + 1], "acceptEdits");
  assert.equal(t3.args[t3.args.indexOf("--tools") + 1], "Read,Glob,Grep,Write,Edit");
  assert.ok(!t3.args[t3.args.indexOf("--tools") + 1]?.includes("Bash"), "T3 never gets Bash before step (g)");
  assert.throws(() => buildClaudeArgs({ ...base, tier: "T3", text: "hi", budgetUsd: 2 },
    { ...config, engine: { ...config.engine, t3: { ...config.engine.t3, permissionMode: "bypassPermissions" } } }), /not allowed/);
});

test("deny rules cover .env, os/ and logs with absolute paths", () => {
  const deny = builtinDenyRules("/v/ault");
  for (const r of ["Read(//v/ault/**/.env*)", "Read(//v/ault/os/**)", "Write(//v/ault/os/**)", "Read(//v/ault/logs/**)", "Edit(//v/ault/.claude/**)"]) assert.ok(deny.includes(r), r);
});

test("budget: never above the config cap", () => {
  const config = loadConfig(pathsFor(path.join(vault, "os")));
  assert.equal(capFor("T2", config), 0.05, "control: default cap");
  assert.equal(capFor("T3", config, 0.5), 0.5, "control: a lower cap passes through");
  assert.throws(() => capFor("T3", config, 5), /can't be more/);
  assert.throws(() => capFor("T2", config, 0.06), /can't be more/);
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => capFor("T3", config, bad));
});

test("/api/run gates: session, T1, T3 confirm, budget", async () => {
  assert.equal((await run({ text: T2 }, { authorization: "Bearer nope" })).status, 401, "bad token");
  const t1 = await run({ text: "open software" });
  assert.equal(t1.status, 400, "T1 is never run");
  const unconfirmed = await run({ text: T3("A") });
  assert.equal(unconfirmed.status, 409, "T3 without confirm is refused");
  assert.equal(((await unconfirmed.json()) as { needsConfirm: boolean }).needsConfirm, true);
  assert.equal(bridge.runs.list().length, 0, "nothing was started by the refused requests");
  assert.equal((await run({ text: T3("B"), confirm: true, budgetUsd: 50 })).status, 400, "budget above cap");
  assert.equal((await run({ text: T2, extra: 1 })).status, 400, "unknown fields refused");
  const ok = await startOk({ text: T3("C"), confirm: true });
  assert.equal(ok.tier, "T3", "control: confirmed T3 starts");
  assert.equal((await finished(ok.id)).status, "done");
});

test("T2 run streams output, records cost, and logs it", async () => {
  const info = await startOk({ text: T2 });
  assert.equal(info.tier, "T2");
  const end = await finished(info.id);
  assert.equal(end.status, "done");
  assert.equal(end.costUsd, 0.0123);
  const got = bridge.runs.get(info.id)!;
  assert.match(got.output, /All done\./);
  assert.ok(got.output.includes(`CWD:${vault}`) || got.output.includes("CWD:"), "T2 ran from the vault");
  const lines = readFileSync(path.join(logs, "router.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
  assert.ok(lines.some((l) => l["kind"] === "route" && l["tier"] === "T2"));
  assert.ok(lines.some((l) => l["kind"] === "result" && l["id"] === info.id && l["costUsd"] === 0.0123 && l["status"] === "done"));
});

test("shell syntax in a request is one plain argument, never executed", async () => {
  const marker = path.join(vault, "PWNED");
  const nasty = `what is this; touch ${marker} && echo $(whoami) \`id\` | cat > /dev/null?`;
  const info = await startOk({ text: nasty });
  await finished(info.id);
  const argv = argvOf(bridge.runs.get(info.id)!.output);
  assert.equal(argv[argv.indexOf("-p") + 1], nasty, "control: the exact text arrives as one argument");
  assert.equal(existsSync(marker), false, "the touch command never ran");
});

test("stop ends a hanging run by its exact process", async () => {
  const info = await startOk({ text: "what is going on HANG?" });
  await new Promise((r) => setTimeout(r, 400));
  const pid = JSON.parse(readFileSync(path.join(logs, "router.jsonl"), "utf8").trim().split("\n").reverse().find((l) => l.includes(info.id) && l.includes('"start"'))!).pid as number;
  assert.ok(pid > 0);
  process.kill(pid, 0); // control: it is alive before the stop
  const r = await fetch(`${base}/api/runs/${info.id}/stop`, { method: "POST", headers: { authorization: `Bearer ${token}`, "x-superos": "1" } });
  assert.equal(r.status, 200);
  assert.equal((await finished(info.id)).status, "stopped");
  await new Promise((res) => setTimeout(res, 200));
  assert.throws(() => process.kill(pid, 0), /ESRCH/, "process is gone");
  assert.equal((await fetch(`${base}/api/runs/${info.id}/stop`, { method: "POST", headers: { authorization: `Bearer ${token}`, "x-superos": "1" } })).status, 200);
  assert.equal((await fetch(`${base}/api/runs/zzzzzzzz-00000000/stop`, { method: "POST", headers: { authorization: `Bearer ${token}`, "x-superos": "1" } })).status, 404);
});

test("a failed run reports why", async () => {
  const info = await startOk({ text: "why did FAIL happen?" });
  const end = await finished(info.id);
  assert.equal(end.status, "failed");
  assert.match(end.error ?? "", /budget cap/);
});

test("live events arrive over server-sent events, then the stream closes", async () => {
  const info = await startOk({ text: "how is it going?" });
  const res = await fetch(`${base}/api/runs/${info.id}/events`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  const body = await res.text(); // ends when the run ends
  const events = body.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)) as RunEvent);
  assert.ok(events.some((e) => e.type === "text"));
  assert.equal(events.at(-1)?.type, "status");
  assert.equal((await fetch(`${base}/api/runs/${info.id}/events`)).status, 401, "events need a session too");
});

test("T3 deliverables are copied to outputs/ with the naming rule, never overwritten", async () => {
  const first = await startOk({ text: T3("DELIVER"), confirm: true });
  const a = await finished(first.id);
  assert.equal(a.status, "done");
  assert.equal(a.deliverables.length, 1);
  assert.match(a.deliverables[0]!, /^outputs\/\d{4}-\d{2}\/\d{4}-\d{2}-\d{2}_general_write-a-short-summary-report-about\.md$/);
  const second = await startOk({ text: T3("DELIVER"), confirm: true });
  const b = await finished(second.id);
  assert.match(b.deliverables[0]!, /-v2\.md$/, "second copy is versioned");
  assert.equal(readFileSync(path.join(vault, a.deliverables[0]!), "utf8"), "# Report\nMade by the stand-in.\n", "first copy untouched");
  assert.ok(existsSync(path.join(vault, "outputs", "_work", first.id, "report.md")), "the work folder keeps the original");
});

test("only one T3 at a time", async () => {
  const hang = await startOk({ text: T3("HANG"), confirm: true });
  const second = await run({ text: T3("again"), confirm: true });
  assert.equal(second.status, 429);
  bridge.runs.stop(hang.id);
  assert.equal((await finished(hang.id)).status, "stopped");
  const third = await startOk({ text: T3("after"), confirm: true });
  assert.equal((await finished(third.id)).status, "done", "control: a T3 starts once the slot is free");
});

test("a missing Claude CLI fails the run with a clear message", async () => {
  const b = createBridge(path.join(makeVault(), "os"), { claudeBin: { cmd: "/no/such/claude-binary", prefixArgs: [] }, logDir: logs });
  const info = b.runs.start({ text: "what?", tier: "T2" });
  const end = await new Promise<RunEvent & { type: "status" }>((resolve) => { b.runs.subscribe(info.id, (e) => { if (e.type === "status") resolve(e); }); });
  assert.equal(end.status, "failed");
  assert.match(end.error ?? "", /Could not start Claude Code/);
});

test("naming helpers", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "names-"));
  assert.equal(deliverableName(dir, "2026-11-19", "ai", "x", ".md"), "2026-11-19_ai_x.md");
  writeFileSync(path.join(dir, "2026-11-19_ai_x.md"), "");
  writeFileSync(path.join(dir, "2026-11-19_ai_x-v2.md"), "");
  assert.equal(deliverableName(dir, "2026-11-19", "ai", "x", ".md"), "2026-11-19_ai_x-v3.md");
  assert.equal(slugify("../../etc/passwd; DROP TABLE"), "etc-passwd-drop-table");
  assert.equal(slugify("!!!"), "run");
  assert.equal(readdirSync(dir).length, 2);
});
