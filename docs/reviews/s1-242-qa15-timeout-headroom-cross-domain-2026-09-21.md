# s1-242-qa15-timeout-headroom -- cross-domain-reviewer report (2026-09-21)

**Reviewer:** cross-domain-reviewer (Ra)
**Scope:** branch fix/s1-242-qa15-timeout-headroom, commit 49a6ece vs origin/master.
**Tier:** STANDARD (proposed by story-implementer, ratified by Manager unchanged -- docs/run-log.jsonl:81, reason: "CI-gate timeout tuning, boring one-directional failure mode (more lenient, not less strict)").
**Story:** GitHub Issue #242 (OPEN, confirmed via gh issue view 242 -- body matches the fix's stated rationale exactly).

## Lanes that ran / ground covered

- **code-reviewer** (parallel pass, per task brief): code-quality specifics -- correctness of the timeout-threading change, whether 180s masks genuine hangs too long, and whether the two new tests are vacuous. Not duplicated here.
- **cross-domain-reviewer (this report):** whole ADR catalog (37 ADRs: devops 12, software-engineering 23, docs/adr 2) for cross-domain collision; functional correctness of the diff on its own terms; seams (ci.yml interaction, other consumers of the exported constant, CHANGELOG accuracy, QA-15 self-trip risk, independent re-measurement of the load-bearing numeric claim).
- No red-team, no infra reviewer, no app-security-reviewer dispatched -- correctly so: src/qa/completeness-claim-checker.ts is not one of CLAUDE.md's named sensitive areas, and the diff touches no IaC, IAM, secrets, or .github/workflows/ci.yml.

ADR cache: cache HIT, reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog (fp b588a48) [CACHE=HIT].

## Cross-domain ADR verdict (whole catalog, unfiltered)

Read every accepted/proposed ADR in adr/devops, adr/software-engineering, docs/adr. None collide with this diff:

