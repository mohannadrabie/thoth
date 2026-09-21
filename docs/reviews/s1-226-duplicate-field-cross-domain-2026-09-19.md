# Cross-Domain Review (Ra) - s1-226-duplicate-field (Issue #226)

[cross-domain-reviewer]
Cross-Domain Reviewer (Ra) - scanning the seams between reviewer lanes

- Date: 2026-09-19. Tier: STANDARD (ratified by the Manager, run-log `tier-ratified` 2026-09-19T19:41:02Z; not re-litigated).
- HEAD: e980415 (2 commits since origin/master 8760096: 46b275b plan + tier persistence, e980415 build). Branch `fix/s1-226-duplicate-field`.
- Diff: 8 files: `CHANGELOG.md`, `docs/.maat-state.json`, `docs/plans/s1-226-duplicate-field-phase1-2026-09-19.md`, `docs/run-log.jsonl`, `src/qa/marker-corpus-probe.ts`, `src/qa/marker-corpus-probe.test.ts`, `src/qa/continuation-residual-probe.ts`, `src/qa/continuation-residual-probe.test.ts`.
- **Verdict: APPROVE.** No ADR collision, no seam defect, no HIGH/MED. 0 open findings, 0 failing tests. 3 Editorial items.

## Lanes

| Lane | Who | Ground covered |
|---|---|---|
| Domain (correctness, test quality) | `code-reviewer` (parallel) | parser logic, test assertions, mutation strength, full suite |
| Cross-domain (this pass) | Ra | whole ADR catalog vs the diff, sensitive-area boundary, other consumers of the argv contract, twins of the pattern, CHANGELOG claims vs diff, state and run-log bookkeeping, QA-14/15 gates |

Not re-covered: test-body logic and full-suite counts (code-reviewer lane). I reproduced the mutation claims because the CHANGELOG states them as fact for both probes; that is a claim check, not a second opinion on test design.

## ADR cache and whole-catalog read

```
$ node docs/adr-cache.mjs --ensure
ADR cache HIT: reused 36 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:1] from catalog - about 17800 tokens saved this pass (fp 5dba384) [CACHE=HIT]
```

Read whole and unfiltered from `adrCatalog.adrs` in `docs/.maat-state.json` (36 entries: devops 0001-0010 + template + README, SE 0001-0021 + template + README, THOTH-ADR-0001). Rules for agents read in full for every accepted ADR whose surface the diff could touch; the rest were checked by `applicableTo` against the changed-file list (all 8 files are QA CLI source, its tests, docs, state).

## Cross-domain ADR verdict

| ADR | Verdict | Basis |
|---|---|---|
| SE-0001 (record decisions) | No collision | no undecided significant decision made; the Manager ruling on identical repeats is in the plan and CHANGELOG, human-preapproved |
| SE-0003 (SOLID; I/O injected, YAGNI) | No collision | validators are pure (no I/O added); no shared helper, no speculative abstraction; each source file is 8 added / 3 removed lines (`git diff --numstat`) |
| SE-0005 (tests; never delete or weaken) | No collision | `git diff -U0 origin/master..HEAD -- src/qa/*.test.ts` has exactly one removed line, the import `import { join } from "node:path";` widened to add `dirname`. No assertion removed or weakened |
| SE-0010 (gates; no skip or suppress; no scope creep) | No collision | 76 pass, 0 fail, 0 skipped in the three relevant test files; typecheck and lint clean on changed files; no `eslint-disable`, `.skip` or threshold change in the diff |
| SE-0002, ADR-0021, ADR-0019 (kernel purity, layering, ports) | Not applicable | `src/qa/*` probes sit outside the policy kernel boundary; nothing under `src/policy/` changed |
| SE-0016, 0018, 0020 (plugin tree, port fidelity) | Not applicable | no ported or `.claude-plugin/` file touched |
| THOTH-ADR-0001 (central-classification fixture) | Not applicable | `docs/qa/s5-central-classification.json` untouched |
| SE-0004, 0006-0009, 0011-0015 and devops 0001-0010 | Not applicable | no endpoint, data store, cloud resource, IaC, pipeline or IAM surface in the diff |

No ADR collision. No UNCLEAR.

## Seam checks (raw output for every claim)

### 1. Sensitive areas (CLAUDE.md) untouched

```
$ git diff --name-only origin/master..HEAD | grep -E '^(hooks/|scripts/guard/|src/policy/guard/|\.github/|\.gitleaks|scripts/secret-scan/|src/secret-scan/|\.thoth/|docs/qa/|src/lib/git\.ts|src/qa/completeness-claim-checker\.ts)' || echo NONE
NONE of the sensitive/named paths touched
```

