# Start here (Jay, on the PC)

In PowerShell, in the `os` folder of the vault. Do them in this order. Each line says what it does and where to read more (`docs/PC-SETUP.md`).

0. First time only: get the code and install it: `git clone https://github.com/JamieTurner2026/Claude-AI-skills`, go to `JDOLLA\SuperOS\os`, then `npm install`. Needs Node 22.18+ and the Claude CLI signed in. PC-SETUP §1, §2, §3.1.
1. `npm run update`: pulls the newest code (fast-forward only), installs, then runs the doctor and the smoke check. Stops at the first FAIL. Stop the bridge first. §2.
2. `npm run doctor`: checks this PC and names the section that fixes each problem. Fix every FAIL before going on. §3.2.
3. `npm test`: runs every test with a fake Claude (free). Send Claude the pass count. `npm run check` goes with it. §3.3.
4. `npm run brain -- index --embeddings`: optional. Adds local meaning search; the one command that downloads (about 420 MB, once). §5.2.
5. `npm run brain -- import-sessions --dry-run`: previews what your past sessions would add (secrets are removed). Then run it without `--dry-run`, then `npm run brain -- index`. §5.3.
6. `npm run autostart`: the first run only prints a plan, the second installs the logon task. §6b.
7. `npm start`: starts the bridge (leave that window open). In a second window, `npm run open` opens the dashboard. §6, §7.
8. `npm run status`: is the bridge alive? Prints a short table, or "not running". §9.2.

The dashboard's **Setup checklist** shows which of these are still to do. Stuck? PC-SETUP's **Troubleshooting**, or paste the failing line to Claude. What is built and what is untested: [[docs/STATUS]].
