// SQLite schema for the brain index. documents holds one row per chunk; docs_fts is the search table.
import { DatabaseSync } from "node:sqlite";

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL,
  chunk INTEGER NOT NULL,
  heading TEXT NOT NULL,
  dept TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  updated TEXT NOT NULL,
  trusted INTEGER NOT NULL CHECK (trusted IN (0, 1)),
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_path ON documents(path);
CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
  path UNINDEXED, dept UNINDEXED, type UNINDEXED, title, heading, updated UNINDEXED, text, trusted UNINDEXED,
  tokenize = 'porter unicode61'
);
`;

export function createSchema(db: DatabaseSync): void {
  db.exec(SCHEMA_SQL);
  db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
}

/** Throws if the file is not a healthy, current brain index. Read-only checks. */
export function verifyIndex(db: DatabaseSync): void {
  const ok = db.prepare("PRAGMA quick_check").get() as { quick_check?: string } | undefined;
  if (ok?.quick_check !== "ok") throw new Error("index failed integrity check");
  const v = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value?: string } | undefined;
  if (v?.value !== String(SCHEMA_VERSION)) throw new Error("index schema version mismatch");
  db.prepare("SELECT count(*) AS n FROM docs_fts").get();
  db.prepare("SELECT count(*) AS n FROM documents").get();
}
