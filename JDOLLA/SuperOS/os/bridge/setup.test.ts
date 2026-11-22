// The Setup checklist: GET /api/setup, its fact collectors, the autostart marker it reads, and the widget's tick logic.
// Every refusal or "todo" sits next to a control that is "done".
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { isDone, readTicks, TICKS_KEY } from "../app/widgets/setup.ts";
import { runAutostart } from "./autostart.ts";
import type { Env, Runner } from "./autostart.ts";
import type { Check } from "./doctor.ts";
import { makeVault } from "./fixture.ts";
import { createBridge } from "./server.ts";
import { autostartFact, buildSetup, countSessionNotes, feedFacts } from "./setup.ts";
import type { SetupFacts } from "./setup.ts";
import type { SetupRow, SetupView } from "../shared/types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fake = path.join(here, "fake-claude.ts");
const chk = (id: string, status: Check["status"]): Check => ({ id, label: id, status, detail: "d", ...(status === "pass" ? {} : { fix: "f" }) });
const ALL = ["node", "claude", "env", "vault", "logs", "port", "brain", "embeddings", "sandbox", "scheduler", "backup"];
const doctor = (over: Record<string, Check["status"]> = {}): Check[] => ALL.map((id) => chk(id, over[id] ?? "pass"));
const facts = (over: Partial<SetupFacts> = {}): SetupFacts => ({ doctor: doctor(), embeddings: true, sessions: 4, autostart: "installed", feeds: { mail: true, calendar: true }, ...over });
const rowOf = (v: SetupView, id: string): SetupRow => v.rows.find((r) => r.id === id)!;

test("buildSetup: the seven rows in order, each with a PC-SETUP section; everything in place is done except the manual row", () => {
  const v = buildSetup(facts());
  assert.deepEqual(v.rows.map((r) => [r.id, r.section]), [["doctor", "§3.2"], ["tests", "§3.3"], ["embeddings", "§5.2"], ["sessions", "§5.3"], ["autostart", "§6b"], ["backup", "§10.1"], ["feeds", "§13.2"]]);
  assert.deepEqual(v.rows.map((r) => r.state), ["done", "manual", "done", "done", "done", "done", "done"]);
  assert.deepEqual([v.done, v.total], [6, 7]);
  assert.ok(v.rows.every((r) => r.hint.length > 0 && r.label.length > 0));
});

test("doctor row: a failing check is todo; warnings alone are done; the port, embeddings and backup rows don't count against it; no doctor is todo", () => {
  assert.equal(rowOf(buildSetup(facts()), "doctor").state, "done");
  const failing = rowOf(buildSetup(facts({ doctor: doctor({ node: "fail", vault: "fail" }) })), "doctor");
  assert.deepEqual([failing.state, /^2 checks failing/.test(failing.hint)], ["todo", true]);
  const warns = rowOf(buildSetup(facts({ doctor: doctor({ scheduler: "warn", sandbox: "warn" }) })), "doctor");
  assert.deepEqual([warns.state, warns.hint], ["done", "No failures. 2 optional warnings left."]);
  assert.equal(rowOf(buildSetup(facts({ doctor: doctor({ port: "warn", embeddings: "warn", backup: "warn" }) })), "doctor").hint, "All checks pass.", "the bridge itself holds the port; the others have their own rows");
  assert.equal(rowOf(buildSetup(facts({ doctor: doctor({ backup: "fail" }) })), "doctor").state, "done", "a backup FAIL shows on the backup row, not twice");
  assert.equal(rowOf(buildSetup(facts({ doctor: null })), "doctor").state, "todo");
});

test("tests row is always manual; embeddings, sessions and feeds are done or todo from their facts", () => {
  assert.equal(rowOf(buildSetup(facts()), "tests").state, "manual");
  assert.equal(rowOf(buildSetup(facts({ embeddings: false })), "embeddings").state, "todo");
  assert.equal(rowOf(buildSetup(facts({ sessions: 0 })), "sessions").state, "todo");
  assert.equal(rowOf(buildSetup(facts({ feeds: { mail: true, calendar: false } })), "feeds").hint, "One of the two feed files is missing.");
  assert.equal(rowOf(buildSetup(facts({ feeds: { mail: true, calendar: false } })), "feeds").state, "todo");
  assert.equal(rowOf(buildSetup(facts({ feeds: { mail: false, calendar: false } })), "feeds").state, "todo");
});

