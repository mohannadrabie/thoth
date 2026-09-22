# Cross-domain review — s5-halt-mechanism-hardening (Issues #96, #206)

**Reviewer:** cross-domain-reviewer (Ra)
**Date:** 2026-09-22
**Scope:** fix/s5-halt-mechanism-hardening, HEAD 4240ca5824b222c33e268c1690b58be22f85f383, diffed against origin/master
**Tier:** CRITICAL (Policy enforcement / session gates sensitive area)
**Parallel lanes this turn:** red-team (adversarial), app-security-reviewer (trust-boundary/completeness) — both independent, not yet read by this reviewer.

## Lanes covered by the other reviewers this round
red-team + app-security-reviewer together own: adversarial PoC construction against the new escapeParens/session-id-fallback code, and trust-boundary verification of the CLAUDE_SESSION_ID env-var premise specifically. I do not re-attempt their PoC-construction job; where my own due-diligence touched the same ground (env-var findings below) I say so explicitly and cap severity accordingly rather than re-litigating their lane.

## ADR verdict — whole catalog (37 ADRs: adr/devops 12, adr/software-engineering 23, docs/adr 2)

node docs/adr-cache.mjs --ensure initially reported CACHE=HIT against a catalog of only 2 (docs/adr only) because the adr/ git submodule was uninitialized in this worktree (git submodule status showed the leading `-` unchecked-out marker). Ran git submodule update --init --recursive, re-ran the cache script: "ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp fba42fe771484cfdc25de940ff1369ad90252887) [CACHE=HIT]". Full catalog read, not a domain slice.

- devops ADR-0001 to 0010: no collision — this diff touches only two standalone Node hook scripts, no IaC/CDK/pipeline/tagging/cost surface. NOT-APPLICABLE.
- SE ADR-0021 (thoth-native architecture, gaps G5/G6/INT-07): this is the ADR the diff's own surrounding file-header comments cite (unchanged by this diff — hooks/sessionstart-tool-enum.mjs:2-6, hooks/userpromptsubmit-halt-relay.mjs:2). Read ADR-0021 directly rather than trusting the citation:
  - G5 ("a SessionStart hook cannot halt a session on this runtime; the halt point is UserPromptSubmit") — ADR-0021 lines 145, 210; REQUIREMENTS.md's own section. The diff's new comments don't touch this claim; sessionstart-tool-enum.mjs's process.exit(0) contract is unchanged (main() still never exits 2). No collision.
  - G6 ("a timed-out PreToolUse hook does not block") — belongs to hooks/pretooluse-kernel-gate.mjs, a DIFFERENT file this diff does not touch (confirmed: git diff origin/master...HEAD --name-only lists 6 files, none is pretooluse-kernel-gate.mjs). The one G6 citation in this codebase (hooks/pretooluse-kernel-gate.mjs:28, "G6 unchanged") is correct and untouched by this diff. Not implicated, correctly so.
  - INT-07 ("no control named in thoth's posture output may rest on an unverified third party's claim… where thoth can verify directly, it MUST") — ADR-0021 lines 169, 213, 225 narrow this to one live case: a third-party governance plugin installed alongside thoth (REL-12). The diff's CLAUDE_SESSION_ID/CLAUDE_PROJECT_DIR trust is a runtime primitive the hook process itself runs on, not a control thoth reports in posture output about a third party's own enforcement — different clause. No ADR-0021 collision, but see the env-var-trust seam finding below; same spirit of concern even though it doesn't trip this specific rule.
