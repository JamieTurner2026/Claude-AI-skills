// Text from mail and calendar invites is written by other people. It is cleaned before it goes anywhere:
// one line, no control or invisible characters, capped. Unicode property classes keep this file plain ASCII.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu;

/** One line of plain text, capped at `max` characters. */
export function clean(text: string, max: number): string {
  return text.replace(INVISIBLE, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** For a Markdown line: clean() plus the characters that make links, HTML, code, tables, headings and emphasis. */
export function inert(text: string, max: number): string {
  return clean(text, max * 2).replace(/[[\]<>`|\\*_~#]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** "Ada Lovelace <ada@example.com>" -> "Ada Lovelace"; a bare address stays as it is. */
export function senderName(from: string): string {
  const m = /^\s*"?([^"<]*?)"?\s*<[^>]*>\s*$/.exec(from);
  const name = m?.[1]?.trim();
  return name ? name : from;
}
