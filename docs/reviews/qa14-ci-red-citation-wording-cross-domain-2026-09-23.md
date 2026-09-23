# Cross-domain review: qa14-ci-red-citation-wording (PR #281)

**Reviewer:** cross-domain-reviewer (Ra)
**Scope:** fix/qa14-ci-red-citation-wording, PR #281, base df092f9, head 162dcd3 (single commit)
**Tier:** CRITICAL (ratified; see verdict below)
**ADR cache:** initial ADR-cache-ensure run in this worktree reported cataloged 2 ADR(s) [adr/devops:0, adr/software-engineering:0, docs/adr:2] -- the adr submodule was not initialized in this worktree, so that first read was a false-empty catalog. Ran a submodule init (clone succeeded, checked out cdb245d9), which populates the real catalog: 12 devops + 23 software-engineering + 2 project (docs/adr) = 37 ADRs, matching the historical snapshot embedded in docs/.maat-state.json's own adrCatalog blocks. I read the whole 37-ADR catalog unfiltered, not a domain slice, per this role's mandate.

## Who else is reviewing

CRITICAL tier for this scope dispatches red-team + app-security-reviewer + cross-domain-reviewer (the hooks-family "Policy enforcement / session gates" sensitive-area convention). As of this review, no red-team or app-security-reviewer report exists yet for this scope (docs/reviews has no qa14-ci-red-citation-wording files besides this one; docs/REVIEW_LOG.md has no row for this scope). I have no sibling findings to dedupe against; app-security-reviewer's lane (hook-code correctness/exploitability of the SUR-03 mechanism) and red-team's lane (adversarial attack on the same mechanism) are the ground I did not re-cover -- I did not re-audit the hook logic itself, only confirmed this diff changes zero bytes of it.

## Diff under review

The commit is 2 files, 3 lines changed, comments only:
- sessionstart-tool-enum.mjs line 12 -- a backtick-quoted cross-repo issue reference reworded to name the issue without the hash mark.
- sessionstart-tool-enum.mjs line 444 -- dropped backticks around one settings.local.json path fragment.
- userpromptsubmit-halt-relay.mjs line 70 -- a single backtick-quoted slash-joined pseudo-identifier split into two real, separately backtick-quoted method names.