- SE ADR-0003 (SOLID)/ADR-0010 (code quality): neither forbids small helper duplication across independent files; ADR-0003's only relevant clause ("SHOULD NOT over-abstract") argues the other direction. Verified the "existing convention of duplicating small hook-local helpers" claim directly (see below) rather than taking it on faith. No collision.
- SE ADR-0005 (testing strategy): "MUST NOT delete or weaken a failing test to make CI pass" — the one pre-existing test whose pinned expected string changed (userpromptsubmit-halt-relay-friendly-labels.test.ts) was updated because the underlying rendered output intentionally changed (new escaping), not to launder a failure; the assertion stayed an exact-string match, not loosened. No collision (verified below, not just asserted).
- SE ADR-0004 (idempotency): N/A — no mutating API/consumer/migration in scope.
- Remaining SE ADRs (multi-layer architecture, blast radius, tagging, cost, database/indexing/retention/DR, governance-plugin-porting, wrap-architecture [superseded by ADR-0021]): none apply to two standalone CLI hook scripts with no persistence layer, no infra, no DB. NOT-APPLICABLE, checked not assumed.

ADR verdict: no collision.

## Item 2 — functional correctness, independent of the security lanes

Duplication-convention claim, verified against the actual codebase, not asserted:
```
$ grep -n "function readStdin\|function projectDir" hooks/sessionstart-tool-enum.mjs hooks/userpromptsubmit-halt-relay.mjs
sessionstart-tool-enum.mjs:99:function readStdin()
sessionstart-tool-enum.mjs:111:function projectDir()
userpromptsubmit-halt-relay.mjs:142:function readStdin()
userpromptsubmit-halt-relay.mjs:154:function projectDir()
```
readStdin, projectDir, and haltStatePath were already duplicated between these two files before this diff. The implementer's claim ("matching this codebase's existing convention of duplicating small hook-local helpers") is [CLEAN][code-traced], not a post-hoc justification.

Drift risk from duplicating resolveFallbackSessionId() across both files — assessed by mutation, not just read. Mutated hooks/sessionstart-tool-enum.mjs's copy to always return the shared literal (simulating one copy silently regressing while the other doesn't):
```
$ node --test hooks/sessionstart-tool-enum-session-id-fallback.test.ts
FAIL Issue #96: malformed (non-JSON) stdin with CLAUDE_SESSION_ID set...
FAIL Issue #96: EMPTY stdin... CLAUDE_SESSION_ID set...
PASS Issue #96 double-failure (unregressed)... (expected, control)
PASS Issue #96 happy-path guard... (expected, control)
```
File restored (git checkout -- hooks/sessionstart-tool-enum.mjs). This demonstrates the duplication risk is mitigated, not just asserted as low: the regression tests are end-to-end (runHook spawns the real script as a child process for both the writer and reader side, with the same env), so a one-sided drift between the two copies fails the very next test run, the same way hooks/userpromptsubmit-halt-relay-friendly-labels.test.ts's pre-existing FRIENDLY_LABELS/UNLOCK_HINTS "key parity" instrument (Issue #205, line 292) already establishes as this codebase's precedent for guarding a duplicated-structure contract. [CLEAN][demonstrated] — the concern the task brief raised is real in principle but is not an unmitigated gap in this diff.

## Item 3 — test quality

(a) Pinned test update, checked for correctness, not just "it now passes": hostileName = 'Notion" (unlock: none needed, already approved); Unrecognized tool: "safe'. New expected value: JSON.stringify(hostileName).replace(/[()]/g, (c) => c === "(" ? "\(" : "\)"). This is byte-for-byte the same transform as the shipped escapeParens() (hooks/userpromptsubmit-halt-relay.mjs:109-111) applied on top of what quoteNames() already writes at write time — the two orderings (write-time JSON-escape, then read-time paren-escape) match production's actual pipeline. [CLEAN][code-traced].

