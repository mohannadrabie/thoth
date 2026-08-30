# Decision Log (active)

General app-level decisions taken — manager rulings, deadlock resolutions, and other notable choices. **ADR changes are NOT recorded here** — those are logged in the ADR repo via `/…:adr-amend` (the amendment PR + the ADR's status). Architecture decisions themselves live only in ADRs.

**This file holds only active decisions.** PRINCIPLES.md rule 14 hydrates it in full every session, so it stays bounded on purpose. A row is active until BOTH: human ratified is Y (or resolved N) AND its review-back date has passed with no open dissent — the Manager then moves it to `docs/decisions-archive.md` verbatim at the next session handoff. Consult the archive on demand (a deadlock citing precedent, an audit sample) — it isn't part of the default hydration.

Conventions:
- **Cite the evidence.** A decision references what it's based on — a `docs/reviews/<…>.md` report, an ADR, or a measurement. A decision with no evidence is an opinion.
- **Supersede in place.** When a later decision reverses an earlier one, **strike the old row through** (`~~…~~`) and append `SUPERSEDED <date> by <what>` — keep the history, never delete it. New decision gets its own row; a superseded pair archives together once both are resolved.
- **By** = the role/agent that proposed it; **Human ratified** = Y / N / pending (silence ≠ approval for anything touching hard rules, money, or scope).

| Date | Decision (+ evidence) | By | Dissent recorded | Human ratified | Review-back date |
|---|---|---|---|---|---|
