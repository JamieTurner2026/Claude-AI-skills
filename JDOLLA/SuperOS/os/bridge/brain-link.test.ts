// Second brain in runs: the CLI gets only the superos-brain server and only its two read-only tools,
// the index is kept fresh, and a failure to build it never blocks a run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRAIN_SERVER_SCRIPT, BRAIN_TOOLS, BrainLink } from "./brain-link.ts";
import { buildClaudeArgs } from "./claude-args.ts";
import { loadConfig, pathsFor, saveConfig } from "./config.ts";
import { builtinDenyRules } from "./deny-rules.ts";
import { makeVault } from "./fixture.ts";
import { defaultClaudeBin } from "./runs.ts";
import type { RunEvent } from "./runs.ts";
import { createBridge } from "./server.ts";

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-claude.ts");
const brainVault = () => {
  const vault = makeVault();
  mkdirSync(path.join(vault, "wiki/industrial"), { recursive: true });
  writeFileSync(path.join(vault, "wiki/industrial/servo.md"), "# Servo alarms\nServo alarm 42 means overcurrent on the drive.\n");
  return vault;
};
const flag = (argv: string[], f: string) => argv[argv.indexOf(f) + 1];

test("args: the brain adds one server, its two read-only tools and a hint; nothing else", () => {
  const p = pathsFor(path.join(makeVault(), "os"));
  const config = loadConfig(p);
  const base = { tier: "T2" as const, text: "hi", budgetUsd: 0.05, vault: p.vault, workDir: "/w", t3Tools: ["Read"] as const, deny: builtinDenyRules(p.vault), sandbox: { available: false, reason: "t" } };
  const off = buildClaudeArgs(base, config).args;
  assert.ok(!off.includes("--mcp-config") && !off.includes("--allowedTools"), "control: no brain, no MCP flags");
  const on = buildClaudeArgs({ ...base, brainMcpConfig: '{"mcpServers":{}}' }, config).args;
  assert.equal(flag(on, "--mcp-config"), '{"mcpServers":{}}');
  assert.equal(flag(on, "--allowedTools"), BRAIN_TOOLS.join(","));
  assert.ok(on.includes("--strict-mcp-config"), "no other MCP server can load");
  assert.ok(!/\b(Read|Write|Edit|Bash|Grep|Glob)\b/.test(flag(on, "--allowedTools")!), "no file or shell tool is pre-approved");
  assert.equal(flag(on, "--tools"), "Read,Glob,Grep", "T2 stays read-only");
  assert.match(flag(on, "--append-system-prompt")!, /superos-brain search/);
});

test("through the bridge: a run gets the brain config and a freshly built index", async (t) => {
  const vault = brainVault();
  const logs = mkdtempSync(path.join(tmpdir(), "brain-logs-"));
  const b = createBridge(path.join(vault, "os"), { claudeBin: { cmd: process.execPath, prefixArgs: [fake] }, logDir: logs });
  t.after(() => b.runs.stopAll());
  const info = b.runs.start({ text: "what is a servo alarm?", tier: "T2" });
  await new Promise<void>((r) => { b.runs.subscribe(info.id, (e: RunEvent) => { if (e.type === "status") r(); }); });
  const argv = JSON.parse(/ARGV:(.*)/.exec(b.runs.get(info.id)!.output)![1]!) as string[];
  const cfg = JSON.parse(flag(argv, "--mcp-config")!) as { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> };
  assert.deepEqual(Object.keys(cfg.mcpServers), ["superos-brain"]);
  const s = cfg.mcpServers["superos-brain"]!;
  assert.equal(s.command, process.execPath);
  assert.equal(s.args[0], BRAIN_SERVER_SCRIPT);
  assert.ok(statSync(BRAIN_SERVER_SCRIPT).isFile());
  assert.equal(s.env["SUPEROS_VAULT"], vault);
  assert.equal(s.env["SUPEROS_BRAIN_DB"], path.join(logs, "brain-index.sqlite"));
  assert.ok(statSync(path.join(logs, "brain-index.sqlite")).size > 0, "index built before the run");
});

test("switched off in config: no brain", async (t) => {
  const vault = brainVault();
  const p = pathsFor(path.join(vault, "os"));
  saveConfig(p, { ...loadConfig(p), engine: { ...loadConfig(p).engine, brain: { enabled: false } } });
  const b = createBridge(p.os, { claudeBin: { cmd: process.execPath, prefixArgs: [fake] }, logDir: mkdtempSync(path.join(tmpdir(), "x-")) });
  t.after(() => b.runs.stopAll());
  const info = b.runs.start({ text: "what?", tier: "T2" });
  await new Promise<void>((r) => { b.runs.subscribe(info.id, (e: RunEvent) => { if (e.type === "status") r(); }); });
  assert.ok(!b.runs.get(info.id)!.output.includes("--mcp-config"));
});

