// brain import-sessions [--claude-code <dir>] [--claude-ai <conversations.json>] [--dry-run] [--vault <dir>]
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { defaultLedgerPath, importSessions, type ImportItem } from "./importer.ts";
import { defaultClaudeCodeDir, readClaudeAiExport, readClaudeCodeDir, type Session } from "./sessions.ts";

const fmtCounts = (c: ImportItem["counts"]): string => Object.entries(c).map(([k, v]) => `${k} ${v}`).join(", ");

export function runImportCommand(argv: string[]): number {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv, allowPositionals: false,
      options: { "claude-code": { type: "string" }, "claude-ai": { type: "string" }, "dry-run": { type: "boolean" }, vault: { type: "string" }, ledger: { type: "string" } },
    }));
  } catch (e) {
    console.error(`import-sessions: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const vault = values.vault ?? process.env["SUPEROS_VAULT"] ?? path.resolve(import.meta.dirname, "../..");
  const ledgerPath = values.ledger ?? defaultLedgerPath();
  const dryRun = values["dry-run"] === true;
  const ccDir = values["claude-code"] ?? (values["claude-ai"] ? undefined : defaultClaudeCodeDir());
  const sessions: Session[] = [];
  try {
    if (ccDir) {
      if (!existsSync(ccDir)) { console.error(`No Claude Code sessions folder at ${ccDir}`); return 1; }
      const r = readClaudeCodeDir(ccDir);
      console.log(`claude-code: ${r.files} transcript files, ${r.sessions.length} sessions with text, ${r.skippedLines} unreadable lines skipped`);
      sessions.push(...r.sessions);
    }
    if (values["claude-ai"]) {
      const r = readClaudeAiExport(values["claude-ai"]);
      console.log(`claude-ai: ${r.sessions.length} conversations with text, ${r.skippedItems} skipped, ${r.skippedLines} unreadable messages skipped`);
      sessions.push(...r.sessions);
    }
    const items = importSessions({ vault, sessions, ledgerPath, dryRun });
    let fresh = 0, dup = 0, red = 0;
    for (const it of items) {
      if (it.status === "already-imported") { dup++; continue; }
      fresh++;
      red += it.redactions;
      const extra = [it.redactions ? `redacted ${it.redactions} (${fmtCounts(it.counts)})` : "redacted 0", it.truncated ? `${it.truncated} long messages cut` : ""].filter(Boolean).join("; ");
      console.log(`${dryRun ? "would write" : "wrote"} ${it.files.join(", ")}  [${it.messages} messages, dept guess ${it.dept}; ${extra}]`);
    }
    console.log(`${dryRun ? "DRY RUN, nothing written. " : ""}${fresh} new, ${dup} already imported, ${red} redactions.${dryRun ? "" : `\nledger: ${ledgerPath}`}`);
    if (!dryRun && fresh) console.log("Run `npm run brain -- index` to make them searchable (runs do this on their own).");
    return 0;
  } catch (e) {
    console.error(`import-sessions: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
