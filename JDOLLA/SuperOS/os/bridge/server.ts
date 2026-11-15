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

const MAX_BODY = 64 * 1024;
const STATIC_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".ts": "text/javascript; charset=utf-8", ".svg": "image/svg+xml",
};
const CSP = "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

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

export type Bridge = { server: http.Server; secret: string; paths: Paths; mint: () => string };

export function createBridge(osDir: string, opts: { opener?: Opener; log?: (line: string) => void } = {}): Bridge {
  const paths = pathsFor(osDir);
  const secret = loadOrCreateSecret(paths);
  const opener = opts.opener ?? systemOpener;
  const log = opts.log ?? (() => undefined);
  const appRoot = realpathSync(paths.os);
  const directivesFile = path.join(paths.vault, "wiki", "directives.md");

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
      case "POST /api/open": {
        const body = z.object({ path: z.string().max(400) }).parse(await readJson(req));
        const file = resolveVaultFile(paths.vault, body.path, OPEN_EXT);
        opener(file);
        return send(res, 200, { opened: true });
      }
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

  return { server, secret, paths, mint: () => mintToken(secret) };
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
  const bridge = createBridge(osDir, { log });
  bridge.server.on("error", (err: NodeJS.ErrnoException) => {
    console.error(err.code === "EADDRINUSE" ? `Port ${env.SUPEROS_PORT} is already in use. Is the bridge already running? Change SUPEROS_PORT in os/.env if not.` : `Bridge failed to start: ${err.message}`);
    process.exit(1);
  });
  // 127.0.0.1 only: never 0.0.0.0, so nothing else on the network can reach it.
  bridge.server.listen(env.SUPEROS_PORT, "127.0.0.1", () => {
    log(`started on 127.0.0.1:${env.SUPEROS_PORT} pid ${process.pid}`);
    console.log(`JDOLLA$ bridge running on http://127.0.0.1:${env.SUPEROS_PORT} (pid ${process.pid})`);
    console.log("Open the dashboard with: npm run open");
  });
}
