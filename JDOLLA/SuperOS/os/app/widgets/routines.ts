import { h } from "../dom.ts";
import type { Widget } from "./_template.ts";

export const routines: Widget = {
  id: "routines",
  title: "Routines",
  render(body, ctx) {
    if (!ctx.state.routines.length) { body.append(h("p", { class: "empty" }, "No routines yet. They are listed in routines/routines.json; the scheduler arrives in a later phase.")); return; }
    for (const r of ctx.state.routines) {
      body.append(h("div", { class: "row" }, h("span", {}, r.name + (r.enabled ? "" : " (off)")), h("span", { class: "when" }, r.schedule)));
    }
  },
};
