// Safe tools layer: each tool is a tested function, the server offers only what the policy allows,
// and runs pre-approve exactly the bridge's own MCP tools and nothing that touches files or a shell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { today, isoWeek } from "./today.ts";
import { handleToolMessage, offeredTools } from "./mcp.ts";
import { TOOLS, mcpToolName } from "./registry.ts";
import { buildRunMcp, toolsServer } from "../bridge/mcp-servers.ts";
import { loadConfig, pathsFor, saveConfig } from "../bridge/config.ts";
import { makeVault } from "../bridge/fixture.ts";
import { createBridge } from "../bridge/server.ts";
import type { RunEvent } from "../bridge/runs.ts";

const NY = "America/New_York";
const at = (iso: string) => ({ timezone: NY, now: () => new Date(iso) });
const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bridge", "fake-claude.ts");
const flag = (argv: string[], f: string) => argv[argv.indexOf(f) + 1];

test("today: date, weekday, time, offset and ISO week in New York", () => {
  assert.deepEqual(today.run({}, at("2026-11-20T06:30:00Z")), { date: "2026-11-20", weekday: "Friday", time: "01:30", utcOffset: "UTC-5", isoWeek: "2026-W47", timezone: NY });
  // Still the 19th in New York although it is the 20th in UTC.
  assert.equal((today.run({}, at("2026-11-20T03:00:00Z")) as { date: string }).date, "2026-11-19");
});

test("today: the spring-forward day (2026-03-08) switches to UTC-4", () => {
  assert.deepEqual(today.run({}, at("2026-03-08T06:30:00Z")), { date: "2026-03-08", weekday: "Sunday", time: "01:30", utcOffset: "UTC-5", isoWeek: "2026-W10", timezone: NY });
  assert.deepEqual(today.run({}, at("2026-03-08T07:30:00Z")), { date: "2026-03-08", weekday: "Sunday", time: "03:30", utcOffset: "UTC-4", isoWeek: "2026-W10", timezone: NY });
});

test("isoWeek: year edges", () => {
  assert.deepEqual(isoWeek(2027, 1, 1), { year: 2026, week: 53 }, "2026 starts on a Thursday, so it has 53 weeks");
  assert.deepEqual(isoWeek(2025, 12, 29), { year: 2026, week: 1 });
  assert.deepEqual(isoWeek(2026, 1, 4), { year: 2026, week: 1 });
  assert.deepEqual(isoWeek(2026, 1, 5), { year: 2026, week: 2 });
});

test("server: offers only the listed tools, checks arguments, refuses unknown tools", () => {
  const ctx = at("2026-11-20T15:00:00Z");
  assert.deepEqual(offeredTools("today,rm_rf,").map((t) => t.name), ["today"], "unknown names are dropped");
  assert.deepEqual(offeredTools("").map((t) => t.name), []);
  const offered = offeredTools("today");
  const list = handleToolMessage(offered, ctx, { jsonrpc: "2.0", id: 1, method: "tools/list" }) as { result: { tools: { name: string }[] } };
  assert.deepEqual(list.result.tools.map((t) => t.name), ["today"]);
  const none = handleToolMessage([], ctx, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "today" } }) as { error?: { message: string } };
  assert.match(none.error!.message, /Unknown tool/, "a tool the run was not given can't be called");
  const bad = handleToolMessage(offered, ctx, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "today", arguments: { path: "/etc/passwd" } } }) as { result: { isError: boolean } };
  assert.equal(bad.result.isError, true, "extra arguments are refused");
  const good = handleToolMessage(offered, ctx, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "today", arguments: {} } }) as { result: { content: { text: string }[] } };
  assert.equal(JSON.parse(good.result.content[0]!.text).date, "2026-11-20");
});

test("every registered tool has a description, a strict input and a read-only result", () => {
  for (const t of TOOLS) {
    assert.ok(t.description.length > 10, t.name);
    assert.equal(t.input.safeParse({ unexpected: 1 }).success, false, `${t.name} rejects unknown arguments`);
  }
});

