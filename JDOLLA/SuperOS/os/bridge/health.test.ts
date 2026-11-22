// 9b status check: GET /api/health, `npm run status` and the dashboard strip's rules. Every refusal sits beside a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import net from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INDEX_WARN_SEC, SPEND_WARN_PCT, formatAge, formatHealth, healthWarnings } from "../shared/health.ts";
import type { HealthView } from "../shared/health.ts";
import { makeVault } from "./fixture.ts";
import { brainHealth } from "./health.ts";
import { createBridge } from "./server.ts";
import { checkStatus } from "./status.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fake = path.join(here, "fake-claude.ts");

const healthy = (over: Partial<HealthView> = {}): HealthView => ({
  ok: true, version: "0.2.0", uptimeSec: 3600,
  scheduler: { on: true, routinesOn: 3, routinesTotal: 5 }, spend: { todayUsd: 0.2, capUsd: 2, pct: 10 },
  lastRun: { status: "done", tier: "T2", at: "2026-11-22T12:00:00Z" },
  brain: { present: true, indexAgeSec: 600, stale: false, embeddings: true, embeddedChunks: 42 }, proposals: { pending: 2 }, backup: null, ...over,
});

async function setup() {
  const vault = makeVault();
  const logs = mkdtempSync(path.join(tmpdir(), "health-logs-"));
  const brainDb = path.join(logs, "brain-index.sqlite");
  writeFileSync(path.join(vault, "os/.env"), "SUPEROS_ROUTER_KEY=ENVSECRET\n");
  writeFileSync(path.join(vault, "wiki/software/body.md"), "---\ntitle: T\ndept: software\n---\nNOTEBODYSECRET\n");
  const b = createBridge(path.join(vault, "os"), { claudeBin: { cmd: process.execPath, prefixArgs: [fake] }, logDir: logs, brainDbPath: brainDb });
  await new Promise<void>((r) => b.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(b.server.address() as net.AddressInfo).port}`;
  const token = b.mint();
  const get = (p = "/api/health", headers: Record<string, string> = { authorization: `Bearer ${token}` }) => fetch(base + p, { headers });
  return { b, vault, logs, brainDb, base, token, get, close: () => { b.runs.stopAll(); b.server.close(); } };
}

test("warnings: scheduler off, index over a day old, spend over 80%; a healthy report has none (control)", () => {
  assert.deepEqual(healthWarnings(healthy()), []);
  assert.deepEqual(healthWarnings(healthy({ scheduler: { on: false, routinesOn: 0, routinesTotal: 5 } })), ["Scheduler is off"]);
  assert.match(healthWarnings(healthy({ brain: { present: true, indexAgeSec: INDEX_WARN_SEC + 1, stale: false, embeddings: false, embeddedChunks: 0 } }))[0]!, /over 1 day old/);
  assert.deepEqual(healthWarnings(healthy({ brain: { present: true, indexAgeSec: INDEX_WARN_SEC, stale: false, embeddings: false, embeddedChunks: 0 } })), [], "exactly a day is not over a day");
  assert.match(healthWarnings(healthy({ spend: { todayUsd: 1.7, capUsd: 2, pct: 85 } }))[0]!, /85%/);
  assert.deepEqual(healthWarnings(healthy({ spend: { todayUsd: 1.6, capUsd: 2, pct: SPEND_WARN_PCT } })), [], "exactly 80% is not over");
  assert.deepEqual(healthWarnings(healthy({ brain: { present: false, indexAgeSec: null, stale: false, embeddings: false, embeddedChunks: 0 } })), [], "no index yet is not an old index");
  assert.equal(healthWarnings(healthy({ scheduler: { on: false, routinesOn: 0, routinesTotal: 0 }, spend: { todayUsd: 2, capUsd: 2, pct: 100 } })).length, 2);
});

test("backup in the strip: a failed or refused backup warns; pushed, nothing and never-run do not; the table has a Backup row", () => {
  const at = "2026-11-22T12:00:00Z";
  assert.deepEqual(healthWarnings(healthy({ backup: { at, status: "failed" } })), ["Last backup failed"]);
  assert.deepEqual(healthWarnings(healthy({ backup: { at, status: "refused" } })), ["Last backup was refused"]);
  for (const status of ["pushed", "nothing"] as const) assert.deepEqual(healthWarnings(healthy({ backup: { at, status } })), [], status);
  assert.deepEqual(healthWarnings(healthy({ backup: null })), []);
  assert.match(formatHealth(healthy({ backup: { at, status: "pushed" } }), new Date("2026-11-22T15:00:00Z")), /^Backup\s+pushed, 3h ago$/m);
  assert.match(formatHealth(healthy()), /^Backup\s+never run$/m);
});

test("formatHealth is a short table; formatAge picks a sensible unit", () => {
  const t = formatHealth(healthy({ scheduler: { on: false, routinesOn: 0, routinesTotal: 5 } }), new Date("2026-11-22T12:10:00Z"));
  for (const must of [/^Bridge\s+running, version 0\.2\.0, up 60m$/m, /^Scheduler\s+OFF$/m, /^Routines\s+0 of 5 on$/m, /\$0\.20 of \$2\.00 \(10%\)/, /done \(T2\), 10m ago/, /10m old/, /present \(42 chunks\)/, /^Proposals\s+2 pending$/m, /^WARNING: Scheduler is off$/m]) assert.match(t, must);
  assert.deepEqual([formatAge(5), formatAge(300), formatAge(7200), formatAge(400_000)], ["5s", "5m", "2h", "5d"]);
  assert.ok(formatHealth(healthy({ lastRun: null, brain: { present: false, indexAgeSec: null, stale: false, embeddings: false, embeddedChunks: 0 } })).includes("none yet"));
});

test("brainHealth: missing index, a real index with and without vectors, and the stale mark", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bh-"));
  const db = path.join(dir, "index.sqlite");
  const now = Date.now();
  assert.deepEqual(brainHealth(db, now), { present: false, indexAgeSec: null, stale: false, embeddings: false, embeddedChunks: 0 });
  const d = new DatabaseSync(db);
  d.exec("CREATE TABLE meta (key TEXT)");
  d.close();
  utimesSync(db, new Date(now - 2 * 3600_000), new Date(now - 2 * 3600_000));
  const noVec = brainHealth(db, now);
  assert.deepEqual([noVec.present, noVec.embeddings, noVec.embeddedChunks, noVec.stale], [true, false, 0, false]);
  assert.ok(Math.abs((noVec.indexAgeSec as number) - 7200) < 5);
  const d2 = new DatabaseSync(db);
  d2.exec("CREATE TABLE vectors (key TEXT PRIMARY KEY, model TEXT NOT NULL, dim INTEGER NOT NULL, vec BLOB NOT NULL)");
  d2.prepare("INSERT INTO vectors VALUES ('k1','m',3,x'00'),('k2','m',3,x'00')").run();
  d2.close();
  utimesSync(db, new Date(now - 2 * 3600_000), new Date(now - 2 * 3600_000));
  assert.deepEqual([brainHealth(db, now).embeddings, brainHealth(db, now).embeddedChunks], [true, 2]);
  utimesSync(db, 0, 0); // what markStale() does
  assert.deepEqual([brainHealth(db, now).stale, brainHealth(db, now).indexAgeSec], [true, null], "a stale mark is not an old index");
  writeFileSync(db, "not a database");
  utimesSync(db, new Date(now - 60_000), new Date(now - 60_000));
  assert.deepEqual([brainHealth(db, now).present, brainHealth(db, now).embeddings], [true, false], "a damaged index never throws");
});

test("GET /api/health: no session is refused, a session is served (control); foreign Origin and other methods are refused", async (t) => {
  const e = await setup(); t.after(e.close);
  assert.equal((await e.get("/api/health", {})).status, 401, "no session");
  assert.equal((await e.get("/api/health", { authorization: "Bearer 1.2.3" })).status, 401, "a bad token");
  assert.equal((await e.get("/api/health", { authorization: `Bearer ${e.token}`, origin: "http://evil.example" })).status, 403, "foreign origin");
  const post = await fetch(e.base + "/api/health", { method: "POST", headers: { authorization: `Bearer ${e.token}`, "content-type": "application/json", "x-superos": "1" }, body: "{}" });
  assert.equal(post.status, 405);
  const ok = await e.get(undefined, { authorization: `Bearer ${e.token}`, origin: e.base });
  assert.equal(ok.status, 200, "control: a session from our own origin");
  const h = (await ok.json()) as HealthView;
  assert.deepEqual([h.ok, h.scheduler.on, h.proposals.pending, h.lastRun, h.brain.present], [true, false, 0, null, false]);
  assert.equal(typeof h.version, "string");
  assert.ok(h.spend.capUsd > 0 && h.spend.pct === 0);
});

test("health reads real state: last run, pending proposals, index age and embeddings", async (t) => {
  const e = await setup(); t.after(e.close);
  const run = e.b.runs.start({ tier: "T2", text: "FAIL please" });
  await new Promise<void>((r) => e.b.runs.subscribe(run.id, (ev) => { if (ev.type === "status" && ev.status !== "running") r(); }));
  for (let i = 0; i < 200 && e.b.learning.list().some((p) => p.diagnosis.status === "running"); i++) await new Promise((r) => setTimeout(r, 25));
  const d = new DatabaseSync(e.brainDb);
  d.exec("CREATE TABLE vectors (key TEXT PRIMARY KEY, model TEXT NOT NULL, dim INTEGER NOT NULL, vec BLOB NOT NULL)");
  d.prepare("INSERT INTO vectors VALUES ('k1','m',3,x'00')").run();
  d.close();
  const h = (await (await e.get()).json()) as HealthView;
  assert.equal(h.lastRun?.status, "failed", "the learning loop's diagnosis run is not counted as the last run");
  assert.equal(h.lastRun?.tier, "T2");
  assert.ok(h.proposals.pending >= 1, "the failed run made a proposal");
  assert.deepEqual([h.brain.present, h.brain.embeddings, h.brain.embeddedChunks, h.brain.stale], [true, true, 1, false]);
  assert.ok((h.brain.indexAgeSec as number) < 60);
});

test("health never shows a note body, a path, a prompt or a setting's value", async (t) => {
  const e = await setup(); t.after(e.close);
  const run = e.b.runs.start({ tier: "T2", text: "RUNPROMPTSECRET please FAIL" });
  await new Promise<void>((r) => e.b.runs.subscribe(run.id, (ev) => { if (ev.type === "status" && ev.status !== "running") r(); }));
  const text = await (await e.get()).text();
  for (const secret of ["NOTEBODYSECRET", "ENVSECRET", "RUNPROMPTSECRET", e.vault, e.logs, e.brainDb, "SUPEROS_ROUTER_KEY", ".env", "wiki/software"]) assert.ok(!text.includes(secret), `no ${secret.slice(0, 20)}`);
  assert.ok(!/[\\/]/.test(text.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "")), "no path separators at all");
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ["backup", "brain", "lastRun", "ok", "proposals", "scheduler", "spend", "uptimeSec", "version"]);
});

test("npm run status: a running bridge gives the table and exit 0; a refused session and a bad answer give exit 2", async (t) => {
  const e = await setup(); t.after(e.close);
  const r = await checkStatus(e.base, () => e.token);
  assert.equal(r.code, 0);
  assert.match(r.text, /^Bridge\s+running, version/);
  assert.match(r.text, /Scheduler\s+OFF/);
  const refused = await checkStatus(e.base, () => "1.2.3");
  assert.equal(refused.code, 2);
  assert.match(refused.text, /refused this session/);
  const odd = http_server((_req, res) => { res.setHeader("content-type", "application/json"); res.end(_req.url === "/healthz" ? "{}" : '{"ok":true,"weird":1}'); });
  await new Promise<void>((r2) => odd.listen(0, "127.0.0.1", r2));
  t.after(() => odd.close());
  const out = await checkStatus(`http://127.0.0.1:${(odd.address() as net.AddressInfo).port}`, () => "x");
  assert.deepEqual([out.code, /does not understand/.test(out.text)], [2, true]);
});