`src/qa/completeness-claim-checker.ts` is not itself on the sensitive list; it is included because the plan's re-tier trigger names it. Not touched. STANDARD holds.

### 2. Other consumers of the two probes' argv contract

```
$ grep -nE 'marker-corpus|continuation-residual' package.json .github/workflows/*.yml
(no output)
$ grep -n -- '--field=' src/qa/completeness-claim-checker.ts    (instrument entries)
57:  "qa14-marker-corpus-probe-marked": { ... args: ["src/qa/marker-corpus-probe.ts", "--field=marked"] },
58:  "qa14-marker-corpus-probe-unmarked": { ... "--field=unmarked" },
59:  "qa14-marker-corpus-probe-total": { ... "--field=total" },
68:  "qa14-continuation-residual-probe-marked": { ... "--field=continuation-marked" },
69:  "qa14-continuation-residual-probe-residual": { ... "--field=continuation-residual" },
$ git grep -n 'cmd="[^"]*--field' -- . ':!docs/reviews' ':!docs/plans'
(no output)
$ node src/qa/completeness-claim-checker.ts
[QA-15 completeness-claim-checker] PASS: 2 file(s) checked, all completeness claims verified.
```

Five instrument entries, each with exactly one `--field=` token; the checker runs `instrument.args` verbatim (`src/qa/completeness-claim-checker.ts` line 220). No `package.json` script and no workflow references either probe; no `[[completeness: cmd=...]]` marker carries argv. No live caller can pass two tokens, so the new throw cannot break a consumer.

### 3. Third twin of the first-wins pattern

```
$ grep -rnE 'args\.find|argv\.find|\.find\(\(?[a-z]+\)? *=> *[a-z]+\.startsWith\("--' --include=*.ts --include=*.mjs --include=*.js src hooks scripts
(no output)
$ grep -rnE 'startsWith\("--[a-z-]+="\)|startsWith\(.--' --include=*.ts --include=*.mjs --include=*.js src hooks scripts | grep -v '\.test\.'
src/policy/normalizer/flag-catalog.ts:68:  if (token.startsWith("--") && !token.includes("=") && DIRECTORY_FLAG_LONG_EQUALS.has(...
src/qa/continuation-residual-probe.ts:84 and :104
src/qa/marker-corpus-probe.ts:93 and :115
src/qa/shell-detector-mutants.ts:388  (a source-text string quoting the flag-catalog line)
```

