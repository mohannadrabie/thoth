# Red Team (Sutekh) — path-b-precommit-secret-scan, round 4 (final re-confirm)

- **Date:** 2026-09-14
- **Tier:** CRITICAL
- **HEAD:** `e785f39afbec8824643e961081d75a7f5342d534` (branch `feat/path-b-precommit-secret-scan`)
- **Primary target:** the new Issue #199 guard test added in `c96a4d5` — `src/secret-scan/history-scan.test.ts:203-304`
- **Verdict:** `go` (SURVIVES with two named residuals, both filed as Issues)
- **ADR cache:** `ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — ~17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]`

> **Literal discipline (this report is itself in scope).** `docs/reviews/*` carries no wildcard allowlist grant, so this file has none. Every attack literal below is described, never reproduced — each was constructed at runtime in a throwaway clone as an AWS-key-shaped 20-char value (4-char prefix + 16 uppercase alphanumerics). That is the exact discipline Issue #199 exists to enforce, applied to the report that reports on it.

---

## 0. Sanity gates (real repo, HEAD e785f39, working tree clean)

```
$ npm run typecheck        -> tsc --noEmit -p tsconfig.json   (exit 0, no output)
$ npm run lint             -> eslint .                        (exit 0, no output)
$ npm test
i tests 829
i suites 0
i pass 829
i fail 0
i cancelled 0
i skipped 0
i todo 0
i duration_ms 29744.3881

$ node src/secret-scan/history-scan.ts
[OSS-01 history-scan] full report (redacted): docs/qa/history-scan-report.json
exit=0

$ node src/qa/completeness-claim-checker.ts
[QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified.  exit=0

$ node src/qa/recurring-findings-registry.ts
[QA-13 recurring-findings-registry] PASS: 3 recurring finding class(es) logged, all structurally valid.  exit=0

$ git status --porcelain   -> (empty)
```

**829 pass / 0 fail / 0 skipped** — up from round-3 by the 4 tests `c96a4d5` added. No regression since round-3. Nothing in #187-#198 re-opened.

---

## Findings, ranked by blast radius

### F1 — [ISSUE][MED][demonstrated] The "generalized" #199 guard is not generalized: its covered-file set is a hand-typed opt-in list of ONE file, so the next credential grant on a new file is unguarded

**Assumption broken:** that `c96a4d5` closed the *class* of blind spot Issue #199 named, rather than the one file it had burned on.

**Code trace.** `src/secret-scan/history-scan.test.ts:235` is `const NARRATIVE_STATUS_FILES = ["docs/STATE.md"];` — structurally identical to the defect #199 itself described, one file over. The test comment says so at `history-scan.test.ts:209-211`: "because #193 own guard tests above are hardcoded to ALLOWLIST_PATH alone and never ran against any other file." The fix replaced one hardcoded path with a hardcoded one-element array. The risk set is "every file carrying a credential-pattern allowlist grant whose content can still change"; the guarded set is {docs/STATE.md}.

Corroborating code trace, same repo: `src/qa/completeness-claim-checker.ts:307` defines this project own "narrative status file" set as TWO files — `export const DEFAULT_FILES = ["docs/STATE.md", "CHANGELOG.md"];`. CHANGELOG.md is treated as STATE.md peer by another instrument in this repo, and is omitted here.

