// Step (g) containment tests: policy, deny rules, sandbox gate, and blocked tool calls.
// Each "refused" check sits next to a control that must pass.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { readFileSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ContainmentError, buildClaudeArgs } from "./claude-args.ts";
import { loadConfig, pathsFor } from "./config.ts";
import { absRule, allDenyRules, builtinDenyRules, rewriteRule, vaultDenyRules } from "./deny-rules.ts";
import { makeVault } from "./fixture.ts";
import { PolicyError, loadPolicy, t3Tools } from "./policy.ts";
import { detectSandbox } from "./sandbox.ts";
import type { SandboxStatus } from "./sandbox.ts";
import type { RunEvent, RunInfo } from "./runs.ts";
import { createBridge } from "./server.ts";
import { argvFromOutput } from "./fake-argv.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fake = path.join(here, "fake-claude.ts");
const NO_SANDBOX: SandboxStatus = { available: false, reason: "no sandbox in test" };
const SANDBOX: SandboxStatus = { available: true, reason: "test sandbox" };

test("rules are rewritten to absolute paths; non-path rules kept", () => {
  assert.equal(rewriteRule("Edit(/os/**)", "/v/ault"), "Edit(//v/ault/os/**)");
  assert.equal(rewriteRule("Read(/**/.env*)", "/v/ault"), "Read(//v/ault/**/.env*)");
  assert.equal(rewriteRule("Write(secrets/**)", "/v/ault"), "Write(//v/ault/secrets/**)", "relative rule pinned to the vault");
  assert.equal(rewriteRule("Bash(rm -rf *)", "/v/ault"), "Bash(rm -rf *)");
  assert.equal(rewriteRule("Read(//etc/**)", "/v/ault"), "Read(//etc/**)");
  assert.equal(rewriteRule("Read(~/.ssh/**)", "/v/ault"), "Read(~/.ssh/**)");
  assert.equal(absRule("C:\\Users\\jay\\JDOLLA\\SuperOS"), "//C:/Users/jay/JDOLLA/SuperOS", "Windows path as text (unverified on Windows)");
});

