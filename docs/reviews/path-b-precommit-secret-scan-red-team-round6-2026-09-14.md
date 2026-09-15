# Red Team (Sutekh) — `path-b-precommit-secret-scan`, round 6 (final targeted re-confirm)

- **Date:** 2026-09-14
- **Tier:** CRITICAL
- **Branch / HEAD:** `feat/path-b-precommit-secret-scan` @ `eb7dd08` (working tree clean)
- **Scope of this round:** commit `eb7dd08` only — `src/secret-scan/history-scan.test.ts` (~85 lines) plus docs. Closes round-5's own Issues **#201** (baseline entries carried no reason) and **#202** (derived checked-set membership unpinned).
- **Predecessor:** `docs/reviews/path-b-precommit-secret-scan-red-team-round5-2026-09-14.md`
- **Verdict: `go`.** Both fixes are real and mutation-proven. One LOW residual, disclosed below, no gate.

```
📊 ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — ≈17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]
```

ADR slice read for this attack surface (security / CI gates / suppression lists / testing): DevOps **ADR-0008** (CI/CD gates and policy-as-code — inline justification required per suppression), DevOps **ADR-0009** (secrets never in source), SE **ADR-0005** (testing strategy), SE **ADR-0010** (no suppression/skip to get green).

---

## 0. Sanity gates (real repo, HEAD `eb7dd08`)

```
$ npm run typecheck
> tsc --noEmit -p tsconfig.json
(clean, exit 0)

$ npm run lint
> eslint .
(clean, exit 0)

$ npm test
tests 834
suites 0
pass 834
fail 0
cancelled 0
skipped 0
todo 0

$ node src/secret-scan/history-scan.ts
[OSS-01 history-scan] PASS: Full history scanned, 0 blocking secret-shaped matches found (1199 allowlisted).
EXIT=0

$ node src/qa/completeness-claim-checker.ts
[QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified.  exit=0

$ node src/qa/recurring-findings-registry.ts
[QA-13 recurring-findings-registry] PASS: 3 recurring finding class(es) logged, all structurally valid.  exit=0

$ git status --porcelain
(empty — MAIN REPO CLEAN)

$ git diff origin/master -- .github/workflows/ci.yml
(empty)
```

834/834 pass, **0 skipped**. `.github/workflows/ci.yml` unchanged vs `origin/master`.

---

## 1. Tautology check — is the new key-set assertion load-bearing?

**No, it is not tautological.** The two sides of `assert.deepEqual` come from genuinely independent sources:

- **Left side** (`derivedKeys`): `deriveMutableCredentialGrants(JSON.parse(await readFile(ALLOWLIST_PATH)))` — an instrument read of the real `docs/qa/secret-scan-allowlist.json`, filtered through `CREDENTIAL_SHAPED_PATTERN_IDS` and `IMMUTABLE_REPORT_PREFIX` (`history-scan.test.ts:252-272`).
- **Right side** (`Object.keys(REVIEWED_BASELINE)`): eight hand-typed string literals in the test source (`history-scan.test.ts:302-386`).

REVIEWED_BASELINE's keys are *not* derived from `deriveMutableCredentialGrants`, nor from the allowlist file, nor from each other. Changing either the derivation or the pinned literal set breaks equality. This is the `DEFAULT_FILES` / Issue #142 precedent applied correctly.

---

## 2. Mutation M3 re-run live — does the fix close #202?

Throwaway clone of `eb7dd08` (no `node_modules` needed; `npm test` is `node --test`). Baseline first:

```
$ node --test src/secret-scan/history-scan.test.ts
tests 21  pass 21  fail 0  skipped 0
```

Then round-5's own mutation M3 — `history-scan.test.ts:252`, "docs/reviews/" -> "docs/":

```
$ sed -i .../IMMUTABLE_REPORT_PREFIX/... src/secret-scan/history-scan.test.ts
252:const IMMUTABLE_REPORT_PREFIX = "docs/";

$ node --test src/secret-scan/history-scan.test.ts
tests 21  pass 20  fail 1  skipped 0
failing tests:
X OSS-01 baseline integrity (GitHub Issues #201 + #202, red-team round-5 [MED]x2, demonstrated): REVIEWED_BASELINE's key set equals deriveMutableCredentialGrants(the real allowlist) exactly ...
```

