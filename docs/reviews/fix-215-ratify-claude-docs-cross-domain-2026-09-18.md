# Cross-domain review - fix-215-ratify-claude-docs (Ra)

[cross-domain-reviewer]
Cross-Domain Reviewer (Ra) - scanning the seams between reviewer lanes

HEAD: e4e072d (base d962ae7), branch fix/215-ratify-claude-docs, tier STANDARD (ratified, run-log 2026-09-18T23:32:47Z)
ADR cache: `📊 ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog - ≈17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]`

## Lanes that ran
- `app-security-reviewer` (Horus) ran alongside: `docs/reviews/fix-215-ratify-claude-docs-app-security-2026-09-18.md`, verdict APPROVE, 3 LOW findings. Its ground: runtime widening, pin-vs-fixture equality (red at base, green at HEAD), row wording vs. the human ruling, secret-shaped literals, `priorScope` chain integrity.
- Not re-listed here because Horus already named them: the dangling "follow-up Issue" claim (Horus F1), fixture `ratifiedBy` provenance (Horus F2), and the "no distinct risk" wording (Horus F3). I concur with all three; nothing to add.
- Diff: 5 files - `CHANGELOG.md`, `docs/.maat-state.json`, `docs/decisions.md` (+1 row), `docs/run-log.jsonl` (+1 line), `src/policy/tools/central-classification.test.ts` (+1 pin entry). Fixture, `hooks/*`, `.claude/settings.json` untouched.

## Checks run (raw)
```
$ node --test src/policy/tools/central-classification.test.ts
ℹ tests 13  ℹ pass 13  ℹ fail 0  ℹ cancelled 0  ℹ skipped 0
$ npm test            (full suite, HEAD e4e072d)
ℹ tests 879  ℹ pass 879  ℹ fail 0  ℹ cancelled 0  ℹ skipped 0
$ node docs/receipt-check.mjs --scope fix-215-ratify-claude-docs
receipt-check: no reports matched scope=fix-215-ratify-claude-docs.   (run before any report for this scope existed)
$ node -e (compare base d962ae7 vs HEAD .maat-state.json)
adrCatalog equal: true
prior === old top-level (sans adrCatalog): true
$ gh issue list --state all --limit 5 --search "sort:created-desc"   -> newest is #215
```
"878 pass, 1 fail" in the row/CHANGELOG is consistent with 879 total now green (Horus reproduced the red at base).

