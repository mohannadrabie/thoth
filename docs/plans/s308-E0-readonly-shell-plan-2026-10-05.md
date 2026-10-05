# Phase 1 plan (refreshed): #308 story E0 (Issue #408), closed read-only shell command set

Date: 2026-10-05. Author: story-implementer (Ptah). Branch `s7/knockout` (cut from `origin/master` 6f78aee, which contains merged E, F, J). Phase 1 only: nothing built, nothing committed; this file is the only file written.
`📊 ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog (fp 63531e7) [CACHE=HIT]`
Supersedes (does not delete) `docs/plans/s308-E0-readonly-shell-plan-2026-10-04.md`. Inputs: that plan, the design challenge (`docs/reviews/s308-E0-readonly-shell-design-challenge-2026-10-04.md`, go-conditional), Issues #408/#409/#410, and the Manager's scope ruling 2 (last row of `docs/decisions.md`).

## 0. Restatement and what changed since the 2026-10-04 plan

Restated: teach the shell normalizer a CLOSED, enumerated set of read-only commands (six binaries, see section 3) that resolve to verb `read` or `list`, exactly one target, empty `unresolved`; every other Bash input still reaches POL-05 unresolved and is denied.

Readiness: all material facts are known; the Manager's ruling settles the four open decisions of the old plan. No blocking question remains (section 8 lists confirmations with recommended answers).

