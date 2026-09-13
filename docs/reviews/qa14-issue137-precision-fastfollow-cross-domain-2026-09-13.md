# Cross-Domain Review qa14-issue137-precision-fastfollow (R1+R2)
Reviewer: cross-domain-reviewer (Ra)
Date: 2026-09-13
Scope reviewed: uncommitted working-tree diff, C:\playground\thoth (10 files, ~256 lines) - Issue #137 R1 (basename-index fallback in classifyPath) + R2 (ADR_CANDIDATE_RE digit-boundary tightening) in src/qa/reference-resolver.ts.
Tier: CRITICAL. Lanes already running/assigned: red-team (adversarial) + code-reviewer (correctness/tests) - per docs/.maat-state.json note_2026-09-13. No test-writer (no UI/API surface change - correct call, this is an internal QA CLI instrument). This review starts where those two lanes stop: the whole 35-ADR catalog (not a domain slice) and the seams between what adversarial and correctness each see from inside their own lane.

## ADR cache
CACHE HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog, fp 83b2e3e, CACHE=HIT.

## Cross-domain ADR verdict (whole catalog, not a lane slice)

DevOps ADRs (0001-0010): none apply. This diff touches no IaC, CDK, pipeline, tagging, cost, or IAM surface. Confirmed by git diff --stat - nothing under infra paths.

Software-engineering ADRs, checked against the actual code (not the plan self-report):
- ADR-0002 (multi-layer architecture): N/A. src/qa/ is an internal CLI instrument, not a layered domain/application/presentation/infrastructure app; no boundary to violate.
- ADR-0003 (SOLID, injected I/O): applies, and the diff complies. findByBasename is injected on ReferenceResolverDeps exactly like pathExists/lineCount; classifyPath calls only deps.findByBasename, never existsSync/readFileSync directly - confirmed a grep for existsSync/readFileSync on the extracted function body returns zero hits (re-verified independently, not taken on the plan claim). The stub fields added to continuation-residual-probe.ts/marker-corpus-probe.ts are not partial-interface violations - they are legitimate no-op fills of a field neither instrument reads.
- ADR-0004 (idempotency): N/A - read-only classifier, not a mutating endpoint/consumer/job.
- ADR-0005 (testing): applies, complies. 10 new unit tests cover R1 0/1/2+-match branches (including the two never-called-basename spy-count guards) and R2 digit-boundary cases; happy path, fail-closed paths, and boundary (out-of-range line) all present.
- ADR-0006 (blast radius): mostly N/A (no user-facing prod service, no lockstep multi-service deploy); the fail-closed-on-ambiguity design (2+ basename matches becomes unresolved-authority, never guess) is itself the blast-radius-limiting choice this ADR would want, and it is what is implemented.
- ADR-0010 (code quality): applies, complies - npm run typecheck / npm run lint both clean (re-ran independently, see Checks below), no suppressions added.
- ADR-0016 through ADR-0021 (governance-plugin porting / thoth-native kernel purity): N/A. None of the touched files fall under .claude-plugin/, fullstack/, or the kernel-purity boundary own pattern - src/qa/ does not match it.

Verdict on the applicability call in the plan: confirmed, not just accepted - the code was checked against all 35 ADRs directly rather than trusting the plan 4-apply/9-exclude list. No ADR collision found in a lane neither red-team nor code-reviewer would be looking from.

## Seam-hunting

This diff is single-domain (one QA instrument file plus its mechanical ripple), so there is no schema/endpoint or network/service boundary to trace. The one real seam is the flagged ripple itself:

The findByBasename ripple into continuation-residual-probe.ts (2 sites) and marker-corpus-probe.ts (1 site) is genuine, minimal, and NOT adjacent to the known bug tracked in Issue #164. Traced the actual lines: the new stub lands only inside each file top-level stubDeps/baseDeps object - a dependency-injection constant used solely to satisfy the (now-required) ReferenceResolverDeps interface for those files own unrelated bare-#N-issue-citation instruments. Issue #164 live bug is at marker-corpus-probe.ts:107/114/121 - a completely different code path (file-list-from-ref vs content-from-working-tree mismatch). git diff -- src/qa/marker-corpus-probe.ts shows exactly 3 added lines (a comment plus the stub field), nowhere near lines 107-121. Confirmed code-traced, not taken on the plan say-so.

Completeness of the ripple, verified by a running instrument, not hand-counted: ReferenceResolverDeps is referenced in exactly 7 files repo-wide (grep -rl ReferenceResolverDeps); all 4 non-test/non-core construction sites are accounted for in the diff, and more importantly npm run typecheck (tsc --noEmit) is itself the completeness proof: a missed required-field site would fail to typecheck. Ran it independently: clean, twice, after the working tree briefly (and only transiently, mid-review) diverged from and then returned to this exact diff - see note below.

Note on a transient file-state anomaly during this review (environmental, not a finding): partway through this review, src/qa/reference-resolver.ts briefly reverted to its pre-R1/R2 (HEAD) content in the working tree, then returned to the full diffed state on a subsequent read - git diff --stat at that moment showed the file absent from the changed-file list while reference-resolver.test.ts (which depends on the new findByBasename field) was still present in the diff. This resolved before drawing any conclusion from it, and git log / git stash list show no commit or stash responsible - it reads as a session/harness snapshotting artifact, not a defect in the shipped code or a second author mid-flight edit. Flagging for visibility only; it did not affect this verdict, since typecheck/lint/tests were re-run against the diff in its final, stable state (see Checks).