test("autostart row: installed is done; only shown is todo with the second-run hint (shown is NOT installed); none is todo; not Windows is manual", () => {
  assert.equal(rowOf(buildSetup(facts({ autostart: "installed" })), "autostart").state, "done");
  const shown = rowOf(buildSetup(facts({ autostart: "shown" })), "autostart");
  assert.deepEqual([shown.state, /again to install/.test(shown.hint)], ["todo", true]);
  assert.equal(rowOf(buildSetup(facts({ autostart: "none" })), "autostart").state, "todo");
  assert.equal(rowOf(buildSetup(facts({ autostart: "not-windows" })), "autostart").state, "manual");
});

test("backup row follows the doctor's backup row: pass is done; warn and fail are todo (fail says to fix the public-repo problem first)", () => {
  assert.equal(rowOf(buildSetup(facts()), "backup").state, "done");
  assert.equal(rowOf(buildSetup(facts({ doctor: doctor({ backup: "warn" }) })), "backup").state, "todo");
  const f = rowOf(buildSetup(facts({ doctor: doctor({ backup: "fail" }) })), "backup");
  assert.deepEqual([f.state, /public repo/.test(f.hint)], ["todo", true]);
  assert.equal(rowOf(buildSetup(facts({ doctor: null })), "backup").state, "todo");
});

test("collectors: sessions count real notes only (links, dot entries and other files don't count); feeds need real, valid files", () => {
  const v = mkdtempSync(path.join(tmpdir(), "setup-vault-"));
  assert.equal(countSessionNotes(v), 0, "no folder");
  mkdirSync(path.join(v, "raw/sessions/proj"), { recursive: true });
  writeFileSync(path.join(v, "raw/sessions/proj/.hidden.md"), "x");
  writeFileSync(path.join(v, "raw/sessions/proj/image.png"), "x");
  const out = mkdtempSync(path.join(tmpdir(), "setup-out-"));
  writeFileSync(path.join(out, "n.md"), "x");
  symlinkSync(path.join(out, "n.md"), path.join(v, "raw/sessions/proj/link.md"));
  symlinkSync(out, path.join(v, "raw/sessions/linkdir"));
  assert.equal(countSessionNotes(v), 0, "none of those count");
  writeFileSync(path.join(v, "raw/sessions/proj/s1.md"), "session");
  assert.equal(countSessionNotes(v), 1, "control: a real note counts");
  const f = mkdtempSync(path.join(tmpdir(), "setup-feeds-"));
  assert.deepEqual(feedFacts(f), { mail: false, calendar: false });
  mkdirSync(path.join(f, "inbox/_feeds"), { recursive: true });
  writeFileSync(path.join(f, "inbox/_feeds/mail.json"), JSON.stringify({ messages: [] }));
  writeFileSync(path.join(f, "inbox/_feeds/calendar.json"), "{broken");
  assert.deepEqual(feedFacts(f), { mail: true, calendar: false }, "a broken file is not 'present'");
  writeFileSync(path.join(f, "inbox/_feeds/calendar.json"), JSON.stringify({ events: [] }));
  assert.deepEqual(feedFacts(f), { mail: true, calendar: true });
  const g = mkdtempSync(path.join(tmpdir(), "setup-feeds-"));
  mkdirSync(path.join(g, "inbox/_feeds"), { recursive: true });
  writeFileSync(path.join(out, "mail.json"), JSON.stringify({ messages: [] }));
  symlinkSync(path.join(out, "mail.json"), path.join(g, "inbox/_feeds/mail.json"));
  assert.equal(feedFacts(g).mail, false, "a linked feed file is not present");
});

test("autostart marker: `npm run autostart` writes 'installed' only after Task Scheduler accepted the task, and `remove` clears it; autostartFact reads it", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "setup-auto-"));
  const env: Env = { platform: "win32", osDir: "C:\\os", nodePath: "C:\\node.exe", user: "Jay", domain: "PC", systemRoot: "C:\\Windows", home: dir, stateFile: path.join(dir, ".superos", "autostart.json"), tmp: dir };
  const ok: Runner = () => ({ status: 0, stdout: "", stderr: "" });
  const refuse: Runner = () => ({ status: 1, stdout: "", stderr: "denied" });
  const out = () => undefined;
  assert.equal(autostartFact(env.stateFile, "win32"), "none");
  runAutostart(["install"], env, ok, out);
  assert.equal(autostartFact(env.stateFile, "win32"), "shown", "first run only shows the plan");
  runAutostart(["install"], env, refuse, out);
  assert.equal(autostartFact(env.stateFile, "win32"), "shown", "a refused install is not installed");
  runAutostart(["install"], env, ok, out);
  assert.equal(autostartFact(env.stateFile, "win32"), "installed");
  assert.equal(JSON.parse(readFileSync(env.stateFile, "utf8")).installed, true);
  assert.equal(autostartFact(env.stateFile, "linux"), "not-windows");
  runAutostart(["remove"], env, refuse, out);
  assert.equal(autostartFact(env.stateFile, "win32"), "installed", "a failed remove changes nothing");
  runAutostart(["remove"], env, ok, out);
  assert.equal(autostartFact(env.stateFile, "win32"), "shown", "removed: back to 'plan shown'");
  writeFileSync(env.stateFile, "{broken");
  assert.equal(autostartFact(env.stateFile, "win32"), "none");
});

