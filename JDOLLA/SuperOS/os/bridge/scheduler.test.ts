import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dueRoutines, latestSlot, localToInstant, parseSchedule, type Schedule } from "./scheduler.ts";

type R = { id: string; schedule: string; enabled: boolean };
const r = (id: string, schedule: string, enabled = true): R => ({ id, schedule, enabled });
const z = (iso: string): Date => new Date(iso);
const ids = (res: { due: R[] }): string[] => res.due.map((x) => x.id);
const due = (routine: R, lastRun: string | undefined, now: string): boolean =>
  ids(dueRoutines([routine], lastRun === undefined ? {} : { [routine.id]: lastRun }, z(now))).length === 1;

// New York in 2026: EST = UTC-5 until 2026-03-08 07:00Z, EDT = UTC-4 until 2026-11-01 06:00Z, then EST again.
// 2026-11-16 is a Monday, so 07:00 local that day is 12:00Z.

describe("parseSchedule", () => {
  it("reads the three forms (case and spaces around are tolerated)", () => {
    assert.deepEqual(parseSchedule("daily 07:30"), { ok: true, schedule: { kind: "daily", hour: 7, minute: 30 } });
    assert.deepEqual(parseSchedule(" Weekdays 00:00 "), { ok: true, schedule: { kind: "weekdays", hour: 0, minute: 0 } });
    assert.deepEqual(parseSchedule("weekly sun 18:00"), { ok: true, schedule: { kind: "weekly", day: 0, hour: 18, minute: 0 } });
    const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    days.forEach((d, i) => assert.equal((parseSchedule(`weekly ${d} 23:59`) as { schedule: Schedule & { day: number } }).schedule.day, i));
  });
  for (const bad of ["", "   ", "daily", "daily 7:00", "daily 24:00", "daily 12:60", "daily 07:00 now", "weekdays", "weekly mon", "weekly xyz 07:00", "weekly 1 07:00", "monthly 07:00", "every 5 minutes", "daily 07:00; rm -rf /", "daily 0７:00", "daily\n07:00", "* * * * *", "__proto__", "weekly mon 07:00 ".repeat(10), "d".repeat(100_000)]) {
    it(`rejects ${JSON.stringify(bad.slice(0, 30))}`, () => assert.equal(parseSchedule(bad).ok, false));
  }
  it("rejects non-text without throwing", () => {
    for (const v of [null, undefined, 7, {}, [], ["daily 07:00"], () => 1, Symbol("x")]) assert.equal(parseSchedule(v).ok, false);
  });
});

describe("schedule kinds", () => {
  it("daily: not due before the time, due at it, not due again after the run", () => {
    const d = r("a", "daily 07:00");
    assert.equal(due(d, "2026-11-15T12:00:05Z", "2026-11-16T11:59:59Z"), false);
    assert.equal(due(d, "2026-11-15T12:00:05Z", "2026-11-16T12:00:00Z"), true);
    assert.equal(due(d, "2026-11-16T12:00:05Z", "2026-11-16T12:00:06Z"), false);
    assert.equal(due(d, "2026-11-16T12:00:05Z", "2026-11-16T23:59:00Z"), false);
    assert.equal(due(d, "2026-11-16T12:00:05Z", "2026-11-17T12:00:00Z"), true);
  });
  it("weekdays: runs Monday to Friday, not on the weekend", () => {
    const d = r("a", "weekdays 07:00");
    assert.equal(due(d, "2026-11-12T12:00:05Z", "2026-11-13T12:00:00Z"), true); // Friday
    assert.equal(due(d, "2026-11-13T12:00:05Z", "2026-11-14T15:00:00Z"), false); // Saturday, Friday already ran
    assert.equal(due(d, "2026-11-13T12:00:05Z", "2026-11-15T15:00:00Z"), false); // Sunday
    assert.equal(due(d, "2026-11-13T12:00:05Z", "2026-11-16T12:00:00Z"), true); // Monday
  });
  it("weekdays: a missed Friday catches up on Saturday, once", () => {
    const d = r("a", "weekdays 07:00");
    assert.equal(due(d, "2026-11-12T12:00:05Z", "2026-11-14T15:00:00Z"), true);
    assert.equal(due(d, "2026-11-14T15:00:05Z", "2026-11-14T16:00:00Z"), false);
  });
  it("weekly: only the named day, at the time", () => {
    const d = r("a", "weekly sun 18:00"); // Sunday 2026-11-15 18:00 EST = 23:00Z
    assert.equal(due(d, "2026-11-08T23:00:05Z", "2026-11-15T22:59:00Z"), false);
    assert.equal(due(d, "2026-11-08T23:00:05Z", "2026-11-15T23:00:00Z"), true);
    assert.equal(due(d, "2026-11-15T23:00:05Z", "2026-11-18T15:00:00Z"), false); // Wednesday, already ran
    assert.equal(due(d, "2026-11-15T23:00:05Z", "2026-11-22T22:59:00Z"), false);
    assert.equal(due(d, "2026-11-15T23:00:05Z", "2026-11-22T23:00:00Z"), true);
  });
  it("is read in the owner's time zone, not UTC or the machine's", () => {
    const d = r("a", "daily 07:00");
    const tokyo = (now: string) => ids(dueRoutines([d], { a: "2026-11-14T22:00:05Z" }, z(now), { timezone: "Asia/Tokyo" })).length === 1;
    assert.equal(tokyo("2026-11-15T22:00:00Z"), true); // 07:00 JST Monday
    assert.equal(due(d, "2026-11-15T12:00:05Z", "2026-11-15T22:00:00Z"), false); // same instant in New York: 17:00 Sunday, today's 07:00 already ran
  });
});

