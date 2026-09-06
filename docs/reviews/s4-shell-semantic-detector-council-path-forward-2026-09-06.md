# Path-Forward Brief — S4 (shell-command semantic detector) — 2026-09-06

**Council verdict:** NO-GO (second stall on the same shape — no second council convened, per PRINCIPLES rule 16) · **Rounds spent:** 4 post-build review rounds + 1 council + 1 pre-build design-challenger pass · **Feature code written so far:** ~1450 lines net (`src/policy/normalizer/{shell,shell-scanner,flag-catalog,wrapper-catalog}.ts` + tests)
**Trigger:** rule 16 — second stall (2 non-clean rounds) on an architecture `/maat:council` already ruled GO on 2026-09-03, with the architecture unchanged since. Per rule 16: "A council that has to sit twice on one shape has already answered the question" — this is an automatic hard stop, not a second council.

## Business impact
- **What users cannot do today:** nothing — S4 ships as inert library code; zero production exposure either way (no hook wires it to a live session; that's S5).
- **Cost of the stall:** 4 post-build review rounds + 1 council, spanning 2026-09-02 through 2026-09-06, on a CRITICAL "historically highest-incident" component.
- **Deadline pressure:** none recorded.
- **Exposure if we ship with Issue #84 open:** 0% today (no hook wiring exists); becomes real the moment S5 wires this normalizer into a session. Security-class finding, exempt from PRINCIPLES rule 21's exposure-cap downgrade — the exemption is why this can't be waved through as a routine SHIP-WITH-CONDITIONS item without a human ruling, even at today's 0% live exposure.
- **Exposure if we keep reviewing instead of converging:** the component this milestone exists to fix stays unshipped; each round has found and fixed real bugs (13 total across 4 rounds: #68-#84), but each fix has had roughly even odds of opening one more.

## The problem, technically
- Round 3 (council-approved) fixed #80/#81/#82. Round 4's re-confirm found the #81 fix's fd-dup exclusion is itself wrong in its threshold: bash treats `>&WORD` as a **file redirect**, and only `>&DIGIT`/`>&-` as true fd-dup — the shipped code skips ANY `>&...` unconditionally. `kubectl get pods/api --context=prod >& out` clean-resolves as a read while bash actually creates and writes `out` (confirmed 4 ways against real bash); the control case one character shorter (`> out`, no trailing `&`) correctly denies. This starves the Issue #82 guard upstream — the redirect target never enters `redirectTargets`, so the assembled-target count never reaches 2.
- **This defect is not a round-4 regression** — `red-team`'s own round-3 report already carried a LOW suspicion naming this exact operator's over-denial behavior; it graded the fail-closed symptom and did not test the fail-open sibling one condition away. Disclosed by `red-team` itself, against its own round-3 work, in this round's report.
- Everything else re-verified clean: #83 and both self-found sibling exploits from round 3.5 all hold under direct attack; the new shared escape infrastructure (`isLiveGreaterThan`/`escapedChars`) survived 7 dedicated byte-verified probes; the full 37-input regression suite across all 4 rounds holds; 412/412 tests, 49/49 mutants, zero-diff to `kernel.ts` all independently re-verified.
- Structural note carried forward, not new: the "no record reaches the kernel with ≥2 targets" invariant still rests entirely on `shell.ts`'s own construction; `kernel.ts`'s `matchesTarget` is unchanged and would not itself catch a future normalizer's mistake. Already recorded as the council's NOT-COVERED backlog item.

## Root cause
Each round's fix has closed the reported instance of "a `>`-family token's live/escaped or fd-dup/file-redirect classification" correctly for the reported case, but the underlying property — bash's actual `>&` grammar has more states than this codebase's classifier has modeled (live vs. escaped, fd-dup-by-digit vs. file-redirect-by-word) — has been rediscovered one state at a time across 4 rounds rather than fully enumerated once. This is the same causal shape `red-team` named after round 3 ("a fix introduces a sibling defect in its own new code") continuing into round 4, now against a review process that is itself functioning correctly (`red-team` caught its own round-3 miss, self-corrected 3 false positives from its own test-harness escaping bug this round before finalizing).

## Options
| | Path | Cost | Risk | Notes |
|---|---|---|---|---|
| **A** | One more fix-now round for #84 (one condition + one named test, per `red-team`'s own characterization — mirrors the already-shipped `&>` both-streams handling) | Small, `shell-scanner.ts` only | Repeats the exact pattern now observed 4 times; if this ALSO opens a sibling gap, there is no mechanical process left to catch it autonomously (this brief is already the "no second council" backstop) | Cheapest if it holds; costliest if it doesn't — no more automatic backstop below this one |
| **B** | Ship S4 now with #84 open, filed as a **day-1 blocking task for S5** (the story that actually wires this normalizer to a live session — the point where 0% exposure stops being 0%) | None now | 0% live exposure today, verified (no `hooks/` directory exists); S5 cannot start without closing #84 first, so the gap is closed before it can ever be reached in practice | `red-team`'s own suggested alternative; matches this project's own precedent of shipping deliberately-scoped residuals with a named, gating unlock |
| **C** | Full re-enumeration of bash's `>`/`>&`/`&>` grammar as one exhaustive state table before any further fix (rather than patching the next discovered case) | Larger — a genuine mini-redesign of the redirect-classification logic, not a patch | Directly addresses the root cause named above; highest cost, would need its own fresh review round(s) regardless | Only path that actually stops the pattern from recurring a 5th time |

## Recommendation
No council recommendation is offered here — by rule 16, the council does not sit a second time on this shape, and this decision returns to the human by design. If asked, the Manager's own read: **Option B** is the most defensible given the evidence — #84's exposure is genuinely 0% today (mechanically confirmed, not assumed), S5 already exists as a natural gating point, and forcing one more autonomous round risks exactly the pattern this brief exists to stop. But Option C is the only option that addresses the named root cause rather than its fourth symptom, and is worth the human's explicit consideration given this is the project's own "historically highest-incident component."

## Dissent
None recorded this round — this brief reflects `red-team`'s own findings and its own proposed alternative (Option B), not a contested multi-seat verdict (no council sat this round, per the rule).

## The decision needed from you

**Issue #84** (`kubectl get pods/api --context=prod >& out` clean-resolves as a read while bash writes `out`) is open, security-class, and this is the second consecutive non-clean round since the council's GO — no further autonomous review round runs without your ruling. Choose:

- **(A)** Run one more autonomous fix-now round for #84, same process as rounds 1-4 (re-confirm required before ship).
- **(B)** Ship S4 now with #84 filed as a named, day-1-blocking task on S5 (S5 cannot begin until #84 closes) — zero live exposure today, verified.
- **(C)** Pause S4 for a small structural redesign of the `>`/`>&`/`&>` classification logic as one exhaustive state table, then resume review.

**Reports:** `docs/reviews/s4-shell-semantic-detector-red-team-round4-2026-09-06.md` · `docs/reviews/s4-shell-semantic-detector-council-path-forward-2026-09-03.md` (the first council, for context on the architecture this second stall is measured against)
