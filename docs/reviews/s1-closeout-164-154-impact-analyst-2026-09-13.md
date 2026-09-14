# Impact Analyst (Wepwawet) — council seat — `s1-closeout-164-154` (Issues #164 + #154)

- **Date:** 2026-09-13
- **Target:** branch `fix/s1-closeout-164-154` @ `6393d16` (build tip `c2408ba`; `6393d16` adds only docs/state/report commits — confirmed via `git diff --stat c2408ba 6393d16`: 6 files, all `docs/*`, 0 `src/*`)
- **Tier:** CRITICAL. **Trigger:** rule 16(c) — 3 consecutive REWORK-class Stage-3 rounds (`cross-domain-reviewer` REWORK / `code-reviewer` SHIP-AFTER-FIXES / `red-team` no-go, round 3; `reviewRoundsSinceClean=3`, `reviewRoundsTotal=3` in `docs/.maat-state.json`).
- **Read:** `docs/STATE.md`, `CLAUDE.md`, `docs/PRINCIPLES.md`, `docs/decisions.md` (active rows), `docs/.maat-state.json`'s full nested scope history, all 9 prior reports in `docs/reviews/s1-closeout-164-154-*.md` (rounds 1-3, all three lanes), Issues #180/#181/#182 (bodies + comments, via `gh issue view`), `docs/qa/recurring-findings-registry.md`, `docs/qa/secret-scan-allowlist.json`, `docs/backlog.md`'s cifix-council Path B row, and the shipped source (`src/qa/marker-corpus-probe.ts`, `.test.ts`, `src/lib/git.ts`).
- **My question, not the design-challenger's or architect's:** what does each candidate path do to everything else, upstream and downstream. I do not re-litigate whether #164/#154's substance is correct (three rounds of red-team/code-reviewer/cross-domain already settled that: "the round-3 fixes themselves are good... seven attacks survived").

---

## Context established before pricing anything

Three facts drive every verdict below, each mechanically confirmed, not assumed:

1. **#164/#154's own substance is closed and re-confirmed clean three times over.** Round-3 red-team: "#176 survived 48 concurrent runs (4x the claimed load). #177 and #178 each go red under my own hand-applied mutations, in both files." Round-3 code-reviewer: SHIP-AFTER-FIXES with only the #180 finding as HIGH; everything else CLEAN. Round-3 cross-domain: REWORK on #180 alone, CLEAN on everything else including Issue Discipline and the widened export surface. No open finding touches #164's or #154's actual fix content.

2. **#180 is not a ceremony question — it is a hard, mechanical merge blocker, independent of which path is chosen.** `.github/workflows/ci.yml`:
   ```
   $ grep -n "npm test\|history-scan.ts" .github/workflows/ci.yml
   194 (approx):  run: npm test
   257-258:       - name: OSS-01 full-history secret scan
                    run: node src/secret-scan/history-scan.ts
   ```
   Devops ADR-0008: "MUST NOT merge a PR with any blocking gate open, failing, or pending." Both steps are currently red at `c2408ba` (measured, 8/8 and 5/5 reproductions across two independent reviewers). **This means "ship with #180 as a disclosed residual" is not an available path** — some fix for #180 must land in *this* story before anything merges. The only live design question is whether #181 and #182 come along with it, and at what ceremony.

3. **#180's minimal fix is already unanimously reviewed.** All three round-3 reports (red-team, code-reviewer, cross-domain) independently proposed the identical one-line fix and confirmed it mirrors an exact existing precedent:
   ```
   $ grep -n "history-scan.test.ts" docs/qa/secret-scan-allowlist.json
   {"path": "src/secret-scan/history-scan.test.ts", "patternId": "email-address", "reason": "..."}
   ```
   No other file in the repo needs the same fix — confirmed mechanically:
   ```
   $ grep -rn "user\.email\|user\.name" --include=*.ts src/
   src/qa/marker-corpus-probe.test.ts:29-30   <- NEW, unallowlisted (Issue #180)
   src/secret-scan/history-scan.test.ts:130-131,176-177  <- both already allowlisted
   ```
   Of this repo's 6 `mkdtemp`-sandboxed test files, only these two ever `git commit` inside their fixture (`grep -l mkdtemp --include=*.test.ts -r src/ | xargs grep -l "git commit"` → exactly these two). The producer population for this defect class is fully enumerated at 2, and both are now accounted for once #180's entry lands.

