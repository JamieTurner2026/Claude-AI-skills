// Dashboard shell: command bar with live T1/T2/T3 bars, and a widget grid driven by the layout config.
import { route } from "../shared/router.ts";
import { TIERS } from "../shared/types.ts";
import type { LayoutItem, OsState, RouteResult } from "../shared/types.ts";
import { ApiError, api } from "./api.ts";
import { formatAge, healthWarnings } from "../shared/health.ts";
import { h } from "./dom.ts";
import { registry } from "./widgets/registry.ts";
import type { WidgetContext } from "./widgets/_template.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const grid = $("grid"), cmd = $<HTMLInputElement>("cmd"), reason = $("reason"), results = $("results"), warnings = $("warnings"), toastEl = $("toast");

let state: OsState | null = null;
let selectedDept: string | null = null;
let cleanups: Array<() => void> = [];
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function toast(message: string): void {
  toastEl.textContent = message; toastEl.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4500);
}

function ctx(): WidgetContext {
  return { state: state as OsState, api, refresh, toast, selectedDept };
}

async function saveLayout(layout: LayoutItem[]): Promise<void> {
  if (!state) return;
  try { state.layout = (await api.saveLayout(layout)).layout; } catch (e) { toast(e instanceof Error ? e.message : "Layout did not save."); }
  draw();
}

function draw(): void {
  if (!state) return;
  for (const c of cleanups) c();
  cleanups = [];
  const focusedId = document.activeElement?.id;
  grid.replaceChildren();
  $("brand").textContent = state.brand;
  document.title = `${state.brand} Super OS`;
  const open = state.directives.filter((d) => !d.done).length;
  $("counts").replaceChildren(...[[state.departments.length, "departments"], [state.counts.wiki, "notes"], [state.counts.raw, "sources"], [state.counts.outputs, "deliverables"], [open, "open directives"]]
    .map(([n, label]) => h("span", {}, h("b", {}, String(n)), ` ${label}`)));
  warnings.hidden = state.warnings.length === 0;
  warnings.replaceChildren(...state.warnings.map((w) => h("div", {}, w)));

  const layout = state.layout;
  layout.forEach((item, i) => {
    const widget = registry[item.widget];
    const body = h("div", { class: "body" });
    const move = (to: number) => { const next = layout.slice(); const [it] = next.splice(i, 1); if (it) next.splice(to, 0, it); void saveLayout(next); };
    const resize = () => void saveLayout(layout.map((l, j) => (j === i ? { ...l, span: ((l.span % 3) + 1) as 1 | 2 | 3 } : l)));
    const tools = h("div", { class: "tools" },
      h("button", { type: "button", "aria-label": "Move earlier", click: () => move(Math.max(0, i - 1)) }, "‹"),
      h("button", { type: "button", "aria-label": "Move later", click: () => move(Math.min(layout.length - 1, i + 1)) }, "›"),
      h("button", { type: "button", "aria-label": "Change width", click: resize }, `${item.span}w`));
    const el = h("section", { class: "widget", "data-span": String(item.span), "data-widget": item.widget },
      h("header", {}, h("h2", {}, widget?.title ?? item.widget), tools), body);
    if (!widget) body.append(h("p", { class: "empty" }, `No widget named "${item.widget}". Check config/os.config.json.`));
    else {
      try { const cleanup = widget.render(body, ctx()); if (cleanup) cleanups.push(cleanup); }
      catch { body.replaceChildren(h("p", { class: "empty" }, "This widget hit an error and was skipped.")); }
    }
    grid.append(el);
  });
  if (focusedId) document.getElementById(focusedId)?.focus();
}

const healthEl = $("health");
/** Says the health warnings aloud once, when they change; the strip itself redraws every poll and would repeat. */
const healthLive = $("health-live");
let lastWarnings = "";
/** The Health strip: one line of state chips. A chip turns the warning colour when healthWarnings() says so. */
async function drawHealth(): Promise<void> {
  try {
    const v = await api.health();
    const warns = healthWarnings(v);
    const chip = (label: string, value: string, warn: boolean) => h("span", { class: warn ? "chip warn" : "chip" }, label, " ", h("b", {}, value));
    healthEl.replaceChildren(
      chip("Bridge", `up ${formatAge(v.uptimeSec)}`, false),
      chip("Scheduler", v.scheduler.on ? `on, ${v.scheduler.routinesOn}/${v.scheduler.routinesTotal} routines` : "OFF", !v.scheduler.on),
      chip("Spend", `$${v.spend.todayUsd.toFixed(2)} / $${v.spend.capUsd.toFixed(2)}`, v.spend.pct > 80),
      chip("Last run", v.lastRun ? `${v.lastRun.status}, ${formatAge((Date.now() - Date.parse(v.lastRun.at)) / 1000)} ago` : "none", false),
      chip("Index", !v.brain.present ? "not built" : v.brain.stale ? "stale" : `${formatAge(v.brain.indexAgeSec ?? 0)} old`, v.brain.indexAgeSec !== null && v.brain.indexAgeSec > 86_400),
      chip("Embeddings", v.brain.embeddings ? "present" : "off", false),
      chip("Proposals", `${v.proposals.pending} pending`, false),
      chip("Backup", v.backup ? `${v.backup.status}, ${formatAge((Date.now() - Date.parse(v.backup.at)) / 1000)} ago` : "never run", v.backup?.status === "failed" || v.backup?.status === "refused"));
    healthEl.classList.toggle("warning", warns.length > 0);
    healthEl.title = warns.join(". ");
    const said = warns.length ? `Health: ${warns.join(". ")}.` : lastWarnings ? "Health: all clear." : "";
    if (said !== lastWarnings) { healthLive.textContent = said; lastWarnings = said; }
    healthEl.hidden = false;
  } catch { healthEl.hidden = true; } // signed out or the bridge is down: the main view already says so
}