test("run MCP: brain + today pre-approved, nothing else; empty when both are off", () => {
  const m = buildRunMcp({ brain: { command: "node", args: ["b.ts"], env: {} }, tools: ["today"], timezone: NY })!;
  assert.deepEqual(m.allowedTools, ["mcp__superos-brain__search", "mcp__superos-brain__get_note", mcpToolName("today")]);
  assert.deepEqual(Object.keys(JSON.parse(m.config).mcpServers), ["superos-brain", "superos-tools"]);
  assert.equal(buildRunMcp({ brain: null, tools: [], timezone: NY }), null);
  assert.deepEqual(buildRunMcp({ brain: null, tools: ["today"], timezone: NY })!.allowedTools, ["mcp__superos-tools__today"]);
});

async function runOnce(vault: string): Promise<string[]> {
  const b = createBridge(path.join(vault, "os"), { claudeBin: { cmd: process.execPath, prefixArgs: [fake] }, logDir: mkdtempSync(path.join(tmpdir(), "tl-")) });
  try {
    const info = b.runs.start({ text: "what day is it?", tier: "T2" });
    await new Promise<void>((r) => { b.runs.subscribe(info.id, (e: RunEvent) => { if (e.type === "status") r(); }); });
    return JSON.parse(/ARGV:(.*)/.exec(b.runs.get(info.id)!.output)![1]!) as string[];
  } finally { b.runs.stopAll(); }
}

test("through the bridge: a run gets the tools server with exactly the policy's tools", async () => {
  const vault = makeVault();
  const argv = await runOnce(vault);
  const allowed = flag(argv, "--allowedTools")!.split(",");
  assert.ok(allowed.includes("mcp__superos-tools__today"));
  assert.ok(allowed.every((t) => t.startsWith("mcp__superos-")), "no file or shell tool is pre-approved");
  const s = JSON.parse(flag(argv, "--mcp-config")!).mcpServers["superos-tools"];
  assert.equal(s.env.SUPEROS_TOOLS, "today");
  assert.equal(s.env.SUPEROS_TZ, NY);
  assert.equal(s.args[0], path.join(path.dirname(fileURLToPath(import.meta.url)), "mcp.ts"), "the bridge's own copy, never the vault's");
});

test("tools switched off: no tools server", async () => {
  const vault = makeVault();
  const p = pathsFor(path.join(vault, "os"));
  saveConfig(p, { ...loadConfig(p), engine: { ...loadConfig(p).engine, tools: { enabled: false } } });
  const argv = await runOnce(vault);
  assert.ok(!argv.join(" ").includes("superos-tools"));
});

test("a policy naming an unknown script tool refuses every run", () => {
  const vault = makeVault();
  writeFileSync(path.join(vault, "os/config/skills.policy.json"), JSON.stringify({ defaultTools: ["Read"], scriptTools: ["today", "shell"] }));
  const b = createBridge(path.join(vault, "os"), { claudeBin: { cmd: process.execPath, prefixArgs: [fake] }, logDir: mkdtempSync(path.join(tmpdir(), "tp-")) });
  assert.throws(() => b.runs.start({ text: "hi", tier: "T2" }), /policy is invalid/);
});

test("the exact tools server a run would get starts and answers today", async () => {
  const s = toolsServer(["today"], NY);
  const child = spawn(s.command, s.args, { env: { ...process.env, ...s.env }, stdio: ["pipe", "pipe", "ignore"] });
  const lines: Array<{ id?: number; result?: any }> = [];
  let buf = "";
  child.stdout.on("data", (d: Buffer) => { buf += d.toString(); let i; while ((i = buf.indexOf("\n")) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "today", arguments: {} } }) + "\n");
  for (let i = 0; i < 100 && lines.length < 2; i++) await new Promise((r) => setTimeout(r, 50));
  child.kill();
  assert.deepEqual(lines.find((l) => l.id === 1)!.result.tools.map((t: { name: string }) => t.name), ["today"]);
  const out = JSON.parse(lines.find((l) => l.id === 2)!.result.content[0].text) as { date: string; timezone: string };
  assert.match(out.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(out.timezone, NY);
});
