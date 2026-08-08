---
description: Answer a question from the project's committed docs, cited to files, using a cheap subagent search.
---

Answer this question **from the repo's committed documentation**, not from
memory or from re-deriving it out of code: **$ARGUMENTS**

Dispatch a single `Explore` subagent with `model: haiku` and give it this task:

> Search the Wolf Pack repo's documentation for everything relevant to:
> **$ARGUMENTS**
>
> Read, in this order — earlier files outrank later ones on conflict:
> 1. `CLAUDE.md` — architecture, release routing, scope boundaries, domain policies
> 2. `docs/DECISIONS-*.md` — dated decision records, newest first
> 3. `docs/HOW-ITS-BUILT.md` — the feature → file + surface index
> 4. `docs/STATUS.md` — status ledger and durable queue
> 5. anything else under `docs/` that matches
>
> Return: the answer, every supporting quote with its `file:line`, any place
> two documents DISAGREE (flag it loudly — a stale doc is how we get confidently
> wrong answers), and an explicit "not documented" if the docs genuinely do not
> cover it. Do not read source code; this is a documentation question.

When it reports back:

- Lead with the answer and its citations.
- If the docs disagree with each other, say so and say which looks stale —
  never silently pick one.
- If the answer is "not documented", say that plainly rather than guessing from
  code, and offer to go look at the source as a separate step.
- If what you find is materially out of date, offer to fix the doc — a stale
  index causes exactly the wrong "we don't have that" answer, which is a
  failure mode this project has hit before.
