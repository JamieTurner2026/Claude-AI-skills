// These tests attack the bridge's boundaries. Every "blocked" check has a control beside it
// that must succeed, so a check that cannot fail is not counted as proof.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { networkInterfaces } from "node:os";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeVault } from "./fixture.ts";
import { COOKIE, SESSION_MS, mintToken } from "./auth.ts";
import { createBridge } from "./server.ts";
import type { Bridge } from "./server.ts";

let bridge: Bridge, base: string, port: number, vault: string, token: string;
const opened: string[] = [];

before(async () => {
  vault = makeVault();
  for (const d of ["os/app", "os/shared", "os/bridge", ".claude", "logs"]) mkdirSync(path.join(vault, d), { recursive: true });
  writeFileSync(path.join(vault, "os/app/index.html"), "<h1>dash</h1>");
  writeFileSync(path.join(vault, "os/app/main.ts"), "const n: number = 1; export type X = string; console.log(n);");
  writeFileSync(path.join(vault, "os/app/main.test.ts"), "secret test file");
  writeFileSync(path.join(vault, "os/bridge/server.ts"), "SERVER-SOURCE");
  writeFileSync(path.join(vault, "os/.env"), "SUPEROS_ROUTER_KEY=TOPSECRET\n");
  writeFileSync(path.join(vault, ".env"), "ROOT=TOPSECRET\n");
  writeFileSync(path.join(vault, ".claude/settings.json"), "{}");
  writeFileSync(path.join(vault, "logs/router.jsonl"), "{}");
  writeFileSync(path.join(vault, "wiki/software/tool.exe"), "MZ");
  writeFileSync(path.join(vault, "Home.md"), "# Home");
  symlinkSync(path.join(vault, "os/.env"), path.join(vault, "wiki/software/link.md"));
  symlinkSync(path.join(vault, "os"), path.join(vault, "wiki/oslink"));
  bridge = createBridge(path.join(vault, "os"), { opener: (p) => opened.push(p) });
  await new Promise<void>((r) => bridge.server.listen(0, "127.0.0.1", r));
  port = (bridge.server.address() as net.AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  token = bridge.mint();
});
after(() => { bridge.server.close(); });

const auth = () => ({ authorization: `Bearer ${token}` });
const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + p, { method: "POST", headers: { "content-type": "application/json", "x-superos": "1", ...auth(), ...headers }, body: JSON.stringify(body) });
const getFile = (p: string) => fetch(`${base}/api/file?path=${encodeURIComponent(p)}`, { headers: auth() });

/** Raw request so the Host header and path are sent exactly as written. */
function raw(pathname: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: pathname, headers }, (res) => {
      let body = ""; res.on("data", (c) => (body += c)); res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject); req.end();
  });
}

test("api needs a valid signed session", async () => {
  assert.equal((await fetch(base + "/api/state", { headers: auth() })).status, 200, "control: good token works");
  assert.equal((await fetch(base + "/api/state")).status, 401, "no token");
  const tampered = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
  const expired = mintToken(bridge.secret, Date.now() - SESSION_MS - 1000);
  const otherSecret = mintToken("0".repeat(64));
  for (const [name, t] of [["garbage", "abc"], ["tampered", tampered], ["expired", expired], ["wrong secret", otherSecret], ["empty", ""]] as const) {
    assert.equal((await fetch(base + "/api/state", { headers: { authorization: `Bearer ${t}` } })).status, 401, name);
    assert.equal((await fetch(base + "/api/state", { headers: { cookie: `${COOKIE}=${t}` } })).status, 401, name + " cookie");
  }
});

test("sign-in link sets an HttpOnly cookie that works; a bad link does not", async () => {
  const r = await fetch(`${base}/?t=${token}`, { redirect: "manual" });
  assert.equal(r.status, 302);
  const cookie = r.headers.get("set-cookie") ?? "";
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  assert.equal((await fetch(base + "/api/state", { headers: { cookie: cookie.split(";")[0] ?? "" } })).status, 200);
  const bad = await fetch(`${base}/?t=nope`, { redirect: "manual" });
  assert.equal(bad.status, 401); assert.equal(bad.headers.get("set-cookie"), null);
});

