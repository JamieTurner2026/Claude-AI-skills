// Parsers for past sessions: Claude Code JSONL transcripts and a claude.ai data export (conversations.json).
// Everything read here is untrusted. Parsing is defensive: anything unexpected is skipped, never trusted.
import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export type SessionSource = "claude-code" | "claude-ai";
export interface SessionMessage { role: "user" | "assistant"; text: string; at?: string }
export interface Session { source: SessionSource; id: string; title?: string; started?: string; messages: SessionMessage[]; origin: string }
export interface ParseReport { sessions: Session[]; skippedLines: number; skippedItems: number; files: number }

const MAX_JSONL = 100 * 1024 * 1024;
const MAX_EXPORT = 1024 * 1024 * 1024;

const TextPart = z.object({ type: z.literal("text"), text: z.string() }).passthrough();

/** Text parts only. tool_use, tool_result, thinking, images and unknown parts are dropped. */
function textOfParts(parts: unknown[]): string {
  const out: string[] = [];
  for (const p of parts) {
    const t = TextPart.safeParse(p);
    if (t.success && t.data.text.trim()) out.push(t.data.text);
  }
  return out.join("\n\n");
}

// ---------- Claude Code ----------

const CcLine = z.object({
  type: z.string(),
  message: z.object({ role: z.string().optional(), content: z.union([z.string(), z.array(z.unknown())]) }).passthrough().optional(),
  timestamp: z.string().optional(),
  sessionId: z.string().optional(),
  isMeta: z.boolean().optional(),
  isSidechain: z.boolean().optional(),
  summary: z.string().optional(),
}).passthrough();

/** Claude Code wraps slash-command output in these tags; it is tool output, not something Jay wrote. */
const CC_NOISE = /^\s*<(local-command-stdout|local-command-stderr|command-name|command-message|command-args|system-reminder)>/;

export function parseClaudeCodeJsonl(text: string, origin: string): { session: Session | null; skippedLines: number } {
  const messages: SessionMessage[] = [];
  let skippedLines = 0;
  let id = path.basename(origin, ".jsonl");
  let title: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let json: unknown;
    try { json = JSON.parse(line); } catch { skippedLines++; continue; }
    const r = CcLine.safeParse(json);
    if (!r.success) { skippedLines++; continue; }
    const l = r.data;
    if (l.type === "summary" && l.summary && !title) { title = l.summary; continue; }
    if (l.type !== "user" && l.type !== "assistant") continue;
    if (l.isMeta || l.isSidechain || !l.message) continue;
    if (l.sessionId && /^[\w-]{1,80}$/.test(l.sessionId)) id = l.sessionId;
    const c = l.message.content;
    // A user line whose content is an array may be a tool result: only its plain text parts are kept, so a
    // pure tool_result message comes out empty and is dropped.
    const body = typeof c === "string" ? c : textOfParts(c);
    if (!body.trim() || CC_NOISE.test(body)) continue;
    messages.push({ role: l.type, text: body, ...(l.timestamp ? { at: l.timestamp } : {}) });
  }
  if (!messages.length) return { session: null, skippedLines };
  const started = messages.find((m) => m.at)?.at;
  return { session: { source: "claude-code", id, ...(title ? { title } : {}), ...(started ? { started } : {}), messages, origin }, skippedLines };
}

/** Every *.jsonl under dir. Dot entries and links are skipped. */
export function listJsonl(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop() as string;
    let entries;
    try { entries = readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(full);
    }
  }
  return out.sort();
}

export function readClaudeCodeDir(dir: string): ParseReport {
  const rep: ParseReport = { sessions: [], skippedLines: 0, skippedItems: 0, files: 0 };
  for (const f of listJsonl(dir)) {
    if (lstatSync(f).isSymbolicLink() || statSync(f).size > MAX_JSONL) { rep.skippedItems++; continue; }
    rep.files++;
    const { session, skippedLines } = parseClaudeCodeJsonl(readFileSync(f, "utf8"), f);
    rep.skippedLines += skippedLines;
    if (session) rep.sessions.push(session); else rep.skippedItems++;
  }
  return rep;
}

// ---------- claude.ai export ----------

const AiMessage = z.object({
  sender: z.enum(["human", "assistant"]),
  text: z.string().optional(),
  content: z.array(z.unknown()).optional(),
  created_at: z.string().optional(),
}).passthrough();

const AiConversation = z.object({
  uuid: z.string().regex(/^[\w-]{1,80}$/),
  name: z.string().nullish(),
  created_at: z.string().optional(),
  chat_messages: z.array(z.unknown()),
}).passthrough();

export function parseClaudeAiExport(text: string, origin: string): ParseReport {
  const rep: ParseReport = { sessions: [], skippedLines: 0, skippedItems: 0, files: 1 };
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error("conversations.json is not valid JSON"); }
  if (!Array.isArray(json)) throw new Error("conversations.json should be a list of conversations");
  for (const item of json) {
    const c = AiConversation.safeParse(item);
    if (!c.success) { rep.skippedItems++; continue; }
    const messages: SessionMessage[] = [];
    for (const raw of c.data.chat_messages) {
      const m = AiMessage.safeParse(raw);
      if (!m.success) { rep.skippedLines++; continue; }
      const fromParts = m.data.content ? textOfParts(m.data.content) : "";
      const body = fromParts || m.data.text || "";
      if (!body.trim()) continue;
      messages.push({ role: m.data.sender === "human" ? "user" : "assistant", text: body, ...(m.data.created_at ? { at: m.data.created_at } : {}) });
    }
    if (!messages.length) { rep.skippedItems++; continue; }
    const started = c.data.created_at ?? messages.find((x) => x.at)?.at;
    rep.sessions.push({ source: "claude-ai", id: c.data.uuid, ...(c.data.name ? { title: c.data.name } : {}), ...(started ? { started } : {}), messages, origin });
  }
  return rep;
}

export function readClaudeAiExport(file: string): ParseReport {
  if (statSync(file).size > MAX_EXPORT) throw new Error("conversations.json is too large (over 1 GB)");
  return parseClaudeAiExport(readFileSync(file, "utf8"), file);
}

export function defaultClaudeCodeDir(): string {
  return path.join(process.env["USERPROFILE"] ?? process.env["HOME"] ?? ".", ".claude", "projects");
}
