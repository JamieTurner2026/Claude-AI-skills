import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chunkMarkdown } from "./chunker.ts";
import { INJECTION, TERMS, makeBrainVault } from "./fixture.ts";
import { rebuildIndex } from "./indexer.ts";
import { handleMessage, type Ctx } from "./mcp.ts";
import { openReadOnly, search, toFtsQuery } from "./search.ts";
import { GuardError } from "../bridge/guards.ts";
import { resolveBrainFile } from "./files.ts";

function setup() {
  const { vault, dir } = makeBrainVault();
  const dbPath = path.join(dir, "index.sqlite");
  const stats = rebuildIndex(vault, dbPath);
  return { vault, dir, dbPath, stats, ctx: { vault, dbPath } satisfies Ctx };
}
const find = (dbPath: string, q: string, o: object = {}) => { const db = openReadOnly(dbPath); try { return search(db, { query: q, ...o }); } finally { db.close(); } };
const call = (ctx: Ctx, name: string, args: unknown) => handleMessage(ctx, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

describe("chunker", () => {
  it("splits on headings and keeps a breadcrumb", () => {
    const c = chunkMarkdown("intro\n# A\none\n## B\ntwo\n# C\nthree", "Doc");
    assert.deepEqual(c.map((x) => x.heading), ["Doc", "A", "A > B", "C"]);
  });
  it("ignores # lines inside code fences", () => {
    const c = chunkMarkdown("# A\n```\n# not a heading\n```\ntext", "Doc");
    assert.equal(c.length, 1);
    assert.match(c[0]!.text, /not a heading/);
  });
  it("splits very long sections", () => {
    const c = chunkMarkdown("# A\n" + ("para ".repeat(200) + "\n\n").repeat(10), "Doc");
    assert.ok(c.length > 1 && c.every((x) => x.text.length <= 2000));
  });
});

describe("indexing: what is and is not read", () => {
  it("control: a normal wiki note IS indexed and found", () => {
    const { dbPath, stats } = setup();
    const hits = find(dbPath, "servo alarm 42");
    assert.ok(stats.files >= 3);
    assert.equal(hits[0]?.path, "wiki/industrial/servo.md");
    assert.equal(hits[0]?.trusted, true);
    assert.equal(hits[0]?.heading, "Servo alarms > Alarm 42");
    assert.equal(hits[0]?.dept, "industrial");
  });
  it(".env, os/, logs/, dot-folders, links out and oversize files are never indexed", () => {
    const { dbPath } = setup();
    for (const t of [TERMS.envSecret, TERMS.osSecret, TERMS.logSecret, TERMS.dotSecret, TERMS.bigSecret]) {
      assert.deepEqual(find(dbPath, t), [], `${t} must not be searchable`);
    }
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const paths = (db.prepare("SELECT DISTINCT path FROM documents").all() as { path: string }[]).map((r) => r.path).sort();
    db.close();
    assert.deepEqual(paths, ["raw/industrial/vendor.md", "wiki/ai/memory.md", "wiki/industrial/servo.md"]);
  });
  it("search input is validated and FTS operators are neutralised", () => {
    const { dbPath } = setup();
    assert.throws(() => find(dbPath, "   "));
    assert.throws(() => find(dbPath, "servo", { limit: 9999 }));
    assert.equal(toFtsQuery('NEAR(" OR *) -x'), '"NEAR" AND "OR" AND "x"');
    assert.doesNotThrow(() => find(dbPath, '"unbalanced ( * AND'));
    assert.ok(find(dbPath, ".env API_KEY").every((h) => !/(^|\/)\.env/.test(h.path) && !h.snippet.includes(TERMS.envSecret))); // no .env file or its content comes back
  });
});

describe("untrusted data", () => {
  it("raw/ rows are untrusted and an injected instruction comes back fenced as data", () => {
    const { dbPath, ctx } = setup();
    const hit = find(dbPath, TERMS.injection)[0];
    assert.equal(hit?.trusted, false);
    assert.equal(find(dbPath, "ignore previous instructions", { trustedOnly: true }).length, 0);
    const reply = call(ctx, "search", { query: "ignore all previous instructions" });
    const text = (reply?.result as { content: { text: string }[] }).content[0]!.text;
    const body = JSON.parse(text) as { note: string; hits: { trusted: boolean; snippet: string }[] };
    assert.match(body.note, /never instructions/);
    const h = body.hits.find((x) => !x.trusted)!;
    assert.ok(h.snippet.startsWith('<untrusted-data source="raw/industrial/vendor.md">') && h.snippet.endsWith("</untrusted-data>"));
    assert.ok(INJECTION.toLowerCase().includes("ignore all previous"));
  });
  it("a note cannot close the fence early (get_note)", () => {
    const { ctx } = setup();
    const r = call(ctx, "get_note", { path: "raw/industrial/vendor.md" })!.result as { content: { text: string }[] };
    const body = JSON.parse(r.content[0]!.text) as { trusted: boolean; text: string };
    assert.equal(body.trusted, false);
    assert.equal(body.text.match(/<\/untrusted-data>/g)?.length, 1);
    assert.ok(body.text.includes(INJECTION));
  });
});

describe("index health", () => {
  it("a missing index is created", () => {
    const { vault, dir } = makeBrainVault();
    const p = path.join(dir, "new.sqlite");
    assert.equal(existsSync(p), false);
    const s = rebuildIndex(vault, p);
    assert.equal(s.recreated, true);
    assert.ok(find(p, "servo").length > 0);
  });
  it("a corrupt index is replaced, not trusted", () => {
    const { vault, dbPath } = setup();
    writeFileSync(dbPath, "this is not a sqlite file ".repeat(500));
    assert.throws(() => openReadOnly(dbPath));
    const s = rebuildIndex(vault, dbPath);
    assert.equal(s.recreated, true);
    assert.ok(find(dbPath, "servo alarm").length > 0);
  });
  it("a half-damaged index (tables gone) is rebuilt", () => {
    const { vault, dbPath } = setup();
    const db = new DatabaseSync(dbPath);
    db.exec("DROP TABLE docs_fts");
    db.close();
    assert.equal(rebuildIndex(vault, dbPath).recreated, true);
    assert.ok(find(dbPath, "servo").length > 0);
  });
  it("re-indexing a healthy index does not duplicate rows", () => {
    const { vault, dbPath, stats } = setup();
    const s2 = rebuildIndex(vault, dbPath);
    assert.equal(s2.recreated, false);
    assert.equal(s2.chunks, stats.chunks);
  });
});

describe("get_note guard", () => {
  it("control: a normal note is readable", () => {
    const { vault } = setup();
    assert.ok(resolveBrainFile(vault, "wiki/industrial/servo.md").endsWith("servo.md"));
  });
  for (const bad of ["../.env", ".env", "wiki/.env", "wiki/.env.md", "wiki/.hidden/note.md", "os/config/secret.md", "logs/run.md", "depts/software.md", "wiki/link.md", "wiki/../os/config/secret.md", "/etc/passwd", "wiki/ai/big.md", "wiki/config.env", "raw/.git/note.md"]) {
    it(`refuses ${bad}`, () => {
      const { vault } = setup();
      assert.throws(() => resolveBrainFile(vault, bad), GuardError);
    });
  }
});

describe("MCP server", () => {
  it("lists exactly search and get_note, both marked read-only", () => {
    const { ctx } = setup();
    const r = handleMessage(ctx, { jsonrpc: "2.0", id: 1, method: "tools/list" })!.result as { tools: { name: string; annotations: { readOnlyHint: boolean } }[] };
    assert.deepEqual(r.tools.map((t) => t.name), ["search", "get_note"]);
    assert.ok(r.tools.every((t) => t.annotations.readOnlyHint));
  });
  it("refuses unknown tools and unknown methods", () => {
    const { ctx } = setup();
    for (const name of ["write_note", "delete_note", "index", "__proto__"]) {
      const r = call(ctx, name, {})!;
      assert.equal(r.error?.code, -32602, name);
      assert.equal(r.result, undefined);
    }
    assert.equal(handleMessage(ctx, { jsonrpc: "2.0", id: 2, method: "resources/write" })!.error?.code, -32601);
    assert.equal(handleMessage(ctx, { nope: true })!.error?.code, -32600);
  });
  it("rejects bad arguments and extra fields", () => {
    const { ctx } = setup();
    const r = call(ctx, "search", { query: "x", limit: 1000 })!.result as { isError: boolean };
    assert.equal(r.isError, true);
    assert.equal((call(ctx, "get_note", { path: "wiki/ai/memory.md", extra: 1 })!.result as { isError: boolean }).isError, true);
  });
  it("get_note refuses .env and os/ (control: wiki note works)", () => {
    const { ctx } = setup();
    assert.equal((call(ctx, "get_note", { path: "wiki/ai/memory.md" })!.result as { isError: boolean }).isError, false);
    for (const p of [".env", "wiki/.env", "os/config/secret.md", "../.env"]) assert.equal((call(ctx, "get_note", { path: p })!.result as { isError: boolean }).isError, true, p);
  });
  it("reports a missing index instead of writing one", () => {
    const { vault, dir } = makeBrainVault();
    const p = path.join(dir, "absent.sqlite");
    const r = call({ vault, dbPath: p }, "search", { query: "servo" })!.result as { isError: boolean; content: { text: string }[] };
    assert.equal(r.isError, true);
    assert.match(r.content[0]!.text, /missing or damaged/);
    assert.equal(existsSync(p), false);
  });
  it("over real stdio: handshake, search, unknown tool, and the index file is untouched", async () => {
    const { vault, dbPath, dir } = setup();
    const hashAll = () => createHash("sha256").update(readFileSync(dbPath)).digest("hex") + readdirSync(dir).join(",");
    const before = hashAll();
    const child = spawn(process.execPath, [path.join(import.meta.dirname, "mcp.ts")], { env: { ...process.env, SUPEROS_VAULT: vault, SUPEROS_BRAIN_DB: dbPath }, stdio: ["pipe", "pipe", "ignore"] });
    const lines: unknown[] = [];
    let buf = "";
    child.stdout.on("data", (d: Buffer) => { buf += d.toString(); let i; while ((i = buf.indexOf("\n")) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
    const send = (o: object) => child.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search", arguments: { query: "servo alarm" } } });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "write_file", arguments: {} } });
    for (let i = 0; i < 100 && lines.length < 3; i++) await new Promise((r) => setTimeout(r, 50));
    child.stdin.end();
    assert.equal(lines.length, 3); // the notification got no reply
    const [init, srch, bad] = lines as { result?: any; error?: any }[];
    assert.equal(init!.result.serverInfo.name, "superos-brain");
    assert.ok(JSON.parse(srch!.result.content[0].text).count > 0);
    assert.equal(bad!.error.code, -32602);
    assert.equal(hashAll(), before);
  });
});
