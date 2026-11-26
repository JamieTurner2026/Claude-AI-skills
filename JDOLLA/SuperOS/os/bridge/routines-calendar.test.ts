// The Routines calendar: the scheduler's slot rule per day (DST days, the monthly slot), the 7-day view with each day's
// total against the $2 cap, the route's guards, and the widget's wording. Read-only throughout.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dayTotalText } from "../app/widgets/calendar.ts";
import type { CalendarDay, RoutineCalendarView } from "../shared/types.ts";
import { loadConfig, pathsFor, saveConfig } from "./config.ts";
import { makeVault } from "./fixture.ts";
import { RoutineRunner } from "./routine-runner.ts";
import type { RunManager } from "./runs.ts";
import { latestSlot, parseSchedule, slotOnDay } from "./scheduler.ts";
import type { Schedule } from "./scheduler.ts";
import { createBridge } from "./server.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fake = path.join(here, "fake-claude.ts");
const NY = "America/New_York";
const sched = (text: string): Schedule => { const p = parseSchedule(text); assert.ok(p.ok, text); return (p as { schedule: Schedule }).schedule; };
const slot = (text: string, y: number, mo: number, d: number, tz = NY): string | null => { const ms = slotOnDay(sched(text), y, mo, d, tz); return ms === null ? null : new Date(ms).toISOString(); };

test("slotOnDay: which days each kind fires on (weekdays skip weekends, weekly its day, monthly its date, daily every day)", () => {
  assert.equal(slot("daily 07:00", 2026, 11, 28), "2026-11-28T12:00:00.000Z", "Saturday");
  assert.equal(slot("weekdays 07:00", 2026, 11, 27), "2026-11-27T12:00:00.000Z", "Friday");
  assert.equal(slot("weekdays 07:00", 2026, 11, 28), null, "Saturday");
  assert.equal(slot("weekdays 07:00", 2026, 11, 29), null, "Sunday");
  assert.equal(slot("weekly fri 16:00", 2026, 11, 27), "2026-11-27T21:00:00.000Z");
  assert.equal(slot("weekly fri 16:00", 2026, 11, 26), null);
  assert.equal(slot("monthly 15 09:00", 2026, 11, 15), "2026-11-15T14:00:00.000Z");
  assert.equal(slot("monthly 15 09:00", 2026, 11, 16), null);
  assert.equal(slot("monthly 28 09:00", 2027, 2, 28), "2027-02-28T14:00:00.000Z", "every month has a 28th");
});

test("slotOnDay across DST: a skipped time moves ahead, a repeated time takes the first, and a day's offset follows its own date", () => {
  // Spring forward, Sunday 2026-03-08: 02:00 EST jumps to 03:00 EDT, so 02:30 does not exist and fires at 03:30 EDT (07:30Z).
  assert.equal(slot("daily 02:30", 2026, 3, 8), "2026-03-08T07:30:00.000Z");
  assert.equal(slot("daily 02:30", 2026, 3, 7), "2026-03-07T07:30:00.000Z", "the day before: a real 02:30 EST");
  assert.equal(slot("daily 02:30", 2026, 3, 9), "2026-03-09T06:30:00.000Z", "the day after: 02:30 EDT");
  // Fall back, Sunday 2026-11-01: 01:30 happens twice; the first (EDT, 05:30Z) is the slot.
  assert.equal(slot("daily 01:30", 2026, 11, 1), "2026-11-01T05:30:00.000Z");
  assert.equal(slot("daily 08:00", 2026, 10, 31), "2026-10-31T12:00:00.000Z", "EDT");
  assert.equal(slot("daily 08:00", 2026, 11, 1), "2026-11-01T13:00:00.000Z", "the same 08:00 is an hour later in UTC once the clocks went back");
  assert.equal(slot("daily 08:00", 2026, 3, 8), "2026-03-08T12:00:00.000Z", "EDT already on spring-forward day by 08:00");
});

test("slotOnDay: the monthly slot on a clocks-back 1st (Nov 1 2026 is EST by 08:10), on the other 1sts, and across the year end", () => {
  assert.equal(slot("monthly 1 08:10", 2026, 11, 1), "2026-11-01T13:10:00.000Z");
  assert.equal(slot("monthly 1 08:10", 2026, 10, 1), "2026-10-01T12:10:00.000Z");
  assert.equal(slot("monthly 1 08:10", 2026, 12, 1), "2026-12-01T13:10:00.000Z");
  assert.equal(slot("monthly 1 08:10", 2027, 1, 1), "2027-01-01T13:10:00.000Z");
  assert.equal(slot("monthly 1 08:10", 2026, 11, 2), null);
  assert.equal(slot("monthly 1 08:10", 2026, 10, 31), null);
  assert.equal(slot("monthly 1 08:10", 2026, 3, 1), "2026-03-01T13:10:00.000Z", "March 1: still EST");
  assert.equal(slot("monthly 1 08:10", 2026, 4, 1), "2026-04-01T12:10:00.000Z", "April 1: EDT");
});

