// The fake CLI's command line is read back from a file, so it works however long the command line is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { argvFromOutput } from "./fake-argv.ts";
import { makeVault } from "./fixture.ts";
import { createBridge } from "./server.ts";

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-claude.ts");

test("a 20,000-character prompt (far past RunInfo.output's 4000-character window) still comes back whole", async () => {
  const vault = makeVault();
  const b = createBridge(path.join(vault, "os"), { claudeBin: { cmd: process.execPath, prefixArgs: [fake] }, logDir: mkdtempSync(path.join(tmpdir(), "fa-")) });
  try {
    const prompt = `START ${"x".repeat(20_000)} END`;
    const info = b.runs.start({ text: prompt, tier: "T2" });
    await new Promise<void>((r) => { b.runs.subscribe(info.id, (e) => { if (e.type === "status" && e.status !== "running") r(); }); });
    const out = b.runs.get(info.id)!.output;
    assert.ok(out.length <= 4000, "the output really is windowed");
    const argv = argvFromOutput(out);
    assert.equal(argv[argv.indexOf("-p") + 1], prompt, "the whole prompt, start and end");
    assert.ok(argv.includes("--max-budget-usd") && argv.includes("--tools"), "and the flags");
  } finally { b.runs.stopAll(); }
});

test("argvFromOutput says so when there is no argv file, instead of returning something plausible", () => {
  assert.throws(() => argvFromOutput("All done.\n"), /no ARGVFILE line/);
  assert.throws(() => argvFromOutput(""), /no ARGVFILE line/);
});
