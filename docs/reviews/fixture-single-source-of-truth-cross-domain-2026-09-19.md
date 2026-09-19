# Cross-domain review: fixture-single-source-of-truth (Issue #217)

[cross-domain-reviewer]
Cross-Domain Reviewer (Ra) -- scanning the seams between reviewer lanes

- Scope: `fixture-single-source-of-truth`, CRITICAL (Manager-ratified, not re-litigated). Branch `feat/fixture-single-source-of-truth`, `HEAD: 3dc2a99` vs base `953b078`.
- Date: 2026-09-19.
- Also owns the ADR TEXT review (no separate architecture-reviewer seat under the two-reviewer cap).

## 1. Lanes and ground covered

| Lane | Status when I read it | Ground |
|---|---|---|
| `app-security-reviewer` | report on disk: `docs/reviews/fixture-single-source-of-truth-app-security-2026-09-19.md`, APPROVE-WITH-CONDITIONS | hooks diff, Issue #99, fail-closed loader, ADR residual honesty, ADR rules 4/5 wording, unlock-hint wording |
| `red-team` | no report on disk at read time | adversarial pass, not duplicated |
| me | this report | whole ADR catalog vs diff, ADR text, `adr.dir` consumers, decisions/state/run-log/CHANGELOG/Issue consistency, deleted-test governance |

Not duplicated: app-security #1 (ADR rules 4/5 unverifiable, Issue #219 filed) and #3 (hint word "reviewed"). Finding 1 below overlaps app-security #2 (`proposed` status, a derived SUSPICION there). I keep it because the Manager asked the rule-9 question directly, and I convert it to a run check.

## 2. ADR catalog read (whole, unfiltered)

```
$ node docs/adr-cache.mjs --ensure
ADR cache HIT: reused 36 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:1] from catalog (fp 4c11208) [CACHE=HIT]
```

36 entries. Base catalog had 35; the first 35 are deep-equal in head (`first35 equal: true`), entry 36 is `THOTH-ADR-0001`.

## 3. ADR text review (owned here)

**(a) Template and INT-07 quote.**
- Follows `docs/adr-template.md`: frontmatter (`id`, `title`, `status`, `date`, `applicableTo`, `constraints`), Context, Decision, Rules for agents, Consequences (Positive/Negative), Alternatives, Compliance verification, References. The extra Residual-risk section is fine.
- INT-07 is quoted verbatim, checked by string match against `adr/software-engineering/0021-thoth-native-architecture.md`: `in ADR-0021: true in THOTH-0001: true`.
- It quotes the frontmatter constraint (ADR-0021 line 24). ADR-0021's "Rules for agents" line 213 words INT-07 differently ("MUST record thoth's own independent verdict for every control named in posture output"). Editorial: cite both.
- The paraphrase "ADR-0021's own text scopes INT-07 to a third-party plugin installed alongside thoth (REL-12)" is accurate (ADR-0021 lines 169, 225).

**(b) Is a project-tier ADR a legitimate carve-out, and does `proposed` bind today?**
- Legitimacy: yes, once accepted. PRINCIPLES rule 9 ("ADR vs ADR -> the more specific wins") and `adr/software-engineering/README.md` item 3 give the hook. A sibling ADR that narrows one rule for one file does not edit ADR-0021's Decision, so SE ADR-0001's "never edit an accepted decision" is not breached. Rules 1 and 6 of the ADR keep the scope from overreaching.
- Weak point: no machine link. ADR-0021 stays unmodified and shows INT-07 with no pointer to the exception, so a catalog reader filtering `accepted` sees INT-07 and no exception. Precedent for a status annotation without a Decision edit: ADR-0021 line 199 (forward-pointer on ADR-0017). Optional follow-up in the `adr` repo; not required here.
- Binding today: **no.** Rule 9 and SE ADR-0001 key on Accepted. `status: proposed` (line 5) binds nobody. Until the human flips it, INT-07 (accepted) is the governing text, and the permanent exemption rests only on a decisions row, which rule 9 ranks below an accepted ADR. That is the seam in F1.