test("the due check and the calendar share one rule: latestSlot is always the newest slotOnDay at or before now (every kind, DST weeks included)", () => {
  const kinds = ["daily 02:30", "daily 01:30", "weekdays 07:30", "weekly sun 17:00", "weekly sat 03:00", "monthly 1 08:10", "monthly 28 23:59"];
  const starts = [Date.UTC(2026, 2, 5), Date.UTC(2026, 9, 28), Date.UTC(2026, 11, 28), Date.UTC(2027, 1, 24)];
  for (const k of kinds) {
    const s = sched(k);
    for (const start of starts) {
      for (let h = 0; h < 24 * 12; h += 5) {
        const now = start + h * 3_600_000 + 11 * 60_000;
        const all: number[] = [];
        for (let back = -1; back <= 40; back++) {
          const day = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() - back));
          const m = slotOnDay(s, day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), NY);
          if (m !== null && m <= now) all.push(m);
        }
        assert.equal(latestSlot(s, now, NY), all.length ? Math.max(...all) : null, `${k} at ${new Date(now).toISOString()}`);
      }
    }
  }
});

type R = { id: string; name: string; schedule: string; enabled: boolean; tier?: string; budgetUsd?: number; skill?: string; builtin?: string };
/** A fixture vault whose config has Jay's real daily cap ($2) and the given time zone. */
function capVault(tz = NY): string {
  const vault = makeVault();
  const paths = pathsFor(path.join(vault, "os"));
  const c = loadConfig(paths);
  saveConfig(paths, { ...c, timezones: [tz], engine: { ...c.engine, routines: { dailyCapUsd: 2, maxBudgetUsd: 1 } } });
  return vault;
}
function runner(routines: R[], tz = NY): RoutineRunner {
  const vault = capVault(tz);
  writeFileSync(path.join(vault, "routines/routines.json"), JSON.stringify(routines));
  const paths = pathsFor(path.join(vault, "os"));
  return new RoutineRunner({ paths, config: () => loadConfig(paths), runs: {} as RunManager, logDir: mkdtempSync(path.join(tmpdir(), "cal-logs-")), log: () => undefined, schedulerOn: false });
}
const BASE: R[] = [
  { id: "plan-today", name: "Plan today", schedule: "weekdays 07:00", enabled: true, tier: "T2", budgetUsd: 0.25, skill: "plan-today" },
  { id: "morning-intel", name: "Morning intel", schedule: "weekdays 07:30", enabled: false, tier: "T2", budgetUsd: 0.4, skill: "morning-intel" },
  { id: "content-cascade", name: "Content cascade", schedule: "weekly fri 16:00", enabled: true, tier: "T3", budgetUsd: 1, skill: "content-cascade" },
  { id: "vault-backup", name: "Vault backup", schedule: "daily 23:40", enabled: true, builtin: "vault-backup" },
  { id: "month-costs", name: "Monthly costs", schedule: "monthly 1 08:10", enabled: false, builtin: "month-costs" },
];
const MON = new Date("2026-11-23T14:00:00Z"); // Monday 09:00 EST

test("the 7-day view: consecutive local days, slots sorted by time, on and off, budgets (built-ins $0), totals against the cap", () => {
  const v = runner(BASE).calendar(MON);
  assert.deepEqual([v.timezone, v.capUsd, v.days.length, v.problems], [NY, 2, 7, []]);
  assert.deepEqual(v.days.map((d) => `${d.weekday} ${d.date}`), ["Mon 2026-11-23", "Tue 2026-11-24", "Wed 2026-11-25", "Thu 2026-11-26", "Fri 2026-11-27", "Sat 2026-11-28", "Sun 2026-11-29"]);
  assert.deepEqual(v.days.map((d) => d.today), [true, false, false, false, false, false, false]);
  const mon = v.days[0]!;
  assert.deepEqual(mon.slots.map((s) => [s.time, s.id, s.enabled, s.budgetUsd, s.builtin]), [["07:00", "plan-today", true, 0.25, false], ["07:30", "morning-intel", false, 0.4, false], ["23:40", "vault-backup", true, 0, true]]);
  assert.deepEqual([mon.enabledTotalUsd, mon.allTotalUsd, mon.overCap], [0.25, 0.65, false], "only routines that are on count against the cap; the off one is shown in 'all'");
  const fri = v.days[4]!;
  assert.deepEqual(fri.slots.map((s) => s.id), ["plan-today", "morning-intel", "content-cascade", "vault-backup"]);
  assert.deepEqual([fri.enabledTotalUsd, fri.allTotalUsd], [1.25, 1.65]);
  const sat = v.days[5]!;
  assert.deepEqual(sat.slots.map((s) => s.id), ["vault-backup"], "weekday routines skip the weekend");
  assert.equal(sat.enabledTotalUsd, 0);
  assert.ok(v.days.every((d) => d.slots.every((s) => /^\d{2}:\d{2}$/.test(s.time) && !Number.isNaN(Date.parse(s.at)))));
});

