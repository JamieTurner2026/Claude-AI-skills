# proposals

Changes the OS suggests, waiting for Jay's approval. Written only by the bridge.

When a run fails, has tool calls blocked, or stops at its budget cap, the bridge writes one
`YYYY-MM-DD_<kind>-<subject>.json` here. It holds:
- what broke (facts the bridge saw);
- a fix, a lesson and, for a skill, one rule to add, drafted by a read-only diagnosis run that costs up to $0.05;
- the decision.

Approve or reject on the dashboard's Proposals widget. Nothing is applied before that. Files here are
git-ignored (they can quote run output).
