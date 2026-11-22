# Roadmap

How the build continues after Phase 5, and who builds what. The main session plans, reviews and merges. Branch 2 and branch 3 build in parallel, each kept to its own folders so their work never collides. Updated 2026-11-20.

## How the build runs
- **Main session (planner):** keeps this file current. It writes each task as a brief, checks every PR (fresh clone, `npm run check`, `npm test`, diff stays inside its folders) and merges what passes, under Jay's standing approval of 2026-11-20.
- **Branch 2 and branch 3 (builders):** one task at a time. Each task gets a fresh branch from `main`, tests with a negative control, one deliberately broken guard, a draft PR and a report back. A builder never edits another builder's folders.
- **Needs Jay's own yes, always:** anything that leaves the PC or the repo (sending, posting, buying, deleting, publishing), connecting accounts or connectors, real secrets, and runs over $1.
- **Spending in the cloud:** real runs only on throwaway vault copies, capped, and reported with their cost.

## Done
| Phase | What | Where |
|---|---|---|
| 1 | Vault layout, routers, seed content | vault |
| 2 | Bridge, dashboard, runs, containment | `os/bridge`, `os/app` |
| 3 (part) | Search index and the `superos-brain` MCP server, wired into every run | `os/brain` |
| 4 | Scheduler, routines, daily cap (now $2/day) | `os/bridge/routine-runner.ts` |
| 5 | Learning loop (proposals Jay approves) and the safe tools layer (`today`) | `os/bridge/learning.ts`, `os/tools` |
| 6 | Daily OS: vault generators, session import, skill runner, inbox triage, safe tools (PRs #13–#22) | `os/vault`, `os/bridge`, `os/tools` |
| 7 | Sharper brain: brain and router evals (router 72/72), local meaning search (opt-in), freshness, sources under every claim (PRs #20–#30) | `os/brain`, `shared/router*`, `evals/` |
| — | Seven department agents as inert skill drafts | `skills/` |

## Phase 6: the daily OS (done 2026-11-21)
Make the vault keep itself current and let Jay use every skill from the dashboard.

| Step | What | Builder | Folders |
|---|---|---|---|
| 6a | **Vault generators:** `_master-index`, department `_index` files, `reports/_index`, project hubs, the generated top half of each daily note | Branch 2: **done** (PR #15) | `os/vault/`, small hook in `server.ts` |
| 6b | **Session import:** Claude Code transcripts and the claude.ai export go into `raw/sessions/`, redacted, then indexed as untrusted | Branch 3: **done** (PR #13) | `os/brain/` |
| 6c | **Skill runner:** a Skills widget lists every skill in `skills/`, with tier, budget and a Run button. It is the same run path as Run now on routines, so all caps and containment apply. Each department agent gets a policy entry by name | Branch 2: **done** (PR #17) | `os/bridge`, `os/app`, `os/config/skills.policy.json` |
| 6d | **More safe tools**, each read-only with tests: `recent_changes` (notes changed in N days), `link_check` (broken `[[links]]`), `vault_stats` (counts, notes without sources), `list_reports` | Branch 2, after 6e | `os/tools/` only |
| 6e | **Inbox triage:** a T2 run proposes where each `inbox/` file belongs. The proposals use the Phase 5 widget with a new "move" kind, and the bridge moves files only on Approve | Branch 2 (started) | `os/bridge/learning.ts`, `os/app` |

## Phase 7: a sharper second brain (done 2026-11-21)
**Goal:** the brain finds the right note, shows a source under every claim, and proves with numbers that it is getting better.

| Step | What | Builder | Done when |
|---|---|---|---|
| 7b | **Brain evals, first:** 25 to 30 invented questions in `evals/brain/questions.json`, each naming the notes that should come back. `npm run brain -- eval [--k 5]` prints hit@k and MRR. | Branch 3 | The keyword-only baseline is recorded in the PR and in STATUS |
| 7a | **Local embeddings:** hybrid search (FTS5 plus vectors from a small CPU model, merged by reciprocal rank fusion), stored in the same sqlite index. The model download is opt-in only (`npm run brain -- index --embeddings`, Jay approved 2026-11-20) and never happens during a run. Files live outside the vault. If the model can't load, search falls back to keywords and logs a note | Branch 3 | 7b shows hybrid beats the baseline; otherwise keyword stays the default and the PR says so |
| 7c | **Freshness:** the brain server records which notes runs open (a usage file next to the index, never a rewrite of Jay's notes). Department indexes and vault-cleanup show stale (over 60 days) and never-used notes | Branch 3 | The cleanup report lists both, from real usage lines |
| 6d | **More safe tools:** `recent_changes`, `link_check`, `vault_stats`, `list_reports` | Branch 2 | Each tool tested, allowed by name |
| 7d | **Router evals:** about 60 labelled requests (T1 quick, T2 question, T3 work); `npm run eval:router` prints per-tier accuracy and every wrong pick | Branch 2 | The scores are recorded; misroutes listed for tuning |
| 7e | **Sources under every claim:** after a T2 run that used the brain, the bridge checks that the answer names at least one vault path. If it doesn't, a learning-loop proposal of kind `uncited` is written (no diagnosis run, no cost) | Branch 2 | Tested; an uncited answer makes a card, a cited one doesn't |

The vault has only 26 notes today, so 7a's gain in the cloud will be small. The real test comes after session import on the PC (Phase 9), so the eval set must be re-run there.

## Phase 8: outside sources (each needs Jay's yes to connect)
- **8a Gmail, read-only:** only the "Brain" label, imported as untrusted `raw/` notes. Drafts only; nothing is sent.
- **8b Google Calendar, read-only:** today's events go into the daily note and `plan-today`.
- **8c Morning page:** `morning-intel` uses 8a and 8b. It stays report-only.
**Status: adapters ready, connect pending Jay.** Built 2026-11-22 (`os/sources/`): `MailSource` and `CalendarSource` interfaces and one `FileSource` that reads `inbox/_feeds/mail.json` and `calendar.json`. The daily note shows "Today's calendar" and "Mail labelled Brain"; two safe tools, `calendar_today` and `mail_brain`, go to `plan-today` and `morning-intel`. No account is connected, nothing uses the network, no token is stored. Still blocked until Jay names the label and connects Gmail and Calendar; a live adapter then implements the same two interfaces. 8a's "imported as `raw/` notes" is not built: the feed only feeds the daily note and the tools. File format: PC-SETUP §13.2.

## Phase 9: the PC
- **9a Windows checks:** Jay runs PC-SETUP §14 (Windows checks); each result becomes a fix task. Prep built 2026-11-22: `npm run doctor` prints pass/warn/fail with the PC-SETUP section to fix (PR #32); after every update, `npm run smoke` (PC-SETUP §9.1).
- **9b Start with Windows:** the bridge starts at login, with a tray or status check. Prep built 2026-11-22: `npm run autostart` (per-user Task Scheduler task, untested on Windows; PR #33). Status check built 2026-11-22: `GET /api/health`, `npm run status` and a Health strip on the dashboard (PR #37; PC-SETUP §9.2). Still open: a tray icon (Windows-only, cannot be built or tested in the cloud).
- **9c Backups:** the vault's own private git repo, committed nightly by a routine; a vault note never goes into this public repo.
Blocked on the PC session.

## Phase 10: learning loop v2
- ~~10a~~ A weekly review of approved and rejected proposals, written as a report. Built 2026-11-21: skill draft `skills/proposals-review`, routine `proposals-review` (Sundays 17:00, ships off), read-only tool `proposals_summary`.
- ~~10b~~ `router.jsonl` analysis. Built 2026-11-22 (PR #31): `npm run analyse -- runs`, the read-only `run_stats` tool, and "tune" proposals. Approving a tune only records the decision; Jay edits config himself.
- 10c Learning scorecard: `npm run analyse -- learning` gives proposals per kind (made, approved, rejected, pending), the median days to a decision, and the skills with the most learned rules. Branch 3, queued.

## Jay's list to finish the build (on the PC)
1. `git status` (it must be clean), then `git pull`, then `npm install` in `os/`.
2. `npm run doctor`; fix each fail at the PC-SETUP section it names.
3. `npm run check` and `npm test`; send the pass count (that is 9a).
4. `npm run brain -- index --embeddings` (opt-in, about 420 MB), then `npm run brain -- eval`.
5. Session import (PC-SETUP 5b), then run the eval again.
6. `npm run autostart`, then follow its two printed steps.
7. Decide three things: the private Brain repo name; the Gmail "Brain" label and Calendar connect; whether the cloud allowlist keeps the huggingface hosts.

## Queue
- **Branch 2:** ~~Phase 8 prep~~ (#35) → 9b status check
- **Branch 3:** q30 "what should I do today" fix (waiting for Jay's go in its chat) → 10c
- **Branch 4:** `npm run smoke` and the PC-SETUP rewrite
- **Main session:** review and merge each PR, keep this file and the Brain page current
- **Waiting on Jay:** Phase 8 (Gmail label, Calendar), Phase 9 (PC session: doctor, tests, embeddings, session import, autostart), the private Brain repo name, the cloud allowlist's huggingface hosts, PR #1
