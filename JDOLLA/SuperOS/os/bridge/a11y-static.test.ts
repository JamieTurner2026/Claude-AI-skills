// Accessibility rules the dashboard source must keep (11b). Static, so it runs in CI on both OSes; the full check with
// axe-core in a browser is `npm run a11y` (run by hand). Every button needs a name: text inside it or an aria-label.
// Every text box and tick box needs an aria-label (or a <label for>). Live regions are polite, never assertive.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app");
const sources = (): Array<{ file: string; code: string }> => {
  const out: Array<{ file: string; code: string }> = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith(".ts")) out.push({ file: path.relative(APP, f).split(path.sep).join("/"), code: readFileSync(f, "utf8").replace(/\r\n/g, "\n") });
    }
  };
  walk(APP);
  return out;
};

/** The top-level arguments of every `h("<tag>", ...)` call, found by matching brackets (strings and templates skipped). */
export function calls(code: string, tag: string): string[][] {
  const found: string[][] = [];
  const start = `h("${tag}",`;
  for (let i = code.indexOf(start); i >= 0; i = code.indexOf(start, i + 1)) {
    const args: string[] = [];
    let depth = 0, cur = "", j = i + 2; // just after "h("
    let quote: string | null = null;
    for (; j < code.length; j++) {
      const c = code[j]!;
      if (quote) { cur += c; if (c === "\\") { cur += code[++j] ?? ""; continue; } if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'" || c === "`") { quote = c; cur += c; continue; }
      if (c === "(" || c === "{" || c === "[") depth++;
      if (c === ")" || c === "}" || c === "]") { if (depth === 0) break; depth--; }
      if (c === "," && depth === 0) { args.push(cur.trim()); cur = ""; continue; }
      cur += c;
    }
    if (cur.trim()) args.push(cur.trim());
    found.push(args.slice(1)); // drop the tag itself
  }
  return found;
}
const named = (attrs: string): boolean => /["']?aria-label(ledby)?["']?\s*:/.test(attrs);
const where = (file: string, args: string[]) => `${file}: h(${args.join(", ").replace(/\s+/g, " ").slice(0, 110)}…)`;

test("every button has a name: text inside it or an aria-label", () => {
  let count = 0;
  for (const { file, code } of sources()) {
    for (const args of calls(code, "button")) {
      count++;
      const [attrs = "{}", ...children] = args;
      const hasText = children.some((c) => c !== "" && c !== '""' && c !== "''" && c !== "``");
      // A button whose only text is a symbol ("‹", "×", "✓") says nothing to a screen reader: it needs an aria-label.
      const symbolOnly = children.length > 0 && children.every((c) => /^(["'`])[^\p{L}\p{N}]*\1$/u.test(c));
      assert.ok((hasText && !symbolOnly) || named(attrs), `button without a name in ${where(file, args)}`);
    }
  }
  assert.ok(count >= 15, `control: the buttons were found (${count})`);
  const html = readFileSync(path.join(APP, "index.html"), "utf8");
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    assert.ok(m[2]!.replace(/<[^>]*>/g, "").trim() || /aria-label=/.test(m[1]!), `index.html button without a name: ${m[0].slice(0, 80)}`);
  }
});

test("every text box and tick box has an aria-label or a <label for>", () => {
  const html = readFileSync(path.join(APP, "index.html"), "utf8");
  const labelled = new Set([...html.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]));
  let count = 0;
  for (const { file, code } of sources()) {
    for (const tag of ["input", "textarea", "select"]) {
      for (const args of calls(code, tag)) {
        count++;
        const attrs = args[0] ?? "{}";
        const id = /\bid:\s*"([^"]+)"/.exec(attrs)?.[1];
        assert.ok(named(attrs) || (id !== undefined && labelled.has(id)), `${tag} without a label in ${where(file, args)}`);
      }
    }
  }
  assert.ok(count >= 3, `control: the inputs were found (${count})`);
  for (const m of html.matchAll(/<input\b([^>]*)>/g)) {
    const id = /\bid="([^"]+)"/.exec(m[1]!)?.[1];
    assert.ok(/aria-label=/.test(m[1]!) || (id !== undefined && labelled.has(id)), `index.html input without a label: ${m[0].slice(0, 80)}`);
  }
});

test("there is one h1, live regions are polite, and the Runs output is a focusable log", () => {
  const html = readFileSync(path.join(APP, "index.html"), "utf8");
  assert.equal(html.match(/<h1\b/g)?.length, 1);
  const all = sources().map((s) => s.code).join("\n") + html;
  assert.ok(!/aria-live["']?\s*[:=]\s*["']assertive/.test(all), "no assertive live region");
  assert.match(html, /id="health-live" aria-live="polite"/);
  const runs = sources().find((s) => s.file === "widgets/runs.ts")!.code;
  assert.match(runs, /h\("pre", \{ role: "log", "aria-live": "polite"[^}]*tabindex: "0"/);
  assert.ok(!/out\.textContent = \(\(out\.textContent/.test(runs), "streamed output is appended, never rewritten (a rewrite re-reads it all)");
});

test("text colours reach AA (4.5:1) on the darkest and lightest backgrounds they sit on", () => {
  const css = readFileSync(path.join(APP, "styles.css"), "utf8");
  const token = (n: string) => new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1] ?? "";
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
  const lum = (c: [number, number, number]) => { const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a: [number, number, number], b: [number, number, number]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number]; return (x + 0.05) / (y + 0.05); };
  const over = (fg: [number, number, number], bg: [number, number, number], a: number) => fg.map((v, i) => v * a + bg[i]! * (1 - a)) as [number, number, number];
  const bgs = ["bg", "surface", "surface-2"].map((n) => rgb(token(n)));
  const dim = bgs.map((b) => over(rgb(token("accent")), b, 0.14)); // --accent-dim (14% accent) over each surface
  for (const n of ["text", "muted", "accent-text", "t2", "t3", "warn"]) {
    for (const b of n === "accent-text" ? [...bgs, ...dim] : bgs) assert.ok(ratio(rgb(token(n)), b) >= 4.5, `--${n} is under 4.5:1 on a background (${ratio(rgb(token(n)), b).toFixed(2)})`);
  }
  assert.ok(ratio(rgb(token("accent")), dim[2]!) < 4.5, "control: plain --accent on accent-dim is under AA, which is why text uses --accent-text");
  assert.ok(!/(?<![-\w])color: var\(--accent\);/.test(css.replace(/\.brand #brand \{[^}]*\}/, "")), "text uses --accent-text, not --accent (borders and rings may use --accent)");
});