test("an index that can't be built never blocks the run", async (t) => {
  const vault = brainVault();
  const blocker = path.join(mkdtempSync(path.join(tmpdir(), "y-")), "file");
  writeFileSync(blocker, "not a folder");
  const b = createBridge(path.join(vault, "os"), { claudeBin: { cmd: process.execPath, prefixArgs: [fake] }, logDir: mkdtempSync(path.join(tmpdir(), "z-")), brainDbPath: path.join(blocker, "index.sqlite") });
  t.after(() => b.runs.stopAll());
  const info = b.runs.start({ text: "what?", tier: "T2" });
  const end = await new Promise<RunEvent & { type: "status" }>((r) => { b.runs.subscribe(info.id, (e) => { if (e.type === "status") r(e); }); });
  assert.equal(end.status, "done", "the run still ran");
  assert.ok(!b.runs.get(info.id)!.output.includes("--mcp-config"), "without the brain");
});

test("the index is rebuilt only when missing or stale", () => {
  const vault = brainVault();
  const db = path.join(mkdtempSync(path.join(tmpdir(), "fresh-")), "i.sqlite");
  let now = Date.now();
  const kinds: string[] = [];
  const link = new BrainLink({ paths: pathsFor(path.join(vault, "os")), dbPath: db, log: (l) => kinds.push(String(l["kind"])), now: () => now });
  assert.equal(link.ensureFresh(), true);
  assert.equal(kinds.filter((k) => k === "brain-index").length, 1, "built when missing");
  now += 60_000;
  link.ensureFresh();
  assert.equal(kinds.filter((k) => k === "brain-index").length, 1, "fresh: not rebuilt a minute later");
  now += 10 * 60_000;
  link.ensureFresh();
  assert.equal(kinds.filter((k) => k === "brain-index").length, 2, "stale after 5 minutes: rebuilt");
});

test("the exact server a run would get starts, lists two tools and finds a note", async () => {
  const vault = brainVault();
  const link = new BrainLink({ paths: pathsFor(path.join(vault, "os")), dbPath: path.join(mkdtempSync(path.join(tmpdir(), "mcp-")), "i.sqlite"), log: () => undefined });
  assert.ok(link.ensureFresh());
  const s = (JSON.parse(link.mcpConfig()) as { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> }).mcpServers["superos-brain"]!;
  const child = spawn(s.command, s.args, { env: { ...process.env, ...s.env }, stdio: ["pipe", "pipe", "ignore"] });
  const lines: Array<{ id?: number; result?: any }> = [];
  let buf = "";
  child.stdout.on("data", (d: Buffer) => { buf += d.toString(); let i; while ((i = buf.indexOf("\n")) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const send = (o: object) => child.stdin.write(JSON.stringify(o) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search", arguments: { query: "servo alarm" } } });
  for (let i = 0; i < 100 && lines.length < 3; i++) await new Promise((r) => setTimeout(r, 50));
  child.kill();
  const tools = lines.find((l) => l.id === 2)!.result.tools.map((t: { name: string }) => t.name);
  assert.deepEqual(tools, ["search", "get_note"]);
  assert.deepEqual(BRAIN_TOOLS.map((t) => t.split("__")[2]), tools, "pre-approved names match the server's tools");
  const hits = JSON.parse(lines.find((l) => l.id === 3)!.result.content[0].text) as { count: number; hits: { path: string }[] };
  assert.ok(hits.count > 0);
  assert.equal(hits.hits[0]!.path, "wiki/industrial/servo.md");
});

test("claudeBin pointing at a .js file runs it with this Node (Windows npm installs)", () => {
  const config = loadConfig(pathsFor(path.join(makeVault(), "os")));
  assert.deepEqual(defaultClaudeBin({ ...config, engine: { ...config.engine, claudeBin: "C:\\npm\\cli.js" } }, "win32"), { cmd: process.execPath, prefixArgs: ["C:\\npm\\cli.js"] });
  assert.deepEqual(defaultClaudeBin(config, "win32"), { cmd: "claude.exe", prefixArgs: [] });
  assert.deepEqual(defaultClaudeBin(config, "linux"), { cmd: "claude", prefixArgs: [] });
});
