import { h } from "../dom.ts";
import type { Widget } from "./_template.ts";

export const clock: Widget = {
  id: "clock",
  title: "Clock",
  render(body, ctx) {
    const rows = ctx.state.timezones.map((zone) => {
      const time = h("span", { class: "time" });
      const label = h("span", { class: "zone" });
      body.append(h("div", { class: "clock" }, time, label));
      return { zone, time, label };
    });
    const tick = () => {
      const now = new Date();
      for (const r of rows) {
        try {
          r.time.textContent = new Intl.DateTimeFormat("en-US", { timeZone: r.zone, hour: "numeric", minute: "2-digit", second: "2-digit" }).format(now);
          r.label.textContent = new Intl.DateTimeFormat("en-US", { timeZone: r.zone, weekday: "long", month: "short", day: "numeric" }).format(now) + " · " + r.zone.replace(/_/g, " ");
        } catch { r.time.textContent = "--:--"; r.label.textContent = `Unknown time zone: ${r.zone}`; }
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  },
};