test("the real vault's settings.json is restated with absolute paths", () => {
  const vault = path.resolve(here, "../..");
  const rules = vaultDenyRules(vault);
  const v = absRule(vault);
  assert.ok(rules.includes(`Edit(${v}/os/**)`) && rules.includes(`Write(${v}/os/**)`));
  assert.ok(rules.includes("Bash(rm -rf *)"));
  assert.ok(!rules.some((r) => /^(Edit|Write|Read)\(\/[^/]/.test(r)), "no project-relative path rule is left");
  assert.ok(allDenyRules(vault).length > rules.length, "built-in rules are added on top");
});

test("missing or broken vault settings fail closed", () => {
  const vault = makeVault();
  assert.ok(vaultDenyRules(vault).length > 0, "control: fixture settings load");
  for (const bad of ["{not json", JSON.stringify({}), JSON.stringify({ permissions: { deny: "Edit(/os/**)" } })]) {
    writeFileSync(path.join(vault, ".claude/settings.json"), bad);
    assert.throws(() => vaultDenyRules(vault), PolicyError, bad);
  }
  rmSync(path.join(vault, ".claude/settings.json"));
  assert.throws(() => vaultDenyRules(vault), PolicyError);
});

test("skill policy grants tools by exact name only", () => {
  const p = pathsFor(path.join(makeVault(), "os"));
  const policy = loadPolicy(p);
  assert.deepEqual(t3Tools(policy), ["Read", "Glob", "Grep", "Write", "Edit"], "control: defaults");
  assert.deepEqual(t3Tools(policy, "builder"), ["Read", "Glob", "Grep", "Write", "Edit", "Bash"]);
  assert.deepEqual(t3Tools(policy, "unknown-skill"), ["Read", "Glob", "Grep", "Write", "Edit"]);
  for (const bad of [{ defaultTools: ["Read", "Shell"], skills: {} }, { defaultTools: [], skills: {} }, { defaultTools: ["Read"], skills: {}, extra: 1 }, { defaultTools: ["Read"], skills: { "../x": { tools: [] } } }]) {
    writeFileSync(path.join(p.os, "config/skills.policy.json"), JSON.stringify(bad));
    assert.throws(() => loadPolicy(p), PolicyError, JSON.stringify(bad));
  }
  rmSync(path.join(p.os, "config/skills.policy.json"));
  assert.throws(() => loadPolicy(p), PolicyError);
});

test("sandbox detection follows Claude Code's platform rules", () => {
  assert.equal(detectSandbox("darwin").available, true);
  assert.equal(detectSandbox("linux", () => true).available, true);
  const linux = detectSandbox("linux", (c) => c === "socat");
  assert.equal(linux.available, false); assert.match(linux.reason, /bwrap/);
  const win = detectSandbox("win32", () => true);
  assert.equal(win.available, false); assert.match(win.reason, /WSL2/);
});

test("Bash only with a sandbox, and the sandbox can't fall back to unsandboxed", () => {
  const p = pathsFor(path.join(makeVault(), "os"));
  const config = loadConfig(p);
  const base = { tier: "T3" as const, text: "build it", budgetUsd: 1, vault: p.vault, workDir: "/w", deny: builtinDenyRules(p.vault) };
  const plain = buildClaudeArgs({ ...base, t3Tools: ["Read", "Write"], sandbox: NO_SANDBOX }, config);
  assert.ok(!JSON.parse(plain.args[plain.args.indexOf("--settings") + 1]!).sandbox, "control: no Bash, no sandbox block needed");
  assert.throws(() => buildClaudeArgs({ ...base, t3Tools: ["Read", "Bash"], sandbox: NO_SANDBOX }, config), ContainmentError);
  const withBash = buildClaudeArgs({ ...base, t3Tools: ["Read", "Bash"], sandbox: SANDBOX }, config);
  assert.equal(withBash.args[withBash.args.indexOf("--tools") + 1], "Read,Bash");
  const sb = JSON.parse(withBash.args[withBash.args.indexOf("--settings") + 1]!).sandbox as Record<string, unknown>;
  assert.equal(sb["enabled"], true); assert.equal(sb["failIfUnavailable"], true); assert.equal(sb["allowUnsandboxedCommands"], false);
  const t2 = buildClaudeArgs({ ...base, tier: "T2", t3Tools: ["Read", "Bash"], sandbox: SANDBOX }, config);
  assert.equal(t2.args[t2.args.indexOf("--tools") + 1], "Read,Glob,Grep", "T2 stays read-only whatever the policy says");
  assert.throws(() => buildClaudeArgs({ ...base, deny: [], t3Tools: ["Read"], sandbox: NO_SANDBOX }, config), ContainmentError, "no rules, no run");
});

test("through the bridge: refused runs start nothing; blocked tool calls are recorded", async (t) => {
  const vault = makeVault();
  const logs = mkdtempSync(path.join(tmpdir(), "contain-logs-"));
  let sandbox = NO_SANDBOX;
  const b = createBridge(path.join(vault, "os"), { claudeBin: { cmd: process.execPath, prefixArgs: [fake] }, logDir: logs, sandbox: () => sandbox });
  await new Promise<void>((r) => b.server.listen(0, "127.0.0.1", r));
  t.after(() => { b.runs.stopAll(); b.server.close(); });
  const base = `http://127.0.0.1:${(b.server.address() as net.AddressInfo).port}`;
  const run = (body: unknown) => fetch(base + "/api/run", { method: "POST", headers: { "content-type": "application/json", "x-superos": "1", authorization: `Bearer ${b.mint()}` }, body: JSON.stringify(body) });
  const finished = (id: string) => new Promise<RunEvent & { type: "status" }>((resolve) => { b.runs.subscribe(id, (e) => { if (e.type === "status") resolve(e); }); });
  const work = "write a short summary report about the vault";

  // A skill that needs Bash, no sandbox: refused, nothing started.
  const noSb = await run({ text: work, confirm: true, skill: "builder" });
  assert.equal(noSb.status, 400); assert.match(((await noSb.json()) as { error: string }).error, /sandbox/);
  assert.equal(b.runs.list().length, 0);
  // Control: the same skill with a sandbox starts, and the CLI gets Bash plus the no-fallback settings.
  sandbox = SANDBOX;
  const ok = await run({ text: work, confirm: true, skill: "builder" });
  assert.equal(ok.status, 202);
  const info = ((await ok.json()) as { run: RunInfo }).run;
  await finished(info.id);
  const argv = argvFromOutput(b.runs.get(info.id)!.output);
  assert.ok(argv[argv.indexOf("--tools") + 1]!.split(",").includes("Bash"));
  assert.equal(JSON.parse(argv[argv.indexOf("--settings") + 1]!).sandbox.allowUnsandboxedCommands, false);
  assert.ok((JSON.parse(argv[argv.indexOf("--settings") + 1]!).permissions.deny as string[]).includes(`Edit(${absRule(vault)}/os/**)`), "vault rules reach the CLI");

  // A blocked tool call is recorded on the run, sent as an event and logged.
  const tryEnv = await run({ text: "what is in TRYENV?" });
  const tInfo = ((await tryEnv.json()) as { run: RunInfo }).run;
  const events: RunEvent[] = [];
  await new Promise<void>((resolve) => { b.runs.subscribe(tInfo.id, (e) => { events.push(e); if (e.type === "status") resolve(); }); });
  assert.ok(events.some((e) => e.type === "denied" && e.tool === "Read"));
  assert.equal(b.runs.get(tInfo.id)!.denied.length, 1);
  assert.ok(readFileSync(path.join(logs, "router.jsonl"), "utf8").split("\n").some((l) => l.includes(tInfo.id) && l.includes('"denied":1')));

  // Broken policy: every run is refused.
  writeFileSync(path.join(vault, "os/config/skills.policy.json"), "{");
  const broken = await run({ text: "what is a servo?" });
  assert.equal(broken.status, 400); assert.match(((await broken.json()) as { error: string }).error, /policy/);
});
