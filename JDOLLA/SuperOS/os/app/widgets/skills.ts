// Skills: every skill draft in skills/, with its tier, suggested budget and a Run button.
// The Run button goes through the bridge's routine path, so every cap and containment rule applies.
// A T3 skill asks first ("Run this? Up to $X"). The bridge decides; this widget only asks.
import type { SkillView, SkillsView } from "../../shared/types.ts";
import { ApiError } from "../api.ts";
import { h } from "../dom.ts";
import type { Widget, WidgetContext } from "./_template.ts";

const money = (n: number) => `$${n.toFixed(2)}`;
const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

/** The skill waiting for "Run this? Up to $X". Kept outside the row so a redraw (every refresh redraws all widgets) does not lose it. */
let pending: { name: string; capUsd: number } | null = null;

function row(s: SkillView, ctx: WidgetContext): HTMLElement {
  const input = h("input", { type: "text", class: "skill-in", maxlength: "500", placeholder: "Optional input for this run", "aria-label": `Input for ${s.name}` });
  const actions = h("div", { class: "skill-actions" });
  const showActions = (): void => {
    if (pending?.name === s.name) {
      const go = h("button", { type: "button", class: "confirm-go", click: () => { pending = null; showActions(); start(true); } }, `Run this? Up to ${money(pending.capUsd)}`);
      const cancel = h("button", { type: "button", class: "ghost", click: () => { pending = null; showActions(); ctx.toast("Cancelled. Nothing was started."); } }, "Cancel");
      actions.replaceChildren(go, cancel);
    } else actions.replaceChildren(runBtn);
  };
  const start = (confirm: boolean): void => {
    void ctx.api.runSkill(s.name, input.value, confirm).then(
      (res) => { ctx.toast(`Started ${s.name} (up to ${money(res.run.capUsd)}).`); void ctx.refresh(); },
      (e: unknown) => {
        const data = e instanceof ApiError ? (e.data as { needsConfirm?: boolean; capUsd?: number } | null) : null;
        if (e instanceof ApiError && e.status === 409 && data?.needsConfirm) {
          pending = { name: s.name, capUsd: data.capUsd ?? s.budgetUsd };
          showActions();
          actions.querySelector<HTMLElement>(".confirm-go")?.focus();
          return;
        }
        ctx.toast(e instanceof Error ? e.message : "Could not start it.");
        void ctx.refresh();
      });
  };
  const runBtn = h("button", { type: "button", class: "runnow", click: () => { pending = null; start(false); } }, "Run");
  if (!s.runnable) runBtn.setAttribute("disabled", "");
  showActions();
  const tier = s.tierKnown ? s.tier : `tier unknown (using ${s.tier})`;
  const budget = s.budgetKnown ? `suggested ${money(s.budgetUsd)}` : `budget unknown (using ${money(s.budgetUsd)})`;
  const last = s.lastResult ? `Last: ${s.lastResult.status} ${when(s.lastResult.at)}${s.lastResult.costUsd !== null ? `, ${money(s.lastResult.costUsd)}` : ""}${s.lastResult.note ? ` · ${s.lastResult.note}` : ""}` : "Not run from here yet";
  return h("div", { class: "rt" },
    h("div", { class: "top" }, h("span", { class: "nm" }, `/${s.name}`), h("span", { class: "meta" }, `${tier} · ${budget}`)),
    ...(s.description ? [h("div", { class: "desc" }, s.description)] : []),
    ...(s.problem ? [h("div", { class: "meta warn" }, s.problem)] : []),
    h("div", { class: "top" }, input, actions),
    h("div", { class: "last" }, last));
}

export const skills: Widget = {
  id: "skills",
  title: "Skills",
  render(body, ctx) {
    let alive = true;
    const draw = (v: SkillsView) => {
      if (!alive) return;
      body.replaceChildren(h("div", { class: "spend" },
        h("span", {}, "Routines and skills spent today ", h("b", {}, money(v.spentTodayUsd)), ` of ${money(v.dailyCapUsd)}`),
        h("span", {}, `One run stops at its own budget, never above ${money(v.maxBudgetUsd)}`)));
      if (!v.skills.length) { body.append(h("p", { class: "empty" }, "No skills yet. Add them under skills/<name>/SKILL.md.")); return; }
      for (const s of v.skills) body.append(row(s, ctx));
    };
    body.append(h("p", { class: "empty" }, "Loading skills..."));
    ctx.api.skills().then(draw, (e: unknown) => { if (alive) body.replaceChildren(h("p", { class: "empty" }, e instanceof Error ? e.message : "Could not load skills.")); });
    return () => { alive = false; };
  },
};
