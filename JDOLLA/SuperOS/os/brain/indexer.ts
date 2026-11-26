// Builds the FTS5 index from wiki/ and raw/. Every file passes the bridge guards before it is read.
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { z } from "zod";
import { GuardError } from "../bridge/guards.ts";
import { chunkMarkdown } from "./chunker.ts";
import { BRAIN_EXT, BRAIN_ROOTS, isTrusted, readBrainFile, toVaultRel } from "./files.ts";
import { buildGraph, type GraphNote, type GraphStats } from "./graph.ts";
import { createSchema, verifyIndex } from "./schema.ts";

const Front = z.object({
  title: z.coerce.string().max(300).optional(),
  dept: z.coerce.string().max(40).optional(),
  type: z.coerce.string().max(40).optional(),
  updated: z.coerce.string().max(40).optional(),
}).partial();

export function parseFrontmatter(text: string): { front: z.infer<typeof Front>; body: string } {
  const m = /^---\r?\n([\s\S]{0,4000}?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { front: {}, body: text };
  const raw: Record<string, string> = {};
  for (const line of (m[1] ?? "").split(/\r?\n/)) {
    const kv = /^([A-Za-z_]{1,20}):[ \t]*(.{0,300})$/.exec(line);
    if (kv?.[1] && kv[2] !== undefined) raw[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  const parsed = Front.safeParse(raw);
  return { front: parsed.success ? parsed.data : {}, body: text.slice(m[0].length) };
}

export function defaultIndexPath(): string {
  const dir = process.env["SUPEROS_BRAIN_DIR"] ?? path.join(process.env["USERPROFILE"] ?? process.env["HOME"] ?? ".", ".superos", "brain");
  return path.join(dir, "index.sqlite");
}

/** Lists candidate files. Dot-entries are skipped and links are never followed; guards still re-check each file. */
function* walk(vaultRoot: string, root: string): Generator<string> {
  const stack = [path.join(vaultRoot, root)];
  while (stack.length) {
    const cur = stack.pop() as string;
    if (!existsSync(cur)) continue;
    for (const e of readdirSync(cur, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && BRAIN_EXT.has(path.extname(e.name).toLowerCase())) yield full;
    }
  }
}

export interface IndexStats { files: number; chunks: number; skipped: number; untrustedFiles: number; graph?: GraphStats }

/** opts.graph false skips the graph (the bench uses it to measure the graph's cost); default true. */
export function indexVault(db: DatabaseSync, vault: string, opts: { graph?: boolean } = {}): IndexStats {
  const vaultRoot = realpathSync(vault);
  const stats: IndexStats = { files: 0, chunks: 0, skipped: 0, untrustedFiles: 0 };
  const insDoc = db.prepare("INSERT INTO documents(path, chunk, heading, dept, type, title, updated, trusted, text) VALUES (?,?,?,?,?,?,?,?,?)");
  const insFts = db.prepare("INSERT INTO docs_fts(rowid, path, dept, type, title, heading, updated, text, trusted) VALUES (?,?,?,?,?,?,?,?,?)");
  const graphNotes: GraphNote[] = [];
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM documents; DELETE FROM docs_fts;");
    for (const root of BRAIN_ROOTS) {
      for (const file of walk(vaultRoot, root)) {
        const rel = toVaultRel(vaultRoot, file);
        let text: string;
        try { text = readBrainFile(vaultRoot, rel).text; } catch (e) {
          if (e instanceof GuardError) { stats.skipped++; continue; }
          throw e;
        }
        const { front, body } = parseFrontmatter(text);
        const segs = rel.split("/");
        const title = front.title || /^#[ \t]+(.{1,200})$/m.exec(body)?.[1]?.trim() || path.basename(rel, path.extname(rel));
        const dept = front.dept || segs[1] || "";
        const type = front.type || (root === "raw" ? "source" : "note");
        const updated = front.updated || "";
        const trusted = isTrusted(rel) ? 1 : 0;
        const chunks = chunkMarkdown(body, title);
        if (!chunks.length) continue;
        stats.files++;
        if (!trusted) stats.untrustedFiles++;
        graphNotes.push({ rel, trusted: trusted === 1, text, type });
        chunks.forEach((c, i) => {
          const r = insDoc.run(rel, i, c.heading, dept, type, title, updated, trusted, c.text);
          insFts.run(r.lastInsertRowid, rel, dept, type, title, c.heading, updated, c.text, trusted);
          stats.chunks++;
        });
      }
    }
    if (opts.graph !== false) stats.graph = buildGraph(db, graphNotes);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return stats;
}

/** Opens a healthy index for writing, or deletes a missing/corrupt one and starts fresh. */
export function openOrCreateIndex(dbPath: string): { db: DatabaseSync; recreated: boolean } {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  if (existsSync(dbPath)) {
    try {
      const db = new DatabaseSync(dbPath);
      try { verifyIndex(db); return { db, recreated: false }; } catch (e) { db.close(); throw e; }
    } catch { /* fall through: rebuild */ }
    for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(dbPath + suffix, { force: true });
  }
  const db = new DatabaseSync(dbPath);
  createSchema(db);
  return { db, recreated: true };
}

export function rebuildIndex(vault: string, dbPath: string, opts: { graph?: boolean } = {}): IndexStats & { recreated: boolean } {
  const { db, recreated } = openOrCreateIndex(dbPath);
  try {
    const s = indexVault(db, vault, opts);
    return { ...s, recreated };
  } finally { db.close(); }
}
