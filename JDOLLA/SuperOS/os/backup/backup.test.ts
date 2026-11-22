// Phase 9c backup prep. Every "refused" check sits next to a control that goes through. Real git, a temp vault, a local bare repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_TOPS, MAX_FILE_BYTES, isAllowedPath, isNeverPushed } from "./allowlist.ts";
import { runBackup } from "./backup.ts";
import type { BackupOptions } from "./backup.ts";
import { parseArgs } from "./cli.ts";
import { FORBIDDEN, NOW, TZ, WANTED, git, makeBackupVault, put, tmp, tree } from "./fixture.ts";
import { makeGit } from "./git.ts";
import { MSG_BAD_URL, MSG_NESTED, MSG_NOT_A_REPO, MSG_NO_REMOTE, MSG_PUBLIC_REMOTE, MSG_PUBLIC_VAULT, checkRemote, isPublicRepo, repoId } from "./remote.ts";
import { readBackupRecord, writeBackupRecord } from "./record.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_HTTPS = "https://github.com/JamieTurner2026/Claude-AI-skills.git";
const PUBLIC_SSH = "git@github.com:JamieTurner2026/Claude-AI-skills.git";
const PRIVATE = "https://github.com/jay/private-brain.git";

type Spy = { calls: string[][]; spy: (a: readonly string[]) => void };
const spy = (): Spy => { const calls: string[][] = []; return { calls, spy: (a) => calls.push([...a]) }; };
const base = (vault: string, remote: string, over: Partial<BackupOptions> = {}): BackupOptions => ({ vault, remote, branch: "main", timezone: TZ, now: NOW, allowFileRemote: true, ...over });
const verbs = (calls: string[][]): string[] => calls.map((c) => c.find((a) => /^(add|commit|push|status|rev-parse|config|ls-remote|--version)$/.test(a)) ?? "?");

test("isAllowedPath: vault content yes; secrets, logs, code, sessions, feeds, dot entries, links out and odd paths no", () => {
  for (const p of ["CLAUDE.md", "Home.md", "wiki/a.md", "wiki/software/deep/a b.md", "raw/software/x.txt", "outputs/2026-11/f.md", "daily/2026-11-22.md", "inbox/loose.txt", "routines/routines.json", "proposals/p.json"]) assert.ok(isAllowedPath(p), p);
  for (const p of [".env", "wiki/.env", "wiki/x.env", "wiki/.env.local", "wiki/a/.hidden/n.md", ".claude/settings.json", ".git/config", "logs/x", "os/code.ts", "os/.env", "raw/sessions/s.md", "RAW/Sessions/s.md", "outputs/_work/a/b.md", "inbox/_feeds/mail.json", "Inbox/_Feeds/mail.json",
    "wiki/id_rsa", "wiki/server.pem", "wiki/server.key", "README.md", "package.json", "../x", "wiki/../os/x", "/etc/passwd", "wiki\\a.md", "wiki//a.md", "", "wiki/a\0.md", "node_modules/x.md", "other/x.md"]) assert.ok(!isAllowedPath(p), JSON.stringify(p));
  assert.ok(ALLOWED_TOPS.every((t) => !["os", "logs", ".claude"].includes(t)));
});

test("isNeverPushed: secrets and private runtime folders are caught anywhere in a tree; ordinary dot files are the owner's business", () => {
  for (const p of [".env", "wiki/.env.local", "a/b/prod.env", "wiki/k.pem", "id_ed25519", "logs/x", "Logs/x", ".claude/settings.json", "raw/sessions/s.md", "outputs/_work/a", "inbox/_feeds/mail.json", ".git/config"]) assert.ok(isNeverPushed(p), p);
  for (const p of [".gitignore", ".obsidian/app.json", "wiki/a.md", "os/code.ts", "raw/software/x.md", "outputs/2026-11/f.md", "logsbook/a.md"]) assert.ok(!isNeverPushed(p), p);
});

