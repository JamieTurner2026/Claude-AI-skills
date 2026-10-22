# KB schema (SQLite, `kb.sqlite`)

| table | purpose |
|---|---|
| videos | title, file_name, file_path, sha256, uploaded_at, duration, source, description, status (`uploaded` → `transcribed` → `knowledge_extracted`), stt_engine |
| segments (+`segments_fts`) | timestamped transcript lines; raw fallback search |
| frames | key frames kept per video (path relative to KB dir, seconds, reason) |
| entries (+`entries_fts`) | knowledge entries: type, title, line/station/component, JSON `data` (incl. `_prov` per-item provenance), `has_conflict` |
| entry_sources | entry ↔ video + second + quote + visual note (the traceability link) |
| conflicts | disagreeing values: existing vs new (with the new video/timestamp); status open/resolved; nothing is overwritten |
| links | `related` entries that were similar but not merged |

Hierarchy (Line > Station > Component > type > entry > source) is derived from the scope columns; `kb.py tree` prints it.

Merge rule: same `type`, compatible scope (stations/lines don't contradict), title token-Jaccard ≥ 0.6 (or equal `code` for error_condition). 0.35–0.6 → `related` link only.
Retrieval is lexical (FTS5 BM25, title weighted 6×) plus same-station warnings. Swapping in embeddings later only needs a new ranking step in `cmd_search`.
