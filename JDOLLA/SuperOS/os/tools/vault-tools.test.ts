// The vault tools together: the shared scanner's safety rules, the registry and policy wiring, and what a skill's run is allowed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeVault } from "../bridge/fixture.ts";
import { loadPolicy, scriptToolsFor } from "../bridge/policy.ts";
import { pathsFor } from "../bridge/config.ts";
import { buildRunMcp, toolsServer } from "../bridge/mcp-servers.ts";
import { createBridge } from "../bridge/server.ts";
import type { RunEvent } from "../bridge/runs.ts";
import { handleToolMessage, offeredTools } from "./mcp.ts";
import { SCRIPT_TOOL_NAMES, TOOLS, mcpToolName } from "./registry.ts";
import { MAX_SCAN_FILES, scanVault } from "./vault.ts";
import { NY, SECRETS, makeToolVault, put, text } from "./vault-fixture.ts";
import { argvFromOutput } from "../bridge/fake-argv.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const realOs = path.resolve(here, "..");
const fake = path.join(realOs, "bridge", "fake-claude.ts");

test("registry: every tool is named once, read-only in shape, strict about arguments, and in the policy's name list", () => {
  assert.deepEqual(TOOLS.map((t) => t.name), [...SCRIPT_TOOL_NAMES]);
  assert.deepEqual([...SCRIPT_TOOL_NAMES], ["today", "recent_changes", "link_check", "vault_stats", "list_reports", "proposals_summary"]);
  for (const t of TOOLS) {
    assert.equal((t.inputSchema as { additionalProperties?: boolean }).additionalProperties, false, `${t.name} schema forbids extra arguments`);
    assert.equal(t.input.safeParse({ unexpected: 1, days: 1, limit: 1 }).success, false, t.name);
  }
});

test("scanVault: lists regular files in the known folders only; links, dot entries, os/, logs/, raw/sessions and outputs/_work are never listed", () => {
  const { vault } = makeToolVault();
  const { files } = scanVault(vault);
  const all = files.map((f) => f.rel);
  assert.ok(all.includes("wiki/software/a.md") && all.includes("raw/software/charter/b.md"), "control: normal files are listed");
  for (const bad of [".env", "wiki/.env", "wiki/software/.hidden.md", "os/secret.md", "logs/run.md", "raw/sessions/s.md", "outputs/_work/abc/scratch.md", "wiki/link.md", "reports/linkreport.md"]) assert.ok(!all.includes(bad), bad);
  assert.ok(!all.some((p) => p.startsWith("wiki/linkdir")), "a linked folder is not entered");
  assert.ok(all.every((p) => p === p.replace(/\\/g, "/")), "posix paths");
});

test("scanVault: a top-level folder that is a link is not followed; the vault folder itself may be a link", () => {
  const { vault, outside } = makeToolVault();
  put(outside, "wikidir/n.md", "x");
  rmSync(path.join(vault, "wiki"), { recursive: true, force: true });
  symlinkSync(path.join(outside, "wikidir"), path.join(vault, "wiki"));
  assert.ok(!scanVault(vault).files.some((f) => f.top === "wiki"), "wiki/ was replaced by a link out: nothing from it");
  const root = path.dirname(vault);
  const viaLink = path.join(root, "vault-link");
  symlinkSync(vault, viaLink);
  assert.ok(scanVault(viaLink).files.some((f) => f.top === "raw"), "control: a vault reached through a link still works");
});

test("scanVault: capped, and says so", () => {
  const { vault } = makeToolVault();
  assert.equal(scanVault(vault).truncated, false);
  assert.ok(MAX_SCAN_FILES >= 1000);
});

test("a tools server with no vault cannot answer a vault tool (and does not guess one)", () => {
  const ctx = { timezone: NY, now: () => new Date("2026-11-16T15:00:00Z"), vault: "" };
  const r = handleToolMessage(offeredTools("list_reports"), ctx, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_reports", arguments: { limit: 3 } } }) as { result: { isError: boolean; content: { text: string }[] } };
  assert.deepEqual([r.result.isError, r.result.content[0]?.text], [true, "That tool could not answer."]);
  assert.equal(offeredTools("today,link_check").length, 2);
  assert.deepEqual(offeredTools("rm_rf,list_reports").map((t) => t.name), ["list_reports"], "unknown names are still dropped");
});

test("the exact tools server a run gets starts over stdio and answers a vault tool from SUPEROS_VAULT", async () => {
  const { vault } = makeToolVault();
  const s = toolsServer(["today", "list_reports", "vault_stats"], NY, vault);
  assert.equal(s.env.SUPEROS_VAULT, vault);
  const child = spawn(s.command, s.args, { env: { ...process.env, ...s.env }, stdio: ["pipe", "pipe", "ignore"] });
  const lines: Array<{ id?: number; result?: any; error?: { message: string } }> = [];
  let buf = "";
  child.stdout.on("data", (d: Buffer) => { buf += d.toString(); let i; while ((i = buf.indexOf("\n")) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const send = (o: object) => child.stdin.write(JSON.stringify(o) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_reports", arguments: { limit: 2 } } });
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "link_check", arguments: {} } }); // not offered to this run
  send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "vault_stats", arguments: { dept: "ai" } } }); // extra argument
  for (let i = 0; i < 100 && lines.length < 4; i++) await new Promise((r) => setTimeout(r, 50));
  child.kill();
  assert.deepEqual(lines.find((l) => l.id === 1)!.result.tools.map((t: { name: string }) => t.name), ["today", "vault_stats", "list_reports"]);
  const reports = JSON.parse(lines.find((l) => l.id === 2)!.result.content[0].text) as { reports: { name: string }[]; total: number };
  assert.deepEqual([reports.reports.length, reports.total], [2, 4]);
  assert.equal(lines.find((l) => l.id === 3)!.error?.message ?? lines.find((l) => l.id === 3)!.result?.content?.[0]?.text, "Unknown tool: link_check");
  assert.equal(lines.find((l) => l.id === 4)!.result.isError, true);
});

