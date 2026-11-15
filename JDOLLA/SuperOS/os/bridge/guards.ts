// Path guards for anything the dashboard asks the bridge to read or open.
// Rule: allow-list of vault folders and file types; resolve the real path before deciding.
import { realpathSync, statSync } from "node:fs";
import path from "node:path";

export class GuardError extends Error {}

const READ_ROOTS = new Set(["wiki", "raw", "depts", "docs", "outputs", "inbox", "routines", "apps", "skills", "proposals", "evals", "daily", "projects", "reports"]);
const ROOT_FILES = new Set(["home.md", "claude.md"]);
export const READ_EXT = new Set([".md", ".json", ".txt"]);
export const OPEN_EXT = new Set([".md", ".txt", ".json", ".csv", ".pdf", ".png", ".jpg", ".jpeg"]);
export const MAX_READ = 512 * 1024;

function checkSegments(rel: string): void {
  const segs = rel.split(path.sep);
  if (segs.some((s) => s === "" || s === "." || s === ".." || s.startsWith("."))) throw new GuardError("That path is not allowed.");
  const first = (segs[0] ?? "").toLowerCase();
  const ok = segs.length === 1 ? ROOT_FILES.has(first) : READ_ROOTS.has(first);
  if (!ok) throw new GuardError("That folder is not readable from the dashboard.");
}

/**
 * Turns a vault-relative path from the client into a real absolute path, or throws.
 * Blocks: absolute paths, "..", dot-files (.env, .git, .claude), os/, logs/, anything whose
 * real location (after following links) is outside the vault or outside the allowed folders.
 */
export function resolveVaultFile(vault: string, requested: unknown, allowedExt: ReadonlySet<string>): string {
  if (typeof requested !== "string" || requested.length === 0 || requested.length > 400) throw new GuardError("Bad path.");
  if (requested.includes("\0") || path.isAbsolute(requested) || /^[a-zA-Z]:/.test(requested) || requested.startsWith("\\\\")) throw new GuardError("Bad path.");
  const root = realpathSync(vault);
  const candidate = path.resolve(root, requested.replace(/[\\/]+/g, path.sep));
  const rel = path.relative(root, candidate);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new GuardError("That path is outside the vault.");
  checkSegments(rel);
  let real: string;
  try { real = realpathSync(candidate); } catch { throw new GuardError("File not found."); }
  const realRel = path.relative(root, real);
  if (!realRel || realRel.startsWith("..") || path.isAbsolute(realRel)) throw new GuardError("That path is outside the vault.");
  checkSegments(realRel); // a link inside wiki/ must not lead into os/ or .env
  if (!allowedExt.has(path.extname(real).toLowerCase())) throw new GuardError("That file type is not allowed.");
  if (!statSync(real).isFile()) throw new GuardError("Not a file.");
  return real;
}