- **devops ADR-0008 (CI/CD gates and policy-as-code)** -- "MUST NOT lower gate thresholds... (ratchet only)." Considered and rejected as a collision: QA-15's actual pass/fail semantic (does the claimed number match the instrument's real output) is unchanged; only the execution-timeout budget around the subprocess call moved. A timeout is not a quality/security threshold in the ADR's sense (coverage %, suppression list, severity gate) -- it is slack against a false negative on the harness itself. The direction is the boring one CLAUDE.md's tier-ratification reason names: more lenient about infra flake, not less strict about a real defect (a genuinely hung instrument still times out and fails, just after 180s instead of 60s -- that specific trade-off is code-reviewer's named lane, not re-litigated here).
- **SE ADR-0005 (Testing strategy)** -- satisfied: two new unit tests cover the new/changed behavior (headroom pinning + regression test that the real constant threads through to the runner).
- **SE ADR-0010 (Code quality and maintainability gates)** -- satisfied: no test deleted, no threshold lowered, no suppression added; the change adds a named, documented constant in place of a bare literal, which is the direction this ADR favors.
- **ADR-0021 (thoth-native architecture), ADR-0016/17/18/19/20 (governance-plugin/M1.5 porting), THOTH-ADR-0001/0002 (allowlist/fixture exceptions)** -- none applicable; this file is not the policy kernel, not a ported file, and touches neither allowlist.
- All devops IaC/CDK/tagging/cost ADRs (0001-0010) -- not applicable; no infrastructure touched.

No ADR collision found in a lane no domain reviewer owns.

## Seam findings

1. **[CLEAN] ci.yml timeout-minutes interaction.** grep -n "timeout" .github/workflows/ci.yml shows no job- or step-level timeout-minutes set anywhere in the ci job (the one unrelated hit at line 254 is OPS-03's separate S5 gate-latency-budget check, a different 60s value for a different subsystem). GitHub Actions' default job timeout is 360 minutes. Raising one instrument's internal timeoutMs from 60s to 180s cannot interact with an absent/much-larger outer bound to produce a confusing failure mode. Evidence: code-traced, .github/workflows/ci.yml:233-234 (the QA-15 step), grep above.

2. **[CLEAN] Other consumers of completeness-claim-checker.ts's exports.** grep -rln for INSTRUMENT_TIMEOUT_MS / 60_000 / completeness-claim-checker across the repo (excluding node_modules) turned up continuation-residual-probe.ts, kernel-purity-check.ts, marker-corpus-probe.ts(.test.ts), reference-resolver.ts(.test.ts), untracked-scan-warning.ts, history-scan.test.ts -- every hit is a prose comment referencing the checker by name (precedent-citation style), none imports or re-derives the timeout value. docs/decisions-archive.mjs's own STALE_MS = 60_000 is an unrelated lock-staleness threshold, not this timeout. Only the new test file imports INSTRUMENT_TIMEOUT_MS. No other consumer breaks or goes stale. Evidence: demonstrated (grep run, output inspected).

3. **[CLEAN] QA-15 self-trip risk (the project's own repeat-failure class).** DEFAULT_FILES = ["docs/STATE.md", "CHANGELOG.md"] (completeness-claim-checker.ts:328) -- the checker only scans these two files, so the new test file's prose/comments are out of its scan scope regardless. Ran the real checker against the current tree: node src/qa/completeness-claim-checker.ts -> "PASS: 2 file(s) checked, all completeness claims verified." (exit 0). The new CHANGELOG prose does not trip QA-15's own bare-claim regex. Evidence: demonstrated, raw command output above.

4. **[CLEAN] CHANGELOG accuracy.** Ran npm test in full: tests 1045 / pass 1045 / fail 0 / cancelled 0 / skipped 0 -- matches the CHANGELOG's claimed "1045 passed, 0 failed, 0 skipped" exactly. QA-15 itself: PASS, 2 files checked -- matches the claimed "PASS, 2 files checked, all claims verified." Evidence: demonstrated, raw test-runner output captured above (120.6s wall time).

5. **[CLEAN] Independent re-measurement of the load-bearing numeric claim.** This project has a documented, repeated history of shipping wrong hand-derived numeric/completeness claims (see docs/.maat-state.json's qa14-marker-redesign / Issue #154 lineage). The fix's entire rationale rests on one number: that oss-history-scan, not qa-mutation-shell, is the slowest registered instrument. Independently re-ran both on this machine rather than trusting the code comment: oss-history-scan measured 66,496ms (comment claims ~69s), qa-mutation-shell measured 23,238ms (comment claims ~23s). Both land within measurement noise of the stated figures and confirm the ordering claim. The KNOWN_INSTRUMENTS map has 16 keys resolving to 10 distinct underlying scripts; cross-checked the code comment's own list against the map by hand and it accounts for all 10 (7 sub-second groups + the 3 named slow ones) -- this is a short, flat, mechanically-enumerable object (the proportionality clause in CLAUDE.md's hand-derived-completeness-claim rule applies), and it is in fact complete, not just asserted so. 180s retains ~2.7x headroom over the independently-measured oss-history-scan runtime, not just the code comment's own figure. Evidence: demonstrated (raw timings above) + code-traced (map enumeration).

## Coverage gaps

None uncovered. The diff is three files: CHANGELOG.md (covered here -- accuracy verified against real command output), completeness-claim-checker.test.ts (code-reviewer's lane for test-quality/vacuousness; this report independently confirmed both new tests pass and the suite is green as a whole), completeness-claim-checker.ts (code-reviewer's lane for correctness; this report covered ADR/cross-cutting concerns). No infra, no API/UI surface, no sensitive area -- nothing here falls outside either lane.

## Editorial (non-gating)

- docs/STATE.md:13 still lists Issue #242 as open, undone work ("#242 (QA-15 60 s per-instrument cap; low)") in the S1 backlog summary -- stale now that this diff raises the cap to 180s. CLAUDE.md's Definition of Done requires STATE.md kept current at every close; this diff's own commit (49a6ece) does not touch STATE.md. This matches the project's own established pattern (e.g. s1-229) where the fix commit lands first and a separate "docs: close out ..." commit updates STATE.md/run-log/decisions before merge -- flagging so it isn't dropped, not blocking this diff. Fix: one-line edit removing/updating the #242 bullet in that close-out commit.

## Findings become tests

No open blocking finding exists, so there is nothing to convert to a failing test. open findings = 0, failing tests = 0 (the one LOW item is a docs-sync reminder, not a code defect with an executable form).

## Verdict

**APPROVE.**

## Single next action

Land the usual close-out commit (STATE.md's #242 bullet updated/removed, run-log/decisions rows, Issue #242 closed on merge) before merge -- no code changes required.

---

RECEIPT: verdict=APPROVE
findings (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][LOW][code-traced] docs/STATE.md:13 -- stale "#242 ... low" bullet not yet updated for this fix; one-line edit in the usual close-out commit, non-blocking.
2. [CLEAN][code-traced] devops ADR-0008 ratchet-only gate-threshold rule does not collide -- the checker's pass/fail semantics are unchanged, only the execution-timeout budget moved.
3. [CLEAN][code-traced] .github/workflows/ci.yml has no timeout-minutes at job or step level; GH Actions' 360min default leaves no confusing-failure-mode interaction with the new 180s instrument cap.
4. [CLEAN][demonstrated] grep across the repo found no other consumer of INSTRUMENT_TIMEOUT_MS or the old 60_000 literal tied to this checker; only the new test imports it.
5. [CLEAN][demonstrated] QA-15 run against the real tree (node src/qa/completeness-claim-checker.ts) exits 0 -- the new CHANGELOG prose does not trip QA-15's own bare-claim regex; the test file's comments are out of DEFAULT_FILES's scan scope regardless.
6. [CLEAN][demonstrated] npm test 1045/1045 pass, 0 fail, 0 skipped and QA-15's own PASS output both match the CHANGELOG's stated counts exactly.
7. [CLEAN][demonstrated] independently re-timed oss-history-scan (66,496ms) and qa-mutation-shell (23,238ms) -- confirms oss-history-scan is genuinely the slowest instrument and the map's instrument enumeration in the code comment is complete (10/10 distinct scripts accounted for).
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=1 suspicions=0 clean=6
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=4 code-traced=3 derived=0
checks=npm test 1045/1045 pass, 0 fail, 0 skipped; QA-15 self-run PASS (2 files); oss-history-scan re-timed 66496ms; qa-mutation-shell re-timed 23238ms
adr=HIT(37, whole catalog)
report=docs/reviews/s1-242-qa15-timeout-headroom-cross-domain-2026-09-21.md
