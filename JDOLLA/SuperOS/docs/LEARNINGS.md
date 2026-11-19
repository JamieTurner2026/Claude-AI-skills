# Learnings

One rule each, with its evidence.

- **Pick the permanent folder before building.** Evidence: 2026-11-13, the PC shared no folder with the cloud session, so Phase 1 was drafted in a repo and has to be copied over.
- **A check that can't fail proves nothing.** Run a negative control next to every check. (From the original build.)
- **A model refusing is not a block.** Test security boundaries by attacking them. (From the original build.)
- **Permission rules match text, not effects.** Enforce at the OS level when a command can reach any path. (From the original build.)
- **Render it; a type check is not a test of the page.** Evidence: 2026-11-15, the dashboard passed `tsc` and 22 tests, but a browser run showed an empty results box because `display: flex` overrode the `hidden` attribute.
- **Break a guard on purpose to prove its test.** Evidence: 2026-11-15, removing the path check, binding every address, and skipping the token check each made the suite fail, so the passing run meant something.
- **Read a flag's help before trusting its name.** Evidence: 2026-11-19, `--bare` looked like the way to strip inherited config, but it signs in only with an API key and would have broken every run on Jay's subscription login. `--restricted` plus `--strict-mcp-config` did the job without touching sign-in.
- **A secure setting can fail open by default.** Evidence: 2026-11-19, Claude Code's docs say that if the sandbox can't start it runs commands unsandboxed unless `failIfUnavailable` is set. The bridge sets it and also refuses Bash itself when no sandbox is detected.
- **A clean attack result is not proof until you know why it was clean.** Evidence: 2026-11-19, the Grep attack leaked nothing only because ripgrep skips hidden files, not because a rule blocked it.
