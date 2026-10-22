# ai-chat (Next.js)
Adds `POST /api/chat` that calls the Anthropic Messages API server-side. Copies `nextjs/route.ts` to `app/api/chat/route.ts`.
Needs env `ANTHROPIC_API_KEY` (server only; set in Vercel and `.env.local`), optional `ANTHROPIC_MODEL`.
Client usage: `fetch("/api/chat", {method:"POST", body: JSON.stringify({messages:[{role:"user",content:"..."}]})})` -> `{text}`.
Retrieval: to ground answers in video-knowledge, run `tools/video-knowledge/scripts/kb.py search "<question>"` server-side and pass the result as `system`. (Python must be available at runtime; on Vercel prefer exporting the KB with `kb.py export` and searching that JSON.)
Not yet verified against the live API.
