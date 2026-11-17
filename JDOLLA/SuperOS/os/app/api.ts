// Calls to the bridge. The session cookie is HttpOnly, so this code never sees the token.
import type { Directive, LayoutItem, OsState } from "../shared/types.ts";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
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
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const api = {
  state: () => call<OsState>("/api/state"),
  saveLayout: (layout: LayoutItem[]) => call<{ layout: LayoutItem[] }>("/api/layout", { layout }),
  toggleDirective: (id: string) => call<{ directives: Directive[] }>("/api/directives/toggle", { id }),
  addDirective: (text: string) => call<{ directives: Directive[] }>("/api/directives/add", { text }),
  open: (path: string) => call<{ opened: boolean }>("/api/open", { path }),
};
export type Api = typeof api;
