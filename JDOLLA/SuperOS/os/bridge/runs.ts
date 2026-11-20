// Run manager: starts Claude Code headless for T2/T3 requests, streams its output, records cost,
// copies T3 deliverables into outputs/, and stops a run by its exact process ID.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { buildClaudeArgs, capFor } from "./claude-args.ts";
import type { RunTier } from "./claude-args.ts";
import type { OsConfig, Paths } from "./config.ts";
import type { LogLine } from "./run-log.ts";

export type RunStatus = "running" | "done" | "failed" | "stopped";
export type RunEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | { type: "status"; status: RunStatus; costUsd: number | null; error: string | null; deliverables: string[] };

export type RunInfo = {
  id: string; tier: RunTier; text: string; dept: string; status: RunStatus;
  startedAt: string; endedAt: string | null; capUsd: number; costUsd: number | null;
  output: string; error: string | null; deliverables: string[];
};

export class RunError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** How to start the CLI: a command plus fixed leading arguments (tests use node + a stand-in script). */
export type ClaudeBin = { cmd: string; prefixArgs: string[] };

export const LIMITS = { T2: 3, T3: 1 } as const;
const MAX_OUTPUT = 200_000;
const MAX_KEPT = 50;
const MAX_DELIVERABLES = 20;
const MAX_DELIVERABLE_BYTES = 20 * 1024 * 1024;

type Run = RunInfo & { child: ChildProcess | null; listeners: Set<(e: RunEvent) => void>; events: RunEvent[]; stopRequested: boolean; workDir: string };

export function defaultClaudeBin(config: OsConfig, platform: string = process.platform): ClaudeBin {
  return { cmd: config.engine.claudeBin ?? (platform === "win32" ? "claude.exe" : "claude"), prefixArgs: [] };
}

/** YYYY-MM-DD_<dept>_<slug>.<ext>, adding -v2, -v3 ... instead of overwriting. */
export function deliverableName(dir: string, date: string, dept: string, slug: string, ext: string): string {
  const base = `${date}_${dept}_${slug}`;
  let name = `${base}${ext}`;
  for (let v = 2; existsSync(path.join(dir, name)); v++) name = `${base}-v${v}${ext}`;
  return name;
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 6).join("-").slice(0, 48) || "run";
}

export class RunManager {
  private runs = new Map<string, Run>();
  private paths: Paths;
  private config: () => OsConfig;
  private bin: () => ClaudeBin;
  private log: (line: LogLine) => void;

  constructor(opts: { paths: Paths; config: () => OsConfig; bin: () => ClaudeBin; log: (line: LogLine) => void }) {
    this.paths = opts.paths; this.config = opts.config; this.bin = opts.bin; this.log = opts.log;
  }

