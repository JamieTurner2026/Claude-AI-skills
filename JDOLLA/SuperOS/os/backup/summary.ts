// What the vault-cleanup report and the backup_status tool say about the last backup. Pure: no git, no network.
import type { BackupRecord } from "./record.ts";

const DAY_MS = 86_400_000;
export const WARN_AFTER_DAYS = 3;

export type BackupSummary = {
  ran: boolean;
  lastResult: { at: string; status: BackupRecord["status"] } | null;
  lastSuccessAt: string | null;
  /** Whole days since the last success, or null if there has been none. */
  daysSinceSuccess: number | null;
  /** Set when the last success is more than 3 days old, or when backups have run but none has ever succeeded. */
  warning: string | null;
};

export function summarize(rec: BackupRecord | null, now: Date): BackupSummary {
  if (!rec) return { ran: false, lastResult: null, lastSuccessAt: null, daysSinceSuccess: null, warning: null };
  const okMs = rec.lastOkAt ? Date.parse(rec.lastOkAt) : NaN;
  const elapsed = Number.isFinite(okMs) ? now.getTime() - okMs : null;
  const days = elapsed === null ? null : Math.max(0, Math.floor(elapsed / DAY_MS));
  const warning = elapsed === null ? `No backup has succeeded yet (the last attempt was ${rec.status}).`
    : elapsed > WARN_AFTER_DAYS * DAY_MS ? `The last successful backup was ${days} days ago.` : null;
  return { ran: true, lastResult: { at: rec.at, status: rec.status }, lastSuccessAt: elapsed === null ? null : rec.lastOkAt, daysSinceSuccess: days, warning };
}
