// Appends one JSON line per routing decision and per finished run to router.jsonl.
// Logging must never stop a run, so every error here is swallowed.
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export type LogLine = Record<string, string | number | boolean | null | Record<string, number>>;

export function makeRunLog(dir: string): (line: LogLine) => void {
  return (line) => {
    try {
      mkdirSync(dir, { recursive: true });
      appendFileSync(path.join(dir, "router.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...line }) + "\n");
    } catch { /* never fail a run because the log could not be written */ }
  };
}
