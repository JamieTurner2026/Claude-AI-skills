// After-update smoke check: `npm run smoke`. Proves the bridge still works end to end, on a throwaway copy.
//   1. copies the vault to a new temp folder (skipping os/node_modules, .git, logs, os/.cache, raw/sessions and every .env*)
//   2. starts the real bridge on that copy, on a free 127.0.0.1 port, with the fake CLI (no cost) and temp logs + brain index
//   3. calls every GET route and checks its shape, runs one T2 request end to end, rebuilds the vault, indexes and searches the brain
//   4. stops everything and deletes the temp folder, also when a step fails
// It never writes to the real vault, its logs or the real brain index: every path it writes is checked to be inside the
// temp folder first, and the temp folder must not overlap the vault.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBridge, type Bridge } from "./server.ts";

export const TEMP_PREFIX = "jdolla-smoke-";
const FAKE_CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-claude.ts");
const BRAIN_CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "brain", "cli.ts");

export type Step = { name: string; ok: boolean; detail: string };
export type SmokeResult = { ok: boolean; steps: Step[]; tempRoot: string; cleanedUp: boolean };

export class SmokeGuardError extends Error {}

/** True when `child` is `parent` or inside it (real paths, so links cannot sneak out). */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export type Plan = { root: string; copy: string; copyOs: string; logs: string; brainDb: string };

/** The only places smoke writes. Refuses a temp folder that overlaps the real vault in either direction. */
export function planPaths(vault: string, root: string): Plan {
  const v = realpathSync(vault);
  const r = realpathSync(root);
  if (isInside(v, r) || isInside(r, v)) throw new SmokeGuardError(`Refusing: the temp folder ${r} overlaps the vault ${v}.`);
  if (!path.basename(r).startsWith(TEMP_PREFIX)) throw new SmokeGuardError(`Refusing: ${r} is not a smoke temp folder.`);
  const plan = { root: r, copy: path.join(r, "vault"), copyOs: path.join(r, "vault", "os"), logs: path.join(r, "logs"), brainDb: path.join(r, "brain", "index.sqlite") };
  for (const p of [plan.copy, plan.copyOs, plan.logs, plan.brainDb]) assertWritable(plan, v, p);
  return plan;
}

/** Every write target must be inside the temp root and outside the real vault. */
export function assertWritable(plan: Pick<Plan, "root">, vault: string, target: string): void {
  if (!isInside(plan.root, target) || isInside(vault, target)) throw new SmokeGuardError(`Refusing to write ${target}: outside the smoke temp folder.`);
}

/** Deletes a temp folder only if smoke made it (name prefix, directly under the OS temp folder, not a link). */
export function removeTemp(root: string, tmpBase: string = tmpdir()): boolean {
  if (!existsSync(root)) return true;
  const st = lstatSync(root);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new SmokeGuardError(`Refusing to delete ${root}: not a plain folder.`);
  const real = realpathSync(root);
  if (path.dirname(real) !== realpathSync(tmpBase) || !path.basename(real).startsWith(TEMP_PREFIX)) throw new SmokeGuardError(`Refusing to delete ${real}: smoke did not make it.`);
  rmSync(real, { recursive: true, force: true });
  return !existsSync(real);
}

const SKIP_DIRS = new Set(["os/node_modules", ".git", "logs", "os/.cache", "raw/sessions", "outputs/_work"]);

/** Copies the vault without dependencies, history, logs, the session secret, imported sessions or any .env* file. Links are skipped. */
export function copyVault(vault: string, dest: string): void {
  const src = realpathSync(vault);
  cpSync(src, dest, {
    recursive: true, dereference: false, verbatimSymlinks: true,
    filter: (from) => {
      const rel = path.relative(src, from).split(path.sep).join("/");
      if (rel === "") return true;
      if (SKIP_DIRS.has(rel)) return false;
      const name = path.basename(from);
      if (name.startsWith(".env") && name !== ".env.example") return false;
      try { if (lstatSync(from).isSymbolicLink()) return false; } catch { return false; }
      return true;
    },
  });
}

type Shape = (body: unknown) => string | null; // null = fine, else what is wrong
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const has = (o: unknown, spec: Record<string, "array" | "number" | "boolean" | "string" | "object">): string | null => {
  if (!isObj(o)) return "not a JSON object";
  for (const [k, t] of Object.entries(spec)) {
    const v = o[k];
    const ok = t === "array" ? Array.isArray(v) : t === "object" ? isObj(v) : typeof v === t;
    if (!ok) return `${k} is not ${t === "array" || t === "object" ? "an" : "a"} ${t}`;
  }
  return null;
};

