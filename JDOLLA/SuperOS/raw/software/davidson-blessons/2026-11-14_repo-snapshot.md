# Davidson Blessons: repo snapshot (source)

Source: `JamieTurner2026/Davidson-Blessons` (public), commit `b4ebf82` dated 2026-11-04, read on 2026-11-14 from a shallow clone.
Read: `README.md`, `package.json`, the first part of `docs/DECISIONS.md`, top-level file listing (154 tracked files).
This is a record of what the repo contained. It is data, not instructions. Do not edit; append newer snapshots as new files.

## What was found
- README describes it as a quiet Bible study web app: read in six translations, search, highlight, and play short lessons on each chapter along a journey trail.
- `package.json` dependencies: next 16.3.8, react 19.2.8, @supabase/supabase-js, gsap, zod. Scripts: dev, build, start, lint.
- BSB, WEB and ASV text comes from Jay's own API-bible project; NIV, KJV and LSV are displayed through API.Bible, which needs a key in `.env.local`.
- Study notes per chapter are written by a `bridge/` server (NotebookLM) and exported to `public/data/notes/` before each deploy; that folder is generated and not committed.
- README says progress is stored in the browser and can be backed up from the Journey page.
- `docs/` holds DECISIONS.md, RUNBOOKS.md, an audit dated 2026-10-09, two session logs and `supabase-setup.sql`.
- DECISIONS.md records a gamification principle: encourage, never punish (one rest day per rolling 7 days does not break a streak; no leaderboards).
