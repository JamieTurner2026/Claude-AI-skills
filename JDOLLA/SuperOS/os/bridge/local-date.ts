// The owner's calendar day. Its own module so runs.ts and routine-runner.ts can both use it without importing each other.

/** YYYY-MM-DD in the owner's time zone. */
export function localDate(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
