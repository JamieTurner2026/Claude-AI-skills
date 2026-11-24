// Dashboard accessibility check (11b): `npm run a11y`, run by hand like `npm run redteam:ui`.
// Copies the real vault to a temp folder (the smoke check's copier and guards), starts the real bridge on it with the fake
// CLI, gives every widget something to show (a run and a proposal), then runs axe-core in Chromium at desktop and phone
// size, plus a keyboard walk. Exit 0 when there is no serious or critical issue and the keyboard checks pass.
// Needs Playwright with Chromium (not an npm dependency) and axe-core (a pinned dev dependency).
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { TEMP_PREFIX, copyVault, planPaths, removeTemp } from "./smoke.ts";
import { createBridge } from "./server.ts";

type Violation = { id: string; impact: string | null; help: string; nodes: Array<{ target: string[]; failureSummary?: string }> };
type Page = {
  goto(u: string): Promise<unknown>; waitForTimeout(ms: number): Promise<void>; addScriptTag(o: { content: string }): Promise<unknown>;
  evaluate<T, A = undefined>(f: (a: A) => T | Promise<T>, a?: A): Promise<T>; keyboard: { press(k: string): Promise<void> };
  on(e: string, f: (m: { type(): string; text(): string }) => void): void;
};
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Browser = { newContext(o: Record<string, unknown>): Promise<Context>; close(): Promise<void> };
const req = createRequire(import.meta.url);
const { chromium, devices } = req("playwright") as { chromium: { launch(): Promise<Browser> }; devices: Record<string, Record<string, unknown>> };
const AXE = readFileSync(req.resolve("axe-core/axe.min.js"), "utf8");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VAULT = path.resolve(HERE, "..", "..");

async function main(): Promise<number> {
  const root = mkdtempSync(path.join(tmpdir(), TEMP_PREFIX));
  const plan = planPaths(VAULT, root);
  const failures: string[] = [];
  let b: ReturnType<typeof createBridge> | null = null;
  const browser = await chromium.launch();
  try {
    copyVault(VAULT, plan.copy);
    b = createBridge(plan.copyOs, { claudeBin: { cmd: process.execPath, prefixArgs: [path.join(HERE, "fake-claude.ts")] }, logDir: plan.logs, brainDbPath: plan.brainDb, schedulerOn: false });
    const bridge = b;
    await new Promise<void>((r) => bridge.server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(bridge.server.address() as AddressInfo).port}`;
    const token = bridge.mint();
    // A finished run and an uncited-answer proposal, so the Runs and Proposals widgets have rows to check.
    await fetch(`${base}/api/run`, { method: "POST", headers: { "content-type": "application/json", "x-superos": "1", authorization: `Bearer ${token}`, origin: base }, body: JSON.stringify({ text: "What does the vault say about servo alarms? BRAINANSWER", confirm: true }) });
    await new Promise((r) => setTimeout(r, 2500));

    for (const [name, opts] of [["desktop", { viewport: { width: 1280, height: 900 } }], ["phone", { ...devices["iPhone 13"] }]] as const) {
      // bypassCSP lets this audit inject axe-core; the bridge's own policy is untouched (redteam:ui relies on it).
      const ctx = await browser.newContext({ ...opts, bypassCSP: true });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      await page.goto(`${base}/?t=${encodeURIComponent(token)}`);
      await page.waitForTimeout(2500);
      await page.addScriptTag({ content: AXE });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run(o: unknown): Promise<{ violations: Violation[] }> } }).axe;
        const r = await axe.run({ runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] } });
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map((n) => ({ target: n.target, failureSummary: n.failureSummary })) }));
      });
      const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      console.log(`\n${name}: ${violations.length} rule(s) with issues, ${bad.length} serious or critical`);
      for (const v of violations) {
        console.log(`  ${(v.impact ?? "-").padEnd(9)} ${v.id}: ${v.help}`);
        for (const n of v.nodes) console.log(`            ${n.target.join(" ")}`);
      }
      for (const v of bad) failures.push(`${name}: ${v.id} (${v.impact})`);
      if (errors.length) failures.push(`${name}: console errors: ${errors.join(" | ").slice(0, 200)}`);

      if (name === "desktop") {
        // Keyboard: Tab reaches every widget's controls, each focused element shows a visible outline, and the
        // Proposals j/k keys still move the selection.
        const seen: Array<{ tag: string; name: string; widget: string; outline: boolean }> = [];
        for (let i = 0; i < 80; i++) {
          await page.keyboard.press("Tab");
          seen.push(await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            if (!el || el === document.body) return { tag: "body", name: "", widget: "", outline: false };
            const cs = getComputedStyle(el);
            const outline = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2) || cs.boxShadow !== "none";
            const widget = el.closest("[data-widget]")?.getAttribute("data-widget") ?? el.closest("header, .command, .health")?.className ?? "";
            const name = (el.getAttribute("aria-label") || el.textContent || (el as HTMLInputElement).placeholder || "").trim().slice(0, 40);
            return { tag: el.tagName.toLowerCase(), name, widget: String(widget), outline };
          }));
        }
        const widgets = [...new Set(seen.map((s) => s.widget).filter(Boolean))];
        console.log(`\nkeyboard: Tab reached ${widgets.join(", ")}`);
        const noOutline = seen.filter((s) => s.tag !== "body" && !s.outline);
        if (noOutline.length) failures.push(`keyboard: ${noOutline.length} focused element(s) without a visible outline, e.g. ${noOutline.slice(0, 3).map((s) => `${s.tag} "${s.name}"`).join(", ")}`);
        for (const w of ["directives", "routines", "skills", "runs", "proposals"]) if (!widgets.includes(w)) failures.push(`keyboard: Tab never reached the ${w} widget`);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    if (b) { b.runs.stopAll(); b.server.close(); }
    removeTemp(root);
  }
  console.log("");
  for (const f of failures) console.log(`FAIL  ${f}`);
  console.log(failures.length ? `${failures.length} problem(s).` : "PASS  no serious or critical accessibility issue on desktop or phone; keyboard reaches every widget with a visible focus outline.");
  return failures.length ? 1 : 0;
}

process.exitCode = await main();