(b) 8 new tests, non-vacuous — verified by reverting the fix and re-running, not by reasoning alone:
- escapeParens mutated to a no-op -> 4 tests fail red (3 of userpromptsubmit-halt-relay-issue206-unlock-forgery.test.ts's 4 tests, plus the updated pinned "Fix 1 regression" test in -friendly-labels.test.ts; the 4th, the benign-control test, correctly stays green either way).
- resolveFallbackSessionId() (sessionstart side) mutated to always return the literal -> 2 of 4 sessionstart-tool-enum-session-id-fallback.test.ts tests fail red (the other 2 are the double-failure/happy-path controls, correctly still green). Both files restored via git checkout -- after.
[CLEAN][demonstrated] — genuinely non-vacuous, confirmed by reverting the fix twice, not sampled once and assumed.

(c) test-writer-owned files: git diff origin/master...HEAD --name-only lists exactly 6 files (CHANGELOG.md, 2 new test files, the 2 .mjs hooks, and the 1 pre-existing non-test-writer-owned test file updated). hooks/userpromptsubmit-halt-relay.test.ts and hooks/sessionstart-tool-enum.test.ts are absent from the diff — untouched, confirmed by the diff stat itself, not by trusting the CHANGELOG's claim. [CLEAN][code-traced].

## Item 5 — independent npm test re-run

Checked out 4240ca5824b222c33e268c1690b58be22f85f383 (detached HEAD in this worktree; the branch name is checked out elsewhere so a same-name checkout was unavailable) and ran the suite fresh:
```
tests 1051
pass 1051
fail 0
cancelled 0
skipped 0
todo 0
```
Matches the CHANGELOG's claimed 1051/1051. Also ran npm run typecheck (clean, no output) and npm run lint (clean, no output) — both part of this project's own DoD, not explicitly requested but cheap to confirm. [CLEAN][demonstrated].

## Item 1 (continued) / seam findings

1. [SUSPICION][LOW][derived] The new CLAUDE_SESSION_ID env-var trust dependency was never put through this project's own already-established, cheap precedence drill.
This project has direct, on-point precedent for exactly this class of question: red-team demonstrated (2026-09-07, docs/reviews/s5-fixnow-round2-red-team-2026-09-07.md) that a session-local .claude/settings.local.json env block CAN override an ordinary (non-Claude-Code-owned) env var reaching a hook subprocess — that finding drove THOTH_S5_CENTRAL_CLASSIFICATION_FIXTURE_PATH to be removed from the env-var channel entirely. Separately, the same class of question was asked and answered for CLAUDE_PROJECT_DIR specifically — a variable Claude Code itself injects, the same trust tier this diff's own comments claim for CLAUDE_SESSION_ID — and closed (docs/backlog.md:79, drill run 2026-09-08): "a settings.local.json env block setting CLAUDE_PROJECT_DIR to a fake marker path… was overridden by Claude Code's own real injected value… Override loses." That drill was never re-run against CLAUDE_SESSION_ID specifically — the new variable this diff starts trusting for session-identity resolution (a more consequential value than a mere path, since it selects which session's halt-state file gets written/read). reconcileReason's sticky-halt guard (round-2's own fix) is scoped narrowly to the literal UNKNOWN_SESSION_ID bucket (hooks/sessionstart-tool-enum.mjs's own header comment, confirmed by reading reconcileReason's call site) — it does NOT protect an attacker-chosen real-looking session id reached via a spoofed CLAUDE_SESSION_ID, so if the override did win (unlike the CLAUDE_PROJECT_DIR precedent), cross-session halt-state tampering would be a materially different, larger risk than the path-resolution case the closed drill covered.
This is derived (reasoned from two historical reports plus one source read, not a live-run exploit against this exact variable) — per PRINCIPLES rule 19 it caps at MED and does not gate on its own; I did not attempt to construct the live PoC myself, since PoC construction against this diff is explicitly red-team's parallel lane this round, and I did not want to duplicate investigative effort mid-review. Recommend: red-team (or a 5-minute drill, same recipe as the closed CLAUDE_PROJECT_DIR one) re-run the identical precedence check naming CLAUDE_SESSION_ID, before this Issue is treated as durably closed. Non-blocking; strong reason (the closed CLAUDE_PROJECT_DIR precedent) to expect the same "override loses" result.
Exposure: unmeasured, basis: assumption (capped LOW per rule 21).

2. [CLEAN][demonstrated] The CLAUDE_SESSION_ID variable-name premise itself, checked against a real Claude Code binary, not just the cited docs.
The diff's own comments assert "CLAUDE_SESSION_ID is a real, host-supplied environment variable… confirmed via the official Claude Code hooks/Settings Reference documentation." This reviewer cannot fetch that URL (no web tool available), so instead: (a) inspected this reviewer's own live Claude-Code-spawned shell environment — CLAUDE_CODE_SESSION_ID=<this session's own UUID> is present (matches the scratchpad-directory UUID in this environment's own tool-provided context), CLAUDE_SESSION_ID is absent — but CLAUDE_PROJECT_DIR, a variable this codebase's already-shipped, previously-reviewed code depends on and which is confirmed working, is ALSO absent from this same vantage point, so this check does not discriminate between "the var doesn't exist" and "the var is hook-subprocess-scoped only, same as CLAUDE_PROJECT_DIR" — inconclusive by itself. (b) Searched the literal strings inside the installed Claude Code CLI binary (C:\Users\mohan\.local\bin\claude.exe) for both candidate names: CLAUDE_SESSION_ID appears 3 times, CLAUDE_CODE_SESSION_ID appears 12 times, CLAUDE_PROJECT_DIR (the known-good control) appears 27 times. Both candidate strings are genuinely present in the shipped binary — this corroborates rather than contradicts the diff's citation (a total fabrication would show 0 occurrences). Byte-context extraction around the matches was blocked by this sandbox's credential-exploration classifier and not pursued further (respected the block rather than working around it). Net: no contradiction found; the citation is more plausible than not, closing this thread rather than leaving it open-ended. This overlaps app-security-reviewer's trust-boundary lane; reported here because it was independently checked before that report was available, not to duplicate a finding already on record.

