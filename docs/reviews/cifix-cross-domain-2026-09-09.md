# cifix — Cross-Domain Review (Ra)

**Scope:** docs/.maat-state.json scope cifix, CRITICAL tier. Diff: .github/workflows/ci.yml, docs/backlog.md, CHANGELOG.md (working-tree, uncommitted at review time). Fixes Issue #27 (CI dead since 2026-09-01 -- submodules: recursive against the private mohannadrabie/adr repo, unreadable by the default GITHUB_TOKEN).

**Lanes running in parallel (not re-covered here):** red-team (adversarial: credential/PAT scoping, secret handling, bypass surfaces) and infra-security-reviewer (IAM/secrets/exposure: the ADR_REPO_PAT shape, repo-secret handling, url.insteadOf scoping). This pass reads the WHOLE ADR catalog and hunts the seam between "the checkout/credential fix is correct" and everything else that sits downstream of it.

## ADR cache
ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog -- fp 83b2e3e. Full catalog read (not a domain slice), per this role's PRINCIPLES.md rule 9 mandate.

## Cross-domain ADR verdict (whole catalog, outside red-team/infra-security's lanes)

- **devops ADR-0001** (process) -- satisfied: CHANGELOG cites governing ADRs, decisions.md rows present.
- **SE ADR-0001** (process, PR cites governing ADRs) -- CHANGELOG cites devops ADR-0001, SE ADR-0001, SE ADR-0010. Does NOT cite devops ADR-0008 (CI/CD gates and policy-as-code), even though this diff's whole subject is a CI/CD pipeline file -- see the collision below.
- **devops ADR-0008** (CI/CD gates and policy-as-code, applicableTo pipeline/quality/security/supply-chain) -- rule: "MUST run the full gate set locally... before declaring work complete; failing gates = unfinished work." COLLISION -- see Finding 1.
- **SE ADR-0010** (code quality/maintainability gates, applicableTo quality/process) -- same rule, same collision. CHANGELOG explicitly claims compliance with this ADR while its own "Verification status" paragraph silently omits two CI-gating instruments that are demonstrably failing right now (Finding 1).
- All other ADRs (CDK/IaC-specific devops ADR-0002-0007/0009/0010; SE data/architecture/testing ADRs 0002-0021) -- not applicable; this diff touches no AWS resources, no application code, no data model, no kernel/normalizer surface. Checked against the full catalog, not assumed.

## Seam findings

### Finding 1 -- [HIGH] [demonstrated] Restoring checkout does not restore a green CI; two already-known CI-gating instruments fail unconditionally, undisclosed in this story's own materials

**The seam:** this diff's own domain (CI checkout/credential wiring -- red-team's and infra-security-reviewer's lane) is correct in isolation. But ci.yml has "no continue-on-error anywhere... a red step is a red job, full stop" (its own header comment, line 4). Once Checkout + Init adr submodule succeed for the first time in 8+ days, the job proceeds to run instruments that have never once executed in real CI -- and at least two of them fail unconditionally, independent of anything this diff touches:

