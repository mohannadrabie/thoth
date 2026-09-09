# cifix — Cross-Domain Review (Ra), ROUND 2 re-confirm

**Scope:** `docs/.maat-state.json` scope `cifix`, CRITICAL tier. Round 1: `docs/reviews/cifix-cross-domain-2026-09-09.md` (APPROVE-WITH-CONDITIONS -- 1 HIGH: restoring checkout would move CI's failure point to QA-14/QA-15, pre-existing Issue #120; 1 LOW: no persisted Phase 1 plan). Since round 1: human ruled (`docs/decisions.md` 2026-09-09 "Stage-3 round 1" row) to widen scope to also fix Issue #113; `docs/plans/cifix-phase1-2026-09-09.md` persisted this round. Diff now: `.github/workflows/ci.yml`, `src/secret-scan/patterns.ts`+`.test.ts`, `docs/backlog.md`, `CHANGELOG.md`, `docs/.maat-state.json`, `docs/decisions.md`, `docs/REVIEW_LOG.md`, `docs/run-log.jsonl`, `docs/plans/cifix-phase1-2026-09-09.md` (new).

**Lanes running in parallel this round (not re-covered here):** `red-team` and `infra-security-reviewer`, both re-confirming their own round-1 findings (Issues #125/#126/#127/#128, the credential-handling mechanism) against the fixed code. This pass reads the WHOLE ADR catalog and hunts the seam between lanes.

## ADR cache
ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog -- fp 83b2e3e [CACHE=HIT]. Full catalog read (not a domain slice), per this role's PRINCIPLES.md rule 9 mandate. Same fingerprint as round 1; no ADR catalog change to re-derive from scratch.

## 1. Plan file re-confirm (closes round-1 LOW finding 2)

`docs/plans/cifix-phase1-2026-09-09.md` now exists (confirmed via `git status` -- untracked, new this round). Read in full and cross-checked against independently-verifiable facts rather than taken on its own word:

- Its claimed ADR verdicts (devops ADR-0008 ratchet-only applying to the Issue #113 fix; SE ADR-0009 applying to the Issue #125 credential-residue fix) match this round's actual diff.
- Its claimed measurement ("git fetch of a non-tip SHA against torvalds/linux fails with 'not our ref', exit 128, corrected to git ls-remote piped to grep") is independently cross-checked against round 1's own red-team report, not just self-asserted: `docs/reviews/cifix-red-team-2026-09-09.md:230-232` already shows red-team using exactly this ls-remote-piped-to-grep mechanism. The plan's claim that it reused red-team's own verified mechanism is TRUE, not a retrofit dressed up as foresight.
- Its acceptance criteria (AC1-AC8) map 1:1 onto the actual `ci.yml` diff's four ordered checks (PAT-presence precheck, gitlink-reachability check, submodule init + populated-content assertion, credential-residue assertion) -- checked directly against `git diff HEAD -- .github/workflows/ci.yml`, not against the plan's own prose.
- AC8 ("Issue #120 files untouched") is independently verified below (section 2), not taken from the plan's own claim.

**Verdict: genuine, not a fabricated reconstruction.** It correctly discloses itself as a same-day reconstruction (its own "Housekeeping note") rather than pretending to have been written before the fact -- itself a point in its favor for honesty, not a defect.

## 2. Scope boundary re-confirm (closes round-1 HIGH finding 1's condition)

    $ git diff HEAD -- src/qa/reference-resolver.ts src/qa/completeness-claim-checker.ts
    (empty -- no output)
    $ git diff HEAD --stat -- src/qa/
    (empty -- no output)

Confirmed: neither Issue #120 file was touched. Independently re-ran both instruments against the current tree (not the story's own reported numbers, taken separately to catch drift):

    $ node src/qa/reference-resolver.ts HEAD~1 HEAD ; echo exit=$?
    [QA-14 reference-resolver] FAIL: 130 of 317 citation(s) failed to resolve.
    exit=1

    $ node src/qa/completeness-claim-checker.ts ; echo exit=$?
    [QA-15 completeness-claim-checker] FAIL: 3 of 3 file(s) had a failing completeness claim.
    exit=1

Both still red, as disclosed (CHANGELOG's own numbers, 129/316 and 3/3, are close but not identical -- expected drift, since QA-14 compares HEAD~1..HEAD committed diffs and the exact citation count shifts commit-to-commit; not itself a defect, both runs agree on the load-bearing fact: still red, exit 1, same root cause -- `src/qa/reference-resolver.ts:275`'s hardcoded `issueExists: () => null`, unchanged, unedited).

**The round-1 HIGH's condition is satisfied.** CHANGELOG.md's `cifix` entry explicitly discloses the QA-14/QA-15 downstream red (its own "Disclosure" paragraph, verified present by direct read), and I confirmed on Issue #120 itself (comment posted this round) that both the scope boundary and the disclosure obligation hold. Downgrading this from a live condition to a closed item -- see verdict below.

## 3. Whole-catalog ADR pass on the round-2 diff (new files since round 1)

Files newly in scope for a catalog-vs-diff check this round: `src/secret-scan/patterns.ts`/`.test.ts` (did not exist as a diff target in round 1 -- that round's diff was `ci.yml`/`backlog.md`/`CHANGELOG.md` only), the widened `ci.yml` mechanism, `docs/backlog.md`'s new entries, `CHANGELOG.md`'s rewritten entry, `docs/plans/cifix-phase1-2026-09-09.md`.

- **devops ADR-0008 / SE ADR-0010 (ratchet-only, "MUST NOT... broaden suppression/ignore lists")** -- directly APPLICABLE to how Issue #113 was fixed. Confirmed: the fix narrows `patterns.ts`'s own regex precision (a negative lookahead), and does NOT touch `docs/qa/secret-scan-allowlist.json` (checked: that file is absent from this diff's changed-file set). Satisfied.
- **SE ADR-0009 (monitoring/observability, "MUST NOT log secrets")** -- APPLICABLE to the Issue #125 fix (`ci.yml`'s GIT_CONFIG_* env-var form). Already covered by round 1 and by red-team/infra-security's own re-confirm; not re-litigated here.
- **No ADR in the 35-entry catalog governs secret-scan pattern coverage completeness** (which credential formats a scanner's regex catalog recognizes) as a named rule -- this is a functional/security gap, not an ADR collision. Named as a seam finding below instead, correctly, rather than forced into an ADR-violation frame it doesn't fit.
- All other ADRs (CDK/IaC-specific devops 0001-0007/0009/0010; SE data/architecture/testing 0001-0007/0011-0021) -- checked against the full catalog again this round, still NOT-APPLICABLE. This diff touches no AWS resource, no application domain/data model, no kernel/normalizer/policy surface.

**No new ADR collision found.**

## 4. Seam finding -- the actual new discovery this round

### Finding 1 -- [MED] [demonstrated] [code-traced] OSS-01's own `github-pat` pattern does not match GitHub's fine-grained PAT format -- the exact credential shape `cifix` just introduced as `ADR_REPO_PAT`

**The seam:** `infra-security-reviewer`'s lane covers whether `ADR_REPO_PAT` ever touches disk or leaks into logs (the credential-handling mechanism). It does not, and is not asked to, check whether OSS-01's own secret-scan pattern catalog (`src/secret-scan/patterns.ts` -- touched in this SAME diff, for the unrelated reason of fixing Issue #113) actually recognizes this credential's format as a defense-in-depth backstop if the primary mechanism ever fails. Nobody reviewing the Issue #113 patch to `patterns.ts` was asked "does this catalog cover the new credential type this same PR's other half (`ci.yml`) is introducing" either -- that is exactly the gap between the two lanes this role exists to catch.

`docs/decisions.md`'s 2026-09-09 "`cifix` Phase 1 plan approved" row ratified `ADR_REPO_PAT` as a fine-grained PAT (GitHub's newer token format, prefix `github_pat_`). `patterns.ts`'s existing `github-pat` pattern (unchanged by this diff -- only `internal-hostname` was touched) is:

    { id: "github-pat", description: "GitHub personal access token", regex: /gh[pousr]_[A-Za-z0-9]{36,255}/g }

This only matches the classic PAT prefixes (`ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`). Verified directly:

    $ node -e 'const re=/gh[pousr]_[A-Za-z0-9]{36,255}/g; console.log(re.test("github_pat_11ABCDEFG0123456789012_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"));'
    false
    $ node -e 'const re=/gh[pousr]_[A-Za-z0-9]{36,255}/g; console.log(re.test("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd"));'
    true

A fine-grained PAT literal would NOT be flagged by OSS-01's own history scan if it ever landed in git history -- despite the credential-handling mechanism's own careful no-disk-residency design (Issue #125's fix), this is exactly the kind of defense-in-depth backstop OSS-01 exists to provide, and it's blind to this specific, currently-in-use credential shape. This is not a new gap in general (the regex always had this blind spot for anyone using fine-grained PATs), but this diff is the first time this project has actually provisioned a fine-grained PAT as a real secret, making the gap concretely live rather than theoretical.

Not filed as an ADR collision (no ADR names secret-scan-pattern completeness), and not blocking this diff's own merge -- this is a pre-existing pattern-catalog gap, not something `cifix`'s diff introduced or regressed, and the primary defense (never-touches-disk) already covers the credential under normal operation. Filed as a standalone MED bug per this project's Issue Discipline (security-relevant, exempt from PRINCIPLES rule 21's exposure-based downgrade cap regardless of the compound-failure-required exposure basis).

**Minimal fix:** add one line to `SECRET_PATTERNS` in `src/secret-scan/patterns.ts`:

    { id: "github-fine-grained-pat", description: "GitHub fine-grained personal access token", regex: /github_pat_[A-Za-z0-9_]{20,255}/g }

plus a regression test pinning a fine-grained-PAT-shaped string as a true positive (mirroring the file's own existing pattern for how it tests `github-pat`/`aws-access-key-id`).

**Exposure:** requires a compound failure (the credential-handling mechanism's own no-disk-residency defense would first have to fail, AND the leaked value would have to reach git history) -- basis: assumption on the compound-failure probability, but the miss rate GIVEN that compound failure is 100% (measured, not assumed) and the finding is security-relevant, so it is not subject to rule 21's exposure-based downgrade. Filed as GitHub Issue #129 (`bug`, `severity:med`, `oss`), no Milestone linked (same precedent as Issue #27/#120 -- `cifix` has no owning Milestone).

## Seams checked, sound (CLEAN)

- **Issue #113 fix does not widen the allowlist** -- `git diff HEAD --stat` confirms `docs/qa/secret-scan-allowlist.json` is not in this diff's changed-file set; the fix is entirely a regex-precision change in `patterns.ts` plus new regression tests. Ratchet-only rule (devops ADR-0008) honored.
- **`npm test` now genuinely green** -- ran directly: 660 total, 660 pass, 0 fail, 0 skipped (matches CHANGELOG's own claimed count exactly). Issue #113 is genuinely closed, not just claimed closed.
- **`ci.yml` step count** -- ran js-yaml directly: 25 steps in the `ci` job (down from 26, two credential steps collapsed into one), matches CHANGELOG's claim.
- **`docs/decisions.md`'s 2026-09-09 "Stage-3 round 1" row** -- cross-checked against `docs/reviews/cifix-{red-team,infra-security,cross-domain}-2026-09-09.md`'s actual verdicts (no-go / APPROVE-WITH-CONDITIONS / APPROVE-WITH-CONDITIONS) and against the four named fix-now issue numbers (#125/#127/#128 + the un-filed LOW) -- all match; no dangling reference, no misattributed issue number.
- **`docs/.maat-state.json`'s `reviewRoundsSinceClean: 1`** -- consistent with round 1's non-clean (`red-team` no-go) verdict on this scope; not yet a rule-16(c) trigger (needs 2 consecutive non-clean rounds). `humanRulingRequired: false`, `councilHeld: false` -- correct, the scope-widening was a direct human ruling via AskUserQuestion, not a stalled-loop council trigger. `priorScope.scope: "s6"` correctly nests S6's full closing state.
- **Issue #120's own comment thread** -- round-1's cross-domain comment and `story-implementer`'s follow-up comment both correctly disclose the QA-14/QA-15 linkage; re-confirmed this round with a fresh comment naming the independent re-verification (not a rubber-stamp of the prior claim).

## Coverage gaps named

- `docs/STATE.md` still not updated as part of this diff -- same non-gap noted in round 1 (this project's convention is to update it at session wrap, not per review round); flagged again so it isn't missed at close-out.
- The credential-handling mechanism's own re-verification (Issues #125/#126/#127/#128 fixes) is `red-team`'s and `infra-security-reviewer`'s lane this round, not re-litigated here.

## Verdict: APPROVE-WITH-CONDITIONS -> both round-1 conditions now closed; one new MED finding, non-blocking

Round-1's HIGH condition (Issue #120 disclosure) is satisfied -- independently re-verified, not taken on the story's word. Round-1's LOW (missing plan file) is closed -- the plan is genuine and persisted. This round's own new finding (Issue #129, the fine-grained-PAT pattern-catalog gap) is a MED, non-blocking residual: it does not gate this diff's merge (the primary credential-handling defense is sound per infra-security's own re-confirm, and this is a pre-existing, not diff-introduced, pattern-catalog limitation), but it is filed, security-relevant, and should be closed promptly given `ADR_REPO_PAT` is now a real, live secret in this project for the first time.

## Single next action

Close Issue #129 (add the `github-fine-grained-pat` pattern + regression test to `src/secret-scan/patterns.ts`) -- small, contained, no other file touched; can land in the same fix-now round as any remaining red-team/infra-security round-2 items, or as its own trivial follow-up commit.

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, one terse line each, ranked by blast radius -- status [ISSUE]=confirmed collision/gap / [SUSPICION]=unconfirmed, needs a second look / [CLEAN]=seam checked, sound; severity+evidence tagged):
1. [ISSUE][MED][demonstrated][code-traced] src/secret-scan/patterns.ts's github-pat regex (gh[pousr]_...) does not match GitHub's fine-grained PAT format (github_pat_...) -- the exact shape ADR_REPO_PAT uses; ran the regex directly, confirmed miss; filed as Issue #129, minimal fix is one new pattern + test.
2. [CLEAN][code-traced] docs/plans/cifix-phase1-2026-09-09.md now exists, cross-checked against round-1's own red-team report (ls-remote mechanism claim verified true, not fabricated) -- closes round-1 LOW finding.
3. [CLEAN][demonstrated] git diff on src/qa/reference-resolver.ts + src/qa/completeness-claim-checker.ts is empty -- Issue #120's scope boundary genuinely honored, not silently fixed-around.
4. [CLEAN][demonstrated] node src/qa/reference-resolver.ts HEAD~1 HEAD exits 1 (130/317 unresolved) and node src/qa/completeness-claim-checker.ts exits 1 (3/3) -- still red as disclosed, same root cause, unchanged; comment posted on Issue #120 re-confirming round-1's HIGH condition is now satisfied.
5. [CLEAN][demonstrated] npm test: 660 total / 660 pass / 0 fail / 0 skipped -- Issue #113 genuinely closed, matches CHANGELOG's claimed count exactly.
6. [CLEAN][code-traced] Issue #113 fixed via patterns.ts regex precision only -- docs/qa/secret-scan-allowlist.json absent from changed-file set, ratchet-only rule (devops ADR-0008) honored.
7. [CLEAN][demonstrated] ci.yml: 25 steps in the ci job (js-yaml parse, direct), matches CHANGELOG's claim of 25 (down from 26).
8. [CLEAN][derived] docs/decisions.md's 2026-09-09 "Stage-3 round 1" row and docs/.maat-state.json's reviewRoundsSinceClean=1/humanRulingRequired=false/priorScope nesting all internally consistent, no dangling reference, no misattributed issue number.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=1 suspicions=0 clean=7
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=5 code-traced=3 derived=1
checks=node src/qa/reference-resolver.ts HEAD~1 HEAD -> exit 1 (130/317 unresolved); node src/qa/completeness-claim-checker.ts -> exit 1 (3/3 failing); npm test -> 660 total/660 pass/0 fail/0 skipped; git diff HEAD -- src/qa/reference-resolver.ts src/qa/completeness-claim-checker.ts -> empty; node -e regex test on github-pat pattern vs fine-grained-PAT string -> false (miss confirmed); js-yaml parse of ci.yml -> 25 steps
adr=HIT(35, whole catalog)
report=docs/reviews/cifix-cross-domain-round2-2026-09-09.md
