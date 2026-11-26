# PC setup (Windows)

How to get the Super OS running on Jay's Windows PC, start to finish. About 20 minutes. Every step says what you should see; if you see something else, stop and check **Troubleshooting** at the bottom.

Nothing here sends, buys, deletes or publishes anything. The only step that costs money is the first question (§8), capped at $0.05.

**Order:** §1–§9 once, top to bottom. After that, every time you update: `npm run update` in `os\` (§2), which pulls, installs, runs the doctor and the smoke check (§9.1). §9.2 is the status check, §10–§13 explain the widgets and feed files; §14 is the one-time Windows checks.

## 1. What you need first

| Thing | How to check (PowerShell) | You should see |
|---|---|---|
| Node 22.18 or newer | `node --version` | `v22.18.0` or higher (v24 is fine) |
| Git | `git --version` | any version |
| Claude Code, signed in | `claude --version`, then `claude` once and sign in | a version number; the sign-in finishes in the browser |

- Get Node from nodejs.org (the LTS installer). Get Git from git-scm.com.
- Install Claude Code with the **native installer** from Claude Code's docs. It puts `claude.exe` on your PATH, which the bridge finds on its own.
- **Did you install Claude Code with npm instead?** Then Windows has `claude.cmd`, which the bridge can't start safely, because it starts programs without a shell. Find the real file with this command:

  ```powershell
  Get-ChildItem "$env:APPDATA\npm\node_modules\@anthropic-ai\claude-code\cli.js"
  ```

  If that lists the file, make a new file `os\config\os.local.json` (this PC's own settings; git ignores it, so `npm run update` still pulls) holding its full path, with doubled backslashes:

  ```json
  { "claudeBin": "C:\\Users\\<you>\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js" }
  ```

  The bridge runs a `.js` path with your Node. Don't put it in `os.config.json`: that file is part of the code, and a change there makes `npm run update` stop with "You have local changes". If you already did, move the line into `os.local.json` and run `git checkout -- config/os.config.json`. If the command finds no file, use the native installer instead.

## 2. Get the latest code without losing PC work

The newest version is on `main` in `JamieTurner2026/Claude-AI-skills`, folder `JDOLLA/SuperOS/`.

**If the PC folder is a git clone of that repo**, update with one command, in `<vault>\os`:

```powershell
npm run update
```

Stop the bridge first (files in `node_modules` that are in use cannot be replaced on Windows). It runs these steps in order, prints one PASS or FAIL line for each, and stops at the first FAIL:

1. **Clean tree.** If `git status` shows any changed or new file, it stops with "You have local changes: commit or stash them first. Nothing was changed."
2. **`git pull --ff-only`.** It only ever moves forward to what is on GitHub. It never merges, rebases, resets or forces. If your clone and GitHub have both changed, it stops and changes nothing.
3. **`npm ci`.** Installs exactly the locked dependencies.
4. **`npm run doctor`.** See §3.2.
5. **`npm run smoke`.** See §9.1.

It never touches `.env`, your notes or the brain index. When every line says PASS, start the bridge (§6). Exit code 0 means everything passed; 1 means it stopped.

If it says you have local changes, those are your PC work. **Don't throw them away.** Commit them on a branch first (`git switch -c pc-work`, `git add -A`, `git commit -m "PC work"`), then `git switch main` and run `npm run update` again. Ask Claude to merge `pc-work` in afterwards. If it says your copy and GitHub have both changed, your PC has commits GitHub doesn't: don't reset anything; ask Claude to merge them.

The first time, before `npm run update` exists on your PC, update by hand: `git status` must say `nothing to commit, working tree clean`, then `git pull --ff-only`.

**If the PC folder is a plain copy (no git), or you're not sure:** don't copy anything over it. Clone `main` into a **new** folder next to it and open both in a Claude Code session. Ask it to compare them and merge your PC changes into the new copy. Delete the old folder only after you've checked the result.

From here on, `<vault>` means the `JDOLLA\SuperOS` folder.

## 3. Install, check and test

**3.1 Install the packages:**

```powershell
cd <vault>\os
npm install
```

**3.2 Run the doctor.** It checks this PC and changes nothing:

```powershell
npm run doctor
```

It prints one row per check: PASS, WARN or FAIL. Every row that is not PASS names the section here that fixes it. Fix the FAIL rows before going on; WARN rows are fine to start with (for example "Meaning search not set up" or "Bash sandbox": native Windows has none, so runs that need Bash are refused). If it says **Packages not installed**, run `npm install` again (3.1). It never reads the values in `os\.env` and never prints a secret; `npm run doctor -- --json` gives the same as JSON to send to Claude.

**3.3 Test:**

```powershell
npm run check
npm test
```

You should see `npm run check` finish with no errors, and `npm test` end with `ℹ fail 0` (or `# fail 0` if you send the output to a file). The tests use a fake Claude, so they cost nothing. If any test fails, stop here and send Claude the failing lines.

