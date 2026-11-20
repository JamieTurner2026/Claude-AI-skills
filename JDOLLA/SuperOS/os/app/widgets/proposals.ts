// Proposals: what the learning loop suggests after a run fails, is blocked or hits its cap.
// Approve applies it (a note in wiki/_learnings/, and one rule appended to the skill); Reject keeps
// everything as it is. The bridge does the writing; this widget only asks.
import type { ProposalView, ProposalsView } from "../../shared/types.ts";
import { h } from "../dom.ts";
import type { Widget } from "./_template.ts";

const money = (n: number) => `$${n.toFixed(2)}`;
const when = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const KIND = { budget: "Hit budget cap", failed: "Failed", blocked: "Tools blocked" } as const;

export const proposals: Widget = {
  id: "proposals",
  title: "Proposals",
  render(body, ctx) {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => ctx.api.proposals().then(draw, (e: unknown) => { if (alive) body.replaceChildren(h("p", { class: "empty" }, e instanceof Error ? e.message : "Could not load proposals.")); });
    const decide = (p: ProposalView, d: "approve" | "reject") => void ctx.api.decideProposal(p.id, d).then(
      (r) => {
        const a = r.proposal.applied;
        ctx.toast(d === "approve" ? `Approved. Saved ${a?.learningNote ?? "the lesson"}${a?.skillFile ? ` and updated ${a.skillFile}` : ""}.` : "Rejected. Nothing was changed.");
        void load();
      },
      (e: unknown) => { ctx.toast(e instanceof Error ? e.message : "Could not do that."); void load(); });

    function draw(v: ProposalsView): void {
      if (!alive) return;
      if (timer) { clearTimeout(timer); timer = null; }
      body.replaceChildren();
      body.append(h("div", { class: "spend" },
        h("span", {}, "Diagnoses today ", h("b", {}, money(v.spentTodayUsd)), ` of ${money(v.dailyCapUsd)}`),
        v.enabled ? h("span", {}, "Learning on") : h("span", { class: "off" }, "Learning off (engine.learning.enabled)")));
      if (!v.proposals.length) {
        body.append(h("p", { class: "empty" }, "No proposals. When a run fails, gets blocked or hits its cap, a suggested fix shows up here for you to approve or reject."));
        return;
      }
      const ordered = [...v.proposals.filter((p) => p.status === "pending"), ...v.proposals.filter((p) => p.status !== "pending")];
      for (const p of ordered) {
        const subject = p.run.routine ?? p.run.skill ?? `${p.run.tier} ${p.run.tier === "T2" ? "question" : "work"}`;
        const item = h("div", { class: `pr ${p.status}` },
          h("div", { class: "prtop" }, h("span", { class: "nm" }, `${KIND[p.kind]}: ${subject}`), h("span", { class: "meta" }, when(p.createdAt))),
          h("p", { class: "what" }, p.whatBroke));
        if (p.diagnosis.status === "running") item.append(h("p", { class: "meta" }, "Drafting a fix..."));
        if (p.fix) item.append(h("p", {}, h("b", {}, "Fix: "), p.fix));
        if (p.learning) item.append(h("p", {}, h("b", {}, "Lesson: "), p.learning));
        if (p.skillChange) item.append(h("p", {}, h("b", {}, `Add to /${p.skillChange.skill}: `), p.skillChange.rule));
        if (p.diagnosis.note) item.append(h("p", { class: "meta" }, p.diagnosis.note));
        if (p.diagnosis.costUsd !== null) item.append(h("p", { class: "meta" }, `Diagnosis cost ${money(p.diagnosis.costUsd)}`));
        if (p.status === "pending") {
          const approve = h("button", { type: "button", class: "runnow approve", click: () => decide(p, "approve") }, "Approve");
          if (p.diagnosis.status === "running") (approve as HTMLButtonElement).disabled = true;
          item.append(h("div", { class: "acts" }, approve, h("button", { type: "button", class: "runnow", click: () => decide(p, "reject") }, "Reject")));
        } else {
          item.append(h("p", { class: "meta" }, `${p.status === "approved" ? "Approved" : "Rejected"} ${p.decidedAt ? when(p.decidedAt) : ""}${p.applied?.note ? ` · ${p.applied.note}` : ""}`));
        }
        body.append(item);
      }
      // A diagnosis takes a few seconds: check back while one is running.
      if (v.proposals.some((p) => p.diagnosis.status === "running")) timer = setTimeout(() => void load(), 4000);
    }

    body.append(h("p", { class: "empty" }, "Loading proposals..."));
    void load();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  },
};
