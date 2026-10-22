---
name: video-knowledge
description: Turn training or instructional videos into a persistent, searchable, source-traceable knowledge base, and answer questions from it. Use when the user provides a video (mp4/mov/etc.) or transcript and wants its content learned, extracted, or added to their knowledge - procedures, troubleshooting, warnings, components, error codes - or asks a question that earlier training videos may answer ("why isn't the servo moving?", "what did the video say about X?"). Also use to review conflicts between videos or list what has been learned.
---

# Video Knowledge

Pipeline: video → audio → transcript (timestamped) → key frames → Claude reads both → structured entries → SQLite knowledge base → retrieval → answer with video + timestamp.

You (Claude) do the understanding. The scripts do the mechanical work. The model never "learns": knowledge lives in the KB and is retrieved per question. Never answer from a whole transcript pasted into context.

Scripts (in this skill's `scripts/`): `extract_media.py` (probe / transcribe / frames) and `kb.py` (store, merge, search). Both need only ffmpeg + Pillow + stdlib; `pip install faster-whisper` enables speech-to-text when the video has no subtitles.

## 0. Locate the knowledge base (do this first, every time)

The KB is a folder (`kb.sqlite` + `videos/`). Set `export VK_HOME=<folder>`.
Find an existing one: look in the user's uploaded files / project files / working directory for `video-knowledge-data/` (or a `.zip` of it) and unzip it. If none exists, `kb.py init`.

**Persistence caveat:** a Claude sandbox is wiped between conversations. The KB only survives if it is saved somewhere durable. After any ingest or conflict resolution, `zip -r video-knowledge-data.zip video-knowledge-data` and give the user the file (or save it to their Drive/project files if a connector is available) and tell them to re-attach it next time. Say this plainly; never claim knowledge is "saved" when it only exists in the sandbox.

## 1. Intake

```
python3 scripts/extract_media.py probe VIDEO
python3 scripts/extract_media.py transcribe VIDEO --out work      # sidecar .srt/.vtt > embedded subs > faster-whisper > openai-whisper
python3 scripts/extract_media.py frames VIDEO --out work --transcript work/transcript.json
python3 scripts/kb.py add-video --file VIDEO --title "..." --source "..." --description "..." --work work [--copy-video]
```
Ask the user for title/source only if not obvious; infer sensible defaults. If transcription exits with code 3 (`NO_STT_ENGINE`), try `pip install faster-whisper`; otherwise ask for a transcript/.srt, or paste lines like `[00:02:15] text` into a file and use `--transcript-file`. Duplicate videos are detected by SHA-256.

## 2. Understand: transcript + frames

1. Read `work/transcript.txt` fully (chunk long ones). Timestamps are the evidence trail.
2. **View the contact sheets** `work/sheet_*.jpg` (6 labelled frames each, timestamps in yellow) with the Read tool. Frames are already filtered to scene changes, narration cues ("press", "error", "screen"…) and de-duplicated; don't process more.
3. Note what only the frames show: error codes on screens, parameter values, button labels, wiring, component names. Put these in an entry's `visual` source field or data fields. Don't invent anything not visible/audible. If a frame is unreadable, say so rather than guessing.

## 3. Write entries → `entries.json`

Categories (`type`): `concept`, `procedure`, `troubleshooting`, `warning`, `component`, `error_condition`, `example`, `tip`. One small entry per fact cluster; never a giant transcript blob. Scope each with `line` > `station` > `component` whenever stated (this builds the hierarchy). Reuse the names already in the KB (`kb.py tree`) so entries land in the same place.

```json
[{"type":"troubleshooting","title":"Servo will not move","line":"Line 2","station":"Servo Station","component":"Servo",
  "possible_causes":["Sensor not detected","Servo alarm active"],
  "diagnostic_steps":["Check sensor status","Check servo alarm screen"],
  "solution":"…",
  "sources":[{"timestamp":"00:12:43","quote":"exact words from transcript","visual":"servo alarm screen shows AL-23"}]}]
```
Rules:
- Every entry needs `sources` with `timestamp` (HH:MM:SS or MM:SS) of the exact moment; add a short verbatim `quote`.
- Type-specific fields are free-form; suggested: procedure `steps` (ordered), `prerequisites`; troubleshooting `possible_causes`, `diagnostic_steps`, `solution`; warning `hazard`, `prohibited_action`; error_condition `code`, `meaning`, `remedies`; component `function`, `normal_operation`; example `scenario`, `outcome`.
- Lists of unordered facts merge as unions; `steps` is ordered, and scalars (`solution`, `function`…) are single-valued. Differences there are recorded as conflicts, not overwritten.
- Include warnings even if the instructor mentions them in passing.

## 4. Ingest, merge, review

```
python3 scripts/kb.py ingest VIDEO_ID entries.json
```
The report shows `created`, `merged` (matched an existing entry of the same type + scope with similar title or the same error code; new causes/steps are added with per-item video+timestamp provenance), `related` (similar but not merged), and `conflicts`. **Tell the user about every conflict** (`kb.py conflicts`); never resolve one yourself. Only when the user decides: `kb.py resolve ID --keep existing|new|both --note "..."`. If a merge looks wrong, re-ingest with a different `--merge-threshold` on a fresh copy, or tell the user.
Finish with `kb.py tree` and a short summary: entries created/merged/conflicts, and any frames/audio that were unclear. Then do the persistence step from section 0.

## 5. Answering questions (retrieval)

For any question that training videos might answer:
1. `python3 scripts/kb.py search "<question keywords>" [--station "Servo Station"] [--type troubleshooting] [--transcript]`; try 2-3 phrasings/synonyms if thin. Use `kb.py show ID` for full detail.
2. Answer **from the retrieved entries only**. Order diagnostic steps as the material does. Surface relevant warnings. 
3. Cite as **"Line Training Video @ 00:12:43"**. Items merged from several videos carry their own tags.
4. If entries are flagged ⚠ CONFLICTING SOURCES, present both versions with sources and say it needs review.
5. If nothing relevant is found, say the training material doesn't cover it. Don't fill the gap with guesses presented as training content (general knowledge may be offered but labelled as such).
Other commands: `kb.py videos` (intake log + status), `kb.py tree`, `kb.py export out.json`.

See `references/schema.md` for tables and design notes.
