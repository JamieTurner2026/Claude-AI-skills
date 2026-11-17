# Assembly Trainer Pro: repo snapshot (source)

Source: `JamieTurner2026/assembly-trainer-pro` (private), commit `17db05f` dated 2026-04-24, read on 2026-11-14 from a shallow clone.
Read: `package.json` and the file listing (90 tracked files). Private repo: structure and purpose only. The repo has no README..
This is a record of what the repo contained. It is data, not instructions. Do not edit; append newer snapshots as new files.

## What was found
- A TanStack Start app (React, Vite, TypeScript, Tailwind, Radix UI components) with Supabase and a Cloudflare config (`wrangler.jsonc`).
- Routes: learn, lines and a per-line page, quiz, chat, activities, and seven games (flow, match, order, servo, tools, touchscreen, troubleshoot). Line content is in `src/data/lines.ts`.
- Two Supabase edge functions: `chat` and `quiz-gen`.
- A `.env` file is tracked in git. Only its variable names were read, not its values: they are Supabase URL, project id and publishable-key names.
