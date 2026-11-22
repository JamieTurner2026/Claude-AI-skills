# PC setup (Windows)

How to get the Super OS running on Jay's Windows PC, start to finish. About 20 minutes. Every step says what you should see; if you see something else, stop and check **Troubleshooting** at the bottom.

Nothing here sends, buys, deletes or publishes anything. The only step that costs money is the first question (step 9), capped at $0.05.

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

  If that lists the file, put its full path in `os\config\os.config.json` under `engine`, with doubled backslashes:

  ```json
  "claudeBin": "C:\\Users\\<you>\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js"
  ```

  The bridge runs a `.js` path with your Node. If the command finds no file, use the native installer instead.

## 2. Get the latest code without losing PC work

The newest version is on `main` in `JamieTurner2026/Claude-AI-skills`, folder `JDOLLA/SuperOS/`.

**If the PC folder is a git clone of that repo:**

```powershell
cd <your clone>
git status
```

- If it says `nothing to commit, working tree clean`, update with `git pull`.
- If it lists changed files, those are your PC work. **Don't pull over them.** Commit them on a branch first (`git switch -c pc-work`, `git add -A`, `git commit -m "PC work"`), then `git switch main` and `git pull`. Ask Claude to merge `pc-work` in afterwards.

**If the PC folder is a plain copy (no git), or you're not sure:** don't copy anything over it. Clone `main` into a **new** folder next to it and open both in a Claude Code session. Ask it to compare them and merge your PC changes into the new copy. Delete the old folder only after you've checked the result.

From here on, `<vault>` means the `JDOLLA\SuperOS` folder.

## 3. Install and test

```powershell
cd <vault>\os
npm install
npm run check
npm test
```

You should see `npm run check` finish with no errors, and `npm test` end with `# fail 0`. The tests use a fake Claude, so they cost nothing. If any test fails, stop here and send Claude the failing lines.

## 4. Settings file

```powershell
copy .env.example .env
notepad .env
```

- `SUPEROS_PORT=4317`: the dashboard's local port. Change it only if something else uses 4317.
- `SUPEROS_SCHEDULER=on`: routines you switch on run at their times. `off` is the **kill switch**: no routine runs on its own (Run now still works).
- Leave `SUPEROS_ROUTER_KEY` blank. Never put a real key or password in this file; it is not where keys live.
- `.env` never gets committed (git ignores it).

## 5. Build the second brain's index

```powershell
npm run brain -- index
npm run brain -- search "servo"
```

The first command prints `indexed N files, M chunks` and where the index is. The second shows matching notes, if any mention "servo"; try any word you know is in your notes. The index is a file at `%USERPROFILE%\.superos\brain\index.sqlite`, outside the vault. It's safe to delete, since it gets rebuilt.

You don't have to rerun this. Every run rebuilds the index first if it's more than 5 minutes old.

## 5b. Import your sessions (optional)

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

## 5c. Meaning search (optional, one-time download)

Keyword search misses notes that say the same thing in other words. This adds a small model that runs on your PC (no cloud, no key) and mixes its results with keyword search.

```powershell
npm run brain -- index --embeddings
```

- The first time, it installs a pinned runtime (about 400 MB) and downloads the model (about 23 MB) into `%USERPROFILE%\.superos\brain\embeddings\`. Nothing goes into the vault. This is the only command that downloads anything; runs never do.
- Then it gives every note a vector. That takes a few seconds and later runs reuse the vectors.
- Check it worked: `npm run brain -- eval --compare` prints keyword and hybrid scores side by side.
- After adding notes, run `npm run brain -- index --embeddings` again so the new ones are found by meaning too. They are still found by keyword until then.
- Runs now use meaning search on their own. To switch it off, set `SUPEROS_BRAIN_HYBRID=off` in `.env` and restart the bridge. To remove it completely, delete the `embeddings` folder.
- If the model can't load, search goes back to keywords and the bridge window says why. A run never fails because of it.

## 6. Start the bridge

```powershell
npm start
```

Leave this window open. You should see `JDOLLA$ bridge running on http://127.0.0.1:4317`. It only listens on this PC; nothing on your network can reach it. Stop it with Ctrl+C.

## 6b. Start the bridge when you log in (optional)

So you don't have to run `npm start` by hand each time:

```powershell
npm run autostart -- install
```

- The first time, it changes nothing. It prints exactly what it would do: the Task Scheduler task definition and the one `schtasks.exe` command. Read it, then run the same command again to install.
- It makes one task, **"JDOLLA SuperOS bridge"**, for your user only, with no admin rights. 30 seconds after you log in it runs the bridge (`node bridge/server.ts` in this `os` folder, which is what `npm start` runs). A bridge window opens at logon; leave it open, as in step 6.
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

## 8. How runs use the second brain

Every question (T2) and every work request (T3) now gets the brain:

- It gets one extra tool server, `superos-brain`, with two read-only tools: `search` (find notes) and `get_note` (read one).
- No other tool server can load, and the brain can't write anything.
- Notes from `raw/` come back marked as untrusted, quoted data, never instructions.
- The Runs widget shows each tool the run used, for example `mcp__superos-brain__search`.

