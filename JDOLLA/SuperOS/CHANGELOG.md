# Changelog

What changed in JDOLLA$ Super OS, newest first, in plain words. The numbers like #42 are the pull requests on GitHub (`JamieTurner2026/Claude-AI-skills`) where each change was built and checked. What to run on the PC is in [[START-HERE]]; what works and what waits on you is in [[docs/STATUS]].

## 1.0.0 (2026-11-24)

The first full version: everything from Phase 2 to Phase 11, built and tested in the cloud on Linux and Windows with a stand-in for Claude. It has not run on your PC yet ([[START-HERE]] walks you through that).

### Phase 2: the dashboard and the bridge
- Open the dashboard in your browser and type a request. The OS sorts it into T1 (instant, free), T2 (a quick answer) or T3 (real work, asks you first) (#4).
- T2 and T3 requests run Claude Code for you, with live output, the cost against its cap and a Stop button (#6).
- Every run is fenced in: it can't read `.env` files, `os/` or your logs, and Bash only runs inside a sandbox (#8).
- The neon royal-blue look (#23).

### Phase 3: the second brain
- A search index over `wiki/` and `raw/`, with a read-only brain every run can search before it answers (#5, #10).
- Import your Claude Code and claude.ai sessions into `raw/sessions/`, with secrets redacted, as notes the brain treats as data, never instructions (#13).

### Phase 4: routines
- Scheduled routines you switch on in the dashboard, with a daily spending cap shared by all of them (#7, #9). The cap is $2 a day (#18).

### Phase 5: the learning loop
- When a run fails, gets blocked or hits its cap, the OS drafts a proposal: what broke, a fix and a lesson. Nothing changes until you approve it (#12).
- A safe tools layer: runs call named, tested tools instead of typing commands (#12).
- Seven department agents as drafts you can install later (#11).

### Phase 6: the daily OS
- Indexes, a hub per project and today's daily note are written for you; everything under `## Notes` stays yours, byte for byte (#15).
- Run any skill from the Skills widget (#17).
- Sort the inbox: the OS suggests where each file goes in `raw/`, and you approve each move (#19).
- Four read-only vault tools for runs (#22).

### Phase 7: a sharper brain
- Retrieval and routing are measured: a question set for the brain (#20) and 72 labelled requests for the router (#21), which now picks right on all 72 (#24, #25).
- Optional meaning search on your PC: finds notes that say the same thing in other words (#26), kept fresh before runs (#29), without crowding out good keyword hits (#38).
- Notes show when a run last used them, or that none ever has (#28).
- An answer from your notes that names none of them gets a proposal to fix that (#27).

### Phase 8: outside sources (offline so far)
- Mail and calendar feed files: today's events and Brain-labelled mail show in the daily note as plain text, never as instructions (#35).
- Brain-labelled mail can be imported into `raw/mail/`, redacted and marked untrusted (#47).
- The `morning-intel` page is ready; it turns on once feeds or accounts are connected (#46).

### Phase 9: the PC
- `npm run doctor` checks your PC and names the setup step to fix each problem (#32).
- `npm run smoke` checks a copy of the vault after every update, without touching the real one (#34).
- `npm run update` updates safely in one command: it stops if you have local changes, and never merges or forces (#45).
- Start the bridge when you log in (#33). See that it's alive in the Health strip or with `npm run status` (#37).
- Back the vault up to your own private repo. It ships switched off and refuses the public repo (#41, #43).
- A setup checklist on the dashboard (#44) and the one-screen [[START-HERE]] page (#49).
- Every change is now tested on Windows as well as Linux (#42).

### Phase 10: the learning loop, version 2
- A weekly review of the proposals you approved and rejected (#30).
- Run analysis suggests budget and setting changes; approving one only records your decision (#31).
- A scorecard for the learning loop: `npm run analyse:learning` (#40).
- The Proposals widget gets filters, a one-line "why", and keys: j/k to move, a/r to ask, y to confirm (#39).
- `npm run analyse:runs -- --month` and the monthly cost report (off by default), a This month chip (#51).

### Phase 11: hardening
- Red team: hostile text was pushed through every place outside text comes in; five leaks were found and fixed (#50).
- Security updates: zod 4 (#52), and the meaning-search runtime moved to transformers 4.3.2. If meaning search is already set up on your PC, run `npm run brain -- index --embeddings` once after updating (#55).
- Accessibility: every control has a name, focus is easy to see, text is readable, and screen readers hear run output and health warnings without repeats (#54).
