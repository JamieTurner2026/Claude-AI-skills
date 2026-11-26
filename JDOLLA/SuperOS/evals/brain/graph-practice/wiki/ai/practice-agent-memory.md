---
title: Agent memory design
dept: ai
type: concept
updated: 2026-11-20
---
# Agent memory design
Practice note. The assistant agent keeps a memory of entries: facts, preferences and open tasks. Agent memory is written after each session and read at the start of the next. Old entries are handled by the eviction rule.

## Related
[[wiki/ai/practice-memory-eviction]]

