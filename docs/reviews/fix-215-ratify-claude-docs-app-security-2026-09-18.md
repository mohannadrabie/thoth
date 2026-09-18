[app-security-reviewer]
🛡️ App Security Reviewer (Horus) — reviewing for exploitable weakness

# App-security review — `fix-215-ratify-claude-docs` (Issue #215), STANDARD tier

- Target: commit `e4e072d` against base `d962ae7` (`git diff d962ae7 e4e072d`), branch `fix/215-ratify-claude-docs`.
- HEAD: e4e072d
- ADR cache: `📊 ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — ≈17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]`. No ADR security standard is touched by a test pin plus a docs row; none violated.
- Tier is ratified STANDARD (`docs/run-log.jsonl` tier-ratified event); not re-litigated.

## Verdict: APPROVE

No blocker, nothing exploitable. The diff ratifies one entry that is already live in the fixture and widens nothing. Three LOW items are wording/provenance, none gating.

## What the diff is (5 files)

| File | Change |
|---|---|
| `src/policy/tools/central-classification.test.ts` | +1 line: `"claude.ai Claude Docs"` appended to `AC1-b`'s pin |
| `docs/decisions.md` | +1 row (2026-09-18) |
| `docs/.maat-state.json` | scope transition, prior scope pushed into `priorScope` |
| `CHANGELOG.md` | +11 lines |
| `docs/run-log.jsonl` | +1 tier-ratified line |

Untouched (checked with `git diff --name-only`): `docs/qa/s5-central-classification.json`, `hooks/*`, `.claude/settings.json`, `src/policy/tools/central-classification.ts`.

## Focus answers

### 1. Does it widen what a session can do or weaken a gate? No. [demonstrated]

- The runtime consumer (`hooks/sessionstart-tool-enum.mjs:389`, `new Set(fixture.knownConnectors)`) reads the fixture, not the test. The fixture already carried the 8th entry from direct commit `83b6af9` (`git diff 83b6af9~1 83b6af9` shows the +1 line). The exemption has been live since that commit; this diff adds no runtime effect.
- The test pin is the only code change. Exact `deepStrictEqual` on the ordered array is retained, the failure message is unchanged, and `AC1-a`, `AC1-c`, `S5-R2-N2` are untouched (the `expiresOn` pin is intact; `expiresOn` 2026-10-07 is still in the future).
- Red/green proof, run in a throwaway worktree at base `d962ae7` (removed afterwards):

```
$ node --test src/policy/tools/central-classification.test.ts   # at d962ae7
✖ AC1-b: the committed knownConnectors fixture is pinned exactly ...
ℹ tests 13  ℹ pass 12  ℹ fail 1  ℹ skipped 0
$ node --test src/policy/tools/central-classification.test.ts   # at e4e072d
ℹ tests 13  ℹ suites 0  ℹ pass 13  ℹ fail 0  ℹ cancelled 0  ℹ skipped 0
$ npm test                                                       # at e4e072d
ℹ tests 879  ℹ pass 879  ℹ fail 0  ℹ cancelled 0  ℹ skipped 0
```

Exposure: not applicable; nothing blocking. The pre-existing spoofability of display-name matching is Issue #90 (OPEN), the same for all 8 entries; not re-raised.

### 2. Is the ratified entry accurately described? Yes on the facts; one wording overreach (Finding 3).

- Fixture (`docs/qa/s5-central-classification.json`): 8 `knownConnectors`, 8th = `claude.ai Claude Docs`.
- Pin (`central-classification.test.ts:52-55`): same 8, same order. `AC1-b` green proves string-and-order equality.
- Decisions row: says 8th entry, retroactive for `83b6af9`, `expiresOn` untouched, Issue #90 still pending the human. All match. "Other 7 entries" is correct (8 minus 1).
- The ratification's authority is the human's in-session statement. Repo evidence alone (`git log -1 83b6af9` author is `Mo (via Claude session)`) cannot distinguish a human-typed from a session-typed edit. The human confirmed it directly to the Manager, so this is accepted; noted only so the row is not read as self-proving.

