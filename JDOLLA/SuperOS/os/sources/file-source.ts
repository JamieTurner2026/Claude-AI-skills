// FileSource: reads inbox/_feeds/mail.json and inbox/_feeds/calendar.json. The files are untrusted input:
//  - real-path checked: the folder and each file must be real (no links) and really inside the vault's inbox/_feeds;
//  - size-capped (1 MB) and item-capped (500); zod-validated item by item, so one bad item never hides the rest;
//  - only the fields below are copied out (a mail body in the export is never read forward), text is cleaned and capped;
//  - a missing file is an empty list; an unreadable one is an empty list plus a short problem note, never a throw.
// Node and zod only: the tools server and the daily generator both use it.
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { clean } from "./text.ts";
import { BRAIN_LABEL, SNIPPET_MAX } from "./types.ts";
import type { CalendarItem, CalendarSource, MailItem, MailSource } from "./types.ts";

export const FEED_DIR = "inbox/_feeds";
export const MAX_FEED_BYTES = 1024 * 1024;
export const MAX_FEED_ITEMS = 500;

const when = z.string().max(40).datetime({ offset: true });
const Mail = z.object({
  id: z.string().min(1).max(200), from: z.string().max(300), subject: z.string().max(1000), date: when,
  snippet: z.string().max(5000).optional(), labels: z.array(z.string().max(100)).max(50).optional(),
}); // unknown keys (a body, headers) are dropped by zod and never copied
const Event = z.object({ start: when, end: when, title: z.string().max(1000), location: z.string().max(500).optional() });
const MailFile = z.object({ version: z.number().int().optional(), messages: z.array(z.unknown()).max(20_000) }).strict();
const CalendarFile = z.object({ version: z.number().int().optional(), events: z.array(z.unknown()).max(20_000) }).strict();

export type Feed<T> = { items: T[]; problem: string | null; dropped: number };
const none = <T>(problem: string | null = null): Feed<T> => ({ items: [], problem, dropped: 0 });

/** The text of one feed file, or why it can't be read. Missing is not a problem. */
function readFeedText(vault: string, name: string): { text: string } | { problem: string | null } {
  if (!vault) return { problem: null };
  let root: string;
  try { root = realpathSync(vault); } catch { return { problem: "vault not found" }; }
  const dir = path.join(root, "inbox", "_feeds");
  const file = path.join(dir, name);
  try {
    const d = lstatSync(dir);
    if (!d.isDirectory() || d.isSymbolicLink() || realpathSync(dir) !== dir) return { problem: "inbox/_feeds is not a real folder in the vault" };
  } catch { return { problem: null }; }
  let st;
  try { st = lstatSync(file); } catch { return { problem: null }; }
  if (!st.isFile() || st.isSymbolicLink()) return { problem: `${name} is not a regular file` };
  try {
    if (realpathSync(file) !== file) return { problem: `${name} leads somewhere else` };
    const fd = openSync(file, "r");
    try {
      const size = fstatSync(fd).size;
      if (size > MAX_FEED_BYTES) return { problem: `${name} is over ${MAX_FEED_BYTES / 1024 / 1024} MB` };
      const buf = Buffer.alloc(size);
      readSync(fd, buf, 0, size, 0);
      return { text: buf.toString("utf8") };
    } finally { closeSync(fd); }
  } catch { return { problem: `${name} could not be read` }; }
}

/** The calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function dateIn(ms: number, tz: string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

function parseFeed<T>(vault: string, name: string, shape: z.ZodType<Record<string, unknown>>, key: string, item: (raw: unknown) => T | null): Feed<T> {
  const r = readFeedText(vault, name);
  if (!("text" in r)) return none(r.problem);
  let json: unknown;
  try { json = JSON.parse(r.text); } catch { return none(`${name} is not valid JSON`); }
  const top = shape.safeParse(json);
  if (!top.success) return none(`${name} is not in the expected shape`);
  const raw = top.data[key] as unknown[];
  const items: T[] = [];
  let dropped = 0;
  for (const x of raw) {
    const v = item(x);
    if (v === null) { dropped++; continue; }
    if (items.length < MAX_FEED_ITEMS) items.push(v); else dropped++;
  }
  return { items, problem: null, dropped };
}

export class FileSource implements MailSource, CalendarSource {
  private readonly vault: string;
  constructor(vault: string) { this.vault = vault; }

  /** Every well-formed mail item in the feed that carries the Brain label, as the feed lists them. */
  mailFeed(): Feed<MailItem> {
    return parseFeed(this.vault, "mail.json", MailFile, "messages", (raw) => {
      const m = Mail.safeParse(raw);
      if (!m.success || !(m.data.labels ?? []).some((l) => l.trim().toLowerCase() === BRAIN_LABEL.toLowerCase())) return null;
      return { id: clean(m.data.id, 100), from: clean(m.data.from, 120), subject: clean(m.data.subject, 200), date: m.data.date, snippet: clean(m.data.snippet ?? "", SNIPPET_MAX) };
    });
  }

  listBrainLabelled(since: Date): MailItem[] {
    const from = since.getTime();
    return this.mailFeed().items
      .filter((m) => Date.parse(m.date) >= from)
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || (a.id < b.id ? -1 : 1));
  }

  calendarFeed(): Feed<CalendarItem> {
    return parseFeed(this.vault, "calendar.json", CalendarFile, "events", (raw) => {
      const e = Event.safeParse(raw);
      if (!e.success || Date.parse(e.data.end) < Date.parse(e.data.start)) return null;
      const location = e.data.location ? clean(e.data.location, 120) : "";
      return { start: e.data.start, end: e.data.end, title: clean(e.data.title, 200), ...(location ? { location } : {}) };
    });
  }

  today(date: string, tz: string): CalendarItem[] {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    return this.calendarFeed().items
      .filter((e) => {
        const s = Date.parse(e.start);
        const end = Date.parse(e.end);
        const last = end > s ? end - 1 : end; // an event ending at midnight does not belong to the next day
        return dateIn(s, tz) <= date && date <= dateIn(last, tz);
      })
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || (a.title < b.title ? -1 : 1));
  }
}
