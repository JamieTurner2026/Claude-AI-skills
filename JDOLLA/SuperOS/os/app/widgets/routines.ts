// Routines: switch each one on or off, run it now, and see its last result and today's spend.
// The bridge decides what is due and enforces the budget and the daily cap; this widget only asks.
import type { RoutinesView } from "../../shared/types.ts";
import { h } from "../dom.ts";
import type { Widget } from "./_template.ts";

const money = (n: number) => `$${n.toFixed(2)}`;
const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

export const routines: Widget = {
  id: "routines",
  title: "Routines",
  render(body, ctx) {
    let alive = true;
    const draw = (v: RoutinesView) => {
      if (!alive) return;
      body.replaceChildren();
      body.append(h("div", { class: "spend" },
        h("span", {}, "Spent today ", h("b", {}, money(v.spentTodayUsd)), ` of ${money(v.dailyCapUsd)}`),
        v.schedulerOn ? h("span", {}, "Scheduler on") : h("span", { class: "off", title: "Set SUPEROS_SCHEDULER=on in os/.env and restart the bridge" }, "Scheduler off: routines only run with Run now")));
      for (const p of v.problems) body.append(h("p", { class: "empty" }, p));
      if (!v.routines.length) { body.append(h("p", { class: "empty" }, "No routines yet. Add them to routines/routines.json.")); return; }
      for (const r of v.routines) {
        const sw = h("button", { type: "button", class: "switch", "aria-pressed": String(r.enabled), "aria-label": `${r.name}: ${r.enabled ? "on" : "off"}`,
          click: () => void ctx.api.setRoutine(r.id, !r.enabled).then(draw, (e: unknown) => ctx.toast(e instanceof Error ? e.message : "Could not change it.")) }, r.enabled ? "On" : "Off");
        const run = h("button", { type: "button", class: "runnow", click: () => void ctx.api.runRoutine(r.id).then(
          (res) => { ctx.toast(`Started ${r.name} (up to ${money(res.run.capUsd)}).`); void ctx.refresh(); },
          (e: unknown) => { ctx.toast(e instanceof Error ? e.message : "Could not start it."); void ctx.refresh(); }) }, "Run now");
        const last = r.lastResult ? `Last: ${r.lastResult.status} ${when(r.lastResult.at)}${r.lastResult.costUsd !== null ? `, ${money(r.lastResult.costUsd)}` : ""}${r.lastResult.note ? ` · ${r.lastResult.note}` : ""}` : "Not run yet";
        body.append(h("div", { class: "rt" },
          h("div", { class: "top" }, h("span", { class: "nm" }, r.name), sw, run),
          h("div", { class: "meta" }, `${r.schedule} · ${r.tier} · up to ${money(r.budgetUsd)}${r.skill ? ` · /${r.skill}` : ""}`),
          h("div", { class: "last" }, last)));
      }
    };
    body.append(h("p", { class: "empty" }, "Loading routines..."));
    ctx.api.routines().then(draw, (e: unknown) => { if (alive) body.replaceChildren(h("p", { class: "empty" }, e instanceof Error ? e.message : "Could not load routines.")); });
    return () => { alive = false; };
  },
};
