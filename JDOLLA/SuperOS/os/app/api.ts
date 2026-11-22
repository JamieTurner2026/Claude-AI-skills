// Calls to the bridge. The session cookie is HttpOnly, so this code never sees the token.
import type { HealthView } from "../shared/health.ts";
import type { Directive, InboxView, LayoutItem, OsState, ProposalView, ProposalsView, RoutinesView, RunView, SetupView, SkillsView, SuggestResult } from "../shared/types.ts";

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, message: string, data: unknown = null) { super(message); this.status = status; this.data = data; }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = body === undefined
    ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-superos": "1" }, body: JSON.stringify(body) };
  let res: Response;
  try { res = await fetch(path, init); } catch { throw new ApiError(0, "The bridge is not answering. Is `npm start` still running?"); }
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string" ? data.error : `Request failed (${res.status}).`;
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

export const api = {
  state: () => call<OsState>("/api/state"),
  health: () => call<HealthView>("/api/health"),
  setup: () => call<SetupView>("/api/setup"),
  saveLayout: (layout: LayoutItem[]) => call<{ layout: LayoutItem[] }>("/api/layout", { layout }),
  toggleDirective: (id: string) => call<{ directives: Directive[] }>("/api/directives/toggle", { id }),
  addDirective: (text: string) => call<{ directives: Directive[] }>("/api/directives/add", { text }),
  open: (path: string) => call<{ opened: boolean }>("/api/open", { path }),
  /** The bridge picks the tier. A T3 without confirm answers 409 with { needsConfirm, capUsd }. */
  startRun: (text: string, confirm: boolean) => call<{ run: RunView }>("/api/run", confirm ? { text, confirm: true } : { text }),
  runs: () => call<{ runs: RunView[] }>("/api/runs"),
  routines: () => call<RoutinesView>("/api/routines"),
  setRoutine: (id: string, enabled: boolean) => call<RoutinesView>(`/api/routines/${encodeURIComponent(id)}/toggle`, { enabled }),
  runRoutine: (id: string) => call<{ run: RunView | null }>(`/api/routines/${encodeURIComponent(id)}/run`, {}),
  skills: () => call<SkillsView>("/api/skills"),
  /** A T3 skill without confirm answers 409 with { needsConfirm, capUsd }. */
  runSkill: (name: string, input: string | undefined, confirm: boolean) =>
    call<{ run: RunView }>(`/api/skills/${encodeURIComponent(name)}/run`, { ...(input?.trim() ? { input: input.trim() } : {}), ...(confirm ? { confirm: true } : {}) }),
  inbox: () => call<InboxView>("/api/inbox"),
  suggestTunes: () => call<SuggestResult>("/api/analysis/suggest", {}),
  sortInbox: () => call<{ run: RunView }>("/api/inbox/sort", {}),
  proposals: () => call<ProposalsView>("/api/proposals"),
  decideProposal: (id: string, decision: "approve" | "reject") => call<{ proposal: ProposalView }>(`/api/proposals/${encodeURIComponent(id)}/${decision}`, {}),
  stopRun: (id: string) => call<{ stopped: boolean }>(`/api/runs/${encodeURIComponent(id)}/stop`, {}),
};
export type Api = typeof api;