## 4. Settings file

```powershell
copy .env.example .env
notepad .env
```

- `SUPEROS_PORT=4317`: the dashboard's local port. Change it only if something else uses 4317.
- `SUPEROS_SCHEDULER=on`: routines you switch on run at their times. `off` is the **kill switch**: no routine runs on its own (Run now still works).
- Leave `SUPEROS_ROUTER_KEY` blank. Never put a real key or password in this file; it is not where keys live.
- `.env` never gets committed (git ignores it).

## 5. The second brain

### 5.1 Build the index

```powershell
npm run brain -- index
npm run brain -- search "servo"
```

The first command prints `indexed N files, M chunks` and where the index is. The second shows matching notes, if any mention "servo"; try any word you know is in your notes. The index is a file at `%USERPROFILE%\.superos\brain\index.sqlite`, outside the vault. It's safe to delete, since it gets rebuilt.

You don't have to rerun this. Every run rebuilds the index first if it's more than 5 minutes old.

### 5.2 Meaning search (optional, one-time download)

Keyword search misses notes that say the same thing in other words. This adds a small model that runs on your PC (no cloud, no key) and mixes its results with keyword search.

```powershell
npm run brain -- index --embeddings
```

- The first time, it installs a pinned runtime (about 500 MB) and downloads the model (about 23 MB) into `%USERPROFILE%\.superos\brain\embeddings\`. Nothing goes into the vault. This is the only command that downloads anything; runs never do.
- **If you set this up before 2026-11-24**, run the same command once after updating. The runtime moved to transformers 4.3.2, and the old runtime pulls in an image library (`sharp`) with a security advisory. Until you do, search says "embedding runtime is 3.8.1, this version needs 4.3.2" and uses keywords only. The command replaces the runtime and gives every note a new vector (the model is kept, so nothing is downloaded but the runtime). Old and new vectors are never mixed.
- Then it gives every note a vector. That takes a few seconds and later runs reuse the vectors.
- Check it worked: `npm run brain -- eval --compare` prints keyword and hybrid scores side by side.
- New or changed notes get their vectors on their own: while the bridge runs, the rebuild before each run embeds them in the background (at most 5 s of work per rebuild, without holding up the run). `npm run brain -- index --embeddings` still does them all at once.
- Runs now use meaning search on their own. To switch it off, set `SUPEROS_BRAIN_HYBRID=off` in `.env` and restart the bridge. To remove it completely, delete the `embeddings` folder.
- If the model can't load, search goes back to keywords and the bridge window says why. A run never fails because of it.

### 5.3 Import your sessions (optional)

This copies your past Claude Code and claude.ai conversations into the second brain, with secrets taken out first.

```powershell
npm run brain -- import-sessions --dry-run
```

That reads `%USERPROFILE%\.claude\projects` and prints, for each session, the file it would write and how many things it would redact (keys, tokens, passwords, emails, phone numbers, `KEY=value` lines). It writes nothing. If the list looks right, run it for real and rebuild the index:

```powershell
npm run brain -- import-sessions
npm run brain -- index
```

For claude.ai: in claude.ai go to Settings, Privacy, Export data, unzip the email's download, then:

```powershell
npm run brain -- import-sessions --claude-ai C:\path\to\conversations.json --dry-run
npm run brain -- import-sessions --claude-ai C:\path\to\conversations.json
```

- Files land in `raw\sessions\claude-code\` and `raw\sessions\claude-ai\`, one per session. Git ignores that folder, so they never get committed.
- Running it again is safe: sessions already imported are skipped (the list is in `%USERPROFILE%\.superos\brain\imported-sessions.json`), and nothing is ever overwritten. A session that grew since last time gets a new `-v2` file.
- The department in each file is a guess (`dept_guess: true`).
- Redaction works by pattern. Open two or three files and check that nothing private got through before you rely on it.
- Search treats these files as untrusted quotes, never as instructions.

### 5.4 How runs use the brain

Every question (T2) and every work request (T3) gets the brain:

- It gets one extra tool server, `superos-brain`, with read-only tools: `search` (find notes) and `get_note` (read one), plus `related` (a note's neighbours) for quick questions (T2).
- No other tool server can load, and the brain can't write anything.
- Notes from `raw/` come back marked as untrusted, quoted data, never instructions.
- The Runs widget shows each tool the run used, for example `mcp__superos-brain__search`.
- Runs also get one safe tool, `today`, which gives the real date in your time zone. Tools are scripts the bridge runs; no run gets a command line.

To turn the brain off, set `"brain": { "enabled": false }` under `engine` in `os\config\os.config.json` and restart the bridge. Runs then read files one by one, as before.

**The note graph** (built with the index, no download, no cost): the brain also knows how your notes connect, through `[[links]]`, `sources`, project folders and departments. Quick questions (T2) can ask for a note's neighbours with the `related` tool, and the weekly vault-cleanup report lists **Orphans** (notes nothing links to and that link nowhere) and **Hubs** (the most connected notes). Search does not use the graph yet: on the current eval it didn't help, so it's off. To try it anyway, set `SUPEROS_BRAIN_GRAPH=on` in `.env` and restart the bridge.

**Compare speed after importing sessions:** `npm run brain -- bench` builds a made-up vault of about 2,700 notes in a temp folder (it never touches yours), then prints index time, size and search speed with the graph off and on. Run it after session import (5.3) and send the numbers, along with a fresh `npm run brain -- eval --graph`.

## 6. Start the bridge

```powershell
npm start
```

Leave this window open. You should see `JDOLLA$ bridge running on http://127.0.0.1:4317 (pid N)`, then `Open the dashboard with: npm run open`. It only listens on this PC; nothing on your network can reach it. Stop it with Ctrl+C.

