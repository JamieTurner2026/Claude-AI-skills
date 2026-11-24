# os

Dashboard app and bridge server for the JDOLLA$ vault. Phase 2.

```
npm install     # zod, typescript, @types/node
npm start       # bridge on http://127.0.0.1:4317 (port from .env)
npm run open    # opens the dashboard in your browser, signed in
npm run check   # type check
npm test        # tests
npm run doctor  # is this PC ready? PASS/WARN/FAIL per check, each with the PC-SETUP section that fixes it
npm run smoke   # after every update: the real bridge on a temp copy of the vault, fake CLI, no cost, PASS/FAIL per step
```

- `shared/` contract types and the three-tier router (no dependencies).
- `bridge/` server, indexer, guards. Listens on 127.0.0.1 only; every `/api` route needs a signed session.
- `app/` dashboard, plain TypeScript served with types stripped. One file per widget in `app/widgets/`.
- `config/os.config.json` owner settings, run caps (T2 $0.05, T3 $2) and the widget layout.

## Runs (step f)
Press Enter on a question (T2) or a work request (T3). T2 starts at once; T3 asks first because it costs more.
- Runs use the Claude Code CLI (`claude`, or `claude.exe` on Windows; set `engine.claudeBin` in the config if it is elsewhere).
- Every run: `--restricted --strict-mcp-config`, a spend cap, deny rules for `.env`, `os/`, `.claude/`, `logs/`, `.git/`. T2 can only read. T3 can write only in `outputs/_work/<id>/`, and its files are copied to `outputs/YYYY-MM/`.
- Costs and decisions are logged to `router.jsonl` in the log folder.

## Containment (step g)
- `config/skills.policy.json` lists the tools a T3 run may use (`defaultTools`) and extra tools per skill, by exact name. T2 is always read-only. A missing or broken policy refuses every run.
- The vault's `.claude/settings.json` deny rules are restated with absolute paths for every run; a missing or broken file refuses the run.
- Bash is only offered inside Claude Code's sandbox (macOS; Linux or WSL2 with bubblewrap and socat). Native Windows has no sandbox, so Bash runs are refused there. The run settings also set `failIfUnavailable` and turn off unsandboxed retries.
- Blocked tool calls show on the run in the Runs widget and in `router.jsonl`.

Needs Node 22.18 or newer (it runs TypeScript directly, no build step).

## Routines (Phase 4)
- Switch routines on or off in the dashboard's Routines widget (it rewrites `routines/routines.json`). Run now starts one immediately.
- They run on their own only while the bridge runs with `SUPEROS_SCHEDULER=on` in `os/.env` (set it to `off` to stop all scheduled runs).
- Money: all routines together stop at `engine.routines.dailyCapUsd` ($2/day); each routine's `budgetUsd` is at most `engine.routines.maxBudgetUsd` ($1).
- The ledger `routine-ledger.json` in the log folder records each attempt before it starts and each day's spend.

## Second brain in runs
- Every run gets one MCP server, `superos-brain` (`brain/mcp.ts`, shipped with the bridge), with only its two read-only tools pre-approved: `search` and `get_note`. `--strict-mcp-config` keeps every other server out; file tools are never pre-approved.
- Before each run the index (`%USERPROFILE%\.superos\brain\index.sqlite`, or `~/.superos/brain/`) is rebuilt if it is missing or over 5 minutes old. If that fails the run still goes ahead, without the brain, and `brain-index-failed` is logged.
- Turn it off with `engine.brain.enabled: false` in `config/os.config.json`.
- **Usage (7c):** each `get_note` appends `{t, path}` to `usage.jsonl` beside the index: the resolved note path and the time only, never the query, arguments or text. Capped at 512 KB with one rotated copy (`usage.1.jsonl`); `SUPEROS_BRAIN_USAGE=off` stops it. `npm run brain -- usage [--json]` shows the most-used and never-used wiki notes. The vault generators read it (read only) and end each department-index line with "· last used <day>" or "· never used".

## Sources under every claim (Phase 7e)
- `RunInfo.toolsUsed` and `notesOpened` come from the CLI's `tool_use` events. The brain hint (`bridge/brain-link.ts`) asks every run to name the vault note (path or `[[link]]`) for each claim it takes from the vault.
- `bridge/learning.ts`, in the same end listener as the failure checks: a done, ordinary T2 run (not a diagnosis, not inbox triage, not `NOTHING_NEW`) that used `mcp__superos-brain__search` or `get_note` and whose answer names no vault path or `[[link]]` (`namesVaultSource`) gets a proposal of kind `uncited`. No diagnosis run and no cost; for a skill the proposal carries the rule "Name the vault note (path or [[link]]) for every claim you take from the vault." Approve appends it once (never twice); Reject changes nothing. A failure or blocked tool calls take priority, so there is one proposal per run.
- `engine.learning.citations.enabled` (default `true`) switches it off; `engine.learning.enabled: false` turns the whole loop off.

