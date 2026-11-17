import { h } from "../dom.ts";
import type { Widget } from "./_template.ts";

export const departments: Widget = {
  id: "departments",
  title: "Departments",
  render(body, ctx) {
    if (!ctx.state.departments.length) { body.append(h("p", { class: "empty" }, "No departments found in depts/.")); return; }
    const grid = h("div", { class: "depts" });
    for (const d of ctx.state.departments) {
      const card = h("button", { type: "button", class: "dept" + (ctx.selectedDept === d.slug ? " sel" : ""), "data-slug": d.slug, title: "Open this department's router note",
        click: () => void ctx.api.open(`depts/${d.slug}.md`).then(() => ctx.toast(`Opened depts/${d.slug}.md`), (e: unknown) => ctx.toast(e instanceof Error ? e.message : "Could not open it.")) },
        h("span", { class: "nm" }, d.name),
        h("span", { class: "meta" }, `${d.slug} · ${d.noteCount} note${d.noteCount === 1 ? "" : "s"} · ${d.skills.length} skill${d.skills.length === 1 ? "" : "s"}`),
        h("span", { class: "sum" }, d.summary));
      if (d.skills.length) card.append(h("span", { class: "skills" }, ...d.skills.map((s) => h("span", { class: "skill", title: s.description }, "/" + s.name))));
      grid.append(card);
    }
    body.append(grid);
  },
};