While it runs, the bridge keeps these files up to date itself, when it starts and every 30 minutes: `wiki\_master-index.md`, each department's `_index.md`, `reports\_index.md`, one hub per project in `projects\`, and today's note in `daily\`. To see what it would do first, run `npm run vault -- build --dry-run` in `os\`. In a daily note, write only under the `## Notes` line: that part is yours and is never changed.

## 6b. Start the bridge when you log in (optional)

So you don't have to run `npm start` by hand each time:

```powershell
npm run autostart -- install
```

- The first time, it changes nothing. It prints exactly what it would do: the Task Scheduler task definition and the one `schtasks.exe` command. Read it, then run the same command again to install.
- It makes one task, **"JDOLLA SuperOS bridge"**, for your user only, with no admin rights. 30 seconds after you log in it runs the bridge (`node bridge/server.ts` in this `os` folder, which is what `npm start` runs). A bridge window opens at logon; leave it open, as in §6.
- `npm run autostart -- status` shows the task. `npm run autostart -- remove` deletes it (only that task, by its exact name). Add `--dry-run` to see a command without running it.
- If you move the vault or update Node, run `install` again. It shows the new plan first.
- **Never tested on Windows.** If `install` says "Access is denied", Windows wants admin rights for logon tasks on your PC. Don't run it as administrator. Use this instead: press Win+R, type `shell:startup`, and put a shortcut there whose target is the `node.exe` path and `bridge\server.ts` shown in the dry run, starting in this `os` folder. Then tell me what happened so the tool can be fixed.

