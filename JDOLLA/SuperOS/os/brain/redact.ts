// Redaction for imported sessions. Runs on every message before anything is written to disk.
// Order matters: specific token shapes first, then key=value forms, then personal data, then generic long secrets.

export type RedactionKind =
  | "private-key" | "api-key" | "github-token" | "aws-key" | "slack-token" | "bearer" | "jwt"
  | "password" | "env-value" | "email" | "phone" | "long-number" | "hex-secret" | "base64-secret";

export interface RedactResult { text: string; counts: Partial<Record<RedactionKind, number>>; total: number }

const tag = (k: RedactionKind): string => `[REDACTED:${k}]`;

interface Rule { kind: RedactionKind; re: RegExp; replace?: (m: string, ...g: string[]) => string; keep?: (m: string) => boolean }

/** True when a long run of base64-ish characters looks like a secret rather than a path or a word. */
function looksLikeBase64Secret(s: string): boolean {
  if ((s.match(/\//g)?.length ?? 0) >= 3) return false; // file paths and URLs
  return /\d/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s);
}

const RULES: Rule[] = [
  { kind: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { kind: "api-key", re: /\bsk-[A-Za-z0-9_-]{16,}/g }, // OpenAI / Anthropic (sk-ant-...) style
  { kind: "github-token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { kind: "aws-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "slack-token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { kind: "bearer", re: /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{12,}/gi, replace: (_m, w) => `${w} ${tag("bearer")}` },
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  // password=..., pwd: ..., "password": "..."  (the key stays, the value goes)
  {
    kind: "password",
    re: /\b(passwd|password|passphrase|pwd|pass)(["']?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi,
    replace: (_m, k, sep) => `${k}${sep}${tag("password")}`,
    keep: (m) => /\[REDACTED:/.test(m),
  },
  // .env-style lines: KEY=value at the start of a line, no space before "="
  {
    kind: "env-value",
    re: /^([ \t]*(?:export[ \t]+)?[A-Z][A-Z0-9_]{1,63}=)(?!\s*$)(.+)$/gm,
    replace: (_m, k) => `${k}${tag("env-value")}`,
    keep: (m) => /=\s*\[REDACTED:[a-z0-9-]+\]\s*$/.test(m),
  },
  { kind: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g },
  // Phone numbers: +CC international, or North American (555) 123-4567 / 555-123-4567 / 555.123.4567
  { kind: "phone", re: /(?<![\w+-])(?:\+\d{1,3}[ .-]?(?:\(?\d{1,4}\)?[ .-]?){2,4}\d{2,4}|(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4})(?![\w-])/g },
  // Account, card and reference numbers: 9 or more digits, alone or in groups split by single spaces or dashes.
  // Dates (8 digits), years, ports and short codes stay.
  { kind: "long-number", re: /(?<![\w.-])\d(?:[ -]?\d){8,}(?![\w.-])/g },
  { kind: "hex-secret", re: /\b[0-9a-fA-F]{32,}\b/g },
  { kind: "base64-secret", re: /(?<![A-Za-z0-9+/_=-])[A-Za-z0-9+/_-]{40,}={0,2}(?![A-Za-z0-9+/_=-])/g, keep: (m) => !looksLikeBase64Secret(m) },
];

export const REDACTION_KINDS: readonly RedactionKind[] = RULES.map((r) => r.kind);

export function redact(input: string): RedactResult {
  let text = input;
  const counts: Partial<Record<RedactionKind, number>> = {};
  let total = 0;
  for (const rule of RULES) {
    text = text.replace(rule.re, (m: string, ...rest: unknown[]) => {
      if (rule.keep?.(m)) return m;
      counts[rule.kind] = (counts[rule.kind] ?? 0) + 1;
      total++;
      const groups = rest.filter((g): g is string => typeof g === "string");
      return rule.replace ? rule.replace(m, ...groups) : tag(rule.kind);
    });
  }
  return { text, counts, total };
}

export function addCounts(into: Partial<Record<RedactionKind, number>>, from: Partial<Record<RedactionKind, number>>): void {
  for (const [k, v] of Object.entries(from) as [RedactionKind, number][]) into[k] = (into[k] ?? 0) + v;
}