---

## Candidate A — fix #180 + #181 + #182 each in isolation, lighter ceremony

**What it does, precisely:** three separate small edits — (1) one `docs/qa/secret-scan-allowlist.json` entry, (2) one `docs/qa/recurring-findings-registry.md` row, (3) a code-level fix to `marker-corpus-probe.ts`'s file enumeration or output shape so the published corpus total is no longer sensitive to transient untracked scratch files — each reviewed lighter than the full 3-reviewer CRITICAL re-review this story's tier otherwise requires.

**Classification:** **split, and the split is the whole finding.**
- #180 (allowlist entry): **local**. Data-only, no caller/consumer sees new behavior beyond "the gate now passes."
- #181 (registry row): **local**. Append-only markdown row; `src/qa/recurring-findings-registry.ts` validates row *shape*, not content, so this is inert to every consumer except a human reader and the shape validator.
- #182 (corpus-count fix): **seam, and specifically the SAME seam that has broken three times already.** It touches `collectFullTreeFileTexts` / `lsFilesWorkingTree` / `computeMarkerCorpusStats` / the CLI's `--field=total` output contract — the exact function chain `#164 → #172 → #176 → #178` all touched, each round's fix producing the next round's fresh defect.

**Upstream — who feeds this (mechanical):**
```
$ grep -rn "lsFilesWorkingTree" --include=*.ts src/
```
→ 1 production call site (`marker-corpus-probe.ts:212`, via `collectFullTreeFileTexts`), 1 implementation (`git.ts:145`), 4 test call sites. `continuation-residual-probe.ts` has its own separate, structurally-identical `collectFullTreeFileTexts` (line 214) — a second, undeduped producer of the same class (cross-domain round-3 named this as a DRY smell, LOW/derived, non-gating). Both producers feed an untracked-file-inclusive file list; #182's fix, if it rescopes that list, constrains both.

**Downstream — who consumes this (mechanical):**
```
$ grep -n "field=total\|qa14-marker-corpus-probe" src/qa/completeness-claim-checker.ts src/qa/marker-corpus-probe.test.ts
```
→ `completeness-claim-checker.ts`'s `KNOWN_INSTRUMENTS` runs `node src/qa/marker-corpus-probe.ts --field=total` and parses its stdout; `marker-corpus-probe.test.ts:113` pins, by mutation test, that `--field=total` mode "must print ONLY that field, never the default mode's own multi-number summary." CHANGELOG.md/docs/STATE.md quote the human-readable default-mode sentence in prose (not machine-parsed). That is the complete consumer set — 1 machine consumer with a pinned exact-shape contract, 2 prose-quoting documents with no parser.

**The concrete regression risk, demonstrated, not hypothetical:** the prompt's own candidate wording for #182 — "only count tracked+explicitly-staged files" — is the literal mirror image of #172's fix. #172 exists *because* an untracked file's citations were silently invisible (demonstrated in this file's own header comment: "baseline total=989; add an untracked file with 3 bare #N citations, total stays 989"). The regression test that would break:
```
$ grep -n "Issue #172 regression, isolated" src/qa/marker-corpus-probe.test.ts
190: test("QA-14 marker-corpus-probe (Issue #172 regression, isolated): a genuinely untracked,
     uncommitted, scannable file IS now counted — list and content agree on the same tree state" ...)
```
Scoping the count to tracked-only does not merely risk reopening #172's class — it fails this named, already-shipped, already-mutation-verified regression test outright. This is not a UNKNOWN/derived risk; it is `code-traced` and mechanically demonstrable in under a minute by anyone who runs the suite after making that edit.

The safer variant red-team itself proposed (report the untracked contribution separately, e.g. `total=N (U untracked)`) is real code, not documentation, and if applied to the `--field=total` mode specifically, collides with the pinned "must print ONLY that field" contract above — a second, independent way this "safer" variant can still regress something already shipped and tested. It is *implementable* safely (apply the annotation to the default/summary sentence only, never to `--field=total`), but that is exactly the kind of care this file's last three rounds have each gotten subtly wrong under time pressure, and "lighter ceremony" removes the one thing (full CRITICAL red-team + code-reviewer + cross-domain review) that caught all three prior instances.

