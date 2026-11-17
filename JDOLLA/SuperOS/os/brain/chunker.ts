// Heading-based Markdown chunker. Pure: text in, chunks out.
export interface Chunk {
  heading: string; // breadcrumb, e.g. "Servo > Alarms"
  text: string;
}

export const MAX_CHUNK_CHARS = 2000;

/** Splits text at paragraph breaks so no piece is much longer than max. */
function splitLong(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur = "";
  for (const para of text.split(/\n{2,}/)) {
    if (cur && cur.length + para.length + 2 > max) { out.push(cur); cur = ""; }
    if (para.length > max) {
      for (let i = 0; i < para.length; i += max) out.push(para.slice(i, i + max));
    } else cur = cur ? `${cur}\n\n${para}` : para;
  }
  if (cur) out.push(cur);
  return out;
}

/** body must already have frontmatter removed. Headings inside ``` fences are not headings. */
export function chunkMarkdown(body: string, docTitle: string): Chunk[] {
  const chunks: Chunk[] = [];
  const stack: { level: number; title: string }[] = [];
  let heading = docTitle;
  let buf: string[] = [];
  let fence = false;
  const flush = (): void => {
    const text = buf.join("\n").trim();
    buf = [];
    if (!text) return;
    for (const piece of splitLong(text, MAX_CHUNK_CHARS)) chunks.push({ heading, text: piece });
  };
  for (const line of body.split(/\r?\n/)) {
    if (/^\s{0,3}(```|~~~)/.test(line)) fence = !fence;
    const m = fence ? null : /^(#{1,6})[ \t]+(.{1,200}?)[ \t#]*$/.exec(line);
    if (m?.[1] && m[2]) {
      flush();
      const level = m[1].length;
      while (stack.length && (stack[stack.length - 1] as { level: number }).level >= level) stack.pop();
      stack.push({ level, title: m[2].trim() });
      heading = stack.map((s) => s.title).join(" > ");
      continue;
    }
    buf.push(line);
  }
  flush();
  return chunks;
}