### 3. Does the row overclaim the human's ruling? No, with one dangling reference (Finding 1).

- Part (c) is worded "direction only", says "NOT a good mechanism", and states "Nothing about the mechanism, the pins, or the fixture's `ratifiedBy`/`expiresOn` is changed by this story". The CHANGELOG repeats "Nothing about the mechanism changes here". Neither makes the ruling read as implemented.
- The ruling's factual premise, that the exact pin needs a separate ratification row (`AC1-a`/`AC1-b`/`S5-R2-N2`), matches the test file's own failure message.

### 4. Secret-shaped literals / hand-derived completeness claims? None. [demonstrated]

```
$ git diff d962ae7 e4e072d | grep '^+' | grep -nEi '<AWS/GitHub/OpenAI key shapes|PEM header|40+ char base64|password|secret|token|api-key>'
(no output)
$ node src/secret-scan/history-scan.ts        -> exit 0 (only pre-existing ALLOWLISTED test fixtures listed)
$ node src/qa/completeness-claim-checker.ts
[QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified.
```

The added prose has no exhaustive-enumeration claim: "the other 7 entries" is a count over an 8-item list that the passing exact pin verifies; "every other test unchanged" is confirmed by the 1-line test diff.

### 5. `.maat-state.json` priorScope chain intact? Yes. [demonstrated]

Parsed with node at base, at `e4e072d`, and in the working tree. All three parse OK. The chain at HEAD:

```
fix-215-ratify-claude-docs/STANDARD <- kernel-purity-ast-hardening/STANDARD <- friendly-halt-messages/CRITICAL <- path-b-precommit-secret-scan/CRITICAL <- s1-closeout-164-154/CRITICAL <- qa14-issue137-precision-fastfollow/CRITICAL <- qa14-marker-redesign/CRITICAL <- qa1415fix/CRITICAL <- cifix/CRITICAL <- s6/CRITICAL
```

- `deepStrictEqual(head.priorScope.priorScope, base.priorScope)` holds: everything below the new prior entry is identical to the old chain.
- `head.priorScope` carries every per-scope key of the old top level (`scope, tier, reviewRoundsSinceClean, reviewRoundsTotal, humanRulingRequired, councilHeld, councilVerdict, roundsSinceLastGo, note_2026-09-17`); `adrCatalog` correctly stays at top level.
- The one extra closing brace in the diff is the wrapper for the new nesting level, not a stray.
- New top-level counters reset (`reviewRoundsTotal` 0, `humanRulingRequired` false) as for any new scope; prior values are preserved in `priorScope`, so no council/human-ruling state is silently dropped.

## Findings

### Findings 1-3 (all LOW; none gate)