  list(): RunInfo[] {
    return [...this.runs.values()].map((r) => this.info(r)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  get(id: string): RunInfo | undefined {
    const r = this.runs.get(id);
    return r ? this.info(r) : undefined;
  }

  private info(r: Run): RunInfo {
    const { child: _c, listeners: _l, events: _e, stopRequested: _s, workDir: _w, ...info } = r;
    return { ...info, output: info.output.slice(-4000) };
  }

  /** Replays past events, then delivers new ones. Returns an unsubscribe function. */
  subscribe(id: string, fn: (e: RunEvent) => void): (() => void) | null {
    const r = this.runs.get(id);
    if (!r) return null;
    for (const e of r.events) fn(e);
    r.listeners.add(fn);
    return () => r.listeners.delete(fn);
  }

  private emit(r: Run, e: RunEvent): void {
    if (e.type === "text") {
      if (r.output.length >= MAX_OUTPUT) return;
      r.output += e.text;
    }
    r.events.push(e);
    for (const fn of r.listeners) { try { fn(e); } catch { /* a broken listener must not stop the run */ } }
  }

  start(req: { text: string; tier: RunTier; dept?: string; budgetUsd?: number }): RunInfo {
    const config = this.config();
    const running = [...this.runs.values()].filter((r) => r.status === "running" && r.tier === req.tier).length;
    if (running >= LIMITS[req.tier]) throw new RunError(429, `Only ${LIMITS[req.tier]} ${req.tier} run${LIMITS[req.tier] === 1 ? "" : "s"} at a time. Wait or stop one first.`);
    let cap: number;
    try { cap = capFor(req.tier, config, req.budgetUsd); } catch (e) { throw new RunError(400, e instanceof Error ? e.message : "Bad budget."); }

    const id = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
    const workDir = path.join(this.paths.vault, "outputs", "_work", id);
    if (req.tier === "T3") mkdirSync(workDir, { recursive: true });
    const { args, cwd } = buildClaudeArgs({ tier: req.tier, text: req.text, budgetUsd: cap, vault: this.paths.vault, workDir }, config);
    const bin = this.bin();

    const run: Run = {
      id, tier: req.tier, text: req.text.slice(0, 300), dept: req.dept && /^[a-z][a-z0-9-]{0,39}$/.test(req.dept) ? req.dept : "general",
      status: "running", startedAt: new Date().toISOString(), endedAt: null, capUsd: cap, costUsd: null,
      output: "", error: null, deliverables: [], child: null, listeners: new Set(), events: [], stopRequested: false, workDir,
    };
    this.runs.set(id, run);
    this.trim();

    // No shell: arguments go to the program as-is. Detached on Linux/macOS so the whole process
    // group can be stopped by its exact ID; Windows uses taskkill on the exact PID tree instead.
    const child = spawn(bin.cmd, [...bin.prefixArgs, ...args], {
      cwd, shell: false, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    run.child = child;
    let buf = "";
    let stderr = "";
    let result: { cost: number | null; isError: boolean; subtype: string; text: string } | null = null;

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg: unknown;
        try { msg = JSON.parse(line); } catch { continue; }
        if (typeof msg !== "object" || msg === null) continue;
        const m = msg as { type?: unknown; message?: { content?: unknown }; total_cost_usd?: unknown; is_error?: unknown; subtype?: unknown; result?: unknown };
        if (m.type === "assistant" && Array.isArray(m.message?.content)) {
          for (const block of m.message.content as Array<{ type?: unknown; text?: unknown; name?: unknown }>) {
            if (block.type === "text" && typeof block.text === "string") this.emit(run, { type: "text", text: block.text + "\n" });
            if (block.type === "tool_use" && typeof block.name === "string") this.emit(run, { type: "tool", name: block.name.slice(0, 60) });
          }
        } else if (m.type === "result") {
          result = {
            cost: typeof m.total_cost_usd === "number" ? m.total_cost_usd : null,
            isError: m.is_error === true,
            subtype: typeof m.subtype === "string" ? m.subtype.slice(0, 60) : "",
            text: typeof m.result === "string" ? m.result : "",
          };
        }
      }
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-2000); });

    const finish = (code: number | null, spawnError?: Error) => {
      if (run.status !== "running") return;
      const r = result as { cost: number | null; isError: boolean; subtype: string; text: string } | null;
      run.costUsd = r?.cost ?? null;
      run.endedAt = new Date().toISOString();
      if (run.stopRequested) run.status = "stopped";
      else if (spawnError) { run.status = "failed"; run.error = `Could not start Claude Code (${spawnError.message}). Is it installed and on PATH?`; }
      else if (r && !r.isError && code === 0) run.status = "done";
      else {
        run.status = "failed";
        run.error = r?.subtype === "error_max_budget_usd" ? `Stopped at the budget cap of $${cap}.`
          : r?.isError ? (r.text || r.subtype || "Claude reported an error.").slice(0, 300)
          : `Claude Code exited with code ${code}. ${stderr.trim().split("\n").pop() ?? ""}`.trim().slice(0, 300);
      }
      if (run.status === "done" && run.tier === "T3") run.deliverables = this.copyDeliverables(run);
      run.child = null;
      this.emit(run, { type: "status", status: run.status, costUsd: run.costUsd, error: run.error, deliverables: run.deliverables });
      this.log({ kind: "result", id, tier: run.tier, status: run.status, costUsd: run.costUsd, capUsd: cap, ms: Date.parse(run.endedAt) - Date.parse(run.startedAt), exit: code ?? -1 });
      run.listeners.clear();
    };
    child.on("error", (err) => finish(null, err));
    child.on("close", (code) => finish(code));
    this.log({ kind: "start", id, tier: run.tier, capUsd: cap, pid: child.pid ?? -1 });
    return this.info(run);
  }

  /** Stops one run by its exact process ID (and its own process group / tree). Never by name. */
  stop(id: string): boolean {
    const r = this.runs.get(id);
    if (!r || r.status !== "running" || !r.child?.pid) return false;
    r.stopRequested = true;
    const pid = r.child.pid;
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore" }).on("error", () => undefined);
    } else {
      try { process.kill(-pid, "SIGTERM"); } catch { try { r.child.kill("SIGTERM"); } catch { /* already gone */ } }
      const child = r.child;
      setTimeout(() => { if (child.exitCode === null && child.signalCode === null) { try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ } } }, 3000).unref();
    }
    return true;
  }

  stopAll(): void { for (const r of this.runs.values()) this.stop(r.id); }

  /** Copies regular files the T3 run made in its work folder into outputs/YYYY-MM/. Links and folders are skipped. */
  private copyDeliverables(r: Run): string[] {
    if (!existsSync(r.workDir)) return [];
    const date = r.startedAt.slice(0, 10);
    const outDir = path.join(this.paths.vault, "outputs", date.slice(0, 7));
    const slug = slugify(r.text);
    const copied: string[] = [];
    for (const name of readdirSync(r.workDir).sort()) {
      if (copied.length >= MAX_DELIVERABLES || name.startsWith(".")) continue;
      const src = path.join(r.workDir, name);
      const st = lstatSync(src);
      if (!st.isFile() || st.size > MAX_DELIVERABLE_BYTES) continue;
      mkdirSync(outDir, { recursive: true });
      const extra = copied.length ? `-${path.basename(name, path.extname(name)).replace(/[^a-z0-9]+/gi, "-").slice(0, 20).toLowerCase()}` : "";
      const finalName = deliverableName(outDir, date, r.dept, slug + extra, path.extname(name).toLowerCase().slice(0, 10));
      copyFileSync(src, path.join(outDir, finalName));
      copied.push(path.posix.join("outputs", date.slice(0, 7), finalName));
    }
    return copied;
  }

  private trim(): void {
    const done = [...this.runs.values()].filter((r) => r.status !== "running").sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    while (this.runs.size > MAX_KEPT && done.length) this.runs.delete((done.shift() as Run).id);
  }
}
