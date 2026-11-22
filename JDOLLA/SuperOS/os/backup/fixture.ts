// Fixtures for the backup tests: a temp vault that is its own git repo, a local bare repo as the remote, and planted secrets.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const NOW = new Date("2026-11-22T20:00:00Z");
export const TZ = "America/New_York";

export function git(cwd: string, ...args: string[]): { code: number | null; out: string; err: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
export function put(vault: string, rel: string, text: string | Buffer = `text of ${rel}\n`): string {
  const f = path.join(vault, rel);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, text);
  return f;
}
export const tmp = (prefix: string): string => mkdtempSync(path.join(tmpdir(), prefix));

/** Things that must never be backed up. */
export const FORBIDDEN = [
  ".env", "wiki/.env", "wiki/software/prod.env", "wiki/software/server.key", "wiki/software/cert.pem", ".claude/settings.json", "logs/x", "logs/router.jsonl",
  "os/secret.txt", "os/.env", "raw/sessions/s1.md", "inbox/_feeds/mail.json", "inbox/_feeds/calendar.json", "outputs/_work/abc/scratch.md", "wiki/.hidden/n.md",
] as const;
/** Things that must be backed up. */
export const WANTED = ["CLAUDE.md", "Home.md", "wiki/software/a.md", "raw/software/b.md", "daily/2026-11-22.md", "outputs/2026-11/2026-11-22_software_x.md", "routines/routines.json", "inbox/loose.txt"] as const;

export function makeBackupVault(opts: { identity?: boolean } = {}): { vault: string; remote: string; branchOf: (repo: string) => string } {
  const vault = tmp("backup-vault-");
  git(vault, "init", "-q", "-b", "main");
  if (opts.identity !== false) { git(vault, "config", "user.name", "Test Backup"); git(vault, "config", "user.email", "backup@example.com"); }
  git(vault, "config", "commit.gpgsign", "false");
  for (const f of WANTED) put(vault, f, `NOTE ${f}\n`);
  for (const f of FORBIDDEN) put(vault, f, `SECRET ${f}\n`);
  put(vault, "os/code.ts", "export const x = 1;\n");
  symlinkSync("/etc/hostname", path.join(vault, "wiki", "software", "link.md"));
  const remote = tmp("backup-remote-");
  git(remote, "init", "-q", "--bare", "-b", "main");
  return { vault, remote, branchOf: (repo) => git(repo, "rev-parse", "--abbrev-ref", "HEAD").out.trim() };
}

/** Paths in a repo's tree at a ref. */
export function tree(repo: string, ref = "HEAD"): string[] {
  return git(repo, "ls-tree", "-r", "--name-only", ref).out.split("\n").filter(Boolean).sort();
}