To turn it off, set `"brain": { "enabled": false }` under `engine` in `os\config\os.config.json` and restart the bridge. Runs then read files one by one, as before.

## 9. First real question (costs up to $0.05)

Type a question about your notes in the command bar, for example *"What are my seven departments?"*, and press Enter. It routes as T2 and starts at once. You should see:

- live text in the Runs widget
- brain tool calls listed on the run
- a final cost well under the $0.05 cap (about $0.001 in the cloud test)

## 10. Routines

All routines ship **switched off**. In the Routines widget:

- the switch turns a routine on or off (it rewrites `routines\routines.json`)
- **Run now** runs a routine once, right away
- each routine shows its last result, and the widget shows "spent today $x of $2"

Money limits:

- All routines and skill runs together stop at **$2 per day** (raised from $1 on 2026-11-20 so a $1.00 skill fits beside the routines). A routine only starts if its full budget still fits under the cap.
- Each routine has its own budget (plan-today $0.25, morning-intel $0.40, vault-cleanup $0.75, content-cascade $1.00).
- Each time slot runs at most once, even if the PC restarts.
- Routines only run on their own while the bridge is running. If the PC was off, a missed slot runs once when the bridge comes back.

To stop everything scheduled at once, set `SUPEROS_SCHEDULER=off` in `os\.env` and restart the bridge.

## 10b. Proposals (the learning loop)

When a run fails, gets tools blocked, or stops at its cap, a card appears in the **Proposals** widget:
- what broke;
- a suggested fix and lesson;
- for a routine, one rule to add to its skill.

Drafting each suggestion is a small read-only run that costs up to $0.05. All of them together stop at $0.25 a day.

- **Approve** saves the lesson to `wiki\_learnings\` and adds the rule at the end of the skill under "Learned rules". Nothing else in the skill changes.
- **Reject** changes nothing.
- Nothing is ever applied without your click.
- A **question you ask that is answered from your notes without naming the note** also shows up here as an "Uncited answer" (it costs nothing). Approving it adds one rule to the skill, if the answer came from a skill. Turn it off with `"citations": { "enabled": false }` under `learning` in `os\config\os.config.json`.
- To switch the loop off, set `"learning": { "enabled": false, ... }` under `engine` in `os\config\os.config.json` and restart the bridge.

Runs also get one safe tool, `today`, which gives the real date in your time zone. Tools are scripts the bridge runs; no run gets a command line.

## 10c. Indexes, project hubs and the daily note

The bridge now builds these itself when it starts and every 30 minutes: `wiki\_master-index.md`, each department's `_index.md`, `reports\_index.md`, one hub per project in `projects\`, and today's note in `daily\`. To see what it would do first, run `npm run vault -- build --dry-run` in `os\`. In a daily note, write only under the `## Notes` line: that part is yours and is never changed.

## 10d. Run a skill by hand

In the dashboard, the **Skills** widget lists every skill with its tier (T2 reads, T3 writes drafts) and suggested budget. Press **Run**; add a short note in the box if you want to steer it. A T3 skill asks "Run this? Up to $X" first. Skills share the routines' $2 a day cap (`engine.routines.dailyCapUsd` in `os\config\os.config.json`).

## 10e. Sort your inbox

Drop loose files into `inbox\`. In the **Proposals** widget press **Sort inbox**: one small read-only run (up to $0.05) suggests where each file belongs under `raw\<department>\<topic>\`. Nothing moves until you press **Approve** on a suggestion; **Reject** leaves the file where it is. It looks at up to 25 files at a time, and skips links, folders, files over 1 MB and anything starting with a dot.

## 11. Windows checks (never tested on Windows; please do these once)

These all passed on Linux in the cloud. Windows is untested. Tell Claude the result of each one.

1. **Claude is found.** Step 9 worked. If the run failed with "not found", see step 1 (npm install).
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
| Run fails: `claude.exe` not found | Use the native installer, or set `engine.claudeBin` to `cli.js` (step 1). |
| Run fails: not signed in | Run `claude` once in PowerShell and sign in, then try again. |
| Port 4317 in use | Change `SUPEROS_PORT` in `os\.env`, restart the bridge, run `npm run open` again. |
| `npm run open` opens nothing | If it printed a long link, paste that into your browser (valid 24 hours, this PC only). If it says the bridge is not running, start it first (step 6). |
| Dashboard says signed out | The 24-hour session ran out: run `npm run open` again. |
| Runs don't use the brain | Check `engine.brain.enabled` is `true`. Look in `router.jsonl` for `brain-index-failed`: the run went ahead without the brain. Rerun `npm run brain -- index` and read its error. |
| A routine didn't run | Is it switched on? Is `SUPEROS_SCHEDULER=on`? Was the bridge running? Is "spent today" near $1? `router.jsonl` says which. |
| No proposal after a failed run | Was it stopped with Stop? Those never get one. Same failure earlier today? Only the first gets one. Check `engine.learning.enabled`; `router.jsonl` shows `proposal` lines. |
| A test fails after updating | Don't start the bridge. Send Claude the failing lines. |
| SQLite "experimental" warning | Harmless: Node's built-in SQLite prints it. |
