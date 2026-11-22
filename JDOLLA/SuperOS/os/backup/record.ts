// The last backup's outcome, kept in the log folder (not in the vault) so the Health strip can show it.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { BackupResult } from "./backup.ts";

const Record = z.object({
  at: z.string().max(40),
  status: z.enum(["refused", "nothing", "pushed", "failed"]),
  message: z.string().max(400),
  files: z.number().int().min(0),
  /** When a backup last succeeded (pushed, or already up to date); null if none has. Carried forward across failures. */
  lastOkAt: z.string().max(40).nullable().default(null),
});
export type BackupRecord = z.infer<typeof Record>;
const file = (logDir: string) => path.join(logDir, "backup-status.json");

export function writeBackupRecord(logDir: string, r: BackupResult, now: Date): void {
  try {
    if (r.status === "dry-run") return; // a dry run is not a backup
    const status = r.status;
    mkdirSync(logDir, { recursive: true });
    const ok = status === "pushed" || status === "nothing";
    const rec: BackupRecord = { at: now.toISOString(), status, message: r.message.slice(0, 400), files: r.files.length, lastOkAt: ok ? now.toISOString() : readBackupRecord(logDir)?.lastOkAt ?? null };
    const tmp = `${file(logDir)}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(rec) + "\n");
    renameSync(tmp, file(logDir));
  } catch { /* the backup's result matters more than its note */ }
}

export function readBackupRecord(logDir: string): BackupRecord | null {
  try { return Record.parse(JSON.parse(readFileSync(file(logDir), "utf8"))); } catch { return null; }
}
