// Phase 8 prep: where mail and calendar items come from. Only the interfaces live here; the one implementation today is
// FileSource (sources/file-source.ts), which reads two files Jay drops in inbox/_feeds/. Nothing connects to an account,
// uses the network or stores a token. A live adapter later implements the same two interfaces.
export const SNIPPET_MAX = 300;
export const BRAIN_LABEL = "Brain";

export type MailItem = { id: string; from: string; subject: string; date: string; snippet: string };
export type CalendarItem = { start: string; end: string; title: string; location?: string };

export interface MailSource {
  /** Mail labelled Brain, dated at or after `since`, newest first. A missing or unreadable feed is an empty list, never an error. */
  listBrainLabelled(since: Date): MailItem[];
}
export interface CalendarSource {
  /** Events that fall on local date `date` (YYYY-MM-DD) in time zone `tz`, earliest first. Missing or unreadable feed: empty list. */
  today(date: string, tz: string): CalendarItem[];
}