**#202 is closed.** The mutation that round-5 proved silent now turns exactly one test red, and the failure message names Issue #202.

---

## 3. Reason-blanking mutation — does the fix close #201?

Reverted, then emptied one entry's `reason` (`src/secret-scan/patterns.test.ts::aws-access-key-id`):

```
blanked patterns.test.ts::aws-access-key-id reason
332:    reason: "",

$ node --test src/secret-scan/history-scan.test.ts
tests 21  pass 20  fail 1  skipped 0
X OSS-01 baseline integrity (GitHub Issues #201 + #202 ...)
```

**#201 is closed.** Whitespace-only reasons are covered by the same predicate (`typeof v.reason !== "string" || v.reason.trim().length === 0`, `history-scan.test.ts:414-416`) — code-traced, same strictness as `isValidAllowlistEntry` at `history-scan.ts:150-159`.

---

## 4. New self-referential hole? — do the added reason strings quote credential-shaped text? (Issue #199's class)

Two independent checks, both clean.

**(a) Pattern scan of the REVIEWED_BASELINE block, comment lines vs. reason strings separated**, against every pattern in `SECRET_PATTERNS`:

```
COMMENT HIT [aws-access-key-id] x1 -> AKIA...[REDACTED]
NON-COMMENT (reason strings + structure): CLEAN (0 matches)
--- the one comment line, redacted:  // AKIA...[REDACTED] -- this file's own F2 mutation-proof fixture literal (below), reviewed

$ git log -1 --format=%h -S "<the literal>" -- src/secret-scan/history-scan.test.ts
1378b8b
```

