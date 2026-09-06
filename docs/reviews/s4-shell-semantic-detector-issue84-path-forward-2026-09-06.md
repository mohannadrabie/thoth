# Path-Forward Brief — S4 (shell-command semantic detector) — Issue #84 fix-now round — 2026-09-06

**Trigger:** rule 16(c), second stall on the same review target. Round 3 (no-go), round 4 (no-go) already tripped this once on 2026-09-06 — human ruled Option B (ship S4, close #84 before S5 build starts, confirmed via red-team re-confirm). This round is that mandated re-confirm. It came back **no-go a third consecutive time** on the same code path (`shell-scanner.ts`'s `>&` classification), with no intervening clean/conditional-clean verdict since round 3. Per `docs/decisions.md`'s 2026-09-06 autonomous-continuation row, logged *before* this round returned: "a second trip on the same shape stays a hard stop to the human regardless of this authorization." Honoring that now — no further autonomous fix-now round runs without your ruling, even though you said to go ahead in general.

**Rounds spent on this exact function since S4's build:** #81 (round 3, fixed) → #83 (round 3.5, fixed) → #84 (round 4, found) → **this round** (round 5, `story-implementer`'s #84 fix half-worked, `red-team` found the fix's own residual). Four consecutive HIGH findings against the same `>`/`>&`/`&>` classification code.

## What happened this round

`story-implementer` fixed Issue #84's literal repro (`kubectl get pods/api --context=prod >& out` now correctly denies — proven by `red-team`'s own `git stash` A/B, not just a passing test). 425/425 tests, 52/52 mutants, zero diff to the kernel boundary.

`red-team`'s mandated re-confirm did not take that on faith — it built a real bash 5.3.9 oracle (25 redirect forms, ground truth) and attacked the live code directly. **Verdict: no-go.** The fix is real but reads one character where bash reads a whole word:

```ts
// src/policy/normalizer/shell-scanner.ts:360-361 (as fixed this round)
const afterAmpersand = liveText[idx + length + 1];
const isFdDup = afterAmpersand === "-" || (afterAmpersand !== undefined && /\d/.test(afterAmpersand));
```

bash's actual rule (measured, not assumed): `>&WORD` is fd-dup **iff** WORD is entirely digits or starts with `-`. A word that merely *begins* with a digit — the single most ordinary filename shape in ops, a date-stamped log — is a real file redirect. Demonstrated against the live fixed code:

```
ALLOW  kubectl get pods/api --context=prod >&2026-09-06.log     <- still a write-target vanish
DENY   kubectl get pods/api --context=prod >& 2026-09-06.log    <- one space added
DENY   kubectl get pods/api --context=prod > 2026-09-06.log
```

Same defect as Issue #84 itself, one character to the right of what round 4 caught.

**The good news: the unlock is already proven, not proposed.** `red-team` applied a 2-line candidate fix (reusing the `tokenize` the caller already invokes one line later) to an isolated copy of `src/` and ran it against its own 25-form bash-conformance table **and** the full 143-test normalizer suite:

```ts
const [fdWord] = tokenize(liveText.slice(idx + length + 1));
const isFdDup = fdWord !== undefined && (fdWord.startsWith("-") || /^\d+$/.test(fdWord));
```
→ 25/25 conformance, 143/143 existing tests, as a side effect also fixes 5 fail-closed over-denials the current fix introduces (`>&"2"`, `>&\2`, `>& -x`, `2>&out`, `>>&out`).

Everything else red-team attacked survived: the `&>` synonym, genuine fd-dup forms including dash-prefixed words (`>&-x`), the round-3.5 escape/quote-liveness class (not reintroduced — structurally unreachable, proven), the Issue #82 assembled-target guard interlock, and the full gate suite. Full report: `docs/reviews/s4-shell-semantic-detector-red-team-round5-2026-09-06.md`.

## The pattern red-team itself named (worth weighing, not just the bug)

> "The same assumption has now produced a HIGH finding in consecutive rounds against this one function (#81, then #83, then #84, now this). Each fix was narrowed to the exact repro the previous report handed over, and each time the class survived one character to the left or right... a design signal, not a coincidence."

This round's proposed fix is qualitatively different from the prior three patches in one respect red-team called out itself: it's the first one graded against a **measured external oracle** (real bash, 25 forms) rather than against the single repro string it was handed. That's a real, if untested-by-round, mitigation against the recurrence pattern — but it's still a patch to the same function, not the state-table redesign the first brief's Option C named as the only path that actually stops the pattern.

## Options

| | Path | Cost | Risk | Notes |
|---|---|---|---|---|
| **A** | Apply `red-team`'s own proven 2-line fix, land its 25-case bash-conformance table as a committed test, re-anchor the 2 stale mutants it names, then one final `red-team` re-confirm (not from scratch — confirming the applied diff matches the already-validated candidate) | Small, same file | Lowest of the three fix options — the fix is pre-validated against a real oracle, not a fresh guess; still the same function that's produced 4 straight HIGHs | Fastest path to closing #84 for real |
| **B** | Same as A, but skip the final `red-team` re-confirm — trust the isolated-copy validation red-team already ran | None extra | Violates this project's own "trust the receipt, never the fix claim" discipline (every prior S4 fix-now round required independent re-confirm); not recommended | — |
| **C** | Pause and do the exhaustive `>`/`>&`/`&>` state-table redesign now (this brief's first-round Option C, still not taken) | Largest — a real mini-redesign | Only option that addresses root cause rather than a 5th symptom; the human declined this once already at lower cost (round 4) | Worth naming again now that the pattern has repeated a 4th time |

## Recommendation

**Option A.** The fix is no longer speculative — it's proven against a real bash oracle and the full existing suite, which is a materially stronger starting point than rounds 1-4's repro-shaped patches. The remaining risk is the recurrence pattern itself, not this specific fix's correctness; a fast, cheap final re-confirm (not a full new round) closes that gap without the cost of Option C. If the human's appetite has shifted after four rounds of the same shape, Option C is the only path that stops it recurring a 5th time — but that's your call given this component's own "historically highest-incident" designation, not mine to make unilaterally given the standing carve-out.

## Dissent

None — `red-team`'s own report already names both the fix and the concern; no contested multi-seat verdict this round.

## Session state (why I stopped here rather than acting)

Working tree currently has `story-implementer`'s round-5 fix (uncommitted) plus `red-team`'s report, `docs/REVIEW_LOG.md` row, and the Issue #84 comment (both already self-persisted by red-team). Issue #84 **stays open** — not closed, per red-team's explicit verdict. Nothing has been committed or pushed. `docs/.maat-state.json` updated: `reviewRoundsSinceClean: 3`, `humanRulingRequired: true`.

## The decision needed from you

- **(A)** Apply `red-team`'s proven fix, land the conformance table, one fast final re-confirm, then close #84 and proceed to S5. *(Recommended.)*
- **(B)** Same fix, skip the final re-confirm. *(Not recommended — breaks this project's own discipline.)*
- **(C)** Pause for the full state-table redesign of `>`/`>&`/`&>` classification before touching #84 again.

**Reports:** `docs/reviews/s4-shell-semantic-detector-red-team-round5-2026-09-06.md` (this round, full detail) · `docs/reviews/s4-shell-semantic-detector-council-path-forward-2026-09-06.md` (the first stall, for context)
