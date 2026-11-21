import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { TERMS, makeBrainVault } from "./fixture.ts";
import { rebuildIndex } from "./indexer.ts";
import { handleMessage, type Ctx } from "./mcp.ts";
import { formatUsage, isLoggablePath, readUsage, recordUse, rotatedPath, summarizeUsage, usagePathFor } from "./usage.ts";
import { renderDeptIndex, type Note } from "../vault/generate.ts";

function setup() {
  const { vault, dir } = makeBrainVault();
  const dbPath = path.join(dir, "index.sqlite");
  rebuildIndex(vault, dbPath);
  const usageFile = usagePathFor(dbPath);
  return { vault, dir, dbPath, usageFile, ctx: { vault, dbPath, usageFile } satisfies Ctx };
}
const call = (ctx: Ctx, name: string, args: unknown) => handleMessage(ctx, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
const lines = (f: string) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean) : []);

describe("usage log (7c)", () => {
  it("get_note records one line with the note path and time; search records nothing", () => {
    const { ctx, usageFile } = setup();
    call(ctx, "search", { query: "servo alarm" });
    assert.equal(existsSync(usageFile), false, "search must not log");
    call(ctx, "get_note", { path: "wiki/industrial/servo.md" });
    const l = lines(usageFile);
    assert.equal(l.length, 1);
    const row = JSON.parse(l[0] as string);
    assert.deepEqual(Object.keys(row).sort(), ["path", "t"]);
    assert.equal(row.path, "wiki/industrial/servo.md");
    assert.ok(!Number.isNaN(Date.parse(row.t)));
  });

  it("privacy: query text, arguments and note text never reach the usage file", () => {
    const { ctx, usageFile } = setup();
    const secretQuery = "qqprivateneedle77 servo";
    call(ctx, "search", { query: secretQuery, dept: "industrial" });
    call(ctx, "get_note", { path: "wiki/industrial/servo.md" });
    call(ctx, "get_note", { path: "wiki/ai/memory.md" });
    // Refused reads log nothing, whatever the argument says.
    for (const p of ["./wiki/industrial/../industrial/servo-qqprivateneedle77.md", "wiki/missing-qqprivateneedle77.md", "../outside-qqprivateneedle77.md", "os/config/secret.md"]) {
      call(ctx, "get_note", { path: p });
    }
    const text = readFileSync(usageFile, "utf8");
    assert.ok(!text.includes("qqprivateneedle77"), "query or argument text leaked");
    assert.ok(!text.includes(TERMS.normal), "note text leaked");
    assert.ok(!text.includes("..") && !text.includes("os/"), "unresolved or refused argument leaked");
    assert.deepEqual(lines(usageFile).map((x) => JSON.parse(x).path), ["wiki/industrial/servo.md", "wiki/ai/memory.md"]);
  });

  it("logs the resolved note path, not the spelling the run passed", () => {
    const { ctx, usageFile } = setup();
    for (const p of ["wiki/industrial/servo.md", "wiki//industrial/servo.md", "wiki/industrial/./servo.md", "wiki\\industrial\\servo.md", "wiki/industrial/../industrial/servo.md"]) {
      call(ctx, "get_note", { path: p });
    }
    assert.deepEqual(lines(usageFile).map((x) => JSON.parse(x).path), Array(5).fill("wiki/industrial/servo.md"));
    assert.deepEqual(readUsage(usageFile).get("wiki/industrial/servo.md")?.count, 5);
  });

  it("recordUse itself refuses unloggable paths and writes nothing", () => {
    const { dir } = setup();
    const f = path.join(dir, "refuse.jsonl");
    for (const p of ["os/.env", "wiki/a.md\n{\"t\":\"x\",\"path\":\"os/.env\"}", "wiki//a.md", "../x.md", "logs/run.md"]) assert.equal(recordUse(f, p), false, JSON.stringify(p));
    assert.equal(existsSync(f), false);
    assert.equal(recordUse(f, "wiki/ai/memory.md"), true);
    assert.equal(lines(f).length, 1);
  });

  it("control: without a usage file in the context, get_note writes nothing", () => {
    const { vault, dbPath, usageFile } = setup();
    call({ vault, dbPath }, "get_note", { path: "wiki/industrial/servo.md" });
    assert.equal(existsSync(usageFile), false);
  });

  it("Jay's note is never rewritten by get_note", () => {
    const { ctx, vault } = setup();
    const f = path.join(vault, "wiki/industrial/servo.md");
    const before = { text: readFileSync(f, "utf8"), mtime: statSync(f).mtimeMs };
    for (let i = 0; i < 3; i++) call(ctx, "get_note", { path: "wiki/industrial/servo.md" });
    assert.equal(readFileSync(f, "utf8"), before.text);
    assert.equal(statSync(f).mtimeMs, before.mtime);
  });

  it("refuses to log anything that is not a plain wiki/ or raw/ note path", () => {
    for (const p of ["os/config/x.md", "wiki/a.md\n{\"t\":1}", "wiki/../os/x.md", "wiki//a.md", "wiki/.hidden/n.md", "logs/run.md", "wiki/a.txt", "wiki\\a.md", ""]) {
      assert.equal(isLoggablePath(p), false, JSON.stringify(p));
    }
    for (const p of ["wiki/ai/memory.md", "raw/industrial/vendor.md", "wiki/creative/café notes.md"]) assert.equal(isLoggablePath(p), true, p);
  });

  it("rotates at the size cap, keeps one older copy and reads both", () => {
    const { dir } = setup();
    const f = path.join(dir, "rot", "usage.jsonl");
    mkdirSync(path.dirname(f), { recursive: true });
    const t0 = Date.parse("2026-11-20T10:00:00Z");
    for (let i = 0; i < 30; i++) assert.ok(recordUse(f, `wiki/ai/n${i % 3}.md`, new Date(t0 + i * 1000), 400));
    assert.ok(existsSync(rotatedPath(f)), "rotated copy exists");
    assert.ok(statSync(f).size <= 400, "live file stays under the cap");
    assert.ok(statSync(rotatedPath(f)).size <= 400, "rotated copy stays under the cap");
    const u = readUsage(f);
    const total = [...u.values()].reduce((n, x) => n + x.count, 0);
    assert.ok(total > 0 && total <= 30);
    assert.ok(total < 30, "older lines beyond one rotation are dropped, so the files stay bounded");
    assert.equal(u.get("wiki/ai/n2.md")?.last, new Date(t0 + 29 * 1000).toISOString());
  });

  it("reading skips junk lines and paths it would never log", () => {
    const { dir } = setup();
    const f = path.join(dir, "junk.jsonl");
    writeFileSync(f, [
      JSON.stringify({ t: "2026-11-20T10:00:00.000Z", path: "wiki/ai/memory.md" }),
      "not json",
      JSON.stringify({ t: "2026-11-20T10:00:00.000Z", path: "os/.env" }),
      JSON.stringify({ t: "yesterday", path: "wiki/ai/memory.md" }),
      JSON.stringify({ t: "2026-11-21T10:00:00.000Z", path: "wiki/ai/memory.md", query: "extra field" }),
      JSON.stringify({ t: "2026-11-19T10:00:00.000Z", path: "wiki/ai/memory.md" }),
    ].join("\n"));
    const u = readUsage(f);
    assert.deepEqual([...u.keys()], ["wiki/ai/memory.md"]);
    assert.deepEqual(u.get("wiki/ai/memory.md"), { count: 2, last: "2026-11-20T10:00:00.000Z" });
  });

  it("summary lists used notes and never-used wiki notes", () => {
    const u = new Map([["wiki/ai/memory.md", { count: 3, last: "2026-11-20T10:00:00.000Z" }]]);
    const s = summarizeUsage(u, ["wiki/ai/memory.md", "wiki/ai/big.md", "raw/industrial/vendor.md", "wiki/_master-index.md", "wiki/ai/_index.md", "wiki/_learnings/x.md"]);
    assert.equal(s.opens, 3);
    assert.deepEqual(s.neverUsed, ["wiki/ai/big.md"], "raw/ files and generated _ files are not listed as never used");
    assert.match(formatUsage(s), /3 opens of 1 notes/);
    assert.match(formatUsage(s), /Never used \(wiki notes\): 1\n {2}wiki\/ai\/big\.md/);
  });

  it("`npm run brain -- usage` prints the summary and exits 0", () => {
    const { dbPath, ctx } = setup();
    call(ctx, "get_note", { path: "wiki/ai/memory.md" });
    const cli = path.join(import.meta.dirname, "cli.ts");
    const r = spawnSync(process.execPath, [cli, "usage", "--db", dbPath], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1 opens of 1 notes/);
    assert.match(r.stdout, /wiki\/ai\/memory\.md/);
    assert.match(r.stdout, /Never used \(wiki notes\): [1-9]/);
    const j = spawnSync(process.execPath, [cli, "usage", "--json", "--db", dbPath], { encoding: "utf8" });
    assert.equal(JSON.parse(j.stdout).notesUsed, 1);
  });
});

