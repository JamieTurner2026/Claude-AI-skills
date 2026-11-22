// `npm run status`: asks the running bridge for its health and prints a short table. It talks to 127.0.0.1 only, using
// the same session token `npm run open` mints. Exit 0 = running; exit 1 = not running (a Task Scheduler check can use
// that); exit 2 = running but the answer could not be used.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { HealthView } from "../shared/health.ts";
import { formatHealth } from "../shared/health.ts";
import { loadOrCreateSecret, mintToken } from "./auth.ts";
import { loadEnv, pathsFor } from "./config.ts";

const Health = z.object({
  ok: z.literal(true), version: z.string().max(40), uptimeSec: z.number(),
  scheduler: z.object({ on: z.boolean(), routinesOn: z.number(), routinesTotal: z.number() }),
  spend: z.object({ todayUsd: z.number(), capUsd: z.number(), pct: z.number() }),
  lastRun: z.object({ status: z.string().max(20), tier: z.enum(["T2", "T3"]), at: z.string().max(40) }).nullable(),
  brain: z.object({ present: z.boolean(), indexAgeSec: z.number().nullable(), stale: z.boolean(), embeddings: z.boolean(), embeddedChunks: z.number() }),
  proposals: z.object({ pending: z.number() }),
  backup: z.object({ at: z.string().max(40), status: z.enum(["pushed", "nothing", "refused", "failed"]) }).nullable(),
});

export type StatusResult = { code: 0 | 1 | 2; text: string };

/** Never throws. `token` is minted only after the bridge has answered /healthz, so a not-running check touches no secret. */
export async function checkStatus(base: string, token: () => string): Promise<StatusResult> {
  try {
    const r = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) throw new Error(String(r.status));
  } catch { return { code: 1, text: "not running" }; }
  try {
    const r = await fetch(`${base}/api/health`, { headers: { authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(3000) });
    if (r.status === 401) return { code: 2, text: "The bridge is running but refused this session. Restart it (npm start) and try again." };
    if (!r.ok) return { code: 2, text: `The bridge is running but answered ${r.status}.` };
    const h = Health.safeParse(await r.json());
    if (!h.success) return { code: 2, text: "The bridge is running but sent an answer this version does not understand." };
    return { code: 0, text: formatHealth(h.data as HealthView) };
  } catch { return { code: 2, text: "The bridge is running but did not answer in time." }; }
}

if (import.meta.main) {
  const paths = pathsFor(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const base = `http://127.0.0.1:${loadEnv(paths).SUPEROS_PORT}`;
  const r = await checkStatus(base, () => mintToken(loadOrCreateSecret(paths)));
  (r.code === 0 ? console.log : console.error)(r.text);
  process.exit(r.code);
}