test("past slots today are marked; later ones and other days are not", () => {
  const v = runner(BASE).calendar(MON);
  assert.deepEqual(v.days[0]!.slots.map((s) => s.past), [true, true, false], "07:00 and 07:30 have gone; 23:40 has not");
  assert.ok(v.days.slice(1).every((d) => d.slots.every((s) => !s.past)));
});

test("a day over the cap is flagged; exactly the cap is not; a day only 'over' with the off routines on is not", () => {
  const over = runner([...BASE, { id: "big", name: "Big", schedule: "weekly fri 18:00", enabled: true, tier: "T3", budgetUsd: 1 }]).calendar(MON);
  assert.deepEqual(over.days.map((d) => d.overCap), [false, false, false, false, true, false, false], "Friday: 0.25 + 1 + 1 = 2.25 > 2");
  assert.equal(over.days[4]!.enabledTotalUsd, 2.25);
  const exact = runner([{ id: "a", name: "A", schedule: "weekly fri 18:00", enabled: true, tier: "T3", budgetUsd: 1 }, { id: "b", name: "B", schedule: "weekly fri 19:00", enabled: true, tier: "T3", budgetUsd: 1 }]).calendar(MON);
  assert.deepEqual([exact.days[4]!.enabledTotalUsd, exact.days[4]!.overCap], [2, false], "$2.00 of $2.00 still fits");
  const offOnly = runner([{ id: "a", name: "A", schedule: "weekly fri 18:00", enabled: true, tier: "T3", budgetUsd: 1 }, { id: "b", name: "B", schedule: "weekly fri 19:00", enabled: false, tier: "T3", budgetUsd: 1.5 }]).calendar(MON);
  assert.deepEqual([offOnly.days[4]!.enabledTotalUsd, offOnly.days[4]!.allTotalUsd, offOnly.days[4]!.overCap], [1, 2.5, false]);
  const defaults = runner([{ id: "t2", name: "T2 default", schedule: "daily 07:00", enabled: true, tier: "T2" }, { id: "t3", name: "T3 default", schedule: "daily 08:00", enabled: true, tier: "T3" }]).calendar(MON);
  assert.equal(defaults.days[0]!.enabledTotalUsd, 1.25, "routines without a budget count at their tier's default ($0.25 / $1.00), as the runner reserves them");
});