**(c) Scope, residual, owner, removal trigger vs `docs/backlog.md:47` and REQUIREMENTS section 0.4 property 2.**
- Scope (one file, two lists) and the residual table are consistent with backlog:47 ("an in-repo fixture can never structurally satisfy property 2") and REQUIREMENTS.md line 70 ("Session cannot write it").
- The removal trigger is not anchored to any deliverable: F3.

**(d) `adr.dir` gaining `docs/adr`.** Consumers grepped (`adr.dir`, `maat.json`, `adr/`, `docs/adr` across `*.mjs *.ts *.json *.yml`):

| Consumer | Effect |
|---|---|
| `docs/adr-cache.mjs` (only reader of `adr.dir`; `adrRoots()` line 49) | `docs/adr` was already in its no-config fallback `["adr","docs/adr"]`. Walked recursively, sorted by path, so the new ADR sorts last. Frontmatter `id:` overrides the filename scheme, so `THOTH-ADR-0001` is kept. No duplicate id for it. |
| `adrSubmodules()` / autoSync | `docs/adr` is not inside a submodule; nothing to sync; autoSync is `false` anyway. |
| `.github/workflows/ci.yml:163` | checks only that `adr/devops` and `adr/software-engineering` are non-empty. Unaffected. |
| `src/qa/reference-resolver.ts:758-766` | builds its ADR set from `adr/**` filenames only; `docs/adr` is invisible to it. Source of F5. |
| `docs/session-brief.mjs` | calls `adr-cache.mjs --ensure` only. |
| hooks | none read ADRs. |

Pre-existing, not this diff: the catalog carries 11 duplicate ids (`ADR-0000..0010` exist in both `adr/devops` and `adr/software-engineering`) and one empty id (an ADR-dir `README.md`).

## 4. Cross-domain ADR verdict (whole catalog vs the changed files)

