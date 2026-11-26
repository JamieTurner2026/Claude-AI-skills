// The PC rehearsal's own guards (bridge/pc-rehearsal.ts): saved logs never hold the runner's paths or user name, the test
// count is read from either reporter, and the workflow stays manual/weekly, read-only, secret-free and pinned.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scrub, secretsFor, summary, testCounts, variants } from "./pc-rehearsal.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

test("scrub removes the work folder, home and user name in every spelling, longest first", () => {
  const secrets = secretsFor("C:\\Users\\runneradmin\\AppData\\Local\\Temp\\reh", "C:\\Users\\runneradmin", "runneradmin");
  const log = [
    "cloned into C:\\Users\\runneradmin\\AppData\\Local\\Temp\\reh\\pc",
    "json: \"C:\\\\Users\\\\runneradmin\\\\AppData\\\\Local\\\\Temp\\\\reh\\\\home\"",
    "posix: C:/Users/runneradmin/AppData/Local/Temp/reh/x and c:\\users\\RUNNERADMIN\\npm",
    "short: C:\\Users\\RUNNER~1\\AppData; user runneradmin",
  ].join("\n");
  const out = scrub(log, secrets);
  assert.doesNotMatch(out, /runneradmin|RUNNER~1/i);
  assert.match(out, /cloned into <work>\\pc/);
  assert.match(out, /posix: <work>\/x and <home>\\npm/);
  assert.equal(scrub(log, []), log, "control: with nothing to scrub the log is unchanged");
  assert.ok(variants("C:\\a\\b").includes("C:/a/b") && variants("C:\\a\\b").includes("C:\\\\a\\\\b"));
});

test("the test count comes from the TAP line or the terminal's spec line, and a missing count is not a pass", () => {
  assert.deepEqual(testCounts("ok 1\n# pass 603\n# fail 0\n"), { pass: 603, fail: 0 });
  assert.deepEqual(testCounts("ℹ pass 12\nℹ fail 1\n"), { pass: 12, fail: 1 });
  assert.equal(testCounts("all good, trust me"), null);
});

test("the summary lists every step with its result and only the notes that matter", () => {
  const md = summary([
    { n: "1", name: "npm run update", doc: "START-HERE 1", result: "PASS", exit: 0, seconds: 3, notes: ["ok: it exits 0"] },
    { n: "4", name: "npm run brain -- index --embeddings", doc: "START-HERE 4", result: "SKIP", exit: null, seconds: 0, notes: ["STUB: skipped"] },
    { n: "6", name: "npm run autostart", doc: "START-HERE 6", result: "FAIL", exit: 2, seconds: 1, notes: ["FAIL: usage"] },
  ]);
  assert.match(md, /1 passed, 1 failed, 1 skipped/);
  assert.match(md, /\| 1 \| PASS \| `npm run update` \| START-HERE 1 \| as documented \|/);
  assert.match(md, /\| 6 \| FAIL \|.*FAIL: usage/);
});

test("the workflow: manual and weekly, windows-latest, contents read, no secrets, pinned actions, uploads the logs", () => {
  const y = readFileSync(path.join(REPO, ".github", "workflows", "pc-rehearsal.yml"), "utf8").replace(/\r\n/g, "\n"); // Windows checks out CRLF
  assert.match(y, /workflow_dispatch:/);
  assert.match(y, /schedule:\n\s+- cron: "[^"]+"/);
  assert.match(y, /runs-on: windows-latest/);
  assert.match(y, /permissions:\n\s+contents: read/);
  assert.doesNotMatch(y, /secrets\./, "no secrets");
  assert.match(y, /persist-credentials: false/);
  const uses = [...y.matchAll(/uses: (\S+)/g)].map((m) => m[1]!);
  assert.ok(uses.length >= 3, `control: found ${uses.length} actions`);
  for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `${u} is pinned to a full commit`);
  assert.match(y, /actions\/upload-artifact@/);
  assert.match(y, /if: always\(\)/, "the logs are uploaded even when a step fails");
  assert.match(y, /bridge\/pc-rehearsal\.ts/);
});