```
$ node src/qa/reference-resolver.ts HEAD~1 HEAD ; echo exit=$?
[QA-14 reference-resolver] FAIL: 126 of 308 citation(s) failed to resolve.
  - [unresolved-authority] Issue#27 -- cannot verify (no issue-tracker access) -- fails closed, not silently skipped
  ... (124 more, nearly all "Issue#NN -- cannot verify")
exit=1

$ node src/qa/completeness-claim-checker.ts ; echo exit=$?
[QA-15 completeness-claim-checker] FAIL: 3 of 3 file(s) had a failing completeness claim.
exit=1
```
src/qa/reference-resolver.ts:275 hardcodes issueExists: () => null in every environment (not a sandboxed-dev-only network limitation -- the comment at that line says so explicitly: "No issue-tracker credential is wired into this CI job by default... fails closed"). summarizeCitations() (line 200-208) treats any unresolved-authority verdict as ok: false. Every bare #NN / Issue #NN citation in a changed file trips this -- and this diff's own three changed files all contain one: .github/workflows/ci.yml:40 ("Issue #27"), CHANGELOG.md ("(Issue #27)"), docs/backlog.md:5-7 ("Issue #27" x2, "Issue #97"). This is not hypothetical: it is this project's own house citation convention, present in nearly every commit's changed files (CHANGELOG.md/backlog.md/decisions.md all cite issue numbers routinely). Exposure: ~100% of future push/PR runs that touch any doc file with an issue citation -- measured directly, not assumed.
This is already tracked -- Issue #120 (OPEN, severity:med, filed 2026-09-08 by red-team round 4, milestone #24/S6, not cifix) names this exact defect by file and line. QA-15's 3-of-3 failures are also pre-existing, previously disclosed repeatedly (S4/S5/S6 STATE.md entries) as non-gating precisely because CI never got far enough to reach them. That precondition just changed. Neither the CHANGELOG entry nor either 2026-09-09 docs/decisions.md row for cifix mentions Issue #120 or flags that CI will very likely still be red immediately after the human provisions ADR_REPO_PAT -- the framing ("this fix restores OSS-01's secret scan plus every other CI instrument that has run zero times since 2026-09-01", docs/.maat-state.json note_2026-09-09b) reads as a restoration-to-health claim, and the CHANGELOG's own "Verification status" paragraph reports typecheck/lint/npm test but is silent on the qa:* gate suite entirely -- the one thing this story is about.

**Minimal fix:** no code change required to ci.yml itself. Before/at merge: (a) comment on Issue #120 linking it as the next blocker in the cifix outcome chain (do not file a duplicate -- the root cause is already named there); (b) add one disclosure line to the CHANGELOG/decisions.md cifix entries: "even once ADR_REPO_PAT is provisioned, expect the first real CI run to still fail -- at QA-14/QA-15, not Checkout -- per already-tracked Issue #120." This turns a likely "the fix didn't work" surprise into an anticipated, correctly-attributed next step.

**Exposure:** ~100% of future CI runs whose diff touches a doc file with an issue citation (measured: ran both instruments directly, both exit 1, culprits confirmed present in this diff's own 3 changed files).
### Finding 2 -- [LOW] [demonstrated] No persisted Phase 1 plan file for cifix, unlike every prior story

docs/plans/ holds S2-phase1-*.md, S5-phase1-*.md, S6-phase1*.md -- no cifix-phase1-*.md exists (find/ls docs/plans confirmed empty for this scope). docs/decisions.md's 2026-09-09 "cifix Phase 1 plan approved" row cites "story-implementer's cifix Phase 1 plan (2026-09-09)" as evidence with nothing to open and read -- thinner evidentiary trail than this project's own established convention for a CRITICAL-tier build. Not blocking (the ruling itself, and its three answered questions, are recorded in full in the decisions.md row itself), but worth closing before this scope archives, for the same auditability reason every other story got one.

## Seams checked, sound (CLEAN)

- **OSS-01 blast radius unchanged by the submodule fix.** src/secret-scan/history-scan.ts's scanHistory() walks git.lsTree(commit), and lsTree() (src/lib/git.ts:82-98) filters type === "blob" only -- a submodule gitlink is type === "commit" and is skipped unconditionally, checked out or not. Restoring the adr submodule's real content does NOT put its files in OSS-01's scan surface (no new exposure, no false-positive risk from a different repo's history).
- **"No other file touches adr/ content" -- independently reverified**, not taken on the story's word (this exact class of unverified-completeness mistake happened once already this project, red-team round 6). Repo-wide grep for adr/devops / adr/software-engineering directory reads: only src/qa/reference-resolver.ts (+ its .test.ts) among executable code, plus docs/adr-cache.mjs (an agent-side session tool, autoSync: false, never invoked by ci.yml). QA-14's own comment already correctly skips submodule gitlinks in its diff/full-tree fallback path. Confirmed true.
- **Governance-process consistency.** Issue #27's reopening (2026-09-09, red-team) and the Manager's same-day correction comment both match docs/STATE.md's resume point and docs/decisions.md's two 2026-09-09 rows verbatim -- no dangling reference, no premature archiving. docs/.maat-state.json's scope: s6 -> cifix transition correctly nests S6's full closing state under priorScope. Issue #27 stays OPEN/REOPENED, unlinked to a Milestone (no cifix milestone exists -- the Issue Discipline carve-out for a genuinely unclear/non-story-numbered scope home applies; not a defect).
- **Weekly runtime-settings-drift job (QA-17) unaffected** -- its own Checkout step never had submodules: set; it was never broken by Issue #27 and this diff doesn't touch it.