describe("department index shows last used / never used (7c)", () => {
  const note = (rel: string, title: string): Note => ({ rel, dept: "ai", slug: path.posix.basename(rel, ".md"), title, type: "concept", updated: "2026-09-01", sources: [], changedDay: "2026-09-01" });
  const notes = [note("wiki/ai/memory.md", "Memory"), note("wiki/ai/big.md", "Big")];
  const dept = { slug: "ai", name: "AI Research" };

  it("marks each note with its last-used day in Jay's time zone, or never used", () => {
    const u = new Map([["wiki/ai/memory.md", { count: 2, last: "2026-11-21T03:00:00.000Z" }]]);
    const t = renderDeptIndex(dept, notes, u, "America/New_York");
    assert.match(t, /- \[\[wiki\/ai\/memory\]\]: Memory \(concept, updated 2026-09-01\) · last used 2026-11-20/);
    assert.match(t, /- \[\[wiki\/ai\/big\]\]: Big \(concept, updated 2026-09-01\) · never used/);
  });

  it("control: without usage the lines are exactly as before", () => {
    const t = renderDeptIndex(dept, notes);
    assert.ok(!t.includes("used"));
    assert.match(t, /- \[\[wiki\/ai\/memory\]\]: Memory \(concept, updated 2026-09-01\)\n/);
  });
});
