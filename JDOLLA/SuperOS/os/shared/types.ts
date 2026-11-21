// The contract shared by the bridge (Node) and the dashboard (browser).
// Types only, plus small constants: this file must stay free of imports so both sides can load it.

export const TIERS = ["T1", "T2", "T3"] as const;
export type Tier = (typeof TIERS)[number];

/** What a T1 (instant, no AI) request should do. */
export type T1Action =
  | { kind: "open-dept"; slug: string }
  | { kind: "skill"; name: string }
  | { kind: "show"; target: "routines" | "directives" | "departments" | "apps" }
  | { kind: "find"; query: string }
  | { kind: "open"; query: string };

export type RouteResult = {
  tier: Tier;
  /** Probabilities for each tier; they sum to 1. */
  probs: Record<Tier, number>;
  /** Present only when tier is T1. */
  action?: T1Action;
  /** Short plain-English reason, shown under the command bar. */
  reason: string;
};

export type RouteContext = {
  depts: ReadonlyArray<{ slug: string; name: string }>;
};

/** A request to start a run (Phase 2 step f; defined here so the contract is stable). */
export type RunRequest = {
  text: string;
  tier: "T2" | "T3";
  dept?: string;
  maxBudgetUsd?: number;
};

export type Skill = { name: string; description: string };

export type Department = {
  slug: string;
  name: string;
  summary: string;
  skills: Skill[];
  noteCount: number;
};

export type Directive = {
  /** Stable for a given line: "<index>-<hash of text>". */
  id: string;
  text: string;
  done: boolean;
};

export type Routine = { id: string; name: string; schedule: string; enabled: boolean };
export type MicroApp = { id: string; name: string; url: string };

/** A run as the dashboard sees it (mirrors RunInfo in bridge/runs.ts). */
export type RunView = {
  id: string; tier: "T2" | "T3"; text: string; dept: string;
  status: "running" | "done" | "failed" | "stopped";
  startedAt: string; endedAt: string | null; capUsd: number; costUsd: number | null;
  output: string; error: string | null; deliverables: string[]; denied: string[];
  /** The run's final answer, if it finished. */
  result: string | null;
  /** Set when a scheduled routine started the run. */
  routine: string | null;
  skill: string | null;
  purpose: "run" | "diagnosis";
};

/** Routine status as the dashboard sees it (mirrors RoutineStatus in bridge/routine-runner.ts). */
export type RoutinesView = {
  schedulerOn: boolean; timezone: string; today: string; spentTodayUsd: number; dailyCapUsd: number;
  routines: Array<{ id: string; name: string; schedule: string; enabled: boolean; tier: "T2" | "T3"; budgetUsd: number; skill: string | null;
    lastRunAt: string | null; lastResult: { at: string; status: string; costUsd: number | null; runId: string | null; note: string } | null }>;
  problems: string[];
};

/** A skill as the Skills widget sees it (mirrors SkillEntry in bridge/skills.ts, plus its last run). */
export type SkillView = {
  name: string; description: string; tier: "T2" | "T3"; tierKnown: boolean; budgetUsd: number; budgetKnown: boolean; runnable: boolean; problem: string | null;
  lastRunAt: string | null; lastResult: { at: string; status: string; costUsd: number | null; runId: string | null; note: string } | null;
};
export type SkillsView = { skills: SkillView[]; spentTodayUsd: number; dailyCapUsd: number; maxBudgetUsd: number };

/** A learning-loop proposal as the dashboard sees it (mirrors Proposal in bridge/learning.ts). */
export type ProposalView = {
  id: string; createdAt: string; status: "pending" | "approved" | "rejected"; decidedAt: string | null;
  kind: "budget" | "failed" | "blocked" | "move";
  run: { id: string; tier: "T2" | "T3"; dept: string; skill: string | null; routine: string | null; status: string; error: string | null; denied: string[]; costUsd: number | null; capUsd: number; prompt: string };
  whatBroke: string;
  diagnosis: { status: "running" | "done" | "failed" | "skipped"; note: string; runId: string | null; costUsd: number | null };
  fix: string; learning: string;
  skillChange: { skill: string; rule: string } | null;
  applied: { learningNote: string | null; skillFile: string | null; note: string } | null;
  /** Only for kind "move" (inbox triage). */
  move: { file: string; to: string; reason: string; movedTo?: string } | null;
};
/** The inbox as the Proposals widget sees it (mirrors InboxStatus in bridge/inbox.ts). */
export type InboxView = { count: number; skipped: number; max: number; running: boolean; last: { at: string; status: string; suggested: number; note: string } | null };
export type ProposalsView = { proposals: ProposalView[]; spentTodayUsd: number; dailyCapUsd: number; enabled: boolean };

export type LayoutItem = { widget: string; span: 1 | 2 | 3 };

export type OsState = {
  owner: string;
  brand: string;
  timezones: string[];
  generatedAt: string;
  departments: Department[];
  counts: { wiki: number; raw: number; outputs: number };
  directives: Directive[];
  routines: Routine[];
  apps: MicroApp[];
  layout: LayoutItem[];
  /** Problems found while reading the vault, shown on the dashboard rather than hidden. */
  warnings: string[];
};
