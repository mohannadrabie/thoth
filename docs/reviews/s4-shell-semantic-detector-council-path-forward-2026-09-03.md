# Path-Forward Brief — S4 (shell-command semantic detector) — 2026-09-03

**Council verdict:** GO · **Rounds spent:** 2 post-build review rounds (+ 1 pre-build design-challenger pass) · **Feature code written so far:** ~1050 lines (net insertions across `src/policy/normalizer/{shell,shell-scanner,flag-catalog,wrapper-catalog}.ts` + tests)
**Trigger:** rule 16(c) — 2 consecutive REWORK/no-go Stage-3 verdicts on S4 (red-team no-go→no-go, cross-domain REWORK→REWORK), no intervening clean round.

## Business impact
- **What users cannot do today:** nothing yet — S4 ships as inert library code; no hook wires it to a live session (that's S5). Zero production exposure either way.
- **Cost of the stall:** 2 review rounds, 3 council seats, ~1 elapsed day, on a CRITICAL "historically highest-incident component" story.
- **Deadline pressure:** none recorded.
- **Exposure if we ship with the current residuals:** 0% live today (no hook wiring exists); becomes real the moment S5 wires this normalizer into a session — all 3 open findings are security-class, exempt from the exposure-cap downgrade (PRINCIPLES rule 21), so none are eligible to ship deferred regardless of today's 0% live number.
- **Exposure if we keep reviewing instead of converging:** the component this milestone exists to fix ("historically highest-incident") stays unshipped.

## The problem, technically
- Round 1 fixed 9 real findings (4 HIGH functional bypasses + 5 others). Round 2's re-confirm found round 1's own fix for Issue #73 ("collect every resource token, not just the first") opened two new HIGH gaps: a normalizer-layer token-exclusion bug (#80, quoted `"&gt;"` swallows the following token) and a kernel-layer gap (#82, `kernel.ts`'s `matchesTarget` — unchanged since S2 — was never audited against a multi-target `ActionRecord`, a shape that didn't exist before this story).
- `impact-analyst` independently demonstrated a third, more severe instance of the same kernel gap during path-pricing: `kubectl delete pods/api --context=prod > /etc/cron.d/pwn` bundles an arbitrary file write onto an authorized delete via a **single** resource token plus an unquoted redirect — not caught by a naive "deny when >1 resource token" guard, since the second target comes from the redirect-collection path, not resource collection. Logged as an additional PoC on Issue #82 (same root cause), not a new Issue.
- `design-challenger`'s Stop Brief confirms all 14 round-1 items are genuinely closed (independently re-verified) and that no OPEN finding calibrates as a blocking HIGH under this project's own reach-based calibration (no live hook wiring exists yet) — but both #80 and #82 are security-boundary-relevant silent divergences, so the boundary-crossing carve-out mandates a day-1 proof-test for each regardless of the MED cap.
- Side-finding, unrelated to S4's own gate: the last 5 CI runs on `master` have all failed (`adr` submodule unreachable to the Actions runner) — pre-existing since S1, needs a separate human fix, not part of this council's scope.

## Root cause
Issue #73's fix took the costlier of two branches SUR-06's own acceptance text permits — "collect every resource and report the array" — instead of the cheaper "detect a multi-target shape and deny wholesale" branch this same story already chose for the sibling chain-operator case; that costlier branch built a multi-target `ActionRecord` shape that `kernel.ts`'s `matchesTarget` (shipped in S2, true-at-the-time single-target-only) was never re-derived against.

## Options
| | Path | Cost | Risk | Analyst verdict | Architect verdict |
|---|---|---|---|---|---|
| **A** | Kernel-side: `matchesTarget`/`decide()` requires full target coverage for ALLOW | Small, 1 file (`kernel.ts`), mathematically a no-op on all 24 existing single-target test sites | Reopens the story's "zero diff to kernel.ts" invariant (disclosed cost, not free) | SAFE-TO-PATCH (recommended) | Not preferred — avoid touching `kernel.ts` for this story |
| **B** | Normalizer-only: deny (`unresolved`) whenever the assembled record would carry ≥2 targets from ANY combination of resource-collection + redirect-collection (broadened per impact-analyst's condition, not resource-token count alone) | Small, `shell.ts` only | Closes #82 and the redirect-based PoC at the boundary before `kernel.ts` ever sees a multi-target record | PATCH-WITH-CONDITIONS (safe only with the broadening) | Preferred — honors zero-diff-to-kernel |
| **C** | Ship with #80/#81/#82 open, deferred | None now | Security-class findings, exempt from the exposure-cap downgrade; already litigated and blocked on twice this story | WIDENS — ruled out | — |

## Council recommendation
**Path B, broadened per impact-analyst's explicit condition** — normalizer-boundary collapse: deny via `unresolved` whenever the assembled target count (resource tokens **and** redirect targets combined) reaches 2 or more, not scoped to resource-token count alone. This reconciles both seats: it stays normalizer-only (honoring the architect's stated preference and the story's zero-diff-to-kernel commitment) while closing impact-analyst's stronger compound-redirect instance too, which a narrower "≥2 resolved resources" guard would have missed. Paired with: (1) a position-based fix for #80 (redirect exclusion by position, not token value — architecture-reviewer's own fix, closes #80 and the quoting-specific half of the redirect PoC as a side effect), (2) an fd-dup exclusion clause for #81, (3) two day-1 failing proof-tests for #80/#82 per design-challenger's boundary-crossing mandate, (4) a `docs/decisions.md` row recording the NOT-COVERED architectural question this seam surfaced — what an ALLOW rule means against a multi-target `ActionRecord` in general — as a named backlog item for whichever future normalizer next emits >1 target, so the next one inherits an answer instead of rediscovering this seam.

**Strongest argument against:** Path A (kernel-side) is the only option that retires the *general* risk for every future multi-target-emitting normalizer, not just S4's own boundary; Path B leaves that general question open, deliberately deferred to the recorded backlog item rather than solved now.

## Dissent
`impact-analyst` recommended Path A (kernel-side) as its primary path, not Path B — its stated reasoning: Path A is "mathematically a no-op" on all existing tests and closes the risk at its structural root (`kernel.ts`) rather than at every individual producer's boundary. `architecture-reviewer` recommended Path B, preferring to honor the story's zero-diff-to-kernel commitment and keep the kernel-layer question as a separately recorded, deliberately-deferred decision rather than a same-story fix. The Manager sides with the architect's shape call (Path B, broadened) because S4's own scope was already ratified (2026-09-02 decisions.md rows) as normalizer-layer-only with zero kernel diff, and re-opening that boundary now — mid-story, under review pressure — is exactly the kind of opportunistic scope-widening ADR-0006 warns against; the general kernel-layer question is real but belongs to whichever story next needs to reason about multi-target ALLOW semantics, recorded now so it isn't silently lost.

## GO — no human ruling needed
No open calibrated blocking HIGH; architect's substantive recommendation (Path B, broadened) is council-approved with conditions; impact-analyst's own condition for Path B ("broadened to guard both collection paths jointly") is folded into the synthesized path; gating verification (full test suite + `qa:mutation-shell`) is scheduled as build task #1 of the next round. The loop continues autonomously — routed to `story-implementer` now.

**Reports:** `docs/reviews/s4-shell-semantic-detector-design-challenger-stopbrief-2026-09-03.md` · `docs/reviews/s4-shell-semantic-detector-architecture-council-2026-09-03.md` · `docs/reviews/s4-shell-semantic-detector-impact-analyst-2026-09-03.md`