test("checkRemote: nothing named, bad spellings, the public repo in every spelling; two good spellings pass; file:// never from config", () => {
  assert.equal(checkRemote(""), MSG_NO_REMOTE);
  assert.equal(checkRemote("   "), MSG_NO_REMOTE);
  assert.match(MSG_NO_REMOTE, /^Name the private Brain repo first/);
  for (const bad of ["http://github.com/jay/r.git", "https://github.com/jay/r", "https://gitlab.com/jay/r.git", "git@gitlab.com:jay/r.git", "ssh://git@github.com/jay/r.git", "https://user:tok@github.com/jay/r.git", "https://github.com/jay/r.git; rm -rf /", "https://github.com/jay/r.git\n--force", "https://github.com/jay/sub/r.git",
    "file:///tmp/r.git", "/tmp/r.git", "C:\\r.git", "git@github.com:jay/r", "github.com/jay/r.git", "-u", "--upload-pack=x"]) {
    const msg = checkRemote(bad);
    assert.ok(msg === MSG_BAD_URL || msg === MSG_NO_REMOTE, `${bad} -> ${msg}`);
  }
  for (const pub of [PUBLIC_HTTPS, PUBLIC_SSH, "https://github.com/jamieturner2026/claude-ai-skills.git", "git@github.com:JAMIETURNER2026/CLAUDE-AI-SKILLS.git"]) assert.equal(checkRemote(pub), MSG_PUBLIC_REMOTE, pub);
  assert.equal(checkRemote(PRIVATE), null, "control: a private https repo");
  assert.equal(checkRemote("git@github.com:jay/private-brain.git"), null, "control: a private ssh repo");
  assert.equal(checkRemote("/tmp/x.git", { allowFile: true }), null, "the injected test option allows a local path");
  assert.equal(checkRemote("/tmp/x.git"), MSG_BAD_URL, "and config cannot");
  assert.equal(checkRemote("https://github.com/jay/Claude-AI-skills-private.git"), null, "a similar name is not the public repo");
  assert.deepEqual([repoId("https://x:y@github.com/O/R.git"), repoId("http://local_proxy@127.0.0.1:9/git/O/R"), repoId("git@github.com:O/R.git/")], ["o/r", "o/r", "o/r"]);
  assert.equal(isPublicRepo("http://local_proxy@127.0.0.1:1234/git/JamieTurner2026/Claude-AI-skills"), true);
});

test("refusals that need no git: no remote, bad URL and the public repo all stop before git is even started", async () => {
  const { vault } = makeBackupVault();
  for (const [remote, msg] of [["", MSG_NO_REMOTE], ["http://github.com/a/b.git", MSG_BAD_URL], [PUBLIC_HTTPS, MSG_PUBLIC_REMOTE], [PUBLIC_SSH, MSG_PUBLIC_REMOTE]] as const) {
    const s = spy();
    const r = await runBackup(base(vault, remote, { allowFileRemote: false, spy: s.spy }));
    assert.deepEqual([r.status, r.message, r.committed, r.pushed, s.calls.length], ["refused", msg, false, false, 0], remote);
  }
  assert.equal(git(vault, "rev-parse", "--verify", "-q", "HEAD").code, 1, "nothing was committed");
  const s = spy();
  const control = await runBackup(base(vault, PRIVATE, { allowFileRemote: false, spy: s.spy, git: async () => ({ code: 1, stdout: "", stderr: "" }) }));
  assert.ok(s.calls.length > 0, "control: a private remote does go on to use git");
  assert.equal(control.status === "refused" || control.status === "failed", true);
});

test("branch names: anything that could be an option or a path is refused", async () => {
  const { vault, remote } = makeBackupVault();
  for (const b of ["", "--force", "-x", "a b", "a/../b", "x.lock", "refs/heads/x", "a;b"]) assert.equal((await runBackup(base(vault, remote, { branch: b }))).status, "refused", JSON.stringify(b));
  assert.equal((await runBackup(base(vault, remote, { branch: "backup-1.0", dryRun: true }))).status, "dry-run", "control");
});

