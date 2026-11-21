// The bridge: a small local server between the dashboard and the vault.
// Listens on 127.0.0.1 only. Every /api route needs a signed session.
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { route } from "../shared/router.ts";
import { COOKIE, SESSION_MS, loadOrCreateSecret, mintToken, verifyToken } from "./auth.ts";
import { LayoutSchema, loadConfig, loadEnv, logDir, pathsFor, saveConfig } from "./config.ts";
import type { Paths } from "./config.ts";
import { GuardError, MAX_READ, OPEN_EXT, READ_EXT, resolveVaultFile } from "./guards.ts";
import { DIRECTIVE_LINE, buildState, directiveId } from "./indexer.ts";
import { makeRunLog } from "./run-log.ts";
import { RoutineRunner } from "./routine-runner.ts";
import { LearningLoop } from "./learning.ts";
import { BrainLink } from "./brain-link.ts";
import { defaultIndexPath } from "../brain/indexer.ts";
import { RunError, RunManager, defaultClaudeBin } from "./runs.ts";
import type { ClaudeBin, RunEvent } from "./runs.ts";
import type { SandboxStatus } from "./sandbox.ts";
import { buildAll } from "../vault/generate.ts";
import { SKILL_SLUG, findSkill } from "./skills.ts";
import { InboxTriage } from "./inbox.ts";
import type { BuildResult } from "../vault/generate.ts";

const MAX_BODY = 64 * 1024;
const STATIC_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".ts": "text/javascript; charset=utf-8", ".svg": "image/svg+xml",
};
const CSP = "default-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export type Opener = (absolutePath: string) => void;

/** Opens a file with the system's default app. No shell is involved, so the path is never parsed as a command. */
export const systemOpener: Opener = (abs) => {
  const [cmd, args] = process.platform === "win32" ? ["explorer.exe", [abs]] : process.platform === "darwin" ? ["open", [abs]] : ["xdg-open", [abs]];
  spawn(cmd as string, args as string[], { detached: true, stdio: "ignore", shell: false }).on("error", () => undefined).unref();
};

export type Bridge = { server: http.Server; secret: string; paths: Paths; mint: () => string; runs: RunManager; routines: RoutineRunner; learning: LearningLoop; inbox: InboxTriage; vault: { rebuild: (trigger: string) => BuildResult | null; startClock: () => void } };

const VAULT_EVERY_MS = 30 * 60_000;

