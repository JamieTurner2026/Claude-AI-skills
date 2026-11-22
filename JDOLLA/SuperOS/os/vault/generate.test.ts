import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MARKER, NOTES_HEADING, buildAll, clean, mergeDaily, parseFront, safeTarget, VaultGuardError } from "./generate.ts";
import { NOW, SECRETS, TODAY, makeGenVault, outsideDir, put, snapshot } from "./fixture.ts";

const read = (vault: string, rel: string): string => readFileSync(path.join(vault, rel), "utf8");
function allFiles(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? allFiles(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]));
}

describe("each generated file, from a fixture vault", () => {
  const { vault, paths } = makeGenVault();
  const result = buildAll(paths, NOW);

  it("wrote the expected set, and left the unmarked hand-made indexes alone", () => {
    const by = Object.fromEntries(result.files.map((f) => [f.path, f.action]));
    assert.equal(by["wiki/_master-index.md"], "create");
    assert.equal(by["wiki/ai/_index.md"], "skipped");
    assert.equal(by["wiki/software/_index.md"], "skipped"); // fixture's one-word "generated" file has no marker
    assert.equal(by["reports/_index.md"], "create");
    assert.equal(by["projects/davidson.md"], "create");
    assert.equal(by[`daily/${TODAY}.md`], "create");
    assert.equal(result.date, TODAY);
  });
  it("wiki/_master-index.md: marker first, one line per department", () => {
    const t = read(vault, "wiki/_master-index.md");
    assert.equal(t.split("\n")[0], MARKER);
    assert.match(t, /- \[\[wiki\/ai\/_index\]\]: AI Research/);
    assert.match(t, /- \[\[wiki\/software\/_index\]\]: Software Engineering/);
    assert.ok(t.indexOf("wiki/ai/_index") < t.indexOf("wiki/software/_index"), "sorted by slug");
  });
  it("wiki/<dept>/_index.md: title, type, updated; skips _index.md itself and dot files", () => {
    // wiki/software/_index.md is the unmarked fixture file, so build a second vault where it does not exist.
    const v2 = makeGenVault();
    rmSync(path.join(v2.vault, "wiki/software/_index.md"));
    buildAll(v2.paths, NOW);
    const t = read(v2.vault, "wiki/software/_index.md");
    assert.equal(t.split("\n")[0], MARKER);
    assert.match(t, /- \[\[wiki\/software\/davidson\]\]: Davidson Blessons \(project, updated 2026-11-14\)/);
    assert.match(t, /- \[\[wiki\/software\/howto-deploy\]\]: How to deploy \(howto, updated 2026-11-12\)/);
    assert.match(t, /- \[\[wiki\/software\/a\]\]: a \(note\)/);
    assert.ok(!t.includes("_index]]: "), "does not list itself");
    assert.ok(!t.includes(".hidden") && !t.includes(SECRETS.env));
  });
  it("wiki/<dept>/_index.md: last used / never used from the brain's usage file (7c)", () => {
    const v2 = makeGenVault();
    rmSync(path.join(v2.vault, "wiki/software/_index.md"));
    const usageFile = path.join(outsideDir(), "usage.jsonl");
    writeFileSync(usageFile, JSON.stringify({ t: "2026-11-16T02:00:00.000Z", path: "wiki/software/davidson.md" }) + "\n");
    const before = snapshot(v2.vault);
    buildAll(v2.paths, NOW, { usageFile });
    const t = read(v2.vault, "wiki/software/_index.md");
    assert.match(t, /davidson\]\]: Davidson Blessons \(project, updated 2026-11-14\) · last used 2026-11-15/); // 21:00 New York the day before
    assert.match(t, /howto-deploy\]\]: How to deploy \(howto, updated 2026-11-12\) · never used/);
    // Jay's own notes are untouched; only generated files changed.
    const after = snapshot(v2.vault);
    for (const [rel, hash] of Object.entries(before)) {
      if (!rel.endsWith("_index.md") && !rel.startsWith("daily/") && !rel.startsWith("projects/") && !rel.startsWith("reports/_index")) assert.equal(after[rel], hash, rel);
    }
    assert.equal(readFileSync(usageFile, "utf8").split("\n").filter(Boolean).length, 1, "the generator only reads the usage file");
  });
  it("reports/_index.md: newest first", () => {
    const t = read(vault, "reports/_index.md");
    assert.ok(t.indexOf("2026-11-16 [[reports/2026-11-16_software_davidson-review]]") > 0);
    assert.ok(t.indexOf("2026-11-16 [[reports/2026-11-16") < t.indexOf("2026-11-15 [[reports/2026-11-15_plan-today]]"));
    assert.ok(!t.includes("[[reports/_index"), "not itself");
  });
  it("projects/<slug>.md: links the note, its raw files (folder and sources), outputs and reports; no bodies", () => {
    const t = read(vault, "projects/davidson.md");
    assert.match(t, /Wiki note: \[\[wiki\/software\/davidson\]\] \(updated 2026-11-14\)/);
    assert.match(t, /\[\[raw\/software\/davidson\/2026-11-14_snapshot\]\] \(2026-11-14\)/);
    assert.match(t, /\[\[raw\/strategy\/interview\/jay\]\]/); // via sources[]
    assert.match(t, /\[\[outputs\/2026-11\/2026-11-16_software_davidson-plan\]\]/);
    assert.match(t, /\[\[reports\/2026-11-16_software_davidson-review\]\]/);
    assert.ok(!t.includes("other") && !t.includes("plan-today") && !t.includes("sessions"));
    assert.equal(existsSync(path.join(vault, "projects/howto-deploy.md")), false, "only type: project notes get a hub");
    assert.equal(existsSync(path.join(vault, "projects/memory.md")), false);
  });
  it("daily/<today>.md: open directives, what changed today, today's reports, then ## Notes", () => {
    const t = read(vault, `daily/${TODAY}.md`);
    assert.equal(t.split("\n")[0], MARKER);
    assert.match(t, /^- Alpha thing$/m);
    assert.ok(!t.includes("Done thing"), "a ticked directive is not open");
    assert.match(t, /^- Beta os\/\.env thing$/m, "markup in a directive is flattened to text");
    assert.match(t, /\[\[wiki\/software\/a\]\]: a/);
    assert.ok(!t.includes("davidson]]: Davidson Blessons"), "unchanged notes are not 'changed today'");
    assert.match(t, /\[\[outputs\/2026-11\/2026-11-16_software_davidson-plan\]\]/);
    assert.ok(!t.includes("2026-11-10_software_other") && !t.includes("scratch"));
    assert.match(t, /\[\[reports\/2026-11-16_software_davidson-review\]\]: Davidson review/);
    assert.ok(t.endsWith(`\n${NOTES_HEADING}\n`));
  });
  it("the day is the owner's day, not UTC's (03:00Z on the 17th is still the 16th in New York)", () => {
    const v = makeGenVault();
    assert.equal(buildAll(v.paths, new Date("2026-11-17T03:00:00Z"), { dryRun: true }).date, "2026-11-16");
  });
  it("never copies a file body, and never reads .env, os/ or logs/", () => {
    for (const f of allFiles(vault).filter((p) => /^(wiki\/_master-index|wiki\/[a-z]+\/_index|reports\/_index|projects\/|daily\/)/.test(p))) {
      const t = read(vault, f);
      for (const s of Object.values(SECRETS)) assert.ok(!t.includes(s), `${f} must not contain ${s}`);
    }
  });
  it("copied titles cannot make links or markup", () => {
    const v = makeGenVault();
    rmSync(path.join(v.vault, "wiki/ai/_index.md"));
    buildAll(v.paths, NOW);
    const idx = read(v.vault, "wiki/ai/_index.md");
    assert.match(idx, /^- \[\[wiki\/ai\/memory\]\]: Memory os\/\.env x \(concept, updated 2026-11-01\)(?: · (?:never used|last used \d{4}-\d{2}-\d{2}))?$/m);
    assert.ok(!idx.includes("[[os/") && !idx.includes("<b>"));
    assert.equal(clean("a\n# b [[c]] <d>e</d> `f` | g"), "a # b c e f g");
    assert.ok(clean("x".repeat(500)).length <= 120);
  });
});

