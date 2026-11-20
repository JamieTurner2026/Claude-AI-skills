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
| 4 | Scheduler, routines, $1/day cap | `os/bridge/routine-runner.ts` |
| 5 | Learning loop (proposals Jay approves) and the safe tools layer (`today`) | `os/bridge/learning.ts`, `os/tools` |
| — | Seven department agents as inert skill drafts | `skills/` |

## Phase 6: the daily OS (now)
Make the vault keep itself current and let Jay use every skill from the dashboard.

| Step | What | Builder | Folders |
|---|---|---|---|
| 6a | **Vault generators:** `_master-index`, department `_index` files, `reports/_index`, project hubs, the generated top half of each daily note | Branch 2: **done** (PR #15) | `os/vault/`, small hook in `server.ts` |
| 6b | **Session import:** Claude Code transcripts and the claude.ai export go into `raw/sessions/`, redacted, then indexed as untrusted | Branch 3: **done** (PR #13) | `os/brain/` |
| 6c | **Skill runner:** a Skills widget lists every skill in `skills/`, with tier, budget and a Run button. It is the same run path as Run now on routines, so all caps and containment apply. Each department agent gets a policy entry by name | Branch 2 (started) | `os/bridge`, `os/app`, `os/config/skills.policy.json` |
| 6d | **More safe tools**, each read-only with tests: `recent_changes` (notes changed in N days), `link_check` (broken `[[links]]`), `vault_stats` (counts, notes without sources), `list_reports` | Whichever builder is free first | `os/tools/` only |
| 6e | **Inbox triage:** a T2 run proposes where each `inbox/` file belongs. The proposals use the Phase 5 widget with a new "move" kind, and the bridge moves files only on Approve | Branch 2, after 6c | `os/bridge/learning.ts`, `os/app` |

## Phase 7: a sharper second brain
| Step | What | Builder |
|---|---|---|
| 7a | **Local embeddings:** hybrid search (FTS5 plus vectors) with a small local model, no cloud calls. If the model can't load, search falls back to keywords alone | Branch 3, after 6b |
| 7b | **Brain evals:** a question set in `evals/` with expected notes; `npm run brain -- eval` reports hit rate. Run before and after 7a to prove it helped | Branch 3, with 7a |
| 7c | **Freshness:** `last_used` updated when a run opens a note; vault-cleanup flags stale and never-used notes | Branch 3 |
| 7d | **Router evals:** a labelled set of requests checked against the three-tier router, so routing changes are measured | Whichever builder is free first |

## Phase 8: outside sources (each needs Jay's yes to connect)
- **8a Gmail, read-only:** only the "Brain" label, imported as untrusted `raw/` notes. Drafts only; nothing is sent.
- **8b Google Calendar, read-only:** today's events go into the daily note and `plan-today`.
- **8c Morning page:** `morning-intel` uses 8a and 8b. It stays report-only.
Blocked until Jay names the label and connects Calendar.

## Phase 9: the PC
- **9a Windows checks:** Jay runs PC-SETUP section 11; each result becomes a fix task.
- **9b Start with Windows:** the bridge starts at login, with a tray or status check.
- **9c Backups:** the vault's own private git repo, committed nightly by a routine; a vault note never goes into this public repo.
Blocked on the PC session.

## Phase 10: learning loop v2
- A weekly review of approved and rejected proposals, written as a report.
- `router.jsonl` analysis: which tiers cost the most and which runs fail most, plus suggested routing and budget changes. These arrive as proposals and are never applied on their own.

## Queue
- **Branch 2:** ~~6a~~ → 6c (now) → 6e
- **Branch 3:** ~~6b~~ → 7a + 7b (waiting for Jay's OK in its chat) → 7c
- **Free slot:** 6d, then 7d
- **Waiting on Jay:** Phase 8 (Gmail label, Calendar), Phase 9 (PC session), the private Brain repo name, PR #1