The single credential-shaped literal inside the block is the **pre-existing** F2 fixture comment introduced by `1378b8b` (round-4's fix), and it is hash-pinned in the baseline. **Zero** pattern matches across all detectors in any reason string `eb7dd08` added.

**(b) Real instrument:** `node src/secret-scan/history-scan.ts` -> exit 0, PASS, 0 blocking (section 0). Both layers agree.

---

## 5. Round-4 attacks A/B/C and round-5's Attack D against this HEAD

All planted live in the throwaway clone with a synthetic, never-real AWS-key-shaped literal built by string concatenation.

| Attack | Shape | Result at `eb7dd08` | Expected |
|---|---|---|---|
| **A** | new `CHANGELOG.md` allowlist grant + live literal in `CHANGELOG.md` | **caught** — pass 19 / fail 2 (occurrence test **and** the new key-set test) | caught, and stronger than round-5: 2 tests now, was 1 |
| **B** | new `docs/decisions.md` row carrying a live literal, zero allowlist change | **caught** — pass 20 / fail 1 | caught |
| **C** | trailing comment literal in already-granted `src/secret-scan/patterns.test.ts`, zero setup | **caught** — pass 20 / fail 1 | caught |
| **D** | new grant + live literal + self-computed sha256 baseline entry (now also a non-empty `reason`), one commit | **survives** — pass 21 / fail 0 | unchanged (disclosed residual, round-5 F1) |

Attack D's status is unchanged by this round's fix, exactly as scoped. What did change: the attacker must now also **type a justification string** into the baseline entry, so the deliberate path leaves a written rationale in the diff instead of a bare hex line. That is precisely what #201 claimed to buy, and no more.

*Harness note, for the record:* a first Attack-D attempt using a 21-character literal was **caught**, because the regex matches only the first 20 characters and the attacker's self-computed hash then does not match the matched substring. Re-run with an exactly-20-character literal (verified against `SECRET_PATTERNS` before planting) to reproduce D faithfully. A careless self-hash gets caught; a careful one does not.

---

## Findings, ranked by blast radius

### F1 — [ISSUE][LOW][demonstrated] A *coordinated* widen-and-prune edit still shrinks the checked set with the suite green — the guard cannot self-detect its own pin being edited to match

`Exposure: 2 of 8 derived credential grants (25% of the checked set), basis: measured`

**Scenario.** An engineer decides all of `docs/` is immutable-by-report-logic, widens `IMMUTABLE_REPORT_PREFIX` to "docs/", sees the new baseline-integrity test go red with "REVIEWED_BASELINE's key set has drifted", and fixes it the obvious wrong way — deleting the two now-orphaned entries. Run live:

```
widened prefix + removed 2 baseline keys
$ grep -c "docs/STATE.md::aws-access-key-id" src/secret-scan/history-scan.test.ts
0
$ node --test src/secret-scan/history-scan.test.ts
tests 21  pass 21  fail 0  skipped 0
```

`docs/STATE.md` and `docs/decisions.md` — the two files every prior recurrence in this story landed on — leave the checked set, whole suite green.

**Current defense, honestly assessed.** Real, and materially better than round-5. The *silent, one-line* drift that #202 was about is now impossible — it fails loud. What remains needs a deliberate multi-hunk edit that **deletes two named, reasoned suppression entries** from a file CLAUDE.md lists as a sensitive area (draws a named reviewer), in a diff a reviewer reads. This is the inherent limit of every pinned-set design: the pin has to be editable, and the guard cannot distinguish a legitimate pin update from an illegitimate one. Same family as Attack D's disclosed residual, and structurally identical to the allowlist it backstops.

**Verdict: BREAKS (LOW).** Not a gate. Third review pass on this mechanism; the accidental path is fully closed and the deliberate path is the standard, disclosed suppression-surface residual. Inflating it would be manufacturing.

**Proof-test if ever escalated:** `OSS-01 baseline coverage floor: deriveMutableCredentialGrants(the real allowlist) contains docs/STATE.md::aws-access-key-id and docs/decisions.md::aws-access-key-id` — a named, non-shrinkable floor asserted independently of `IMMUTABLE_REPORT_PREFIX`. Cheap. Recommended for the backlog, not for this diff.

### F2 — [CLEAN][demonstrated] The key-set equality assertion is load-bearing, not tautological
Section 1. Independent sources on each side; M3 turns it red (section 2).

### F3 — [CLEAN][demonstrated] #201 is genuinely closed — reason-blanking is caught
Section 3. Whitespace-only case covered by the same `.trim()` predicate as `isValidAllowlistEntry`.

### F4 — [CLEAN][demonstrated] #202 is genuinely closed — round-5's own M3 is caught
Section 2, with the failure message naming the Issue.

### F5 — [CLEAN][demonstrated] No new #199-class self-referential hole in the added reason text
Section 4. 0 pattern matches in any added reason string; the one in-block AKIA-shaped literal predates this commit and is hash-pinned. Real `history-scan.ts` agrees (exit 0, PASS, 0 blocking).

### F6 — [CLEAN][demonstrated] No regression on round-4 A/B/C; Attack A's detection strengthened
Section 5. A/B/C all red; A is now caught by two independent tests.

### F7 — [CLEAN][demonstrated] Round-5's Attack D behaves exactly as disclosed — unchanged, still green, now demanding a written justification
Section 5. No new surface, no silent regression.

---

## Findings to failing tests

| Finding | Executable form | Status |
|---|---|---|
| F1 | `OSS-01 baseline coverage floor: ...` (named above, not written) | LOW, backlog — deliberately not added to this diff |
| F2-F7 | already-passing tests in `history-scan.test.ts`, each mutation-verified this round | closed |

Open findings: 1. Failing tests: 0. The gap is explained: F1 is LOW, does not gate, and its executable form is named and routed to the backlog rather than added as gold-plating to a diff under final re-confirm (PRINCIPLES rule 12).

---

## Residual register (carried, not gated)

| Residual | Status |
|---|---|
| **F1** — coordinated widen+prune keeps the suite green (2/8 grants) | LOW, disclosed. Backlog: add a non-shrinkable coverage floor assertion. |
| **Attack D** — deliberate grant + literal + self-computed baseline hash in one commit | Unchanged from round-5. Mitigated by the new mandatory reason text. |
| **Issue #203** — the `docs/reviews/*` exclusion's PRINCIPLES-rule-11 justification is not mechanically enforced | Open, deliberately deferred, systemic. Not re-raised here. |
| **DevOps ADR-0008's "time-bound exception" half** | REVIEWED_BASELINE entries now carry the required inline justification. They carry no expiry — correctly, since the exempted bytes are permanent test fixtures. Recorded, not a finding. |

---

## Praise where it is due

The fix took the harder of the two available routes. Making `reason` a real field with a real backfilled sentence per entry — rather than a `reason?: string` nobody fills — means the next attacker has to write down *why*, in a diff, in a sensitive-area file. And pinning the key set against a hand-typed literal list, instead of re-deriving it, is the one shape that actually detects drift; re-deriving would have been the tautology this round was sent to look for, and it is not there.

---

## Scariest unproven assumption

That a human reviewer reads a two-line deletion from REVIEWED_BASELINE as a *coverage reduction* rather than as *removing stale entries*. Every remaining hole in this mechanism (F1, Attack D) routes through that one human judgement. Nothing mechanical sits behind it, and nothing in this story's scope can put something there.

## Go / no-go

**`go`.** Both round-5 Issues are closed with live mutation proof. No regression on any prior round's attack. One LOW residual, disclosed, no gate. Zero `[HIGH]`, zero `[MED]`. Three review passes on this mechanism; the accidental-path attack surface is closed and the deliberate path is a documented suppression-surface residual shared with the allowlist it backstops.

## Single next action

Hand `eb7dd08` to the human for merge. File F1's coverage-floor assertion to the backlog; do not add it to this diff.

---

## Editorial (verdict-neutral, plain edits, no re-review)

1. `eb7dd08`'s commit message records `1172 allowlisted` from `history-scan.ts`; the live run at that commit reports **1199**. The figure was measured pre-commit, before the round-5 report blob entered history. Harmless, but any future verification quoting "expect 1172" against a committed HEAD will mismatch.

---

```
RECEIPT: verdict=go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][LOW][demonstrated] Coordinated widen-and-prune: widening IMMUTABLE_REPORT_PREFIX to "docs/" AND deleting the two now-orphaned REVIEWED_BASELINE keys in one edit keeps the suite green (21/21, measured), dropping docs/STATE.md + docs/decisions.md from the checked set. Current defense honestly assessed: the SILENT one-line drift #202 was about is now impossible (fails loud); what remains needs a deliberate multi-hunk deletion of two named, reasoned suppression entries in a CLAUDE.md sensitive-area file that draws a named reviewer. Inherent limit of any editable pin; same family as Attack D. Exposure: 2 of 8 derived grants (25%), basis: measured. No gate.
2. [CLEAN][demonstrated] Key-set equality assertion is load-bearing, not tautological: left side is JSON.parse of the real allowlist through deriveMutableCredentialGrants (history-scan.test.ts:252-272), right side is 8 hand-typed literals (:302-386) -- independent sources, and M3 turns it red.
3. [CLEAN][demonstrated] #202 closed: round-5's own mutation M3 ("docs/reviews/" -> "docs/") now fails exactly the new baseline-integrity test (21 tests, pass 20, fail 1, skipped 0), message naming Issue #202. Was silent at round-5 HEAD.
4. [CLEAN][demonstrated] #201 closed: blanking one entry's reason turns the same test red (21 tests, pass 20, fail 1, skipped 0); whitespace-only covered by the same .trim() predicate loadAllowlist uses (history-scan.ts:150-159).
5. [CLEAN][demonstrated] No new #199-class self-referential hole: 0 secret-pattern matches across ALL detectors in every reason string eb7dd08 added; the one in-block AKIA-shaped literal is a pre-existing comment from 1378b8b, hash-pinned. Real history-scan.ts agrees (exit 0, PASS, 0 blocking).
6. [CLEAN][demonstrated] Round-4 attacks A/B/C all still caught at this HEAD (A: pass 19/fail 2 -- now two independent tests, was one; B: pass 20/fail 1; C: pass 20/fail 1). No regression.
7. [CLEAN][demonstrated] Round-5 Attack D unchanged as disclosed: grant + live literal + self-computed sha256 baseline entry in one commit still passes 21/21 -- but now also requires the attacker to write a real justification string into the suppression entry, which is exactly what #201 bought and no more.
counts (CHECKSUM): issues=1 suspicions=0 clean=6
evidence (CHECKSUM): demonstrated=7 code-traced=0 derived=0
checks=typecheck clean; lint clean; npm test 834 pass / 0 fail / 0 skipped; history-scan.ts exit 0 PASS 0 blocking (1199 allowlisted); completeness-claim-checker PASS (2 files); recurring-findings-registry PASS (3 classes); 6 live mutations/attacks in a throwaway clone of eb7dd08 (M3 red, reason-blank red, widen+prune green, A red, B red, C red, D green); git status clean; ci.yml diff vs origin/master empty
adr=HIT(35)
report=docs/reviews/path-b-precommit-secret-scan-red-team-round6-2026-09-14.md
```