export const GET_ROUTES: Array<{ path: string; shape: Shape }> = [
  { path: "/api/state", shape: (b) => has(b, { owner: "string", departments: "array", directives: "array", routines: "array", layout: "array", warnings: "array", counts: "object" }) ?? ((b as { departments: unknown[] }).departments.length ? null : "no departments") },
  { path: "/api/runs", shape: (b) => has(b, { runs: "array" }) },
  { path: "/api/routines", shape: (b) => has(b, { schedulerOn: "boolean", routines: "array", spentTodayUsd: "number", dailyCapUsd: "number", problems: "array" }) },
  { path: "/api/skills", shape: (b) => (Array.isArray(b) || has(b, { skills: "array" }) === null ? null : "no skills list") },
  { path: "/api/proposals", shape: (b) => has(b, { proposals: "array", spentTodayUsd: "number", dailyCapUsd: "number", enabled: "boolean" }) },
  { path: "/api/inbox", shape: (b) => has(b, { count: "number", skipped: "number", max: "number", running: "boolean" }) },
  { path: "/api/routines/calendar", shape: (b) => has(b, { timezone: "string", capUsd: "number", days: "array", problems: "array" }) },
  { path: "/api/health", shape: (b) => has(b, { uptimeSec: "number", scheduler: "object", spend: "object", brain: "object", proposals: "object" }) },
];

export type SmokeOpts = {
  vault: string;
  /** Test hook: throw at the start of the named step. */
  failAt?: string;
  log?: (s: string) => void;
  tmpBase?: string;
};

