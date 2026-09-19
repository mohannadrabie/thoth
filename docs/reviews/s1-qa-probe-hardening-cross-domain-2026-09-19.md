# Cross-Domain Review (Ra) - s1-qa-probe-hardening (S1 Story A: Issues #175, #179, #182)

[cross-domain-reviewer] Cross-Domain Reviewer (Ra) - scanning the seams between reviewer lanes

- Date: 2026-09-19. Tier: STANDARD (ratified by the Manager, run-log `tier-ratified` 2026-09-19T14:58:47Z; not re-litigated).
- HEAD: 793299d (5 commits), branch `fix/s1-story-a-probe-hardening`. Diff: `git diff f892518..793299d` (7 files: CHANGELOG.md, `src/qa/{continuation-residual-probe,marker-corpus-probe,untracked-scan-warning}.ts` and their `.test.ts` files; 430 insertions, 68 deletions).
- **Verdict: APPROVE.** No collision, no seam defect. One LOW suspicion, three Editorial items.

## ADR cache

`📊 ADR cache HIT: reused 36 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:1] from catalog — ≈17800 tokens saved this pass (fp 5dba384) [CACHE=HIT]`

Read the whole catalog, unfiltered (this role's mandate): the `Rules for agents` of every SE ADR that can bind a TypeScript QA instrument (0002, 0003, 0004, 0005, 0006, 0010, 0012, 0016, 0019, 0020, 0021) and the project ADR THOTH-ADR-0001; the 12 devops ADRs are IaC/CDK/FinOps rules and bind nothing in a diff with no infrastructure file.

## Who ran alongside, and where their ground stops

- `code-reviewer` (Anubis), report `docs/reviews/s1-qa-probe-hardening-code-reviewer-2026-09-19.md`, verdict SHIP. Covered: AC 1-13 mapped to code, SE-0003/0005/0010, the nine plan mutations (all killed by the named test), grep instruments AC 4/8/12/13, a live fixture demo. Not re-listed here.
- Ground left to this pass: whole-catalog ADR collisions, consumers of the probes stdout/exit/argv outside the two files, the sensitive-area boundary, the disclosed `gh` consequence, CHANGELOG honesty, the human rulings, hand-derived completeness claims.

## Cross-domain ADR verdict (whole catalog vs. the diff)

| ADR | Verdict | Basis |
|---|---|---|
| SE-0002 layering | CONFORMS | New file imports only `../lib/exec.ts` (type) and `./reference-resolver.ts`; no vendor type crosses a boundary. |
| SE-0003 injected I/O / single responsibility | CONFORMS | `untrackedScanWarning(runner, repoRoot)` takes an injected `Runner`; `warnIfUntrackedScannable` takes an injected `write` sink; `main()` is the composition root (`realRunner`, `console.error`). `collectFullTreeFileTexts` still builds `makeGitOps(realRunner, ...)` inside; that is the twin pre-existing, already-reviewed shape (Issue #176), not introduced here. |
| SE-0004 idempotency | CONFORMS | Both probes and the warning are read-only; a second run is the same read. |
| SE-0005 testing | CONFORMS | Removed test lines are exactly the KNOWN-GAP test and its own comments (removed-lines listing read in full); its own comment ordered the replacement ("must be REPLACED with one asserting a non-zero exit"), and the successor is strictly stronger. Each new test owns an `mkdtemp` repo; no sleeps. |
| SE-0006 blast radius / no opportunistic scope | CONFORMS | 7 files, all named in the plan; #226 not folded in (the gate still admits a duplicated `--field=`, as before). |
| SE-0010 local gates, no suppression | CONFORMS | typecheck exit 0, lint exit 0, full suite 885/885, zero skipped; grep of added lines for eslint-disable, ts-ignore, ts-expect-error, .skip: no hit. |
| SE-0016 / 0019 / 0020 (protected tree, port fidelity) | N/A | No file under `.claude-plugin/`, `fullstack/`, `hooks/`, `scripts/` touched; nothing ported. |
| SE-0021 kernel purity + THOTH-ADR-0001 | N/A | No `src/policy/**`, hook, or `docs/qa/s5-central-classification.json` change. `npm run qa:kernel-purity`: PASS (4 files, zero violations). |
| SE-0007/0008/0009/0011-0015, devops 0001-0010 | N/A | No tagging, cost, observability, data-model, retention, or infrastructure content. |

**No ADR collision.**

## Seam findings

### 1. Sensitive-area boundary (the plan re-tier trigger) - CLEAN

```
$ git diff --stat f892518..793299d -- src/lib docs/qa hooks scripts .github src/secret-scan
(empty)
$ git diff --name-only f892518..793299d
CHANGELOG.md
src/qa/continuation-residual-probe.test.ts
src/qa/continuation-residual-probe.ts
src/qa/marker-corpus-probe.test.ts
src/qa/marker-corpus-probe.ts
src/qa/untracked-scan-warning.test.ts
src/qa/untracked-scan-warning.ts
```
`src/lib/git.ts`, `docs/qa/secret-scan-allowlist.json`, `hooks/*`, `scripts/guard/*`, `.github/workflows/ci.yml`, `src/secret-scan/*` untouched. No address-shaped literal added (grep of added lines for an at-sign host pattern: no hit). STANDARD holds; no re-tier.

### 2. Consumers of the probes stdout / exit / argv - CLEAN (one LOW note in finding 3)

Callers found by grep (`continuation-residual-probe|marker-corpus-probe`, excluding CHANGELOG, plans, reviews): the two `KNOWN_INSTRUMENTS` blocks in `src/qa/completeness-claim-checker.ts:51-69`, comments in `reference-resolver.ts:211-218`, historical prose in STATE.md/backlog/decisions. `package.json` scripts, `.github/workflows/*.yml`, `.githooks/`, `hooks/`: no probe invocation (`grep -rn probe package.json .github/workflows/*.yml` empty).

Ran every invocation the two `KNOWN_INSTRUMENTS` entries and the docs describe, in the real repo (clean tree):
```
continuation-residual-probe.ts                                   exit=0  stdout ...PASS: continuation-marked=369 (290 files scanned) ...
continuation-residual-probe.ts --field=continuation-marked       exit=0  stdout ...PASS: continuation-marked=369
continuation-residual-probe.ts --field=continuation-residual     exit=0  stdout ...PASS: continuation-residual=5 / continuation-marked=369 / distinct issue numbers queried=182
continuation-residual-probe.ts --field=continuation-marked --field=continuation-residual   exit=0 (duplicated field, first wins: #226, unchanged)
continuation-residual-probe.ts not-a-ref                         exit=1  stdout empty, stderr: unrecognized argument(s): "not-a-ref" ...
continuation-residual-probe.ts --bogus                           exit=1  stdout empty, stderr: unrecognized argument(s): "--bogus" ...
node src/qa/completeness-claim-checker.ts                        [QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified.
```
The strict argv gate breaks no real invocation: both registered argv vectors are `[script, "--field=..."]`, and the checker reads only `res.stdout` (`completeness-claim-checker.ts:221`). The existing `completeness-claim-checker.test.ts:147-156` pin passes.

### 3. Warning invisible on the one automated consumer - SUSPICION, LOW, code-traced

`completeness-claim-checker.ts:221-235` (`verifyMarkerClaim`) uses `lastInteger(res.stdout)` and its failure `details` carry `stdout` only; `res.stderr` is dropped. So if a completeness marker naming `qa14-marker-corpus-probe-total` ever fails because an untracked scratch file moved the number, the #182 warning that explains why never reaches the reader. Today it has no victim: no live marker in permanently-scanned prose references either probe (grep of completeness markers outside reviews/tests: none), and the probe headers say none is to be wired. The human ruled stderr-only, so this is not a defect in the change. No failing test exists because there is no live consumer to fail; resolve as a residual-register / backlog line ("if a marker is ever wired to a probe, surface `res.stderr` in the checker failure details"), per rule 12, not this diff.

### 4. Disclosed consequence: untracked citations now reach `gh` - CLEAN (disclosure adequate)

Demonstrated in a throwaway fixture repo (one committed file, one untracked scratch file with 60 distinct citations, one untracked nested repo):
```
QA14_MAX_ISSUES=5 node continuation-residual-probe.ts --field=continuation-residual
exit=1
stdout: [QA-14 continuation-residual-probe] FAIL: 62 distinct issue citation(s) this run exceeded the cap - increase QA14_MAX_ISSUES ...
stderr: WARNING: 4 untracked file(s) are inside the counted number, so it changes when scratch files come and go:
          - e.txt / - o.txt / - scratch.md / - scratch2.md      (nested repo not listed, not scanned)
        Commit, delete, or .gitignore them for a reproducible number. (The count itself is unchanged.)
```
The warning is emitted after collection and before the `gh` pass, so it is on screen when the cap fails. CHANGELOG carries a "Behavior change" callout naming `QA14_MAX_ISSUES`, default 300, exit 1, and the stderr warning; the plan "consequence to know" is therefore disclosed where an operator looks. Headroom on the real tree, measured: 182 distinct issues queried of 300. Untracked review reports between write and commit count toward that, a handful per round; not a near-term risk.

### 5. CHANGELOG entry - CLEAN

`git diff --stat`: CHANGELOG.md `14 ++`, zero deletions; no dated history rewritten. Claims checked: stray argv exits non-zero, stdout empty, rejected before collection (demonstrated above and by T179-3); `src/lib/git.ts` and the allowlist untouched (finding 1); "supersedes the disclosed-not-fixed comment recorded for #182 on 2026-09-13" is stated as a supersession, not an erasure (the 2026-09-13 `docs/decisions.md` row is untouched). No bare completeness phrase: QA-15 PASS. Issue numbers: `gh issue view` returns real Issues for #172, #175, #176, #179, #182, #226 (#175/#179/#182/#226 OPEN, #172/#176 CLOSED, as the prose implies). QA-14 (`node src/qa/reference-resolver.ts`): rc=1, "5 of 388 citation(s) failed", the same 5 as the known #120 debt (`Issue#0`, `clean/safe-single-constructor-access.ts`, `.claude/settings.local.json`, `docs/reviews/_probe.md`, `hooks/report-subject-gate.mjs`); grep of the diff for each: no hit, so this diff adds nothing to it. New bare `#179`/`#182`/`#226` in the entry own bullets show as "unclassified (non-blocking)", the repo existing behavior.

### 6. The human 2026-09-19 rulings and gold-plating (rule 12) - CLEAN

- Stderr only: the warning goes through `(message) => console.error(message)`; a `console.log` mutation on the scratch clone fails TWR-1. Number and stdout unchanged: fixture runs above print the same integer with and without untracked files; exit 0.
- Twins share one implementation: grep for `warnIfUntrackedScannable` and `untrackedScanWarning` under `src`, outside the helper own files: `continuation-residual-probe.ts:61,249`, `marker-corpus-probe.ts:33,224` (one import and one call each).
- #226 left separate: gate unchanged for duplicated `--field=` (run above, exit 0), and the CHANGELOG says so.
- Nothing beyond the approved change: no flag, no second number, `git.ts` untouched, `assertKnownArgs` deliberately unshared (plan D2). The `export` of `collectFullTreeFileTexts`, `assertKnownArgs` and `UNTRACKED_WARNING_PATH_CAP` is plan-approved (in-process tests; D4).

### 7. Hand-derived completeness claims (CLAUDE.md hard rule) - CLEAN

The new prose enumerations are instrument-backed: the CHANGELOG test list "T179-1..4, T175-1..2, TW-1..8, TWR-1..3" was checked by grepping `src/qa/*.test.ts` for each of the 17 IDs; every one is present (TW-1..8 in `untracked-scan-warning.test.ts`, TWR-1/2 in `marker-corpus-probe.test.ts`, TWR-3 and the T179/T175 IDs in `continuation-residual-probe.test.ts`). "One call per probe main()" is backed by the call-site grep in finding 6. The CHANGELOG mutation list ("shown red") was reproduced independently on a scratch clone (below), and the code-reviewer report carries the full nine. "Both probes" is a set of two.

Independent mutation re-run (scratch clone of HEAD 793299d under the session scratchpad; the real tree was never edited):
```
baseline (3 test files)                 pass 47  fail 0
M1 drop assertKnownArgs call            pass 46  fail 1   T179-3
M4 list source back to ls-tree HEAD     pass 44  fail 3   T175-1, T175-2, TWR-3
M7 marker warning -> stdout             pass 46  fail 1   TWR-1
M8 continuation warn call removed       pass 46  fail 1   TWR-3
M8b marker warn call removed            pass 46  fail 1   TWR-1
```

### 8. Duplicated `git ls-files --others` argument vector (plan D1) - CLEAN, named by the plan

`untracked-scan-warning.ts` repeats the `--others --exclude-standard` vector that `git.ts` `lsFilesWorkingTree()` uses. The plan named this cost (D1) and the human accepted it, so it is not a new finding. Parity holds today: in the fixture the warning counted 4 untracked files and the probe counted the same set (`total=62`), and both drop the nested repo. Only gross drift would be caught by TWR-1/3, not a subtle change to `git.ts`; accepted by the plan.

## Coverage gaps named

| Item | Status |
|---|---|
| CHANGELOG.md | Covered here (finding 5); no domain reviewer owns prose. |
| `docs/STATE.md`, `docs/decisions.md` (the 2026-09-19 rulings) | Not in the diff, by plan (Manager close-out, step 5). Definition of Done requires them before merge; a reminder, not a finding. |
| Test files | code-reviewer lane. |
| `.github/workflows/ci.yml` | Untouched; CI runs `npm test`, which passes 885/885 locally. |

## Editorial (verdict-neutral, fix as plain edits, no re-review)

1. `src/qa/continuation-residual-probe.ts:43`: header says "this metric corpus is the whole tracked tree"; after #175 it is the working tree (tracked plus untracked-not-ignored). The AC 8 grep patterns did not include "tracked tree". `completeness-claim-checker.ts:59` carries the same phrase ("whole-tracked-tree-corpus"); the plan puts that file out of scope, so leave it or fold the wording change into a later edit of that file.
2. `src/qa/untracked-scan-warning.ts` header, "same git arguments, same exclusions": the git arguments match the `--others` half of `lsFilesWorkingTree()`, but the helper also applies `shouldScanFile`, which that method does not. Say "same git arguments".
3. The CHANGELOG entry does not mention that a rejected argv also prints a Node stack trace on stderr (the plan section on what changes for the human does, and the twin does the same). Optional one-clause add.

## Raw checks run

```
git diff --stat f892518..793299d -- src/lib docs/qa hooks scripts .github src/secret-scan      -> empty
npm run typecheck                                                                              -> exit 0
npm run lint                                                                                   -> exit 0
npm test                                                                                       -> tests 885, pass 885, fail 0, cancelled 0, skipped 0
node --test (continuation-residual-probe, marker-corpus-probe, untracked-scan-warning, completeness-claim-checker tests) -> tests 78, pass 78, fail 0, skipped 0
node src/qa/completeness-claim-checker.ts                                                      -> PASS, 2 file(s)
node src/qa/reference-resolver.ts                                                              -> rc=1, 5 of 388 failed (known #120 debt; none from this diff), 34 unclassified non-blocking
npm run qa:kernel-purity                                                                       -> PASS
probe invocations in the real repo (6 argv shapes) and fixture repo (3 field modes + cap run)  -> as listed above
mutations M1, M4, M7, M8, M8b on a scratch clone                                               -> each red on the named test(s); baseline 47/47
```
Known and not added to by this diff: QA-14 red (Issue #120 debt), R4 flake (Issue #227; did not fire in my full run).

## Findings-to-tests

Open [ISSUE] findings: 0; failing tests: 0. The single [SUSPICION] (finding 3) has no executable form because no live consumer exists to fail; it resolves to a residual-register/backlog line.

## Verdict and next action

**APPROVE.** Single next action: the Manager proceeds to `/maat:verify`, applies Editorial 1-3 as plain edits (optional), and writes the STATE.md and `docs/decisions.md` close-out rows for the 2026-09-19 rulings before the human merges.

RECEIPT: verdict=APPROVE
findings (ALL of them, one terse line each, ranked by blast radius):
1. [SUSPICION][LOW][code-traced] src/qa/completeness-claim-checker.ts:221-235 — checker reads probe stdout only, so the #182 stderr warning never reaches a failing completeness marker output; no live marker exists, backlog line only
2. [CLEAN][demonstrated] sensitive areas (src/lib/git.ts, secret-scan-allowlist.json, hooks/*, scripts/guard/*, ci.yml, src/secret-scan/*) untouched, git diff --stat empty; STANDARD holds
3. [CLEAN][demonstrated] whole-catalog ADR sweep (36 ADRs): no collision; SE-0003/0005/0006/0010 conform, 0016/0019/0020/0021/thoth-0001 not touched, qa:kernel-purity PASS
4. [CLEAN][demonstrated] consumers: both KNOWN_INSTRUMENTS argv vectors and no-arg run exit 0 with stdout ending in the integer; checker PASS; no npm script, CI, or hook invokes the probes
5. [CLEAN][demonstrated] untracked citations now reach gh (QA14_MAX_ISSUES cap) — disclosed in CHANGELOG callout, warning precedes the cap failure on stderr; headroom 182 of 300 measured
6. [CLEAN][demonstrated] CHANGELOG entry: additions only, no history rewrite, QA-15 PASS, QA-14 adds nothing to the #120 red, issue numbers #172/#175/#176/#179/#182/#226 all real
7. [CLEAN][demonstrated] human rulings honored (stderr only, number/stdout/exit unchanged, one shared helper with 2 call sites, #226 separate); no gold-plating beyond plan
8. [CLEAN][demonstrated] new prose enumerations instrument-backed (17 test IDs grep-verified, call-site grep, 5 mutations independently reproduced red); D1 duplicated git arg vector is plan-named, not re-reported
counts (a CHECKSUM): issues=0 suspicions=1 clean=7
evidence (a CHECKSUM): demonstrated=7 code-traced=1 derived=0
checks=npm test 885 pass/0 fail/0 skip; targeted node --test 78 pass/0 fail/0 skip; typecheck exit 0; lint exit 0; completeness-claim-checker PASS; reference-resolver rc=1 (known #120 red, 5 fails none from this diff); qa:kernel-purity PASS; mutations M1/M4/M7/M8/M8b each red on named test, baseline 47/47
adr=HIT(36, whole catalog)
report=docs/reviews/s1-qa-probe-hardening-cross-domain-2026-09-19.md