test("listens on 127.0.0.1 only", async (t) => {
  assert.equal((bridge.server.address() as net.AddressInfo).address, "127.0.0.1");
  const connect = (host: string) => new Promise<string>((resolve) => {
    const s = net.connect({ host, port, timeout: 1500 });
    s.on("connect", () => { s.destroy(); resolve("connected"); });
    s.on("error", (e: NodeJS.ErrnoException) => resolve(e.code ?? "error"));
    s.on("timeout", () => { s.destroy(); resolve("timeout"); });
  });
  assert.equal(await connect("127.0.0.1"), "connected", "control: loopback connects");
  const other = Object.values(networkInterfaces()).flat().find((i) => i && !i.internal && i.family === "IPv4")?.address;
  if (!other) return t.diagnostic("no non-loopback interface here; only the bind address was checked");
  assert.notEqual(await connect(other), "connected", `must not be reachable on ${other}`);
});

test("wrong Host header is refused (DNS rebinding)", async () => {
  assert.equal((await raw("/api/state", { host: `127.0.0.1:${port}`, ...auth() })).status, 200, "control");
  assert.equal((await raw("/api/state", { host: `evil.example:${port}`, ...auth() })).status, 403);
  assert.equal((await raw("/", { host: "evil.example" })).status, 403);
});

test("writes need our header and our origin", async () => {
  assert.equal((await post("/api/route", { text: "open software" })).status, 200, "control");
  assert.equal((await post("/api/route", { text: "x" }, { "x-superos": "" })).status, 403, "no custom header");
  assert.equal((await post("/api/route", { text: "x" }, { origin: "http://evil.example" })).status, 403, "foreign origin");
  assert.equal((await post("/api/route", { text: "x" }, { origin: base })).status, 200, "control: own origin");
  assert.equal((await fetch(base + "/api/route", { method: "POST", headers: { ...auth(), "x-superos": "1", "content-type": "text/plain" }, body: "{}" })).status, 415);
  assert.equal((await post("/api/route", { text: "a".repeat(70_000) })).status, 413, "oversized body");
});

test("/api/file: allowed files read; .env, os/, dot-folders, links and traversal are blocked", async () => {
  const ok = await getFile("wiki/software/a.md");
  assert.equal(ok.status, 200, "control"); assert.equal(((await ok.json()) as { content: string }).content, "a");
  assert.equal((await getFile("Home.md")).status, 200, "control: root note");
  const attacks = [".env", "os/.env", "os/config/os.config.json", "os/bridge/server.ts", ".claude/settings.json", "logs/router.jsonl",
    "../etc/passwd", "wiki/../os/.env", "wiki/../../etc/passwd", "wiki\\..\\os\\.env", "/etc/passwd", path.join(vault, "os/.env"), "C:\\Windows\\win.ini",
    "\\\\server\\share\\x.md", "wiki/software/link.md", "wiki/oslink/.env", "wiki/oslink/config/os.config.json", "wiki/software/tool.exe",
    "wiki/software/a.md\u0000.env", "wiki/software/missing.md", "wiki/software", "", "OS/.env", "Wiki/../.env"];
  for (const a of attacks) {
    const r = await getFile(a);
    const body = await r.text();
    assert.ok(r.status === 403 || r.status === 400, `${JSON.stringify(a)} -> ${r.status}`);
    assert.ok(!body.includes("TOPSECRET") && !body.includes("SERVER-SOURCE"), `${a} leaked`);
  }
});