| ADR | Applies to diff? | Verdict |
|---|---|---|
| ADR-0021 INT-07 (arch/security) | yes: the diff lifts the time-box on the `knownConnectors` allowlist | Collision is reading-dependent (ADR-0021's own text scopes INT-07 narrowly; prior reviews treated the allowlist as a gap). Closed only by acceptance of THOTH-ADR-0001. **F1.** |
| SE ADR-0010 line 47 "MUST NOT ... delete tests"; line 42 "Ratchet ... never loosen without a superseding ADR" (code) | yes: 16 test names deleted, including the exact-content pin tripwires | Exception not recorded where it binds. **F2.** |
| SE ADR-0005 line 54 "MUST NOT delete or weaken a *failing* test to make CI pass" | yes | Agree with the ADR's reading: the base suite was green (879 pass, per decisions row and my scratch run showing only environment failures) and the deletion is the approved change. No finding. |
| SE ADR-0001 (agents never self-accept) | yes | Complied: `proposed`, "Agents MUST NOT self-accept" stated. |
| SE ADR-0002, 0003, 0004, 0006 (scope creep) | checked | No collision. The two backlog items are filed, not built. |
| devops ADR-0001..0012 | checked | Not applicable to the changed files. |
| ADR-0021 POL-11 kernel purity, audit-log rules | checked | No kernel or audit-log file touched. The two `src/policy/tools` edits are comment-only (C4). |

## 5. Findings

### F1 [ISSUE][MED][demonstrated] THOTH-ADR-0001 is `proposed`, acceptance may follow the merge, and the forcing function that would have surfaced it is removed in the same diff

- Evidence: `docs/adr/thoth-0001-central-classification-fixture-standing-exception.md:5` `status: proposed`; line 21 lets the human accept "in this PR or a follow-up commit". The timer (`expiresOn` 2026-10-07) was the only date that forced a decision; this diff deletes it. Commits 68179bc and 3dc2a99 say `Fixes/Closes #217`, whose own condition ("needs an ADR-0021 amendment or a new ADR", Issue #217 body) is unmet until acceptance.
- Run:
```
$ grep -q '^status: accepted' docs/adr/thoth-0001-central-classification-fixture-standing-exception.md; echo "status-accepted-check exit=$?"
status-accepted-check exit=1
```
- Domains in tension: process (rule 9 / SE ADR-0001) vs runtime (permanent allowlist ships now). Merge-then-forget leaves a permanent deviation from an Accepted ADR with no accepted exception, and nothing resurfaces it.
- Exposure: ~100% of merges of this branch (one PR); effect on 8 listed connectors plus 6 listed tools at every SessionStart, basis: counted in code (14 names in the JSON). Governance-only, no runtime failure, so MED not HIGH: the deviation pre-exists as a human-ratified interim exception and the flip is a one-line human edit.
- Minimal fix: the human sets `status: accepted` in this PR before merge; drop "or a follow-up commit" from line 21.
- Failing test (named): `THOTH-ADR-0001-status-accepted` = the grep above; currently exit 1.

### F2 [ISSUE][MED][code-traced] The deleted-test exception is recorded only in non-binding prose

- Evidence: SE ADR-0010 line 47 `MUST NOT lower coverage thresholds, delete tests, or broaden lint ignore lists`, no exception clause. The "human-approved exception in the PR" wording is on line 46 and covers only disable/skip/suppress. Line 42: gate thresholds "never loosen without a superseding ADR". The diff deletes the exact-content pin tests (a tripwire gate) and others. My name-diff of full `node --test` runs (base copy vs head): 16 names removed, 6 added, matching the implementer's claim.
- The exception lives in `docs/decisions.md` row (e) (a decisions row ranks below an accepted ADR, rule 9) and in THOTH-ADR-0001 "Consequences / Negative" (prose, not in `Rules for agents`; its rule 1 limits the exception to INT-07). ADR-0010's ratchet names a superseding ADR as the vehicle; THOTH-ADR-0001 is that vehicle only if it says so.
- Domains in tension: code-quality ADR (SE-0010) vs an ADR whose `applicableTo` is security+architecture only, so a code-lane reviewer filtering by domain never reads it.
- Exposure: 16 of 16 test deletions in this PR lack an ADR-level record, basis: counted (name-diff). One-time, human-directed, no failing test deleted, so MED.
- Minimal fix: add one line to THOTH-ADR-0001's Decision and Rules for agents naming the one-time, human-directed removal of `AC1-a`, `AC1-b`, `AC1-c`, `S5-R2-N2` and the expiry/`ratifiedBy` tests as an SE-0010 ratchet loosening recorded here; add `code` to `applicableTo`; human accepts (same edit as F1).
- Failing test (named): `THOTH-ADR-0001-covers-SE-0010-test-removal`:
```
$ awk '/^# Rules for agents/,/^# Residual/' docs/adr/thoth-0001-central-classification-fixture-standing-exception.md | grep -c "ADR-0010"
0
```

### F3 [ISSUE][MED][code-traced] The removal trigger names S6 but no S6 deliverable owns it, and closing #90 removes the only open tracker

- Evidence: ADR rule 6 (frontmatter line 16) and line 66 ("S6 ships an out-of-repo policy source for tool and connector classification"). Milestone #24 description (`gh api .../milestones/24`): `POL-07, POL-09 (pinning/stamping half only ...), POL-10. T10 (delivery format) reopened here.` No tool/connector classification source. Its 5 open issues (#107, #108, #110, #112, #124) are defects in already-built code. `src/policy/tools/builtin-tool-inventory.ts:16-18` (retained by this diff): "no ratified milestone currently owns building a real central-override CONFIG LOADER". REQUIREMENTS.md line 646: T5 "Who owns the tool classification catalog" is an open decision.
- Consequence: with the timer gone the exception has no date and no owned trigger, so it is permanent in practice while ADR rule 6 and the decisions row present it as bounded. The decisions row also closes Issue #90 `not_planned` after merge, removing the last open tracker of the spoofability residual.
- Exposure: ~100% of the exception's lifetime (until a trigger that has no owner), basis: counted in code (milestone description, code comment).
- Minimal fix: file one Issue for T5 (tool/connector classification catalog source, S6 or a named later milestone), cite its number in the ADR's "Removal trigger" line, and either keep #90 open until it ships or link it in a comment on #90 before closing. No code.
- Failing test (named): `THOTH-ADR-0001-removal-trigger-has-owner`:
```
$ grep -cE "Removal trigger.*#[0-9]+" docs/adr/thoth-0001-central-classification-fixture-standing-exception.md
0
```

### F4 [SUSPICION][MED][derived] ADR rule 2 may contradict CLAUDE.md's sensitive-area review-report rule

- ADR rule 2 (line 12): the merged entry "is its approval". CLAUDE.md Hard rules: no change to the sensitive areas (policy delivery) "without a fresh dated review report in `docs/reviews/`". The CHANGELOG files this story under "policy delivery". Once accepted the ADR outranks CLAUDE.md (rule 9), but it never says it carves out that rule. Fix: one clause in rule 2 stating whether a fixture-entry PR needs a review report. Derived from documents; no test; residual-register line.

### F5 [ISSUE][LOW][demonstrated] The `THOTH-ADR-NNNN` id scheme is read by QA-14 as the unrelated `ADR-0001`

- `src/qa/reference-resolver.ts:97` `ADR_CANDIDATE_RE = /\bADR-(?=[A-Za-z0-9]*\d)[A-Za-z0-9]+/g` matches inside `THOTH-ADR-0001`.
```
$ node scanReferences("see `THOTH-ADR-0001` and `ADR-0099` here")   (knownAdrIds = {ADR-0001, ADR-0021})
[{"raw":"ADR-0001","verdict":"resolved","reason":"found in ADR catalog"},{"raw":"ADR-0099","verdict":"unresolved-authority", ...}]
```
- A citation of the project ADR resolves against SE ADR-0001 (record architecture decisions); a mistyped `THOTH-ADR-0002` would also "resolve". No red gate and no data effect; adr-cache is unaffected (frontmatter id wins). Fix: backlog item to teach the resolver the `THOTH-ADR-NNNN` scheme and read `docs/adr/`. Not for this PR.
- Failing test (named): `QA-14-resolves-THOTH-ADR-ids-against-docs-adr`.

### F6 [ISSUE][LOW][code-traced] Decisions rows this story supersedes are not marked

- `docs/decisions.md` line 11 convention: supersede in place, strike through and append `SUPERSEDED <date> by <what>`. The 2026-09-19 row (b) says it "supersedes the mechanism in the 2026-09-07 rows" and moots #100/#101, but rows 31, 32 (2026-09-07) and 94 (2026-09-18: "Nothing about the mechanism ... is changed", "Expiry untouched") carry no marker. Row 94 stays active to 2026-10-07 and tells a hydrating session the mechanism is unchanged.
```
$ sed -n '31p;32p;94p' docs/decisions.md | grep -c SUPERSEDED
0
```
- Minimal fix: append `PARTIALLY SUPERSEDED 2026-09-19 by the 2026-09-19 row, (b)` to those three rows (partial: rows 31/32 still carry the Issue #99 fix, which stays). Failing test (named): `decisions-rows-31-32-94-marked-superseded`.

### F7 [ISSUE][LOW][code-traced] In-code wording contradicts ADR rule 3

- `src/policy/tools/central-classification.ts:22-23` (added by this diff): the comment says the third party's identity claim "IS the control here, accepted knowingly by the human". Three lines earlier (line 20) the same comment says "It is NOT a real security control", and ADR rule 3 says `knownConnectors` MUST NOT be described as a security control.
- Minimal fix: reword to "is all that gates this exemption". Failing test (named): `central-classification-comment-never-calls-it-a-control`: `grep -n "IS the control" src/policy/tools/central-classification.ts` currently returns line 23.

### Clean seams (checked, sound)

- C1 [demonstrated] `adr.dir` consumers: section 3(d). Only `adr-cache.mjs` reads it; catalog first 35 entries unchanged; no collision or ordering problem.
- C2 [demonstrated] State integrity: the `docs/.maat-state.json` re-serialization (155-line diff) is a one-level re-nest. Node checks: `base top == head.priorScope: true`, `deeper chain equal: true`; chain depth 11 (was 10); scope `fixture-single-source-of-truth`, CRITICAL, `humanRulingRequired:false`. `docs/run-log.jsonl`: 49 lines, 0 unparseable, exactly one `tier-ratified` event for this scope (CRITICAL), matching the state note.
- C3 [demonstrated] INT-07 quote verbatim; REL-12 scoping paraphrase accurate (section 3(a)).
- C4 [demonstrated] `builtin-tool-inventory.ts` and `mcp-enumeration.ts` stay comment-only: 0 changed lines outside `//`, `*`, `/*` in either file.
- C5 [demonstrated] Test claims reproduce: full `node --test` at head `tests 869, pass 869, fail 0, skipped 0`; the three touched test files 28/28; `typecheck` and `lint` clean; QA-15 PASS. Name-diff base vs head: 16 removed, 6 added (my scratch copy of `953b078` showed 2 environment-only failures, QA-14 dogfood and R187, from a copy without history; not counted). No remaining consumers of `central-fixture-expired`, `isFixtureExpired`, `expiresOn`, `ratifiedBy` in `*.ts *.mjs *.json *.yml` outside comments and tests that state the removal.

## 6. Coverage gaps

| Part of diff | Claimed by a lane? | Note |
|---|---|---|
| `docs/decisions.md` / CHANGELOG / backlog prose consistency | none | Covered here (F6, editorial). |
| `docs/adr/*` ADR text and `maat.json` | none | Covered here (section 3). |
| `docs/.maat-state.json`, `run-log.jsonl` | none | Covered here (C2); low risk. |
| SE-0010 test-deletion governance | none (code lane not seated) | F2. |
| QA-14 gate health | none | Pre-existing red; see editorial 1. Not a finding against this diff. |

## 7. Editorial (verdict-neutral, plain edits)

1. CHANGELOG and decisions row (g): "2 unresolved plus 22 unclassified before and after" does not reproduce. QA-14 is diff-scoped (default `HEAD~1..HEAD`), so the two runs compared different diffs. Head, default range: `14 of 767 citation(s) failed to resolve; 91 more unclassified`. Branch range `953b078..3dc2a99`: `19 of 906 ... 115 more unclassified`. None of the unresolved strings appear in lines this diff adds (the one `STATE.md` hit is moved `.maat-state.json` note text). "Red on master from pre-existing debt" holds; the figure does not.
2. `docs/STATE.md` (Manager updates at close) is already stale before this story: "Last updated 2026-09-18 ... branch `fix/215-ratify-claude-docs`" though #218 merged (`953b078`). It also says the fixture `expiresOn` 2026-10-07 is a live deadline and "#90 still pending the human" (line 13); both become false on merge, and #217 is described as an open follow-up.
3. THOTH-ADR-0001 line 76 cites SE ADR-0005 and ADR-0010 as "read as not violated"; see F2 for ADR-0010.
4. `docs/backlog.md:47` still says "disposable-by-design"; the new note below it says standing. Consistent in effect.
5. `adr/software-engineering/README.md` index lists ADR-0021 as "Proposed (rev. 2)" while the file is `accepted`; submodule, outside this diff.

## 8. Verdict

**APPROVE-WITH-CONDITIONS.** No code defect found at the seams: the hook, parser, tests and state files are consistent, and the human-accepted consequence (silent suppression, no failing test) is not re-reported. The conditions are ADR-record closures, not code:

1. The human accepts THOTH-ADR-0001 in this PR, before merge (F1), after the ADR gains the SE-0010 clause and `code` in `applicableTo` (F2).
2. Name an owner for the removal trigger and keep or link #90 (F3).

F5, F6, F7 go to backlog or plain edits; F4 is a residual-register line.

**Single next action:** the human edits THOTH-ADR-0001 (F2 clause, F3 trigger Issue), sets `status: accepted`, and commits it on this branch before merge.

## 9. Raw check output

```
$ node docs/adr-cache.mjs --ensure  -> ADR cache HIT (36 ADRs, docs/adr:1) [CACHE=HIT]
$ npm test (head 3dc2a99)           -> tests 869 / pass 869 / fail 0 / skipped 0
$ node --test <3 touched test files> -> tests 28 / pass 28 / fail 0 / skipped 0
$ npm run typecheck ; npm run lint  -> clean
$ npm run qa:completeness-claims    -> PASS: 2 file(s) checked
$ node src/qa/reference-resolver.ts (default HEAD~1..HEAD) -> FAIL: 14 of 767 unresolved; 91 more unclassified (pre-existing debt; none from added lines)
$ base scratch copy (953b078) node --test -> tests 879 (2 environment-only fails from the history-less copy)
```

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][demonstrated] docs/adr/thoth-0001...:5,21 -- ADR still `proposed`, acceptance may follow merge, timer removed so nothing resurfaces it; grep for `status: accepted` exit 1 -- human flips to accepted in this PR pre-merge
2. [ISSUE][MED][code-traced] SE ADR-0010:47,42 -- 16 deleted tests (incl. exact-pin tripwires) have no exception at ADR level (only decisions row + non-binding Consequences prose) -- add SE-0010 clause + `code` applicableTo to THOTH-ADR-0001, then accept
3. [ISSUE][MED][code-traced] docs/adr/thoth-0001...:16,66 + builtin-tool-inventory.ts:16-18 -- removal trigger "S6" has no owning deliverable (milestone #24 scope excludes it); closing #90 removes last tracker -- file T5 Issue, cite in ADR, keep/link #90
4. [SUSPICION][MED][derived] ADR rule 2 vs CLAUDE.md sensitive-area review-report rule -- state whether a fixture-entry PR needs a report
5. [ISSUE][LOW][demonstrated] src/qa/reference-resolver.ts:97 -- THOTH-ADR-0001 parsed as SE ADR-0001 and "resolves" -- backlog: teach resolver the scheme
6. [ISSUE][LOW][code-traced] docs/decisions.md:31,32,94 -- superseded mechanism rows not marked per "supersede in place" -- append PARTIALLY SUPERSEDED marker
7. [ISSUE][LOW][code-traced] src/policy/tools/central-classification.ts:23 -- comment calls the name match "the control", contradicting ADR rule 3 and line 20 -- reword
8. [CLEAN][demonstrated] adr.dir consumers: only adr-cache.mjs reads it; first 35 catalog entries unchanged; no id collision for THOTH-ADR-0001
9. [CLEAN][demonstrated] .maat-state.json priorScope chain intact (depth 11, base==head.priorScope), run-log 49 lines parse, one tier-ratified event
10. [CLEAN][demonstrated] INT-07 quote verbatim vs ADR-0021:24; REL-12 scoping paraphrase accurate
11. [CLEAN][demonstrated] builtin-tool-inventory.ts and mcp-enumeration.ts diffs are comment-only (0 non-comment changed lines)
12. [CLEAN][demonstrated] npm test 869/869/0/0 reproduced; name-diff 16 removed/6 added matches claim; no stray consumers of removed reason key/fields
counts: issues=6 suspicions=1 clean=5
evidence: demonstrated=7 code-traced=4 derived=1
checks=npm test 869 pass/0 fail/0 skipped; touched tests 28/0/0; typecheck+lint clean; qa:completeness-claims PASS; qa:reference-resolver FAIL (pre-existing, 14 unresolved/91 unclassified at HEAD~1..HEAD, none from added lines)
adr=HIT(36, whole catalog)
report=docs/reviews/fixture-single-source-of-truth-cross-domain-2026-09-19.md
