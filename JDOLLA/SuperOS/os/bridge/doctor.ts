// PC readiness doctor (Phase 9a prep): `npm run doctor [--json]`.
// Read-only checks with one exception: a probe file in the log folder, deleted at once.
// No network calls (the port check only binds 127.0.0.1 and closes). No shell anywhere: the Claude CLI is
// found by walking PATH and run with an argv. Secrets are never printed: os/.env is checked for existence,
// and only its SUPEROS_PORT and SUPEROS_SCHEDULER lines are read.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { checkRemote, isPublicRepo } from "../backup/remote.ts";
import { detectSandbox } from "./sandbox.ts";

export type Status = "pass" | "warn" | "fail";
export type Check = { id: string; label: string; status: Status; detail: string; fix?: string };

export const MIN_NODE = [22, 18] as const;
const VERSION_TIMEOUT_MS = 5000;

/** Everything the doctor touches, so tests can swap any of it. */
export type DoctorDeps = {
  platform: string;
  env: NodeJS.ProcessEnv;
  nodeVersion: string;
  vault: string;
  osDir: string;
  now: Date;
  exists: (p: string) => boolean;
  isDir: (p: string) => boolean;
  readText: (p: string) => string;
  mtimeMs: (p: string) => number;
  listDir: (p: string) => string[];
  runVersion: (cmd: string, args: string[]) => { ok: true; out: string } | { ok: false; error: string };
  portFree: (port: number) => Promise<boolean>;
  probeWrite: (dir: string) => { ok: true } | { ok: false; error: string };
  claudeBinFromConfig: () => string | undefined;
  brainIndexPath: () => string;
  /** true: the pinned runtime is installed; "outdated": an older one is (it is refused until replaced); false: none. */
  embeddingsRuntime: () => boolean | "outdated";
  sandboxHas: (cmd: string) => boolean;
  /** engine.backup.remote from the config ("" when none); null if the config could not be read. */
  backupRemote: () => string | null;
};

const pathFor = (platform: string) => (platform === "win32" ? path.win32 : path.posix);