describe("## Notes is Jay's", () => {
  it("everything from ## Notes down stays byte for byte, even odd bytes and CRLF, while the top is rebuilt", () => {
    const { vault, paths } = makeGenVault();
    buildAll(paths, NOW);
    const file = path.join(vault, `daily/${TODAY}.md`);
    const jays = Buffer.concat([Buffer.from("line one\r\n  indented   \r\n\r\n"), Buffer.from([0xff, 0xfe, 0x00, 0x80]), Buffer.from("\n## Notes inside notes\n- [ ] his own task\n\n\n")]);
    const before = readFileSync(file);
    writeFileSync(file, Buffer.concat([before, jays]));
    // The top must change on the next build: add a directive.
    put(vault, "wiki/directives.md", "# Directives\n\n- [ ] Alpha thing\n- [ ] Brand new directive\n");
    const r = buildAll(paths, NOW);
    assert.equal(r.files.find((f) => f.path === `daily/${TODAY}.md`)?.action, "update");
    const after = readFileSync(file);
    assert.ok(after.toString("utf8").includes("Brand new directive"), "the generated top was rebuilt");
    const heading = Buffer.from(`\n${NOTES_HEADING}\n`);
    const tailOf = (b: Buffer): Buffer => b.subarray(b.indexOf(heading) + 1);
    assert.ok(tailOf(after).equals(tailOf(Buffer.concat([before, jays]))), "the Notes section is identical byte for byte");
  });
  it("a hand edit above ## Notes is replaced (that part is generated), a hand edit below never is", () => {
    const { vault, paths } = makeGenVault();
    buildAll(paths, NOW);
    const file = path.join(vault, `daily/${TODAY}.md`);
    writeFileSync(file, read(vault, `daily/${TODAY}.md`).replace("# 2026-11-16", "# 2026-11-16 EDITED ABOVE") + "MY NOTE\n");
    buildAll(paths, NOW);
    const t = readFileSync(file, "utf8");
    assert.ok(!t.includes("EDITED ABOVE"));
    assert.ok(t.endsWith("## Notes\nMY NOTE\n"));
  });
  it("a marked daily file with no ## Notes gets the heading added once at the end, then is stable", () => {
    const { vault, paths } = makeGenVault();
    const file = put(vault, `daily/${TODAY}.md`, `${MARKER}\n# stray\nno notes heading here`);
    const r1 = buildAll(paths, NOW);
    assert.equal(r1.files.find((f) => f.path === `daily/${TODAY}.md`)?.action, "update");
    const t1 = readFileSync(file, "utf8");
    assert.equal(t1, `${MARKER}\n# stray\nno notes heading here\n\n## Notes\n`);
    // Next run: the heading exists, the top is regenerated, and the file settles.
    buildAll(paths, NOW);
    const r3 = buildAll(paths, NOW);
    assert.equal(r3.files.find((f) => f.path === `daily/${TODAY}.md`)?.action, "unchanged");
    assert.equal((readFileSync(file, "utf8").match(/^## Notes$/gm) ?? []).length, 1);
  });
  it("mergeDaily keeps the tail exactly (unit)", () => {
    const old = Buffer.from("junk\n## Notes\r\nkeep\r\n");
    assert.equal(mergeDaily("TOP\n\n", old).toString(), "TOP\n\n## Notes\r\nkeep\r\n");
    assert.equal(mergeDaily("TOP\n\n", null).toString(), "TOP\n\n## Notes\n");
  });
});

describe("files we do not own", () => {
  it("unmarked files are never touched: indexes, reports index, a project hub and a daily note", () => {
    const { vault, paths } = makeGenVault();
    const mine = { "reports/_index.md": "my reports list\n", "projects/davidson.md": "# my own project page\n", [`daily/${TODAY}.md`]: "# my own day\n## Notes\nmine\n" };
    for (const [rel, text] of Object.entries(mine)) put(vault, rel, text, new Date("2020-01-01T00:00:00Z"));
    const before = snapshot(vault);
    const r = buildAll(paths, NOW);
    const after = snapshot(vault);
    for (const rel of [...Object.keys(mine), "wiki/ai/_index.md"]) {
      assert.equal(after[rel], before[rel], `${rel} must be untouched`);
      assert.equal(r.files.find((f) => f.path === rel)?.action, "skipped", rel);
    }
    // control: files we do own are still written
    assert.ok(existsSync(path.join(vault, "wiki/_master-index.md")));
  });
  it("the hand-made master index is replaced only if its first lines say 'Generated. Do not hand-edit.'", () => {
    const a = makeGenVault();
    put(a.vault, "wiki/_master-index.md", "# Master index\n\nGenerated. Do not hand-edit.\n\n- [[wiki/software/_index]]\n");
    buildAll(a.paths, NOW);
    assert.equal(read(a.vault, "wiki/_master-index.md").split("\n")[0], MARKER);
    const b = makeGenVault();
    const handMade = "# My master index\n\nI wrote this myself.\n";
    put(b.vault, "wiki/_master-index.md", handMade);
    const r = buildAll(b.paths, NOW);
    assert.equal(read(b.vault, "wiki/_master-index.md"), handMade);
    assert.equal(r.files.find((f) => f.path === "wiki/_master-index.md")?.action, "skipped");
  });
});

describe("writing", () => {
  it("unchanged content is not rewritten (mtime kept), and a second build changes nothing", () => {
    const { vault, paths } = makeGenVault();
    const first = buildAll(paths, NOW);
    assert.ok(first.counts.create >= 4);
    const gen = first.files.filter((f) => f.action === "create").map((f) => path.join(vault, f.path));
    const past = new Date("2001-01-01T00:00:00Z");
    for (const f of gen) utimesSync(f, past, past);
    const second = buildAll(paths, NOW);
    assert.equal(second.counts.create + second.counts.update, 0);
    for (const f of gen) assert.equal(statSync(f).mtimeMs, past.getTime(), `${f} was rewritten`);
  });
  it("dry run writes nothing at all but reports the same plan", () => {
    const { vault, paths } = makeGenVault();
    const before = snapshot(vault);
    const dry = buildAll(paths, NOW, { dryRun: true });
    assert.deepEqual(snapshot(vault), before);
    assert.equal(dry.dryRun, true);
    assert.ok(dry.counts.create >= 4);
    const real = buildAll(paths, NOW);
    assert.deepEqual(real.files, dry.files);
  });
  it("writes only under wiki/, reports/, projects/ and daily/; nothing else changes", () => {
    const { vault, paths } = makeGenVault();
    const before = snapshot(vault);
    buildAll(paths, NOW);
    const after = snapshot(vault);
    const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
    assert.ok(changed.length >= 4);
    for (const rel of changed) assert.match(rel, /^(wiki|reports|projects|daily)[\\/]/, rel);
    for (const rel of changed.filter((r) => r.startsWith("wiki"))) assert.match(rel.replace(/\\/g, "/"), /^wiki\/(_master-index\.md|[a-z]+\/_index\.md)$/, "no wiki note is ever changed");
    assert.deepEqual(Object.keys(before).filter((k) => !(k in after)), [], "nothing is deleted");
  });
  it("leaves no temp files behind", () => {
    const { vault, paths } = makeGenVault();
    buildAll(paths, NOW);
    assert.deepEqual(allFiles(vault).filter((f) => f.endsWith(".tmp")), []);
  });
});

describe("links out of the vault are refused", () => {
  it("control: safeTarget allows the four roots and refuses everything else", () => {
    const { vault } = makeGenVault();
    for (const ok of ["wiki/_master-index.md", "reports/_index.md", "projects/x.md", "daily/2026-11-16.md"]) assert.ok(safeTarget(path.resolve(vault), ok).endsWith(path.basename(ok)));
    for (const bad of ["os/x.md", "logs/x.md", "raw/x.md", "outputs/x.md", "depts/x.md", ".env", "wiki/../os/x.md", "wiki/.hidden/x.md", "../x.md", "wiki", "wiki//x.md"]) assert.throws(() => safeTarget(path.resolve(vault), bad), VaultGuardError, bad);
  });
  it("projects/ that is a link pointing outside: nothing written there, everything else still built", () => {
    const { vault, paths } = makeGenVault();
    const out = outsideDir();
    symlinkSync(out, path.join(vault, "projects"));
    const r = buildAll(paths, NOW);
    assert.deepEqual(readdirSync(out), [], "nothing was written outside the vault");
    assert.equal(r.files.find((f) => f.path === "projects/davidson.md")?.action, "skipped");
    assert.match(r.files.find((f) => f.path === "projects/davidson.md")?.reason ?? "", /link/);
    assert.equal(r.files.find((f) => f.path === "wiki/_master-index.md")?.action, "create");
  });
  it("a link inside the vault that leads to os/ is refused too", () => {
    const { vault, paths } = makeGenVault();
    rmSync(path.join(vault, "reports"), { recursive: true, force: true });
    symlinkSync(path.join(vault, "os"), path.join(vault, "reports"));
    const before = snapshot(path.join(vault, "os"));
    const r = buildAll(paths, NOW);
    assert.deepEqual(snapshot(path.join(vault, "os")), before);
    assert.equal(r.files.find((f) => f.path === "reports/_index.md")?.action, "skipped");
  });
  it("a generated file that is itself a link to an outside file is not followed", () => {
    const { vault, paths } = makeGenVault();
    const out = outsideDir();
    const target = path.join(out, "precious.md");
    writeFileSync(target, `${MARKER}\nprecious\n`);
    mkdirSync(path.join(vault, "projects"), { recursive: true });
    symlinkSync(target, path.join(vault, "projects/davidson.md"));
    const r = buildAll(paths, NOW);
    assert.equal(readFileSync(target, "utf8"), `${MARKER}\nprecious\n`);
    assert.equal(r.files.find((f) => f.path === "projects/davidson.md")?.action, "skipped");
  });
  it("a note that is a link is not listed or read", () => {
    const { vault, paths } = makeGenVault();
    const out = outsideDir();
    writeFileSync(path.join(out, "x.md"), `---\ntitle: ${SECRETS.env}\ntype: project\n---\n`);
    symlinkSync(path.join(out, "x.md"), path.join(vault, "wiki/ai/linked.md"));
    rmSync(path.join(vault, "wiki/ai/_index.md"));
    buildAll(paths, NOW);
    assert.ok(!read(vault, "wiki/ai/_index.md").includes("linked"));
    assert.equal(existsSync(path.join(vault, "projects/linked.md")), false);
  });
});

describe("parseFront", () => {
  it("reads title, type, updated and sources; odd input gives nothing, not an error", () => {
    assert.deepEqual(parseFront("---\ntitle: \"T\"\ntype: project\nupdated: 2026-01-01\nsources:\n  - raw/a.md\n  - raw/b.md\n---\nbody"), { title: "T", type: "project", updated: "2026-01-01", sources: ["raw/a.md", "raw/b.md"] });
    for (const bad of ["", "no frontmatter", "---\nnever closed", "---\n\u0000\u0001\n---\n"]) assert.doesNotThrow(() => parseFront(bad));
    assert.deepEqual(parseFront("---\ntitle: " + "x".repeat(400) + "\n---\n"), {});
  });
});
