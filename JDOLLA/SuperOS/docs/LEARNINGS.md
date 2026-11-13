# Learnings

One rule each, with its evidence.

- **Pick the permanent folder before building.** Evidence: 2026-11-13, the PC shared no folder with the cloud session, so Phase 1 was drafted in a repo and has to be copied over.
- **A check that can't fail proves nothing.** Run a negative control next to every check. (From the original build.)
- **A model refusing is not a block.** Test security boundaries by attacking them. (From the original build.)
- **Permission rules match text, not effects.** Enforce at the OS level when a command can reach any path. (From the original build.)