export function createBridge(osDir: string, opts: { opener?: Opener; log?: (line: string) => void; claudeBin?: ClaudeBin; logDir?: string; sandbox?: () => SandboxStatus; schedulerOn?: boolean; brainDbPath?: string; now?: () => Date } = {}): Bridge {
  const paths = pathsFor(osDir);
  const secret = loadOrCreateSecret(paths);
  const opener = opts.opener ?? systemOpener;
  const log = opts.log ?? (() => undefined);
  const appRoot = realpathSync(paths.os);
  const directivesFile = path.join(paths.vault, "wiki", "directives.md");
  const runLog = makeRunLog(opts.logDir ?? logDir(paths));
  // The brain index lives with the CLI's default (~/.superos/brain) unless a log folder or path is given (tests).
  const brain = new BrainLink({ paths, dbPath: opts.brainDbPath ?? (opts.logDir ? path.join(opts.logDir, "brain-index.sqlite") : defaultIndexPath()), log: runLog });
  const runs = new RunManager({
    brain,
    paths,
    config: () => loadConfig(paths),
    bin: () => opts.claudeBin ?? defaultClaudeBin(loadConfig(paths)),
    log: runLog,
    ...(opts.sandbox ? { sandbox: opts.sandbox } : {}),
  });
  const routines = new RoutineRunner({ paths, config: () => loadConfig(paths), runs, logDir: opts.logDir ?? logDir(paths), log: runLog, schedulerOn: opts.schedulerOn ?? false });
  // Learning loop: every run that ends is checked; failures, blocks and cap hits become proposals.
  // After Jay approves an inbox move: refresh the generated indexes and make the next run rebuild the brain index.
  const learning = new LearningLoop({ paths, config: () => loadConfig(paths), runs, logDir: opts.logDir ?? logDir(paths), log: runLog, ...(opts.now ? { now: opts.now } : {}), afterMove: () => { rebuildVault("inbox"); brain.markStale(); } });
  const inbox = new InboxTriage({ paths, config: () => loadConfig(paths), runs, log: runLog, propose: (moves, run) => learning.proposeMoves(moves, run) });
  runs.addEndListener((info) => { learning.onRunEnd(info); });

  // Vault generators (indexes, project hubs, the daily note). A failure is logged and never stops the bridge.
  let vaultTimer: NodeJS.Timeout | undefined;
  function rebuildVault(trigger: string): BuildResult | null {
    try {
      const r = buildAll(paths, (opts.now ?? (() => new Date()))());
      const problems = r.files.filter((f) => f.action === "skipped" && f.reason && !f.reason.startsWith("not generated")).map((f) => `${f.path}: ${f.reason}`).join("; ").slice(0, 500);
      runLog({ kind: "vault-build", trigger, created: r.counts.create, updated: r.counts.update, unchanged: r.counts.unchanged, skipped: r.counts.skipped, problems });
      return r;
    } catch (e) {
      runLog({ kind: "vault-build-failed", trigger, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
      return null;
    }
  }

  function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    const json = typeof body === "string" ? body : JSON.stringify(body);
    res.writeHead(status, {
      "content-type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
      "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers,
    });
    res.end(json);
  }

  function ownOrigins(): string[] {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    return [`127.0.0.1:${port}`, `localhost:${port}`];
  }

  function sessionOk(req: IncomingMessage): boolean {
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ") && verifyToken(secret, auth.slice(7))) return true;
    for (const part of (req.headers.cookie ?? "").split(";")) {
      const [k, v] = part.trim().split("=", 2);
      if (k === COOKIE && verifyToken(secret, v)) return true;
    }
    return false;
  }

  async function readJson(req: IncomingMessage): Promise<unknown> {
    if (!(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(415, "Send JSON.");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY) throw new HttpError(413, "Request too large.");
      chunks.push(chunk as Buffer);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpError(400, "Body is not valid JSON."); }
  }

  function serveStatic(res: ServerResponse, urlPath: string): void {
    const rel = urlPath === "/" ? "app/index.html" : urlPath.slice(1);
    // Only the dashboard code and the shared contract are served. Never bridge/, config/, .env or .cache.
    if (!/^(?:app|shared)\/[A-Za-z0-9_\-/.]{1,200}$/.test(rel) || rel.includes("..") || rel.includes("/.") || rel.endsWith(".test.ts")) throw new HttpError(404, "Not found.");
    const ext = path.extname(rel);
    const type = STATIC_TYPES[ext];
    if (!type) throw new HttpError(404, "Not found.");
    let real: string;
    try { real = realpathSync(path.join(appRoot, rel)); } catch { throw new HttpError(404, "Not found."); }
    const inside = path.relative(appRoot, real);
    if (inside.startsWith("..") || path.isAbsolute(inside) || !/^(?:app|shared)[\\/]/.test(inside) || !statSync(real).isFile()) throw new HttpError(404, "Not found.");
    let text = readFileSync(real, "utf8");
    if (ext === ".ts") text = stripTypeScriptTypes(text, { mode: "strip" });
    res.writeHead(200, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": CSP, "referrer-policy": "no-referrer" });
    res.end(text);
  }

  function writeDirectives(text: string): void {
    const tmp = directivesFile + ".tmp";
    writeFileSync(tmp, text);
    renameSync(tmp, directivesFile);
  }

  async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (!sessionOk(req)) throw new HttpError(401, "No valid session. Run: npm run open");
    const key = `${req.method} ${url.pathname}`;
    if (req.method === "POST") {
      // Cookie-authenticated writes must come from our own page: custom header + matching Origin.
      const origin = req.headers.origin;
      if (origin && !ownOrigins().some((o) => origin === `http://${o}`)) throw new HttpError(403, "Wrong origin.");
      if (req.headers["x-superos"] !== "1") throw new HttpError(403, "Missing x-superos header.");
    }
    const config = loadConfig(paths);
    const routineMatch = /^\/api\/routines\/([a-z0-9][a-z0-9-]{0,39})\/(toggle|run)$/.exec(url.pathname);
    if (routineMatch?.[1] && routineMatch[2] && req.method === "POST") {
      const id = routineMatch[1];
      try {
        if (routineMatch[2] === "toggle") {
          const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(await readJson(req));
          routines.setEnabled(id, enabled);
          return send(res, 200, routines.status());
        }
        return send(res, 202, { run: routines.runNow(id) });
      } catch (e) {
        if (e instanceof RunError) throw new HttpError(e.status, e.message);
        throw e;
      }
    }
    if (url.pathname === "/api/routines" && req.method === "GET") return send(res, 200, routines.status());
    if (url.pathname === "/api/inbox" && req.method === "GET") return send(res, 200, inbox.status());
    if (url.pathname === "/api/inbox/sort" && req.method === "POST") {
      try { return send(res, 202, { run: inbox.start() }); } catch (e) {
        if (e instanceof RunError) throw new HttpError(e.status, e.message);
        throw e;
      }
    }
    if (url.pathname === "/api/skills" && req.method === "GET") return send(res, 200, routines.skillsView());
    // Run a skill: the same path, caps and containment as a routine's Run now. A T3 skill asks for confirmation first.
    const skillMatch = /^\/api\/skills\/([^/]{1,100})\/run$/.exec(url.pathname);
    if (skillMatch?.[1] && req.method === "POST") {
      const name = skillMatch[1];
      if (!SKILL_SLUG.test(name)) throw new HttpError(400, "Bad skill name.");
      const body = z.object({ input: z.string().max(500).optional(), confirm: z.boolean().optional() }).strict().parse(await readJson(req));
      const skill = findSkill(paths, name);
      if (!skill) throw new HttpError(404, "No skill with that name.");
      if (!skill.runnable) throw new HttpError(400, skill.problem ?? "That skill cannot run.");
      const limit = config.engine.routines.maxBudgetUsd;
      if (skill.budgetUsd > limit) throw new HttpError(400, `Its budget of $${skill.budgetUsd} is above the limit of $${limit} for one run.`);
      const capNote = routines.dailyCapProblem(skill.budgetUsd); // say so before asking Jay to confirm, not after
      if (capNote) throw new HttpError(429, capNote);
      if (skill.tier === "T3" && body.confirm !== true) {
        return send(res, 409, { error: `Run this? ${name} is real work (T3) and can cost up to $${skill.budgetUsd}. Confirm to run it.`, needsConfirm: true, capUsd: skill.budgetUsd });
      }
      try {
        return send(res, 202, { run: routines.runSkill(name, body.input !== undefined ? { input: body.input } : {}) });
      } catch (e) {
        if (e instanceof RunError) throw new HttpError(e.status, e.message);
        throw e;
      }
    }
    if (url.pathname === "/api/proposals" && req.method === "GET") {
      return send(res, 200, { proposals: learning.list(), spentTodayUsd: learning.spentToday(), dailyCapUsd: config.engine.learning.dailyCapUsd, enabled: config.engine.learning.enabled });
    }
    const proposalMatch = /^\/api\/proposals\/(\d{4}-\d{2}-\d{2}_[a-z0-9-]{1,60})\/(approve|reject)$/.exec(url.pathname);
    if (proposalMatch?.[1] && proposalMatch[2] && req.method === "POST") {
      try {
        const p = proposalMatch[2] === "approve" ? learning.approve(proposalMatch[1]) : learning.reject(proposalMatch[1]);
        return send(res, 200, { proposal: p });
      } catch (e) {
        if (e instanceof RunError) throw new HttpError(e.status, e.message);
        throw e;
      }
    }
    const runMatch = /^\/api\/runs\/([a-z0-9]{6,14}-[0-9a-f]{8})\/(stop|events)$/.exec(url.pathname);
    if (runMatch?.[1] && runMatch[2]) {
      const id = runMatch[1];
      if (runMatch[2] === "stop" && req.method === "POST") {
        if (!runs.get(id)) throw new HttpError(404, "No run with that id.");
        return send(res, 200, { stopped: runs.stop(id), run: runs.get(id) });
      }
      if (runMatch[2] === "events" && req.method === "GET") {
        if (!runs.get(id)) throw new HttpError(404, "No run with that id.");
        // Server-sent events: replay what happened so far, then stream until the run ends.
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", connection: "keep-alive" });
        res.write(": connected\n\n");
        let unsubscribe: (() => void) | null = null;
        const onEvent = (e: RunEvent) => {
          res.write(`data: ${JSON.stringify(e)}\n\n`);
          if (e.type === "status") { unsubscribe?.(); res.end(); }
        };
        unsubscribe = runs.subscribe(id, onEvent);
        if (res.writableEnded) unsubscribe?.();
        req.on("close", () => unsubscribe?.());
        return;
      }
      throw new HttpError(405, "Method not allowed.");
    }
    switch (key) {
      case "GET /api/state":
        return send(res, 200, buildState(paths, config));
      case "POST /api/route": {
        const { text } = z.object({ text: z.string().max(4000) }).parse(await readJson(req));
        const depts = buildState(paths, config).departments.map((d) => ({ slug: d.slug, name: d.name }));
        return send(res, 200, route(text, { depts }));
      }
      case "POST /api/layout": {
        const { layout } = z.object({ layout: LayoutSchema }).parse(await readJson(req));
        saveConfig(paths, { ...config, layout });
        return send(res, 200, { layout });
      }
      case "POST /api/directives/toggle": {
        const { id } = z.object({ id: z.string().regex(/^\d{1,4}-[0-9a-f]{8}$/) }).parse(await readJson(req));
        const lines = readFileSync(directivesFile, "utf8").split(/\r?\n/);
        let n = 0, hit = false;
        for (let i = 0; i < lines.length; i++) {
          const m = DIRECTIVE_LINE.exec(lines[i] ?? "");
          if (m?.[2] === undefined) continue;
          if (directiveId(n, m[2].trim()) === id) { lines[i] = `- [${m[1] === " " ? "x" : " "}] ${m[2]}`; hit = true; break; }
          n++;
        }
        // The id includes a hash of the text, so a stale page cannot tick the wrong line.
        if (!hit) throw new HttpError(409, "That directive changed. Reload and try again.");
        writeDirectives(lines.join("\n"));
        return send(res, 200, { directives: buildState(paths, config).directives });
      }
      case "POST /api/directives/add": {
        const body = z.object({ text: z.string().max(1000) }).parse(await readJson(req));
        // One plain line: no control characters or newlines, so typed text cannot add headings or other entries.
        const text = body.text.replace(/[\x00-\x1f\x7f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
        if (!text) throw new HttpError(400, "Directive text is empty.");
        const current = readFileSync(directivesFile, "utf8");
        writeDirectives(current.replace(/\n*$/, "\n") + `- [ ] ${text}\n`);
        return send(res, 200, { directives: buildState(paths, config).directives });
      }
      case "GET /api/file": {
        const file = resolveVaultFile(paths.vault, url.searchParams.get("path"), READ_EXT);
        if (statSync(file).size > MAX_READ) throw new HttpError(413, "File too large to show.");
        return send(res, 200, { path: path.relative(realpathSync(paths.vault), file).split(path.sep).join("/"), content: readFileSync(file, "utf8") });
      }
      case "POST /api/vault/rebuild": {
        const r = rebuildVault("api");
        if (!r) throw new HttpError(500, "The vault rebuild failed. See router.jsonl.");
        return send(res, 200, { date: r.date, counts: r.counts, files: r.files });
      }
      case "POST /api/open": {
        const body = z.object({ path: z.string().max(400) }).parse(await readJson(req));
        const file = resolveVaultFile(paths.vault, body.path, OPEN_EXT);
        opener(file);
        return send(res, 200, { opened: true });
      }
      case "POST /api/run": {
        const body = z.object({ text: z.string().max(4000), confirm: z.boolean().optional(), budgetUsd: z.number().optional(), skill: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/).optional() }).strict().parse(await readJson(req));
        if (!body.text.trim()) throw new HttpError(400, "Type a request first.");
        // The bridge decides the tier itself; the page's bars are only a preview.
        const depts = buildState(paths, config).departments.map((d) => ({ slug: d.slug, name: d.name }));
        const routed = route(body.text, { depts });
        runLog({ kind: "route", tier: routed.tier, probs: routed.probs, chars: body.text.length });
        if (routed.tier === "T1") throw new HttpError(400, "That is an instant (T1) request. Nothing to run, and nothing is charged.");
        if (routed.tier === "T3" && body.confirm !== true) {
          return send(res, 409, { error: `This is real work (T3) and can cost up to $${config.engine.t3.maxBudgetUsd}. Confirm to run it.`, needsConfirm: true, capUsd: config.engine.t3.maxBudgetUsd });
        }
        try {
          const run = runs.start({ text: body.text, tier: routed.tier, ...(body.budgetUsd !== undefined ? { budgetUsd: body.budgetUsd } : {}), ...(body.skill ? { skill: body.skill } : {}) });
          return send(res, 202, { run });
        } catch (e) {
          if (e instanceof RunError) throw new HttpError(e.status, e.message);
          throw e;
        }
      }
      case "GET /api/runs":
        return send(res, 200, { runs: runs.list() });
      default:
        throw new HttpError(404, "Unknown API route.");
    }
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        // Reject requests aimed at any other host name (blocks DNS-rebinding from web pages).
        if (!ownOrigins().includes(req.headers.host ?? "")) throw new HttpError(403, "Wrong host.");
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname.startsWith("/api/")) return await api(req, res, url);
        if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
        if (url.pathname === "/healthz") return send(res, 200, { ok: true });
        const t = url.searchParams.get("t");
        if (url.pathname === "/" && t !== null) {
          if (!verifyToken(secret, t)) throw new HttpError(401, "That sign-in link is invalid or expired. Run: npm run open");
          res.writeHead(302, { location: "/", "set-cookie": `${COOKIE}=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`, "cache-control": "no-store", "referrer-policy": "no-referrer" });
          return void res.end();
        }
        return serveStatic(res, url.pathname);
      } catch (err) {
        if (res.headersSent) return void res.end();
        if (err instanceof HttpError) return send(res, err.status, { error: err.message });
        if (err instanceof GuardError) return send(res, 403, { error: err.message });
        if (err instanceof z.ZodError) return send(res, 400, { error: "Bad request: " + err.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ").slice(0, 300) });
        log(`error ${req.method} ${String(req.url).slice(0, 120)} ${err instanceof Error ? err.message : "unknown"}`);
        return send(res, 500, { error: "Something went wrong in the bridge. See the server log." });
      }
    })();
  });
  server.requestTimeout = 15_000;

  server.on("close", () => { routines.stopClock(); if (vaultTimer) clearInterval(vaultTimer); runs.stopAll(); });

  const vault = {
    rebuild: rebuildVault,
    /** Once now, then every 30 minutes. Not started by createBridge, so tests do not write into fixture vaults. */
    startClock: () => { rebuildVault("start"); vaultTimer = setInterval(() => rebuildVault("interval"), VAULT_EVERY_MS); vaultTimer.unref(); },
  };

  return { server, secret, paths, learning, inbox, mint: () => mintToken(secret), runs, routines, vault };
}

