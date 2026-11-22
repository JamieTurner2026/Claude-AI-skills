// Vault backup (Phase 9c prep): commit the vault's content to the vault's own private git repo and push it to the one
// remote named in config. Safe to switch on later: nothing here runs until a routine is enabled or Jay runs `npm run backup`.
//  - git is run with an argument list (no shell) and only inside the vault folder;
//  - only allowlisted paths are staged (backup/allowlist.ts), and what git reports as staged is checked against the
//    allowlist again before committing; links and oversized files are refused;
//  - hooks are off, there is no force of any kind, and the only push is `HEAD:refs/heads/<branch>` to the configured URL;
//  - it never reads, writes or asks for credentials: git uses the login this PC already has;
//  - it refuses (plain message, nothing committed) when no remote is named, the URL is not a GitHub one in the two
//    allowed spellings, the remote is the public code repo, or the vault sits in (or is) a repo that points at it.
import { lstatSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { dateIn } from "../sources/file-source.ts";
import { MAX_FILE_BYTES, isAllowedPath, isNeverPushed, pathspecs } from "./allowlist.ts";
import { makeGit } from "./git.ts";
import type { GitRunner } from "./git.ts";
import { MSG_BAD_URL, MSG_NESTED, MSG_NOT_A_REPO, MSG_PUBLIC_REMOTE, MSG_PUBLIC_VAULT, PUBLIC_REPOS, checkRemote, isPublicRepo, repoId } from "./remote.ts";

export type BackupStatus = "refused" | "dry-run" | "nothing" | "pushed" | "failed";
export type BackupFile = { change: "added" | "changed" | "removed"; path: string };
export type BackupResult = { status: BackupStatus; message: string; files: BackupFile[]; committed: boolean; pushed: boolean; /** Links and over-size files left out of the backup. */ skipped: number };

export type BackupOptions = {
  vault: string; remote: string; branch: string; timezone: string; now: Date; dryRun?: boolean;
  /** Tests only (never from config): accept a bare repo on disk as the remote. */
  allowFileRemote?: boolean;
  /** Tests only: extra repos that count as "public". */
  publicRepos?: readonly string[];
  /** Tests only: sees every git argument list. */
  spy?: (args: readonly string[]) => void;
  git?: GitRunner;
};

const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/;
const MAX_LISTED = 200;

const result = (status: BackupStatus, message: string, files: BackupFile[] = [], committed = false, pushed = false, skipped = 0): BackupResult => ({ status, message, files, committed, pushed, skipped });
const clip = (s: string, n: number): string => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

function change(x: string, y: string): BackupFile["change"] {
  if (x === "D" || y === "D") return "removed";
  if (x === "A" || x === "?" || y === "?") return "added";
  return "changed";
}

/** `git status --porcelain=v1 -z` entries: two status letters and a path. */
function parseStatus(out: string): Array<{ x: string; y: string; path: string }> {
  return out.split("\0").filter((e) => e.length > 3).map((e) => ({ x: e[0] as string, y: e[1] as string, path: e.slice(3) }));
}

export async function runBackup(o: BackupOptions): Promise<BackupResult> {
  try { return await backup(o); } catch { return result("failed", "The backup stopped unexpectedly. Nothing was pushed."); }
}

async function backup(o: BackupOptions): Promise<BackupResult> {
  const publicRepos = o.publicRepos ?? PUBLIC_REPOS;
  const remote = o.remote.trim();
  const refusal = checkRemote(remote, { allowFile: o.allowFileRemote === true, publicRepos });
  if (refusal) return result("refused", refusal);
  if (!BRANCH.test(o.branch) || o.branch.includes("..") || o.branch.endsWith(".lock")) return result("refused", "engine.backup.branch must be a plain branch name such as main. Nothing was pushed.");
  let vault: string;
  try { vault = realpathSync(o.vault); } catch { return result("failed", "The vault folder was not found."); }

  const raw = o.git ?? makeGit(vault);
  const SAFE = ["-c", `core.hooksPath=${os.devNull}`, "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false", "-c", "protocol.allow=never",
    "-c", "protocol.https.allow=always", "-c", "protocol.ssh.allow=always", ...(o.allowFileRemote === true ? ["-c", "protocol.file.allow=always"] : [])];
  const git: GitRunner = (args, t) => { const full = [...SAFE, ...args]; o.spy?.(full); return raw(full, t); };

  const v = await git(["--version"]);
  if (v.code !== 0) return result("failed", "git is not installed (or not on PATH) on this PC. Install Git for Windows, then try again.");

  // Is the vault its own repo, and does anything in that repo point at the public one?
  const top = await git(["rev-parse", "--show-toplevel"]);
  if (top.code !== 0 || !top.stdout.trim()) return result("refused", MSG_NOT_A_REPO);
  let topReal: string;
  try { topReal = realpathSync(top.stdout.trim()); } catch { return result("refused", MSG_NOT_A_REPO); }
  const urls = await git(["config", "--get-regexp", "^remote\\..*\\.(url|pushurl)$"]);
  for (const line of urls.stdout.split("\n")) {
    const u = line.trim().split(/\s+/, 2)[1];
    if (u && isPublicRepo(u, publicRepos)) return result("refused", MSG_PUBLIC_VAULT);
  }
  const same = process.platform === "win32" ? topReal.toLowerCase() === vault.toLowerCase() : topReal === vault;
  if (!same) return result("refused", MSG_NESTED);

  // The URL as git will really use it (git's own url rewrite rules applied): it must still pass every check.
  if (!/^(file:\/\/)?(\/|[A-Za-z]:[\\/])/.test(remote)) {
    const resolved = await git(["ls-remote", "--get-url", remote]);
    const r = resolved.stdout.trim();
    if (resolved.code === 0 && r && r !== remote) {
      if (isPublicRepo(r, publicRepos)) return result("refused", MSG_PUBLIC_REMOTE);
      if (checkRemote(r, { publicRepos }) !== null) return result("refused", MSG_BAD_URL);
    }
  }

  const exists = (rel: string): boolean => { try { lstatSync(path.join(vault, rel)); return true; } catch { return false; } };
  const specs = pathspecs(exists);
  if (!specs.length) return result("nothing", "There is nothing in the vault to back up yet.");

  // What is staged right now, checked against the allowlist (and for links and big files).
  const staged = async (): Promise<{ files: BackupFile[]; problem: string | null }> => {
    const s = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=no"]);
    if (s.code !== 0) return { files: [], problem: "git could not list the staged files" };
    const files: BackupFile[] = [];
    for (const e of parseStatus(s.stdout)) {
      if (e.x === " " || e.x === "?" || e.x === "!") continue; // not staged
      if (!isAllowedPath(e.path)) return { files, problem: `"${clip(e.path, 100)}" is staged but is not allowed in a backup` };
      if (e.x !== "D") {
        try {
          const st = lstatSync(path.join(vault, e.path));
          if (st.isSymbolicLink()) return { files, problem: `"${clip(e.path, 100)}" is a link, and links are not backed up` };
          if (st.size > MAX_FILE_BYTES) return { files, problem: `"${clip(e.path, 100)}" is over ${MAX_FILE_BYTES / 1024 / 1024} MB` };
        } catch { return { files, problem: `"${clip(e.path, 100)}" could not be checked` }; }
      }
      files.push({ change: change(e.x, e.y), path: e.path });
    }
    return { files, problem: null };
  };
  const refuseStaged = (problem: string): BackupResult => result("refused", `Refusing to commit: ${problem}. Nothing was committed or pushed. Unstage it with: git restore --staged <path>`);

  // Links and over-size files are left out (never followed, never uploaded) and counted; they do not stop the backup.
  const pending = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--", ...specs]);
  if (pending.code !== 0) return result("failed", "git could not list the vault's changes.");
  const skip: string[] = [];
  const candidates: BackupFile[] = [];
  for (const e of parseStatus(pending.stdout)) {
    if (!isAllowedPath(e.path)) continue;
    if (e.x !== "D" && e.y !== "D") {
      try {
        const st = lstatSync(path.join(vault, e.path));
        if (st.isSymbolicLink() || st.size > MAX_FILE_BYTES) { skip.push(e.path); continue; }
      } catch { skip.push(e.path); continue; }
    }
    candidates.push({ change: change(e.x, e.y), path: e.path });
  }
  const skipNote = skip.length ? ` ${skip.length} link${skip.length === 1 ? "" : "s"} or file${skip.length === 1 ? "" : "s"} over ${MAX_FILE_BYTES / 1024 / 1024} MB left out.` : "";
  const finalSpecs = [...specs, ...skip.map((p) => `:(exclude,literal)${p}`)];

  if (o.dryRun === true) {
    const s0 = await staged();
    if (s0.problem) return refuseStaged(s0.problem);
    return result("dry-run", `Dry run: ${candidates.length} file${candidates.length === 1 ? "" : "s"} would be committed and pushed.${skipNote} Nothing was changed or pushed.`, candidates.slice(0, MAX_LISTED), false, false, skip.length);
  }

  const add = await git(["add", "-A", "--", ...finalSpecs]);
  if (add.code !== 0) return result("failed", `git could not stage the vault: ${clip(add.stderr, 120)}`);
  const s = await staged();
  if (s.problem) return refuseStaged(s.problem);

  let committed = false;
  if (s.files.length) {
    const date = dateIn(o.now.getTime(), o.timezone);
    const c = await git(["commit", "--no-verify", "--no-gpg-sign", "-m", `vault backup ${date}`]);
    if (c.code !== 0) {
      const err = `${c.stderr} ${c.stdout}`;
      if (/tell me who you are|user\.(name|email)|empty ident/i.test(err)) return result("failed", "git does not know who you are. In the vault folder run: git config user.name \"Your Name\" and git config user.email \"you@example.com\". Nothing was pushed.");
      return result("failed", `git could not commit: ${clip(err, 120)}. Nothing was pushed.`);
    }
    committed = true;
  }
  const head = await git(["rev-parse", "--verify", "-q", "HEAD"]);
  if (head.code !== 0) return result("nothing", `There is nothing to back up yet.${skipNote}`, [], false, false, skip.length);

  // Everything committed so far is about to be pushed, not just tonight's commit: a secret committed by hand stops the push.
  const tipTree = await git(["ls-tree", "-r", "-z", "--name-only", "HEAD"]);
  const leaked = tipTree.stdout.split("\0").find((p) => p && isNeverPushed(p));
  if (leaked) return result("refused", `Refusing to push: "${clip(leaked, 100)}" is already committed in the vault's git repo and must never be backed up. Remove it from git (git rm --cached) and commit; nothing was pushed.`, s.files.slice(0, MAX_LISTED), committed, false, skip.length);

  // No --force, no leading "+", no mirror or delete: a push that is not a plain fast-forward is refused by git.
  const p = await git(["push", "--no-verify", remote, `HEAD:refs/heads/${o.branch}`], 180_000);
  const out = `${p.stderr} ${p.stdout}`;
  if (p.code !== 0) {
    if (/non-fast-forward|fetch first|\(rejected\)|\[rejected\]/i.test(out)) return result("failed", "The remote has changes this PC does not have, so git refused the push. Nothing was forced. Pull them into the vault folder first.", s.files.slice(0, MAX_LISTED), committed, false, skip.length);
    if (/authentication|could not read (username|password)|permission denied|terminal prompts disabled|repository not found|access denied|403|401/i.test(out)) return result("failed", "git could not sign in to GitHub. Sign in on this PC first (for example with Git Credential Manager or an SSH key), then try again. Nothing was forced.", s.files.slice(0, MAX_LISTED), committed, false, skip.length);
    return result("failed", `git could not push: ${clip(out, 120)}`, s.files.slice(0, MAX_LISTED), committed, false, skip.length);
  }
  if (!committed && /up-to-date|up to date/i.test(out)) return result("nothing", `Nothing new to back up; the remote is up to date.${skipNote}`, [], false, false, skip.length);
  const where = repoId(remote);
  return result("pushed", `Backed up ${s.files.length} changed file${s.files.length === 1 ? "" : "s"}${where && !remote.startsWith("/") ? ` to ${where}` : ""}.${skipNote}`, s.files.slice(0, MAX_LISTED), committed, true, skip.length);
}