test("the vault is not a git repo, or sits inside another: refused with plain messages and nothing is created", async () => {
  const plain = tmp("backup-plain-");
  put(plain, "wiki/a.md");
  const r1 = await runBackup(base(plain, tmp("r-")));
  assert.deepEqual([r1.status, r1.message], ["refused", MSG_NOT_A_REPO]);
  assert.ok(!existsSync(path.join(plain, ".git")), "it never runs git init itself");
  const outer = tmp("backup-outer-");
  git(outer, "init", "-q", "-b", "main");
  git(outer, "remote", "add", "origin", "https://github.com/jay/some-other-repo.git");
  const nested = path.join(outer, "vault");
  put(nested, "wiki/a.md");
  const r2 = await runBackup(base(nested, tmp("r-")));
  assert.deepEqual([r2.status, r2.message], ["refused", MSG_NESTED]);
  assert.equal(git(outer, "status", "--porcelain").out.includes("vault"), true, "control: git sees the vault as untracked content of the outer repo, and the backup did not stage it");
  assert.equal(git(outer, "diff", "--cached", "--name-only").out, "");
});

test("THE BIG ONE: a vault inside (or being) a repo that points at the public repo is refused, in every spelling, and nothing is staged, committed or pushed", async () => {
  for (const url of [PUBLIC_HTTPS, PUBLIC_SSH, "https://github.com/jamieturner2026/claude-ai-skills", "http://local_proxy@127.0.0.1:41/git/JamieTurner2026/Claude-AI-skills"]) {
    const outer = tmp("backup-pub-");
    git(outer, "init", "-q", "-b", "main");
    git(outer, "config", "user.name", "T"); git(outer, "config", "user.email", "t@example.com");
    git(outer, "remote", "add", "origin", url);
    const vault = path.join(outer, "JDOLLA", "SuperOS");
    for (const f of WANTED) put(vault, f, `PRIVATE NOTE ${f}\n`);
    const bare = tmp("backup-bare-"); git(bare, "init", "-q", "--bare", "-b", "main");
    const s = spy();
    const r = await runBackup(base(vault, bare, { spy: s.spy }));
    assert.deepEqual([r.status, r.message, r.committed, r.pushed], ["refused", MSG_PUBLIC_VAULT, false, false], url);
    assert.equal(git(outer, "diff", "--cached", "--name-only").out, "", "nothing staged");
    assert.equal(git(outer, "rev-parse", "--verify", "-q", "HEAD").code, 1, "nothing committed");
    assert.ok(!verbs(s.calls).some((v) => v === "add" || v === "commit" || v === "push"), "git add, commit and push were never run");
  }
  // The vault itself is a repo whose origin or push URL is the public repo.
  const own = makeBackupVault();
  git(own.vault, "remote", "add", "origin", PRIVATE);
  git(own.vault, "remote", "set-url", "--push", "origin", PUBLIC_SSH);
  assert.equal((await runBackup(base(own.vault, own.remote))).message, MSG_PUBLIC_VAULT, "a public push URL counts");
  const ok = makeBackupVault();
  git(ok.vault, "remote", "add", "origin", PRIVATE);
  assert.equal((await runBackup(base(ok.vault, ok.remote))).status, "pushed", "control: an origin that is a private repo is fine");
});

