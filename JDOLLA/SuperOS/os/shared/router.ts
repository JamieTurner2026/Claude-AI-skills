// Three-tier classifier. Pure and dependency-free: it runs on every keystroke in the browser
// and again on the bridge before anything is started.
//
//   T1  instant, no AI      open / show / find, /skill-name, "show routines", "open <dept>"
//   T2  quick answer        a cheap read-only model call
//   T3  real work           a paid run that may edit files
//
// Cost rule: a wrong T1 costs a toast; a wrong T3 costs a paid run. So T3 needs a clear work
// request (an instruction that leads the sentence), never just a keyword somewhere in it.
// "open the audit report" is T1 even though "audit" is a work word.

import type { RouteContext, RouteResult, T1Action, Tier } from "./types.ts";

/** Typed text is untrusted: cap it before any regex sees it. */
export const MAX_INPUT = 500;

const POLITE = /^(?:please |pls |hey |ok |okay |so |now |can you |could you |would you |will you |i need you to |i want you to |i'd like you to |let's |lets |go ahead and ){0,3}/;

/**
 * Text never picks its own tier: a leading "T1:" label, or an "ignore the router / previous
 * instructions and ..." clause, is stripped before judging, so only the request itself counts.
 */
const SELF_ROUTING = /^(?:(?:run (?:this|it) )?(?:as |on )?t[123]\s*[:,-]\s*|ignore (?:all |any )?(?:the router|(?:your |the |all )?(?:previous |prior |above )?(?:instructions|rules))(?: and| then|,)?\s+(?:(?:run (?:this|it) )?(?:as |on )?t[123]\s*[:,-]\s*)?)/;

/** A work request that would break a vault rule (raw/ is append only; .env is never touched) is answered, never run. */
const FORBIDDEN_WORK = /\b(?:delete|remove|wipe|erase|clear|overwrite|edit|rewrite|rename)\b.*(?:\braw\/|\.env\b)/;

/** Things Jay asks to have made. "need a README", "moodboard for ...": work without a leading verb. */
const DELIVERABLES = new Set([
  "readme", "doc", "docs", "document", "moodboard", "pitch", "checklist", "brief", "report", "script",
  "draft", "outline", "spec", "mockup", "deck", "prototype", "sim", "simulation", "storyboard", "proposal",
]);
const NEED_DELIVERABLE = /^(?:i )?(?:need|want) (?:a |an |the |some |new |a new )?([a-z]+)\b/;
const LEADING_DELIVERABLE = /^([a-z]+) (?:for|of|about|on) /;

/** "..., can you look into it": a statement that ends by asking for the work. */
const TRAILING_REQUEST = /(?:^|[,.;!] ?| )(?:can|could|would|will) you (?:please )?(?:look into|fix|sort|handle|investigate|debug|take care of|deal with) (?:it|this|that)(?: out)?[?.!]*$/;

/** "open a PR / a new issue": open meaning create, not navigation. */
const OPEN_TO_CREATE = /^open (?:a |an |new |a new )(?:pr|pull request|issue|branch|ticket)\b/;

const T1_VERBS = ["open", "show", "find", "list", "go to", "goto", "view", "search", "where is", "where's"] as const;

const WORK_VERBS = new Set([
  "build", "create", "make", "write", "draft", "fix", "refactor", "implement", "generate", "design",
  "deploy", "audit", "research", "analyze", "analyse", "plan", "set", "add", "update", "rewrite",
  "review", "test", "debug", "migrate", "convert", "summarize", "summarise", "translate", "scaffold",
  "organize", "organise", "clean", "optimize", "optimise", "automate", "install", "configure", "edit",
  "remove", "delete", "rename", "compare", "investigate", "prepare", "produce", "develop", "code",
  "ship", "publish", "document", "scan", "import", "export", "train", "model", "render", "compose",
  "simulate",
]);

const QUESTION_WORDS = new Set([
  "what", "whats", "what's", "why", "how", "when", "who", "whom", "which", "where", "is", "are", "was",
  "were", "do", "does", "did", "can", "could", "should", "would", "will", "explain", "define", "tell",
  "describe", "remind",
]);

const SHOW_TARGETS: Record<string, "routines" | "directives" | "departments" | "apps"> = {
  routines: "routines", routine: "routines", schedule: "routines",
  directives: "directives", directive: "directives", todos: "directives", tasks: "directives",
  departments: "departments", depts: "departments", department: "departments",
  apps: "apps", app: "apps",
};

function softmax(scores: Record<Tier, number>): Record<Tier, number> {
  const max = Math.max(scores.T1, scores.T2, scores.T3);
  const e1 = Math.exp(scores.T1 - max), e2 = Math.exp(scores.T2 - max), e3 = Math.exp(scores.T3 - max);
  const sum = e1 + e2 + e3;
  return { T1: e1 / sum, T2: e2 / sum, T3: e3 / sum };
}

function result(scores: Record<Tier, number>, reason: string, action?: T1Action): RouteResult {
  const probs = softmax(scores);
  const tier: Tier = probs.T1 >= probs.T2 && probs.T1 >= probs.T3 ? "T1" : probs.T3 > probs.T2 ? "T3" : "T2";
  const out: RouteResult = { tier, probs, reason };
  if (tier === "T1" && action) out.action = action;
  return out;
}