describe("at most once, and catch-up", () => {
  it("a slot fires once: after the run is recorded it is not due again", () => {
    const d = r("a", "weekdays 07:00");
    const now = z("2026-11-16T12:00:00Z");
    assert.equal(ids(dueRoutines([d], {}, now)).length, 1); // never run, inside grace
    assert.equal(ids(dueRoutines([d], { a: now }, new Date(now.getTime() + 1000))).length, 0);
    assert.equal(ids(dueRoutines([d], { a: now.getTime() }, new Date(now.getTime() + 3 * 3600_000))).length, 0);
  });
  it("after downtime a routine fires once, not once per missed day", () => {
    const d = r("a", "weekdays 07:00");
    const last = "2026-11-12T12:00:10Z"; // Thursday; server was down Fri to Mon
    const now = z("2026-11-16T15:00:00Z");
    assert.deepEqual(ids(dueRoutines([d], { a: last }, now)), ["a"]);
    assert.deepEqual(ids(dueRoutines([d], { a: now }, new Date(now.getTime() + 60_000))), []); // recorded: done
  });
  it("downtime longer than the lookback still fires once", () => {
    assert.equal(due(r("a", "daily 07:00"), "2026-09-01T12:00:00Z", "2026-11-16T15:00:00Z"), true);
    assert.equal(due(r("a", "weekly mon 07:00"), "2026-09-01T12:00:00Z", "2026-11-18T15:00:00Z"), true);
  });
  it("a never-run routine ignores slots older than the grace window", () => {
    const d = r("a", "daily 07:00");
    assert.equal(due(d, undefined, "2026-11-16T12:30:00Z"), true); // 30 min after
    assert.equal(due(d, undefined, "2026-11-16T17:00:00Z"), false); // enabled at noon: no 07:00 run
    assert.equal(ids(dueRoutines([d], {}, z("2026-11-16T17:00:00Z"), { graceMinutes: 600 })).length, 1);
  });
  it("accepts last-run times as ISO text, ms or Date", () => {
    const d = r("a", "daily 07:00");
    const now = z("2026-11-16T15:00:00Z");
    const last = z("2026-11-16T12:00:05Z");
    for (const v of [last, last.getTime(), last.toISOString()]) assert.equal(ids(dueRoutines([d], { a: v }, now)).length, 0);
  });
});

describe("daylight saving, America/New_York", () => {
  it("spring forward (Sun 2026-03-08): a 07:00 routine follows the clock, not a fixed UTC hour", () => {
    const d = r("a", "daily 07:00");
    const sat = "2026-03-07T12:00:05Z"; // Saturday 07:00 EST
    assert.equal(due(d, sat, "2026-03-08T10:59:59Z"), false);
    assert.equal(due(d, sat, "2026-03-08T11:00:00Z"), true); // 07:00 EDT
    assert.equal(due(d, "2026-03-08T11:00:05Z", "2026-03-09T10:59:00Z"), false);
    assert.equal(due(d, "2026-03-08T11:00:05Z", "2026-03-09T11:00:00Z"), true);
  });
  it("spring forward: a time that does not exist (02:30) fires once, shifted by the gap to 03:30 EDT", () => {
    const d = r("a", "daily 02:30");
    const sat = "2026-03-07T07:30:05Z"; // Saturday 02:30 EST
    assert.equal(localToInstant(2026, 3, 8, 2, 30, "America/New_York"), Date.parse("2026-03-08T07:30:00Z"));
    assert.equal(due(d, sat, "2026-03-08T07:29:59Z"), false);
    assert.equal(due(d, sat, "2026-03-08T07:30:00Z"), true);
    assert.equal(due(d, "2026-03-08T07:30:05Z", "2026-03-08T20:00:00Z"), false);
    assert.equal(due(d, "2026-03-08T07:30:05Z", "2026-03-09T06:29:59Z"), false); // Monday 02:30 EDT is 06:30Z
    assert.equal(due(d, "2026-03-08T07:30:05Z", "2026-03-09T06:30:00Z"), true);
  });
  it("fall back (Sun 2026-11-01): 07:00 is 07:00 EST again, one UTC hour later", () => {
    const d = r("a", "daily 07:00");
    const sat = "2026-10-31T11:00:05Z"; // Saturday 07:00 EDT
    assert.equal(due(d, sat, "2026-11-01T11:59:59Z"), false);
    assert.equal(due(d, sat, "2026-11-01T12:00:00Z"), true); // 07:00 EST
  });
  it("fall back: a repeated time (01:30 happens twice) fires once, on the first pass", () => {
    const d = r("a", "daily 01:30");
    const sat = "2026-10-31T05:30:05Z"; // Saturday 01:30 EDT
    assert.equal(localToInstant(2026, 11, 1, 1, 30, "America/New_York"), Date.parse("2026-11-01T05:30:00Z"));
    assert.equal(due(d, sat, "2026-11-01T05:29:59Z"), false);
    assert.equal(due(d, sat, "2026-11-01T05:30:00Z"), true);
    assert.equal(due(d, "2026-11-01T05:30:05Z", "2026-11-01T06:30:00Z"), false); // second 01:30 (EST): not again
    assert.equal(due(d, "2026-11-01T05:30:05Z", "2026-11-01T20:00:00Z"), false);
    assert.equal(due(d, "2026-11-01T05:30:05Z", "2026-11-02T06:30:00Z"), true); // Monday 01:30 EST
  });
  it("a weekly Sunday routine on a DST Sunday still fires once that day", () => {
    const d = r("a", "weekly sun 18:00");
    assert.equal(latestSlot({ kind: "weekly", day: 0, hour: 18, minute: 0 }, Date.parse("2026-03-08T23:00:00Z"), "America/New_York"), Date.parse("2026-03-08T22:00:00Z")); // 18:00 EDT
    assert.equal(due(d, "2026-03-01T23:00:05Z", "2026-03-08T21:59:59Z"), false);
    assert.equal(due(d, "2026-03-01T23:00:05Z", "2026-03-08T22:00:00Z"), true);
  });
});