test("DST week, spring forward: a 23-hour day is still one day, and a 02:30 slot shows its real firing time 03:30", () => {
  const v = runner([{ id: "early", name: "Early", schedule: "daily 02:30", enabled: true, tier: "T2", budgetUsd: 0.1 }, { id: "morning", name: "Morning", schedule: "daily 08:00", enabled: true, tier: "T2", budgetUsd: 0.1 }]).calendar(new Date("2026-03-07T17:00:00Z"));
  assert.deepEqual(v.days.map((d) => d.date), ["2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13"]);
  assert.deepEqual(v.days.map((d) => d.weekday), ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"]);
  assert.deepEqual(v.days.map((d) => d.slots[0]!.time), ["02:30", "03:30", "02:30", "02:30", "02:30", "02:30", "02:30"]);
  assert.equal(v.days[1]!.slots[0]!.at, "2026-03-08T07:30:00.000Z");
  assert.deepEqual(v.days.map((d) => d.slots.length), Array(7).fill(2), "no day lost or doubled");
  assert.deepEqual(v.days.map((d) => d.slots[1]!.time), Array(7).fill("08:00"));
});

test("DST week, fall back: the 25-hour day is one day, a repeated 01:30 shows once, and 08:00 stays 08:00 though its UTC time moves", () => {
  const v = runner([{ id: "early", name: "Early", schedule: "daily 01:30", enabled: true, tier: "T2", budgetUsd: 0.1 }, { id: "morning", name: "Morning", schedule: "daily 08:00", enabled: true, tier: "T2", budgetUsd: 0.1 }]).calendar(new Date("2026-10-31T17:00:00Z"));
  assert.deepEqual(v.days.map((d) => d.date), ["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]);
  assert.deepEqual(v.days.map((d) => d.slots.length), Array(7).fill(2), "01:30 happens twice on Nov 1 but is listed once");
  assert.deepEqual(v.days.map((d) => d.slots[0]!.time), Array(7).fill("01:30"));
  assert.equal(v.days[1]!.slots[0]!.at, "2026-11-01T05:30:00.000Z", "the first 01:30 (EDT)");
  assert.deepEqual([v.days[0]!.slots[1]!.at, v.days[1]!.slots[1]!.at], ["2026-10-31T12:00:00.000Z", "2026-11-01T13:00:00.000Z"]);
  assert.deepEqual(v.days.map((d) => d.slots[1]!.time), Array(7).fill("08:00"));
});

test("the monthly slot shows on the 1st only, at its local time, across a month end and a year end", () => {
  const r = runner(BASE);
  const oct = r.calendar(new Date("2026-10-29T14:00:00Z"));
  assert.deepEqual(oct.days.map((d) => d.date), ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);
  const withMonthly = oct.days.map((d) => d.slots.find((s) => s.id === "month-costs"));
  assert.deepEqual(withMonthly.map((s) => s?.time ?? null), [null, null, null, "08:10", null, null, null]);
  assert.equal(withMonthly[3]!.at, "2026-11-01T13:10:00.000Z", "Nov 1 08:10 is already EST");
  assert.deepEqual([withMonthly[3]!.enabled, withMonthly[3]!.budgetUsd, withMonthly[3]!.builtin], [false, 0, true], "shown even though it is off, with its $0 budget");
  const dec = r.calendar(new Date("2026-12-29T14:00:00Z"));
  assert.deepEqual(dec.days.map((d) => d.slots.some((s) => s.id === "month-costs")), [false, false, false, true, false, false, false]);
  assert.equal(dec.days[3]!.date, "2027-01-01");
  assert.equal(dec.days[3]!.weekday, "Fri");
  const none = r.calendar(new Date("2026-11-09T14:00:00Z"));
  assert.ok(none.days.every((d) => !d.slots.some((s) => s.id === "month-costs")), "a week with no 1st has no monthly slot");
});

test("the day is Jay's: in another time zone 'today' and every slot time follow that zone", () => {
  const v = runner([{ id: "r", name: "R", schedule: "daily 07:00", enabled: true, tier: "T2", budgetUsd: 0.1 }], "Australia/Sydney").calendar(new Date("2026-11-23T20:00:00Z"));
  assert.equal(v.days[0]!.date, "2026-11-24", "20:00Z is already Tuesday morning in Sydney");
  assert.equal(v.timezone, "Australia/Sydney");
  assert.equal(v.days[0]!.slots[0]!.time, "07:00");
  assert.equal(v.days[0]!.slots[0]!.at, "2026-11-23T20:00:00.000Z");
  assert.equal(v.days[0]!.slots[0]!.past, false, "07:00 Sydney is exactly now: not past yet");
});

test("a schedule the scheduler can't read is reported by id, not drawn; a bad routines.json is reported; day counts are bounded", () => {
  const v = runner([...BASE, { id: "odd", name: "Odd", schedule: "whenever", enabled: false }, { id: "worse", name: "Worse", schedule: "monthly 31 08:10", enabled: true }]).calendar(MON);
  assert.equal(v.problems.length, 2);
  assert.match(v.problems[0]!, /^Routine odd has a schedule that is not understood/);
  assert.ok(v.days.every((d) => !d.slots.some((s) => s.id === "odd" || s.id === "worse")));
  assert.equal(v.days[0]!.slots.length, 3, "the readable ones are still there");
  const r = runner(BASE);
  assert.equal(r.calendar(MON, 0).days.length, 1);
  assert.equal(r.calendar(MON, 99).days.length, 31);
  const vault = capVault();
  writeFileSync(path.join(vault, "routines/routines.json"), "{not json");
  const paths = pathsFor(path.join(vault, "os"));
  const broken = new RoutineRunner({ paths, config: () => loadConfig(paths), runs: {} as RunManager, logDir: mkdtempSync(path.join(tmpdir(), "cal-logs-")), log: () => undefined, schedulerOn: false }).calendar(MON);
  assert.deepEqual([broken.days.every((d) => d.slots.length === 0), broken.problems.length], [true, 1]);
});

async function bridge() {
  const vault = capVault();
  writeFileSync(path.join(vault, "routines/routines.json"), JSON.stringify(BASE.map((r) => ({ ...r, secretField: "SKILLSECRET" }))));
  const logs = mkdtempSync(path.join(tmpdir(), "cal-logs-"));
  const b = createBridge(path.join(vault, "os"), { claudeBin: { cmd: process.execPath, prefixArgs: [fake] }, logDir: logs, now: () => MON });
  await new Promise<void>((r) => b.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(b.server.address() as AddressInfo).port}`;
  const token = b.mint();
  const get = (headers: Record<string, string> = { authorization: `Bearer ${token}` }) => fetch(`${base}/api/routines/calendar`, { headers });
  return { b, vault, logs, base, token, get, close: () => { b.runs.stopAll(); b.server.close(); } };
}

test("GET /api/routines/calendar: no session is refused (control: a session is served); a foreign Origin and other methods are refused", async (t) => {
  const e = await bridge(); t.after(e.close);
  assert.equal((await e.get({})).status, 401);
  assert.equal((await e.get({ authorization: "Bearer 1.2.3" })).status, 401);
  assert.equal((await e.get({ authorization: `Bearer ${e.token}`, origin: "http://evil.example" })).status, 403);
  const post = await fetch(`${e.base}/api/routines/calendar`, { method: "POST", headers: { authorization: `Bearer ${e.token}`, "content-type": "application/json", "x-superos": "1" }, body: "{}" });
  assert.equal(post.status, 405);
  const ok = await e.get({ authorization: `Bearer ${e.token}`, origin: e.base });
  assert.equal(ok.status, 200);
  const v = (await ok.json()) as RoutineCalendarView;
  assert.deepEqual([v.days.length, v.days[0]!.date, v.capUsd], [7, "2026-11-23", 2], "the bridge's own clock is used");
  const routines = await fetch(`${e.base}/api/routines`, { headers: { authorization: `Bearer ${e.token}` } });
  assert.equal(routines.status, 200, "the Routines list route is unaffected");
});

test("the calendar changes nothing and leaks nothing: only names, times and dollars; routines.json and the ledger are untouched", async (t) => {
  const e = await bridge(); t.after(e.close);
  const file = path.join(e.vault, "routines", "routines.json");
  const before = readFileSync(file, "utf8");
  const text = await (await e.get()).text();
  for (const s of ["SKILLSECRET", "secretField", e.vault, e.logs, "skill", "SKILL.md", "plan-today/"]) assert.ok(!text.includes(s), `no ${s}`);
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ["capUsd", "days", "problems", "timezone"]);
  assert.deepEqual(Object.keys((JSON.parse(text) as RoutineCalendarView).days[0]!.slots[0]!).sort(), ["at", "budgetUsd", "builtin", "enabled", "id", "name", "past", "time"]);
  assert.equal(readFileSync(file, "utf8"), before, "routines.json is byte for byte what it was");
  assert.equal(e.b.runs.list().length, 0, "nothing was started");
});

test("widget wording: a day says its total against the cap in words, flags the cap in words, mentions what the off routines would add", () => {
  const day = (over: Partial<CalendarDay>): CalendarDay => ({ date: "2026-11-27", weekday: "Fri", today: false, slots: [{ at: "x", time: "07:00", id: "a", name: "A", enabled: true, builtin: false, budgetUsd: 1, past: false }], enabledTotalUsd: 1, allTotalUsd: 1, overCap: false, ...over });
  assert.equal(dayTotalText(day({ slots: [] }), 2), "No routines");
  assert.equal(dayTotalText(day({}), 2), "$1.00 of $2.00 cap (50%)");
  assert.equal(dayTotalText(day({ enabledTotalUsd: 2.25, allTotalUsd: 2.25, overCap: true }), 2), "$2.25 of $2.00 cap (113%). Over the cap: later routines may be refused");
  assert.equal(dayTotalText(day({ allTotalUsd: 1.4 }), 2), "$1.00 of $2.00 cap (50%). $0.40 more if the ones that are off were on");
  const src = readFileSync(path.join(here, "..", "app", "widgets", "calendar.ts"), "utf8");
  assert.ok(!/innerHTML/.test(src) && /ctx\.api\.routinesCalendar\(\)/.test(src) && !/h\("button"/.test(src), "text only, read only: no button, nothing to change");
  assert.match(readFileSync(path.join(here, "..", "app", "widgets", "registry.ts"), "utf8"), /calendar/);
  assert.ok((JSON.parse(readFileSync(path.join(here, "..", "config", "os.config.json"), "utf8")) as { layout: Array<{ widget: string }> }).layout.some((l) => l.widget === "calendar"));
});