function matchDept(rest: string, ctx: RouteContext): string | undefined {
  const cleaned = rest.replace(/^(?:the |my )/, "").replace(/ (?:department|dept|router)$/, "").trim();
  if (!cleaned) return undefined;
  for (const d of ctx.depts) {
    if (cleaned === d.slug || cleaned === d.name.toLowerCase()) return d.slug;
  }
  for (const d of ctx.depts) {
    // First word of the department name, e.g. "software" or "cybersecurity".
    const first = d.name.toLowerCase().split(/[ ,&]+/, 1)[0];
    if (first && first.length > 3 && cleaned === first) return d.slug;
  }
  return undefined;
}

export function route(input: string, ctx: RouteContext = { depts: [] }): RouteResult {
  const text = String(input).slice(0, MAX_INPUT).replace(/\s+/g, " ").trim();
  if (!text) return result({ T1: 2, T2: 0, T3: -2 }, "Type a request.");

  // /skill-name
  const slash = /^\/([a-z0-9][a-z0-9-]{0,39})(?: |$)/i.exec(text);
  if (slash?.[1]) {
    return result({ T1: 6, T2: 0, T3: 0 }, `Skill /${slash[1].toLowerCase()}.`, { kind: "skill", name: slash[1].toLowerCase() });
  }

  const lower = text.toLowerCase();
  let body = lower;
  // Strip politeness and any self-routing label, in either order, so only the request is judged.
  for (let i = 0; i < 3; i++) {
    const before = body;
    body = body.slice(POLITE.exec(body)?.[0].length ?? 0);
    body = body.slice(SELF_ROUTING.exec(body)?.[0].length ?? 0);
    if (body === before) break;
  }
  if (!body) return result({ T1: 0, T2: 2.5, T3: 0.5 }, "Not clearly work: quick answer.");
  const words = body.split(" ");
  const first = (words[0] ?? "").replace(/[^a-z']/g, "");

  // Work that would break a vault rule is answered, never run, whatever verb leads it.
  if (FORBIDDEN_WORK.test(body)) return result({ T1: -2, T2: 4, T3: 0 }, "That would break a vault rule: quick answer.");

  if (OPEN_TO_CREATE.test(body)) return result({ T1: -2, T2: 1, T3: 4 }, "Looks like real work: a full run.");

  // A bare dashboard list name ("apps", "my routines") means show it.
  const bare = SHOW_TARGETS[body.replace(/[.!]+$/, "").replace(/^(?:the |my |all |today's |todays )+/, "")];
  if (bare) return result({ T1: 6, T2: 0, T3: -2 }, `Show ${bare}.`, { kind: "show", target: bare });

  // T1: a leading open/show/find verb wins over any later keyword.
  for (const verb of T1_VERBS) {
    if (body === verb || body.startsWith(verb + " ")) {
      const rest = body.slice(verb.length).replace(/[?.!]+$/, "").trim();
      const original = text.slice(text.length - body.length + verb.length).replace(/[?.!]+$/, "").trim();
      const slug = matchDept(rest, ctx);
      if (slug) return result({ T1: 6, T2: 0, T3: -2 }, `Open the ${slug} department.`, { kind: "open-dept", slug });
      const target = SHOW_TARGETS[rest.replace(/^(?:the |my |all |today's |todays )+/, "")];
      if (target) return result({ T1: 6, T2: 0, T3: -2 }, `Show ${target}.`, { kind: "show", target });
      const finding = verb === "find" || verb === "search" || verb.startsWith("where");
      // "show me how to ..." / "find out why ..." are questions, not navigation.
      if (/^(?:me )?(?:how|why|what|out )/.test(rest)) break;
      if (!rest) return result({ T1: 3, T2: 1, T3: -2 }, "Open what?");
      return result({ T1: 5, T2: 1, T3: -1 }, finding ? `Find "${original}".` : `Open "${original}".`,
        finding ? { kind: "find", query: original } : { kind: "open", query: original });
    }
  }

  const isQuestion = text.endsWith("?") || QUESTION_WORDS.has(first);
  const leadsWithWork = WORK_VERBS.has(first);
  const wordCount = words.length;

  // Short work whose only object is a pronoun ("make it pop", "fix it") is too vague to buy a run: ask first.
  if (leadsWithWork && wordCount <= 3 && /^(?:it|them)$/.test(words[1] ?? "")) {
    return result({ T1: -2, T2: 3, T3: 1 }, "Too vague to run: a quick reply asks what you mean.");
  }

  // T3 needs the instruction to lead the sentence and have something to act on.
  if (leadsWithWork && wordCount >= 2 && !text.endsWith("?")) {
    const strength = wordCount >= 4 ? 4 : 2.5;
    return result({ T1: -2, T2: 1, T3: strength }, "Looks like real work: a full run.");
  }
  // Work without a leading verb: "need a README for ...", "moodboard for ...", "..., can you look into it".
  const needed = NEED_DELIVERABLE.exec(body)?.[1] ?? LEADING_DELIVERABLE.exec(body)?.[1];
  if ((needed && DELIVERABLES.has(needed)) || TRAILING_REQUEST.test(body)) {
    return result({ T1: -2, T2: 1, T3: 3 }, "Looks like real work: a full run.");
  }
  if (isQuestion) return result({ T1: -1, T2: 4, T3: 0.5 }, "A question: quick answer.");
  // Unclear requests default to the cheap tier, never the paid one.
  return result({ T1: 0, T2: 2.5, T3: 0.5 }, "Not clearly work: quick answer.");
}
