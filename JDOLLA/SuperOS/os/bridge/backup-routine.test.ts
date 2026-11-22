// The vault-backup routine through the bridge: no model, $0, refuses plainly until a private remote is named,
// and the Health strip shows the last result. Real git, a temp vault, a local bare repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FORBIDDEN, WANTED, git, put, tmp, tree } from "../backup/fixture.ts";
import { MSG_NO_REMOTE } from "../backup/remote.ts";
import { healthWarnings } from "../shared/health.ts";
import type { HealthView } from "../shared/health.ts";
import { loadConfig, pathsFor, saveConfig } from "./config.ts";
import { makeVault } from "./fixture.ts";
import { RoutineRunner } from "./routine-runner.ts";
import type { RunManager } from "./runs.ts";
import { createBridge } from "./server.ts";

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-claude.ts");
const AT_2340 = new Date("2026-11-23T04:40:30Z"); // Sunday 23:40:30 in New York
const ENTRY = { id: "vault-backup", name: "Vault backup", schedule: "daily 23:40", enabled: false, builtin: "vault-backup" };

type Result = { status: string; note: string; costUsd: number | null; runId: string | null };
async function setup(opts: { remote?: string; enabled?: boolean } = {}) {
  const vault = makeVault();
  const logs = mkdtempSync(path.join(tmpdir(), "bk-logs-"));
  writeFileSync(path.join(vault, "routines/routines.json"), JSON.stringify([{ ...ENTRY, enabled: opts.enabled === true }]));
  if (opts.remote !== undefined) {
    const p = pathsFor(path.join(vault, "os"));
    const c = loadConfig(p);
    saveConfig(p, { ...c, engine: { ...c.engine, backup: { remote: opts.remote, branch: "main" } } });
    git(vault, "init", "-q", "-b", "main");
    git(vault, "config", "user.name", "T"); git(vault, "config", "user.email", "t@example.com"); git(vault, "config", "commit.gpgsign", "false");
    for (const f of FORBIDDEN) put(vault, f, `SECRET ${f}\n`);
  }
  const b = createBridge(path.join(vault, "os"), { claudeBin: { cmd: process.execPath, prefixArgs: [fake] }, logDir: logs, now: () => AT_2340, backupOptions: { allowFileRemote: true } });
  await new Promise<void>((r) => b.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(b.server.address() as AddressInfo).port}`;
  const token = b.mint();
  const hdr = { "content-type": "application/json", "x-superos": "1", authorization: `Bearer ${token}`, origin: base };
  const post = (p: string, body: unknown = {}) => fetch(base + p, { method: "POST", headers: hdr, body: JSON.stringify(body) });
  const health = async () => (await (await fetch(base + "/api/health", { headers: { authorization: `Bearer ${token}` } })).json()) as HealthView;
  const result = async (): Promise<Result> => {
    for (let i = 0; i < 400; i++) {
      const r = b.routines.status().routines.find((x) => x.id === "vault-backup")?.lastResult as Result | null | undefined;
      if (r && r.status !== "running") return r;
      await new Promise((res) => setTimeout(res, 25));
    }
    throw new Error("the backup never finished");
  };
  const ledger = () => JSON.parse(readFileSync(path.join(logs, "routine-ledger.json"), "utf8")) as { lastRunAt: Record<string, string>; spend: Record<string, number> };
  return { b, vault, logs, post, health, result, ledger, close: () => { b.runs.stopAll(); b.server.close(); } };
}

test("the shipped vault-backup routine: daily 23:40, switched off, built in (no skill, no tier, no model)", () => {
  const list = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "routines", "routines.json"), "utf8")) as Array<Record<string, unknown>>;
  const r = list.find((x) => x["id"] === "vault-backup");
  assert.deepEqual(r, { id: "vault-backup", name: "Vault backup", schedule: "daily 23:40", enabled: false, builtin: "vault-backup" });
});

test("Run now with no remote named: refused in plain words, $0, no model run, nothing created; the strip shows 'refused' and warns", async (t) => {
  const e = await setup(); t.after(e.close);
  const before = (await e.health()).backup;
  assert.equal(before, null, "never run");
  const res = await e.post("/api/routines/vault-backup/run");
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { run: null });
  const r = await e.result();
  assert.deepEqual([r.status, r.note, r.costUsd, r.runId], ["skipped", MSG_NO_REMOTE.slice(0, 300), 0, null]);
  assert.equal(e.b.runs.list().length, 0, "no model run was started");
  assert.equal(Object.values(e.ledger().spend).reduce((a, b) => a + b, 0), 0, "nothing was reserved against the daily cap");
  assert.ok(!existsSync(path.join(e.vault, ".git")), "it did not git init the vault");
  const h = await e.health();
  assert.equal(h.backup?.status, "refused");
  assert.deepEqual(healthWarnings(h).filter((w) => /backup/i.test(w)), ["Last backup was refused"]);
  assert.ok(!JSON.stringify(h).includes("Name the private"), "the strip carries a one-word result, not the message text");
});

test("with a private remote named and the vault a git repo, Run now backs up the allowed files and the strip says 'pushed'", async (t) => {
  const remote = tmp("bk-remote-"); git(remote, "init", "-q", "--bare", "-b", "main");
  const e = await setup({ remote }); t.after(e.close);
  const res = await e.post("/api/routines/vault-backup/run");
  assert.equal(res.status, 202);
  const r = await e.result();
  assert.equal(r.status, "done", r.note);
  assert.match(r.note, /^Backed up \d+ changed files?/);
  const files = tree(remote, "main");
  assert.ok(files.includes("wiki/software/a.md") || files.some((f) => f.startsWith("wiki/")), "notes were pushed");
  for (const f of FORBIDDEN) assert.ok(!files.includes(f), `${f} stayed home`);
  assert.ok(!files.some((f) => f.startsWith("os/.env") || f.startsWith("logs/")));
  assert.ok(WANTED.length > 0);
  const h = await e.health();
  assert.equal(h.backup?.status, "pushed");
  assert.deepEqual(healthWarnings(h).filter((w) => /backup/i.test(w)), []);
  assert.equal(e.b.runs.list().length, 0, "still no model run");
  assert.equal(Object.values(e.ledger().spend).reduce((a, b) => a + b, 0), 0);
});

test("the scheduler runs it at 23:40 only when switched on, once per slot; switched off it never runs (control)", async (t) => {
  const off = await setup(); t.after(off.close);
  assert.deepEqual(await off.b.routines.tick(AT_2340), [], "disabled: not due");
  assert.equal(off.b.routines.status().routines[0]!.lastResult, null);
  const remote = tmp("bk-remote-"); git(remote, "init", "-q", "--bare", "-b", "main");
  const on = await setup({ remote, enabled: true }); t.after(on.close);
  assert.deepEqual(await on.b.routines.tick(AT_2340), ["vault-backup"]);
  assert.equal((await on.result()).status, "done");
  const commits = git(remote, "rev-list", "--count", "main").out.trim();
  assert.deepEqual(await on.b.routines.tick(new Date(AT_2340.getTime() + 60_000)), [], "the slot is used up");
  assert.equal(git(remote, "rev-list", "--count", "main").out.trim(), commits);
  assert.deepEqual(await on.b.routines.tick(new Date(AT_2340.getTime() - 3 * 3600_000)), [], "and not due at 20:40");
});

test("a built-in routine never runs twice at once and an unknown handler is refused", async () => {
  const vault = makeVault();
  writeFileSync(path.join(vault, "routines/routines.json"), JSON.stringify([{ ...ENTRY, enabled: true }]));
  const logs = mkdtempSync(path.join(tmpdir(), "bk-logs-"));
  const p = pathsFor(path.join(vault, "os"));
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let calls = 0;
  const mk = (builtins?: Record<string, (n: Date) => Promise<{ status: string; message: string }>>) => new RoutineRunner({ paths: p, config: () => loadConfig(p), runs: {} as RunManager, logDir: logs, log: () => undefined, schedulerOn: false, ...(builtins ? { builtins } : {}) });
  const slow = mk({ "vault-backup": async () => { calls++; await gate; return { status: "pushed", message: "ok" }; } });
  assert.equal(slow.runNow("vault-backup", AT_2340), null);
  assert.throws(() => slow.runNow("vault-backup", AT_2340), /already running/);
  assert.equal(calls, 1);
  release();
  for (let i = 0; i < 100 && slow.status().routines[0]!.lastResult?.status === "running"; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(slow.status().routines[0]!.lastResult?.status, "done");
  assert.equal(slow.runNow("vault-backup", AT_2340), null, "control: once finished it can run again");
  for (let i = 0; i < 100 && slow.status().routines[0]!.lastResult?.status === "running"; i++) await new Promise((r) => setTimeout(r, 10));
  assert.throws(() => mk().runNow("vault-backup", AT_2340), /not available/);
  const crash = mk({ "vault-backup": async () => { throw new Error("boom"); } });
  crash.runNow("vault-backup", AT_2340);
  for (let i = 0; i < 100 && crash.status().routines[0]!.lastResult?.status === "running"; i++) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual([crash.status().routines[0]!.lastResult?.status, crash.status().routines[0]!.lastResult?.note], ["failed", "It stopped unexpectedly."]);
});

test("the Health strip and the Routines widget carry the backup line", () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app");
  const main = readFileSync(path.join(dir, "main.ts"), "utf8");
  const routines = readFileSync(path.join(dir, "widgets", "routines.ts"), "utf8");
  assert.ok(/chip\("Backup", v\.backup \?/.test(main) && /"never run"/.test(main) && /v\.backup\?\.status === "failed" \|\| v\.backup\?\.status === "refused"/.test(main));
  assert.ok(routines.includes("built in · no model · $0") && routines.includes("res.run ?"));
});