## Inbox triage (Phase 6e)
- `bridge/inbox.ts`: **Sort inbox** (in the Proposals widget) starts one read-only T2 run at $0.05, outside the routine cap. The prompt holds up to 25 inbox file names, sizes and their first 800 characters, fenced as untrusted data (reusing `fence` from `brain/present.ts`), plus the department slugs and their existing `raw/<dept>/<topic>/` folders. Dot-files, `.env*`, links, folders, `README.md` and files over 1 MB are skipped.
- The run answers in JSON `[{file, dept, topic, reason}]`. `parseMoves` (zod) keeps an entry only if the file was offered, the department is known and the topic is a slug; junk gives no proposals.
- Each kept entry is a learning-loop proposal of kind `move` (`bridge/learning.ts`, same store, routes and decided-once rules; no diagnosis run). Approve calls `moveIntoRaw`: it re-checks the proposal, then moves one regular file from `inbox/` into `raw/<known dept>/<slug>/` (real paths, no links, folders made only there, `-v2` on a name clash, never an overwrite, never out of `raw/`), logs `kind: "inbox-move"`, rebuilds the generated files and marks the brain index stale.
- `GET /api/inbox`, `POST /api/inbox/sort`, behind the same session, origin and `x-superos` checks.

## Skill runner (Phase 6c)
- `bridge/skills.ts` lists `skills/<name>/SKILL.md`: name and description from the frontmatter, tier and suggested budget from the "Tier: **T2" and "budget: **$0.25" lines. An unreadable line shows "unknown" and defaults to T2 and $0.05. Links, odd folder names and files over 64 KB are never run.
- `GET /api/skills` and `POST /api/skills/:name/run` (body `{ input?, confirm? }`, input up to 500 characters) sit behind the same session, origin and `x-superos` checks as the other writes. Names must match the skill slug pattern.
- The run is `RoutineRunner.runSkill`, the same path as a routine's Run now: the skill's own budget (refused if above `engine.routines.maxBudgetUsd`), the shared daily routine cap, containment, the bridge-written report in `reports/` (T2) and the learning loop. A T3 skill needs `confirm: true` first (the route answers 409 with `needsConfirm` and `capUsd`). A run that would break the daily cap is refused before it asks.
- Skill runs have no routine id and are booked as `skill:<name>` in the ledger, so they never mark a scheduled routine as done.
- `config/skills.policy.json` has an entry by name for each of the seven department agents: default tools only, no Bash, default script tools (`today`).

## Vault generators (Phase 6a)
```
npm run vault -- build --dry-run   # show what would be written, write nothing
npm run vault -- build             # write it
```
- `vault/generate.ts` (pure functions plus `buildAll(paths, now)`) builds `wiki/_master-index.md`, `wiki/<dept>/_index.md`, `reports/_index.md`, `projects/<slug>.md` (one hub per `type: project` note) and `daily/YYYY-MM-DD.md` (the day in `timezones[0]`).
- Every file starts with `<!-- generated by os/vault: do not hand-edit -->` and is written only when its content changed (temp file plus rename). A file without the marker is left alone; the old hand-made `_index.md` files that say "Generated. Do not hand-edit." are replaced once.
- A daily note's `## Notes` line and everything below it is Jay's and is kept byte for byte. If it is missing, it is added once at the end.
- Writes only under `wiki/`, `reports/`, `projects/`, `daily/`, after resolving real paths (a link out is refused). Copies only file names, titles and dates, never bodies; never reads `.env*`, `os/` or `logs/`; never deletes.
- The bridge runs it once at start and every 30 minutes (`npm start` only), and `POST /api/vault/rebuild` runs it on demand behind the same session, origin and header checks as the other writes. A failure goes to `router.jsonl` and never stops the bridge.

## Router evals (7d)
```
npm run eval:router              # accuracy per tier, confusion table, every wrong pick
npm run eval:router -- --json    # the same as JSON on stdout
npm run eval:router -- --file <path>   # another set
```
- Reads `../evals/router/requests.json` (`{ id, text, tier, dept?, note?, tags? }`; tier is what the request *should* get) and the vault's departments (the same `buildState` the bridge uses), then runs each request through the real `route()`.
- Prints under-routed T3 (work that got a thin answer) and over-routed T3 (a paid run nobody needed) separately.
- Reads only, writes only to stdout, no network, no cost. A malformed set (unknown tier, duplicate id, empty text, unknown field or dept) exits 1 and lists every problem.
- Code: `shared/router-eval.ts` (pure loader and scorer) and `shared/router-eval-cli.ts`.

Setting up on the PC: see `../docs/PC-SETUP.md`.

## Learning loop (Phase 5)
- `bridge/learning.ts`. A run that ends `failed` (including at its budget cap), or with blocked tool calls, gets a proposal in `proposals/`. Stopped runs and the loop's own diagnosis runs never get one. Only one proposal per subject and kind per day.
- A read-only T2 diagnosis drafts the fix, the lesson and a skill rule as JSON. `engine.learning.diagnosisBudgetUsd` ($0.05) is reserved before it starts, and all diagnoses stop at `engine.learning.dailyCapUsd` ($0.25/day). The ledger is `learning-ledger.json` in the log folder.
- `GET /api/proposals`, `POST /api/proposals/:id/approve|reject` sit behind the same session, origin and header checks. Approving is append-only: a new `wiki/_learnings/<id>.md` and one bullet under `## Learned rules` in the skill.
- Switch it off with `engine.learning.enabled: false`.