test("git's own URL rewriting cannot sneak the public repo in: an insteadOf rule that turns the private URL into the public one is refused", async () => {
  const { vault } = makeBackupVault();
  git(vault, "config", `url.${PUBLIC_HTTPS}.insteadOf`, PRIVATE);
  const s = spy();
  const r = await runBackup(base(vault, PRIVATE, { allowFileRemote: false, spy: s.spy }));
  assert.deepEqual([r.status, r.message], ["refused", MSG_PUBLIC_REMOTE]);
  assert.ok(!verbs(s.calls).some((v) => v === "add" || v === "commit" || v === "push"));
  const clean = makeBackupVault();
  git(clean.vault, "config", "url.git@github.com:.insteadOf", "https://github.com/");
  const s2 = spy();
  await runBackup(base(clean.vault, PRIVATE, { allowFileRemote: false, spy: s2.spy, git: async (a) => (a.includes("push") ? { code: 1, stdout: "", stderr: "Permission denied (publickey)" } : makeGit(clean.vault)(a)) }));
  assert.ok(verbs(s2.calls).includes("push"), "control: an https-to-ssh rewrite to a private repo is allowed and goes on to push");
});

test("backup pushes exactly the allowed files to the bare remote with the fixed message; secrets, logs, code, sessions, feeds and links are never staged", async () => {
  const { vault, remote } = makeBackupVault();
  for (const f of [...FORBIDDEN, ...WANTED]) assert.ok(existsSync(path.join(vault, f)), `control: ${f} is really there`);
  const s = spy();
  const r = await runBackup(base(vault, remote, { spy: s.spy }));
  assert.deepEqual([r.status, r.committed, r.pushed], ["pushed", true, true], r.message);
  assert.deepEqual(tree(remote, "main"), [...WANTED].sort(), "the remote holds exactly the wanted files");
  assert.deepEqual(tree(vault), [...WANTED].sort(), "and so does the local commit");
  for (const f of FORBIDDEN) assert.ok(!tree(remote, "main").includes(f), `${f} never left the vault`);
  assert.ok(!tree(remote, "main").some((p) => p.startsWith("os/") || p === "wiki/software/link.md"), "no code, no link");
  assert.equal(git(remote, "log", "-1", "--format=%s", "main").out.trim(), "vault backup 2026-11-22");
  assert.equal(git(remote, "rev-list", "--count", "main").out.trim(), "1");
  assert.match(r.message, /^Backed up 8 changed files\. 1 link or file over 25 MB left out\.$/);
  assert.equal(r.skipped, 1, "the link was left out, and counted");
  // argv audit
  const push = s.calls.filter((c) => c.includes("push"));
  assert.equal(push.length, 1);
  assert.deepEqual(push[0]!.slice(push[0]!.indexOf("push")), ["push", "--no-verify", remote, "HEAD:refs/heads/main"]);
  for (const c of s.calls) {
    for (const a of c) assert.ok(!/^(--force|-f|--force-with-lease.*|--mirror|--delete|--prune|--all|--tags|--no-thin)$/.test(a) && !a.startsWith("+") && !/^--force/.test(a), `no force-like argument: ${a}`);
    assert.ok(c.includes(`core.hooksPath=${os.devNull}`) && c.includes("core.fsmonitor=false"), "hooks and fsmonitor are always off");
    assert.ok(!c.includes("credential.helper") && !c.some((a) => /token|password|credential/i.test(a)), "credentials are never touched");
  }
  assert.deepEqual(verbs(s.calls).filter((v) => ["add", "commit", "push"].includes(v)), ["add", "commit", "push"]);
  assert.ok(s.calls.find((c) => c.includes("commit"))!.includes("--no-verify"));
});

test("links and files over 25 MB are left out (counted, never followed or uploaded) and do not stop the backup", async () => {
  const { vault, remote } = makeBackupVault();
  writeFileSync(path.join(vault, "raw/software/video.bin"), Buffer.alloc(MAX_FILE_BYTES + 1));
  put(vault, "raw/software/ok.bin", "small");
  symlinkSync(path.join(vault, "os"), path.join(vault, "wiki", "oslink"));
  const r = await runBackup(base(vault, remote));
  assert.deepEqual([r.status, r.skipped], ["pushed", 3], r.message);
  const t = tree(remote, "main");
  assert.ok(t.includes("raw/software/ok.bin") && !t.includes("raw/software/video.bin") && !t.includes("wiki/oslink") && !t.includes("wiki/software/link.md"));
  assert.ok(!t.some((p) => p.startsWith("os/")), "a link to os/ did not drag the code in");
});