- 22 non-test files read `process.argv` (`grep -rln 'process\.argv'`). Their shapes: positional `process.argv[N] ?? default` (broken-instrument-gate, diff-fixture-check, fixture-coverage-check, the gate-*-check scripts, recurring-findings-registry, reference-resolver, runtime-settings-drift-check), `process.argv.slice(2)` as a file list (completeness-claim-checker), a boolean `process.argv.includes("--all-refs")` (history-scan; a repeat is idempotent), or a bare entry-point check. None parses a valued `--flag=` in a first-wins way. `flag-catalog.ts` tokenizes shell commands for the policy normalizer, not CLI argv.
- Result: no third twin, so nothing to file for that. The positional-argv scripts silently ignore extra arguments (the Issue #173 and Issue #179 class); that is a different pattern on different files, out of scope for Issue #226, not a demonstrated defect, and not filed (human constraint: no gold-plating).

### 4. Consistency with the Story A / Issue #173 / Issue #179 gate

Real invocations at the repo root (the untracked root `prompt` file only draws the existing stderr warning):

```
marker --field=total                       exit=0  stdout: [QA-14 marker-corpus-probe] PASS: total=1502
marker --field=marked --field=total        exit=1  stdout: (empty)  stderr: marker-corpus-probe.ts:95 throw new Error, "--field may be given only once, got: ..."
marker --field=total --field=total         exit=1  stdout: (empty)
marker --field=bogus --field=total         exit=1  stdout: (empty)  (duplicate reported before value validation, as the CHANGELOG says)
marker --field=bogus                       exit=1  stdout: (empty)  stderr: :101 --field must be one of marked|unmarked|total, got "bogus"  (existing message unchanged)
continuation --field=continuation-marked  exit=0  stdout: ... PASS: continuation-marked=383
continuation --field=continuation-marked --field=continuation-residual  exit=1  stdout: (empty)
continuation --field=continuation-marked --field=continuation-marked    exit=1  stdout: (empty)
```

Same channel as the stray-argument gate: an `Error` thrown in `main()` prelude under top-level `await`, uncaught, exit 1, stack on stderr, nothing on stdout. Both `main()` functions call `assertKnownArgs(argv)`, then `parse*Field(argv)`, then `collectFullTreeFileTexts` (`src/qa/marker-corpus-probe.ts` about lines 219-222; `src/qa/continuation-residual-probe.ts` about lines 244-247), so the rejection precedes every git and `gh` call. `assertKnownArgs` is unchanged: it filters only non-`--field=` tokens, so a duplicated recognized flag passes it and reaches the parser, which is the placement rationale in the plan.

### 5. Mutation claims reproduced independently (CHANGELOG "Mutation proofs")

Scratch copy of HEAD via `git archive` (the shared working tree was not touched); mutations applied by script; file restored after each and `git diff --stat` empty at the end. Command per probe: `node --test src/qa/<probe>.test.ts`.

```
marker-corpus-probe                               continuation-residual-probe
baseline              pass 20 fail 0 skip 0       baseline              pass 25 fail 0 skip 0
M1 delete check       pass 17 fail 3              M1 delete check       pass 22 fail 3
M2 relax to distinct  pass 18 fail 2              M2 relax to distinct  pass 23 fail 2
M3 parse after collect pass 19 fail 1             M3 parse after collect pass 24 fail 1
restored: git diff --stat empty (byte-identical) on both
```

Tests the runner named red: M1 = both unit tests + the subprocess test; M2 = identical-repeat unit test + subprocess test; M3 = subprocess test only. That matches the CHANGELOG sentence exactly for both probes: the new tests are live, not vacuous.

### 6. Checks run

```
$ node --test src/qa/marker-corpus-probe.test.ts src/qa/continuation-residual-probe.test.ts src/qa/completeness-claim-checker.test.ts
tests 76  pass 76  fail 0  cancelled 0  skipped 0
$ npm run typecheck                     -> tsc --noEmit, no errors
$ npx eslint <the 4 changed src files>  -> no output
```

The full `npm test` suite count is code-reviewer's to report; I did not rerun it whole.

### 7. QA-14 (red on master, Issue #229): nothing new from this diff

```
$ node src/qa/reference-resolver.ts origin/master HEAD     exit=1
FAIL: 7 of 514 citation(s) failed to resolve; 57 more unclassified (non-blocking).
  Issue#0, clean/safe-single-constructor-access.ts, .claude/settings.local.json, docs/reviews/_probe.md,
  hooks/report-subject-gate.mjs, fullstack/plugin.json, fullstack/scripts/test-guard.sh
$ git diff -w -U0 origin/master..HEAD | grep '^+' | grep -v '^+++'    -> 258 added lines
$ grep -c <each of the 7 failing strings> on those lines            -> 0 for all 7
$ git diff -w --stat origin/master..HEAD -- docs/.maat-state.json   -> 1 file changed, 11 insertions(+)
```

The 7 unresolved-authority failures are the whole-file effect on `CHANGELOG.md` and `docs/.maat-state.json`; none comes from a line this diff adds. The bare-number unclassified hit for Issue #226 is non-blocking and comes from Story A's existing CHANGELOG line. This report uses word-form Issue citations only.

### 8. State and log bookkeeping

- `docs/.maat-state.json`: `scope` is `s1-226-duplicate-field`; `priorScope` deep-equals the previous top-level state on master minus `adrCatalog` (JSON equality: true); top-level `adrCatalog` is identical to master (36 ADRs). Key order (`note_2026-09-19d`, `priorScope`, `adrCatalog`) and nesting match the previous transitions. The 764/753 line churn is the re-indent from nesting one level deeper; ignoring whitespace it is 11 added lines, the same shape as the previous story transition (762/751).
- `docs/run-log.jsonl`: one added line, `tier-ratified`, proposed = ratified = STANDARD, `changed:"false"`, well-formed, same field set as the s1-227 line. No `story-shipped` yet: that is the Manager post-review close-out, as it was for the previous story.
- Definition of Done items that belong to the Manager close-out and are not yet present: `docs/STATE.md` update and the `story-shipped` run-log event. Consistent with the plan and with the s1-227 separate wrap-up commit. Not a finding.

### 9. CHANGELOG claims vs diff

- "one block per test file": true (each test file gets one appended block).
- "marker test file gained a mirrored `withNonGitDir` helper and a `dirname` import": true.
- "no existing test line edited": true for every test; the diff does rewrite one existing line, the `node:path` import, which the sentence next clause discloses. See Editorial 2.
- "`src/lib/git.ts`, `completeness-claim-checker.ts`, allowlist, CI workflow untouched": verified (check 1).
- "non-zero exit, nothing on stdout": verified (check 4).

## Coverage gaps

| Part of the diff | Claimed by a lane? | Note |
|---|---|---|
| `src/qa/*.ts` and their tests | code-reviewer | correctness, test design |
| `CHANGELOG.md` prose accuracy | no lane | covered here (check 9); QA-15 passes |
| `docs/.maat-state.json`, `docs/run-log.jsonl` | no lane | covered here (check 8) |
| `docs/plans/s1-226-duplicate-field-phase1-2026-09-19.md` | no lane | plan doc, no runtime effect, intentionally low-risk; its expected-diff list matches the real diff |
| Untracked root `prompt` file | n/a | outside the diff; never staged |

## Findings

None open. No ISSUE, no SUSPICION. No GitHub Issue filed: there is no `[ISSUE][HIGH|MED]`, and the positional-argv observation in check 3 is not a demonstrated defect and is out of scope.

## Editorial (verdict-neutral, plain edits, no re-review)

1. `docs/.maat-state.json` `note_2026-09-19d` still reads "PROPOSED STANDARD ... Awaiting Manager ratification", yet the run-log `tier-ratified` line (19:41:02Z, earlier than the 15:45:56 -0400 state commit) is in the same commit. The two previous notes were rewritten to "ratified unchanged" when persisted. Reword at the Manager close-out.
2. `CHANGELOG.md` new entry, Tests bullet: "no existing test line edited" is stricter than the diff, which rewrites the `node:path` import line. The next clause discloses the `dirname` import, so nothing is hidden. Reword to "no existing test edited" or leave it.
3. `CHANGELOG.md` line 46 (Story A entry) says Issue #226 "stays its own Issue". True when written; it is history and append-only, so do not edit.

## Verdict and next action

**APPROVE.** Single next action: after code-reviewer's verdict lands, the Manager closes out the story (STATE.md wrap-up, `story-shipped` run-log line, Editorial 1); push, PR and merge stay human-only.

RECEIPT: verdict=APPROVE
findings (ALL of them, one terse line each, ranked by blast radius):
1. [CLEAN][demonstrated] whole-catalog ADR pass (36 ADRs): no collision; SE-0003/0005/0010 satisfied (pure validators, one import line the only removed test-file line, 76 pass 0 skipped, no suppression); kernel/plugin/data/IaC ADRs not applicable
2. [CLEAN][demonstrated] sensitive-area boundary: name-only grep of the diff against hooks, guard, .github, secret-scan, docs/qa, git.ts, completeness-claim-checker.ts returns NONE; STANDARD holds
3. [CLEAN][demonstrated] other consumers of the argv contract: KNOWN_INSTRUMENTS has 5 entries each with one --field=; package.json, workflows, cmd= markers have zero hits; QA-15 checker PASS; no live caller can trip the new throw
4. [CLEAN][demonstrated] no third twin: grep for args.find / startsWith("--x=") argv parsers over src, hooks, scripts finds only the two probes (flag-catalog.ts is shell-token parsing, not CLI argv); the other argv readers are positional, boolean-includes, or file-list
5. [CLEAN][demonstrated] mutation claims independently reproduced on a scratch copy for BOTH probes: M1 3 red, M2 2 red, M3 1 red, restored byte-identical; matches CHANGELOG exactly
6. [CLEAN][demonstrated] real invocations at repo root: valid --field= exit 0; duplicate (distinct, identical, bad+good) exit 1 with empty stdout; existing bad-value message unchanged; same channel as the Issue #173/#179 gate
7. [CLEAN][demonstrated] QA-14 red on master (Issue #229): 7 failures, none from a line this diff adds (0 hits per failing string in whitespace-insensitive added lines)
8. [CLEAN][demonstrated] state and log bookkeeping coherent: priorScope deep-equals previous state minus adrCatalog, adrCatalog identical, key order and chain match prior transitions, one well-formed tier-ratified run-log line; churn is re-indent only (11 lines with -w)
counts (a CHECKSUM — MUST equal the lines listed above): issues=0 suspicions=0 clean=8
evidence (a CHECKSUM over the tags above): demonstrated=8 code-traced=0 derived=0
checks=node --test (marker-corpus-probe + continuation-residual-probe + completeness-claim-checker) 76 pass / 0 fail / 0 skipped; mutation sets both probes: baseline 20 and 25 pass, M1 3+3 red, M2 2+2 red, M3 1+1 red, restored clean; tsc --noEmit clean; eslint on 4 changed src files clean; QA-15 PASS; QA-14 exit 1 (7 pre-existing, 0 from added lines); full npm test not rerun (code-reviewer lane)
adr=HIT(36, whole catalog)
report=docs/reviews/s1-226-duplicate-field-cross-domain-2026-09-19.md
