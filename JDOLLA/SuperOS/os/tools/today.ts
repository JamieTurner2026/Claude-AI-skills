// today: the date, weekday, time and ISO week in the owner's time zone. Pure: no files, no network, no shell.
import { z } from "zod";
import type { ScriptTool } from "./registry.ts";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Calendar parts of `now` as seen in time zone `tz`. */
function parts(now: Date, tz: string): { y: number; m: number; d: number; hh: string; mm: string; offset: string } {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "shortOffset" });
  const get = (t: string) => f.formatToParts(now).find((p) => p.type === t)?.value ?? "";
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), hh: get("hour"), mm: get("minute"), offset: get("timeZoneName") };
}

/** ISO 8601 week (weeks start Monday; week 1 holds the year's first Thursday). */
export function isoWeek(y: number, m: number, d: number): { year: number; week: number } {
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - dow + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return { year: date.getUTCFullYear(), week };
}

export const today: ScriptTool = {
  name: "today",
  description: "Today's date, weekday, local time and ISO week in Jay's time zone. Use it instead of guessing the date.",
  input: z.object({}).strict(),
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  run(_input, ctx) {
    const p = parts(ctx.now(), ctx.timezone);
    const date = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
    const dow = (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7;
    const w = isoWeek(p.y, p.m, p.d);
    return { date, weekday: WEEKDAYS[dow], time: `${p.hh}:${p.mm}`, utcOffset: p.offset.replace("GMT", "UTC"), isoWeek: `${w.year}-W${String(w.week).padStart(2, "0")}`, timezone: ctx.timezone };
  },
};