async function setup(over: { doctor?: () => Promise<Check[]>; platform?: string } = {}) {
  const vault = makeVault();
  const logs = mkdtempSync(path.join(tmpdir(), "setup-logs-"));
  const home = mkdtempSync(path.join(tmpdir(), "setup-home-"));
  mkdirSync(path.join(vault, "raw/sessions"), { recursive: true });
  writeFileSync(path.join(vault, "raw/sessions/s1.md"), "SESSIONBODYSECRET");
  mkdirSync(path.join(vault, "inbox/_feeds"), { recursive: true });
  writeFileSync(path.join(vault, "inbox/_feeds/mail.json"), JSON.stringify({ messages: [{ id: "m", from: "FEEDSECRET <a@example.com>", subject: "s", date: "2026-11-22T10:00:00-05:00", labels: ["Brain"] }] }));
  writeFileSync(path.join(vault, "inbox/_feeds/calendar.json"), JSON.stringify({ events: [] }));
  const stateFile = path.join(home, "autostart.json");
  writeFileSync(stateFile, JSON.stringify({ shown: "abc", installed: true }));
  const calls = { doctor: 0 };
  const b = createBridge(path.join(vault, "os"), {
    claudeBin: { cmd: process.execPath, prefixArgs: [fake] }, logDir: logs, brainDbPath: path.join(logs, "brain.sqlite"),
    setup: { doctor: over.doctor ?? (async () => { calls.doctor++; return doctor(); }), autostartStateFile: stateFile, platform: over.platform ?? "win32" },
  });
  await new Promise<void>((r) => b.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(b.server.address() as AddressInfo).port}`;
  const token = b.mint();
  const get = (headers: Record<string, string> = { authorization: `Bearer ${token}` }) => fetch(base + "/api/setup", { headers });
  return { b, vault, logs, home, base, token, get, calls, close: () => { b.runs.stopAll(); b.server.close(); } };
}

test("GET /api/setup: no session is refused (control: a session is served); a foreign Origin and other methods are refused", async (t) => {
  const e = await setup(); t.after(e.close);
  assert.equal((await e.get({})).status, 401, "no session");
  assert.equal((await e.get({ authorization: "Bearer 1.2.3" })).status, 401, "a bad token");
  assert.equal((await e.get({ authorization: `Bearer ${e.token}`, origin: "http://evil.example" })).status, 403);
  const post = await fetch(e.base + "/api/setup", { method: "POST", headers: { authorization: `Bearer ${e.token}`, "content-type": "application/json", "x-superos": "1" }, body: "{}" });
  assert.equal(post.status, 405);
  const ok = await e.get({ authorization: `Bearer ${e.token}`, origin: e.base });
  assert.equal(ok.status, 200, "control");
  const v = (await ok.json()) as SetupView;
  assert.deepEqual(v.rows.map((r) => r.id), ["doctor", "tests", "embeddings", "sessions", "autostart", "backup", "feeds"]);
  assert.deepEqual([rowOf(v, "sessions").state, rowOf(v, "feeds").state, rowOf(v, "autostart").state, rowOf(v, "embeddings").state, rowOf(v, "doctor").state], ["done", "done", "done", "todo", "done"]);
});

test("GET /api/setup shows only states, fixed hints and §: no path, URL, address or file content", async (t) => {
  const e = await setup(); t.after(e.close);
  const text = await (await e.get()).text();
  for (const secret of ["SESSIONBODYSECRET", "FEEDSECRET", "example.com", e.vault, e.logs, e.home, "inbox/_feeds/mail", "autostart.json", "http://", "https://", "C:\\"]) assert.ok(!text.includes(secret), `no ${secret.slice(0, 24)}`);
  const v = JSON.parse(text) as SetupView;
  assert.deepEqual(Object.keys(v).sort(), ["done", "rows", "total"]);
  for (const r of v.rows) {
    assert.deepEqual(Object.keys(r).sort(), ["hint", "id", "label", "section", "state"]);
    assert.match(r.section, /^§\d+(\.\d+|b)?$/);
    assert.ok(["done", "todo", "manual"].includes(r.state));
  }
});

test("the doctor's checks are cached for a minute (two requests, one run); a doctor that throws makes the row todo, not an error", async (t) => {
  const e = await setup(); t.after(e.close);
  await e.get(); await e.get();
  assert.equal(e.calls.doctor, 1);
  const broken = await setup({ doctor: async () => { throw new Error("boom"); } }); t.after(broken.close);
  const r = await broken.get();
  assert.equal(r.status, 200);
  assert.equal(rowOf((await r.json()) as SetupView, "doctor").state, "todo");
});

test("the route reflects real state: embeddings in the brain index, no sessions, no feeds, a failing doctor", async (t) => {
  const e = await setup({ doctor: async () => doctor({ node: "fail" }), platform: "linux" }); t.after(e.close);
  const d = new DatabaseSync(path.join(e.logs, "brain.sqlite"));
  d.exec("CREATE TABLE vectors (key TEXT PRIMARY KEY, model TEXT NOT NULL, dim INTEGER NOT NULL, vec BLOB NOT NULL)");
  d.prepare("INSERT INTO vectors VALUES ('k','m',3,x'00')").run();
  d.close();
  rmAll(path.join(e.vault, "raw/sessions"), path.join(e.vault, "inbox/_feeds"));
  const v = (await (await e.get()).json()) as SetupView;
  assert.deepEqual(v.rows.map((r) => r.state), ["todo", "manual", "done", "todo", "manual", "done", "todo"], "doctor todo (one failing check), embeddings done, sessions and feeds gone, backup follows the doctor's backup row (pass here)");
});
function rmAll(...dirs: string[]): void { for (const d of dirs) rmSync(d, { recursive: true, force: true }); }

test("widget tick logic: manual ticks come from localStorage only, survive garbage and a throwing storage, and count toward 'all done'", () => {
  const g = globalThis as { localStorage?: unknown };
  const saved = g.localStorage;
  try {
    const store: Record<string, string> = {};
    g.localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } };
    assert.deepEqual(readTicks(), {});
    store[TICKS_KEY] = JSON.stringify({ tests: true, autostart: false, "bad key!": true, x: "yes" });
    assert.deepEqual(readTicks(), { tests: true }, "only true values under plain ids");
    for (const junk of ["{broken", "[1]", "null", "7", '"s"']) { store[TICKS_KEY] = junk; assert.deepEqual(readTicks(), {}, junk); }
    g.localStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    assert.deepEqual(readTicks(), {}, "storage that throws");
    delete g.localStorage;
    assert.deepEqual(readTicks(), {}, "no storage at all");
  } finally { g.localStorage = saved; }
  const manual: SetupRow = { id: "tests", label: "t", state: "manual", section: "§3.3", hint: "h" };
  assert.equal(isDone(manual, {}), false);
  assert.equal(isDone(manual, { tests: true }), true, "ticked");
  assert.equal(isDone({ ...manual, state: "todo" }, { tests: true }), false, "a tick never turns a todo row done");
  assert.equal(isDone({ ...manual, state: "done" }, {}), true);
});

test("the widget is registered, laid out, styled in the neon blue theme and hides itself when everything is done", () => {
  const app = path.join(here, "..", "app");
  assert.match(readFileSync(path.join(app, "widgets", "registry.ts"), "utf8"), /setup/);
  assert.ok(JSON.parse(readFileSync(path.join(here, "..", "config", "os.config.json"), "utf8")).layout.some((l: { widget: string }) => l.widget === "setup"));
  const css = readFileSync(path.join(app, "styles.css"), "utf8");
  assert.ok(/\.su-mark\.ok\s*\{[^}]*var\(--accent\)/.test(css) && /\.su-sec\s*\{[^}]*var\(--accent\)/.test(css) && /\.widget\[hidden\]\s*\{\s*display:\s*none/.test(css));
  const src = readFileSync(path.join(app, "widgets", "setup.ts"), "utf8");
  assert.ok(/sec\.hidden = done === v\.rows\.length/.test(src) && !/innerHTML/.test(src));
  assert.ok(/ctx\.api\.open\("docs\/PC-SETUP\.md"\)/.test(src), "the § opens the local PC-SETUP through the bridge");
});