## 7. Open the dashboard

In a **second** PowerShell window:

```powershell
cd <vault>\os
npm run open
```

Your browser opens the dashboard, already signed in. The sign-in lasts 24 hours; run `npm run open` again after that. If no browser opens, see Troubleshooting.

**The Setup checklist.** Near the top of the dashboard, a **Setup checklist** widget lists the steps still left on this PC: doctor passes, tests run, meaning search on, sessions imported, autostart registered, backup set up, mail and calendar feeds present. Each row says done, to do, or (for the tests, which the dashboard cannot see) a box for you to tick; the `PC-SETUP §…` button opens this file. Ticks are kept in this browser only. The widget hides itself when every row is done. Optional steps (meaning search, sessions, backup, feeds) stay "to do" until you do them. If the widget is missing from an older layout, add `{ "widget": "setup", "span": 3 }` to `layout` in `os\config\os.config.json`.

## 8. First real question (costs up to $0.05)

Type a question about your notes in the command bar, for example *"What are my seven departments?"*, and press Enter. It routes as T2 and starts at once. You should see:

- live text in the Runs widget
- brain tool calls listed on the run
- a final cost well under the $0.05 cap (about $0.001 in the cloud test)

## 9. After every update, and checking the bridge

### 9.1 `npm run smoke`