// Run directly: `npm start`.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const osDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const paths = pathsFor(osDir);
  const env = loadEnv(paths);
  const dir = logDir(paths);
  const log = (line: string) => {
    try { mkdirSync(dir, { recursive: true }); appendFileSync(path.join(dir, "server.log"), `${new Date().toISOString()} ${line}\n`); } catch { /* logging must never stop the server */ }
  };
  const bridge = createBridge(osDir, { log, schedulerOn: env.SUPEROS_SCHEDULER === "on" });
  // Stop any running Claude runs when the bridge is closed with Ctrl+C.
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { bridge.runs.stopAll(); setTimeout(() => process.exit(0), 500).unref(); });
  bridge.server.on("error", (err: NodeJS.ErrnoException) => {
    console.error(err.code === "EADDRINUSE" ? `Port ${env.SUPEROS_PORT} is already in use. Is the bridge already running? Change SUPEROS_PORT in os/.env if not.` : `Bridge failed to start: ${err.message}`);
    process.exit(1);
  });
  // 127.0.0.1 only: never 0.0.0.0, so nothing else on the network can reach it.
  bridge.server.listen(env.SUPEROS_PORT, "127.0.0.1", () => {
    log(`started on 127.0.0.1:${env.SUPEROS_PORT} pid ${process.pid}`);
    console.log(`JDOLLA$ bridge running on http://127.0.0.1:${env.SUPEROS_PORT} (pid ${process.pid})`);
    console.log("Open the dashboard with: npm run open");
    bridge.routines.startClock();
    bridge.vault.startClock();
    console.log(env.SUPEROS_SCHEDULER === "on" ? "Scheduler on: switched-on routines run at their times." : "Scheduler off (SUPEROS_SCHEDULER=off): no routine runs on its own.");
  });
}