## Coverage gaps named

- docs/STATE.md was not updated as part of this diff (not in the changed-file set). Consistent with this project's convention of updating STATE.md at session wrap/ship rather than per review round -- not itself a gap this round, flagged so it doesn't get missed at close-out (Definition of Done requires it before this scope is called done).
- Everything else in the diff (workflow YAML syntax, PAT scope/expiry shape, secret handling) is squarely red-team's/infra-security-reviewer's lane, not re-litigated here.

## Verdict: APPROVE-WITH-CONDITIONS

The checkout/credential fix itself is architecturally sound and correctly scoped. The condition: before the human provisions ADR_REPO_PAT expecting a restored green CI, disclose (Issue #120 comment + one CHANGELOG/decisions.md line) that the very first real CI run will likely still fail -- at QA-14/QA-15, a different, already-tracked step -- not because this fix is wrong, but because it finally lets CI reach code that was never exercised for real. Fix-now or defer is the Manager's call; either way it must not ship silently as an implied "CI restored" claim.

## Single next action

Comment on GitHub Issue #120 linking it to cifix's outcome (elevated relevance: it is now the next blocker to a green CI run, not a deferred S6 residual) -- no new Issue filed, this is the same tracked root cause.

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, one terse line each, ranked by blast radius -- status [ISSUE]=confirmed collision/gap / [SUSPICION]=unconfirmed, needs a second look / [CLEAN]=seam checked, sound; severity+evidence tagged):
1. [ISSUE][HIGH][demonstrated] src/qa/reference-resolver.ts:275 + src/qa/completeness-claim-checker.ts -- QA-14/QA-15 both exit 1 right now (ran directly); restoring checkout will move CI's failure point to these already-tracked (Issue #120), never-disclosed-in-cifix instruments instead of producing a green run -- collides with devops ADR-0008 / SE ADR-0010's "full gate set locally, failing gates = unfinished work"; minimal fix: comment on Issue #120 linking cifix + disclose in CHANGELOG/decisions.md, no new Issue.
2. [ISSUE][LOW][demonstrated] docs/plans/ has no cifix-phase1-*.md, unlike every prior story (S2/S5/S6) -- thinner audit trail for a CRITICAL-tier build; close before this scope archives.
3. [CLEAN][code-traced] src/lib/git.ts:82-98 lsTree() filters submodule gitlinks (type=="commit") unconditionally -- OSS-01 secret-scan blast radius unchanged by restoring the adr submodule's real content.
4. [CLEAN][code-traced] repo-wide grep confirms only src/qa/reference-resolver.ts (+test) and the non-CI-gated docs/adr-cache.mjs read adr/ content -- story's implicit "no other file touches adr/" claim independently reverified true.
5. [CLEAN][derived] Issue #27 reopening, docs/decisions.md's two 2026-09-09 rows, and docs/.maat-state.json's s6->cifix scope transition are internally consistent, no dangling reference.
6. [CLEAN][code-traced] weekly QA-17 runtime-settings-drift job's own Checkout step never had submodules: set -- unaffected by Issue #27 or this fix.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=2 suspicions=0 clean=4
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=2 code-traced=3 derived=1
checks=node src/qa/reference-resolver.ts HEAD~1 HEAD -> exit 1 (126/308 unresolved); node src/qa/completeness-claim-checker.ts -> exit 1 (3/3 files failing); npm test/typecheck/lint not independently re-run this pass (story's own CHANGELOG numbers taken as reported: 658 total/657 pass/1 fail/0 skipped, pre-existing Issue #113)
adr=HIT(35, whole catalog)
report=docs/reviews/cifix-cross-domain-2026-09-09.md