## Coverage gaps named

- Doc/bookkeeping files (CHANGELOG.md, docs/STATE.md, docs/decisions.md, docs/run-log.jsonl, docs/.maat-state.json) are outside both red-team and code-reviewer usual lane (adversarial/correctness on code). This is the standing gap this role spot-check exists to cover, per this task own instructions - checked, and sound: docs/decisions.md diff is a pure append (one new row at the end; git diff shows only + lines, no edits to prior rows) - the append-only convention is honored. Issue #137 real GitHub state (OPEN, confirmed via gh issue view 137) is consistent with what docs/STATE.md and docs/.maat-state.json claim this diff is building toward. Not a gap left open - named and closed by this check.
- Performance of the new whole-repo listFilesRecursive walk over the whole repo root with an always-true file predicate (added once in main(), alongside the pre-existing two smaller ADR-directory walks) is a legitimate code-reviewer-lane question (a second full-tree walk per QA-14 invocation), not a cross-domain seam - noted so it is not silently uncovered, not claimed as a finding of this review.

## Editorial (uncounted, verdict-neutral)
- docs/STATE.md new resume-point text states that docs/.maat-state.json top-level scope/tier fields are stale as of this build, still showing the prior qa14-marker-redesign story - but this same diff own docs/.maat-state.json hunk already updates scope to qa14-issue137-precision-fastfollow. Self-contradicting within the same diff; a plain-prose fix, not a functional defect.

## Checks run (demonstrated evidence, re-run independently)
- node docs/adr-cache.mjs --ensure -> CACHE=HIT, 35 ADRs.
- npm run typecheck (tsc --noEmit -p tsconfig.json) -> clean, no errors. Re-run twice across the session, stable.
- npm run lint (eslint .) -> clean, no errors or warnings.
- npm test -> 769 pass, 0 fail, 0 skipped (759 carried + 10 new). Re-run twice, stable both times.
- git diff on src/qa/reference-resolver.ts, .test.ts, continuation-residual-probe.ts (.test.ts), marker-corpus-probe.ts, docs/decisions.md, docs/STATE.md, docs/.maat-state.json, CHANGELOG.md, docs/run-log.jsonl - all read directly, in full or by targeted hunk.
- grep -rln ReferenceResolverDeps repo-wide -> 7 files, all accounted for.
- gh issue view 137 --json state,title,number -> OPEN.
- gh issue view 164 --json title,body,state -> confirmed unrelated code path to this diff ripple.

## Verdict: APPROVE

No ADR collision in a non-owned lane. The one cross-file ripple (the findByBasename stub sites) is real, minimal, and unrelated to the pre-existing, already-tracked marker-corpus-probe.ts bug (Issue #164). docs/decisions.md append-only convention is honored. Issue #137 live state is consistent with the diff own account of it. One editorial nit only (STATE.md self-contradiction on the freshness of .maat-state.json) - not gating.

Single next action: none required of this review; the story proceeds to the code-reviewer and red-team own verdicts as already queued, then /maat:verify. (Optional, non-blocking: fix the one-line STATE.md self-contradiction noted above whenever STATE.md is next touched.)

---

RECEIPT: verdict=APPROVE
findings (ALL of them, one terse line each, ranked by blast radius):
1. [CLEAN][code-traced] Whole-35-ADR-catalog sweep vs this diff - no collision outside the lane of red-team/code-reviewer (DevOps ADRs N/A, ADR-0002/0004/0016-0021 N/A, ADR-0003/0005/0006/0010 apply and are complied with).
2. [CLEAN][code-traced] findByBasename ripple into continuation-residual-probe.ts (x2)/marker-corpus-probe.ts - minimal, unavoidable (required-field typecheck ripple), and nowhere near the live ref/content-mismatch bug tracked in Issue #164 (different lines, different code path).
3. [CLEAN][demonstrated] Completeness of the ReferenceResolverDeps construction-site ripple - 7 repo-wide references, all updated; proven by a clean tsc --noEmit, not hand-counted.
4. [CLEAN][code-traced] docs/decisions.md append-only convention honored this session - diff is a pure append, no edits to prior rows.
5. [CLEAN][demonstrated] Issue #137 real GitHub state (OPEN) consistent with what this diff docs claim it is building toward.
6. [LOW][derived] Editorial: docs/STATE.md claims .maat-state.json scope/tier are stale as of this build, but this same diff own .maat-state.json hunk already updates them - self-contradicting prose, non-blocking, fix on next touch.
counts (a CHECKSUM - MUST equal the lines listed above; never truncated): issues=0 suspicions=0 clean=5
evidence (a CHECKSUM over the tags above - MUST equal them, and MUST total the counts line): demonstrated=2 code-traced=3 derived=0
(editorial item 6 excluded from counts/evidence checksum per policy - editorial findings are uncounted and verdict-neutral)
checks=typecheck:clean, lint:clean, test:769 pass/0 fail/0 skipped (x2 stable runs)
adr=HIT(35, whole catalog)
report=docs/reviews/qa14-issue137-precision-fastfollow-cross-domain-2026-09-13.md