1. **[ISSUE][LOW][demonstrated] Dangling "follow-up Issue" claim.** `docs/decisions.md` (new row, part c) says "a follow-up Issue filed by the Manager this session tracks replacing it"; `CHANGELOG.md` says "a follow-up Issue tracks replacing it". `gh issue list --state all --limit 15` shows the newest Issue is #215 itself; no Issue for the pin mechanism exists. `decisions.md` is append-only, so a false present-tense line stays. Fix: file the Issue now (then the sentence is true). Attack sketch: none, an audit-trail accuracy gap only. Exposure: n/a (not blocking). No bug Issue filed (LOW).
2. **[ISSUE][LOW][code-traced] Provenance split: fixture `ratifiedBy` not updated.** `docs/qa/s5-central-classification.json:3` still cites only the 2026-09-07 row, and its `notes[2]` says the human "reviewed and accepted this exact risk (see 'ratifiedBy')". The 8th entry is ratified only by the new 2026-09-18 row, which the fixture does not reference; `AC1` checks `ratifiedBy` non-empty only. Deliberate (fixture untouched by scope) and consistent with the human's direction that the mechanism gets replaced; the fix belongs to that follow-up, not this diff (PRINCIPLES rule 12).
3. **[SUSPICION][LOW][derived] "(b) Claude Docs adds no distinct risk" is broader than what was assessed.** The row supports "same name-spoofability as the other 7" (Issue #90), which is true. "No distinct risk" also asserts something about the connector's capability, and no capability assessment is in the repo. (This session's own connector listing shows it as a create/edit-documents connector, a write-capable surface like Gmail/Drive/Canva, so it is likely fine.) SUR-03's exemption is a name match and `class` is inert (Issue #93), so the practical effect is only "no halt for this name". Fix, if desired: reword to "same name-spoofability; capability not separately assessed". Reasoned from documents only, so capped at LOW, no gate.

### Verified sound

4. **[CLEAN][demonstrated]** No runtime widening: 5 files changed, none runtime; fixture, hooks, settings untouched; the live entry predates the diff (`83b6af9`).
5. **[CLEAN][demonstrated]** Pin equals fixture exactly, in order; `AC1-b` red at base (12/1/0), green at HEAD (13/13/0); full suite 879/0/0.
6. **[CLEAN][demonstrated]** `.maat-state.json` parses at base/HEAD/worktree; 10-deep `priorScope` chain intact and deep-equal to the old chain.
7. **[CLEAN][demonstrated]** Decisions row frames the mechanism ruling as direction only; `expiresOn` untouched; no secret-shaped literal; QA-15 PASS; history-scan exit 0.

## Blockers vs hardening

- Blockers: none.
- Hardening (all LOW, optional): file the follow-up Issue (Finding 1); fixture provenance and the "no distinct risk" wording ride with that follow-up (Findings 2, 3).

## Open findings vs failing tests

Open findings = 3 (all LOW), failing tests = 0. Gap explained: all three are audit-trail/wording items with no executable form. Finding 1 is settled by `gh issue list` showing the follow-up Issue; Finding 2 is subsumed by the pin-mechanism replacement the human already directed; Finding 3 is a wording call. A test pinning prose would be theater (PRINCIPLES rule 12).

## Editorial

None.

## Single next action

File the pin-mechanism follow-up Issue the decisions row already says exists, then hand `e4e072d` to the Manager for merge-handoff (human-only merge).

RECEIPT: verdict=APPROVE
findings (ALL of them, ranked by exploitability x impact):
1. [ISSUE][LOW][demonstrated] docs/decisions.md (new 2026-09-18 row, part c) + CHANGELOG.md claim a follow-up Issue was filed for the pin mechanism; `gh issue list` shows none (newest is #215) -- file it.
2. [ISSUE][LOW][code-traced] docs/qa/s5-central-classification.json:3 `ratifiedBy` still cites only the 2026-09-07 row; the 8th entry's ratification (new row) is not referenced from the fixture -- rides with the mechanism follow-up.
3. [SUSPICION][LOW][derived] decisions row (b) "no distinct risk" exceeds the spoofability-only support; reword to "capability not separately assessed" if desired.
4. [CLEAN][demonstrated] No runtime widening: 5 files, no hook/fixture/settings edit; entry live since 83b6af9; AC1-b red at base (12/1/0), green at HEAD (13/13/0).
5. [CLEAN][demonstrated] Pin == fixture, exact and ordered; full suite 879/0/0.
6. [CLEAN][demonstrated] .maat-state.json parses; 10-deep priorScope chain intact and deep-equal to the old chain.
7. [CLEAN][demonstrated] Ruling framed as direction only, expiresOn untouched, no secret-shaped literal, QA-15 PASS, history-scan exit 0.
counts: issues=2 suspicions=1 clean=4
evidence: demonstrated=5 code-traced=1 derived=1
checks="879/0/0"
adr=HIT(35)
report=docs/reviews/fix-215-ratify-claude-docs-app-security-2026-09-18.md