Refresh against current `src/policy/normalizer/shell.ts` (512 lines now, after F), facts that change the old plan:
- F9/F9b/F10 landed. `resolveKubectlShape` now fails closed on a binary outside `RESOLVABLE_BINARIES` (`["kubectl"]`), and on any flag outside `KUBECTL_GRAMMAR_FLAGS`. So today `ls -la` is unresolved for TWO reasons (binary not recognized, flag not in the closed set), not one. E0 must be claimed BEFORE `resolveKubectlShape` and must not widen `RESOLVABLE_BINARIES` (that set is the kubectl grammar's; reusing it for read commands would let `ls get pods/x --context=c` run the kubectl path).
- F8 landed: a redirect never replaces the command it decorates; a redirect-decorated non-resolving command is `verbs:[write]`, canonical target, `unresolved:[REDIRECT_DECORATES_UNRESOLVED]`. E0 claims only redirect-free commands, so `cat a > f` keeps exactly this F8 record (pinned).
- F4 landed: `path-canonical.ts` exports `canonicalizePathTarget` and `pathFormIssue`; E0 reuses them (no second canonicalizer). This closes the old plan's "E0 records verbatim until F lands" caveat and decides the challenge's A3.
- Order inside `normalizeAtDepth` now: heredoc strip, `collectSyntaxUnresolved`, tokenize, `scanFlags` (which sets `directoryFlagFound`), early return on any syntax cause or directory flag, `detectWrapper` plus the F9b bare-name check, `resolveWrapperMatch`, then `resolveKubectlShape`. E0's single call site goes between `resolveWrapperMatch` and `resolveKubectlShape`, guarded: `depth === 0 && wrapper === undefined`.
- Consequence of the directory-flag pre-gate: `-d` and `-C` (single letter, also `-C=x`, `-d=x`) make the whole command unresolved BEFORE E0 runs. So `ls -d` and `grep -C n` can never be resolved by E0 without touching that gate; both are dropped from the grammar and pinned as unresolved (`RO-directory-flag-preempts`).
- Wrapper catalog (`wrapper-catalog.ts`) covers bash/sh, eval, exec, nohup, source/`.`, env, xargs, at, crontab. `nice`, `timeout`, `stdbuf`, `command`, `builtin`, `sudo`, `time` are NOT in it; they are refused today only because the first token is not a table binary (F9). E0 keeps that property: the binary decision is exact equality on the RAW first token against E0's table, so every wrapper (catalogued or not) is unresolved, and a test generates the wrapper name list from the ruling plus `WRAPPER_BINARY_NAMES`.
- `shell-scanner.ts` tokenizer core already tracks each token's `end`; `tokenizeWithOffsets` drops it. E0 needs raw spans, so an additive export is needed (no behavior change).

## 1. ADR review (mandatory gate, re-run)

Catalog read via `node docs/adr-cache.mjs --ensure` (38 ADRs). Same verdicts as the 2026-10-04 plan, restated at the rule level; no new ADR since.

| ADR | Verdict | Rule this story must honor |
|---|---|---|
| SE ADR-0021 (accepted) | APPLICABLE | POL-05: "The kernel MUST deny a mutating action whose Action record has `source: opaque` or a non-empty `unresolved` array." E0 resolves only a whole command it fully understands. POL-12: "No story may add a second decision path"; E0 is a data catalog consumed by the registered `shell` normalizer, zero change to `kernel.ts` / `registry.ts`. INT-07: do not trust the model's claim that a command is read-only; E0 parses the shape itself. |
| SE ADR-0003 SOLID | APPLICABLE | New module `readonly-catalog.ts` (one reason to change: the grammar table, same shape as `wrapper-catalog.ts`); `shell.ts` gains one call site, not an if-ladder. |
| SE ADR-0005 testing | APPLICABLE | Tests with the feature; a locked test that flips is replaced as a recorded act. Expected flips: none (section 6). |
| SE ADR-0006 blast radius | APPLICABLE | Closed set, closed flag lists per command, operand cap of 1; unknown flag means unresolved. |
| SE ADR-0010 quality gates | APPLICABLE | Typecheck, lint, coverage on the new module. |
| SE ADR-0016/0019/0020 | APPLICABLE (light) | `shell.ts` and the new module are guard lane; fresh dated review reports before ship. |
| THOTH-ADR-0001 (accepted) | APPLICABLE | The command table is a typed data constant, not a policy classification; no env var selects anything; the central-classification fixture is untouched. |
| THOTH-ADR-0003 (now accepted) | NOT-APPLICABLE | E0 touches no fixture or policy file; the 2026-10-05 acceptance released the hold. |
| THOTH-ADR-0002 (proposed), all other SE/DevOps ADRs | NOT-APPLICABLE | No data, infra, tagging, cost or secret-scan surface. |

No UNCLEAR ADR. ADR=HIT(38).

## 2. Acceptance criteria (D = derived)

1. `READONLY_COMMANDS` lists exactly `ls cat head tail wc grep` (section 3); any other binary is not claimed by E0.
2. For each listed command, a redirect-free, wrapper-free invocation whose every token matches that command's closed grammar yields `source:"parsed"`, `verbs` = `["list"]` (ls) or `["read"]` (others), `targets` = exactly one canonical path (`canonicalizePathTarget` of the operand, or `.` for an implicit current directory), `unresolved: []`, `deferred: false`.
3. Any token outside the grammar (unknown flag, long flag, `--`, extra operand, forbidden shape) means the command is NOT claimed: it falls through and ends unresolved (POL-05 deny). No partial claims.
4. The #82 multi-target cap stays (ruling 2, closes #410's premise): E0 never emits a record with 2 or more targets; a command with 2 or more path operands (`cat a b`, `grep p a b`) is unresolved with the existing multi-target message (one enforcement point, `shell.ts`). The write and kubectl shapes' cap behavior is byte-identical. (Derived from the ruling, not from the old plan's Q2(b).)
5. Binary identity: the RAW first token must be exactly a table name: no path, no uppercase, no `.exe`/`.cmd`, no quoting or backslash (raw span equals the dequoted value). `normalizeToolToken` is never used for this decision.
6. Wrappers: any command whose first token is a wrapper (catalogued or not: `env sh -c bash xargs command builtin exec nice nohup timeout stdbuf time sudo` and the rest of `WRAPPER_BINARY_NAMES`) is unresolved as a whole (ruling 2). E0 is never invoked at recursion depth greater than 0, so `bash -c 'ls'` is not resolved through SUR-09's deferred path either.
7. `git` (every subcommand and every option position) and `rg` are NOT in the set: unresolved, POL-05 denies, until #409 seals the config and env levers (ruling 2). `git diff|show|log -p` likewise. See section 3.1 for the status/log decision.
8. Syntax pre-emption (D, load-bearing regression pin): chain operators, pipes, `;`, `&`, newline, substitution, backtick, process substitution, directory flags, redirects (either direction), here-docs, here-strings and env-assignment prefixes keep the behavior they have today: unresolved, or for a redirect-decorated command exactly the F8 record.
9. Operand rule (decides challenge A3): a path operand must be BARE: its raw span equals its dequoted value, with no quote, backslash, `$ ` + "`" + ` * ? [ ] { } ~ ! # < > | & ; ( )`, whitespace, control byte or non-ASCII character, and must not start with `-`. The recorded target is the canonical form of that single string, so the screened string and the recorded string are the same string. `pathFormIssue` causes pass through into `unresolved`.
10. Pattern rule (decides challenge A4): grep's pattern slot (the first non-flag operand, or the value of `-e`) is accepted as either a bare word obeying criterion 9's character set, or a SINGLE-quoted span (inert to the shell) with no `'`, control byte or newline inside, not starting with `-`. Double-quoted and unquoted metacharacter patterns are refused. So `grep '[0-9]' f` and `grep 'a.*b' f` resolve; `grep * f`, `grep "$x" f`, `grep [0-9] f` do not. The pattern is not a target.
11. Numeric flag values (`-n 20`, `-c 100`, `-A 3`, `-B 3`, `-m 5`) match `^[0-9]{1,6}$`.
12. `kernel.ts`, `registry.ts`, `action-catalog.ts`, `target-format.ts`, `hooks/pretooluse-kernel-gate.mjs`, `shipped-defaults.json`: zero diff, shown by a script, not claimed by hand.
13. End to end through the real hook with the real shipped defaults: `ls -la`, `cat README.md`, `grep -rn foo src`, `head -n 20 README.md`, `tail -n 5 CHANGELOG.md`, `wc -l README.md` return allow; `git status` stays deny (documented, pinned); every bypass-corpus row returns deny. Run before and after, both recorded.
14. Existing normalizer fixtures and tests pass unmodified; no locked test is edited.
15. A read of a protected path (`cat .thoth/policy.json`) resolves to a read record carrying the canonical protected path as target and is allowed by F's deny rules (they deny write-class only); every write form to the same path stays denied (D, reads free, writes protected).

## 3. Closed command set and justification

Per-command grammar: tokens are checked left to right against a closed flag list (short flags only; no long flags, no `--`; a cluster like `-la` is accepted only when every letter is listed and none takes a value). Exactly one path operand maximum (criterion 4).

| Cmd | Verb | Allowed flags | Operand | Why it is in, and why it is safe |
|---|---|---|---|---|
| `ls` | list | `-a -A -l -h -1 -t -r -S -F -R` | 0 or 1 path; none means target `.` | Most common read; metadata only; runs no helper program. `-d` excluded (pre-empted by the directory-flag gate); long flags (`--color`, `--hyperlink`) excluded for simplicity. |
| `cat` | read | `-n -b -s -A -E -T -v` | exactly 1 path; bare `-` refused | Pure file read to stdout. No-operand (stdin) and `-` refused so the target is never hidden. |
| `head` | read | `-n <int>`, `-n<int>`, `-c <int>`, `-q`, `-v` | exactly 1 path | Pure read. `-z`, `-<int>` form refused. |
| `tail` | read | same as head (no `-f`, `-F`, `--follow`, `--pid`, `-s`) | exactly 1 path | Pure read; follow modes refused (they block the session; not a gate issue but not a read). |
| `wc` | read | `-l -w -c -m -L` | exactly 1 path | Pure read. `--files0-from` refused (silently adds read targets). |
| `grep` | read | `-i -n -r -R -l -L -c -v -w -x -F -E -H -h -I -o -s -q`, `-A <int>`, `-B <int>`, `-m <int>`, `-e <pattern>` | pattern (unless `-e`), then 0 or 1 path; no path only with `-r`/`-R` (target `.`) | The agent's main search tool once rg is out. Runs no helper program. `-f` (pattern file, an unrecorded read), `-P`, `--include`/`--exclude-from`, `-C` (directory-flag gate) refused. |

Explicitly OUT of E0 v1 (so it is never read as accidental; each is a one-line data addition once its own risk is settled):
- `git` entirely, `rg` entirely (ruling 2, #409).
- `find` and `sed -n 'Np'`: dropped from the 2026-10-04 set. Their grammars are the largest bypass surface (`-exec -execdir -ok -delete -fprint*`, sed `w r e` commands) and the headline cases do not need them. Narrower set preferred in doubt; backlog Issues for the Manager to file.
- `pwd`, `echo`, `which`, `file`, `stat`, `du`, `df`, `env`, `printenv`, `less`, `more`, `awk`, `tree`, `jq`, `curl`, `ps`, `npm`, `node`, `tsc`, `type`, `dir`.

### 3.1 Decision: `git status` and `git log` (no `-p`) are OUT

Evidence:
- Challenge A1 (code-traced from documented git semantics): `git status` runs `core.fsmonitor`; `log -p`/`diff`/`show` run textconv and external diff; and the challenge's Q1 view says "status+log only narrows but does not close it (`status` still runs fsmonitor; `log -p` still runs textconv)" and that the write-protect-`.git/config` mitigation is necessary-not-sufficient (global/system/ambient config, pre-planted config, env levers like `GIT_CONFIG_GLOBAL` are uncovered).
- Measured this session by Ptah (read-only probe, throwaway repo in the scratchpad, not the project tree): with `core.fsmonitor` set in the repo config to a script that creates a marker file, a plain `git status -s` created the marker (script count 1). So a command with ZERO flags executes a config-named program: the closed flag list cannot neutralize it, and no flag list ever could. Same probe for `git log` with `log.showSignature=true` and `gpg.program` set to a marker script: marker NOT created (the commit was unsigned), and a non-tty `core.pager` did not run either. So the `git log` lever is NOT measured positive here; it is documented-but-unmeasured (pager on a tty, `log.showSignature` on a signed commit, textconv under `-p`).
- Both are explicit scope items of #409 (open), whose sealing (git/rg config and env) is the stated precondition for resolving them.

Ruling applied: `git status` is out (measured exec lever, no flag neutralizes it). `git log` (no `-p`) is out too: not measured exec on this probe, but unmeasured is not safe, the lever set (pager, signature program, textconv, mailmap) is config-driven exactly like status, and the Manager's instruction is to prefer the narrower set in doubt. Neither carries a "flag lever" E0 could defer, because the levers are config and environment, which E0 cannot see; deferral to #409 means: when #409 seals them, a data-addition story adds `git status|log` with a RED test that first flips from unresolved to resolved as a recorded act.

Headline impact, stated plainly for the human at K: `git status` stays denied after E0 until #409. #408's title lists `git status`; E0 closes `ls`, `cat` and the read/search commands, not git. The Manager may want a comment on #408 saying so.

Residuals disclosed, not closed, to state in the PR:
- #428 (HIGH, open, K blocker): user PATH directories are session-writable, so an allowed bare `ls` or `cat` can run a planted binary. This is the same limit for every bare-name command and is NOT E0's to fix; E0 does not add a new instance (no new binary class) but widens the set of allowed bare names, so K stays held on #428.
- Shell aliases/functions named `ls` etc. are invisible to a static parse.
- "Read freely" plus resolved targets means `cat .env` and `cat ~/.aws/credentials` style reads are allowed by design (`~` is refused by criterion 9, so the home-relative form is unresolved; a project-relative `.env` resolves). Per the challenge's Q4: a read-deny for secrets is a security precondition of activation, tracked as an Issue (Manager to file), not built here.
- Challenge A5 (pre-existing, not E0): `cmd > unlisted-path` is allowed under `defaultOutcome=allow`; routed to the activation posture. Not changed here.

## 4. Compound-command handling (current code)

Policy unchanged from the old plan: E0 claims only a whole simple command. Nothing is split per segment.
- Chains, pipes, `;`, `&&`, `||`, newline, `&`, substitution, backtick, `<(` `>(`, directory flag: already unresolved before E0 runs (`normalizeAtDepth` early return). E0's call site is after that return, so it cannot weaken it. Mutant `RO-mutant-claim-before-syntax-check` pins the placement.
- Redirects: E0 refuses any command with a live redirect operator or any `<` token; `findLiveRedirectOperatorPositions` / `extractRedirectTargets` are reused. `cat a > f` keeps its F8 record. `2>&1` on a read command is not newly allowed (backlog).
- Here-docs/here-strings: E0 requires `bodies.length === 0` and no `<`.
- Env prefixes: token 0 is not a table name, so nothing is claimed.
- Wrappers: guarded by `wrapper === undefined`, and by `depth === 0` so a wrapper's inner command is never resolved by E0 (ruling 2; also removes the challenge's Q3 hazard that `pol05Rule` ignores `deferred`).

## 5. Tests, written failing first (named checks per criterion)

New: `src/policy/normalizer/readonly-catalog.test.ts` (unit, table-driven; examples derived from the table at run time), `src/policy/normalizer/readonly-fixture-snapshot.test.ts`, `hooks/pretooluse-kernel-gate-readonly.test.ts` (real hook, real shipped defaults, same harness style as `pretooluse-kernel-gate-f-round3-probes.test.ts`), `src/policy/fixtures/readonly-corpus.ts` (shared corpus rows for unit and hook). RED recorded in the first commit message before `readonly-catalog.ts` or the call site exist.

### 5.1 Day-1 failing proof-tests from the design challenge (names as in the challenge)

| Challenge test | Form in this plan | State at RED |
|---|---|---|
| `RO-rg-config-env-exec` (A1) | With `RIPGREP_CONFIG_PATH` set in the hook's environment to a file containing `--pre=<marker script>`, `rg p` through the real hook returns DENY and the marker script never runs. Green because rg is out of the set. Companion `RO-git-config-exec-unresolved`: `git status` with `core.fsmonitor` planted returns DENY and no marker (this is the measured lever from 3.1). | RED today? Both already deny today (unresolved, kubectl-shaped), so they are PINS that must stay green: written first, expected GREEN at RED, and they are what a later #409 story must flip as a recorded act. The failing-first tests of E0 are the accept tests below. |
| `J-env-block-runtime-keys-block` extended to `GIT_EXTERNAL_DIFF GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM GIT_CONFIG_COUNT/KEY/VALUE GIT_PAGER RIPGREP_CONFIG_PATH` (A1) | NOT built in E0: with git and rg out, E0 resolves no binary whose behavior those keys change, so the extension has no subject. Handed to #409 as its day-1 test (comment on #409 to record it). E0 adds the instrument `RO-table-excludes-config-exec-binaries` instead: a pinned list (`git rg less man more vi vim nano ssh curl wget find sed awk perl python node npm`) must have no key in `READONLY_COMMANDS`; a new table entry from that list fails until triaged. | RED (table does not exist) |
| `RO-multitarget-read-no-bundling` (A2, #410) | Two layers: normalizer: `cat docs/a.md /etc/shadow` and `grep p a b` are unresolved with the multi-target message and `targets.length < 2`; kernel-level: with a target-scoped read ALLOW rule on a filesystem path (`docs/`), the same call through the real normalizer plus kernel is NOT allowed. | RED (cat is unresolved today for a different cause; the test asserts the multi-target cause, so it fails until E0 exists and caps) |
| `RO-target-canonical-form-pinned` (A3) | Pins the recorded string for `cat ./x`, `cat a/../b`, `cat 'x'`, `cat a"b"c`: bare-span rule means the quoted forms are unresolved, the bare forms record `canonicalizePathTarget(operand)`, and the screened string equals the recorded string (asserted by property over the corpus). | RED |
| `RO-grep-pattern-metachar-decision` (A4) | Accept: `grep '[0-9]' f`, `grep 'a.*b' f`, `grep -e 'x|y' f`, bare `grep foo f`. Reject: `grep * f`, `grep [0-9] f`, `grep "$x" f`, `grep "a.*b" f`, `grep '-x' f`, `grep -f p f`. | RED |

### 5.2 Criterion map

| Criterion | Named checks |
|---|---|
| 1 | `RO-table-closed` (exported keys equal the pinned list `ls cat head tail wc grep`); `RO-table-has-no-wrapper` (no key in `WRAPPER_BINARY_NAMES` or the ruling's wrapper list); `RO-table-excludes-config-exec-binaries` |
| 2 | `RO-accept-<cmd>-<shape>` generated from the table's example list, at least one per flag per command; `RO-implicit-dot-target` (`ls`, `grep -r p`); asserts verbs, targets, `unresolved: []`, `deferred: false` exactly |
| 3 | `RO-reject-unknown-flag-<cmd>` (`ls -Z`, `ls --color`, `cat -x`, `grep -P`, `grep -f x`, `head -z`, `tail -f`, `wc --files0-from=x`), `RO-reject-double-dash`, `RO-reject-long-flag`, `RO-reject-missing-operand` (`cat`, `head -n 5`, `grep p` without `-r`), `RO-reject-bare-dash` |
| 4 | `RO-multitarget-read-no-bundling` (above), `RO-write-cap-unchanged` (existing Issue #82 tests, unmodified), `RO-one-target-only` (property: no E0 record ever has 2+ targets) |
| 5 | `RO-B01a..d`: `./cat x`, `/usr/bin/cat x`, `CAT x`, `cat.exe x`, `cat.cmd x`, `'c'at x`, `c""at x`, `\cat x` |
| 6 | `RO-wrappers-unresolved` generated over the ruling list plus `WRAPPER_BINARY_NAMES` (`env ls`, `sh -c 'ls'`, `bash -c 'ls'`, `xargs cat`, `command ls`, `builtin ls`, `exec ls`, `nice ls`, `nohup ls`, `timeout 5 ls`, `stdbuf -o0 ls`, `time ls`, `sudo ls`), `RO-wrapper-inner-read-not-deferred` (`bash -c 'cat README.md'` is unresolved, not a deferred read), existing SUR-09 tests unmodified |
| 7 | `RO-git-family-unresolved`: `git status`, `git log`, `git log -p`, `git diff`, `git show`, `git -c core.pager=x log`, `git -C /tmp status`, plus `RO-rg-family-unresolved`: `rg p`, `rg --pre cat p`, `rg -z p` |
| 8 | `RO-B02..B12` (chains, pipes, newline, `&`, `$()`, backtick, `<()`, redirects, here-doc, here-string, env prefix, `LD_PRELOAD=x ls`), `RO-directory-flag-preempts` (`ls -d`, `grep -C 3 p f`, `grep -C=3 p f`, `-d=x`), `RO-redirect-fixtures-unchanged` (every redirect fixture in `normalizer-calls.ts` deep-equals a snapshot generated by a script on the UNMODIFIED tree and committed in the RED commit), `RO-f8-redirect-record-unchanged` (`cat a > f` is still `write`, canonical target, F8 cause) |
| 9 | `RO-B-glob/tilde/var/brace/bang` (`cat *.md`, `cat a?`, `cat [ab]`, `cat {a,b}`, `cat ~/x`, `cat $HOME/x`, `cat "$HOME"`, `cat $'\x2f'`, `cat a\ b`, `cat !$`, `cat #x`, `cat 'a b'`, `cat "a"`, `cat C:\x`, `ls .\x`, unicode lookalikes, NUL/control bytes, `cat -- -x`, a flag-named path), `RO-target-canonical-form-pinned` |
| 10 | `RO-grep-pattern-metachar-decision` |
| 11 | `RO-int-cap` (`head -n 99999999 f`, `head -n x f`, `-A -1`) |
| 12 | `RO-zero-diff-guard`: script `git diff --stat origin/master -- <six files>` is empty, output pasted into the PR (the instrument, not a hand claim) |
| 13 | `RO-e2e-allow-<cmd>` generated from the table (one per command plus the headline set), `RO-e2e-git-status-still-deny`, `RO-e2e-corpus-deny` (every corpus row through the real hook asserts DENY with the POL-05 reason or the rule id), run before and after |
| 14 | Full existing suite green with real counts (skipped is not passed) |
| 15 | `RO-protected-read-allowed` (read of `.thoth/policy.json`, `src/policy/config/shipped-defaults.json`, `docs/qa/s5-central-classification.json`, `hooks/pretooluse-kernel-gate.mjs` through the real hook: allow); `RO-protected-write-denied` (`echo x > P`, `cat a >> P`, `ls > P`, `cat a b > P`: deny, unchanged) |

Bypass corpus (every row unresolved/deny, each a named test): B-01 binary identity, B-02..B-12 chains/substitution/redirect/env/wrapper rows as in the 2026-10-04 plan section 5 (minus the git/rg/find/sed rows, which are now covered wholesale by `RO-git-family-unresolved`, `RO-rg-family-unresolved` and a generated `RO-out-of-set-unresolved` over `find sed awk less curl tee cp mv rm`), B-17 `tail -f`, `tail -F`, `cat -`, `cat`, `wc --files0-from=x`, B-18 operand shapes, B-19 unterminated quotes, B-20 Windows forms (`type README.md`, `dir`), B-22 100 KB operand and 10k tokens unresolved within the existing work meter (reuse the `shell-scanner-work` harness; no wall clock).
Mutants (each must fail a named test; hand-written in-test mutants as F3 does if no harness fits): `RO-mutant-use-normalizeToolToken`, `RO-mutant-skip-redirect-check`, `RO-mutant-claim-before-syntax-check`, `RO-mutant-claim-inside-wrapper` (drop the `depth === 0`/`wrapper === undefined` guard), `RO-mutant-lift-multitarget-cap`, `RO-mutant-add-git-to-table`, `RO-mutant-widen-RESOLVABLE_BINARIES` (adds `ls` to the kubectl set: `ls get pods/x --context=c` must stay unresolved).

## 6. Risk tier and interactions

Proposed tier: CRITICAL. One line: it is the guard's classification input in the S4 shell normalizer (a CLAUDE.md sensitive area: policy enforcement/guard, `src/policy/*`), and it decides what flips from deny to allow, so over-claiming is a fail-open on the enforcement point. Required review chain: red-team (owns the corpus and mutants), app-security-reviewer (injection, bare-span rule), architecture-reviewer (catalog shape, POL-12, and the read-surface scope question the challenge routed under PRINCIPLES rule 15), cross-domain-reviewer (always). Fresh dated reports in `docs/reviews/` before ship. Exposure today is 0% live (gate unwired, K held), which is why the challenge capped at MED, but tier follows blast radius, not exposure. The Manager ratifies the tier.

Locked tests: none expected to flip (every existing `cat`-shaped fixture carries a redirect and is not claimed). If one flips it is replaced as a recorded act, own commit plus decisions row. Interaction with E/F/J: E's allow rules are verb-only and carry no targets; F's deny rules deny write-class verbs only, so read records of protected paths pass (criterion 15). No interaction with J beyond the shared hook.

## 7. Files to touch

New: `src/policy/normalizer/readonly-catalog.ts` (typed data table plus pure matcher, no I/O, no env), `src/policy/normalizer/readonly-catalog.test.ts`, `src/policy/normalizer/readonly-fixture-snapshot.test.ts`, `hooks/pretooluse-kernel-gate-readonly.test.ts`, `src/policy/fixtures/readonly-corpus.ts`, the pre-change redirect-fixture snapshot (script plus committed JSON).
Edited: `src/policy/normalizer/shell.ts` (one import, one guarded call site, header-comment entry; the multi-target cap applied to E0's result through the existing `multiTargetMessage`), `src/policy/normalizer/shell-scanner.ts` (additive: export each token's raw `end`; existing scanner tests unmodified), `CHANGELOG.md`; Manager: `docs/STATE.md`, `docs/decisions.md` row.
Zero diff: `kernel.ts`, `registry.ts`, `action-catalog.ts`, `target-format.ts`, `hooks/pretooluse-kernel-gate.mjs`, `src/policy/config/shipped-defaults.json`, `wrapper-catalog.ts`, `RESOLVABLE_BINARIES`. `package.json`: none.
Sensitive areas touched (named reviewer reports needed): `src/policy/normalizer/*` is guard-lane code under `src/policy/*`; `hooks/pretooluse-kernel-gate.mjs` is NOT edited but is exercised end to end by the new hook test, so its zero-diff is a recorded check. Not touched: evidence trail, secret scanning/CI, policy delivery, halt-state.

## 8. Test-first dispatch check

New or changed UI flow or API surface? No. The hook's stdin/stdout contract is unchanged; the change is which Bash commands the internal normalizer resolves, observable externally only as allow versus deny of ordinary Bash. `test-writer` is NOT dispatched; Ptah writes the named tests above failing first and records RED in the first commit. The Manager may overrule and dispatch `test-writer` for the corpus; if so Ptah will not edit its files.

## 9. Blocking questions

No question blocks the build. Confirmations the Manager can answer in one line (the human is away; recommended answers given):
1. Drop `find` and `sed -n` from v1 along with git/rg (set = `ls cat head tail wc grep`)? Recommend YES (narrower in doubt; they are the largest grammar surface and the headline cases do not need them). If the Manager wants them, they come back as separately reviewed data additions, not in E0.
2. Comment on #408 that `git status` stays denied after E0 until #409 seals the levers, and record the J-env-block extension as #409's day-1 test? Recommend YES.
3. File backlog Issues (Manager): `find`/`sed` read grammars; `pwd`/`echo`; `2>&1` on reads; multi-operand reads (`cat a b`) under a proven cap-lift (needs `RO-multitarget-read-no-bundling` green with a scoped read-allow); read-deny for secrets (elevated: activation precondition per the challenge's Q4). Recommend YES.
4. E0 may merge independently of K (no wiring, no runtime effect until K); PR states "K held; git/rg out until #409". Recommend YES.

## 10. Verification, rollout, rollback

- Per commit: typecheck, lint, the three new test files, the full suite with real counts, QA-14 in CI diff mode (`reference-resolver.ts origin/master HEAD`, per the user's standing rule), and the zero-diff script output pasted.
- Spike (PRINCIPLES 17/18): the only measured numbers are the git `fsmonitor` and `log` lever probe (done this session, section 3.1) and the work-meter bound on a 100 KB input (B-22, first build task, before the plan is called final for that criterion). No latency claim: the matcher is linear string work with no I/O.
- Rollout: local branch, no wiring until K, no runtime effect. Rollback: revert the `shell.ts` call-site commit; the catalog is then dead code and ordinary reads return to unresolved (deny). No data migration.

## 11. Single next action

Manager confirms (or accepts the recommended answers to) section 9 and ratifies CRITICAL; Ptah starts Phase 2 with the RED commit (table, corpus, accept tests, pins; redirect snapshot generated on the unmodified tree first).

RECEIPT: verdict=BLOCKED criteria="15 mapped/15 total" checks="0/0/0 (plan only; one read-only git lever probe in the scratchpad)" adr=HIT(38) pr=n/a

## 12. Deviations recorded at build (Phase 2, 2026-10-05)

- The separate bypass-corpus test file was folded into `readonly-catalog.test.ts` (corpus rows live in `src/policy/fixtures/readonly-corpus.ts`); the pre-change snapshot test is `readonly-fixture-snapshot.test.ts` and covers all shell fixtures, not only the redirect ones.
- `shell-scanner.ts` is NOT edited: raw token spans are derived in `shell.ts` from `tokenizeWithOffsets` (a new scanner export failed the old-versus-current differential and the path sweep instruments).
- `src/policy/config/shipped-defaults.json` and `docs/plans/s308-K-proposed-settings-2026-10-04.json` changed after all, by generation (`node src/qa/protected-path-list.ts --write`): `readonly-catalog.ts` joins the hook's import graph, so `qa:protected-path-list` requires a generated mandatory deny rule for it. Criterion 12's zero-diff list is otherwise held.
- Criterion 15's shipped-rules check runs in-process (`normalize` plus `decide` over the real shipped rules) inside `hooks/pretooluse-kernel-gate-readonly.test.ts`; the hook sandbox itself uses empty rules.
- Mutants are in `src/qa/shell-detector-mutants.ts` (8 added; 68 of 68 killed). Two plan mutants are equivalent by defense in depth and were not added: skipping the redirect check (a redirect token already fails the bare-path rule) and swapping in the path-stripping binary check (the table lookup still fails).
- Corpus: a single-quoted backtick or dollar in a grep pattern is inert, so a pattern containing one moved from deny to accept.
- `RO-git-config-exec-unresolved` (a planted-config companion) was not built as a separate test: the hook never executes the command, so it would add nothing beyond `RO-e2e-git-status-still-deny`. The #409 comment names it; read it as pointing at that test.
