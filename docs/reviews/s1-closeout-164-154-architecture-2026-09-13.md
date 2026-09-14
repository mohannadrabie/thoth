# Architecture Review (Imhotep) -- Design Council seat -- s1-closeout-164-154 (Issues #164/#154, rule 16(c) trigger)

**Date:** 2026-09-13
**Council:** /maat:council -- design-challenger + architecture-reviewer + impact-analyst
**Trigger:** PRINCIPLES rule 16(c) -- 3 consecutive REWORK-class Stage-3 rounds on the same target (docs/.maat-state.json: reviewRoundsSinceClean=3, reviewRoundsTotal=3), each round fixing its own findings while introducing a new one.
**Branch:** fix/s1-closeout-164-154 @ 6393d16 (round-3 fix c2408ba + docs/bookkeeping only -- confirmed via git diff --stat c2408ba 6393d16: no src/ change), on top of master @ ad196c5.
**ADR cache:** node docs/adr-cache.mjs --ensure returned ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] [CACHE=HIT] (fp 83b2e3e, unchanged across all 3 rounds).
**Read:** docs/decisions.md rows 79-85 (this story's full arc, plus the two preceding qa14-* stories in the same file family), all 9 Stage-3 review reports (docs/reviews/s1-closeout-164-154-{code,red-team,cross-domain}{,-round2,-round3}-2026-09-13.md), the cifix design-council record (docs/reviews/cifix-{architecture,design-challenger-stopbrief,impact-analyst-council}-2026-09-09.md), docs/backlog.md line 56, docs/STATE.md.

**My question, per dispatch: should this shape exist as currently reviewed, and what does each candidate fix path cost architecturally?** I am not re-attacking findings (red-team's job, done three times already) or pricing impact (impact-analyst's seat). I rule on topology, blast radius, evolution path, and whether the recurring pattern is itself evidence of a structural gap.

---

## 0. Independent verification before ruling (not taken on any prior report's word)

    $ git diff --stat c2408ba 6393d16
    docs/.maat-state.json | 6 +-, docs/REVIEW_LOG.md | 3 +, docs/decisions.md | 1 +,
    +3 review-report files -- ZERO src/ changes. Current HEAD is round-3's code, unmodified.

    $ node src/secret-scan/history-scan.ts ; echo EXIT=$?
      - 6393d16efb7d src/qa/marker-corpus-probe.test.ts [email-address] an email address
        (possible personal data): test...[REDACTED 16 chars]
    EXIT=1

    $ grep -n "marker-corpus-probe" docs/qa/secret-scan-allowlist.json
    (no output -- zero entries)

    $ npm test 2>&1 | tail -8
      AssertionError [ERR_ASSERTION]: ... actual: false, expected: true ...   (OSS-01 dogfood assertion, fails)

Issue #180 is real, current, unfixed, and reproduces exactly as all three round-3 reviewers independently reported. This is demonstrated, from my own hands, not relayed.

---

## 1. Root cause, architecturally: three unlucky coincidences, or a structural blind spot?

**Verdict: structural blind spot, not coincidence.** Evidence:

**(a) No pre-commit / post-commit-state verification exists anywhere in this repo's toolchain -- confirmed, not assumed.**

    $ ls .git/hooks/ | grep -v sample          -> (empty)
    $ grep -i husky package.json               -> (no output)
    $ find . -iname "*pre-commit*" -not -path "./node_modules/*" -not -path "./.git/*"   -> (no output)

Every round's own "done" claim (npm test 774/774, 779/779, 785/785) was measured against a tree state -- the working tree, sometimes not even committed yet -- that is structurally different from the tree state the two gates that actually broke evaluate: OSS-01 (src/secret-scan/history-scan.ts) reads git history (blobs at each commit), and node --test's default concurrency exposes races that a single serial pre-dispatch run does not. Nobody on the build side ran the full, actual CI-equivalent gate set -- concurrency-stressed suite + committed-tree secret scan + registry-lint promotion check -- before declaring done, each round. Reviewers caught it every time, one round later, which is the review loop working correctly -- but reactively, after the defect already shipped into three separate rounds' commits.

**(b) This exact lesson was already written down, twice, before round 3 repeated it.** CHANGELOG.md's qa14-marker-redesign entry states, verbatim: "re-measuring post-commit, not just pre-commit, is now this round's own disclosed lesson." And the cifix council (2026-09-09) ratified, in principle, a mechanism for exactly this shape (Section 2 below). Round 3 of this story reproduced the identical mechanism -- verification green against the working tree, red the instant git commit returns -- five days later, in the same file family, without either lesson being operationalized as a check anyone actually ran. A lesson that lives only in prose (a CHANGELOG sentence, a backlog line) and not in a runnable gate is a lesson that does not transfer round-to-round; that is the structural gap, precisely.

**(c) The project's own recurring-findings-registry discipline -- built for exactly this -- was itself not fed at the second occurrence.** docs/qa/recurring-findings-registry.md's own convention: "the same underlying class... recurs in a different story or review... adds a row, same turn... Promotion is mandatory before the third story ships." The class -- "a fix round's own committed artifacts red a gate that only reads committed state, invisible to pre-commit verification" -- occurred at cifix (Issue #131, 2026-09-09) and recurred here (Issue #180, 2026-09-13). Nobody added the row at the second occurrence; red-team round 3 found the gap and named it (Issue #181) rather than it self-enforcing. A governance mechanism whose own trigger depends on a reviewer manually noticing, rather than a check that runs, is not durable -- this is the same shape of gap as (a)/(b), one level up.

**Conclusion:** the recurring pattern is not bad luck landing on one small story. It is the same root cause surfacing in two different guises -- round 1 to 2's flaky-concurrency class and round 3's post-commit-gate class are both instances of "the round's own verification measured a tree state the gate does not." Three rounds, two distinct symptom families, one mechanism-shaped cause. reviewRoundsSinceClean=3 correctly tripped rule 16(c); the council is the right response, not an overreaction.

---

## 2. Should Path B (the cifix-council-ratified standing pre-commit dogfood check) be pulled forward now?

This is genuinely Path B's second real-world trigger (cifix Issue #131 to this story's Issue #180), exactly the recurrence docs/backlog.md line 56 and docs/qa/recurring-findings-registry.md's own "promotion before the third" rule both anticipate. The pressure to build it is real and I do not discount it.

But pulling it into this story's remaining scope is the wrong move, architecturally, and here is the topology reasoning, not a cost argument (that is impact-analyst's lane):

- Path B is novel shape for this project. Nothing in this repo today runs anything at commit time or reads the resulting tree state as a gate before the tree state exists elsewhere (CI). A standing pre-commit/CI-adjacent dogfood check is this project's first instance of that pattern. PRINCIPLES rule 15 names exactly this case: a CRITICAL-tier story introducing this system's first-ever instance of a pattern routes to architecture-reviewer before, or in parallel with, the first design-challenger round. Folding it into s1-closeout-164-154's close-out skips that dedicated pass rather than satisfying it -- this review is scoped to this story's shape, not to designing a new mechanism inline.
- It touches a CLAUDE.md-named sensitive area twice over -- the secret-scan/CI-gate mechanism itself, and (depending on shape) the policy-delivery/CI-workflow surface -- which independently draws its own fresh dated review round when built (CLAUDE.md's Sensitive Areas section, and docs/backlog.md line 56's own note: it draws its own dated review round when built, same ceremony as any other change there). That ceremony cannot be satisfied as a rider on a fix-now round for two already-closed, unrelated Issues (#164/#154).
- Blast radius of getting it wrong compounds, not cancels. This story is already the rule-16(c) example of a fix that looked small and well-understood but kept producing a new defect class each round. Adding a genuinely new mechanism -- one that gates every future commit in the repo if built wrong -- to the same branch, under the same review fatigue, at the exact moment the project's own escalation rule fired specifically because scope kept creeping round-over-round, is the architectural version of doubling down on the failure mode this council exists to interrupt.
- The residual math favors deferral, not urgency. #180 is fixed by one allowlist line (below); nothing about shipping that fix requires Path B to exist first. Path B's forcing function is stop this class recurring a third time, and QA-13's own convention gives the actual deadline: promotion is mandatory before the third occurrence ships -- i.e., before the next story in this file family, not before this one closes.

Ruling: pull Path B forward to be the very next story after this one closes -- highest-priority backlog item, ratified fresh, with its own tier and its own dedicated architecture-reviewer pass per rule 15 (the same seat, a different turn) -- not folded into this story's remaining scope. docs/backlog.md line 56 already carries the correct shape (zero new exemption-grant surface, secret-scan-allowlist.json stays sole grantor); it needs promotion from backlogged-with-no-story to next-story, not a redesign.

---

## 3. Candidate paths -- architecture verdict on each

| Path | Fit | Blast radius / coupling | Compliance | Verdict |
|---|---|---|---|---|
| A -- fix #180/#181/#182, lighter ceremony | Matches the actual remaining scope: 3 isolated, disclosed, single-file bugs, no compounding history between them | Zero new topology; #180/#181 are same-shape-as-precedent mechanical edits; #182 is a real (small) instrument-semantics decision, named below | SE ADR-0010 VIOLATES on round-3's own stale claim (fixed forward by #180's fix, not by ceremony) | APPROVE-WITH-CONDITIONS |
| B -- build standing pre-commit dogfood check now, folded into this story | Over-fits: solves a problem broader than this story's ratified scope (#164/#154), the definition of gold-plating | Novel shape (rule 15), 2 named sensitive areas, unbounded interaction with review-fatigue on an already-3x-REWORK branch | NOT-COVERED today (no ADR governs a mechanism that does not exist yet) -- building it inline pre-empts the dedicated architecture pass rule 15 requires | REWORK as scoped to this story; APPROVE as next story, see Section 2 |
| C -- ship #180/#181/#182 as residuals, close now, no more code | Fits #181 (registry-row gap) and #182 (measurement-integrity gap) as genuine residual candidates | #180 is not a residual-eligible gap by this project's own rules | ADR-0008 (devops, applicableTo quality/security) MUST NOT merge a PR with any blocking gate open, failing, or pending -- VIOLATES, if #180 ships unfixed | REWORK as stated; a narrower Path C-prime -- fix #180 only, backlog #181/#182 -- is a legitimate variant, see below |

### Path A -- detail

#180 and #181 are exactly what the dispatch calls them: small, single-file, well-understood, with no history of compounding with each other (unlike #170 to #176 to #180, which is one lineage). #180 is a one-line allowlist addition, byte-identical in shape to an existing precedent in the same file (docs/qa/secret-scan-allowlist.json's src/secret-scan/history-scan.test.ts entry). #181 is a data-only registry-row addition using the registry's existing, unchanged mechanism.

#182 is not purely mechanical, and I flag this rather than wave it through: red-team's own proposed fix (the probe's own output distinguishes the tracked-corpus figure from the untracked contribution, never folded silently into one integer) is a small but real change to marker-corpus-probe.ts's output contract -- it decides, for the first time, what the published corpus figure means when the working tree contains untracked scannable content. That is a design decision, however narrow, not a bug fix with one obviously-correct shape (the alternative -- read content from HEAD blobs only, discussed and rejected in round 1's attack 1 -- is a different, defensible answer). It should get one sentence in docs/decisions.md naming which semantics were chosen and why, not just a code diff -- cheap, and it is exactly the kind of small-but-real decision this story's own history shows gets silently absorbed into a just-fix-it round if not named.

Conditions for APPROVE:
1. Commit-then-verify, not verify-then-commit, for the specific gates that only read committed state. Before any re-review is dispatched: commit the fix, THEN run node src/secret-scan/history-scan.ts and node src/qa/recurring-findings-registry.ts against the resulting commit -- not the working tree -- and quote that output in the build receipt. This is the one condition that directly targets the demonstrated root cause (Section 1); it costs nothing new (no mechanism to build, just sequencing the existing instruments correctly), and it is the exact thing three consecutive rounds skipped.
2. #182 gets a named one-line decision (in docs/decisions.md or the CHANGELOG entry) stating the corpus-figure semantics chosen, not just a silent code change.
3. cross-domain-reviewer stays seated, even under lighter ceremony. Every one of the three defect classes that actually blocked this story (stale milestone, secret-scan collision, registry-promotion gap) was found by the cross-domain lane, not the domain-specific ones -- dropping the one reviewer whose lane has caught 100% of the seam-level defects, at the exact round where the story is trying to close out cleanly, is the wrong place to economize. code-reviewer or red-team alone (not both) is a reasonable STANDARD-tier-style single-domain pick for this narrowed, non-compounding remainder; cross-domain-reviewer is not optional per CLAUDE.md's own every-tier-above-TRIVIAL rule regardless.

### Path B -- detail

Covered in full in Section 2. Not gated on any code defect in #176/#177/#178 (which red-team round 3 independently re-verified as genuinely sound engineering) -- gated on topology: it is a new mechanism, in a named sensitive area, that this story was never scoped to build, arriving at the exact moment this story's own history argues loudest for not absorbing more surface into an already-overrun branch.

### Path C -- detail

As stated (all three residuals, no more code), REWORK: #180 is a git-history-permanent, deterministic, blocking-gate failure on the actual committed tree of this exact branch -- this is qualitatively different from #154's own precedent (a classifier residual, negotiated twice, genuinely non-blocking). ADR-0008's MUST-NOT-merge-with-a-failing-gate rule is not a severity call a reviewer can waive; it is an Accepted ADR's MUST, which outranks convention per PRINCIPLES rule 9, the same route the cifix design-challenger used to force O1 to BREAKS despite recalibrating its severity tag down. There is also no cost tradeoff that makes deferring #180 rational -- the fix is smaller than the paperwork a residual entry would require.

A narrower Path C-prime -- fix #180 only (mechanical, mandatory), backlog #181 and #182 as disclosed residuals with their own Issues, close #164/#154 now, no dedicated review round at all -- is architecturally defensible and worth naming as the cheapest viable option if the human wants to stop spending review cycles on this file family immediately. I do not rank it above Path A because #182 in particular is a real (if small) semantics question that benefits from at least being named before it is deferred, not just left as an unexamined side effect of #172's shipped design -- but it is not a REWORK-class path the way literal Path C is.

---

## 4. ADR relevance

- SE ADR-0021 (thoth-native architecture -- kernel purity, Action record, gate surfaces, audit trail): CONFIRMS N/A. Independently re-checked: git diff --stat ad196c5 6393d16 -- src/ touches only src/qa/*, src/lib/git.ts (+test) -- no file under, importing from, or exporting into the kernel/normalizer-registry/gate-surface/audit-log/Action-record boundary this ADR governs. All three rounds' reviewers reached the same conclusion independently; I confirm it holds across the full three-round diff, not just round-by-round.
- SE ADR-0010 (code quality and maintainability gates): VIOLATES, on round 3's own claim, not on the shipped code. Operative line: MUST run the full local equivalent of CI gates before declaring work complete; failing gates = unfinished work. Round 3's CHANGELOG/STATE.md/commit message claimed 785/785 pass, 0 fail while the actual committed-tree OSS-01 gate was failing (784/785) -- independently reproduced by all three round-3 reviewers and by me, above. This is not a new finding (Issue #180 already carries it); named here for the compliance record because it is the ADR that makes Section 1's root cause a rule violation, not merely an observation.
- devops ADR-0008 (CI/CD gates and policy-as-code): VIOLATES if #180 ships unfixed (Section 3, Path C). Also worth noting for Section 2: this ADR's own rule set already includes MUST install and run the Gitleaks pre-commit hook; MUST NOT bypass it to force a commit containing a flagged secret. This project uses its own src/secret-scan/* mechanism, not literal Gitleaks, but the underlying MUST -- a pre-commit gate for the secret-scanning mechanism this project actually runs -- is exactly Path B's shape and is already an accepted-ADR-level expectation, not merely a nice-to-have this project invented for itself. That strengthens Section 2's build-it-but-as-its-own-story recommendation; it does not change the not-folded-into-this-story ruling.
- No other ADR in the 35-ADR catalog is implicated -- this diff introduces no new dependency, no new deploy surface, no new IAM/network/data surface.

---

## NOT-COVERED / AMBIGUOUS -- architect's work queue

1. NOT-COVERED. No ADR states what a QA-instrument's published figure must mean when the working tree contains untracked-but-not-gitignored content (Issue #182's underlying question). Feeds: the one-line decision Path A's condition 2 asks for now; a durable answer (if this recurs a third time across another instrument) would be a small ADR amendment to SE-0010's testing-strategy guidance or a standalone convention doc.
2. NOT-COVERED, but already ratified in principle. Path B itself has no governing ADR because it does not exist yet; docs/backlog.md line 56 is the correct interim record. Recommend the Manager promote it from backlog prose to a ratified next-story pick at this council's close, given it is now on its second real-world trigger.
3. AMBIGUOUS, escalate, not mine to invent. Whether this project wants a general verify-against-the-post-commit-tree-state step as a standing Stage-3/Stage-4 convention (not just for secret-scan, but for any gate -- QA-13, QA-14, QA-15 -- that reads committed rather than working-tree state) is a process-architecture question bigger than this one story's scope. I name it because Section 1's root cause generalizes past OSS-01, but I do not rule on it here -- that is either a docs/PRINCIPLES.md amendment or a Manager-level process decision, not an ADR, and not mine to write unilaterally.

---

## Single next action

Fix Issue #180 (one allowlist entry, mirroring the existing history-scan.test.ts precedent exactly), commit it, then re-run node src/secret-scan/history-scan.ts and node src/qa/recurring-findings-registry.ts (with #181's row added) against that commit -- not the working tree -- before dispatching the next review round. That single sequencing change is the concrete fix for the root cause this report identifies.

---

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings (ALL of them, one terse line each, ranked by blast radius -- status [ISSUE]=VIOLATES / [SUSPICION]=NOT-COVERED or AMBIGUOUS / [CLEAN]=CONFORMS; every [ISSUE]/[SUSPICION] tagged severity + evidence tier):
1. [ISSUE][MED][demonstrated] Round-3's own "785/785 pass, 0 fail" claim VIOLATES SE ADR-0010 (MUST run the full local equivalent of CI gates before declaring work complete; failing gates = unfinished work) -- independently reproduced at current HEAD 6393d16: node src/secret-scan/history-scan.ts exits 1 on an unallowlisted marker-corpus-probe.test.ts email-address match, npm test fails the same OSS-01 dogfood assertion, zero matching allowlist entry exists. Already carried by Issue #180 (filed by cross-domain-reviewer, corroborated by code-reviewer and red-team) -- not duplicated, cited for the ADR record.
2. [SUSPICION][MED][code-traced] No pre-commit or post-commit-state verification mechanism exists anywhere in this repo (confirmed: .git/hooks/ empty of any real hook, no husky, no pre-commit-named script anywhere) -- the structural root cause of round 3's #180 and, in a different guise, rounds 1-2's concurrency-flake class: every round's own done claim was measured against a tree state the actual failing gate does not read. NOT-COVERED by any ADR as an implemented mechanism today, though devops ADR-0008 already MUSTs a pre-commit secret-scan hook in principle. Feeds the Path B pull-forward recommendation (Section 2).
3. [SUSPICION][MED][derived] The re-measure-post-commit-not-just-pre-commit lesson was already written down once (CHANGELOG.md's qa14-marker-redesign entry) and ratified once as a mechanism-in-principle (cifix council, Path B) before round 3 of this story reproduced the identical failure mode -- a lesson living only in prose/backlog, not in a runnable check, does not transfer round-to-round. Feeds: promote Path B from backlog prose to ratified next story now, not deferred indefinitely.
4. [SUSPICION][LOW][demonstrated] QA-13's own recurring-findings-registry was not fed at the second occurrence of "a fix round's own committed artifacts red a gate that only reads committed state" (cifix #131 to this story's #180), despite its own convention mandating a row same-turn and promotion before a third occurrence -- already carried by Issue #181 (red-team), cited here as evidence for finding 2/3's structural framing, not duplicated.
5. [SUSPICION][LOW][derived] Issue #182's underlying question (should an untracked-but-not-gitignored file contribute to a published QA-instrument figure, and if so, labeled how) is a real, if small, instrument-semantics decision with no governing ADR or prior project convention -- recommend one named sentence in docs/decisions.md alongside whatever code fix lands, not a silent absorption into just-fix-it.
6. [CLEAN][code-traced] SE ADR-0021 (kernel purity / Action record / gate surfaces / audit trail) -- CONFIRMED N/A across the full 3-round diff (git diff ad196c5 6393d16 -- src/ touches only src/qa/* and src/lib/git.ts; no kernel/normalizer-registry/gate/audit-log/Action-record surface touched), independently re-checked, not just taken on the three prior reviewers' agreement.
7. [CLEAN][derived] Path B as sketched (standing pre-commit dogfood check, zero new exemption-grant surface, secret-scan-allowlist.json remains sole grantor) is architecturally sound in shape per the cifix council's own addendum-corrected design -- the topology objection here is sequencing (build it next, not now, folded into this story), not the mechanism's own design.
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=1 suspicions=4 clean=2
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=2 code-traced=2 derived=3
checks=node src/secret-scan/history-scan.ts exit=1 (1 unallowlisted match, marker-corpus-probe.test.ts, confirmed at HEAD 6393d16); grep docs/qa/secret-scan-allowlist.json for marker-corpus-probe = 0 matches; npm test tail confirms the same OSS-01 dogfood AssertionError; git diff --stat c2408ba 6393d16 confirms zero src/ change since round 3 (docs/bookkeeping only); git diff --stat ad196c5 6393d16 -- src/ confirms diff scope is src/qa/* + src/lib/git.ts(+test) only, no kernel-boundary file; ls .git/hooks/ (no real hook present), grep husky package.json (no output), find *pre-commit* (no output) confirm no pre-commit mechanism exists in this repo today
adr=HIT(35)
report=docs/reviews/s1-closeout-164-154-architecture-2026-09-13.md