describe("disabled and invalid", () => {
  it("disabled routines are never due, however overdue, and are not judged", () => {
    const list = [r("off", "daily 07:00", false), r("off-bad", "garbage", false)];
    const res = dueRoutines(list, { off: "2020-01-01T00:00:00Z" }, z("2026-11-16T15:00:00Z"));
    assert.deepEqual(res, { due: [], invalid: [] });
    assert.deepEqual(dueRoutines(list, {}, z("2026-11-16T12:00:00Z")).due, []);
  });
  it("a bad schedule is reported, never thrown, and does not stop the others", () => {
    const list = [r("bad", "daily 25:99"), r("ok", "daily 07:00"), r("inj", "daily 07:00; rm -rf /")];
    const res = dueRoutines(list, { ok: "2026-11-15T12:00:05Z" }, z("2026-11-16T12:00:00Z"));
    assert.deepEqual(ids(res), ["ok"]);
    assert.deepEqual(res.invalid.map((x) => x.id), ["bad", "inj"]);
  });
  it("rejects malformed routine entries and last-run values safely", () => {
    const junk = [null, 5, "x", {}, { id: "" }, { id: "a", schedule: 5 }, { id: "p", schedule: "daily 07:00", enabled: "yes" }] as unknown as R[];
    assert.doesNotThrow(() => dueRoutines(junk, {}, z("2026-11-16T15:00:00Z")));
    assert.equal(dueRoutines(junk, {}, z("2026-11-16T15:00:00Z")).due.length, 0);
    const res = dueRoutines([r("a", "daily 07:00")], { a: "banana" }, z("2026-11-16T15:00:00Z"));
    assert.deepEqual([res.due.length, res.invalid.length], [0, 1]);
  });
  it("ids like __proto__ and constructor are plain keys, not inherited ones", () => {
    const list = [r("__proto__", "daily 07:00"), r("constructor", "daily 07:00")];
    assert.deepEqual(ids(dueRoutines(list, {}, z("2026-11-16T12:00:00Z"))), ["__proto__", "constructor"]);
  });
  it("a bad time zone or bad now throws (a config bug, not a routine problem)", () => {
    assert.throws(() => dueRoutines([], {}, z("2026-11-16T12:00:00Z"), { timezone: "Mars/Olympus" }), RangeError);
    assert.throws(() => dueRoutines([], {}, new Date("nope")), RangeError);
  });
  it("is pure: same inputs, same answer, inputs untouched", () => {
    const list = [r("a", "daily 07:00")];
    const last = { a: "2026-11-15T12:00:05Z" };
    const snap = JSON.stringify([list, last]);
    const a = dueRoutines(list, last, z("2026-11-16T12:00:00Z"));
    const b = dueRoutines(list, last, z("2026-11-16T12:00:00Z"));
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify([list, last]), snap);
  });
});

describe("the real routines.json", () => {
  it("every shipped routine has a valid schedule and starts disabled", async () => {
    const { readFileSync } = await import("node:fs");
    const file = new URL("../../routines/routines.json", import.meta.url);
    const list = JSON.parse(readFileSync(file, "utf8")) as (R & { skill?: string; tier?: string; builtin?: string })[];
    assert.equal(list.length >= 4, true);
    for (const x of list) { assert.equal(parseSchedule(x.schedule).ok, true, x.id); assert.equal(x.enabled, false, x.id); if (x.builtin) assert.deepEqual([["vault-backup", "month-costs"].includes(x.builtin), x.skill, x.tier], [true, undefined, undefined], "a built-in routine names no skill and no tier: no model runs"); else assert.match(x.tier ?? "", /^T[23]$/); }
  });
});
