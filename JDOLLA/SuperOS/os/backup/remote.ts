// Which remotes a backup may push to. Only GitHub over https or ssh, in exactly two spellings, and never the public repo.
export const HTTPS_URL = /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\.git$/;
export const SSH_URL = /^git@github\.com:([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\.git$/;
/** The public repo that holds this code. A vault note must never be pushed to it. */
export const PUBLIC_REPOS: readonly string[] = ["jamieturner2026/claude-ai-skills"];

export const MSG_NO_REMOTE = "Name the private Brain repo first: set engine.backup.remote in os/config/os.config.json (for example https://github.com/<you>/<repo>.git).";
export const MSG_BAD_URL = "The backup remote must look like https://github.com/<owner>/<repo>.git or git@github.com:<owner>/<repo>.git. Nothing was pushed.";
export const MSG_PUBLIC_REMOTE = "That remote is the public code repo. A vault note must never go there. Name your private Brain repo instead. Nothing was pushed.";
export const MSG_PUBLIC_VAULT = "This vault folder belongs to a git repo whose remote is the public code repo. A vault note must never go to the public repo, so nothing was committed or pushed. Give the vault its own private git repo (git init in the vault folder) and set engine.backup.remote to that private repo.";
export const MSG_NOT_A_REPO = "The vault is not a git repo yet. In the vault folder run: git init -b main (then try again). Nothing was committed or pushed.";
export const MSG_NESTED = "The vault folder sits inside another git repo. A backup needs the vault to be its own git repo: run git init -b main in the vault folder. Nothing was committed or pushed.";

/** "owner/repo" (lower case) from any git URL spelling, or null. Tolerant on purpose: used to recognise the public repo. */
export function repoId(url: string): string | null {
  const u = url.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  const m = /(?:^|[/:])([^/:@\s]+)\/([^/:@\s]+)$/.exec(u);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

export function isPublicRepo(url: string, publicRepos: readonly string[] = PUBLIC_REPOS): boolean {
  const id = repoId(url);
  return id !== null && publicRepos.includes(id);
}

/** A plain refusal message, or null when the remote is acceptable. `allowFile` exists for tests only; config can never set it. */
export function checkRemote(remote: string, opts: { allowFile?: boolean; publicRepos?: readonly string[] } = {}): string | null {
  const r = remote.trim();
  if (!r) return MSG_NO_REMOTE;
  const local = opts.allowFile === true && /^(file:\/\/)?(\/|[A-Za-z]:[\\/])/.test(r); // a bare repo on disk: tests only
  if (!local && !HTTPS_URL.test(r) && !SSH_URL.test(r)) return MSG_BAD_URL;
  if (isPublicRepo(r, opts.publicRepos ?? PUBLIC_REPOS)) return MSG_PUBLIC_REMOTE;
  return null;
}

const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$/;
/** A strict git branch name: no leading dash, no "..", no "//", not ending in "/", "." or ".lock", no component starting with "." or ending in ".lock". Nothing that could be an option, a refspec ("a:b") or a path trick. */
export function isValidBranch(b: string): boolean {
  if (!BRANCH.test(b) || b.includes("..") || b.includes("//") || b.endsWith("/") || b.endsWith(".")) return false;
  return b.split("/").every((c) => c !== "" && !c.startsWith(".") && !c.endsWith(".lock"));
}
export const MSG_BAD_BRANCH = "engine.backup.branch must be a plain branch name such as main (letters, digits, . _ - and / only). Nothing was pushed.";
