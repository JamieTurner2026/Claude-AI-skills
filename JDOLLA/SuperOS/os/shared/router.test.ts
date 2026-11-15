import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_INPUT, route } from "./router.ts";

const ctx = {
  depts: [
    { slug: "software", name: "Software Engineering & Development" },
    { slug: "security", name: "Cybersecurity & IT Infrastructure" },
    { slug: "ai", name: "AI Research, Memory & Automation" },
  ],
};

test("probabilities sum to 1 and match the chosen tier", () => {
  for (const t of ["", "open software", "what is a servo?", "build a landing page for my app", "hmm"]) {
    const r = route(t, ctx);
    assert.ok(Math.abs(r.probs.T1 + r.probs.T2 + r.probs.T3 - 1) < 1e-9, t);
    assert.equal(Math.max(r.probs.T1, r.probs.T2, r.probs.T3), r.probs[r.tier], t);
  }
});

test("T1: navigation and skills", () => {
  assert.deepEqual(route("open software", ctx).action, { kind: "open-dept", slug: "software" });
  assert.deepEqual(route("Open the Cybersecurity department", ctx).action, { kind: "open-dept", slug: "security" });
  assert.deepEqual(route("show routines", ctx).action, { kind: "show", target: "routines" });
  assert.deepEqual(route("show my directives", ctx).action, { kind: "show", target: "directives" });
  assert.deepEqual(route("/weekly-review now", ctx).action, { kind: "skill", name: "weekly-review" });
  assert.deepEqual(route("find Servo Notes", ctx).action, { kind: "find", query: "Servo Notes" });
  for (const t of ["open software", "show routines", "/weekly-review", "find servo notes"]) assert.equal(route(t, ctx).tier, "T1", t);
});

test("money rule: a work keyword after an open/show verb stays T1", () => {
  for (const t of ["open the audit report", "show the build log", "find the deploy plan", "please open the research notes", "can you show the design doc"]) {
    const r = route(t, ctx);
    assert.equal(r.tier, "T1", t);
    assert.ok(r.probs.T3 < 0.05, `${t} T3=${r.probs.T3}`);
  }
});

test("T3 only for a leading work instruction", () => {
  for (const t of ["build a landing page for my app", "please fix the login bug in car finder", "can you write a README for api bible", "audit my repo for secrets", "Refactor the router module"]) {
    assert.equal(route(t, ctx).tier, "T3", t);
  }
  // Negative controls: the same words, not as an instruction, must not buy a paid run.
  for (const t of ["what does build mean?", "is the audit done", "how do I deploy this?", "the build is broken", "audit", "build?", "why did you write that"]) {
    assert.notEqual(route(t, ctx).tier, "T3", t);
  }
});

test("T2: questions and unclear text", () => {
  for (const t of ["what is a servo?", "explain memory types", "show me how to deploy", "find out why it failed", "hmm ok"]) {
    assert.equal(route(t, ctx).tier, "T2", t);
  }
});

test("hostile input is bounded and fast", () => {
  const nasty = ["please ".repeat(20000), "a".repeat(200000), "open " + " the".repeat(50000), "/" + "a-".repeat(50000), "\u0000\n\t".repeat(10000)];
  for (const t of nasty) {
    const start = performance.now();
    const r = route(t, ctx);
    assert.ok(performance.now() - start < 50, "took too long");
    assert.ok(r.reason.length < MAX_INPUT + 40);
  }
  assert.equal(route(undefined as unknown as string, ctx).tier, "T2");
});
