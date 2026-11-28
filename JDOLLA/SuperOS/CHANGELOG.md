# Changelog

What changed in JDOLLA$ Super OS, newest first, in plain words. The numbers like #42 are the pull requests on GitHub (`JamieTurner2026/Claude-AI-skills`) where each change was built and checked. What to run on the PC is in [[START-HERE]]; what works and what waits on you is in [[docs/STATUS]].

## Unreleased

- New skill `/teardown`: use it when creating a machine explainer. It builds a 3D simulator of a real machine as one offline web page (every gauge reads the same model that moves the parts) and records it to a 60 fps video with its own soundtrack. It came from reverse-engineering Elvar's V8 video: it is his open-source kit (MIT) plus a shot-for-shot remake of that film, a camera fitter that measures the camera against the reference instead of guessing (one wide shot went from 0.88 to 0.97 similarity), a resumable renderer for machines without a graphics card and a compare script that makes a side-by-side video. Listed under Creative, Game Development and Industrial (#72).
- `npm run blender:check` (optional) checks the Blender on your PC before any Blender skill relies on it, because your PC has 4.0.2 and some workflows target 5.x. It finds Blender, proves a failing script is reported as one, then measures the version, the default cube, a small render, a `.glb` export and the Eevee engine id. It writes a report that a new doctor row, **Blender (optional)**, reads. `/blender-visuals` now starts with this check, uses only what your version has and looks up the Eevee id instead of guessing (PC-SETUP §3.4).
- `/video-remake` learned a polish loop. Four test frames per pass, problems listed worst first, then fixed. The ship video got shaded sails, smoother jib edges, a calmer reef, puffy clouds and waves that change colour with height. Foam now rides the waves and sits on the hull (it used to sit 1.25 units off). It also has softer shadows, crew with eyes who no longer walk through each other, and new audio: waves, a soft pad and gull calls at the same loudness as the original. The skill records each technique and when not to pay for extra quality: sharper anti-aliasing doubled the render time for little gain.
- New skill `/video-remake`. Give it a video and it either rebuilds it as a 3D web scene that matches shot by shot (rendered, compared and fixed in a loop), makes a better version (people on deck, more detail, real 60 fps), or edits the original so only one thing changes, such as green water. It came from remaking the ship-in-a-bottle comparison video; that project ships inside the skill as the worked example. Listed under Creative and Game Development (#68).
- A note graph for the second brain, built with the index on your PC: no model, no network, no cost. The `related` tool shows a note's neighbours (links to, linked from, cites, same source, same project), the weekly vault cleanup lists orphans and hubs, and `GET /api/brain/graph` gives counts for a later dashboard panel. Search doesn't use it yet: on the eval it didn't help, so the boost is off. `npm run brain -- bench` measures index and search speed on a made-up vault of about 2,700 notes (#66).
- Search now uses the note graph, carefully. It only reorders the top 10 results it already found, lets the top 3 vote for notes they link to (busy hubs like charters count for less), and leaves a clear winner alone. Each search also lists up to 3 linked notes it didn't return, as extra context. It's on because it passed the agreed test: the practice questions got better and none of your 30 questions got worse. The margin is thin, so check `npm run brain -- eval --graph` after importing sessions; `SUPEROS_BRAIN_GRAPH=off` in `.env` turns it off (#67).

## 1.0.1 (2026-11-26)

Small fixes and checks on top of 1.0.0. Still built and tested in the cloud on Linux and Windows with a stand-in for Claude; it has not run on your PC yet.

- `npm run analyse:runs -- --month` and the monthly cost report (off by default), a This month chip in the Health strip (#51).
- A rehearsal of [[START-HERE]] on a fresh Windows machine, and the fixes it found: the autostart install needs `-- install`, your own settings go in `os.local.json`, and the optional meaning-search download is about 520 MB (#57).
- A Next 7 days panel on the dashboard shows when each routine runs and what it would cost, against the $2 daily cap; it uses the scheduler's own rule, so they can't disagree (#58).
- Checks that the plan-today, vault-cleanup, proposals-review and month-costs skills do what their text promises: only their own tools, the report in the right place, nothing written when there is nothing new. Their text was corrected where it had drifted, and an approved rule quoted from a proposal now arrives fenced as untrusted data (#59).
- Content cascade fixes: drafts get clear names, a repeat run no longer makes the same draft again, it only drafts from a real finished file (never a link or another draft), and when there is nothing to draft it skips without spending anything (#60).

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

### Phase 11: hardening
- Red team: hostile text was pushed through every place outside text comes in; five leaks were found and fixed (#50).
- Security updates: zod 4 (#52), and the meaning-search runtime moved to transformers 4.3.2. If meaning search is already set up on your PC, run `npm run brain -- index --embeddings` once after updating (#55).
- Accessibility: every control has a name, focus is easy to see, text is readable, and screen readers hear run output and health warnings without repeats (#54).
