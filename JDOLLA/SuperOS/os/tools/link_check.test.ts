import { test } from "node:test";
import assert from "node:assert/strict";
import { handleToolMessage, offeredTools } from "./mcp.ts";
import { extractLinks, linkCheck } from "./link_check.ts";
import { SECRETS, makeToolVault, put, text } from "./vault-fixture.ts";

type Result = { checked: number; total: number; truncated: boolean; broken: Array<{ source: string; target: string }>; error?: string };
const run = (ctx: ReturnType<typeof makeToolVault>["ctx"], input: object = {}): Result => linkCheck.run(linkCheck.input.parse(input), ctx) as Result;
const pairs = (r: Result) => r.broken.map((b) => `${b.source} -> ${b.target}`).sort();

test("reports exactly the broken links, with the note that has them and the missing target", () => {
  const { ctx } = makeToolVault();
  const r = run(ctx);
  assert.deepEqual(pairs(r), [
    "depts/software.md -> wiki/software/nope",
    "wiki/ai/c.md -> ../../etc/passwd",
    "wiki/ai/c.md -> C:/Windows/x",
    "wiki/ai/c.md -> etc/passwd",
    "wiki/software/a.md -> wiki/software/missing-one",
  ]);
  assert.deepEqual([r.total, r.truncated], [5, false]);
  for (const b of r.broken) assert.deepEqual(Object.keys(b).sort(), ["source", "target"]);
});

test("good link forms are not reported: full path, with .md, alias, heading, bare name, different case, root notes, other folders", () => {
  const { ctx } = makeToolVault();
  const r = text(run(ctx));
  for (const good of ["wiki/ai/c", "wiki/software/a.md", "wiki/software/b", "Home", "skills/README", "WIKI/AI/C"]) assert.ok(!r.includes(`"target":"${good}"`), `${good} is fine`);
});

test("links in code spans and code fences are examples, not links", () => {
  assert.deepEqual(extractLinks("a [[one]] `[[two]]` [[four|alias]] [[five#h]] [[six#h|alias]]\n```\n[[three]]\n```\n~~~js\n[[seven]]\n~~~\n[[eight]]"), ["one", "four", "five", "six", "eight"]);
  assert.deepEqual(extractLinks("[[a\nb]] [[ ]] [[]] [[x]]y]] [["), ["x"], "malformed links are ignored");
  const { ctx } = makeToolVault();
  const r = text(run(ctx));
  assert.ok(!r.includes("inline-broken") && !r.includes("fenced-broken"));
});

test("links into places the tools never scan are not judged (and not reported): os/, logs/, raw/sessions, outputs/_work, dot entries", () => {
  const { ctx } = makeToolVault();
  const r = text(run(ctx));
  for (const skip of ["os/README", "logs/run", "raw/sessions/s", "outputs/_work", ".env"]) assert.ok(!r.includes(skip), skip);
});

test("a target is only looked up in the set of scanned files, so a path-like target cannot read anything", () => {
  const { vault, outside, ctx } = makeToolVault();
  put(outside, "real.md", "# exists outside");
  put(vault, "wiki/ai/probe.md", `[[../outside/real]] [[../../outside/real.md]] [[${outside}/real]] [[wiki/../os/secret]]\n`);
  const r = run(ctx);
  const probe = r.broken.filter((b) => b.source === "wiki/ai/probe.md").map((b) => b.target);
  assert.equal(probe.length, 4, "every one of them is just 'missing', even though a file really exists there");
  assert.ok(!text(r).includes("exists outside"));
});

test("sources are only wiki/ and depts/; generated indexes, links, dot-files and other folders are never read", () => {
  const { vault, ctx } = makeToolVault();
  put(vault, "raw/software/charter/bad-links.md", "[[raw-only-broken]]");
  put(vault, "docs/bad-links.md", "[[docs-only-broken]]");
  const r = run(ctx);
  const all = text(r);
  for (const bad of ["gone", "outside-broken", "raw-only-broken", "docs-only-broken", "wiki/link.md", "linkdir", ".hidden"]) assert.ok(!all.includes(bad), `${bad} must not appear`);
  assert.equal(r.checked, 10, "2 depts + 8 wiki notes (a, b, c, undated, d60, d61, lesson, directives); generated indexes are not read");
  for (const s of SECRETS) assert.ok(!all.includes(s), s);
});

test("dept limits the check to wiki/<dept>/ and depts/<dept>.md; an unknown department is an error", () => {
  const { ctx } = makeToolVault();
  assert.deepEqual(pairs(run(ctx, { dept: "software" })), ["depts/software.md -> wiki/software/nope", "wiki/software/a.md -> wiki/software/missing-one"]);
  assert.deepEqual(pairs(run(ctx, { dept: "ai" })), ["wiki/ai/c.md -> ../../etc/passwd", "wiki/ai/c.md -> C:/Windows/x", "wiki/ai/c.md -> etc/passwd"]);
  assert.match(run(ctx, { dept: "finance" }).error ?? "", /Unknown department/);
});

test("the list is capped at 100 and says so; each missing target is reported once per note", () => {
  const { vault, ctx } = makeToolVault();
  put(vault, "wiki/ai/many.md", Array.from({ length: 150 }, (_, i) => `[[missing-${i}]] [[missing-${i}]]`).join(" "));
  const r = run(ctx);
  assert.deepEqual([r.broken.length, r.truncated], [100, true]);
  assert.equal(r.total, 155);
});

test("arguments: only dept, unknown arguments refused", () => {
  const { ctx } = makeToolVault();
  const offered = offeredTools("link_check");
  const call = (args: unknown) => handleToolMessage(offered, ctx, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "link_check", arguments: args } }) as { result: { isError: boolean } };
  assert.equal(call({}).result.isError, false, "control");
  assert.equal(call({ dept: "ai" }).result.isError, false);
  for (const bad of [{ path: "wiki" }, { dept: "../os" }, { dept: "AI" }, { dept: 5 }, { dept: "ai", extra: 1 }]) assert.equal(call(bad).result.isError, true, JSON.stringify(bad));
});