import http from "node:http";
const http_server = (h: http.RequestListener) => http.createServer(h);

test("npm run status when the bridge is not running: prints 'not running' and exits 1, without touching a secret", async () => {
  const free = await new Promise<number>((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });
  const out = await checkStatus(`http://127.0.0.1:${free}`, () => { throw new Error("must not mint a token when nothing is listening"); });
  assert.deepEqual(out, { code: 1, text: "not running" });
  const cli = spawnSync(process.execPath, [path.join(here, "status.ts")], { encoding: "utf8", env: { ...process.env, SUPEROS_PORT: String(Math.max(1024, free)) } });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /not running/);
  assert.equal(cli.stdout, "");
});

test("the dashboard carries the Health strip: markup, the 30-second refresh and the warning colour", () => {
  const html = readFileSync(path.join(here, "..", "app", "index.html"), "utf8");
  const main = readFileSync(path.join(here, "..", "app", "main.ts"), "utf8");
  const css = readFileSync(path.join(here, "..", "app", "styles.css"), "utf8");
  assert.ok(html.includes('id="health"'));
  assert.ok(main.includes("healthWarnings") && main.includes("api.health()") && /setInterval\(\(\) => void drawHealth\(\), 30_000\)/.test(main));
  assert.ok(/\.health\.warning\s*\{[^}]*var\(--warn\)/.test(css) && /\.health \.chip\.warn b\s*\{[^}]*var\(--warn\)/.test(css), "warning colour rules");
  assert.ok(/\.health\s*\{[^}]*var\(--accent\)/.test(css), "neon blue accent");
  void mkdirSync;
});