async function refresh(): Promise<void> {
  void drawHealth();
  try { state = await api.state(); draw(); }
  catch (e) {
    const signedOut = e instanceof ApiError && e.status === 401;
    grid.replaceChildren(h("section", { class: "widget", "data-span": "3" }, h("header", {}, h("h2", {}, signedOut ? "Sign in" : "Bridge not reachable")),
      h("div", { class: "body" }, h("p", {}, signedOut ? "This browser has no session. In the os folder run: npm run open" : (e instanceof Error ? e.message : "Unknown error.")))));
  }
}

function showTiers(r: RouteResult): void {
  for (const tier of TIERS) {
    const row = document.querySelector<HTMLElement>(`.tier[data-tier="${tier}"]`);
    if (!row) continue;
    const pct = Math.round(r.probs[tier] * 100);
    (row.querySelector("i") as HTMLElement).style.width = `${pct}%`;
    (row.querySelector(".pct") as HTMLElement).textContent = `${pct}%`;
    row.classList.toggle("win", tier === r.tier);
  }
  reason.textContent = cmd.value.trim() ? `${r.tier}: ${r.reason}` : "Press Enter to run. Nothing is charged for T1.";
}

function classify(): RouteResult {
  const depts = (state?.departments ?? []).map((d) => ({ slug: d.slug, name: d.name }));
  return route(cmd.value, { depts });
}

function flash(widgetId: string): void {
  const el = document.querySelector<HTMLElement>(`[data-widget="${widgetId}"]`);
  if (!el) { toast(`The ${widgetId} widget is not on the layout.`); return; }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1600);
}

function search(query: string): void {
  if (!state) return;
  const q = query.toLowerCase();
  const hits: Array<[string, string]> = [];
  for (const d of state.departments) {
    if (`${d.slug} ${d.name} ${d.summary}`.toLowerCase().includes(q)) hits.push(["department", d.name]);
    for (const s of d.skills) if (`${s.name} ${s.description}`.toLowerCase().includes(q)) hits.push(["skill", `/${s.name}: ${s.description}`]);
  }
  for (const d of state.directives) if (d.text.toLowerCase().includes(q)) hits.push(["directive", d.text]);
  for (const r of state.routines) if (r.name.toLowerCase().includes(q)) hits.push(["routine", r.name]);
  results.hidden = false;
  results.replaceChildren(h("h2", {}, `Results for "${query}"`),
    ...(hits.length ? hits.slice(0, 20).map(([kind, text]) => h("div", { class: "hit" }, h("span", { class: "kind" }, kind), h("span", {}, text)))
      : [h("div", { class: "empty" }, "Nothing on the dashboard matches. Searching inside notes arrives with the brain index (Phase 3).")]));
}

function run(): void {
  if (!cmd.value.trim()) return;
  const r = classify();
  results.hidden = true;
  if (r.tier !== "T1") { void startRun(cmd.value.trim(), false); return; }
  const a = r.action;
  if (!a) { toast(r.reason); return; }
  if (a.kind === "open-dept") { selectedDept = a.slug; draw(); flash("departments"); }
  else if (a.kind === "show") flash(a.target === "apps" ? "apps" : a.target);
  else if (a.kind === "skill") { toast(`Use the Skills widget to run /${a.name}. Nothing was started.`); flash("skills"); }
  else search(a.query);
}

/** Starts a T2 run straight away. A T3 run costs real money, so it first asks, showing the bridge's cap. */
async function startRun(text: string, confirmed: boolean): Promise<void> {
  try {
    const { run } = await api.startRun(text, confirmed);
    results.hidden = true;
    toast(`Started a ${run.tier} run (up to $${run.capUsd}).`);
    await refresh();
    flash("runs");
  } catch (e) {
    const data = e instanceof ApiError ? (e.data as { needsConfirm?: boolean; capUsd?: number } | null) : null;
    if (e instanceof ApiError && e.status === 409 && data?.needsConfirm) {
      results.hidden = false;
      const go = h("button", { type: "button", class: "confirm-go", click: () => { results.hidden = true; void startRun(text, true); } }, `Run it (up to $${data.capUsd ?? "?"})`);
      const cancel = h("button", { type: "button", class: "ghost", click: () => { results.hidden = true; toast("Cancelled. Nothing was started."); } }, "Cancel");
      results.replaceChildren(h("h2", {}, "Real work: this costs money"),
        h("div", {}, `"${text.slice(0, 160)}" will run as T3 (Opus, can write files in its own work folder). It stops at $${data.capUsd ?? "?"}.`),
        h("div", { class: "confirm-row" }, go, cancel));
      go.focus();
      return;
    }
    toast(e instanceof Error ? e.message : "Could not start the run.");
  }
}

cmd.addEventListener("input", () => showTiers(classify()));
cmd.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
$("edit").addEventListener("click", (e) => {
  const on = document.body.classList.toggle("editing");
  (e.currentTarget as HTMLElement).setAttribute("aria-pressed", String(on));
  (e.currentTarget as HTMLElement).textContent = on ? "Done" : "Edit layout";
});

showTiers(classify());
void refresh();
setInterval(() => void drawHealth(), 30_000);
