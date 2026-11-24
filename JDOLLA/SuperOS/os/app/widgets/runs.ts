// Runs: every T2/T3 run with its status, cost and live output. Running runs stream over
// server-sent events and have a Stop button. Output is shown as text only (never HTML).
import type { RunView } from "../../shared/types.ts";
import { h } from "../dom.ts";
import type { Widget } from "./_template.ts";

const money = (n: number | null) => (n === null ? "-" : `$${n.toFixed(n < 0.1 ? 4 : 2)}`);

export const runs: Widget = {
  id: "runs",
  title: "Runs",
  render(body, ctx) {
    let alive = true;
    const sources: EventSource[] = [];
    const list = h("div", { class: "body-list" });
    body.append(list);
    const card = (r: RunView) => {
      const out = h("pre", { role: "log", "aria-live": "polite", "aria-relevant": "additions", tabindex: "0", "aria-label": `Output of ${r.routine ? `routine ${r.routine}` : r.skill ? `skill ${r.skill}` : "run"} ${r.id.slice(0, 8)}` });
      /** Adds streamed text at the end (a screen reader reads only what is new) and drops the oldest past 6000 characters. */
      const add = (t: string) => { out.append(document.createTextNode(t)); while ((out.textContent ?? "").length > 6000 && out.firstChild && out.childNodes.length > 1) out.firstChild.remove(); };
      const head = h("div", { class: "head" },
        h("span", { class: `pill ${r.tier}` }, r.tier), h("span", { class: `pill ${r.status}` }, r.status),
        h("span", {}, `cost ${money(r.costUsd)} of ${money(r.capUsd)}`), h("span", {}, new Date(r.startedAt).toLocaleTimeString()));
      if (r.status === "running") {
        head.append(h("button", { type: "button", class: "stop", click: () => void ctx.api.stopRun(r.id).then(() => ctx.toast("Stopping the run."), (e: unknown) => ctx.toast(e instanceof Error ? e.message : "Could not stop it.")) }, "Stop"));
        // The stream replays everything so far, so start empty and let it fill in.
        const es = new EventSource(`/api/runs/${encodeURIComponent(r.id)}/events`);
        sources.push(es);
        es.onmessage = (ev) => {
          const e = JSON.parse(String(ev.data)) as { type: string; text?: string; name?: string };
          if (e.type === "text" && e.text) add(e.text);
          if (e.type === "tool" && e.name) add(`[${e.name}]\n`);
          if (e.type === "denied") add(`[blocked: ${(e as { tool?: string }).tool ?? "tool"}]\n`);
          if (e.type === "status") { es.close(); if (alive) void ctx.refresh(); }
          out.scrollTop = out.scrollHeight;
        };
        es.onerror = () => es.close();
      } else out.textContent = r.output.slice(-3000) || "(no output)";
      const el = h("div", { class: "run" }, head, h("div", { class: "q" }, r.routine ? `Routine: ${r.routine}` : r.skill ? `Skill: ${r.skill}` : r.text), out);
      if (r.error) el.append(h("div", { class: "err" }, r.error));
      if (r.denied.length) el.append(h("div", { class: "err" }, `Blocked ${r.denied.length} tool call${r.denied.length === 1 ? "" : "s"}: ${r.denied.map((d) => d.split(":")[0]).join(", ")}`));
      for (const d of r.deliverables) {
        el.append(h("button", { type: "button", class: "ghost", click: () => void ctx.api.open(d).then(() => ctx.toast(`Opened ${d}`), (e: unknown) => ctx.toast(e instanceof Error ? e.message : "Could not open it.")) }, `Open ${d}`));
      }
      return el;
    };
    ctx.api.runs().then(({ runs: all }) => {
      if (!alive) return;
      if (!all.length) list.append(h("p", { class: "empty" }, "No runs yet. Type a question (T2) or a work request (T3) above and press Enter."));
      for (const r of all.slice(0, 8)) list.append(card(r));
    }, (e: unknown) => { if (alive) list.append(h("p", { class: "empty" }, e instanceof Error ? e.message : "Could not load runs.")); });
    return () => { alive = false; for (const s of sources) s.close(); };
  },
};