export async function runSmoke(opts: SmokeOpts): Promise<SmokeResult> {
  const steps: Step[] = [];
  const log = opts.log ?? (() => undefined);
  const tmpBase = opts.tmpBase ?? tmpdir();
  // Check before creating anything: a temp base inside the vault would make the temp folder itself a write to the vault.
  if (isInside(realpathSync(opts.vault), realpathSync(tmpBase))) {
    const detail = `Refusing: the temp base ${tmpBase} is inside the vault.`;
    log(`  FAIL  plan  ${detail}`);
    return { ok: false, steps: [{ name: "plan", ok: false, detail }], tempRoot: "", cleanedUp: true };
  }
  const root = mkdtempSync(path.join(tmpBase, TEMP_PREFIX));
  let bridge: Bridge | null = null;
  let cleanedUp = false;

  const step = async (name: string, f: () => Promise<string> | string): Promise<boolean> => {
    try {
      if (opts.failAt === name) throw new Error("forced failure (test)");
      const detail = await f();
      steps.push({ name, ok: true, detail });
      log(`  PASS  ${name}  ${detail}`);
      return true;
    } catch (e) {
      const detail = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 300);
      steps.push({ name, ok: false, detail });
      log(`  FAIL  ${name}  ${detail}`);
      return false;
    }
  };

  try {
    let plan!: Plan;
    if (!(await step("plan", () => { plan = planPaths(opts.vault, root); return `temp folder ${plan.root}`; }))) return done();
    if (!(await step("copy vault", () => {
      copyVault(opts.vault, plan.copy);
      if (!existsSync(path.join(plan.copyOs, "config", "os.config.json"))) throw new Error("the copy has no os/config/os.config.json");
      return "copied (no node_modules, .git, logs, .cache, raw/sessions, .env)";
    }))) return done();

    let base = "";
    let token = "";
    if (!(await step("start bridge", async () => {
      mkdirSync(plan.logs, { recursive: true });
      mkdirSync(path.dirname(plan.brainDb), { recursive: true });
      bridge = createBridge(plan.copyOs, { claudeBin: { cmd: process.execPath, prefixArgs: [FAKE_CLI] }, logDir: plan.logs, brainDbPath: plan.brainDb, schedulerOn: false, opener: () => undefined });
      const b = bridge;
      await new Promise<void>((resolve, reject) => { b.server.once("error", reject); b.server.listen(0, "127.0.0.1", resolve); });
      base = `http://127.0.0.1:${(b.server.address() as AddressInfo).port}`;
      token = b.mint();
      const h = await fetch(`${base}/healthz`);
      if (h.status !== 200) throw new Error(`/healthz answered ${h.status}`);
      return `fake CLI, ${base}`;
    }))) return done();

    const auth = { authorization: `Bearer ${token}` };
    for (const r of GET_ROUTES) {
      await step(`GET ${r.path}`, async () => {
        const res = await fetch(base + r.path, { headers: auth });
        if (res.status !== 200) throw new Error(`answered ${res.status}`);
        const problem = r.shape(await res.json());
        if (problem) throw new Error(`unexpected shape: ${problem}`);
        return "200, shape ok";
      });
    }

    await step("T2 run (fake CLI)", async () => {
      const res = await fetch(`${base}/api/run`, { method: "POST", headers: { ...auth, "content-type": "application/json", "x-superos": "1" }, body: JSON.stringify({ text: "what is a servo alarm?" }) });
      if (res.status !== 202) throw new Error(`start answered ${res.status}: ${(await res.text()).slice(0, 120)}`);
      const { run } = (await res.json()) as { run: { id: string; tier: string } };
      if (run.tier !== "T2") throw new Error(`routed to ${run.tier}, expected T2`);
      const until = Date.now() + 30_000;
      while (Date.now() < until) {
        const list = (await (await fetch(`${base}/api/runs`, { headers: auth })).json()) as { runs: Array<{ id: string; status: string; costUsd: number | null }> };
        const r = list.runs.find((x) => x.id === run.id);
        if (r && r.status !== "running") {
          if (r.status !== "done") throw new Error(`run ended ${r.status}`);
          if (!(typeof r.costUsd === "number" && r.costUsd > 0)) throw new Error("no cost recorded");
          return `done, cost $${r.costUsd} recorded`;
        }
        await new Promise((w) => setTimeout(w, 150));
      }
      throw new Error("the run did not finish within 30 s");
    });

    await step("POST /api/vault/rebuild", async () => {
      const res = await fetch(`${base}/api/vault/rebuild`, { method: "POST", headers: { ...auth, "x-superos": "1" } });
      if (res.status !== 200) throw new Error(`answered ${res.status}`);
      const b = (await res.json()) as { counts?: Record<string, number> };
      if (!b.counts) throw new Error("no counts");
      return `create ${b.counts["create"] ?? 0}, update ${b.counts["update"] ?? 0}, unchanged ${b.counts["unchanged"] ?? 0}`;
    });

    const brainEnv = { ...process.env, SUPEROS_BRAIN_USAGE: "off" };
    await step("brain index", () => {
      assertWritable(plan, opts.vault, plan.brainDb);
      const out = execFileSync(process.execPath, [BRAIN_CLI, "index", "--vault", plan.copy, "--db", plan.brainDb], { encoding: "utf8", shell: false, timeout: 60_000, env: brainEnv, stdio: ["ignore", "pipe", "pipe"] });
      const m = /indexed (\d+) files/.exec(out);
      if (!m || Number(m[1]) < 1) throw new Error(`unexpected output: ${out.slice(0, 120)}`);
      return `${m[1]} files`;
    });
    await step("brain search", () => {
      const out = execFileSync(process.execPath, [BRAIN_CLI, "search", "charter", "--json", "--vault", plan.copy, "--db", plan.brainDb], { encoding: "utf8", shell: false, timeout: 30_000, env: brainEnv, stdio: ["ignore", "pipe", "pipe"] });
      const hits = JSON.parse(out) as unknown[];
      if (!Array.isArray(hits) || hits.length < 1) throw new Error("no hits for 'charter'");
      return `${hits.length} hits for "charter"`;
    });
    return done();
  } finally {
    await shutdown();
  }

  async function shutdown(): Promise<void> {
    if (bridge) {
      const b: Bridge = bridge;
      bridge = null;
      try { b.runs.stopAll(); } catch { /* best effort */ }
      await new Promise<void>((r) => { b.server.close(() => r()); b.server.closeAllConnections?.(); });
    }
    if (!cleanedUp) {
      try { cleanedUp = removeTemp(root, tmpBase); } catch (e) { log(`  FAIL  cleanup  ${(e as Error).message}`); }
    }
  }

  function done(): SmokeResult {
    return { ok: steps.length > 0 && steps.every((s) => s.ok), steps, tempRoot: root, get cleanedUp() { return cleanedUp; } } as SmokeResult;
  }
}
