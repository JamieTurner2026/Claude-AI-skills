// CHANGELOG.md (1.0.0): the newest version heading is the version the bridge reports (os/package.json, which the
// Health strip and `npm run status` show), and every pull request is cited the same way, as #<number>.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VAULT = path.resolve(OS, "..");
const changelog = () => readFileSync(path.join(VAULT, "CHANGELOG.md"), "utf8").replace(/\r\n/g, "\n");
const pkgVersion = () => (JSON.parse(readFileSync(path.join(OS, "package.json"), "utf8")) as { version: string }).version;

/** The first `## <version> (<date>)` heading. */
export function topVersion(text: string): { version: string; date: string } | null {
  const m = /^## (\d+\.\d+\.\d+) \((\d{4}-\d{2}-\d{2})\)$/m.exec(text);
  return m ? { version: m[1]!, date: m[2]! } : null;
}
/** Every pull-request citation, and anything that looks like one but is malformed ("PR 12", "#12a", "# 12" in text). */
export function citations(text: string): { good: number[]; bad: string[] } {
  const body = text.split("\n").filter((l) => !/^#{1,6} /.test(l)).join("\n"); // headings are not citations
  const good = [...body.matchAll(/(?<![\w&])#(\d+)\b(?![\w-])/g)].map((m) => Number(m[1]));
  const bad = [
    ...[...body.matchAll(/\bPRs? ?(\d+)\b/gi)].map((m) => m[0]),
    ...[...body.matchAll(/(?<![\w&])#(?!\d+\b)[\w-]+/g)].map((m) => m[0]),
    ...[...body.matchAll(/(?<![\w&])# \d+/g)].map((m) => m[0]),
  ];
  return { good, bad };
}

test("the newest CHANGELOG version is the version in os/package.json", () => {
  const top = topVersion(changelog());
  assert.ok(top, "CHANGELOG has a '## x.y.z (YYYY-MM-DD)' heading");
  assert.equal(top.version, pkgVersion());
  assert.ok(!Number.isNaN(Date.parse(top.date)), "the date is a real date");
  // The first version heading is the newest: no other version heading comes before it.
  const versions = [...changelog().matchAll(/^## (\d+\.\d+\.\d+) /gm)].map((m) => m[1]);
  assert.equal(versions[0], top.version);
});

test("every pull request is cited as #<number>, and there are citations to check", () => {
  const { good, bad } = citations(changelog());
  assert.deepEqual(bad, [], "malformed citations");
  assert.ok(good.length >= 40, `control: the citations were found (${good.length})`);
  assert.ok(good.every((n) => n >= 1 && n < 1000));
});

test("the checkers catch what they should (control)", () => {
  assert.equal(topVersion("# Changelog\n\n## 1.0.0 (2026-11-24)\n")?.version, "1.0.0");
  assert.equal(topVersion("## v1.0.0 (2026-11-24)\n"), null);
  assert.deepEqual(citations("built in PR 12 and #12a and # 13, fine in #14").bad, ["PR 12", "#12a", "# 13"]);
  assert.deepEqual(citations("see #4 and #55.").good, [4, 55]);
});

test("Home.md and docs/_index.md link the CHANGELOG", () => {
  for (const f of ["Home.md", path.join("docs", "_index.md")]) assert.match(readFileSync(path.join(VAULT, f), "utf8"), /\[\[CHANGELOG\]\]/, f);
});