test("static: only app/ and shared/ code is served, with types stripped", async () => {
  const main = await fetch(base + "/app/main.ts");
  assert.equal(main.status, 200, "control");
  const js = await main.text();
  assert.match(main.headers.get("content-type") ?? "", /javascript/);
  assert.ok(!js.includes(": number") && !js.includes("export type") && js.includes("console.log(n)"), js);
  assert.equal((await fetch(base + "/")).status, 200, "control: index");
  for (const p of ["/bridge/server.ts", "/.env", "/.cache/secret", "/config/os.config.json", "/app/main.test.ts", "/app/..%2f.env", "/app/%2e%2e/bridge/server.ts", "/app/../.env", "/app//../../.env", "/app/nope.ts", "/package.json"]) {
    const r = await raw(p, { host: `127.0.0.1:${port}` });
    assert.equal(r.status, 404, p);
    assert.ok(!r.body.includes("TOPSECRET") && !r.body.includes("SERVER-SOURCE"), p);
  }
});

test("directives: toggle, add as one plain line, refuse a stale id", async () => {
  const file = path.join(vault, "wiki/directives.md");
  const state = (await (await fetch(base + "/api/state", { headers: auth() })).json()) as { directives: { id: string; done: boolean }[] };
  const first = state.directives[0];
  assert.ok(first && !first.done);
  assert.equal((await post("/api/directives/toggle", { id: first.id })).status, 200);
  assert.match(readFileSync(file, "utf8"), /- \[x\] First thing/);
  assert.equal((await post("/api/directives/toggle", { id: "0-deadbeef" })).status, 409, "stale id");
  assert.equal((await post("/api/directives/toggle", { id: "../../x" })).status, 400);
  const before = readFileSync(file, "utf8").split("\n").length;
  assert.equal((await post("/api/directives/add", { text: "Buy milk\n# Injected heading\n- [x] fake done\u2028more" })).status, 200);
  const text = readFileSync(file, "utf8");
  assert.equal(text.split("\n").length, before + 1, "exactly one line added");
  assert.ok(!/^# Injected/m.test(text) && !/^- \[x\] fake/m.test(text));
  assert.match(text, /^- \[ \] Buy milk # Injected heading - \[x\] fake done more$/m);
  assert.equal((await post("/api/directives/add", { text: "  \n " })).status, 400);
});

test("layout: valid layout is saved, invalid is refused and changes nothing", async () => {
  const cfg = path.join(vault, "os/config/os.config.json");
  assert.equal((await post("/api/layout", { layout: [{ widget: "clock", span: 2 }, { widget: "directives", span: 1 }] })).status, 200);
  assert.equal(JSON.parse(readFileSync(cfg, "utf8")).layout.length, 2);
  const snapshot = readFileSync(cfg, "utf8");
  for (const bad of [[{ widget: "../x", span: 1 }], [{ widget: "clock", span: 9 }], "nope", [{ widget: "<script>", span: 1 }]]) {
    assert.equal((await post("/api/layout", { layout: bad })).status, 400);
  }
  assert.equal(readFileSync(cfg, "utf8"), snapshot);
});

test("/api/open only opens allowed vault files", async () => {
  opened.length = 0;
  assert.equal((await post("/api/open", { path: "wiki/software/a.md" })).status, 200, "control");
  assert.equal(opened.length, 1); assert.ok(opened[0]?.endsWith(path.join("wiki", "software", "a.md")));
  for (const a of ["os/.env", ".env", "wiki/software/tool.exe", "../x.md", "wiki/software/link.md", "os/bridge/server.ts"]) {
    assert.equal((await post("/api/open", { path: a })).status, 403, a);
  }
  assert.equal(opened.length, 1, "nothing else was opened");
});

test("route endpoint uses the vault's departments", async () => {
  const r = (await (await post("/api/route", { text: "open software" })).json()) as { tier: string; action: unknown };
  assert.equal(r.tier, "T1"); assert.deepEqual(r.action, { kind: "open-dept", slug: "software" });
  assert.equal((await post("/api/route", { nope: 1 })).status, 400);
  assert.equal((await fetch(base + "/api/nothing", { headers: auth() })).status, 404);
});