test("policy: the default script tools stay [today]; each skill is given exactly the vault tools it needs, by name", () => {
  const policy = loadPolicy(pathsFor(realOs));
  assert.deepEqual(policy.scriptTools, ["today"]);
  const want: Record<string, string[]> = {
    "vault-cleanup": ["link_check", "vault_stats"],
    "plan-today": ["recent_changes", "list_reports"],
    "morning-intel": ["recent_changes", "list_reports"],
    "project-intelligence": ["recent_changes", "vault_stats"],
    "knowledge-improvement": ["recent_changes"],
  };
  for (const [skill, extra] of Object.entries(want)) assert.deepEqual(scriptToolsFor(policy, skill), ["today", ...extra], skill);
  for (const skill of ["code-quality", "security-review", "game-testing", "industrial-training-sim", "creative-critic", "content-cascade", "weekly-review", "not-a-skill"]) {
    assert.deepEqual(scriptToolsFor(policy, skill), ["today"], `${skill} gets only today`);
  }
  for (const entry of Object.values(policy.skills)) assert.ok(!entry.tools.includes("Bash"), "nothing here grants Bash");
});

async function argvFor(skill: string | undefined): Promise<{ argv: string[]; vault: string }> {
  const vault = makeVault();
  writeFileSync(path.join(vault, "os/config/skills.policy.json"), readFileSync(path.join(realOs, "config/skills.policy.json"), "utf8"));
  const b = createBridge(path.join(vault, "os"), { claudeBin: { cmd: process.execPath, prefixArgs: [fake] }, logDir: mkdtempSync(path.join(tmpdir(), "vt-")) });
  try {
    const info = b.runs.start({ text: "hello", tier: "T2", ...(skill ? { skill } : {}) });
    await new Promise<void>((r) => { b.runs.subscribe(info.id, (e: RunEvent) => { if (e.type === "status" && e.status !== "running") r(); }); });
    return { argv: argvFromOutput(b.runs.get(info.id)!.output), vault };
  } finally { b.runs.stopAll(); }
}

test("through the bridge: a skill's run is allowed exactly its tools, and the tools server is told the vault", async () => {
  const brain = ["mcp__superos-brain__search", "mcp__superos-brain__get_note"];
  const cases: Array<[string | undefined, string[]]> = [
    ["vault-cleanup", ["today", "link_check", "vault_stats"]],
    ["plan-today", ["today", "recent_changes", "list_reports"]],
    ["morning-intel", ["today", "recent_changes", "list_reports"]],
    ["project-intelligence", ["today", "recent_changes", "vault_stats"]],
    ["knowledge-improvement", ["today", "recent_changes"]],
    ["code-quality", ["today"]],
    [undefined, ["today"]],
  ];
  for (const [skill, tools] of cases) {
    const { argv, vault } = await argvFor(skill);
    const flag = (f: string) => argv[argv.indexOf(f) + 1]!;
    assert.deepEqual(flag("--allowedTools").split(","), [...brain, ...tools.map(mcpToolName)], `${skill ?? "no skill"}: allowed tools`);
    const server = JSON.parse(flag("--mcp-config")).mcpServers["superos-tools"] as { env: Record<string, string> };
    assert.equal(server.env["SUPEROS_TOOLS"], tools.join(","), `${skill ?? "no skill"}: tools server list`);
    assert.equal(server.env["SUPEROS_VAULT"], vault);
    assert.equal(flag("--tools"), "Read,Glob,Grep", "still read-only");
    for (const forbidden of ["link_check", "list_reports", "recent_changes", "vault_stats"]) if (!tools.includes(forbidden)) assert.ok(!flag("--allowedTools").includes(forbidden), `${skill ?? "no skill"} must not be allowed ${forbidden}`);
  }
});

test("buildRunMcp passes the vault and only the named tools", () => {
  const m = buildRunMcp({ brain: null, tools: ["today", "link_check"], timezone: NY, vault: "/the/vault" })!;
  assert.deepEqual(m.allowedTools, ["mcp__superos-tools__today", "mcp__superos-tools__link_check"]);
  assert.equal(JSON.parse(m.config).mcpServers["superos-tools"].env.SUPEROS_VAULT, "/the/vault");
});

test("no tool ever returns a secret, a body, a link target's contents or an outside file, whatever it is asked", () => {
  const { ctx } = makeToolVault();
  const calls: Array<[string, object]> = [["recent_changes", { days: 60 }], ["recent_changes", { days: 60, dept: "ai" }], ["link_check", {}], ["vault_stats", {}], ["list_reports", { limit: 50 }]];
  for (const [name, args] of calls) {
    const tool = TOOLS.find((t) => t.name === name)!;
    const out = text(tool.run(tool.input.parse(args), ctx));
    for (const s of SECRETS) assert.ok(!out.includes(s), `${name} leaked ${s}`);
    assert.ok(out.length < 25_000, `${name} answer is capped (${out.length})`);
  }
});