`npm run update` (§2) runs this for you as its last step. To run it on its own, in `os\`:

```powershell
npm run smoke
```

It costs nothing and never touches your real vault, logs or brain index. It copies the vault to a temp folder (without `node_modules`, `.git`, `logs`, the session secret, imported sessions or any `.env` file), starts the real bridge on that copy on a free port with a stand-in for Claude, and checks:

- every dashboard data route (state, runs, routines, skills, proposals, inbox, health) answers with the right shape;
- one question runs end to end (status done, cost recorded);
- the vault rebuild works;
- the brain indexes the copy and a search finds notes.

Then it stops everything and deletes the temp folder, even when a step fails. Every step prints PASS or FAIL. If anything says FAIL, don't start the bridge: send Claude the FAIL lines.

### 9.2 Check that the bridge is alive

- The dashboard shows a **Health strip** under the title: bridge uptime, scheduler on or off, routines on, spend today against the daily cap, the last run, the brain index age, whether embeddings are present, and pending proposals. It turns amber when the scheduler is off, the index is over 1 day old, or today's spend is over 80% of the cap.
- `cd os` then `npm run status` prints the same as a short table. It talks only to `127.0.0.1`. If the bridge is not running it prints `not running` and exits with code **1**; any other trouble (a refused session, an answer it cannot read) exits **2**; healthy exits **0**. A Task Scheduler "check" task can run it and alert on a non-zero exit.
- The report holds counts, states and times only: never a note, a path, a prompt or a setting's value.
- **There is no tray icon.** A tray icon is Windows-only and cannot be built or tested here, so it is not built; the Health strip and `npm run status` are the status check. Not yet run on Windows (§14).

## 10. Routines

All routines ship **switched off**. In the Routines widget:

- the **Next 7 days** widget under it shows when each routine will run in the coming week (on and off), and each day's total budget against the $2 cap. It only shows; change a routine with its switch
- the switch turns a routine on or off (it rewrites `routines\routines.json`)
- **Run now** runs a routine once, right away
- each routine shows its last result, and the widget shows "spent today $x of $2"

Money limits:

- All routines and skill runs together stop at **$2 per day** (raised from $1 on 2026-11-20 so a $1.00 skill fits beside the routines). A routine only starts if its full budget still fits under the cap.
- Each routine has its own budget (plan-today $0.25, morning-intel $0.40, vault-cleanup $0.75, content-cascade $1.00).
- Each time slot runs at most once, even if the PC restarts.
- Routines only run on their own while the bridge is running. If the PC was off, a missed slot runs once when the bridge comes back.

**Content cascade** (Fridays 16:00, up to $1.00) turns one finished deliverable into three drafts: a post, a summary and a note. It drafts only and never posts anything.

- It takes the newest deliverable in `outputs\YYYY-MM\` that has no drafts yet. When every deliverable has drafts, it skips the week at no cost.
- The drafts land beside the others in `outputs\YYYY-MM\` as `YYYY-MM-DD_<dept>_<slug>-draft-post.md`, `-draft-summary.md` and `-draft-note.md`, each starting `Status: DRAFT, not published`. If a file with that name is already there, it adds `-v2` and never overwrites.
- It runs in its own work folder, with no web, shell or publishing tools.

**Turning on the morning brief.** The **Morning intel** routine (weekdays 07:30, up to $0.40) writes `reports\YYYY-MM-DD_morning-intel.md`, or nothing when nothing is new. It is most useful once the calendar and mail feed files are in place (§13.2). Then switch it on in the Routines widget (or press **Run now** once to see what it writes) and leave `SUPEROS_SCHEDULER=on`. It only reads: it never sends, replies to or drafts any message, and it treats every mail subject and calendar title as quoted data.

To stop everything scheduled at once, set `SUPEROS_SCHEDULER=off` in `os\.env` and restart the bridge.

### 10.1 Back up the vault to a private repo (optional, off until you set it up)

Nothing is pushed anywhere until you finish these steps. The backup never goes to the public code repo: it refuses that, and it refuses any vault that sits inside a repo pointing at it.

1. On GitHub, create a **private** repo for the vault (for example `brain`). Do not add a README.
2. In the vault folder (the one that holds `CLAUDE.md`, `wiki\` and `os\`), run once: `git init -b main`, then `git config user.name "Your Name"` and `git config user.email "you@example.com"`. The vault must be its own repo. If it is inside another repo the backup refuses.
3. Sign in to GitHub on this PC the way you normally do (Git for Windows' Git Credential Manager, or an SSH key). The backup never reads or stores a password or token; it uses whatever login git already has.
4. In `os\config\os.config.json` set `"backup": { "remote": "https://github.com/<you>/<repo>.git", "branch": "main" }` (the `git@github.com:<you>/<repo>.git` spelling works too). Restart the bridge.
5. `cd os` then `npm run backup -- --dry-run`. It lists every file that would be committed and changes nothing. Check the list.
6. `npm run backup` does a real backup now. Or switch on **Vault backup** in the Routines widget: it runs daily at 23:40, with no model and no cost. The Health strip shows the last result.

`npm run doctor` has a **Vault backup** row that checks steps 2 and 4 without touching the network (it also fails if the vault's own git config points at the public repo). The weekly vault-cleanup report has a **Backups** section: the last result, days since the last success, and a warning after 3 days.

What is backed up: `CLAUDE.md`, `Home.md`, and `wiki`, `raw`, `outputs`, `inbox`, `daily`, `projects`, `reports`, `depts`, `skills`, `docs`, `evals`, `apps`, `routines`, `proposals`. Never: `.env*`, anything starting with a dot, `logs\`, `os\`, `.claude\`, `raw\sessions\`, `outputs\_work\`, `inbox\_feeds\`, key files (`.pem`, `.key`, `id_rsa`...). Links and files over 25 MB are left out and counted. If a secret was committed by hand earlier, the push is refused until you remove it from git. It never force-pushes: if the remote has changes this PC does not, it stops and says so. Not yet run on Windows (section 14).

## 11. Run a skill by hand

In the dashboard, the **Skills** widget lists every skill with its tier (T2 reads, T3 writes drafts) and suggested budget. Press **Run**; add a short note in the box if you want to steer it. A T3 skill asks "Run this? Up to $X" first. Skills share the routines' $2 a day cap (`engine.routines.dailyCapUsd` in `os\config\os.config.json`).

## 12. Proposals (the learning loop)

When a run fails, gets tools blocked, or stops at its cap, a card appears in the **Proposals** widget:
- what broke;
- a suggested fix and lesson;
- for a routine, one rule to add to its skill.

Drafting each suggestion is a small read-only run that costs up to $0.05. All of them together stop at $0.25 a day.

- **Approve** saves the lesson to `wiki\_learnings\` and adds the rule at the end of the skill under "Learned rules". Nothing else in the skill changes.
- **Reject** changes nothing.
- Nothing is ever applied without your click.
- Chips at the top filter the cards by kind, with counts. Suggested-change and uncited cards show a one-line **Why**.
- Keys: click the widget, then `j`/`k` move between cards, `a` or `r` asks "Approve this?" or "Reject this?", and only `y` (or Enter) does it; `n` or Esc cancels.
- A **question you ask that is answered from your notes without naming the note** also shows up here as an "Uncited answer" (it costs nothing). Approving it adds one rule to the skill, if the answer came from a skill. Turn it off with `"citations": { "enabled": false }` under `learning` in `os\config\os.config.json`.
- To switch the loop off, set `"learning": { "enabled": false, ... }` under `engine` in `os\config\os.config.json` and restart the bridge.

**Run analysis:**
- `cd os` then `npm run analyse:runs -- --days 30` prints where the money went and what keeps failing, from `%LOCALAPPDATA%\JDOLLA\logs\router.jsonl`. Nothing is changed.
- `npm run analyse:runs -- --month` (or `--month 2026-11`) totals one calendar month in your time zone: spend by tier, routine and skill, the learning diagnoses, your highest day against the $2 daily cap, how many days the cap was hit, and a pace projection. Costs and counts only, never a prompt. The **Monthly costs** routine (1st of each month at 08:10, no model, $0, off until you switch it on in the Routines widget) writes last month's report to `reports\YYYY-MM_costs.md` and never overwrites one. The Health strip shows "This month $x".
- On the Proposals card, **Suggest changes** adds up to 3 "Suggested change" cards a week. Approve only records your decision; **you edit `os\config\os.config.json` or the routine yourself**.
- New typed requests are logged as their first 80 characters in `router.jsonl` (on this PC only).

## 13. Inbox and feed files

### 13.1 Sort your inbox

Drop loose files into `inbox\`. In the **Proposals** widget press **Sort inbox**: one small read-only run (up to $0.05) suggests where each file belongs under `raw\<department>\<topic>\`. Nothing moves until you press **Approve** on a suggestion; **Reject** leaves the file where it is. It looks at up to 25 files at a time, and skips links, folders, files over 1 MB and anything starting with a dot.

### 13.2 Mail and calendar feed files (optional, nothing is connected)

The daily note and the `plan-today` and `morning-intel` skills can show today's calendar and mail you labelled Brain, read from two files you put here yourself:

- `inbox\_feeds\calendar.json`: `{ "events": [ { "title": "Standup", "start": "2026-11-16T09:30:00-05:00", "end": "2026-11-16T10:00:00-05:00", "location": "Room 4" } ] }`
- `inbox\_feeds\mail.json`: `{ "messages": [ { "id": "m1", "from": "Ada <ada@example.com>", "subject": "Quarterly plan", "date": "2026-11-16T08:15:00-05:00", "snippet": "first words...", "labels": ["Brain"] } ] }`

Only messages whose `labels` include `Brain` are used. Only names, dates and subjects reach the daily note and the tools; a snippet is read but never shown, and anything else in the file (such as a body) is ignored. Files over 1 MB, links, and bad JSON are ignored (the daily note says so in one line). These two files are git-ignored: never commit them. Nothing connects to Gmail or Calendar; that is a later step you approve.

**Put Brain mail into the second brain (optional):**

```powershell
npm run brain -- import-mail --dry-run
npm run brain -- import-mail
npm run brain -- index
```

- Each message labelled Brain in `mail.json` becomes one note in `raw\mail\YYYY-MM\`, with its date, subject and the sender's **name** only (never the address). The note holds the snippet only; the feed has no full message.
- Before anything is written, email addresses, phone numbers, long numbers (accounts, cards) and anything that looks like a key are masked. Each note says how many things were masked.
- The notes are untrusted: search shows them as quoted data, never instructions.
- Running it again skips messages already imported (the list of imported ids, hashed, is in the log folder, `%LOCALAPPDATA%\JDOLLA\logs\mail-import.json`). Nothing is overwritten. `--dry-run` writes nothing.

## 14. Windows checks (never tested on Windows; please do these once)

These all passed on Linux in the cloud. Windows is untested. Tell Claude the result of each one.

1. **Claude is found.** §8 worked. If the run failed with "not found", see §1 (native installer, or `claudeBin` in `os\config\os.local.json`).
2. **Stop works.** Ask a long T3 job, confirm it, press **Stop** after a few seconds. The run should show `stopped`, and Task Manager should show no `claude.exe` left over from it. The bridge stops it by its exact process ID (`taskkill /PID <id> /T`), never by name, so your own Claude sessions aren't touched.
3. **Logs land in the right place.** `%LOCALAPPDATA%\JDOLLA\logs\router.jsonl` exists and has one line per run, with its cost.
4. **No Bash without a sandbox.** Native Windows has no Claude Code sandbox, so any run that needs Bash is refused with a plain message. That's expected. It only works if Claude Code runs inside WSL2.
5. **Secrets stay blocked.** This one costs up to $0.05.
   1. Make a test file `<vault>\wiki\.env-test` containing `CANARY-7781`.
   2. Ask: *"What does the file wiki/.env-test say?"*
   3. The answer must **not** contain `CANARY-7781`, and the run should show a blocked `Read`.
   4. Delete the test file afterwards.

   This also checks that the deny rules work with a `C:` drive path, which is untested.

## Troubleshooting

| What you see | What to do |
|---|---|
| `node` is older than 22.18 | Install the current LTS from nodejs.org, open a new PowerShell window. |
| Run fails: `claude.exe` not found | Use the native installer, or set `claudeBin` in `os\config\os.local.json` to `cli.js` (§1). |
| Run fails: not signed in | Run `claude` once in PowerShell and sign in, then try again. |
| Port 4317 in use | Change `SUPEROS_PORT` in `os\.env`, restart the bridge, run `npm run open` again. |
| `npm run open` opens nothing | If it printed a long link, paste that into your browser (valid 24 hours, this PC only). If it says the bridge is not running, start it first (§6). |
| Dashboard says signed out | The 24-hour session ran out: run `npm run open` again. |
| Runs don't use the brain | Check `engine.brain.enabled` is `true`. Look in `router.jsonl` for `brain-index-failed`: the run went ahead without the brain. Rerun `npm run brain -- index` and read its error. |
| A routine didn't run | Is it switched on? Is `SUPEROS_SCHEDULER=on`? Was the bridge running? Is "spent today" near the $2 cap? `router.jsonl` says which. |
| No proposal after a failed run | Was it stopped with Stop? Those never get one. Same failure earlier today? Only the first gets one. Check `engine.learning.enabled`; `router.jsonl` shows `proposal` lines. |
| A test or `npm run smoke` fails after updating | Don't start the bridge. Send Claude the failing lines. |
| SQLite "experimental" warning | Harmless: Node's built-in SQLite prints it. |
