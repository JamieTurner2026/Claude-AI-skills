import { h } from "../dom.ts";
import type { Widget } from "./_template.ts";

export const directives: Widget = {
  id: "directives",
  title: "Directives",
  render(body, ctx) {
    const act = async (fn: () => Promise<unknown>) => {
      try { await fn(); } catch (e) { ctx.toast(e instanceof Error ? e.message : "That did not save."); }
      await ctx.refresh();
    };
    if (!ctx.state.directives.length) body.append(h("p", { class: "empty" }, "No directives yet. Add today's first one below."));
    for (const d of ctx.state.directives) {
      body.append(h("button", { type: "button", class: "directive" + (d.done ? " done" : ""), "aria-pressed": String(d.done), click: () => void act(() => ctx.api.toggleDirective(d.id)) },
        h("span", { class: "box" }), h("span", { class: "txt" }, d.text)));
    }
    const input = h("input", { type: "text", id: "directive-new", maxlength: "200", placeholder: "Add a directive", "aria-label": "New directive" });
    const add = () => { const text = input.value.trim(); if (text) void act(() => ctx.api.addDirective(text)); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
    body.append(h("div", { class: "add" }, input, h("button", { type: "button", click: add }, "Add")));
  },
};
