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
| — | Seven department agents as inert skill drafts | `skills/` |

## Phase 6: the daily OS (now)
Make the vault keep itself current and let Jay use every skill from the dashboard.

| Step | What | Builder | Folders |
|---|---|---|---|
| 6a | **Vault generators:** `_master-index`, department `_index` files, `reports/_index`, project hubs, the generated top half of each daily note | Branch 2: **done** (PR #15) | `os/vault/`, small hook in `server.ts` |
| 6b | **Session import:** Claude Code transcripts and the claude.ai export go into `raw/sessions/`, redacted, then indexed as untrusted | Branch 3: **done** (PR #13) | `os/brain/` |
| 6c | **Skill runner:** a Skills widget lists every skill in `skills/`, with tier, budget and a Run button. It is the same run path as Run now on routines, so all caps and containment apply. Each department agent gets a policy entry by name | Branch 2: **done** (PR #17) | `os/bridge`, `os/app`, `os/config/skills.policy.json` |
| 6d | **More safe tools**, each read-only with tests: `recent_changes` (notes changed in N days), `link_check` (broken `[[links]]`), `vault_stats` (counts, notes without sources), `list_reports` | Branch 2, after 6e | `os/tools/` only |
| 6e | **Inbox triage:** a T2 run proposes where each `inbox/` file belongs. The proposals use the Phase 5 widget with a new "move" kind, and the bridge moves files only on Approve | Branch 2 (started) | `os/bridge/learning.ts`, `os/app` |

## Phase 7: a sharper second brain (next; planned 2026-11-20)
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
Blocked until Jay names the label and connects Calendar.

## Phase 9: the PC
- **9a Windows checks:** Jay runs PC-SETUP §14 (Windows checks); each result becomes a fix task.
- **9b Start with Windows:** the bridge starts at login, with a tray or status check. Prep built 2026-11-22: `npm run autostart` (per-user Task Scheduler task, untested on Windows). Still open: the tray or status check.
- **9c Backups:** the vault's own private git repo, committed nightly by a routine; a vault note never goes into this public repo.
Blocked on the PC session.

## Phase 10: learning loop v2
- ~~10a~~ A weekly review of approved and rejected proposals, written as a report. Built 2026-11-21: skill draft `skills/proposals-review`, routine `proposals-review` (Sundays 17:00, ships off), read-only tool `proposals_summary`.
- `router.jsonl` analysis: which tiers cost the most and which runs fail most, plus suggested routing and budget changes. These arrive as proposals and are never applied on their own.

## Queue
- **Branch 2:** ~~6a~~ → ~~6c~~ → 6e (now) → 6d → 7d → 7e
- **Branch 3:** ~~6b~~ → 7b → 7a → 7c (waiting for Jay's OK in its chat)
- **Main session:** review and merge each PR, keep this file and the Brain page current
- **Waiting on Jay:** Phase 8 (Gmail label, Calendar), Phase 9 (PC session), the private Brain repo name, PR #1