## Red team (11a)
- `bridge/redteam.test.ts` pushes one hostile fixture (`shared/hostile.ts`) through every untrusted door and checks it stays inert; `npm run redteam:ui` checks the dashboard in Chromium. Door-by-door results: `docs/LEARNINGS.md`.

## Update (9a)
- `npm run update`: clean git tree, then `git pull --ff-only` (never merge, rebase, reset or force), then `npm ci`, `npm run doctor`, `npm run smoke`; one PASS/FAIL line per step, stops at the first FAIL. No shell; npm runs as `node npm-cli.js`. Logic: `bridge/update.ts`. PC-SETUP §2.

## CI (9a)
- `.github/workflows/superos.yml` runs `npm ci`, `npm run check`, `npm test`, `npm run eval:router` and `npm run smoke` on Linux and Windows for every PR and push to main that touches `JDOLLA/SuperOS/`. No secrets; the fake CLI only. It cannot check claude.exe, sign-in or Task Scheduler: those stay in PC-SETUP §14.

## Vault backup (Phase 9c prep)
- `backup/` commits an allowlist of vault content to the vault's own git repo and pushes it to the one private GitHub repo named in `engine.backup.remote`. Off until Jay sets it up (PC-SETUP §10.1). `npm run backup -- --dry-run` lists what would go. Refuses the public repo and any vault inside a repo that points at it. Routine `vault-backup` is a built-in routine kind: no model, $0.

- The vault-cleanup report has a `## Backups` section from the read-only tool `backup_status` (last result, days since the last success, a warning after 3 days). `npm run doctor` has a `Vault backup` row (own repo, remote named, remote passes `checkRemote`; files only, no network).

## Setup checklist
- `GET /api/setup` and the **Setup checklist** widget: Jay's list for the PC as rows (done / todo / manual) with the PC-SETUP section to follow. Logic in `bridge/setup.ts`, widget in `app/widgets/setup.ts`. Reads the doctor's checks and a few file checks only; shows states, never paths or content. Manual ticks are per browser (localStorage).

## Status check (Phase 9b)
- `GET /api/health` (session required) reports version, uptime, scheduler, routines on, spend vs cap, last run, brain index age, embeddings and pending proposals. `npm run status` prints it (exit 0 running, 1 not running, 2 unusable answer). The dashboard's Health strip shows it. Logic: `bridge/health.ts`, `bridge/status.ts`, `shared/health.ts`. No tray icon.

## Offline sources (Phase 8 prep)
- `sources/` holds the `MailSource` and `CalendarSource` interfaces and `FileSource`, which reads `inbox/_feeds/mail.json` and `calendar.json`. Nothing connects to an account or the network. Feed text is other people's words: cleaned to one line, fenced as untrusted data in tool answers, reduced to inert plain text in the daily note. Tools `calendar_today` and `mail_brain` return names and subjects only.

## Run analysis (Phase 10b)
- `npm run analyse:runs -- [--days 30]` (`analysis/cli.ts`) prints spend, failure rates, costliest requests (80 characters), blocked calls and cap hits from `router.jsonl`. Read-only. `analysis/run-stats.ts` is the pure core (tolerant reader, stats, suggestion rules); the `run_stats {days}` tool and `POST /api/analysis/suggest` use it.
- Suggestions become `tune` proposals: fixed text, no model run, 3 a week, no repeats for 28 days. Approving records the decision only; edit config yourself.

## Vault tools (Phase 6d)
- Four read-only tools beside `today`, one module and test each in `tools/`: `recent_changes`, `link_check`, `vault_stats`, `list_reports`. Inputs are zod `.strict()`; results are names, titles, dates and counts, capped, never a note body.
- `tools/vault.ts` is the one place that touches the vault: known top-level folders only, links never followed, dot entries and `.env*` skipped, `os/`, `logs/`, `raw/sessions/` and `outputs/_work/` never scanned. A `dept` argument must match a real `depts/<slug>.md`; no tool takes a path. `link_check` looks targets up in the scanned file set, never on disk. It is self-contained (node and zod only), so the tools server starts light.
- The bridge passes `SUPEROS_VAULT` to the tools server (`ToolContext.vault`). The default script tools stay `["today"]`; `config/skills.policy.json` grants the others to the skills that need them, by name (`scriptTools` per skill).

## Safe tools (WAT "tools")
- `tools/`: one module per tool (zod input, plain function, no shell, no paths from the caller), listed in `tools/registry.ts`, served by `tools/mcp.ts` as `superos-tools`.
- Each run gets only the tools its policy names (`scriptTools` in `config/skills.policy.json`; unknown names refuse every run), pre-approved as `mcp__superos-tools__<name>`.
- To add a tool: write `tools/<name>.ts` and its test, add it to `TOOLS` and `SCRIPT_TOOL_NAMES`, then allow it by name. Switch the layer off with `engine.tools.enabled: false`.
