## Path-Forward Brief — S5 (deny-by-default + hook wiring) — 2026-09-06

**Council verdict:** GO · **Rounds spent:** 2 pre-build `design-challenger` rounds + 1 council · **Feature code written so far:** 0 lines (pre-build; only plan documents and review reports exist)
**Trigger:** rule 16(b) — 2 consecutive `design-challenger` no-go rounds on `docs/plans/S5-phase1-2026-09-06.md`, no intervening clean/conditional-clean verdict. Round 2's surviving HIGH was the same root-cause class as round 1's HIGH #1, recurring one layer deeper (in-process → subprocess-exec → subprocess-shell, each round finding the true cost higher than the last measurement used).

### Business impact
- **What users cannot do today:** nothing — S5 hasn't shipped; the kernel/normalizer/detector built in S2–S4 still isn't wired to any live session.
- **Cost of the stall:** 2 design rounds + 1 council, same day, zero lines of production code — cheap to stall here, before any code exists.
- **Deadline pressure:** none recorded.
- **Exposure if we ship with the flawed T11 derivation:** ~100% of live `Bash` calls, the moment S5 wires the hook — a routine, silent, day-one bypass (gap G6). This is exactly why the loop stalled rather than let it through.
- **Exposure if we keep reviewing with the old (single-tight-number) approach:** two rounds have now each "measured the right thing" and still been wrong, because CI only runs `ubuntu-latest` (`.github/workflows/ci.yml`) and can never validate the worst measured case (a PowerShell fallback path, p99 1051ms — 6.7x the exec-form number the last fix used). A third round chasing a tighter number has no assurance of converging.

### The problem, technically
- The plan's T11 derivation collapsed two textually distinct REQUIREMENTS.md quantities into one number: SUR-12's declared enforcement `timeout` and OPS-03's own latency budget, which the requirements' own text (`REQUIREMENTS.md:468/585`) already says must sit "far below" the timeout — not be derived as the same figure.
- Because of that collapse, every attempt to set the timeout "correctly" required first measuring the *true* worst-case invocation cost across the real deployment shape (subprocess, real shell, cross-machine variance) — a genuinely hard, possibly never-fully-closed measurement problem, when the actual requirement never asked for a tight number in the first place.
- Two smaller, real findings surfaced alongside: the plan's own disclosure about claude.ai MCP connectors was factually wrong (contradicted by `~/.claude.json`'s own `claudeAiMcpEverConnected` array), and the plan's fix for MCP-tool-gating (reading `~/.claude.json`) reads a file that, on the reviewing machine, holds a live plaintext GitHub PAT, with no field-scoping specified (Issue #89) — a `WIDENS` risk as originally written.

### Root cause
**The plan tried to derive a single, tightly-measured number to serve two requirements that the specification itself already keeps separate — chasing precision the actual requirement never asked for, instead of using the generous, already-documented default the requirement's own "far below" language licenses.**

### Options
| | Path | Cost | Risk | Analyst verdict | Architect verdict |
|---|---|---|---|---|---|
| **A** | Keep chasing a tight measured number (subprocess + real shell + cross-machine) | Open-ended — 2 rounds already spent, CI can't validate the worst case (Windows-only) | High — same defect class already recurred twice | RELOCATES | REDESIGN-REQUIRED (on this shape) |
| **B (chosen)** | **Split-budget model:** a generous, fixed, disclosed enforcement `timeout` (Claude Code's documented default + large margin — the same shape as `.claude/settings.json`'s own existing 10s-against-few-ms precedent) for SUR-12, decoupled from a separately-measured, CI-regression-tested OPS-03 latency budget whose overrun is a visible CI-10 incident, never a live bypass | Small — reuses the existing spike's measurement work as the OPS-03 alarm instead of discarding it | Low — removes the class rather than relocating it | CONTAINS | APPROVE |
| **C** | Pin exec-form via explicit `args` only | Small | Partial — closes the shell-variance axis but leaves cross-machine variance (antivirus, cold cache) open | RELOCATES (smaller) | not preferred |

**Issue #89 (reading `~/.claude.json`/`.mcp.json`):** WIDENS as originally specified (no field-scoping, no canary-secret test) → flips to CONTAINS once a names-only-extraction fixture with an explicit canary-secret test is written, covering **both** files (architecture-reviewer's addition), citing OPS-02 (`REQUIREMENTS.md:584`, P0 — "never read, log, or emit credential material").

### Council recommendation
**Path B (split-budget model) + the extended canary-secret fixture for #89.** It is licensed directly by the requirements' own already-accepted text, matches a pattern this repo has already shipped once (`.claude/settings.json`'s existing 10s-timeout-against-few-ms-cost precedent), and both other seats independently converged on it without needing to see each other's report first (impact-analyst found the architecture-reviewer's report only after publishing its own, and reconciled rather than contradicted). Strongest argument against: it accepts a wider *fail-open* window in absolute terms than a tightly-derived number would in the best case — but the tightly-derived number has never actually held in two attempts, so this trades a theoretical tight bound nobody has achieved for a real, disclosed, working one.

### Dissent
None. All three seats converged on the same path independently.

### Additional conditions folded in (architecture-reviewer, on Issue #89)
- Extend the canary-secret fixture to cover `.mcp.json` as well as `~/.claude.json` (identical risk shape).
- Add `.thoth/halt-state/` to CLAUDE.md's sensitive-areas list (session-readable, secrets-adjacent-derived).
- Cite OPS-02 explicitly in the plan's own criterion text for the MCP-enumeration fix.

**Reports:** `docs/reviews/s5-deny-by-default-hook-wiring-design-challenger-stopbrief-2026-09-06.md` · `docs/reviews/s5-deny-by-default-hook-wiring-architecture-council-2026-09-06.md` · `docs/reviews/s5-deny-by-default-hook-wiring-impact-analyst-2026-09-06.md`
