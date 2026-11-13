# Second Brain (Obsidian vault)

This repo is an Obsidian vault: plain Markdown notes. Claude works on it as a careful librarian, not a rewriter.

## Structure
- `00-Inbox/` – unsorted captures. Process these into the folders below.
- `10-Projects/` – active work with an outcome and an end.
- `20-Areas/` – ongoing responsibilities (health, finances, work, faith, etc.).
- `30-Resources/` – reference material and topic notes.
- `40-Daily/` – daily notes, named `YYYY-MM-DD.md`.
- `90-Archive/` – finished or inactive notes. Never delete, move here instead.
- `_Templates/` – note templates. Do not edit unless asked.
- `.obsidian/` – app config. Never touch it.

(Adjust these folders to match the real vault. Ask before reorganizing.)

## Note conventions
- One idea per note. Title is the filename, in plain sentence case.
- Start each note with YAML frontmatter: `created`, `tags`, and `status` (`seed`, `growing`, `evergreen`).
- Link with wiki-links `[[Note Title]]`; use `[[Note#Heading]]` for sections. Prefer links over duplicating text.
- Tags are lowercase, hyphenated (`#book-notes`). Reuse existing tags before inventing new ones.
- Dates are ISO (`2026-11-13`).
- Attachments go in `_attachments/`, referenced with `![[file.png]]`.

## How Claude should work here
- Search before creating: check for an existing note on the topic and extend it rather than adding a duplicate.
- When adding a note, link it to at least two related notes and add it to the relevant index/MOC (map of content).
- Never delete or overwrite a note's body without being asked. Make additive edits; summarize what changed.
- Keep the user's voice in their own notes. Mark anything Claude wrote with `#claude-draft` until reviewed.
- Don't rename or move files in bulk (it breaks links). If a rename is needed, update every `[[link]]` to it.
- Don't put secrets, passwords or private identifiers in notes. Never commit `.env*` except `.env.example`.

## Common tasks
- **Process inbox:** for each note in `00-Inbox/`, rewrite as a clean note, add frontmatter and links, and file it. List what moved.
- **Daily note:** create `40-Daily/YYYY-MM-DD.md` from `_Templates/daily.md`.
- **Weekly review:** summarize the week's daily notes, surface open tasks (`- [ ]`) and suggest next actions.
- **Find connections:** for a given note, suggest related notes and missing links.

## Git
- Commit small and often with clear messages (e.g. `inbox: file 4 captures`).
- Work on a branch and open a draft PR for large reorganizations; direct commits are fine for adding notes.
