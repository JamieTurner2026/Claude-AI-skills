// Proposals: what the learning loop suggests after a run fails, is blocked or hits its cap.
// Approve applies it (a note in wiki/_learnings/, and one rule appended to the skill); Reject keeps
// everything as it is. The bridge does the writing; this widget only asks.
import type { InboxView, ProposalView, ProposalsView } from "../../shared/types.ts";
import { h } from "../dom.ts";
import { KINDS, KIND_LABEL, START, countByKind, ignoreKey, onKey, visible, whyLine, type Filter, type KeyState } from "../../shared/proposals-view.ts";
import type { Widget } from "./_template.ts";

const money = (n: number) => `$${n.toFixed(2)}`;
const when = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
// Same words as TUNE_NOTICE in bridge/learning.ts (a test keeps them equal; the browser cannot import the bridge).
const TUNE_NOTICE = "Approving only records your decision. It never changes config; you edit config yourself.";
const KIND = { budget: "Hit budget cap", failed: "Failed", blocked: "Tools blocked", move: "Inbox move", uncited: "Uncited answer", tune: "Suggested change" } as const;

export const proposals: Widget = {
  id: "proposals",
  title: "Proposals",
  render(body, ctx) {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // 10d: the chosen filter chip and the keyboard state survive each reload of the list.
    let filter: Filter = "all";
    let keys: KeyState = START;
    let last: { v: ProposalsView; inbox: InboxView | null } | null = null;
    let shown: ProposalView[] = [];
    const load = () => Promise.all([ctx.api.proposals(), ctx.api.inbox().catch(() => null)]).then(([v, inbox]) => draw(v, inbox), (e: unknown) => { if (alive) body.replaceChildren(h("p", { class: "empty" }, e instanceof Error ? e.message : "Could not load proposals.")); });
    const sort = () => void ctx.api.sortInbox().then(
      () => { ctx.toast("Sorting the inbox (up to $0.05). Suggested moves will appear here."); void load(); },
      (e: unknown) => { ctx.toast(e instanceof Error ? e.message : "Could not start it."); void load(); });
    const suggest = () => void ctx.api.suggestTunes().then(
      (r) => { ctx.toast(r.created ? `Added ${r.created} suggested change${r.created === 1 ? "" : "s"}. Nothing changes until you edit config yourself.` : r.found === 0 ? "No suggestions: the last 30 days look fine." : r.skippedWeekly ? "Already 3 suggestions this week; more next week." : "Those were already suggested recently."); void load(); },
      (e: unknown) => { ctx.toast(e instanceof Error ? e.message : "Could not do that."); void load(); });
    const decide = (p: ProposalView, d: "approve" | "reject") => void ctx.api.decideProposal(p.id, d).then(
      (r) => {
        const a = r.proposal.applied;
        ctx.toast(r.proposal.kind === "tune"
          ? (d === "approve" ? "Recorded. Nothing was changed; edit the config yourself." : "Rejected. Nothing was changed.")
          : r.proposal.kind === "move"
          ? (d === "approve" ? `Approved. ${a?.note ?? "Moved the file."}` : "Rejected. The file stays in the inbox.")
          : d === "approve" ? `Approved. Saved ${a?.learningNote ?? "the lesson"}${a?.skillFile ? ` and updated ${a.skillFile}` : ""}.` : "Rejected. Nothing was changed.");
        void load();
      },
      (e: unknown) => { ctx.toast(e instanceof Error ? e.message : "Could not do that."); void load(); });

    const redraw = () => { if (last) draw(last.v, last.inbox); };
    body.setAttribute("tabindex", "0");
    body.setAttribute("aria-keyshortcuts", "j k a r y n Escape");
    const onKeydown = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (ignoreKey({ key: ev.key, ctrlKey: ev.ctrlKey, metaKey: ev.metaKey, altKey: ev.altKey, targetTag: t?.tagName ?? "", editable: Boolean(t?.isContentEditable) })) return;
      const r = onKey(keys, ev.key, shown.map((p) => ({ id: p.id, pending: p.status === "pending", busy: p.diagnosis.status === "running" })));
      if (!r.handled) return;
      ev.preventDefault();
      keys = r.state;
      const p = r.decide ? shown.find((x) => x.id === r.decide?.id) : undefined;
      if (p && r.decide) decide(p, r.decide.decision); else redraw();
    };
    body.addEventListener("keydown", onKeydown);

    function draw(v: ProposalsView, inbox: InboxView | null): void {
      if (!alive) return;
      last = { v, inbox };
      if (timer) { clearTimeout(timer); timer = null; }
      body.replaceChildren();
      if (inbox) {
        const go = h("button", { type: "button", class: "runnow", click: sort }, inbox.running ? "Sorting..." : "Sort inbox");
        if (inbox.running || inbox.count === 0) go.setAttribute("disabled", "");
        body.append(h("div", { class: "spend" },
          h("span", {}, "Inbox ", h("b", {}, `${inbox.count} file${inbox.count === 1 ? "" : "s"}`), `${inbox.skipped ? `, ${inbox.skipped} skipped` : ""}${inbox.count > inbox.max ? ` (${inbox.max} at a time)` : ""}`),
          go));
        if (inbox.last) body.append(h("p", { class: "meta" }, `Last sort ${when(inbox.last.at)}: ${inbox.last.note}`));
      }
      body.append(h("div", { class: "spend" },
        h("span", {}, "Run analysis (last 30 days)"),
        h("button", { type: "button", class: "runnow", click: suggest }, "Suggest changes")));
      body.append(h("div", { class: "spend" },
        h("span", {}, "Diagnoses today ", h("b", {}, money(v.spentTodayUsd)), ` of ${money(v.dailyCapUsd)}`),
        v.enabled ? h("span", {}, "Learning on") : h("span", { class: "off" }, "Learning off (engine.learning.enabled)")));
      // A diagnosis or an inbox sort takes a few seconds: check back while one is running (also when there is nothing to list yet).
      if (v.proposals.some((p) => p.diagnosis.status === "running") || inbox?.running) timer = setTimeout(() => void load(), 4000);
      if (!v.proposals.length) {
        body.append(h("p", { class: "empty" }, "No proposals. When a run fails, gets blocked or hits its cap, a suggested fix shows up here for you to approve or reject."));
        return;
      }
      const counts = countByKind(v.proposals);
      if (filter !== "all" && counts[filter] === 0) filter = "all";
      const chips = h("div", { class: "chips", role: "toolbar", "aria-label": "Filter proposals by kind" });
      for (const f of ["all", ...KINDS] as Filter[]) {
        if (f !== "all" && counts[f] === 0) continue;
        const chip = h("button", { type: "button", class: "chip", "aria-pressed": String(filter === f), "data-kind": f,
          click: () => { filter = f; keys = START; redraw(); } }, f === "all" ? "All " : `${KIND_LABEL[f]} `, h("b", {}, String(counts[f])));
        chips.append(chip);
      }
      body.append(chips);
      shown = visible(v.proposals, filter);
      keys = { index: Math.max(0, Math.min(shown.length - 1, keys.index)), ask: keys.ask && shown.some((x) => x.id === keys.ask?.id) ? keys.ask : null };
      body.append(h("p", { class: "meta keys" }, "Keys (click here first): j/k move · a approve · r reject · each asks y/n first"));
      shown.forEach((p, i) => {
        const subject = p.move ? p.move.file : p.run.routine ?? p.run.skill ?? `${p.run.tier} ${p.run.tier === "T2" ? "question" : "work"}`;
        const item = h("div", { class: `pr ${p.status}${i === keys.index ? " sel" : ""}`, "data-id": p.id, click: () => { if (keys.index !== i) { keys = { index: i, ask: null }; redraw(); body.focus(); } } },
          h("div", { class: "prtop" }, h("span", { class: "nm" }, `${KIND[p.kind]}: ${subject}`), h("span", { class: "meta" }, when(p.createdAt))),
          h("p", { class: "what" }, p.move ? `Move inbox/${p.move.file} to ${p.move.movedTo ?? p.move.to}${p.move.reason ? `. ${p.move.reason}` : ""}` : p.whatBroke));
        const why = whyLine(p);
        if (why) item.append(h("p", { class: "why" }, why));
        if (p.kind === "tune") item.append(h("p", { class: "meta" }, TUNE_NOTICE));
        if (p.diagnosis.status === "running") item.append(h("p", { class: "meta" }, "Drafting a fix..."));
        if (p.fix) item.append(h("p", {}, h("b", {}, "Fix: "), p.fix));
        if (p.learning) item.append(h("p", {}, h("b", {}, "Lesson: "), p.learning));
        if (p.skillChange) item.append(h("p", {}, h("b", {}, `Add to /${p.skillChange.skill}: `), p.skillChange.rule));
        if (p.diagnosis.note) item.append(h("p", { class: "meta" }, p.diagnosis.note));
        if (p.diagnosis.costUsd !== null) item.append(h("p", { class: "meta" }, `Diagnosis cost ${money(p.diagnosis.costUsd)}`));
        if (keys.ask?.id === p.id) {
          item.append(h("div", { class: "ask", role: "alert" },
            h("span", {}, `${keys.ask.decision === "approve" ? "Approve" : "Reject"} this? `), h("b", {}, "y"), " yes · ", h("b", {}, "n"), " no"));
        }
        if (p.status === "pending") {
          const approve = h("button", { type: "button", class: "runnow approve", click: () => decide(p, "approve") }, "Approve");
          if (p.diagnosis.status === "running") (approve as HTMLButtonElement).disabled = true;
          item.append(h("div", { class: "acts" }, approve, h("button", { type: "button", class: "runnow", click: () => decide(p, "reject") }, "Reject")));
        } else {
          item.append(h("p", { class: "meta" }, `${p.status === "approved" ? "Approved" : "Rejected"} ${p.decidedAt ? when(p.decidedAt) : ""}${p.applied?.note ? ` · ${p.applied.note}` : ""}`));
        }
        body.append(item);
      });
      if (!shown.length) body.append(h("p", { class: "empty" }, "Nothing of this kind."));
    }

    body.append(h("p", { class: "empty" }, "Loading proposals..."));
    void load();
    return () => { alive = false; if (timer) clearTimeout(timer); body.removeEventListener("keydown", onKeydown); };
  },
};
