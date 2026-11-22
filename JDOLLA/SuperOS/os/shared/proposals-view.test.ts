import { test } from "node:test";
import assert from "node:assert/strict";
import { KINDS, START, countByKind, ignoreKey, onKey, visible, whyLine, type KeyItem, type KeyState } from "./proposals-view.ts";
import type { ProposalView } from "./types.ts";

const p = (id: string, kind: ProposalView["kind"], status: ProposalView["status"], createdAt: string, extra: Partial<ProposalView> = {}) =>
  ({ id, kind, status, createdAt, run: { id: "r", tier: "T2", dept: "ai", skill: null, routine: null, status: "done", error: null, denied: [], costUsd: 0, capUsd: 0.05, prompt: "" }, tune: null, ...extra }) as ProposalView;

const list = [
  p("a", "failed", "pending", "2026-11-20T10:00:00Z"),
  p("b", "tune", "pending", "2026-11-21T10:00:00Z", { tune: { key: "k", kind: "budget", subject: "plan-today" } }),
  p("c", "uncited", "approved", "2026-11-22T10:00:00Z"),
  p("d", "failed", "rejected", "2026-11-19T10:00:00Z"),
  p("e", "move", "pending", "2026-11-22T09:00:00Z"),
];

test("counts per kind include every kind and 'all'", () => {
  const c = countByKind(list);
  assert.deepEqual(c, { all: 5, failed: 2, budget: 0, blocked: 0, move: 1, uncited: 1, tune: 1 });
  assert.equal(KINDS.length, 6);
  assert.deepEqual(countByKind([]), { all: 0, failed: 0, budget: 0, blocked: 0, move: 0, uncited: 0, tune: 0 });
});

test("the filter keeps one kind; pending first, newest first within each group", () => {
  assert.deepEqual(visible(list, "all").map((x) => x.id), ["e", "b", "a", "c", "d"]);
  assert.deepEqual(visible(list, "failed").map((x) => x.id), ["a", "d"]);
  assert.deepEqual(visible(list, "budget").map((x) => x.id), []);
  assert.equal(list[0]?.id, "a", "the input list is not reordered");
});

test("a one-line why for tune and uncited only, from stored fields", () => {
  assert.equal(whyLine(list[1]!), "Why: runs keep stopping at their budget cap for plan-today (run analysis, last 30 days).");
  assert.equal(whyLine(p("u", "uncited", "pending", "x")), "Why: the answer used your notes but named none of them.");
  assert.match(whyLine(p("u", "uncited", "pending", "x", { run: { ...list[0]!.run, skill: "plan-today" } })) ?? "", /adds a rule to \/plan-today/);
  assert.match(whyLine(p("t", "tune", "pending", "x", { tune: { key: "k", kind: "new-rule", subject: "s" } })) ?? "", /"new-rule" rule fired for s/);
  for (const k of ["failed", "budget", "blocked", "move"] as const) assert.equal(whyLine(p("x", k, "pending", "x")), null, k); // control
  assert.equal(whyLine(p("t", "tune", "pending", "x")), null, "a tune card with no stored rule gets no made-up why");
});

const items: KeyItem[] = [{ id: "e", pending: true }, { id: "b", pending: true, busy: true }, { id: "c", pending: false }];
const press = (keys: string[], s: KeyState = START) => {
  const decided: Array<{ id: string; decision: string }> = [];
  for (const k of keys) { const r = onKey(s, k, items); s = r.state; if (r.decide) decided.push(r.decide); }
  return { s, decided };
};

test("j/k move and stay inside the list", () => {
  assert.equal(press(["j"]).s.index, 1);
  assert.equal(press(["j", "j", "j", "j"]).s.index, 2);
  assert.equal(press(["k", "k"]).s.index, 0);
  assert.equal(press(["ArrowDown", "ArrowUp", "ArrowDown"]).s.index, 1);
});

test("a and r only ask; y or Enter on the open question decides", () => {
  assert.deepEqual(press(["a"]).decided, [], "a alone never decides");
  assert.deepEqual(press(["a"]).s.ask, { id: "e", decision: "approve" });
  assert.deepEqual(press(["a", "y"]).decided, [{ id: "e", decision: "approve" }]);
  assert.deepEqual(press(["r", "Enter"]).decided, [{ id: "e", decision: "reject" }]);
  assert.deepEqual(press(["y"]).decided, [], "y with no question does nothing");
  assert.deepEqual(press(["Enter", "Enter"]).decided, []);
});

test("n, Escape or any other key cancels the question", () => {
  for (const k of ["n", "Escape", "j", "a", "x"]) {
    const r = press(["a", k]);
    assert.deepEqual(r.decided, [], k);
    assert.equal(r.s.ask, null, k);
  }
  assert.deepEqual(press(["a", "a", "y"]).decided, [], "a second a cancels, so the y has nothing to confirm");
});

test("decided or still-diagnosing cards cannot be asked about", () => {
  assert.equal(press(["j", "a"]).s.ask, null, "busy (diagnosis running)");
  assert.equal(press(["j", "j", "r"]).s.ask, null, "already decided");
  // A card that stops being pending while the question is open is not decided.
  const asked = press(["a"]).s;
  const r = onKey(asked, "y", [{ id: "e", pending: false }]);
  assert.equal(r.decide, undefined);
});

test("an empty list ignores every key", () => {
  for (const k of ["j", "a", "y"]) { const r = onKey(START, k, []); assert.equal(r.decide, undefined); assert.equal(r.handled, false); }
});

test("typing in a field or with a modifier never triggers a shortcut", () => {
  assert.equal(ignoreKey({ key: "a", targetTag: "INPUT" }), true);
  assert.equal(ignoreKey({ key: "a", targetTag: "textarea" }), true);
  assert.equal(ignoreKey({ key: "a", editable: true }), true);
  assert.equal(ignoreKey({ key: "r", ctrlKey: true }), true);
  assert.equal(ignoreKey({ key: "a", metaKey: true }), true);
  assert.equal(ignoreKey({ key: "a", targetTag: "DIV" }), false); // control
});
