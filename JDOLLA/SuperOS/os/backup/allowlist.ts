// What a vault backup may contain. Everything else (secrets, logs, code, imported sessions, private feeds) is never staged.
// isAllowedPath() is the one rule: the pathspecs given to `git add` are derived from it, and the paths git reports as
// staged are checked against it again before anything is committed.
export const ALLOWED_TOPS = ["wiki", "raw", "outputs", "inbox", "daily", "projects", "reports", "depts", "skills", "docs", "evals", "apps", "routines", "proposals"] as const;
export const ALLOWED_ROOT_FILES = ["CLAUDE.md", "Home.md"] as const;
/** Inside an allowed folder but still never backed up. */
export const EXCLUDED_PREFIXES = ["raw/sessions", "outputs/_work", "inbox/_feeds"] as const;
/** A file this big is refused, not pushed: a backup of notes should never need it. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

const SECRET_NAME = /\.env(\.|$)|\.(pem|key|p12|pfx)$|^id_(rsa|dsa|ecdsa|ed25519)/i;

/** True when a vault-relative posix path may be part of a backup. */
export function isAllowedPath(rel: string): boolean {
  if (!rel || rel.includes("\\") || rel.includes("\0") || rel.startsWith("/")) return false;
  const segs = rel.split("/");
  if (segs.some((s) => s === "" || s === "." || s === ".." || s.startsWith("."))) return false; // dot entries: .env, .git, .claude ...
  if (segs.some((s) => SECRET_NAME.test(s))) return false;
  const lower = rel.toLowerCase();
  if (segs.length === 1) return (ALLOWED_ROOT_FILES as readonly string[]).includes(rel);
  if (!(ALLOWED_TOPS as readonly string[]).includes((segs[0] as string).toLowerCase())) return false; // not os/, logs/, .claude/ ...
  return !EXCLUDED_PREFIXES.some((p) => lower === p || lower.startsWith(`${p}/`));
}

/** Pathspecs for `git add` / `git status`: the allowed folders and files that exist, minus the exclusions. */
export function pathspecs(existing: (rel: string) => boolean): string[] {
  const positive = [...ALLOWED_TOPS, ...ALLOWED_ROOT_FILES].filter((p) => existing(p));
  if (!positive.length) return [];
  return [
    ...positive,
    ...EXCLUDED_PREFIXES.map((p) => `:(exclude)${p}`),
    ":(exclude,glob)**/.*", ":(exclude,glob)**/.*/**",
    ":(exclude,glob)**/*.env", ":(exclude,glob)**/*.env.*", ":(exclude,glob)**/*.pem", ":(exclude,glob)**/*.key",
  ];
}

/**
 * Paths that must never reach the remote even if someone committed them by hand: secrets and the PC's private runtime
 * folders. Checked against the whole tree about to be pushed. Broader than isAllowedPath on purpose NOT to be: a
 * committed .gitignore or .obsidian/ is the owner's business; a committed .env or logs/ is not.
 */
export function isNeverPushed(rel: string): boolean {
  const segs = rel.split("/");
  if (segs.some((s) => SECRET_NAME.test(s))) return true;
  const lower = rel.toLowerCase();
  return ["logs", ".claude", ".git", ...EXCLUDED_PREFIXES].some((p) => lower === p || lower.startsWith(`${p}/`));
}
