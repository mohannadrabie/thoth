# #308 story F (AP-10 deny rules, F4, F8/#411) - application security review

[app-security-reviewer] Horus. CRITICAL tier. Diff `e9c1638..9e238c5` (HEAD 9e238c5). HELD behind THOTH-ADR-0003 (PROPOSED; not a finding).
📊 ADR cache HIT: reused 38 ADR(s) from catalog [CACHE=HIT]. No applicable security ADR standard violated by the diff.

Method: read at the commit; own detached worktree with node_modules junction. Ran `node src/qa/protected-path-list.ts` (PASS, 41 paths) and `node --test` on activation-preconditions, shell-redirect-decorates, path-canonical tests (15 pass / 0 fail / 0 skipped). Probed the real committed rules with a script (kernel `decide`) for each path form.

## Verdict: APPROVE-WITH-CONDITIONS

Exposure today is 0% of requests: F8 makes every redirect write unresolved, so POL-05 denies before any F path rule is consulted (known, ruled). The findings below are gaps that become reachable when E0 (#408) adds a producer set. None is a bypass today; none blocks the held merge, but 1-3 should be fixed or recorded before E0.

## Findings (ranked)

1. MED, demonstrated. Directory-level moves/deletes bypass file-keyed rules. `src/qa/protected-path-list.ts:155-157` (`buildDenyRules`) emits only exact-file targets; kernel match is exact or `/`-prefix (`kernel.ts:~136`). Probe: write verb to `hooks`, `hooks/`, `src/policy`, `src/policy/config`, `.thoth` -> `allow`. Attack: `mv hooks hooks.bak` then a recreated `hooks/` (or `mv src/policy ...`) once a producer resolves `mv`. Fix: add deny rules for move/rename/delete (and modify) with exact targets `hooks`, `src/policy` (and each parent dir of a protected file), `.thoth`. Test: `F-parent-dir-move-denied`.
2. MED, demonstrated. Windows name aliases are not canonicalized (`path-canonical.ts:12-29`). Probe (all `allow`): `src/policy/config/loader.ts.`, `...loader.ts ` (trailing space), `loader.ts::$data`, `loader.ts:x`. On Windows (this host) these open the protected file. Not in the disclosed "does not do" list (only 8.3 names are). Fix: strip trailing dots/spaces per segment and cut `:stream` suffix (or treat any target segment containing `:` / trailing `.`/space as unresolved). Test: `F4-windows-alias-forms`.
3. MED, code-traced. `docs/qa/tool-inventory.json` is read by the hook at runtime (`builtin-tool-inventory.ts:48,66`; `classification-catalog.ts:136`) but is not on the list; the named list is hand-typed with no instrument proving "read-by-path files" complete (CLAUDE.md completeness rule). Effect as traced: a bad edit throws (gate exit 2) or drops a name (SUR-03 halt): availability, not bypass, because class comes from the code map. Fix: add it to `namedPaths`, and add a scan for `readFileSync`/`existsSync` path literals in the import graph that fails if the file is not on the list. Test: `F2b-runtime-read-files-are-protected`.
4. LOW, code-traced. The proposed `Edit(...)` deny covers only built-in file tools (upstream documents that Read/Edit rules do not constrain Bash subprocesses). Test header says this for the fixture, but CHANGELOG ("K's Edit(...) deny will" protect the policy file) and the K proposal do not; once E0 lands, Bash writes depend on the gate path rules alone, which findings 1-2, 5 weaken. Say so in CHANGELOG/K note.
5. LOW, demonstrated. Glob targets (`src/policy/config/lo*`, `*.ts`, `loader.t?`) are recorded literally and match no rule (probe: allow). E0 must mark any target containing glob metacharacters, `$`, or backtick unresolved. Test: `F4-glob-target-unresolved`.
6. LOW, code-traced. `PROTECTED_VERBS` is a typed list; no test asserts it covers the kernel's mutating vocabulary. Today `KNOWN_VERBS` is closed (`action-catalog.ts:20-33`): `chmod`, `ln`/symlink/hardlink, `truncate`, `cp`, `tee` have no verb, so they are unresolved and POL-05 denies. If E0 adds verbs (`chmod`, `link`, `truncate`) the deny list silently misses them. Test: `F-protected-verbs-cover-mutating` (every KNOWN mutating verb except `execute` is in PROTECTED_VERBS).
7. LOW suspicion, derived. Edit() patterns follow gitignore matching; case sensitivity on Windows for Write-tool paths is undocumented. Verify in K with `Edit(/Src/Policy/...)` on Windows.

## Clean (verified)
- Canonicalizer injection/ReDoS: pure string split, linear; probe with 4M-segment and 5M-backslash inputs ran in 523 ms total (demonstrated). No eval/regex.
- Loader levers: hook imports only relative and `node:` specifiers (generator throws otherwise); Node ignores `tsconfig*`; `package.json` / `node_modules` / `.node-version` are not read by the hook path. A stray `package.json` can break a load (exit 2), not weaken a decision (code-traced, not run). Launcher interpreter (PATH `node`) is the launcher's own disclosed limit.
- F5 proposal syntax: `Edit(/path)` is project-root relative, `~/` home, `/**` for directory, and Edit applies to Write/MultiEdit/NotebookEdit (upstream permission docs; derived). Generator output equals committed file.
- Disclosure: CHANGELOG and test header honestly state inert `mandatory`, defence in depth until E0, absolute/`$VAR`/symlink/8.3 gaps.

## Blockers vs hardening
Blockers: none. Hardening: 1-7.

## Next action
Land findings 1-3 (three small tests plus rules/canonicalizer lines) before E0, then request re-review of the generator.

## Editorial
- Plan said "41 paths"; the count line is generated (PASS output), fine.

Findings = failing tests: 6 open issue findings, 6 named tests (finding 4 is prose-only: no executable form; finding 7 is a K-time check).

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][MED][demonstrated] src/qa/protected-path-list.ts:155 - parent directories (hooks, src/policy, .thoth) have no move/delete deny; probe allows; add dir-target rules
2. [ISSUE][MED][demonstrated] src/policy/normalizer/path-canonical.ts:12 - trailing dot/space and ADS (::$data) forms of a protected file are allowed on Windows; canonicalize or mark unresolved
3. [ISSUE][MED][code-traced] src/policy/tools/builtin-tool-inventory.ts:48 - docs/qa/tool-inventory.json read at gate runtime but not protected; no instrument for read-by-path completeness (availability impact)
4. [ISSUE][LOW][code-traced] CHANGELOG.md / K proposal - Edit() deny does not cover Bash writes; not disclosed beside the K claim
5. [ISSUE][LOW][demonstrated] src/policy/normalizer/shell.ts:372 - glob-metacharacter redirect targets recorded literally, match no rule; E0 must mark unresolved
6. [ISSUE][LOW][code-traced] src/qa/protected-path-list.ts:38 - PROTECTED_VERBS not pinned against the mutating vocabulary; chmod/ln/truncate have no verb today (POL-05 covers)
7. [SUSPICION][LOW][derived] K proposal - Edit() case sensitivity on Windows paths unverified
8. [CLEAN][demonstrated] path-canonical.ts linear, no ReDoS/injection (4M segments, 523 ms)
9. [CLEAN][code-traced] loader levers: package.json/tsconfig/node_modules/.node-version not decision inputs; imports are relative/node: only
10. [CLEAN][derived] F5 Edit(...) syntax correct and covers Write/MultiEdit/NotebookEdit
counts: issues=6 suspicions=1 clean=3
evidence: demonstrated=4 code-traced=4 derived=2
checks="15/0/0"
adr=HIT(38)
report=docs/reviews/s308-F-deny-app-security-2026-10-05.md
HEAD: 9e238c5
