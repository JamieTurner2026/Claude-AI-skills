// link_check: broken [[wikilinks]] in wiki/ and depts/, as the source path and the missing target. Never returns a body.
// A link is looked up only in the set of files the scanner found, so the link's text never touches the file system
// (a target like ../../etc/passwd is simply reported as missing). Links into places the tools never scan
// (os/, logs/, dot entries, raw/sessions, outputs/_work) are not judged. Links in code spans and fences are ignored.
import { z } from "zod";
import type { ScriptTool } from "./registry.ts";
import { DeptArg, GENERATED, TOP_FOLDERS, checkDept, clean, readBody, rootNotes, scanVault } from "./vault.ts";

const MAX_BROKEN = 100;
const IGNORED_TOPS = ["os", "logs"];

/** Wikilink targets in a note, without code fences and inline code, aliases (|x) and headings (#x). */
export function extractLinks(text: string): string[] {
  const noCode = text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^(```|~~~)[^\n]*$/gm, " ").replace(/`[^`\n]*`/g, " ");
  const out: string[] = [];
  const re = /\[\[([^\[\]\n|#]{1,300})(?:#[^\[\]\n|]*)?(?:\|[^\[\]\n]*)?\]\]/g;
  for (let m = re.exec(noCode); m; m = re.exec(noCode)) { const t = (m[1] ?? "").trim(); if (t) out.push(t); }
  return out;
}

export const linkCheck: ScriptTool = {
  name: "link_check",
  description: "Broken [[wikilinks]] in wiki/ and depts/: the note that has the link and the missing target. Optional dept limits it to one department. Names only, never contents.",
  input: z.object({ dept: DeptArg }).strict(),
  inputSchema: { type: "object", properties: { dept: { type: "string", description: "Department slug, for example industrial" } }, additionalProperties: false },
  run(input, ctx) {
    const { dept } = input as { dept?: string };
    const check = checkDept(ctx.vault, dept);
    if (!check.ok) return { error: check.error };
    const { files, truncated } = scanVault(ctx.vault, TOP_FOLDERS);
    // Everything a link may point at, lower-cased (Obsidian and Windows ignore case): full paths with and without .md, and bare note names.
    const exact = new Set<string>();
    const bare = new Set<string>();
    const add = (rel: string): void => {
      exact.add(rel.toLowerCase());
      if (rel.toLowerCase().endsWith(".md")) { exact.add(rel.slice(0, -3).toLowerCase()); bare.add(rel.slice(rel.lastIndexOf("/") + 1, -3).toLowerCase()); }
    };
    for (const f of files) add(f.rel);
    for (const n of rootNotes(ctx.vault)) add(n);
    const sources = files.filter((f) => {
      if (!f.rel.toLowerCase().endsWith(".md") || GENERATED.has(f.rel.slice(f.rel.lastIndexOf("/") + 1))) return false;
      if (f.top !== "wiki" && f.top !== "depts") return false;
      return dept === undefined || f.rel.startsWith(`wiki/${dept}/`) || f.rel === `depts/${dept}.md`;
    });
    const broken: Array<{ source: string; target: string }> = [];
    let total = 0;
    for (const f of sources) {
      let body: string | null = null;
      try { body = readBody(ctx.vault, f.rel); } catch { body = null; }
      if (body === null) continue;
      const seen = new Set<string>();
      for (const raw of extractLinks(body)) {
        const target = raw.replace(/\\/g, "/").replace(/^\/+/, "");
        const key = target.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const top = key.split("/")[0] ?? "";
        const isDotEntry = top.startsWith(".") && top !== "." && top !== ".."; // .env, .git: never scanned, so not judged (".." is just a broken path)
        if (IGNORED_TOPS.includes(top) || isDotEntry || key.startsWith("raw/sessions/") || key.startsWith("outputs/_work/")) continue; // not scanned, so not judged
        const found = key.includes("/") || key.includes("..") ? exact.has(key) && !key.split("/").includes("..") : exact.has(key) || bare.has(key);
        if (found) continue;
        total++;
        if (broken.length < MAX_BROKEN) broken.push({ source: f.rel, target: clean(target, 200) });
      }
    }
    return { checked: sources.length, total, truncated: total > MAX_BROKEN || truncated, broken };
  },
};
