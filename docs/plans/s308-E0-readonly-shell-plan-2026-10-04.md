# Phase 1 plan: #308 story E0 (Issue #408), closed read-only shell command set

Date: 2026-10-04. Author: story-implementer (Ptah). Branch `s308/activation-3`. Phase 1 only: nothing built, no file other than this one touched.
`📊 ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog (fp 702b16a) [CACHE=HIT]`
Parent plan: `docs/plans/s308-activation-EFJ-plan-2026-10-04.md` (Q1 option B). Criteria source for E/F: `docs/plans/s308-activation-phase0-2026-10-02.md` section 3.

## 0. Restatement and readiness

Restated: teach the shell normalizer a CLOSED, enumerated set of read-only commands and argument shapes, resolved to verb `read` or `list` with resolved targets and an empty `unresolved`, so the wired gate lets ordinary reads through, while every other Bash input still reaches POL-05 unresolved and is denied.

Readiness: enough is known to plan. Four decisions need the Manager (section 8); each has a recommended answer, and none blocks writing the failing tests for the core set.

Reproduced facts (read from `src/policy/normalizer/shell.ts`, 455 lines, no probes needed beyond the parent plan's spike):
- Order inside `normalizeAtDepth`: heredoc strip, syntax checks (unterminated quote, chain operator `; && || | newline &`, trailing-sensitive separators, `$(` backtick `<(` `>(`), directory flag, wrapper detection (SUR-09: bash -c, eval, exec, nohup, source, env, xargs, at, crontab), then `resolveKubectlShape`. Chains, substitution, newline and `&` therefore already return `unresolved` before any new branch could run. E0 inherits that and must be inserted AFTER all of it.
- `resolveKubectlShape` treats token 2 as the verb and needs `--context`; that is why `ls -la` is unresolved today.
- Redirect shapes (`cat payload > /tmp/ok`, fixtures at `src/policy/fixtures/normalizer-calls.ts` lines 172-510) all start with `cat` and carry a redirect. They resolve (as write) or deny today and MUST stay byte-identical. E0 only claims a command with NO redirect.
- Hazard found in reading: `normalizeToolToken` strips any path prefix and lowercases, so `./cat`, `/tmp/evil/cat`, `CAT` all look like `cat`. E0 must NOT use it for the binary decision (bypass B-01 below).
- Hazard: `tokenizeWithOffsets` returns dequoted values and a start offset only. Quote information is lost, so `ls '*'` and `ls *` look the same. E0 needs the raw token text (the tokenizer core already tracks `end`; export it additively).

## 1. ADR review (mandatory gate)

| ADR | Verdict | Rule this story must honor |
|---|---|---|
| SE ADR-0021 (accepted) | APPLICABLE | POL-05: "The kernel MUST deny a mutating action whose Action record has `source: opaque` or a non-empty `unresolved` array." E0 resolves only what it fully understands and leaves the rest unresolved. POL-12 open registry: "No story may add a second decision path"; "growing this list is a data addition". E0 is a data catalog consumed by the already registered `shell` normalizer, with zero change to `kernel.ts` and `registry.ts`. INT-07: "MUST NOT assume a third party's enforcement is correct where thoth can verify it directly"; E0 does not trust the model's own claim that a command is read-only; it parses the argument shape itself. |
| SE ADR-0003 SOLID (accepted) | APPLICABLE | New module `readonly-catalog.ts` (one reason to change: the command grammar table), same shape as `wrapper-catalog.ts`; `shell.ts` gains one call site, not an if-ladder. |
| SE ADR-0005 testing (accepted) | APPLICABLE | Tests with the feature; any locked test that flips is replaced as a recorded act (own commit, decisions row). Expected flips: none (see section 6, R1). |
| SE ADR-0006 blast radius | APPLICABLE | Closed set, per-command closed flag lists, caps on operand count; unknown flag means unresolved. |
| SE ADR-0010 quality gates | APPLICABLE | Typecheck, lint, coverage on the new module. |
| SE ADR-0016 / ADR-0019 / ADR-0020 (self-protection, fidelity) | APPLICABLE (light) | `shell.ts` and the new module sit in the guard lane; changes need a fresh dated review report. Not a port, so no fidelity work. |
| THOTH-ADR-0001 (accepted) | APPLICABLE | Hardcode ban: the command table is a typed data constant with a comment, not a policy classification; no env var selects anything. The fixture is untouched. |
| THOTH-ADR-0003 (proposed) | NOT-APPLICABLE to E0's content; HOLD applies to merge ordering | E0 does not touch the fixture. Because the activation chain is held on the human accepting ADR-0003, E0 is built on the local branch and its PR states "HELD: THOTH-ADR-0003 not accepted". Gate stays write-free: E0 adds no write. |
| THOTH-ADR-0002 (proposed) | NOT-APPLICABLE | Secret-scan allowlist. |
| SE ADR-0002/0004/0007-0009/0011-0015/0017/0018, all DevOps ADRs | NOT-APPLICABLE | No data, infra, tagging or cost surface. (0017 and 0018 are superseded.) |

No UNCLEAR ADR.

## 2. Acceptance criteria (D = derived)

1. A fixed command table `READONLY_COMMANDS` lists exactly the commands in section 3; any other binary is not claimed by E0.
2. For each listed command, an invocation whose every token matches that command's closed grammar yields `source: "parsed"`, `verbs` = one of `read`/`list`, `targets` = the operand paths as written (or `.` for an implicit current directory), `unresolved: []`, `deferred: false`.
3. An invocation with any token outside the grammar (unknown flag, extra operand, forbidden shape) is NOT claimed: it falls through to the existing path and ends `unresolved` (POL-05 deny). No partial claims.
4. Any chain operator, pipe, `;`, `&`, newline, substitution, backtick, process substitution, redirect (either direction), here-doc, herestring, or env-assignment prefix keeps the command unresolved or, for a redirect, exactly the behavior it has today. (D, load-bearing: stated as a regression pin.)
5. The binary token must be a bare lowercase word equal to a table entry: no path qualification, no quoting tricks that change meaning, no backslash.
6. `xargs`, `env`, `sudo`, `time`, `nohup`, `command`, `builtin`, `exec` and every other wrapper stay out of the closed set; wrapper detection keeps its existing precedence.
7. Operands containing shell expansion characters (`$ ` + "`" + ` \ * ? [ ] { } ~ ! # < > | & ; ( )`) are not claimed, quoted or not (conservative; the tokenizer loses quote info, so E0 reads the raw span).
8. The multi-target cap (Issue #82) behavior for write and kubectl shapes is unchanged; read records follow the decision in Q2.
9. `kernel.ts`, `registry.ts`, `action-catalog.ts`, `target-format.ts`: zero diff. (D, mirrors the S4 ruling.)
10. End to end through the real hook with the real shipped defaults: `ls -la`, `cat README.md`, `git status` return allow; the full bypass corpus (section 5) returns deny. Run before and after, both recorded.
11. Existing normalizer fixtures and golden tests pass unmodified (no locked test edited).
12. A protected-path READ resolves to a read record carrying that path as target; every write form to the same path is still denied (interaction with F, section 6).

## 3. Proposed command set and argument grammar

General: tokens after the binary are classified left to right by a per-command spec: flag (from a closed list, with optional value shape), operand (path or pattern with a shape), or end-of-options `--` (allowed only where listed). Short flags may be clustered only when every letter is in the allowed set and none takes a value (value flags must be last in the cluster or separate). A value shape is a regex (`int` = `^[0-9]{1,6}$`). Anything unmatched fails the whole command (criterion 3). Operand count caps: 8 path operands.

| Cmd | Verb | Allowed flags | Operands | Explicitly refused (examples) |
|---|---|---|---|---|
| `ls` | list | `-a -A -l -h -1 -d -t -r -S -F -R` (clusterable) | 0..8 paths; none means target `.` | `--` long flags other than none, `-I`, `--color` (kept out for simplicity), `--hyperlink` |
| `cat` | read | `-n -b -s -A -E -T -v` | 1..8 paths; bare `-` refused | no operand (stdin), `-` |
| `head` | read | `-n <int>`, `-n<int>`, `-c <int>`, `-<int>`, `-q`, `-v` | 1..8 paths | no operand, `-z` |
| `tail` | read | same as `head` | 1..8 paths | `-f -F --follow --pid -s` (blocks the session) |
| `wc` | read | `-l -w -c -m -L` | 1..8 paths | `--files0-from` (silently adds read targets), no operand |
| `grep` | read | `-i -n -r -R -l -L -c -v -w -x -F -E -H -h -I -o -s -q`, `-A/-B/-C <int>`, `-m <int>`, `-e <pattern>` | pattern (unless `-e`) then 0..8 paths; no path allowed only with `-r/-R` (target `.`) | `-f` (pattern file), `--include`/`--exclude-from` (kept out), `-P` |
| `rg` | read | `-i -n -l -c -v -w -F -H -I -o -s -q --hidden -uu`-free list: `-i -n -l -c -v -w -F -H -o -s -q --hidden`, `-A/-B/-C <int>`, `-m <int>`, `-g <glob>` out | pattern then 0..8 paths (none: target `.`) | `--pre`, `--pre-glob`, `-z`, `--search-zip` (spawn decompressors), `--hostname-bin`, `--config-path`, `--files-from`-style flags, `-f` |
| `find` | list | predicates: `-name -iname -path -ipath <glob-literal>`, `-type f|d|l`, `-maxdepth <int>`, `-mindepth <int>`, `-size <[+-]int[ckMG]>`, `-mtime/-mmin <[+-]int>`, `-empty`, `-print`, `-print0` | 1..8 start paths first, then predicates; `-not`/`!` refused with the rest of the operator set (parentheses, `-o`, `-a`) | `-exec -execdir -ok -okdir -delete -fprint -fprint0 -fprintf -fls -newer -samefile -L` and any predicate not listed |
| `sed` | read | exactly `-n` plus one script operand matching `^(\$|[0-9]+)(,(\$|[0-9]+))?p$` | 1..8 paths | `-i`, `--in-place`, `-e`, `-f`, `-s`, `-E`, any script with `w r e s y` commands or pattern addresses |
| `git` | read | see below | see below | any option BEFORE the subcommand: `-c`, `-C`, `--git-dir`, `--work-tree`, `--exec-path`, `--paginate`, `-p`, `-P`, `--no-pager` (all refused, global options precede the subcommand) |

`git` subcommands (first token after `git` must be the subcommand; four only):
- `git status`: `-s --short -b --branch --porcelain` (value-less) and `--` pathspecs. Refused: `--ignore-submodules` family, `-u` variants, anything else.
- `git log`: `--oneline --graph --decorate --no-decorate --stat --name-only --name-status -p --patch --all`, `-n <int>`, `-<int>`, `--max-count=<int>`, `--pretty=oneline|short|medium|full`, `--format=oneline|short|medium|full`, revision operands matching `^[A-Za-z0-9][A-Za-z0-9._/~^@{}-]{0,127}(\.\.\.?[A-Za-z0-9][A-Za-z0-9._/~^@{}-]{0,127})?$`, `--` then pathspecs.
- `git diff`: `--stat --name-only --name-status --cached --staged --no-color -U<int> -p --patch`, revision operands as above, `--` pathspecs. Refused: `--output`, `--output=*` (writes a file), `--ext-diff`, `--textconv`, `--no-index` (reads arbitrary files outside the repo), `--open-files-in-pager`/`-O`, `--exit-code` kept out.
- `git show`: `--stat --name-only --name-status --no-color -p --patch --oneline`, one revision operand (including `rev:path` is refused in v1), `--` pathspecs.
- Targets for git: the repository working directory `.` plus each pathspec after `--`. Revision operands are not targets (they are not paths). Disclosed: `git show HEAD:path` is refused in v1 so the target is never hidden inside a revision operand.
- Not in the set (explicit): `git branch`, `checkout`, `config`, `fetch`, `grep`, `ls-files`, `rev-parse`, `remote`, `stash`, `tag`, `blame`, `reflog`, anything else. Backlog if wanted.

Not in the set, stated so it is never read as accidental: `pwd`, `echo`, `which`, `file`, `stat`, `du`, `df`, `env`, `printenv`, `less`, `more`, `awk`, `tree`, `jq`, `curl`, `ps`, `npm`, `node`, `tsc`. (`echo`/`pwd` are zero-risk candidates; adding is a one-line data change later, recommended as backlog, not gold-plated here.)

Residuals disclosed, not closed (state in the PR):
- Git runs config-driven helpers: `core.fsmonitor` (run by `git status`), `diff.<driver>.textconv` and external diff drivers (run by `git diff`/`log -p`/`show`). The closed flag list blocks the flags, not a planted config. Mitigation owned by story F: add `.git/config`, `.git/hooks/`, `.gitattributes` to the protected-write list (recommend; needs Manager OK, see Q4).
- A shell alias or function named `ls`, `cat`, etc. is invisible to static parsing. The gate cannot see the user's rc files. Disclosed; same limit as every other static parse.
- Reads of secrets (`cat .env`, `~/.aws/credentials`) become allowed by design ("read freely"). Because targets are now resolved, a later read-deny rule can express them. Out of scope; filed as backlog.
- Operand paths are recorded verbatim; canonicalization (case, `\`, `./`, `..`) is Q2-A in story F. E0 reuses F's helper when it lands (no copy). Until then, a read of `./.thoth/policy.json` carries that raw string, which is harmless because no read-deny rule exists.

## 4. Compound-command handling

Policy: a command is claimed only if the WHOLE text is one simple command whose every token matches. Nothing is split and re-evaluated per segment in E0 (per-segment evaluation is the larger mechanism the S4 council declined). Concretely:
- Pipes, `;`, `&&`, `||`, newline, trailing or inline `&`: already `unresolved` from `collectSyntaxUnresolved` before E0 runs. E0 is called after that gate so it cannot weaken it. Pinned by tests B-02..B-09.
- `$(...)`, backticks, `<(`, `>(`: same, unresolved before E0.
- Redirects `>`, `>>`, `&>`, `2>&1`, `<`: E0 refuses to claim any command with a live redirect operator (`extractRedirectTargets` non-empty or any `<` token). Existing handling continues unchanged: `cat payload > /tmp/ok` still resolves as write to `/tmp/ok`. `2>&1` on a read command is therefore NOT newly allowed in v1 (backlog; common, but fd-dup handling is a distinct risk).
- Here-docs and herestrings: E0 requires `bodies.length === 0` from `stripHeredocBodies` and refuses any `<` in operands. `cat <<EOF` and `cat <<< x` stay on the existing path.
- Env prefixes (`FOO=1 ls`, `PAGER=evil git log`, `GIT_EXTERNAL_DIFF=x git diff`): token 1 must be exactly a table binary, so an assignment token is not a table entry and nothing is claimed.
- `xargs`: caught by wrapper detection earlier; also not in the set. `find ... | xargs` is a pipe anyway.
- Nested wrappers: `bash -c 'ls -la'` goes through `resolveWrapperMatch`, whose inner command is normalized by the same function, so E0 can resolve the inner read and return it with `deferred: true` (existing SUR-09 semantics). Decision in Q3. Test pinned either way.
- Insertion point: in `normalizeAtDepth`, after `resolveWrapperMatch` returns undefined and before `resolveKubectlShape`, one call `resolveReadOnly(raw, offsetTokens, liveText, bodies)` that returns `ActionRecord | undefined`; undefined falls through to current behavior. Everything E0 does not return is exactly as before.

## 5. Tests, written failing first

New files: src/policy/normalizer/readonly-catalog.test.ts (unit, table-driven; names derived from the table at run time), src/policy/normalizer/readonly-bypass-corpus.test.ts (corpus), src/policy/config/readonly-gate.e2e.test.ts (real hook, real shipped defaults, `node hooks/pretooluse-kernel-gate.mjs`, same harness style as the existing gate tests). RED recorded in the first commit message before `readonly-catalog.ts` or the `shell.ts` call site exist.

| Criterion | Named checks |
|---|---|
| 1 | `RO-table-closed`: the exported table keys equal a pinned expected list (a new command fails the test until triaged); `RO-table-has-no-wrapper` asserts no key equals a name in the wrapper catalog |
| 2 | `RO-accept-<cmd>-<shape>`: for every accepted shape in section 3 (generated from the table's own example list, at least one per flag and per subcommand), assert verbs/targets/unresolved/deferred exactly. `RO-implicit-dot-target` |
| 3 | `RO-reject-unknown-flag-<cmd>` for each command (`ls -Z`, `cat -x`, `grep -P`, `find -foo`, `git log --bogus`), plus `RO-reject-extra-operand`, `RO-reject-operand-cap-9` |
| 4 | `B-02..B-12` below; `RO-redirect-fixtures-unchanged`: every fixture in `normalizer-calls.ts` that has a redirect produces a record deep-equal to a snapshot taken from the pre-change code (snapshot generated by a script run on the unmodified tree, committed in the RED commit) |
| 5 | `B-01a..d` binary-identity bypasses |
| 6 | `RO-wrappers-unchanged`: SUR-09 wrapper tests pass unmodified; `B-xargs`, `B-env` |
| 7 | `B-glob`, `B-tilde`, `B-var`, `B-brace`, `B-history-bang` |
| 8 | `RO-write-cap-unchanged` (existing Issue #82 tests, unmodified); read cap per Q2 |
| 9 | `RO-zero-diff-guard`: a script check (`git diff --stat origin/master -- <four files>` empty) recorded in the PR; the real instrument, not hand-claimed |
| 10 | `RO-e2e-allow-ls`, `-cat`, `-git-status`, and one allow per command in the table (generated); `RO-e2e-corpus-deny` runs every corpus row through the real hook and asserts DENY with the POL-05 reason (or the rule id where a rule fires) |
| 11 | Full existing suite green with real counts (skipped is not passed), recorded |
| 12 | `RO-protected-read-allowed` (read of `.thoth/policy.json`, `src/policy/config/shipped-defaults.json`, `docs/qa/s5-central-classification.json`, `hooks/pretooluse-kernel-gate.mjs` through the real hook with F's deny rules loaded when F lands: allow); `RO-protected-write-denied`: for each form below, still deny |

Protected-path write forms asserted still denied (all through the real hook): `echo x > P`, `cat a >> P`, `tee P`, `sed -i s/a/b/ P`, `sed -n 'w P' f`, `cp a P`, `mv a P`, `rm P`, `git checkout -- P`, `find . -delete`, `git diff --output=P`, `rg --pre`-based, `ls > P`. Expected: all deny today (POL-05 unresolved) except plain redirect writes, which F's rules deny. The test pins E0 does not turn any of them into an allow.

### Bypass corpus (every row must be unresolved/deny; each is a named test, ids B-xx)

- B-01a `./cat README.md`; B-01b `/tmp/x/cat README.md`; B-01c `CAT README.md`; B-01d `'c'at README.md` and `\cat README.md` and `c""at README.md`.
- B-02 `ls; rm -rf x`; B-03 `ls && rm x`; B-04 `ls || rm x`; B-05 `ls | sh`; B-06 `ls\nrm x` (newline); B-07 `ls & rm x`; B-08 `ls $(rm x)`; B-09 `` ls `rm x` ``; B-09b `ls <(rm x)`; B-09c `cat "$(rm x)"` (substitution live in double quotes).
- B-10 `ls > /etc/x`, `cat a >> b`, `cat a 2>&1`, `cat < a`, `cat <<EOF\nx\nEOF`, `cat <<< x`, `ls >&-`.
- B-11 `FOO=1 ls`, `PAGER=x git log`, `GIT_EXTERNAL_DIFF=x git diff`, `LD_PRELOAD=x ls`, `A=$(x) ls`.
- B-12 `xargs cat`, `env ls`, `sudo ls`, `time ls`, `nohup ls &`, `bash -c "ls; rm x"`, `sh -c 'ls | tee f'`.
- B-13 find: `find . -exec rm {} \;`, `find . -delete`, `find . -fprint f`, `find . -fprintf f %p`, `find . -fls f`, `find . -ok rm {} \;`, `find . -execdir x {} +`, `find . -newer f`, `find . -not -name x` (operators refused).
- B-14 sed: `sed -i s/a/b/ f`, `sed --in-place=.b s/a/b/ f`, `sed -n 'w out' f`, `sed -n '1e touch x' f`, `sed -e 'w x' f`, `sed -n '/x/p' f` (pattern address refused), `sed -f script f`.
- B-15 git: `git -c core.pager=x log`, `git -C /tmp status`, `git --git-dir=x log`, `git --exec-path=x status`, `git log --output=f`, `git diff --output=f`, `git diff --ext-diff`, `git diff --textconv`, `git diff --no-index a b`, `git show HEAD:secret`, `git log --paginate`, `git -p log`, `git status --ignore-submodules=x`, `git branch -D x`, `git checkout x`, `git config --global core.x y`, `git log $(x)`, `git push`, `git log -- ';rm x'`.
- B-16 grep/rg: `grep -f patfile x`, `rg --pre cat x`, `rg --pre=x p`, `rg -z p`, `rg --search-zip p`, `rg --hostname-bin x`, `grep -P x f`, `grep` with no operand, `rg --files-with-matches --pre x`.
- B-17 cat/head/tail/wc: `tail -f log`, `tail -F x`, `cat -`, `cat` (no operand), `wc --files0-from=x`, `head -n x f`, `head -n 99999999 f` (int cap).
- B-18 operand shapes: `cat *.md`, `cat a?`, `cat [ab]`, `cat {a,b}`, `cat ~/x`, `cat $HOME/x`, `cat "$HOME"`, `cat $'\x2f'`, `cat a\ b`, `cat !$`, `cat #x`, `cat a;b` (inside one token), `cat 'a b'` (space; refused v1), `cat -- -x`, `cat \u2215`-style unicode lookalikes and NUL/control bytes, operand with a trailing newline inside quotes, 9 operands.
- B-19 unterminated quote `ls 'x`, `cat "x`.
- B-20 Windows forms: `type README.md`, `dir`, `cat C:\x` (backslash refused), `ls .\x`.
- B-21 flag injection by operand: `ls -- -la`-style and a path named like a flag are refused; `grep -e` with no value; `grep -- -x f`.
- B-22 length: 100 KB operand, 10k tokens: unresolved within the existing work meter (reuse `shell-scanner-linear` meter harness; no wall clock).
- Mutants (each must fail a test): `RO-mutant-allow-exec-flag` (add `-exec` to find's list), `RO-mutant-use-normalizeToolToken` (swap in the path-stripping binary check), `RO-mutant-skip-redirect-check`, `RO-mutant-claim-before-syntax-check` (move the call above `collectSyntaxUnresolved`), `RO-mutant-accept-global-git-option`. Run through the repo's existing mutation-gate pattern; if no harness fits, hand-written in-test mutants as F3 does.

## 6. Risk, tier, interactions

Tier: CRITICAL. Justification: it is the guard's classification input, it is the S4 shell normalizer ("historically highest-incident component", CLAUDE.md sensitive area: policy enforcement / guard), and it decides what turns from deny into allow. Over-claiming here is a fail-open on the enforcement point. Required reviewers: red-team (adversarial, owns the bypass corpus), app-security-reviewer (injection), architecture-reviewer (catalog shape, ADR-0021 POL-12), cross-domain-reviewer (always). Fresh dated reports in `docs/reviews/` before ship. Manager ratifies the tier.

R1. Locked tests: none expected to flip; all existing fixtures with `cat`/`ls`-shaped text carry redirects. If the suite shows a flip, it is replaced as a recorded act (SE ADR-0005), own commit plus decisions row.
Interaction with E: E's two allow rules stay as planned; with E0, the allow path is real for reads. E3/E-recorded tests unchanged. E depends on nothing in E0; E0 should merge first so the first activation build is usable. Interaction with F: F's rules deny only write-class verbs, so read records of protected paths pass; F's Q2-A path canonicalizer, when built, is consumed by E0 for operand targets (shared helper, built once; if F lands later E0 records verbatim). `.thoth/halt-state/` and the fixture remain readable, per "reads free, writes protected".

## 7. Files touched (planned)

New: src/policy/normalizer/readonly-catalog.ts (data table plus pure matcher, no I/O), `readonly-catalog.test.ts`, `readonly-bypass-corpus.test.ts`, src/policy/config/readonly-gate.e2e.test.ts, src/policy/fixtures/readonly-corpus.ts (shared corpus data, so unit and e2e use the same rows), a pre-change snapshot of redirect-fixture records.
Edited: `src/policy/normalizer/shell.ts` (one call site and import; header comment entry), `src/policy/normalizer/shell-scanner.ts` (additive: expose each token's raw `end`; no behavior change, existing scanner tests unmodified), `CHANGELOG.md`, `docs/STATE.md` (Manager), `docs/decisions.md` row (Manager, after ratification).
Zero diff: `kernel.ts`, `registry.ts`, `action-catalog.ts` (E0 uses only the existing verbs `read` and `list`), `target-format.ts`, `hooks/pretooluse-kernel-gate.mjs`, `shipped-defaults.json`.
`package.json`: none expected.

## 8. Blocking questions (ranked) with recommended answers

1. **Q1. Scope of git and the residual config-helper risk.** Accept `git status|log|diff|show` with the closed flag lists, disclosing planted-config helpers (fsmonitor, textconv, ext-diff), and add `.git/config`, `.git/hooks/`, `.gitattributes` to F's protected list? Recommend YES to both. Alternative: drop `diff` and `show` in v1 (leaves `status` and `log`), a smaller surface.
2. **Q2. Read records with several targets.** The Issue #82 cap denies any record with 2 or more targets because `kernel.ts` `matchesTarget` ORs across targets, which lets a narrow ALLOW authorize a bundled extra. For reads: (a) keep the cap, so `cat a b`, `grep x a b` are denied (simple, safest, annoying); (b) lift it for all-read records up to 8 targets. Recommend (b): shipped allow rules (E) carry no targets and V4 rejects target-only allows, a deny rule using `.some()` is conservative for multiple targets, and the cap exists for allow rules scoped by target. Needs a decisions row; kernel stays zero-diff. If the Manager prefers simplicity, (a) is a one-line change and E0 still delivers the headline cases.
3. **Q3. Nested `bash -c 'ls -la'`.** Existing SUR-09 recursion would resolve the inner read with `deferred: true`. Allow it (consistent, no new code), or force unresolved for any wrapper in E0 (safer, one extra guard)? Recommend allow only if the corpus rows `bash -c "ls; rm x"` and friends stay denied; otherwise force unresolved. Pin whichever is chosen with a test.
4. **Q4. Cross-story asks.** (i) F consumes or provides the shared path canonicalizer (parent Q2-A). (ii) Backlog items to file as Issues, not built: `pwd`/`echo`, `2>&1` support, read-deny for secrets, `git ls-files|rev-parse|branch --list`. Recommend as stated.
5. **Q5. Sequencing.** E0 before E's rule content and before J. Recommend yes. E0 can merge independently of ADR-0003 since it ships no rule data, but with no wiring (K unshipped) it has no runtime effect until activation; the PR still says "HELD with the activation chain".

If no reply: Q1 yes to both, Q2 (b), Q3 allow-with-corpus, Q4 as stated, Q5 yes.

## 9. Test-first dispatch check

New or changed UI flow or API surface? No. The hook's stdin/stdout contract is unchanged; the change is an internal normalizer behavior (which commands resolve), still externally visible only as allow versus deny of ordinary Bash. `test-writer` is NOT dispatched; Ptah writes the named tests above failing first, RED recorded in the first commit. The Manager may overrule and dispatch `test-writer` for the corpus; if so, Ptah does not edit its files.

## 10. Verification, rollout, rollback

- Per commit: typecheck, lint, the three new test files, the full suite with real counts, the QA-14 diff-mode resolver check, and the zero-diff instrument (git diff against the four named files, output pasted).
- Spike (PRINCIPLES 17/18): the one measured number is the nested-wrapper behavior and the existing work meter on a 100 KB input; both are measured by tests B-22 and Q3's pin before the plan is final. No latency claim is made (the matcher is linear string work, no I/O).
- Rollout: local branch, HELD, no wiring until K. Rollback: revert the `shell.ts` call site commit; the catalog file is then dead code and ordinary reads return to unresolved (deny). No data migration.

## 11. Single next action

Manager answers Q1-Q5 (or accepts the recommended answers), then Ptah starts Phase 2 with the RED commit.

RECEIPT: verdict=BLOCKED criteria="12 mapped/12 total" checks="0/0/0 (plan only; no commands changing state, read-only probes only)" adr=HIT(38) pr=n/a