test("a second run with nothing changed makes no commit; a changed and a deleted note go through as one new commit", async () => {
  const { vault, remote } = makeBackupVault();
  await runBackup(base(vault, remote));
  const again = await runBackup(base(vault, remote));
  assert.deepEqual([again.status, again.committed], ["nothing", false]);
  assert.equal(git(remote, "rev-list", "--count", "main").out.trim(), "1");
  put(vault, "wiki/software/a.md", "EDITED\n");
  rmSync(path.join(vault, "raw/software/b.md"));
  put(vault, "wiki/software/new.md");
  put(vault, ".env", "CHANGED SECRET\n");
  const next = await runBackup(base(vault, remote));
  assert.deepEqual([next.status, next.committed, next.pushed], ["pushed", true, true]);
  assert.equal(git(remote, "rev-list", "--count", "main").out.trim(), "2");
  const t = tree(remote, "main");
  assert.ok(t.includes("wiki/software/new.md") && !t.includes("raw/software/b.md") && !t.includes(".env"));
  assert.equal(git(remote, "show", "main:wiki/software/a.md").out, "EDITED\n");
  assert.deepEqual(next.files.map((f) => `${f.change}:${f.path}`).sort(), ["added:wiki/software/new.md", "changed:wiki/software/a.md", "removed:raw/software/b.md"]);
});

test("dry-run lists what would go and changes nothing: no add, commit or push, the index and the remote are untouched", async () => {
  const { vault, remote } = makeBackupVault();
  const before = git(vault, "status", "--porcelain=v1", "--untracked-files=all").out;
  const s = spy();
  const r = await runBackup(base(vault, remote, { dryRun: true, spy: s.spy }));
  assert.equal(r.status, "dry-run");
  assert.deepEqual(r.files.map((f) => f.path).sort(), [...WANTED].sort());
  assert.ok(r.files.every((f) => f.change === "added"));
  assert.match(r.message, /^Dry run: 8 files would be committed and pushed\. 1 link or file over 25 MB left out\. Nothing was changed or pushed\.$/);
  assert.ok(!verbs(s.calls).some((v) => v === "add" || v === "commit" || v === "push"), "no mutating git command ran");
  assert.equal(git(vault, "status", "--porcelain=v1", "--untracked-files=all").out, before, "the vault's git state is exactly as it was");
  assert.equal(git(vault, "rev-parse", "--verify", "-q", "HEAD").code, 1);
  assert.equal(git(remote, "for-each-ref").out, "", "nothing on the remote");
  const real = await runBackup(base(vault, remote));
  assert.equal(real.status, "pushed", "control: the same call without --dry-run does push");
  assert.deepEqual(parseArgs(["--dry-run"]), { dryRun: true });
  assert.deepEqual(parseArgs([]), { dryRun: false });
  assert.ok("error" in parseArgs(["--push"]) && "error" in parseArgs(["--dry-run", "x"]));
});