## Cross-domain ADR verdict (whole catalog, unfiltered: 35 entries; 26 Accepted, 3 accepted-lowercase, 2 superseded, 2 template, 2 unknown-status)
| ADR | Verdict |
|---|---|
| SE ADR-0005 "MUST NOT delete or weaken a failing test to make CI pass; fix the code or escalate" | Clean. A pin was edited to turn a red test green, but exactness is unchanged (8 vs 8, fixture order) and the escalate path was taken (Issue #215 -> human ratification). |
| SE ADR-0010 / DevOps ADR-0008 "ratchet only; no broadened ignore/suppression lists" | N/A. `knownConnectors` is a runtime halt-exemption allowlist, not a lint/gate suppression list. |
| SE ADR-0021 INT-07 (no control resting on an unverified third-party claim) | Pre-existing, disclosed, human-ratified interim exception (2026-09-07 row, Issue #90 open, expiry 2026-10-07). This diff adds one data entry inside that mechanism, no new class. Not re-listed (named by S5 round-1 lane reviewers). Standing caveat, owned by #90: the disposition was a decisions row, not an `/adr-amend`. |
| SE ADR-0001 / PRINCIPLES rule 9 "decisions.md is not an ADR store" | Clean as written (direction only, nothing decided or changed). See Finding 1 for what changes when the ruling is implemented. |
| All other ADRs (CDK/IaC, data, tagging, cost, IAM, DR, ADR-0016/19/20 plugin-port) | No changed file in their lanes. |

## Findings
1. **[SUSPICION][MED][derived] The recorded design premise contradicts a ratified council finding and the very commit at issue.** The new row (`docs/decisions.md:94`, part c) records the ruling that "an entry present in the fixture JSON is itself the approval" and that "these files are not user-editable at runtime". `docs/backlog.md:47` (architecture-reviewer, S5 fix-now council, 2026-09-07) records the opposite for this in-repo fixture: a session with commit access always holds a credential reaching it, so it cannot satisfy REQUIREMENTS section 0.4 property 2 and is disposable-by-design. Commit `83b6af9` (a Claude-session edit of this exact file) is the counter-example. Horus checked the row against the test file's own message and found the ruling not overclaimed; this seam is against the architecture lane, which Horus did not read. Recording it as direction only is fine and I am not asking to remove it. The risk is later citation of "fixture entry = approval" as precedent, which would turn the 2026-09-07 justification ("stands only on this dated human ratification") into a tautology. When the follow-up is built it needs an ADR-0021 amendment or new ADR (INT-07 / policy delivery), not only a decisions row (rule 9). Capped MED: derived, no code shows the premise failing. Settles as a residual-register line: put "reconcile with docs/backlog.md:47 and section 0.4 property 2; needs an ADR" in the follow-up Issue body. No executable form (a design premise); the settling artifact is that Issue text.

## Seams checked, sound
2. **[CLEAN][code-traced] New row vs active rows.** It does not supersede or contradict the 2026-09-07 rows on `KNOWN_CONNECTORS`/#90/#93/#96: it adds an entry, leaves `expiresOn` 2026-10-07 and the `S5-R2-N2` pin untouched, states #90 is pending the human, and sets its own review-back to the expiry date. The runtime unlock hint (`hooks/userpromptsubmit-halt-relay.mjs:105`) and AC1-b's failure message still say a fresh human-ratified row is required; this row is one, so both remain accurate. The fixture's stale `ratifiedBy` pointer is Horus F2.
3. **[CLEAN][demonstrated] State/run-log/CHANGELOG cross-consistency.** The `tier-ratified` line is in `docs/run-log.jsonl` (timestamp 23:32:47Z, scope `fix-215-ratify-claude-docs`), matching the state note's timestamp and the CHANGELOG's cited event, and it sits after the prior story-shipped line. This is the class Issue #212 caught last story (a cited event that did not exist); not repeated. `priorScope` chain integrity is Horus's item 5 and my script agrees.
4. **[CLEAN][code-traced] No change outside stated scope.** All 5 changed files are named in the CHANGELOG. No gold-plating.
5. **[CLEAN][demonstrated] Test pin.** AC1-b passes with 8 entries in fixture order; 13/13 in file, 879/879 full suite.

## Coverage gaps
- None material. An earlier concern that no security lane covered the fixture entry is overtaken: `app-security-reviewer` ran. Uncovered and intentionally low-risk: the `run-log.jsonl` line and CHANGELOG prose.

## Editorial (verdict-neutral)
- `docs/STATE.md:8-10` still lists #215 as an open human question and proposes `s5-connector-exemption-decision` as "closes #90 + #215". Reconcile at close-out.
- The row's "Human ratified" cell is non-canonical ("Y (Claude Docs item); Y as direction only"); `docs/decisions-archive.mjs` matches `^(Y|N)\b`, so it still archives normally.

## Verdict: APPROVE-WITH-CONDITIONS
One condition, fix-now, no code: carry Finding 1's residual line into the follow-up Issue Horus F1 already requires the Manager to file. No bug Issue filed by this report (no [ISSUE] at HIGH/MED). Open findings 1 (derived, MED) vs failing tests 0: a design-premise note with no executable form, settled by the Issue text.

**Single next action:** Manager files the pin-mechanism follow-up Issue (Horus F1) with the Finding 1 line in its body, then proceeds to merge-handoff (human-only merge).

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [SUSPICION][MED][derived] docs/decisions.md:94 - recorded premise "fixture entry = approval / not user-editable" contradicts docs/backlog.md:47 (architecture council) and commit 83b6af9; implementing it needs an ADR (rule 9); carry as a residual line in the follow-up Issue
2. [CLEAN][code-traced] new decisions row does not supersede the 2026-09-07 KNOWN_CONNECTORS/#90/#93/#96 rows; expiresOn and #90 not pre-empted
3. [CLEAN][demonstrated] run-log tier-ratified event, state note and CHANGELOG agree (timestamp/scope); #212 class not repeated
4. [CLEAN][code-traced] no change outside the 5 stated files
5. [CLEAN][demonstrated] AC1-b pin equals fixture; 13/13 file, 879/879 full suite
counts: issues=0 suspicions=1 clean=4
evidence: demonstrated=2 code-traced=2 derived=1
checks=node --test central-classification.test.ts 13 pass/0 fail/0 skip; npm test 879 pass/0 fail/0 skip; receipt-check n/a (no report existed pre-write); state-equality script pass
adr=HIT(35, whole catalog)
report=docs/reviews/fix-215-ratify-claude-docs-cross-domain-2026-09-18.md
