// Routines calendar: the next seven days of routine slots, on and off, with each day's total budget against the daily cap.
// Read-only: it only shows what the scheduler would do (the bridge computes it from the scheduler's own slot rule).
// State is always said in words ("on", "off", "over the cap"), never by colour alone.
import type { CalendarDay, RoutineCalendarView } from "../../shared/types.ts";
import { h } from "../dom.ts";
import type { Widget } from "./_template.ts";

const money = (n: number) => `$${n.toFixed(2)}`;
const dayLabel = (d: CalendarDay) => `${d.today ? "Today, " : ""}${d.weekday} ${d.date.slice(5).replace("-", "/")}`;

export function dayTotalText(d: CalendarDay, capUsd: number): string {
  if (!d.slots.length) return "No routines";
  const pct = capUsd > 0 ? Math.round((d.enabledTotalUsd / capUsd) * 100) : 0;
  const off = d.allTotalUsd - d.enabledTotalUsd;
  return `${money(d.enabledTotalUsd)} of ${money(capUsd)} cap (${pct}%)${d.overCap ? ". Over the cap: later routines may be refused" : ""}${off > 0.00001 ? `. ${money(off)} more if the ones that are off were on` : ""}`;
}

export const calendar: Widget = {
  id: "calendar",
  title: "Next 7 days",
  render(body, ctx) {
    let alive = true;
    const draw = (v: RoutineCalendarView): void => {
      if (!alive) return;
      body.replaceChildren();
      for (const p of v.problems) body.append(h("p", { class: "empty" }, p));
      const list = h("ul", { class: "cal", "aria-label": `Routine slots for the next ${v.days.length} days, ${v.timezone.replace(/_/g, " ")} time` });
      for (const d of v.days) {
        const slots = h("ul", { class: "cal-slots" });
        for (const s of d.slots) {
          slots.append(h("li", { class: s.enabled ? "cal-slot" : "cal-slot off" },
            h("span", { class: "cal-time" }, s.time),
            h("span", { class: "cal-name" }, s.name),
            h("span", { class: "cal-meta" }, `${s.builtin ? "no model, $0" : money(s.budgetUsd)} · ${s.enabled ? "on" : "off"}${s.past ? " · earlier today" : ""}`)));
        }
        list.append(h("li", { class: d.overCap ? "cal-day over" : "cal-day" },
          h("div", { class: "cal-head" }, h("span", { class: "cal-date" }, dayLabel(d)), h("span", { class: "cal-total" }, dayTotalText(d, v.capUsd))),
          ...(d.slots.length ? [slots] : [])));
      }
      body.append(list);
    };
    body.append(h("p", { class: "empty" }, "Loading the calendar..."));
    const load = () => void ctx.api.routinesCalendar().then(draw, (e: unknown) => { if (alive) body.replaceChildren(h("p", { class: "empty" }, e instanceof Error ? e.message : "Could not load the calendar.")); });
    load();
    const timer = setInterval(load, 5 * 60_000);
    return () => { alive = false; clearInterval(timer); };
  },
};