test("the check before committing: a forbidden file staged by hand (.env, logs/, a link, a big file) stops the commit; nothing is pushed", async () => {
  for (const bad of [".env", "logs/x", "os/secret.txt", "raw/sessions/s1.md", "inbox/_feeds/mail.json", "wiki/software/prod.env"]) {
    const { vault, remote } = makeBackupVault();
    git(vault, "add", "-f", "--", bad);
    const s = spy();
    const r = await runBackup(base(vault, remote, { spy: s.spy }));
    assert.equal(r.status, "refused", bad);
    assert.match(r.message, /^Refusing to commit: ".*" is staged but is not allowed in a backup\. Nothing was committed or pushed\./);
    assert.equal(git(vault, "rev-parse", "--verify", "-q", "HEAD").code, 1, "no commit was made");
    assert.equal(git(remote, "for-each-ref").out, "", "nothing pushed");
    assert.ok(!verbs(s.calls).includes("commit") && !verbs(s.calls).includes("push"));
  }
  const dry = makeBackupVault();
  git(dry.vault, "add", "-f", "--", ".env");
  assert.equal((await runBackup(base(dry.vault, dry.remote, { dryRun: true }))).status, "refused", "dry-run reports the same refusal");
  const link = makeBackupVault();
  git(link.vault, "add", "-f", "--", "wiki/software/link.md");
  assert.match((await runBackup(base(link.vault, link.remote))).message, /is a link, and links are not backed up/);
  const big = makeBackupVault();
  writeFileSync(path.join(big.vault, "wiki/software/huge.bin"), Buffer.alloc(MAX_FILE_BYTES + 1));
  git(big.vault, "add", "-f", "--", "wiki/software/huge.bin");
  const rb = await runBackup(base(big.vault, big.remote));
  assert.deepEqual([rb.status, /is over 25 MB/.test(rb.message)], ["refused", true], "a big file staged by hand is refused");
  assert.equal(git(big.remote, "for-each-ref").out, "");
  const fine = makeBackupVault();
  assert.equal((await runBackup(base(fine.vault, fine.remote))).status, "pushed", "control: without the planted file it goes through");
});

test("a secret committed by hand earlier is caught before the push, because the whole tree is what leaves", async () => {
  const { vault, remote } = makeBackupVault();
  git(vault, "add", "-f", "--", "wiki/software/prod.env");
  git(vault, "commit", "-q", "-m", "oops");
  writeFileSync(path.join(vault, "wiki/software/prod.env"), "NEW SECRET\n");
  const s = spy();
  const r = await runBackup(base(vault, remote, { spy: s.spy }));
  assert.equal(r.status, "refused", r.message);
  assert.match(r.message, /^Refusing to push: "wiki\/software\/prod\.env" is already committed/);
  assert.equal(git(remote, "for-each-ref").out, "", "the secret (and everything else) never reached the remote");
  assert.ok(!verbs(s.calls).includes("push"), "no push was attempted");
  git(vault, "rm", "-q", "--cached", "wiki/software/prod.env");
  git(vault, "commit", "-q", "-m", "remove");
  assert.equal((await runBackup(base(vault, remote))).status, "pushed", "control: once it is out of the tree the backup goes through");
});

test("git hooks in the vault never run (a pre-commit and a pre-push that would stop or spy)", async () => {
  if (process.platform === "win32") return;
  const { vault, remote } = makeBackupVault();
  const marker = path.join(tmp("marker-"), "ran");
  for (const h of ["pre-commit", "commit-msg", "pre-push", "post-commit"]) {
    const f = path.join(vault, ".git", "hooks", h);
    writeFileSync(f, `#!/bin/sh\ntouch ${marker}\nexit 1\n`);
    chmodSync(f, 0o755);
  }
  const r = await runBackup(base(vault, remote));
  assert.equal(r.status, "pushed", r.message);
  assert.ok(!existsSync(marker), "no hook ran");
});

test("a remote that moved on is never forced: the push is refused, the remote's commit survives, and the message says so", async () => {
  const { vault, remote } = makeBackupVault();
  await runBackup(base(vault, remote));
  const other = tmp("backup-other-");
  git(other, "clone", "-q", remote, ".");
  git(other, "config", "user.name", "O"); git(other, "config", "user.email", "o@example.com");
  put(other, "wiki/theirs.md", "THEIRS\n");
  git(other, "add", "-A"); git(other, "commit", "-q", "-m", "theirs"); git(other, "push", "-q", "origin", "HEAD:main");
  const theirs = git(remote, "rev-parse", "main").out.trim();
  put(vault, "wiki/software/a.md", "MINE\n");
  const r = await runBackup(base(vault, remote));
  assert.equal(r.status, "failed");
  assert.match(r.message, /Nothing was forced\. Pull them into the vault folder first\./);
  assert.equal(git(remote, "rev-parse", "main").out.trim(), theirs, "their commit is still the tip");
  assert.equal(r.committed, true, "my commit exists locally");
  assert.equal(r.pushed, false);
});