export function parseNode(v: string): [number, number] | null {
  const m = /^v?(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * Finds a command on PATH without a shell. On Windows PATH is split on ";" and Windows path rules apply;
 * PATHEXT names are tried when the command has no extension. Returns the first hit.
 */
export function findOnPath(cmd: string, deps: Pick<DoctorDeps, "platform" | "env" | "exists">): string | null {
  const p = pathFor(deps.platform);
  const win = deps.platform === "win32";
  const envPath = deps.env["PATH"] ?? deps.env["Path"] ?? "";
  const exts = win && !p.extname(cmd) ? (deps.env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((e) => e.toLowerCase()) : [""];
  for (const dir of envPath.split(win ? ";" : ":")) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = p.join(dir.replace(/^"|"$/g, ""), cmd + ext);
      if (deps.exists(candidate)) return candidate;
    }
  }
  return null;
}

/** Keeps a version line printable and short; never more than the first line. */
export function cleanVersion(out: string): string {
  return (out.split(/\r?\n/)[0] ?? "").replace(/[^\x20-\x7e]/g, "").trim().slice(0, 80);
}

/** Reads only the SUPEROS_PORT and SUPEROS_SCHEDULER lines of os/.env; every other line is skipped unparsed. */
export function readSafeEnv(text: string): { port?: string; scheduler?: string } {
  const out: { port?: string; scheduler?: string } = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*SUPEROS_(PORT|SCHEDULER)\s*=\s*["']?([A-Za-z0-9]{0,10})["']?\s*$/.exec(line);
    if (m?.[1] === "PORT" && m[2]) out.port = m[2];
    if (m?.[1] === "SCHEDULER" && m[2]) out.scheduler = m[2];
  }
  return out;
}

const pass = (id: string, label: string, detail: string): Check => ({ id, label, status: "pass", detail });
const warn = (id: string, label: string, detail: string, fix: string): Check => ({ id, label, status: "warn", detail, fix });
const fail = (id: string, label: string, detail: string, fix: string): Check => ({ id, label, status: "fail", detail, fix });

export function checkNode(d: DoctorDeps): Check {
  const v = parseNode(d.nodeVersion);
  const ok = v !== null && (v[0] > MIN_NODE[0] || (v[0] === MIN_NODE[0] && v[1] >= MIN_NODE[1]));
  return ok ? pass("node", "Node.js", `${d.nodeVersion} (needs ${MIN_NODE.join(".")} or newer)`)
    : fail("node", "Node.js", `${d.nodeVersion} is older than ${MIN_NODE.join(".")}`, "PC-SETUP §1: install the current LTS from nodejs.org");
}

export function checkClaude(d: DoctorDeps): Check {
  const L = "Claude CLI";
  const configured = d.claudeBinFromConfig();
  let cmd: string;
  let args: string[] = ["--version"];
  if (configured) {
    if (!d.exists(configured) && !findOnPath(configured, d)) return fail("claude", L, `claudeBin is set but not found: ${configured}`, "PC-SETUP §1: fix claudeBin in os/config/os.local.json");
    if (/\.(c|m)?js$/i.test(configured)) { cmd = process.execPath; args = [configured, "--version"]; } else cmd = configured;
  } else {
    const names = d.platform === "win32" ? ["claude.exe", "claude"] : ["claude"];
    let found: string | null = null;
    for (const n of names) { found = findOnPath(n, d); if (found) break; }
    if (!found) return fail("claude", L, `not found on PATH (looked for ${names.join(", ")})`, "PC-SETUP §1: install Claude Code, or set claudeBin in os/config/os.local.json");
    if (d.platform === "win32" && /\.(cmd|bat)$/i.test(found)) {
      return warn("claude", L, `found ${pathFor(d.platform).basename(found)}, which cannot start without a shell`, "PC-SETUP §1: use the native installer, or point claudeBin in os/config/os.local.json at the CLI's cli.js");
    }
    cmd = found;
  }
  const r = d.runVersion(cmd, args);
  if (!r.ok) return fail("claude", L, `found ${cmd} but \`--version\` failed: ${r.error.slice(0, 120)}`, "PC-SETUP §1 and Troubleshooting: run `claude --version` yourself");
  return pass("claude", L, `${cleanVersion(r.out) || "version printed"} (${cmd})`);
}

export function checkEnvFile(d: DoctorDeps): Check {
  const f = pathFor(d.platform).join(d.osDir, ".env");
  return d.exists(f) ? pass("env", "os/.env", "present (values not read)") : warn("env", "os/.env", "missing; the bridge uses defaults", "PC-SETUP §4: copy .env.example .env");
}

export function checkVaultLayout(d: DoctorDeps): Check {
  const p = pathFor(d.platform);
  const missing: string[] = [];
  if (!d.exists(p.join(d.vault, "CLAUDE.md"))) missing.push("CLAUDE.md");
  const depts = p.join(d.vault, "depts");
  if (!d.isDir(depts) || !d.listDir(depts).some((n) => n.endsWith(".md"))) missing.push("depts/*.md");
  if (!d.isDir(p.join(d.vault, "wiki"))) missing.push("wiki/");
  const routines = p.join(d.vault, "routines", "routines.json");
  if (!d.exists(routines)) missing.push("routines/routines.json");
  else { try { JSON.parse(d.readText(routines)); } catch { missing.push("routines/routines.json (not valid JSON)"); } }
  return missing.length ? fail("vault", "Vault layout", `missing: ${missing.join(", ")}`, "PC-SETUP §2: copy the whole JDOLLA vault, not just os/")
    : pass("vault", "Vault layout", "CLAUDE.md, depts/, wiki/, routines/routines.json");
}

export function logDirFor(d: Pick<DoctorDeps, "platform" | "env" | "vault">): string {
  const p = pathFor(d.platform);
  if (d.platform === "win32" && d.env["LOCALAPPDATA"]) return p.join(d.env["LOCALAPPDATA"], "JDOLLA", "logs");
  return p.join(d.vault, "logs");
}

export function checkLogDir(d: DoctorDeps): Check {
  const dir = logDirFor(d);
  if (!d.isDir(dir)) return warn("logs", "Log folder", `${dir} does not exist yet; the bridge creates it on first start`, "PC-SETUP §6: start the bridge once, then run the doctor again");
  const r = d.probeWrite(dir);
  return r.ok ? pass("logs", "Log folder", `${dir} is writable`) : fail("logs", "Log folder", `${dir} is not writable: ${r.error.slice(0, 100)}`, "PC-SETUP §14 (step 3): check the folder's permissions");
}

export function bridgePort(d: DoctorDeps): number {
  const raw = d.env["SUPEROS_PORT"] ?? (() => {
    const f = pathFor(d.platform).join(d.osDir, ".env");
    try { return d.exists(f) ? readSafeEnv(d.readText(f)).port : undefined; } catch { return undefined; }
  })();
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : 4317;
}

export async function checkPort(d: DoctorDeps): Promise<Check> {
  const port = bridgePort(d);
  return (await d.portFree(port)) ? pass("port", "Bridge port", `127.0.0.1:${port} is free`)
    : warn("port", "Bridge port", `127.0.0.1:${port} is in use (is the bridge already running?)`, "PC-SETUP Troubleshooting: stop the other program or change SUPEROS_PORT in os/.env (§4)");
}

export function checkBrainIndex(d: DoctorDeps): Check {
  const f = d.brainIndexPath();
  if (!d.exists(f)) return warn("brain", "Brain index", `not built yet (${f})`, "PC-SETUP §5.1: npm run brain -- index (runs also build it first)");
  const hours = Math.max(0, (d.now.getTime() - d.mtimeMs(f)) / 3_600_000);
  const age = hours < 1 ? `${Math.round(hours * 60)} min` : hours < 48 ? `${Math.round(hours)} h` : `${Math.round(hours / 24)} days`;
  return pass("brain", "Brain index", `built ${age} ago (rebuilt before a run when over 5 minutes old)`);
}

export function checkEmbeddings(d: DoctorDeps): Check {
  const r = d.embeddingsRuntime();
  if (r === "outdated") return warn("embeddings", "Meaning search", "runtime out of date: search uses keywords only until it is replaced", "PC-SETUP §5.2: npm run brain -- index --embeddings (replaces the runtime and re-embeds; the model is kept)");
  return r ? pass("embeddings", "Meaning search", "local embeddings runtime installed")
    : warn("embeddings", "Meaning search", "not set up (optional; search uses keywords only)", "PC-SETUP §5.2: npm run brain -- index --embeddings, only if you want it");
}

export function checkSandbox(d: DoctorDeps): Check {
  const s = detectSandbox(d.platform, d.sandboxHas);
  if (s.available) return pass("sandbox", "Bash sandbox", s.reason);
  const why = d.platform === "win32" ? "Runs that need Bash are refused on native Windows; everything else works. Bash only works if Claude Code runs inside WSL2." : `${s.reason} Runs that need Bash are refused.`;
  return warn("sandbox", "Bash sandbox", why, "PC-SETUP §14 (step 4)");
}

export function checkScheduler(d: DoctorDeps): Check {
  let v = d.env["SUPEROS_SCHEDULER"];
  if (v === undefined) {
    const f = pathFor(d.platform).join(d.osDir, ".env");
    try { if (d.exists(f)) v = readSafeEnv(d.readText(f)).scheduler; } catch { /* treat as default */ }
  }
  const on = (v ?? "on") === "on";
  if (v !== undefined && v !== "on" && v !== "off") return warn("scheduler", "Scheduler", `SUPEROS_SCHEDULER has an unknown value; the bridge will not start`, "PC-SETUP §4: set it to on or off");
  return on ? pass("scheduler", "Scheduler", `on${v === undefined ? " (default)" : ""}: routines you switch on run at their times`)
    : warn("scheduler", "Scheduler", "off: no routine runs on its own (Run now still works)", "PC-SETUP §4 and §10: set SUPEROS_SCHEDULER=on when you want routines");
}

/**
 * The vault backup row (Phase 9c). Looks only at files: is the vault folder its own git repo (a .git entry in it), is a
 * remote named in the config, does that remote pass the same check the backup uses, and does the vault's own git config
 * point at the public repo. It starts no process and makes no network call, and never prints a URL.
 */
export function checkBackup(d: DoctorDeps): Check {
  const p = pathFor(d.platform);
  const label = "Vault backup";
  const dotGit = p.join(d.vault, ".git");
  const ownRepo = d.exists(dotGit);
  const remote = d.backupRemote();
  if (ownRepo && d.isDir(dotGit)) {
    let cfg = "";
    try { cfg = d.readText(p.join(dotGit, "config")); } catch { /* unreadable: skip this part */ }
    for (const line of cfg.split(/\r?\n/)) {
      const m = /^\s*(?:url|pushurl)\s*=\s*(.+?)\s*$/i.exec(line);
      if (m?.[1] && isPublicRepo(m[1])) return fail("backup", label, "this vault's git repo points at the public code repo", "PC-SETUP §10.1: the vault needs its own private repo; a vault note must never go to the public one");
    }
  }
  const facts = (remoteNote: string) => `own git repo: ${ownRepo ? "yes" : "no"}; remote: ${remoteNote}`;
  if (remote === null) return warn("backup", label, "the config could not be read, so the backup remote is unknown", "PC-SETUP §4: check os/config/os.config.json");
  if (!remote.trim()) return warn("backup", label, `not set up (optional); ${facts("not set")}`, "PC-SETUP §10.1: name a private repo in engine.backup.remote when you want nightly backups");
  const bad = checkRemote(remote);
  if (bad) return warn("backup", label, `${facts("set")}; the remote is not usable: ${bad.replace(/ Nothing was pushed\.$/, "")}`, "PC-SETUP §10.1 (step 4): fix engine.backup.remote");
  if (!ownRepo) return warn("backup", label, facts("set, passes the check"), "PC-SETUP §10.1 (step 2): run git init -b main in the vault folder");
  return pass("backup", label, `${facts("set, passes the check")}; run: npm run backup -- --dry-run`);
}

export const BLENDER_FRESH_DAYS = 30;

/**
 * Blender (optional): reads the last `npm run blender:check` report and never starts Blender. PASS when it passed within
 * BLENDER_FRESH_DAYS, WARN when there is none or it is older, FAIL when the last check failed.
 */
export function checkBlender(d: DoctorDeps): Check {
  const L = "Blender (optional)";
  const run = "PC-SETUP §3.4: npm run blender:check";
  const file = pathFor(d.platform).join(logDirFor(d), "blender-check.json");
  if (!d.exists(file)) return warn("blender", L, "not checked yet (only the Blender skills need it)", run);
  let r: { ok?: unknown; at?: unknown; version?: unknown; checks?: unknown };
  try { r = JSON.parse(d.readText(file)) as typeof r; } catch { return warn("blender", L, "the last report could not be read", run); }
  const at = typeof r.at === "string" ? Date.parse(r.at) : NaN;
  if (typeof r.ok !== "boolean" || Number.isNaN(at) || !Array.isArray(r.checks)) return warn("blender", L, "the last report is not one this version understands", run);
  const version = typeof r.version === "string" && /^[\d.]{1,20}$/.test(r.version) ? r.version : "?";
  const days = Math.max(0, Math.floor((d.now.getTime() - at) / 86_400_000));
  const ago = days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`;
  if (!r.ok) {
    const failed = (r.checks as Array<{ id?: unknown; status?: unknown }>).filter((c) => c.status === "fail").map((c) => String(c.id).replace(/[^a-z-]/g, "").slice(0, 20));
    return fail("blender", L, `Blender ${version}: the last check failed (${failed.join(", ") || "see the report"}), ${ago}`, "PC-SETUP §3.4: run npm run blender:check and fix each FAIL row before using the Blender skills");
  }
  if (days > BLENDER_FRESH_DAYS) return warn("blender", L, `Blender ${version} last passed ${ago} (older than ${BLENDER_FRESH_DAYS} days)`, run);
  return pass("blender", L, `Blender ${version} passed ${ago}`);
}

export async function runDoctor(d: DoctorDeps): Promise<Check[]> {
  const safe = (id: string, label: string, f: () => Check): Check => {
    try { return f(); } catch (e) { return fail(id, label, `check crashed: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`, "PC-SETUP Troubleshooting: send Claude this line"); }
  };
  return [
    safe("node", "Node.js", () => checkNode(d)),
    safe("claude", "Claude CLI", () => checkClaude(d)),
    safe("env", "os/.env", () => checkEnvFile(d)),
    safe("vault", "Vault layout", () => checkVaultLayout(d)),
    safe("logs", "Log folder", () => checkLogDir(d)),
    await checkPort(d).catch((e: unknown) => fail("port", "Bridge port", `check crashed: ${String(e).slice(0, 100)}`, "PC-SETUP Troubleshooting")),
    safe("brain", "Brain index", () => checkBrainIndex(d)),
    safe("embeddings", "Meaning search", () => checkEmbeddings(d)),
    safe("sandbox", "Bash sandbox", () => checkSandbox(d)),
    safe("scheduler", "Scheduler", () => checkScheduler(d)),
    safe("backup", "Vault backup", () => checkBackup(d)),
    safe("blender", "Blender (optional)", () => checkBlender(d)),
  ];
}

export function formatDoctor(checks: readonly Check[]): string {
  const mark: Record<Status, string> = { pass: "PASS", warn: "WARN", fail: "FAIL" };
  const w = Math.max(...checks.map((c) => c.label.length));
  const lines = ["JDOLLA$ doctor: is this PC ready?", ""];
  for (const c of checks) {
    lines.push(`  ${mark[c.status]}  ${c.label.padEnd(w)}  ${c.detail}`);
    if (c.status !== "pass" && c.fix) lines.push(`        ${" ".repeat(w)}  → ${c.fix}`);
  }
  const n = (s: Status) => checks.filter((c) => c.status === s).length;
  lines.push("", `${n("pass")} pass, ${n("warn")} warn, ${n("fail")} fail. ${n("fail") ? "Fix the FAIL rows first." : "Nothing blocks the bridge."}`);
  return lines.join("\n");
}

// ---------- the real machine ----------

export function realDeps(vault: string, osDir: string, extra: Pick<DoctorDeps, "claudeBinFromConfig" | "brainIndexPath" | "embeddingsRuntime"> & Partial<Pick<DoctorDeps, "backupRemote">>): DoctorDeps {
  return {
    platform: process.platform, env: process.env, nodeVersion: process.version, vault, osDir, now: new Date(),
    exists: (p) => existsSync(p),
    isDir: (p) => { try { return statSync(p).isDirectory(); } catch { return false; } },
    readText: (p) => { if (statSync(p).size > 256 * 1024) throw new Error("too large"); return readFileSync(p, "utf8"); },
    mtimeMs: (p) => statSync(p).mtimeMs,
    listDir: (p) => { try { return readdirSync(p); } catch { return []; } },
    runVersion: (cmd, args) => {
      try {
        const out = execFileSync(cmd, args, { shell: false, timeout: VERSION_TIMEOUT_MS, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, maxBuffer: 64 * 1024 });
        return { ok: true, out };
      } catch (e) {
        const err = e as NodeJS.ErrnoException & { signal?: string };
        return { ok: false, error: err.signal === "SIGTERM" ? `timed out after ${VERSION_TIMEOUT_MS / 1000} s` : err.code ?? "exited with an error" };
      }
    },
    portFree: (port) => new Promise((resolve) => {
      const s = createServer();
      s.once("error", () => resolve(false));
      s.listen({ port, host: "127.0.0.1", exclusive: true }, () => s.close(() => resolve(true)));
    }),
    probeWrite: (dir) => {
      const f = path.join(dir, `.doctor-probe-${process.pid}-${Date.now()}`);
      try { writeFileSync(f, "probe", { flag: "wx" }); return { ok: true }; } catch (e) { return { ok: false, error: (e as NodeJS.ErrnoException).code ?? "write failed" }; }
      finally { try { rmSync(f, { force: true }); } catch { /* nothing to clean */ } }
    },
    sandboxHas: (cmd) => findOnPath(cmd, { platform: process.platform, env: process.env, exists: existsSync }) !== null,
    backupRemote: () => null,
    ...extra,
  };
}
