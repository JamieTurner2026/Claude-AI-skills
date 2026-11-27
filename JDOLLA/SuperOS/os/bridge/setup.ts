// The Setup checklist (GET /api/setup): one row per step of Jay's list for the PC. Read-only.
// It reuses the doctor's own checks (nothing new is probed) and a few existence checks on files and folders under the
// vault, the log folder's brain index and the autostart state file. It makes no network call. Rows carry a state, a
// short fixed hint and the PC-SETUP section to follow: never a URL, a path or any file content.
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { SetupRow, SetupView } from "../shared/types.ts";
import { FileSource } from "../sources/file-source.ts";
import type { Check } from "./doctor.ts";

export type AutostartFact = "installed" | "shown" | "none" | "not-windows";
export type SetupFacts = {
  /** The doctor's rows, or null if they could not be run. */
  doctor: readonly Check[] | null;
  embeddings: boolean;
  /** Notes found under raw/sessions/. */
  sessions: number;
  autostart: AutostartFact;
  feeds: { mail: boolean; calendar: boolean };
};

const SKIP_DOCTOR = new Set(["port", "embeddings", "backup", "blender"]); // the bridge itself holds the port; the others have their own rows

export function buildSetup(f: SetupFacts): SetupView {
  const rows: SetupRow[] = [];
  const row = (id: string, label: string, state: SetupRow["state"], section: string, hint: string): void => { rows.push({ id, label, state, section, hint }); };

  if (!f.doctor) row("doctor", "Doctor passes", "todo", "§3.2", "The checks could not be run here. Run npm run doctor in the os folder.");
  else {
    const mine = f.doctor.filter((c) => !SKIP_DOCTOR.has(c.id));
    const fails = mine.filter((c) => c.status === "fail").length;
    const warns = mine.filter((c) => c.status === "warn").length;
    row("doctor", "Doctor passes", fails ? "todo" : "done", "§3.2", fails ? `${fails} check${fails === 1 ? "" : "s"} failing. Run npm run doctor and fix each FAIL row.` : warns ? `No failures. ${warns} optional warning${warns === 1 ? "" : "s"} left.` : "All checks pass.");
  }
  row("tests", "Tests run on this PC", "manual", "§3.3", "Run npm run check and npm test in the os folder. Tick this when both pass.");
  row("embeddings", "Meaning search on", f.embeddings ? "done" : "todo", "§5.2", f.embeddings ? "Embeddings are in the brain index." : "Optional: npm run brain -- index --embeddings (one-time download).");
  row("sessions", "Sessions imported", f.sessions > 0 ? "done" : "todo", "§5.3", f.sessions > 0 ? "Imported sessions are in raw/sessions." : "Optional: import your Claude Code sessions into the brain.");
  if (f.autostart === "not-windows") row("autostart", "Autostart registered", "manual", "§6b", "Windows only. Tick this once you have done it on the PC.");
  else row("autostart", "Autostart registered", f.autostart === "installed" ? "done" : "todo", "§6b",
    f.autostart === "installed" ? "The logon task is installed." : f.autostart === "shown" ? "The plan was shown. Run npm run autostart -- install again to install it." : "Run npm run autostart -- install, then follow its steps.");
  const backup = f.doctor?.find((c) => c.id === "backup");
  row("backup", "Backup set up", backup?.status === "pass" ? "done" : "todo", "§10.1",
    backup?.status === "pass" ? "The vault has its own repo and a private remote that passes the check." : backup?.status === "fail" ? "The vault's git points at the public repo. Fix this first." : "Give the vault its own git repo and name a private remote (optional).");
  const blender = f.doctor?.find((c) => c.id === "blender");
  row("blender", "Blender checked (optional)", blender?.status === "pass" ? "done" : "todo", "§3.4",
    blender?.status === "pass" ? "npm run blender:check passed within 30 days." : blender?.status === "fail" ? "The last Blender check failed. Run npm run blender:check and fix each FAIL row." : "Optional, for the Blender skills: npm run blender:check.");
  const both = f.feeds.mail && f.feeds.calendar;
  row("feeds", "Mail and calendar feeds present", both ? "done" : "todo", "§13.2", both ? "Both feed files are in inbox/_feeds." : f.feeds.mail || f.feeds.calendar ? "One of the two feed files is missing." : "Optional: put mail.json and calendar.json in inbox/_feeds.");
  return { rows, done: rows.filter((r) => r.state === "done").length, total: rows.length };
}

// ---------- fact collectors: file and folder checks only ----------

/** Markdown or text notes under raw/sessions/, to a bounded depth. Links and dot entries are never followed or counted. */
export function countSessionNotes(vault: string): number {
  let n = 0;
  let seen = 0;
  const walk = (dir: string, depth: number): void => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (seen++ > 5000 || n > 0) return; // one is enough to know
      if (e.name.startsWith(".") || e.isSymbolicLink()) continue;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 3) walk(f, depth + 1); continue; }
      if (e.isFile() && /\.(md|txt)$/i.test(e.name)) n++;
    }
  };
  try {
    const dir = path.join(vault, "raw", "sessions");
    const st = lstatSync(dir);
    if (st.isDirectory() && !st.isSymbolicLink()) walk(dir, 0);
  } catch { /* none */ }
  return n;
}

export function autostartFact(stateFile: string, platform: string): AutostartFact {
  if (platform !== "win32") return "not-windows";
  try {
    const v = JSON.parse(readFileSync(stateFile, "utf8")) as { installed?: unknown; shown?: unknown };
    if (v.installed === true) return "installed";
    if (typeof v.shown === "string") return "shown";
  } catch { /* no state file */ }
  return "none";
}

export function feedFacts(vault: string): { mail: boolean; calendar: boolean } {
  const src = new FileSource(vault);
  const real = (name: string): boolean => { try { const st = lstatSync(path.join(vault, "inbox", "_feeds", name)); return st.isFile() && !st.isSymbolicLink(); } catch { return false; } };
  return { mail: real("mail.json") && src.mailFeed().problem === null, calendar: real("calendar.json") && src.calendarFeed().problem === null };
}
