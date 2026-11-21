# evals

Routing and brain eval sets. Hand-run only.

## brain/
`brain/questions.json`: retrieval questions for the second brain. Run from `os/`:

```
npm run brain -- index
npm run brain -- eval            # k = 5
npm run brain -- eval --k 1 --json
npm run brain -- eval --compare  # keyword vs hybrid (needs: npm run brain -- index --embeddings)
```

- A question scores a hit when any of its `relevant` notes is in the top k distinct notes. MRR uses the rank of the first relevant note in the top 20.
- Styles: `keyword` (shares words with the note), `paraphrase` (shares a few), `synonym` (shares almost none).
- Pick `relevant` from what the notes say, never from what search returned. A relevant path missing from the index is a warning and makes the command exit 1.
- When a note is renamed or a question goes stale, fix the question, and record the new baseline in `docs/STATUS.md`.

