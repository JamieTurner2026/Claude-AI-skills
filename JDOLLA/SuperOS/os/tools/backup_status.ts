// backup_status: the last vault backup's result, the days since its last success, and a warning after 3 days.
// Read-only, from the backup record the bridge keeps in the log folder. Takes no argument. One-word results and dates only:
// never a file name, a message or a remote URL.
import { z } from "zod";
import { readBackupRecord } from "../backup/record.ts";
import { summarize } from "../backup/summary.ts";
import type { ScriptTool } from "./registry.ts";

export const backupStatus: ScriptTool = {
  name: "backup_status",
  description: "The last vault backup: its result (pushed, nothing, refused or failed) and date, the days since the last success, and a warning if that is more than 3 days. Read-only. An empty answer (ran: false) means no backup has run on this PC yet, which is normal until backups are set up.",
  input: z.object({}).strict(),
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  run(_input, ctx) {
    return summarize(ctx.logDir ? readBackupRecord(ctx.logDir) : null, ctx.now());
  },
};