**Invariant delta:**
- #180/#181: nothing that was true before changes for any consumer. Adding an allowlist entry doesn't change what the scanner *catches*, only what it's told to ignore at one exact (path, patternId) pair; adding a registry row doesn't change any code path.
- #182 (full fix): the invariant "the corpus's file list includes every untracked-but-not-ignored file, no exceptions" (established by #172, defended by a named regression test) would no longer hold if rescoped, and the "`--field=total` prints only that field" invariant (established by #156, defended by a named mutation test) is at risk if the safer variant is implemented carelessly. Both are relied on by an already-shipped test; a fix that quietly breaks either is caught only by re-running the suite — i.e., only if the ceremony this path proposes to skip actually happens.

**Whack-a-mole verdict:**
- #180/#181: **CONTAINS.** The class ("a fix round's own committed artifacts red a gate that only reads committed state") is fully enumerated (2 producers, both now covered) and the registry row is the mechanical guard the project's own QA-13 convention already specifies — nothing further to build, just to write down. This class has now fired **twice** (#131 2026-09-09 → #180 2026-09-13); per `docs/qa/recurring-findings-registry.md`'s own convention, promotion into an actual lint is "mandatory before the third story ships," not yet at this round.
- #182: **WIDENS if implemented as scope-narrowing (mechanically demonstrated: breaks a named, shipped regression test); UNKNOWN-tending-to-RELOCATES if implemented as the "report untracked separately" variant under lighter-than-normal review** — it is a real code change to the single highest-defect-density function chain in this story (4 for 4 rounds each introducing a fresh bug), reviewed with less rigor than the ceremony that has been this file's *only* effective defense so far.

**Ledger:**
```
Fix A(#180): touches 1 file / 0 call sites · new preconditions 0 · migration no
  · reversible yes · exposure if wrong ~0% (data-only, mirrors byte-identical precedent)
  · residual if NOT fixed: 100% of CI/local `npm test` runs blocked, basis: measured (8/8, 5/5 reproductions)

Fix A(#181): touches 1 file / 0 call sites · new preconditions 0 · migration no
  · reversible yes · exposure if wrong ~0% (append-only doc row, validated by shape only)
  · residual if NOT fixed: 0% functional; this project's own written QA-13 convention is violated
    by omission a 2nd time, basis: measured (registry file's own convention text)

Fix A(#182, "rescope to tracked-only"): touches ~2-3 files (marker-corpus-probe.ts, .test.ts,
  possibly git.ts) · new preconditions 1 (reopens #172's own precondition) · migration no
  · reversible yes · exposure if wrong: breaks a named shipped regression test, basis: code-traced
    (marker-corpus-probe.test.ts:190) — this is not a probability, it is a guaranteed test failure
  · residual if NOT fixed: measured live 1087->1106->1110 (~1.7%) in one session; 0% in CI
    (actions/checkout yields a clean tree), basis: measured

Fix A(#182, "report untracked separately"): touches ~3 files · new preconditions 1 (the
  `--field=total` exact-output-shape contract, pinned by marker-corpus-probe.test.ts:113, must not
  be touched) · migration no · reversible yes · exposure if wrong: unmeasured until implemented —
  the command that would settle it is `node --test src/qa/marker-corpus-probe.test.ts
  src/qa/completeness-claim-checker.test.ts` post-edit
  · residual if NOT fixed: same as above, ~1.7% measured, 0% in CI
```

**Verdict: PATCH-WITH-CONDITIONS.** #180 and #181 alone, at the lighter ceremony this path proposes, are SAFE-TO-PATCH. #182 is not safe at the ceremony this path proposes for it — either it ships as disclosure-only (which is not really "fixing" #182, see Candidate C), or it gets a real code fix and, given this file's exact 4-for-4 track record, the full CRITICAL 3-reviewer round this path is trying to skip.

---

## Candidate B — build the standing pre-commit/CI dogfood check now, inside this story

**What it does:** pulls forward the cifix-council's own 2026-09-09 "Path B" (a standing check that scans the actual to-be-committed tree for secret-scan hits, and possibly flake/mutation gaps, before a round is declared clean) and builds it as part of closing out #164/#154.

