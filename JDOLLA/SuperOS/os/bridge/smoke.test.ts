import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SmokeGuardError, TEMP_PREFIX, copyVault, planPaths, removeTemp, runSmoke } from "./smoke.ts";
import { defaultIndexPath } from "../brain/indexer.ts";

const REAL_VAULT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Hash and mtime of every file under dir, except dependencies and git history. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      const rel = path.relative(dir, f);
      if (rel === path.join("os", "node_modules") || rel === ".git") continue;
      if (e.isDirectory()) walk(f);
      else if (e.isFile()) out[rel] = `${createHash("sha256").update(readFileSync(f)).digest("hex")}@${statSync(f).mtimeMs}`;
      else out[rel] = "link";
    }
  };
  walk(dir);
  return out;
}
const smokeTemps = (base = tmpdir()) => readdirSync(base).filter((n) => n.startsWith(TEMP_PREFIX));

describe("npm run smoke", () => {
  it("passes every step on the real vault, deletes its temp copy and leaves the real vault, logs and brain index untouched", async () => {
    const before = snapshot(REAL_VAULT);
    const brainBefore = existsSync(defaultIndexPath());
    const tempsBefore = smokeTemps();
    const r = await runSmoke({ vault: REAL_VAULT });
    assert.equal(r.ok, true, r.steps.filter((s) => !s.ok).map((s) => `${s.name}: ${s.detail}`).join("; "));
    for (const name of ["copy vault", "start bridge", "GET /api/state", "GET /api/runs", "GET /api/routines", "GET /api/skills", "GET /api/proposals", "GET /api/inbox", "T2 run (fake CLI)", "POST /api/vault/rebuild", "brain index", "brain search"]) {
      assert.ok(r.steps.some((s) => s.name === name && s.ok), name);
    }
    assert.equal(r.cleanedUp, true);
    assert.equal(existsSync(r.tempRoot), false, "temp copy left behind");
    assert.deepEqual(smokeTemps(), tempsBefore);
    assert.deepEqual(snapshot(REAL_VAULT), before, "the real vault changed");
    assert.equal(existsSync(defaultIndexPath()), brainBefore, "the real brain index was created or removed");
  });

  for (const failAt of ["copy vault", "start bridge", "GET /api/state", "T2 run (fake CLI)", "brain search"]) {
    it(`a failure at "${failAt}" is reported and the temp copy is still deleted`, async () => {
      const r = await runSmoke({ vault: REAL_VAULT, failAt });
      assert.equal(r.ok, false);
      assert.equal(r.steps.find((s) => s.name === failAt)?.ok, false);
      assert.equal(r.cleanedUp, true);
      assert.equal(existsSync(r.tempRoot), false, "temp copy left behind after a failure");
    });
  }

  it("refuses a temp base inside the vault before creating anything", async () => {
    const vault = mkdtempSync(path.join(tmpdir(), "smoke-fixture-vault-"));
    mkdirSync(path.join(vault, "scratch"));
    const before = snapshot(vault);
    const r = await runSmoke({ vault, tmpBase: path.join(vault, "scratch") });
    assert.equal(r.ok, false);
    assert.match(r.steps[0]?.detail ?? "", /inside the vault/);
    assert.deepEqual(snapshot(vault), before, "something was written into the vault");
    assert.deepEqual(readdirSync(path.join(vault, "scratch")), []);
    rmSync(vault, { recursive: true, force: true });
  });
});

describe("smoke guards", () => {
  const vault = mkdtempSync(path.join(tmpdir(), "smoke-guard-vault-"));

  it("planPaths keeps every write inside the temp root and away from the vault", () => {
    const good = mkdtempSync(path.join(tmpdir(), TEMP_PREFIX));
    const p = planPaths(vault, good);
    for (const x of [p.copy, p.copyOs, p.logs, p.brainDb]) assert.ok(x.startsWith(p.root + path.sep), x); // control
    const inside = path.join(vault, `${TEMP_PREFIX}x`);
    mkdirSync(inside);
    assert.throws(() => planPaths(vault, inside), SmokeGuardError, "temp root inside the vault");
    const outer = mkdtempSync(path.join(tmpdir(), TEMP_PREFIX));
    const nested = path.join(outer, "vault");
    mkdirSync(nested);
    assert.throws(() => planPaths(nested, outer), SmokeGuardError, "vault inside the temp root");
    const plain = mkdtempSync(path.join(tmpdir(), "not-smoke-"));
    assert.throws(() => planPaths(vault, plain), SmokeGuardError, "a folder smoke did not make");
    for (const d of [good, outer, plain]) rmSync(d, { recursive: true, force: true });
  });

  it("removeTemp deletes only a smoke folder directly under the temp base", () => {
    const mine = mkdtempSync(path.join(tmpdir(), TEMP_PREFIX));
    writeFileSync(path.join(mine, "f"), "x");
    assert.equal(removeTemp(mine), true); // control
    assert.equal(existsSync(mine), false);
    const other = mkdtempSync(path.join(tmpdir(), "keep-me-"));
    assert.throws(() => removeTemp(other), SmokeGuardError);
    assert.equal(existsSync(other), true);
    const deep = path.join(other, `${TEMP_PREFIX}deep`);
    mkdirSync(deep);
    assert.throws(() => removeTemp(deep), SmokeGuardError, "not directly under the temp base");
    assert.equal(existsSync(deep), true);
    const link = path.join(tmpdir(), `${TEMP_PREFIX}link-${process.pid}`);
    symlinkSync(other, link);
    assert.throws(() => removeTemp(link), SmokeGuardError, "a link");
    assert.equal(existsSync(other), true);
    rmSync(link, { force: true });
    rmSync(other, { recursive: true, force: true });
  });

  it("copyVault skips dependencies, history, logs, the secret, imported sessions, .env files and links", () => {
    const src = mkdtempSync(path.join(tmpdir(), "smoke-src-"));
    const put = (rel: string, t = "x") => { mkdirSync(path.dirname(path.join(src, rel)), { recursive: true }); writeFileSync(path.join(src, rel), t); };
    for (const rel of ["CLAUDE.md", "wiki/a.md", "os/config/os.config.json", "os/.env.example", "os/node_modules/zod/index.js", ".git/HEAD", "logs/router.jsonl", "os/.cache/secret", "raw/sessions/s.md", "raw/x/keep.md", "os/.env", ".env", "wiki/.env.local"]) put(rel);
    symlinkSync(path.join(src, "os/.env"), path.join(src, "wiki/link.md"));
    const dest = path.join(mkdtempSync(path.join(tmpdir(), "smoke-dest-")), "vault");
    copyVault(src, dest);
    for (const kept of ["CLAUDE.md", "wiki/a.md", "os/config/os.config.json", "os/.env.example", "raw/x/keep.md"]) assert.ok(existsSync(path.join(dest, kept)), `kept ${kept}`);
    for (const gone of ["os/node_modules", ".git", "logs", "os/.cache", "raw/sessions", "os/.env", ".env", "wiki/.env.local", "wiki/link.md"]) assert.equal(existsSync(path.join(dest, gone)), false, `skipped ${gone}`);
    rmSync(src, { recursive: true, force: true });
    rmSync(path.dirname(dest), { recursive: true, force: true });
  });
});