test("a git that cannot sign in or does not know who you are gives a plain message", async () => {
  const noId = makeBackupVault({ identity: false });
  const isolated = makeGit(noId.vault, { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1", HOME: tmp("nohome-"), USERPROFILE: tmp("nohome-"), EMAIL: "", GIT_AUTHOR_NAME: "", GIT_AUTHOR_EMAIL: "", GIT_COMMITTER_NAME: "", GIT_COMMITTER_EMAIL: "" });
  const r = await runBackup(base(noId.vault, noId.remote, { git: isolated }));
  assert.equal(r.status, "failed");
  assert.match(r.message, /^git does not know who you are\./);
  assert.equal(git(noId.remote, "for-each-ref").out, "");
  const { vault } = makeBackupVault();
  const auth = await runBackup(base(vault, PRIVATE, { allowFileRemote: false, git: async (a) => (a.includes("push") ? { code: 128, stdout: "", stderr: "fatal: could not read Username for 'https://github.com': terminal prompts disabled" } : makeGit(vault)(a)) }));
  assert.equal(auth.status, "failed");
  assert.match(auth.message, /could not sign in to GitHub/);
  assert.equal(auth.committed, true);
});

test("git missing from the PC: a plain message, nothing else", async () => {
  const { vault, remote } = makeBackupVault();
  const r = await runBackup(base(vault, remote, { git: async () => ({ code: null, stdout: "", stderr: "git could not be started" }) }));
  assert.deepEqual([r.status, /not installed/.test(r.message)], ["failed", true]);
});

test("the last result is recorded for the Health strip (not for a dry run), and a damaged record reads as none", () => {
  const logs = tmp("backup-logs-");
  assert.equal(readBackupRecord(logs), null);
  writeBackupRecord(logs, { status: "dry-run", message: "x", files: [], committed: false, pushed: false, skipped: 0 }, NOW);
  assert.equal(readBackupRecord(logs), null, "a dry run is not a backup");
  writeBackupRecord(logs, { status: "pushed", message: "Backed up 2 changed files.", files: [{ change: "added", path: "a" }, { change: "added", path: "b" }], committed: true, pushed: true, skipped: 0 }, NOW);
  assert.deepEqual(readBackupRecord(logs), { at: NOW.toISOString(), status: "pushed", message: "Backed up 2 changed files.", files: 2 });
  writeFileSync(path.join(logs, "backup-status.json"), "{broken");
  assert.equal(readBackupRecord(logs), null);
});

test("offline and credential-free by construction: no network client, no credential file or token handling in backup/", () => {
  const files = readdirSync(here).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "fixture.ts").map((f) => path.join(here, f));
  assert.ok(files.length >= 6, "control: the files were found");
  for (const f of files) {
    const src = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/node:(http|https|net|tls|dns)|\bfetch\(|git-credentials|\.netrc|credential\.helper|GITHUB_TOKEN|ghp_|password\s*[:=]/i.test(src), `${path.basename(f)} has no network client or credential handling`);
    assert.ok(!/shell:\s*true|execSync|spawnSync|execFile/.test(src), `${path.basename(f)} runs git through spawn argv only`);
    if (path.basename(f) !== "git.ts") assert.ok(!/node:child_process/.test(src), `${path.basename(f)} starts no process itself`);
  }
  const gitSrc = readFileSync(path.join(here, "git.ts"), "utf8");
  assert.ok(/shell:\s*false/.test(gitSrc) && /\["ignore", "pipe", "pipe"\]/.test(gitSrc));
});