**Classification: systemic, and already ruled on as such.** This is not a fresh classification call — the prior council already did this work:
```
$ grep -n "Path B, ratified by council GO" docs/backlog.md
56: **[architecture-reviewer (+ addendum), cifix design council · 2026-09-09]** ...
    Path B, ratified by council GO but scoped to its own STANDARD-tier follow-on story, NOT part
    of `cifix`: ... Touches a CLAUDE.md-named sensitive area's enforcement point, so it draws its
    own dated review round when built, same ceremony as any other change there.
```
That ruling stands, is 4 days old, and was made by the same council format convened right now. Nothing about this council's own trigger (#164/#154's substance being done, #180/#181/#182 being residuals of round 3) reopens that ratified scoping decision.

**Upstream — who feeds this:** the mechanism doesn't exist yet, so there is no shipped upstream to enumerate; the honest statement is `unmeasured`, and the correct command once a design exists is `git log --all --diff-filter=A -- '<new script path>'` plus a fresh `applicableTo` grep against the ADR catalog for the CI/pipeline/quality/security slice (12 devops ADRs, filtered) that a reviewer would need to read before this could ship.

**Downstream — who consumes this:** `.github/workflows/ci.yml` (a CLAUDE.md-named sensitive area: "Secret scanning / CI gates"), every future PR's merge gate, and — per the architect's own same-session addendum already on record — `docs/qa/secret-scan-allowlist.json` stays the sole exemption mechanism, so this new check must not introduce a second, competing exemption surface. That addendum alone is evidence this is a real design decision with a real wrong-answer shape, not a mechanical addition.

**Invariant delta:** today, no gate re-verifies committed state after a round's own pre-commit verification runs — that is precisely what let #180 through 3 rounds' worth of "10 consecutive full-suite runs, zero flakes" claims. Building this changes that invariant for every future PR touching this repo, not just this story — a systemic change by definition, and one CLAUDE.md's own sensitive-areas list already flags as requiring "a fresh dated review report" before it lands.