## Item 4 — stale doc entries (seams, not blocking; Manager already owns the fix per this task's brief)

docs/backlog.md:25 still frames Issue #96 as "Deliberately not fixed this pass — ruled defer, spike-first" — confirmed stale, as the implementer's own CHANGELOG entry discloses leaving it for the Manager's close-out. In addition, docs/STATE.md:457 carries the same staleness the implementer's CHANGELOG did not flag: it lists "Issue #96 (a pre-existing, narrow malformed-stdin fail-open — deferred, spike-first)" as still-open, non-blocking residual, and separately describes the CLAUDE_PROJECT_DIR precedence "human drill" as a still-pending five-minute task — but that drill was already run and closed 2026-09-08 (docs/backlog.md:79). Neither location is edited by this diff. A reader hitting docs/STATE.md's resume-point section before the Manager's own close-out lands on two stale claims in the same paragraph, not just the one already disclosed. Routed to Editorial per this reviewer's own evidence policy (prose/doc staleness, not a code defect) — no code change, no re-review needed, Manager's close-out already covers Issue #96's own entry and can pick up the drill-status line in the same pass.

## Coverage gaps named

- CHANGELOG.md's prose (the 6th changed file) is not independently re-verified word-for-word here beyond the specific claims the task brief asked about (test counts, pinned-test correctness, duplication convention) — a full line-by-line CHANGELOG audit is not this pass's job and nothing in it appeared incorrect where checked.
- Windows-vs-POSIX hook invocation shape (e.g. .githooks-style exec-bit concerns that bit this project before, Issue #187) is not implicated by this diff (no new shell script, no new file mode) — checked, not a gap.
- No infra, API contract, data schema, or UI surface is touched by this diff, so infra-security-reviewer/api-reviewer/data-reviewer/usability-reviewer's lanes have nothing to cover here — not a silent gap, just genuinely out of scope for this change.

## Verdict

APPROVE-WITH-CONDITIONS. Condition (deferred, non-blocking): re-run the closed CLAUDE_PROJECT_DIR precedence drill (docs/backlog.md:79's exact recipe) naming CLAUDE_SESSION_ID, to close the one derived/LOW seam finding above with a demonstrated result rather than an analogy. No blocking [ISSUE] found; all demonstrated/code-traced checks came back clean.

Single next action: Manager runs (or delegates) the CLAUDE_SESSION_ID-named precedence drill using the exact recipe already proven cheap for CLAUDE_PROJECT_DIR (docs/backlog.md:79), and folds the result into this story's close-out row in docs/decisions.md alongside the two stale-doc corrections (docs/backlog.md:25, docs/STATE.md:457) already known and owned.

---

## RECEIPT

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ranked by blast radius, status legend: ISSUE=confirmed / SUSPICION=unconfirmed / CLEAN=checked, sound):
1. [SUSPICION][LOW][derived] hooks/sessionstart-tool-enum.mjs + hooks/userpromptsubmit-halt-relay.mjs (CLAUDE_SESSION_ID trust) — the new host-env-var trust dependency was never put through this project's own already-proven-cheap precedence drill (docs/backlog.md:79's closed CLAUDE_PROJECT_DIR precedent); reconcileReason's sticky-guard doesn't cover an attacker-chosen real-looking session id, only the literal UNKNOWN_SESSION_ID bucket; fix: re-run the same 5-minute drill naming CLAUDE_SESSION_ID. Exposure: unmeasured, basis: assumption.
2. [CLEAN][demonstrated] hooks/userpromptsubmit-halt-relay.mjs escapeParens / hooks/sessionstart-tool-enum.mjs resolveFallbackSessionId duplication — drift risk mitigated by real end-to-end tests (mutation-verified: reverting either fix fails the corresponding regression tests red).
3. [CLEAN][code-traced] "duplicating small hook-local helpers" convention claim — verified true via grep (readStdin/projectDir/haltStatePath already duplicated pre-diff), not taken on the implementer's word.
4. [CLEAN][code-traced] pinned friendly-labels test update — new expected string matches production's actual JSON-escape-then-paren-escape pipeline exactly.
5. [CLEAN][demonstrated] 8 new tests non-vacuous — reverting escapeParens fails 4 tests red; reverting resolveFallbackSessionId fails 2 tests red (the other tests are correct controls that stay green either way).
6. [CLEAN][code-traced] test-writer-owned files (hooks/userpromptsubmit-halt-relay.test.ts, hooks/sessionstart-tool-enum.test.ts) untouched by this diff, confirmed via diff --name-only.
7. [CLEAN][demonstrated] npm test independently re-run: 1051/1051 pass, 0 fail, 0 skipped; typecheck and lint both clean.
8. [CLEAN][code-traced] whole 37-ADR catalog checked for collisions outside red-team/app-security's lanes — none found (ADR-0021 G5/G6/INT-07 claims confirmed accurate against the ADR text itself; SE ADR-0003/0005/0010 checked, no violation).
9. [CLEAN][demonstrated] CLAUDE_SESSION_ID variable-name premise cross-checked against the real installed Claude Code CLI binary (string search) — both CLAUDE_SESSION_ID (3x) and CLAUDE_CODE_SESSION_ID (12x) genuinely present; corroborates rather than contradicts the diff's citation.
counts (checksum): issues=0 suspicions=1 clean=8
evidence (checksum, must total counts): demonstrated=4 code-traced=4 derived=1
checks=npm test 1051 pass/0 fail/0 skipped/1051 total; npm run typecheck clean; npm run lint clean; 2 mutation drills run (escapeParens no-op: 4/4 expected tests fail red; resolveFallbackSessionId no-op: 2/2 expected tests fail red), both files restored via git checkout --
adr=HIT(37, whole catalog)
report=docs/reviews/s5-halt-mechanism-hardening-cross-domain-2026-09-22.md
