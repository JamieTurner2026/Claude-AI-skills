// Red-team browser check (11a): the dashboard shows hostile text as text, never as HTML.
// Starts the real bridge on a throwaway vault with the fake CLI, feeds hostile text in through a run request, a
// directive and an uncited-answer proposal, opens the dashboard in Chromium and checks that no script ran, no element
// was injected, and the hostile markup is visible literally. Needs Playwright with Chromium (not an npm dependency):
//   node bridge/redteam-ui.ts        (exit 0 when every check passes)
import { createRequire } from "node:module";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { HOSTILE_LINES } from "../shared/hostile.ts";
import { makeVault } from "./fixture.ts";
import { createBridge } from "./server.ts";

type Page = { goto(u: string): Promise<unknown>; waitForTimeout(ms: number): Promise<void>; evaluate<T>(f: () => T): Promise<T>; on(e: string, f: (m: { type(): string; text(): string }) => void): void };
type Browser = { newPage(): Promise<Page>; close(): Promise<void> };
const { chromium } = createRequire(import.meta.url)("playwright") as { chromium: { launch(): Promise<Browser> } };

const HERE = path.dirname(fileURLToPath(import.meta.url));
// What the page must show literally. NUL can't travel in a request body, so it is left out of the request text.
const SCRIPT_LINE = HOSTILE_LINES.find((l) => l.includes("<script>")) as string;
const SHOWN = [SCRIPT_LINE, ...HOSTILE_LINES.filter((l) => l !== SCRIPT_LINE)].join(" ").replace(/\u0000/g, "").replace(/A{6000}/, "A".repeat(40)).slice(0, 1800); // the script first: request text is capped

async function main(): Promise<number> {
  const vault = makeVault();
  // The bridge serves the dashboard from the vault's own os/ folder: give the throwaway vault the real app.
  for (const d of ["app", "shared"]) cpSync(path.join(HERE, "..", d), path.join(vault, "os", d), { recursive: true });
  // Every widget on the page, so every text they show is checked.
  const cfgFile = path.join(vault, "os", "config", "os.config.json");
  const cfg = JSON.parse(readFileSync(cfgFile, "utf8")) as { layout: unknown };
  cfg.layout = ["directives", "departments", "routines", "skills", "clock", "runs", "proposals", "setup"].map((widget) => ({ widget, span: 1 }));
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  writeFileSync(path.join(vault, "wiki", "directives.md"), `# Directives\n\n- [ ] ${SHOWN.replace(/[\u2028\u2029\u0085]/g, " ").slice(0, 280)}\n`);
  const b = createBridge(path.join(vault, "os"), { claudeBin: { cmd: process.execPath, prefixArgs: [path.join(HERE, "fake-claude.ts")] }, logDir: mkdtempSync(path.join(tmpdir(), "rt-ui-logs-")), schedulerOn: false });
  await new Promise<void>((r) => b.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(b.server.address() as AddressInfo).port}`;
  const token = b.mint();
  const post = (p: string, body: unknown) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", "x-superos": "1", authorization: `Bearer ${token}`, origin: base }, body: JSON.stringify(body) });
  // A question that reads the brain and names no note: it runs, and it leaves an "uncited" proposal quoting the request.
  const run = await post("/api/run", { text: `What does the vault say? BRAINANSWER ${SHOWN}`, confirm: true });
  console.log(`run request: ${run.status}`);
  await new Promise((r) => setTimeout(r, 2500));

  const browser = await chromium.launch();
  const failures: string[] = [];
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(`${base}/?t=${encodeURIComponent(token)}`);
    await page.waitForTimeout(3000);
    const r = await page.evaluate(() => {
      const w = window as unknown as { __pwned?: unknown };
      const text = document.body.innerText;
      return {
        pwned: w.__pwned ?? null,
        injected: document.querySelectorAll("#pwned, img[src='x'], a[href^='javascript'], untrusted-data, system").length,
        scripts: [...document.scripts].map((s) => s.src || "(inline)"),
        literalScript: text.includes("<script>window.__pwned=1</script>"),
        literalFence: text.includes("</untrusted-data>"),
        sections: [...document.querySelectorAll("section, .widget, [data-widget]")].length,
      };
    });
    console.log(JSON.stringify(r));
    if (r.pwned !== null) failures.push(`a hostile script ran (window.__pwned = ${String(r.pwned)})`);
    if (r.injected) failures.push(`${r.injected} hostile element(s) were created`);
    if (r.scripts.some((s) => !s.includes("/app/"))) failures.push(`unexpected script tags: ${r.scripts.join(", ")}`);
    if (!r.literalScript) failures.push("control failed: the hostile <script> text is not visible as text (did the run or directive render?)");
    if (!r.literalFence) failures.push("control failed: the fake closing fence is not visible as text");
    if (errors.length) failures.push(`console errors: ${errors.join(" | ").slice(0, 300)}`);
  } finally {
    await browser.close();
    b.runs.stopAll();
    b.server.close();
  }
  for (const f of failures) console.log(`FAIL  ${f}`);
  console.log(failures.length ? `${failures.length} check(s) failed.` : "PASS  the dashboard showed every hostile string as text: no script ran, no element was injected.");
  return failures.length ? 1 : 0;
}

process.exitCode = await main();