**Whack-a-mole verdict:** the class this would CONTAIN ("a fix round's own committed artifacts red a gate that only reads committed state") is real and has now fired **twice** (#131, #180) — this is exactly the shape QA-13's own convention calls a structural finding, not a one-off. But *building the guard inside the story whose own residual is the 2nd trigger* is itself the WIDENS risk: it takes an already-3x-REWORK CRITICAL scope and adds a brand-new, never-built, CI-pipeline-touching mechanism to it, under the same time pressure that produced 4 consecutive fresh defects on a *much smaller* surface (one QA instrument file) than "the CI gate itself." Doing the higher-risk, higher-blast-radius thing at the moment this loop has already demonstrated it cannot currently ship small changes to this area cleanly is the wrong sequencing, independent of whether the check itself is a good idea (it is — see Structural findings, below).

**Ledger:**
```
Fix B: touches unmeasured files (net-new mechanism; estimate 4-8 based on the shape of
  history-scan.ts/history-scan.test.ts it would need to sit beside) · new preconditions:
  unmeasured (design not yet written) · migration no (net addition) · reversible yes
  · exposure if wrong: unmeasured, but the blast radius is "every future PR's merge gate,"
  the single highest-consequence surface this repo has, basis: counted-in-code (CLAUDE.md's own
  sensitive-areas list names CI gates explicitly)
  · residual if NOT fixed now (i.e., if deferred again to its own story): 0% — the class's
  concrete instances (#180) are still separately fixed by Candidate A/C's one-line allowlist entry
  regardless of whether the standing check is ever built; the standing check only prevents the
  NEXT occurrence, which the registry row (#181) already tracks as owed before a 3rd occurrence.
```

**Verdict: REDESIGN-REQUIRED for doing it inside this story** (not for the check itself, which should get built — just not here, not now, not under this story's ceremony). This is the strongest read against my own recommendation for Candidate C, and I name it as such below.

---

## Candidate C — ship #164/#154 now (with the one mandatory #180 fix), file #180's registry obligation and #182 as a follow-on story's scope

**What it does, precisely, corrected from its literal framing:** the "no further code in this story" framing in the prompt cannot be executed as stated, because #180 is a hard merge blocker (see Context, point 2) — so the practically achievable version of this path is: land the single, already-unanimously-reviewed allowlist entry for #180 (unblocks CI, zero design content), add the owed `docs/qa/recurring-findings-registry.md` row for #181 (near-zero cost, no code, this project's own written convention obligates it same-turn regardless of path), close #164/#154 on their already-3x-confirmed substance, and file #182 (plus the standing-check idea from Candidate B) into a separately-scoped follow-on story rather than fixing #182's code in this one.

**Classification: local.** The only diff against `c2408ba` this path requires is a one-entry JSON addition (data, not logic) and a one-row markdown addition (docs, not logic). Nothing about #164's or #154's own shipped behavior changes; nothing new is exposed to any caller.

**Upstream — who feeds this:** already enumerated above (Context, point 3) — exactly 2 producers of the email-literal-in-a-mkdtemp-fixture pattern, both now covered once this entry lands. Zero other producers exist to satisfy a new precondition, because this fix adds no precondition — it removes a false negative in an allowlist, it does not add a rule anything else must now comply with.

**Downstream — who consumes this:** the OSS-01 scanner (`src/secret-scan/history-scan.ts`) and `npm test`'s dogfood test are the only two consumers of `docs/qa/secret-scan-allowlist.json`'s content, and both simply stop failing once the entry exists — no other test, script, or doc reads this file. Confirmed no other file references this allowlist:
```
$ grep -rln "secret-scan-allowlist" --include=*.ts --include=*.md src/ docs/ .github/
src/secret-scan/history-scan.ts
docs/qa/secret-scan-allowlist.json (itself)
docs/qa/recurring-findings-registry.md (mentions it in prose only, this candidate's own #181 fix)
```

**Invariant delta:** none. "Every mkdtemp-fixture-committed literal has a matching allowlist entry" was already the invariant #180 violates; this path restores it without changing what the invariant *means* or who else must satisfy it.

**Whack-a-mole verdict: CONTAINS**, for the code/data touched. The story's own blast radius (marker-corpus-probe.ts/continuation-residual-probe.ts's ref/content and enumeration fixes) is not reopened, expanded, or touched at all by this path — it is exactly the shape rule 16(c)'s own GO criteria ask for: "no open calibrated blocking HIGH" (satisfied once the allowlist entry lands — #180 was the only HIGH), and "the artifact's gating verification run" (re-run `npm test`/`history-scan.ts` post-commit, the one thing every round has skipped). #182 stays a **RELOCATES-by-design** residual — moved to a follow-on story rather than solved here — which is honest and matches this project's own accepted precedent for exactly this shape of decision (Issue #154 itself: "verify-and-close only... the comma/list-continuation misclassification was already ruled twice not to get a code fix").

**Ledger:**
```
Fix C (#180 mandatory + #181 cheap, #182 deferred): touches 2-4 files (allowlist entry, registry
  row, CHANGELOG/STATE close-out prose) / 0 production call sites · new preconditions 0
  · migration no · reversible yes
  · exposure if wrong ~0% — the allowlist entry is the identical shape as an entry all 3 reviewers
    already independently proposed and a byte-identical existing precedent; the registry row is
    append-only prose
  · residual if NOT fixed (#182 left as a disclosed residual): measured 1087->1106->1110 (~1.7%)
    in a shared local/agent checkout, 0% in CI, basis: measured (red-team round-3, reproduced live
    this session's own read of that report)
```

**Verdict: SAFE-TO-PATCH.**

---

## Does fixing #182 risk reopening the exact class that has bitten this story 3 times running?

**Yes, demonstrably, for the version of the fix named in the prompt** ("only count tracked+explicitly-staged files") — it is not a *risk* of reopening #172's class, it is a guaranteed failure of #172's own named, shipped regression test (`marker-corpus-probe.test.ts:190`, code-traced above). Any 4th round attempting that specific fix would need to either delete/rewrite that test (an ADR-0010 MUST-NOT: "MUST NOT lower gate thresholds, delete tests... without a human-approved exception") or accept the reopening as intentional and get it human-ruled — which is itself evidence this "fix" is really a design tradeoff, not a bug fix, and belongs in front of a reviewer, not shipped at "lighter ceremony."

The safer variant (report the untracked contribution separately rather than narrowing scope) avoids reopening #172's class but touches the same 4-for-4 function chain under a pinned output-shape contract (`--field=total` must print only that field) that a careless implementation can still trip — real but smaller risk, `unmeasured` until someone writes and runs it.

**Is there a minimal, genuinely-lower-risk version?** Yes: **disclose, do not rescope** — exactly this project's own already-accepted precedent for #154 ("verify-and-close only, no new code... a residual not worth fully closing"), and the precedent this same file family already set for the identical underlying problem (self-referential corpus growth) one story ago:
```
$ grep -n "Issue #155" CHANGELOG.md | head -1
... the 3 expect=N markers are removed from this file's prose ... no stable reformulation of
"how many bare #Ns in the whole repo lack a marker" is both meaningful and stable — the figure's
whole point is to describe a corpus that grows.
```
That round chose disclosure over a stabilizing code fix for the same instrument, for the same underlying reason (this corpus is inherently sensitive to tree state nobody fully controls), and it was accepted. Applying the identical logic to #182 — a one-line disclosure in CHANGELOG.md/docs/STATE.md ("this figure reflects the working tree at measurement time; CI always measures a clean checkout, so this residual is 0% there") — costs zero files touched in `src/`, zero new preconditions, and cannot regress `marker-corpus-probe.test.ts:190` because it never touches that code path. This is the version Candidate C actually ships.

---

## Structural findings (defect classes fixed/recurred 2+ times — say the guard, not the design)

1. **"A fix round's own committed artifacts red a gate that only reads committed state."** Fired twice: Issue #131 (2026-09-09, cifix) → Issue #180 (2026-09-13, this story). QA-13's own convention (`docs/qa/recurring-findings-registry.md`) already names the remedy shape ("a `pending lint` row now, promoted to an enforcing check before the 3rd occurrence") — #181 is that row, owed same-turn regardless of which path ships. The enforcing check itself is Candidate B's standing dogfood check, already scoped by a prior ratified council decision to its own STANDARD-tier follow-on story (`docs/backlog.md` line 56) — that scoping should stand; the row is what's overdue, not the check.
2. **"This story's own verification loop cannot see what its own commit will break."** Named directly by red-team round 3 as "the single scariest unproven assumption" and is the mechanism behind finding 1 above — same class, not a second one. No new guard beyond #1's is needed; naming it twice would double-count.
3. **Corpus-instrument figures that move on incidental tree state, wired into human-facing prose without being CI-gated.** This is the *second* time this exact instrument family has hit this shape (round-3 `qa14-marker-redesign`'s Issue #155 self-referential-growth problem; now #182's untracked-scratch-file sensitivity) — both on `marker-corpus-probe.ts`'s own published total. Issue #155's resolution (disclose, don't gate) is the precedent Candidate C reuses. This is a real second occurrence of a related-but-distinct class from #1/#2 above; whether it independently earns its own registry row is a call for whoever owns `docs/qa/` next, not this analysis.

## Unmeasured

- Candidate B's real file/line count, days, and precondition list — the mechanism doesn't exist yet. Command that would produce it: none exists until a design is written; the closest available data point is the architect's own 2026-09-09 addendum in `docs/backlog.md` line 56, which is a scoping judgment, not a measurement.
- The exact regression-test outcome of #182's "report untracked separately" variant. Command that would settle it: `node --test src/qa/marker-corpus-probe.test.ts src/qa/completeness-claim-checker.test.ts` run against a candidate patch, before it ships.

## Recommended path

**Candidate C** (land the one mandatory, already-unanimously-reviewed #180 allowlist entry + the owed #181 registry row; close #164/#154 on their already-3x-confirmed substance; defer #182 as a disclosed residual and file it, with Candidate B's standing-check idea, into its own separately-scoped follow-on story) — because it is the only candidate whose entire diff is `local`/CONTAINS, touches zero of the code this story's own history shows is currently unsafe to touch quickly, and every reviewer has already, independently, converged on its one unavoidable edit.

**Strongest argument against my own recommendation:** #182's residual is real, silent (exit 0, no warning), and hits the exact figure this whole story exists to publish — deferring it means the next person to quote `marker-corpus-probe.ts`'s total from a local run can still be quietly wrong by a percent or two, and "disclose it" relies on someone actually reading the disclosure rather than the number. If this project's tolerance for silent, low-single-digit-percent drift in a non-CI-gated instrument is lower than I've priced it here, Candidate A's disclosure-only variant is the same ledger with an earlier date, not a different one — but a genuine code fix for #182, at any ceremony lighter than full CRITICAL review, is not defensible given this exact file's 4-for-4 track record this story has already demonstrated.

## The single change most likely to be regretted in a month

Not any of #180/#181/#182 individually — it's **treating this council's GO (if it grants one) as license for a "round 4"-shaped fix-now on #182 under the banner of "lighter ceremony," the same shape that produced #170, #176, and #180 in rounds 1 through 3.** The story's own record is that every "small, obviously safe" fix to this exact function chain has needed the full 3-reviewer round to catch what it broke. Skipping that ceremony once, on the reasoning that this round is "just residuals," is how a 4th fresh defect gets shipped a day after a council was convened specifically to stop that pattern.

---

RECEIPT: verdict=SAFE-TO-PATCH
candidates (ALL of them, one terse line each, ranked by risk):
1. [ISSUE][HIGH][code-traced][~100% of this story's own function-chain edits, 4-for-4 measured] Candidate A's #182 sub-fix, if implemented as "rescope to tracked-only": guaranteed failure of the shipped, named regression test `marker-corpus-probe.test.ts:190` (Issue #172 regression) — reopens the exact defect #172 already closed, under ceremony lighter than the review that has been this file's only effective defense in 3 prior rounds.
2. [SUSPICION][MED][derived][unmeasured] Candidate B: building the standing pre-commit/CI dogfood check inside this story widens scope into a novel, CI-pipeline-touching mechanism a prior ratified council (cifix, 2026-09-09) already scoped to its own STANDARD-tier follow-on story; pulling it forward now collides with that ruling and adds undesigned, unreviewed surface to an already-3x-REWORK CRITICAL scope.
3. [SUSPICION][LOW][code-traced][~1.7% measured local, 0% CI] Candidate A's #182 sub-fix, if implemented as "report untracked separately": smaller risk than the rescoping variant, but touches the same 4-for-4 function chain under a pinned `--field=total` output-shape contract (marker-corpus-probe.test.ts:113) that a careless edit can still break; unmeasured until written and run against the suite.
4. [CLEAN][demonstrated][100% of CI/local npm test runs, measured] Candidate C / Candidate A's #180 sub-fix: one-line `docs/qa/secret-scan-allowlist.json` entry, mirrors an exact existing precedent, already independently proposed and reviewed by all 3 round-3 reports, 2 of 2 producers of the class fully enumerated and now covered. CONTAINS.
5. [CLEAN][demonstrated][0% functional, process-debt only] Candidate C / Candidate A's #181 sub-fix: append-only registry row, zero code touched, validated by shape only, obligated same-turn by this project's own QA-13 convention regardless of path chosen. CONTAINS.
6. [CLEAN][demonstrated][0% CI, ~1.7% local] Candidate C's #182-as-disclosed-residual: reuses this exact instrument family's own already-accepted precedent (Issue #155, one story prior) for "disclose, don't stabilize a corpus that's inherently tree-state-sensitive." CONTAINS.
counts (CHECKSUM): issues=1 suspicions=2 clean=3
evidence (CHECKSUM): demonstrated=3 code-traced=2 derived=1
traced: upstream=2 producers (marker-corpus-probe.test.ts, history-scan.test.ts — the only 2 of 6 mkdtemp-fixture test files that git-commit inside their fixture) downstream=3 consumers (OSS-01 dogfood test, OSS-01 history-scan.ts CI step, completeness-claim-checker.ts's KNOWN_INSTRUMENTS parse of --field=total) structural=1 class fixed/recurred 2+ times (#131->#180, registry row owed)
recommended=C unmeasured=2 (Candidate B's real file/day cost; #182's "report separately" variant's post-edit test outcome)
checks=n/a (read-only analysis this pass; cites round-3 reviewers' own executed evidence: npm test 784/785 at c2408ba per red-team/code-reviewer/cross-domain, all independently reproduced; `grep -rn "user\.email\|user\.name"` — 2 files, 3 sites, confirmed this session; `grep -l mkdtemp --include=*.test.ts -r src/ | xargs grep -l "git commit"` — same 2 files, confirmed this session)
adr=HIT(35)
report=docs/reviews/s1-closeout-164-154-impact-analyst-2026-09-13.md
