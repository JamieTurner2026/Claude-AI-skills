---
name: claude-skills-api
description: Use Anthropic's managed Skills (xlsx, pptx, pdf, docx) through the Claude API to generate Excel, PowerPoint, PDF and Word files from code, and download them with the Files API. Use when the user wants an app, script or backend to create documents programmatically with Claude, asks how Skills, the skills container, code execution or file_id downloads work, or hits errors like "container not recognized" or "Skills beta requires the code_execution tool".
---

# Claude Skills API

Skills are packages of instructions, scripts and resources that Claude loads on demand. Only name/description (metadata) is always in context; the full SKILL.md (<5k tokens) loads when relevant; linked files load only if needed. Anthropic-managed skills: `xlsx`, `pptx`, `pdf`, `docx`. Custom skills hold your own workflows.

## The recipe (all four parts are required)
1. Use `client.beta.messages.create(...)` (plain `messages.create` rejects `container`).
2. `container={"skills": [{"type": "anthropic", "skill_id": "xlsx", "version": "latest"}]}`
3. Include the code execution tool: `tools=[{"type": "code_execution_20250825", "name": "code_execution"}]`. Without it: "Skills beta requires the code_execution tool".
4. `betas=["code-execution-2025-08-25", "files-api-2025-04-14", "skills-2025-10-02"]`
Then collect `file_id`s from the response and download them with `client.beta.files.download(file_id)` right away (files expire).

## Use the helper
```
pip install "anthropic>=2"            # export ANTHROPIC_API_KEY=...  (server-side only, never in client code or git)
python3 scripts/skills_client.py list
python3 scripts/skills_client.py generate xlsx "Monthly budget with SUM formulas and a column chart" --out outputs
```
`skills_client.py` also exposes `generate`, `extract_file_ids` (walks the whole response, so it survives block-shape changes) and `download_files` for import. Prompts can be one line ("quarterly sales report Excel with a chart") or detailed (rows, formulas, formats, chart). Start simple, then add detail. Several skills can be listed in `container.skills` for one request. Reuse `container.id` from an earlier response to avoid reloading skills.

## Expect
Excel with charts about 2 min, PowerPoint 1-2 min, simple PDF 40-60 s. Don't interrupt. Cost: skill metadata is cheap; a skill that is used loads ~5k tokens of instructions.

## Troubleshooting
| symptom | cause / fix |
|---|---|
| `unexpected keyword argument 'container'` | used `client.messages`; use `client.beta.messages` |
| "requires the code_execution tool" | add the code execution tool |
| no `file_id` in response | tool or skill missing, task didn't need a file, or an error is in the text; print the response text |
| file not found on download | expired; download immediately; check Files API beta is listed |
| `ANTHROPIC_API_KEY not found` | set the env var; restart the kernel/shell |
| rate limits | exponential backoff, batch, raise tier |
`client.skills.list(source="anthropic")` and `client.skills.versions.retrieve(skill_id=, version=)` list/inspect skills (SDK 2.x; older SDKs need the beta namespace).

## Verification status
The SDK calls above were checked to exist in `anthropic` 2.6.0. The helper was not run against the live API (needs a key), so beta header names come from Anthropic's tutorial and should be re-checked against current docs if a call is rejected. Note: in Claude.ai itself these document skills are already built in; this skill is for building them into your own code.
