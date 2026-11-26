// os/config/os.local.json (found by the PC rehearsal): PC-SETUP §1 used to tell an npm-install PC to put claudeBin in the
// tracked os.config.json, and then `npm run update` refused every pull ("You have local changes"). This PC's own settings
// now live in a git-ignored file, which wins over os.config.json and is never written back into it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claudeBinSetting, loadConfig, loadLocalConfig, localConfigPath, pathsFor, saveConfig } from "./config.ts";
import { defaultDeps } from "./doctor-cli.ts";

const OS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A throwaway os/ folder holding a copy of the real config. */
function tempOs(): ReturnType<typeof pathsFor> {
  const os = path.join(mkdtempSync(path.join(tmpdir(), "local-config-")), "os");
  mkdirSync(path.join(os, "config"), { recursive: true });
  cpSync(path.join(OS, "config", "os.config.json"), path.join(os, "config", "os.config.json"));
  return pathsFor(os);
}

test("no os.local.json: the setting comes from os.config.json, or there is none (PATH)", () => {
  const p = tempOs();
  assert.deepEqual(loadLocalConfig(p), {});
  assert.equal(claudeBinSetting(p, loadConfig(p)), undefined);
  const c = loadConfig(p);
  c.engine.claudeBin = "C:\\old\\cli.js";
  assert.equal(claudeBinSetting(p, c), "C:\\old\\cli.js", "an older PC that set it in os.config.json keeps working");
});

test("os.local.json wins, the doctor reads it, and saving os.config.json never copies it in", () => {
  const p = tempOs();
  const bin = path.join(p.os, "cli.js");
  writeFileSync(bin, "");
  writeFileSync(localConfigPath(p), JSON.stringify({ claudeBin: bin }));
  const c = loadConfig(p);
  assert.equal(claudeBinSetting(p, c), bin);
  assert.equal(defaultDeps(p.os).claudeBinFromConfig(), bin);
  saveConfig(p, c); // what the Routines and Skills widgets do when they change a setting
  assert.equal((JSON.parse(readFileSync(p.config, "utf8")) as { engine: Record<string, unknown> }).engine["claudeBin"], undefined);
});

test("a wrong os.local.json is an error, never silently ignored", () => {
  const p = tempOs();
  writeFileSync(localConfigPath(p), JSON.stringify({ claudebin: "typo" }));
  assert.throws(() => loadLocalConfig(p), /claudebin|Unrecognized/);
  writeFileSync(localConfigPath(p), "{ not json");
  assert.throws(() => loadLocalConfig(p));
  assert.equal(defaultDeps(p.os).claudeBinFromConfig(), undefined, "the doctor then reports the CLI as not set, rather than crashing");
});

test("git ignores os/config/os.local.json, so setting it leaves the tree clean for npm run update", () => {
  const r = spawnSync("git", ["check-ignore", "--no-index", "-q", path.join("config", "os.local.json")], { cwd: OS });
  assert.equal(r.status, 0, "os/config/os.local.json is git-ignored");
  const control = spawnSync("git", ["check-ignore", "--no-index", "-q", path.join("config", "os.config.json")], { cwd: OS });
  assert.equal(control.status, 1, "control: the tracked config is not ignored");
});