**Production trigger (measured on this story own history).** New credential-pattern grants on new files were added SIX times in six days on this branch alone (docs/STATE.md, docs/decisions.md, and four docs/reviews/*.md reports). The seventh will land on some file the hardcoded array does not name, and nothing will say so: there is NO instrument at all gating allowlist additions (verified by grep — every reference to secret-scan-allowlist.json in *.ts / *.yml / *.mjs is a reader or a comment, never a gate on new entries).

**Attack, run live in a throwaway clone of HEAD e785f39.** Appended one grant (path CHANGELOG.md, patternId aws-access-key-id, with a plausible reason) and one live, distinct, AWS-key-shaped 20-char literal into CHANGELOG.md, staged both:

```
$ git diff --cached --name-only
CHANGELOG.md
docs/qa/secret-scan-allowlist.json

$ node src/secret-scan/pre-commit-scan.ts
[Path B pre-commit-scan] PASS: Full history scanned, 0 blocking secret-shaped matches found (270 allowlisted).

$ node src/secret-scan/history-scan.ts ; echo exit=$?
exit=0

$ node --test src/secret-scan/history-scan.test.ts src/secret-scan/patterns.test.ts \
             src/secret-scan/pre-commit-scan.test.ts src/secret-scan/simulated-commit.test.ts
i tests 54
i pass 54
i fail 0
i skipped 0
```

All three gates green with a live credential literal in the tree. (A full `node --test` in the clone shows 1 unrelated failure, "QA-14 (dogfood) ... ADR-0021", a clone artifact — the adr/ submodule is not checked out in a `git clone --no-hardlinks`. Zero secret-scan tests fail.)

**Current defense, honestly assessed:** the whole-file-grant semantics are pre-existing, intentional OSS-01 design, disclosed in `history-scan.ts` own header and re-stated at `history-scan.test.ts:122-124`. This diff did NOT introduce the hole — it narrowed it from "no file guarded" to "two files guarded" (ALLOWLIST_PATH + docs/STATE.md). What it DID introduce is the claim, in the commit message and the test own name, that the guard is generalized. It is not.

**BREAKS** (as a claim of generalization). Not a regression.

**Named proof-test required:** `OSS-01 allowlist (Issue #199 follow-up): every file carrying a credential-pattern grant whose content is still mutable has no live credential-shaped match in its own current text`. Implementation is ~10 lines and is the shape `c96a4d5` own message says it tried and abandoned — derive the checked set from the allowlist credential grants, then subtract a NAMED, in-code, data-driven exclusion set, instead of inverting to a one-element opt-in list. The abandoned attempt failed because the exclusions were not enumerated; enumerating them is the task, not a reason to invert.

**Exposure: ~0% of runs today, rising to 100% of any file that receives the 7th credential grant; basis: counted-in-code** (15 credential grants over 12 files, enumerated by instrument — table in F2; 6 new grants in 6 days on this branch, counted from git history). Security-class, therefore exempt from PRINCIPLES rule 21 exposure cap.

---

### F2 — [ISSUE][MED][demonstrated] The guard exclusion categories are unbounded in TIME: they exempt every FUTURE byte of files that are still edited, not just the already-reasoned historical content the comment justifies

**Assumption broken:** that "append-only log", "test fixture", and "evidence-quoting report" name content that cannot change, so excluding those files costs nothing. That holds for exactly one of the three. Instrument-generated (not hand-typed) from the current `docs/qa/secret-scan-allowlist.json`:

| file | category | guarded by #199 test? | file still mutable? |
|---|---|---|---|
| docs/STATE.md | narrative-status | **YES** | YES |
| docs/decisions.md | append-only-log | no | **YES** |
| docs/reviews/cifix-cross-domain-round2-2026-09-09.md | evidence-report | no | no (immutable per PRINCIPLES 11) |
| docs/reviews/path-b-precommit-secret-scan-app-security-2026-09-14.md | evidence-report | no | no (immutable per PRINCIPLES 11) |
| docs/reviews/path-b-precommit-secret-scan-cross-domain-round2-2026-09-14.md | evidence-report | no | no (immutable per PRINCIPLES 11) |
| docs/reviews/path-b-precommit-secret-scan-cross-domain-round3-2026-09-14.md | evidence-report | no | no (immutable per PRINCIPLES 11) |
| docs/reviews/path-b-precommit-secret-scan-red-team-2026-09-14.md | evidence-report | no | no (immutable per PRINCIPLES 11) |
| docs/reviews/s5-deny-by-default-hook-wiring-design-challenger-round2-2026-09-06.md | evidence-report | no | no (immutable per PRINCIPLES 11) |
| src/secret-scan/history-scan.test.ts | test-fixture | no | **YES** |
| src/secret-scan/patterns.test.ts | test-fixture | no | **YES** |
| src/secret-scan/pre-commit-scan.test.ts | test-fixture | no | **YES** |
| src/secret-scan/simulated-commit.test.ts | test-fixture | no | **YES** |

```
credential-pattern grants: 15 over 12 distinct files
UNGUARDED **and** still-mutable files holding a credential grant: 5
docs/decisions.md
src/secret-scan/history-scan.test.ts
src/secret-scan/patterns.test.ts
src/secret-scan/pre-commit-scan.test.ts
src/secret-scan/simulated-commit.test.ts
```

Only the docs/reviews/* category is genuinely safe, and for a reason the comment never states: PRINCIPLES rule 11 makes a persisted report immutable, so a grant on a specific dated report is content-bounded by construction. The other two categories are not.

**Attack C — docs/decisions.md laundering (the Manager explicit question: yes).** The append-only rule constrains EDITING EXISTING ROWS; it says nothing about what a NEW row may contain. The guard skips the file entirely and forever. Appended one new dated decisions row carrying a distinct live AWS-key-shaped literal:

```
$ node src/secret-scan/pre-commit-scan.ts
[Path B pre-commit-scan] PASS: Full history scanned, 0 blocking secret-shaped matches found (270 allowlisted).
$ node src/secret-scan/history-scan.ts ; echo exit=$?
exit=0
$ node --test src/secret-scan/history-scan.test.ts
i tests 16   i pass 16   i fail 0   i skipped 0
```

The justification at `history-scan.test.ts:221-225` — "there is no way to make its CURRENT text clean without violating that rule" — is true of the 2026-09-14 row that exists. It is not true of tomorrow row, and the exclusion does not distinguish them.

**Attack D — the test-fixture category, same hole, ZERO setup required.** This is the sharpest one: `src/secret-scan/patterns.test.ts` already holds a standing whole-file aws-access-key-id grant AND is edited every round of this very story. No new allowlist entry is needed. Appended a distinct live literal in a trailing comment:

```
$ node src/secret-scan/pre-commit-scan.ts
[Path B pre-commit-scan] PASS: Full history scanned, 0 blocking secret-shaped matches found (270 allowlisted).
$ node src/secret-scan/history-scan.ts ; echo exit=$?
exit=0
$ node --test src/secret-scan/history-scan.test.ts src/secret-scan/patterns.test.ts
i tests 24   i pass 24   i fail 0   i skipped 0
```

**Current defense, honestly assessed:** none for these five files. Again pre-existing OSS-01 design, not introduced here — but `c96a4d5` comment reasons about the categories as if they were closed, and they are not.

**BREAKS.** **Named proof-test required:** `OSS-01 allowlist: a mutable allowlisted file credential exemption is pinned to already-reviewed content, never open-ended` — bind each mutable-file grant to a baseline (a content hash of the reviewed occurrences, or an allowedMatchCount), so a NEW occurrence in an exempted file blocks while the reviewed ones stay exempt.

**Exposure: 5 of 12 credential-granted files (~42%) accept a live credential silently; basis: counted-in-code** (instrument output above). Security-class, exempt from rule 21 cap. Ranked below F1 only because F1 trigger (adding a grant) is more frequent than F2 trigger (pasting a real credential into a fixture).

---

### F3 — [ISSUE][LOW][code-traced] The guard exclusion taxonomy is a hand-derived completeness claim, which CLAUDE.md hard rules forbid

`history-scan.test.ts:221-225` asserts "docs/decisions.md is the SAME category, not a gap", and the test own name at `:237-241` claims it covers "this project actively-rewritten current-status file". Both are hand-typed enumerations over a set spanning 12 files and 4 categories — squarely inside CLAUDE.md "No hand-derived completeness claims ... generated by a running instrument ... If no such instrument exists, building one is part of the task", and outside its proportionality carve-out for a short flat set trivially eyeballed.

This is the root cause of F1 and F2, not an independent risk; filed separately because its fix (make the taxonomy data the test derives from) is what makes F1 and F2 fixes durable rather than a third hardcoding. The instrument that would enforce this already exists in-repo (`src/qa/completeness-claim-checker.ts`) and does not currently read this file.

**BREAKS** (rule violation), **LOW** — no exploitable path of its own. **Exposure: 1 file, ~0% of runs; basis: counted-in-code.**

---

### F4 — [CLEAN][demonstrated] The guard IS load-bearing on the file it does cover — mutation-verified red, and the real scanner alone would NOT catch it

Planted a distinct live AWS-key-shaped literal into docs/STATE.md in a clone of HEAD:

```
FAIL OSS-01 allowlist (GitHub Issue #199 ...): this project actively-rewritten current-status file ... has no live match for any credential-shaped pattern in its OWN current text, regardless of any whole-file allowlist grant covering it
  AssertionError [ERR_ASSERTION]: ... must never contain a live credential-shaped match in their own CURRENT text ... (GitHub Issue #199): docs/STATE.md (aws-access-key-id)
```

With the same plant staged, the real scanner passes — proving the guard is the ONLY thing catching it, exactly as claimed:

```
$ git add docs/STATE.md && node src/secret-scan/pre-commit-scan.ts
[Path B pre-commit-scan] PASS: Full history scanned, 0 blocking secret-shaped matches found (270 allowlisted).
HOOK EXIT=0
```

SURVIVES. A genuinely good, non-green-by-construction test for its scope. Credit where due: the two mutation-sensitivity proof tests at `:260` and `:279` are the right instinct, and I confirmed independently they are not self-satisfying.

---

### F5 — [CLEAN][code-traced] No detection divergence between the guard and the real scanner for credential patterns; no false confidence from regex shape

The guard consumes the identical SECRET_PATTERNS catalog the scanner uses (`history-scan.test.ts:9,156,192,246`), so a literal shaped to evade the guard necessarily evades the real scanner too, and vice versa. `matchesPatternLive` (`:160-164`) rebuilds a fresh non-global RegExp per call — the lastIndex-carryover bug that would silently skip alternate matches is explicitly avoided, and `flags.replace("g","")` is safe because a flags string contains g at most once. The three excluded pattern ids (internal-hostname, ipv4-private, email-address) are not a gap for docs/STATE.md: it holds a grant for aws-access-key-id only, so a live hostname/IP/email there is still caught by the ordinary scanner. SURVIVES.

---

### F6 — [CLEAN][code-traced] The #199 guard is a CI-only gate; the local pre-commit hook gives it zero coverage — correct, and correctly documented

`.githooks/pre-commit` runs `exec node src/secret-scan/pre-commit-scan.ts` and nothing else; the guard test only runs under `npm test` (`.github/workflows/ci.yml:194`). So the #199 class is unguarded locally and caught at PR CI. The hook own header already states it is "a defense-in-depth, LOCAL, pre-commit-only backstop -- not an unbypassable control" and names CI as the real backstop. A staged-then-reverted working-tree divergence cannot exploit this: CI checks out the committed tree, so the guard reads the committed bytes. SURVIVES.

---

## Process note the Manager should weigh

Counted from `docs/REVIEW_LOG.md`, this target has drawn **4 prior REWORK/BLOCKED-class verdicts** (1 REWORK + 3 no-go) alongside 2 APPROVE, 1 APPROVE-WITH-CONDITIONS, 1 go. PRINCIPLES rule 16(d) cumulative hard stop fires at 6. F1/F2 are the THIRD appearance of one root-cause class on this story (#193 -> #199 -> here) — the precise shape rule 16(d) was written to catch: a target that clears one distinct issue per round and never strings together 3 consecutive misses.

That shaped my verdict. No open finding is a calibrated blocking HIGH; the residuals are pre-existing OSS-01 design, not defects this diff introduces; and the diff is a strict net improvement (guarded files went 0 -> 2). PRINCIPLES rule 16 own stated default therefore applies: **build now, every open finding becomes a day-1 failing test**, rather than a fifth rework cycle.

**The one thing that must not ship silently is the CLAIM.** Issue #199 closure comment and CHANGELOG.md must record that the guard covers docs/STATE.md specifically — not that the class is generalized. Closing #199 as fully resolved would be a false all-clear on a security control, and that is the harm worth naming, not the residual itself.

## Scariest unproven assumption

**That "this project established test-fixture category" is a safe place to stop looking.** Four actively-edited *.test.ts files carry standing whole-file credential exemptions, are touched every round of this story, and accept a real credential today with no new allowlist entry and no gate anywhere — hook, CI scan, and all 829 tests green. Attack D demonstrated it. The exemption is justified by the files PURPOSE, and purpose does not bound CONTENT.

## Go / no-go

**go** — proceed to Stage 4 verify, with F1 and F2 filed as Issues and Issue #199 closure comment corrected to state its actual scope.

## Single next action

Post a comment on Issue #199 stating the guard real scope (docs/STATE.md only) before it is closed.

---

## Editorial (verdict-neutral, plain edits, no re-review)

- `c96a4d5` commit message calls the addition a "generalized guard test"; it covers one hardcoded file. Reword to "guard test for docs/STATE.md".
- `history-scan.test.ts:237-241` test name says "this project actively-rewritten current-status file" (singular, definite). `src/qa/completeness-claim-checker.ts:307` names two such files. Align the wording or the list.
- `history-scan.test.ts:216-220` parenthetical "a dozen already-accepted ... occurrences" — the instrument-generated count is 14 credential grants outside docs/STATE.md. Replace the hand-typed figure with the instrument output.


---

```
RECEIPT: verdict=go
attacks (all, ranked by blast radius):
1. [ISSUE][MED][demonstrated] #199 guard is not generalized -- NARRATIVE_STATUS_FILES is a hand-typed 1-element opt-in list (history-scan.test.ts:235), same shape as the #193 defect it replaced; planted a new CHANGELOG.md grant + live AWS-key-shaped literal in a clone of HEAD: pre-commit hook PASS, history-scan exit 0, 54/54 secret-scan tests green. Defense: pre-existing OSS-01 whole-file-grant design, narrowed 0->2 guarded files by this diff -- the CLAIM of generalization is what breaks, not a regression. Exposure: ~0% of runs today, 100% of the file receiving the 7th credential grant; basis: counted-in-code (6 new grants in 6 days on this branch; no instrument gates allowlist additions).
2. [ISSUE][MED][demonstrated] Exclusion categories are unbounded in TIME -- 5 of 12 credential-granted files are still mutable and unguarded (instrument-generated table). Attack C: a NEW docs/decisions.md row with a live literal passes all gates (append-only constrains editing old rows, not writing new ones). Attack D: src/secret-scan/patterns.test.ts already holds a standing whole-file grant and is edited every round -- a live literal passes hook + CI scan + 24/24 tests with ZERO setup. Defense: none for those five. Exposure: 5/12 credential-granted files (~42%); basis: counted-in-code.
3. [ISSUE][LOW][code-traced] The exclusion taxonomy is a hand-derived completeness claim (history-scan.test.ts:221-225, :237-241) -- CLAUDE.md hard rule requires an instrument; completeness-claim-checker.ts exists and does not read this file. Root cause of 1 and 2, no exploit path of its own. Exposure: 1 file, ~0% of runs; basis: counted-in-code.
4. [CLEAN][demonstrated] Guard IS load-bearing on docs/STATE.md -- planting a literal turns it red with the right assertion message, and the real scanner still PASSes the same plant (hook exit 0), proving the guard is the only thing catching it. Not green-by-construction; the two mutation-sensitivity tests at :260/:279 hold up.
5. [CLEAN][code-traced] No guard-vs-scanner detection divergence: same SECRET_PATTERNS catalog; matchesPatternLive rebuilds a fresh non-global RegExp per call so no lastIndex carryover; the 3 excluded pattern ids are not a gap for STATE.md (it grants aws-access-key-id only).
6. [CLEAN][code-traced] #199 guard is CI-only (ci.yml:194 npm test), absent from .githooks/pre-commit -- correct and already documented in the hook own header; a staged-then-reverted worktree divergence cannot evade it because CI reads the committed tree.
counts (CHECKSUM): issues=3 suspicions=0 clean=3
evidence (CHECKSUM): demonstrated=3 code-traced=3 derived=0
checks=npm test 829 pass / 0 fail / 0 skipped; typecheck exit 0; lint exit 0; history-scan.ts exit 0 (PASS, 0 blocking); completeness-claim-checker PASS (2 files); recurring-findings-registry PASS (3 classes); 4 live mutation/attack runs in a throwaway clone of e785f39 (1 guard-red confirm + 3 bypasses, all green)
adr=HIT(35)
report=docs/reviews/path-b-precommit-secret-scan-red-team-round4-2026-09-14.md
```