All three are meaning-preserving (the third is arguably a documentation-quality improvement: the old text read as a single slash-joined pseudo-identifier that isn't valid JS; the new text names two real methods). No functional code line touched.

## Verification of the PR's own claims (demonstrated)

1. Citation-count claim: the commit message claims running reference-resolver.ts against 6737242 and df092f9 (matching CI run 35817967552) goes from 10 to 7 blocking failures after this fix. Reproduced independently, checking out each commit in turn (working tree had to match the ref under test, since reference-resolver.ts reads changed-file lists via a diff but file contents via a plain filesystem read, not a ref-scoped read -- a worktree at the wrong checkout silently scores the wrong content):
   - At df092f9, resolver against 6737242..df092f9 reported FAIL: 10 of 330 citation(s) failed to resolve -- exact list: 3 in the two hook files (the ones this PR fixes), 7 in docs/REVIEW_LOG.md (1) and the s5-halt-mechanism-hardening red-team report plus its round2 (6).
   - At 162dcd3, resolver against 6737242..162dcd3 reported FAIL: 7 of 327 -- exactly the same 7 remain, the 3 hook-file ones gone.
   - The cited CI run 35817967552 was independently confirmed: conclusion failure, event push, head sha df092f9 -- the cited run is real and matches.
   - Verdict: the "10 to 7" claim is accurate (demonstrated, not merely asserted).
2. Test suite, typecheck, lint: re-ran all three myself: full test suite reported 1090 pass, 0 fail, 0 skipped (matches the PR's claim exactly); typecheck exit 0; lint exit 0.
3. PR-level CI: the PR's own required status check ("Lint, typecheck, test, QA/OSS instruments") is SUCCESS. This is the PR's own base/head diff (df092f9 to 162dcd3), which is the two hook files only -- confirmed directly: resolver against df092f9..162dcd3 reported PASS: 25 citation(s), 23 resolved, 2 unclassified, 0 failed.

The PR description and commit message are honest: they disclose the fix is partial (3 of 10), name the 4 files the remaining 7 live in, cite PRINCIPLES.md rule 11 correctly as the reason those aren't touched, and link Issue #280 rather than silently dropping the gap. No overclaim found.

## Editorial (non-blocking, does not gate)

- The PR's framing ("reduces QA-14's blocking count from 10 to 7... not attempted here") is accurate against the historical baseline but reads as if master's ordinary push-triggered CI will stay at "7 failing" once this merges. Mechanically it will not: QA-14 diff-mode (per s1-229-qa14-red's own D2 ruling) only rescans files a new diff actually touches. Once this PR merges, the next push-to-master diff is the small hook-only diff -- confirmed a clean PASS scoring 0 failed for that exact diff. The 7 residual citations sit inertly inside already-committed, append-only-scanned files (REVIEW_LOG.md, two immutable reports) that no ordinary future diff will re-touch; they will not resurface on push-triggered CI, only on a full-tree/zero-marker fallback scan (a rare event -- first push after a history rewrite -- and the weekly scheduled drift-check job explicitly does not run QA-14 per the workflow file's own comment). Net: merging this PR should return master's push-triggered CI to fully green, not leave it partially red pending #280. Issue #280 remains a legitimate, correctly-scoped checker-precision/technical-debt item -- its title ("QA-14 stays red on master") overstates the ongoing operational impact. Suggest a one-line clarifying comment on #280 (not a body edit) the next time anyone touches it.
- Issue #257 lists both hook files among files with standing QA-14 failures (filed 2026-09-21, before this session's s5 story existed). Re-ran a full-tree scan post-fix: both files now show zero blocking citations, only 2 non-blocking unclassified bare-number lines. #257's hook-file line item is now stale. Posted a same-turn comment on #257 noting this rather than editing its body.
- The PR's tier-precedent citation ("matching this project's own friendly-halt-messages precedent for a comment-only change to these same two files") is slightly loose: friendly-halt-messages actually changed runtime message-generation code, not comments only. The precedent that actually holds -- touching these two named sensitive-area files always draws full CRITICAL ceremony regardless of diff size or diff kind -- is correct and is independently supported by CLAUDE.md's own "Sensitive areas" section (a blast-radius floor, not a ceiling). Tier ratification (CRITICAL) is correct; only the specific analogy is imprecise.

## Cross-domain ADR check (whole catalog, 37 ADRs)

Read all 12 devops + 23 software-engineering + 2 project ADRs' Rules for agents. Nothing in the diff itself (a 3-line comment reword, zero logic/config/schema change) collides with any Accepted ADR's rules -- no suppression added, no gate threshold changed, no test deleted or weakened, no IAM/secret/schema/migration surface touched, the two project-tier ADRs are untouched in substance (the fixture loader and allowlist logic are not in this diff).

One finding surfaced by reading the process the diff sits inside, not the diff's own file content -- squarely the kind of thing no domain-scoped reviewer (app-security-reviewer on hook code; red-team on hook exploitability) is positioned to catch, because it isn't in any file in the diff.

### [ISSUE][HIGH][demonstrated] master has zero branch protection; this session's required CI check has failed at merge time 4 times running (ADR-0008 violation, not caused by this PR but exposed while verifying it)

- A direct branch-protection status query for master returned "Branch not protected" (404). No required status checks, no PR-review requirement, nothing stopping a merge from landing regardless of CI result.
- The required "Lint, typecheck, test, QA/OSS instruments" status check was queried on each of this session's four merges and was at FAILURE at merge time, in every case:
  - PR #261: check completed FAILURE 2026-09-22T02:09:52Z, merged 2026-09-23T02:29:59Z.
  - PR #262: check completed FAILURE 2026-09-23T02:38:55Z, merged 2026-09-23T03:52:24Z.
  - PR #273: check completed FAILURE 2026-09-23T04:05:39Z, merged 2026-09-23T04:20:44Z.
  - PR #279: check completed FAILURE 2026-09-23T04:15:39Z, merged 2026-09-23T04:20:55Z.
  - All four merged by the human account (confirmed via the PR's own mergedBy field) -- this is not an agent bypassing CLAUDE.md's "Human-only actions" (the merge action itself stayed human-only); it is the platform having no gate to make that red status consequential.
- devops ADR-0008 ("CI/CD gates and policy-as-code"), Rules for agents: "MUST NOT merge a PR with any blocking gate open, failing, or pending." This has now been violated 4 out of 4 times this session, structurally enabled (not merely risked) by the absence of any branch protection rule.
- This PR (#281) is, notably, the first of the five in this thread to actually merge on a genuinely green check (confirmed above) -- but that is incidental to this fix, not evidence the gap is closed. The next PR that happens to introduce a real regression will merge exactly as easily as these four did.
- Exposure: 100% of merges to master this session (4 of 4 measured, not assumed) had no platform-level gate; the underlying vulnerability (any future red PR can merge unopposed) is ongoing and unbounded until branch protection is configured -- not scoped to this PR's own small, well-verified diff.
- Minimal fix: this is a repo-settings change, not a code change -- I have not made it and am not recommending an agent make it unilaterally; it is a governance decision (whether/how strictly to require the CI check, whether admins can override) that belongs with the human, the same class of decision this project already reserves for the human elsewhere (destructive/irreversible repo-level operations). Recommend the Manager put this in front of the human as its own named decision, separate from and not blocking this PR's merge.
- Dedup check performed via issue search for branch protection and required status check phrasing: no existing open or closed issue covers this. Filed fresh (see receipt).

No other ADR collision found. I did not find any hidden violation of the "Evidence / audit trail," "Guard / policy engine," "Secret scanning / CI gates," or "Policy delivery" sensitive-area rules in this diff -- none of those files are touched.

## Coverage gaps named

- GitHub repo/branch settings (branch protection, required status checks) are outside every reviewer's file-diff-based lane by construction -- a file diff cannot show a missing platform setting. This is the coverage gap the finding above lives in; no lane "owns" it today. Recommend it become a named, periodic check (run once per milestone), not a one-off.
- Everything else in the diff (2 comment lines, verified above) is fully covered by the honesty/count verification I performed plus the sibling reviewers' pending hook-code lanes; no other gap to name for this specific 3-line diff.

## Verdict

APPROVE-WITH-CONDITIONS for the diff itself (accurate, honest, zero behavior change, correctly tiered) -- the one HIGH finding does not arise from this PR's own content and does not need to block this PR's merge; it needs the human's attention as its own decision. Condition: the Manager surfaces the branch-protection gap to the human explicitly (not folded silently into this PR's close-out), and Issue #280's title/framing gets a corrective comment per the Editorial note above.

## Failing-test mapping (PRINCIPLES rule 19)

The one blocking-caliber finding (branch protection) has no executable "failing test" form -- it is a repo-configuration absence, not a code defect; its settled form is the branch-protection status check already quoted above (demonstrated), and its resolution is a human-made GitHub settings decision, not a commit. Open findings = 1 (HIGH, config gap, not code); failing tests = 0, explained: not code, not testable in this repo's own suite.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, one terse line each, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] Branch-protection status query on master returned 404 (unprotected); 4 of 4 of this session's merges (#261/#262/#273/#279) landed with a FAILURE-concluded required CI check (ADR-0008 violation), pre-existing and not caused by this PR, surfaced while verifying it -- recommend human ruling on branch protection, not folded into this PR.
2. [CLEAN][code-traced] This PR's own diff (162dcd3): 3 comment-only lines in the two named hook files, meaning-preserving, zero behavior change, no ADR collision.
3. [CLEAN][demonstrated] "10 to 7" citation-count claim independently reproduced by re-running the resolver at df092f9 and 162dcd3 against the same base commit; exact same 7 residuals confirmed in REVIEW_LOG.md plus 2 immutable reports.
4. [CLEAN][demonstrated] Full test suite 1090/1090 pass 0 fail 0 skipped, typecheck clean, lint clean -- all three PR claims verified by direct re-run, matching exactly.
5. [CLEAN][demonstrated] PR #281's own PR-level CI check is SUCCESS (its own base-to-head diff scores 0 failed) -- confirms merging this PR returns master's push-triggered CI to green, not "still red pending #280" as the PR body's framing could be read.
6. [CLEAN][derived] Issue #280 is a genuine, non-duplicate framing distinct from #257 (different files/citations), #252 (REQUIREMENTS.md wording, unrelated), #256 (a filename-quoting skip bug, unrelated) and #258 (future-report prevention guidance, not this-report remediation) -- correctly scoped, though its title overstates ongoing master-CI impact (see Editorial).
7. [CLEAN][derived] Tier ratification CRITICAL is correct per CLAUDE.md's named "Policy enforcement / session gates" sensitive area (both touched files are explicitly named); the PR's own friendly-halt-messages analogy is imprecise (that story changed runtime behavior, not just comments) but does not change the correct tier outcome.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=1 suspicions=0 clean=6
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=5 code-traced=1 derived=2
checks=full test suite 1090/1090 pass 0 fail 0 skipped; typecheck exit 0; lint exit 0; reference-resolver run 4 times (see body) matching claimed counts exactly; branch-protection status 404; PR status-check-rollup on 4 PRs all FAILURE-at-merge
adr=HIT(37, whole catalog)
report=docs/reviews/qa14-ci-red-citation-wording-cross-domain-2026-09-23.md
