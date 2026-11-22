// Setup checklist: Jay's list for the PC, one row per step. The bridge says done or todo from what it can see (the doctor's
// checks, a few files and folders); steps it cannot see are "manual" and Jay ticks them here. Ticks live in this browser's
// localStorage only (a convenience, never state: wrapped in try/catch, the widget works without it). The widget hides
// itself once every row is done. The § is a button that opens docs/PC-SETUP.md in the default app, through the bridge.
import type { SetupRow, SetupView } from "../../shared/types.ts";
import { h } from "../dom.ts";
import type { Widget } from "./_template.ts";

export const TICKS_KEY = "superos.setup.ticks";

export function readTicks(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(TICKS_KEY) ?? "{}") as unknown;
    if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([k, x]) => /^[a-z][a-z0-9-]{0,30}$/.test(k) && x === true));
  } catch { return {}; }
}
function writeTicks(t: Record<string, boolean>): void {
  try { localStorage.setItem(TICKS_KEY, JSON.stringify(t)); } catch { /* private window or blocked storage: the tick just lasts until the next redraw */ }
}

/** A row counts as done when the bridge says so, or it is a manual row Jay has ticked. */
export const isDone = (r: SetupRow, ticks: Record<string, boolean>): boolean => r.state === "done" || (r.state === "manual" && ticks[r.id] === true);

export const setup: Widget = {
  id: "setup",
  title: "Setup checklist",
  render(body, ctx) {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const section = (): HTMLElement | null => body.closest<HTMLElement>(".widget");
    const open = () => void ctx.api.open("docs/PC-SETUP.md").then(() => ctx.toast("Opened PC-SETUP in your default app."), (e: unknown) => ctx.toast(e instanceof Error ? e.message : "Could not open PC-SETUP."));

    const draw = (v: SetupView): void => {
      if (!alive) return;
      const ticks = readTicks();
      const done = v.rows.filter((r) => isDone(r, ticks)).length;
      const sec = section();
      if (sec) sec.hidden = done === v.rows.length; // nothing left to do: out of the way
      body.replaceChildren(h("div", { class: "su-count" }, h("b", {}, `${done} of ${v.rows.length}`), " steps done"));
      for (const r of v.rows) {
        const ok = isDone(r, ticks);
        const mark = r.state === "manual"
          ? h("input", { type: "checkbox", class: "su-box", "aria-label": `${r.label}: done`, ...(ok ? { checked: true } : {}), change: (ev: Event) => { const t = readTicks(); if ((ev.target as HTMLInputElement).checked) t[r.id] = true; else delete t[r.id]; writeTicks(t); draw(v); } })
          : h("span", { class: ok ? "su-mark ok" : "su-mark", "aria-label": ok ? "done" : "to do" }, ok ? "✓" : "○");
        body.append(h("div", { class: ok ? "su-row ok" : "su-row", "data-state": r.state },
          mark,
          h("div", { class: "su-main" }, h("span", { class: "su-label" }, r.label), h("span", { class: "su-hint" }, r.hint)),
          h("button", { type: "button", class: "su-sec", title: "Open PC-SETUP", click: open }, `PC-SETUP ${r.section}`)));
      }
    };
    const load = () => void ctx.api.setup().then(draw, (e: unknown) => { if (alive) body.replaceChildren(h("p", { class: "empty" }, e instanceof Error ? e.message : "Could not load the checklist.")); });

    body.append(h("p", { class: "empty" }, "Checking this PC..."));
    load();
    timer = setInterval(load, 60_000);
    return () => { alive = false; if (timer) clearInterval(timer); };
  },
};
