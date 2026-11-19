// Pure routine scheduler: decides which routines are due. No timers, no runs, no file access.
// Schedule strings: "daily HH:MM", "weekdays HH:MM", "weekly <mon..sun> HH:MM", read in one IANA time zone.
import { z } from "zod";

export const DEFAULT_TIMEZONE = "America/New_York";
/** A routine that has never run only counts a slot this recent, so enabling one at noon does not fire this morning's 07:00. */
export const DEFAULT_GRACE_MINUTES = 60;
const LOOKBACK_DAYS = 8; // covers a weekly schedule plus one day
const DAY_MS = 86_400_000;
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export type Schedule =
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekdays"; hour: number; minute: number }
  | { kind: "weekly"; day: number; hour: number; minute: number }; // day: 0 = sunday

const Time = "([01]\\d|2[0-3]):([0-5]\\d)";
const DAILY = new RegExp(`^(daily|weekdays) ${Time}$`);
const WEEKLY = new RegExp(`^weekly (${DAYS.join("|")}) ${Time}$`);

const ScheduleText = z.string().max(40);

export type ParseResult = { ok: true; schedule: Schedule } | { ok: false; reason: string };

/** Never throws. Anything that is not one of the three exact forms is rejected. */
export function parseSchedule(input: unknown): ParseResult {
  const text = ScheduleText.safeParse(input);
  if (!text.success) return { ok: false, reason: "schedule must be short text" };
  const s = text.data.trim().toLowerCase();
  const d = DAILY.exec(s);
  if (d) return { ok: true, schedule: { kind: d[1] as "daily" | "weekdays", hour: Number(d[2]), minute: Number(d[3]) } };
  const w = WEEKLY.exec(s);
  if (w) return { ok: true, schedule: { kind: "weekly", day: DAYS.indexOf(w[1] as (typeof DAYS)[number]), hour: Number(w[2]), minute: Number(w[3]) } };
  return { ok: false, reason: 'use "daily HH:MM", "weekdays HH:MM" or "weekly <mon..sun> HH:MM" (24-hour)' };
}

// ---- time zone maths (Intl only, no dependencies) ----

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    formatters.set(tz, f);
  }
  return f;
}

type Local = { y: number; mo: number; d: number; h: number; mi: number; s: number };
function localParts(ms: number, tz: string): Local {
  const o: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o["year"] as number, mo: o["month"] as number, d: o["day"] as number, h: o["hour"] as number, mi: o["minute"] as number, s: o["second"] as number };
}

/** Local wall clock minus UTC, in ms, at that instant. */
function offsetMs(ms: number, tz: string): number {
  const l = localParts(ms, tz);
  return Date.UTC(l.y, l.mo - 1, l.d, l.h, l.mi, l.s) - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant when the wall clock in tz reads y-mo-d h:mi.
 * Repeated time (clocks go back): the first occurrence. Skipped time (clocks go forward): the reading
 * shifted ahead by the gap, so 02:30 on spring-forward day fires at 03:30.
 */
export function localToInstant(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const t = Date.UTC(y, mo - 1, d, h, mi);
  const before = offsetMs(t - DAY_MS, tz);
  const after = offsetMs(t + DAY_MS, tz);
  const hits = [...new Set([before, after])]
    .map((o) => t - o)
    .filter((c) => {
      const l = localParts(c, tz);
      return l.y === y && l.mo === mo && l.d === d && l.h === h && l.mi === mi;
    });
  return hits.length ? Math.min(...hits) : t - before;
}

export function assertTimezone(tz: string): void {
  try { formatter(tz).format(0); } catch { throw new RangeError(`Unknown time zone: ${tz.slice(0, 64)}`); }
}

/** The latest slot instant at or before now, or null if none in the lookback window. */
export function latestSlot(s: Schedule, now: number, tz: string): number | null {
  const today = localParts(now, tz);
  for (let back = 0; back <= LOOKBACK_DAYS; back++) {
    const day = new Date(Date.UTC(today.y, today.mo - 1, today.d - back));
    const dow = day.getUTCDay();
    if (s.kind === "weekdays" && (dow === 0 || dow === 6)) continue;
    if (s.kind === "weekly" && dow !== s.day) continue;
    const slot = localToInstant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), s.hour, s.minute, tz);
    if (slot <= now) return slot;
  }
  return null;
}

// ---- due routines ----

const RoutineInput = z.object({ id: z.string().min(1).max(60), schedule: z.string().max(120).default(""), enabled: z.boolean().default(true) }).passthrough();
const Instant = z.union([z.number().finite(), z.string().max(40), z.date()]).transform((v, ctx) => {
  const ms = v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v);
  if (!Number.isFinite(ms)) { ctx.addIssue({ code: "custom", message: "not a valid time" }); return z.NEVER; }
  return ms;
});

export type DueResult<R> = { due: R[]; invalid: { id: string; reason: string }[] };
export type DueOptions = { timezone?: string; graceMinutes?: number };

/**
 * Routines due at `now`. A routine is due when it is enabled, its schedule parses, and its latest
 * slot at or before now is newer than its last run. So each slot fires at most once, and a slot
 * missed during downtime fires once on catch-up (only the latest missed slot, never one per day).
 * A routine with no last run only counts a slot within the grace window.
 * Bad schedules and bad times are reported in `invalid`; nothing here throws except a bad time zone or `now`.
 */
export function dueRoutines<R extends { id: string; schedule: string; enabled: boolean }>(
  routines: readonly R[],
  lastRunAt: Readonly<Record<string, number | string | Date | undefined>>,
  now: Date,
  opts: DueOptions = {},
): DueResult<R> {
  const tz = opts.timezone ?? DEFAULT_TIMEZONE;
  assertTimezone(tz);
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new RangeError("now is not a valid date");
  const grace = Math.max(0, opts.graceMinutes ?? DEFAULT_GRACE_MINUTES) * 60_000;
  const out: DueResult<R> = { due: [], invalid: [] };
  for (const r of routines) {
    const shape = RoutineInput.safeParse(r);
    if (!shape.success) { out.invalid.push({ id: typeof (r as { id?: unknown })?.id === "string" ? String((r as { id: string }).id).slice(0, 60) : "(unknown)", reason: "not a valid routine" }); continue; }
    const { id, schedule, enabled } = shape.data;
    if (!enabled) continue; // disabled routines are never due, and their schedules are not judged
    const parsed = parseSchedule(schedule);
    if (!parsed.ok) { out.invalid.push({ id, reason: parsed.reason }); continue; }
    const raw = Object.hasOwn(lastRunAt, id) ? lastRunAt[id] : undefined;
    let last: number | null = null;
    if (raw !== undefined) {
      const t = Instant.safeParse(raw);
      if (!t.success) { out.invalid.push({ id, reason: "last run time is not a valid time" }); continue; }
      last = t.data;
    }
    const slot = latestSlot(parsed.schedule, nowMs, tz);
    if (slot === null) continue;
    if (last === null ? nowMs - slot <= grace : last < slot) out.due.push(r);
  }
  return out;
}
