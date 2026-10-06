# App security re-confirm, round 2: s308-K0 (#308 K stage 0) and s308-452 (#452 extraction check)

[app-security-reviewer] Horus. Tier CRITICAL. HEAD 9767b05, worktree review/r2-as. Date 2026-10-05.
Round 1: docs/reviews/s308-K0-app-security-2026-10-05.md (APPROVE-WITH-CONDITIONS; MED #456, LOW #3).
ADR: 📊 ADR cache BUILT: cataloged 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3], catalog now current (fp da6ef03) [CACHE=HIT]. No applicable-ADR violation found in the delta.

## Verdict: APPROVE-WITH-CONDITIONS (no blockers; hardening only)

## Re-confirmed by execution

### 1. #456 certifiers protected: FIXED (demonstrated)
- protectedPaths(root).all = 117 paths and contains all six (k-settings-merge.ts, k3-edit-deny-covers-fixture.ts, k5-pretooluse-entry-uses-launcher.ts, k-readiness.ts, cc-extraction-covers-judged.ts, docs/plans/s308-K-proposed-entry-2026-10-05.json). Probe: all 117 ... :true for each.
- npm run qa:protected-path-list: PASS, 117 protected paths, committed rules and proposal match the generator.
- shipped-defaults.json: 137 rules, 136 protect-*; unmatchedPaths(rules, all) returned []. Through the shipped kernel decide, each of the six denies all six verbs (write, create, modify, delete, move, rename). Each rule has one exact target (no prefix, no trailing slash).
- Over-matching: every existing file under src/qa and docs/plans was probed with a write; denied-but-not-in-protected-list was []. Controls allowed: k-readiness.ts.bak, k-readiness.test.ts, k3.ts, a neighbour dated 2026-10-06, a new src/qa/new-file.ts, k-readiness.ts/x.
- Edit side: the fixture carries Edit(/src/qa/...) for the five scripts and Edit(/docs/plans/s308-k-proposed-entry-2026-10-05.json); qa:protected-path-list proves the proposal matches the generator.
- Real hook probe (hooks/pretooluse-kernel-gate.mjs; redirect, rm, touch, cp, mv, tee, sed -i; upper-case, ./, absolute, backslash, .. forms): every call denied. Disclosure, as in round 1: every Bash write is denied by POL-05 fail-closed (redirect decorates a command that does not resolve / command binary not recognized), and unprotected controls get the same denial, so the Bash probe proves fail-closed, not rule matching. Rule matching is proven by the direct decide probe above. Separator and case variants are the normalizer job (kernel targets are exact canonical lowercase), as for the other 111 protected paths.

### 2. LOW #3 gh --repo pin: FIXED, one hardening note (demonstrated)
Probe of parseGithubRepo over 29 crafted origins. Rejected (fail closed): credentials in URL, github.com.evil.com, a host spliced after an at-sign following github.com, evil.com/github.com/o/r, extra path, query, fragment, whitespace and newline injection, ../. segments, git://, file://, upper-case host, percent escapes, empty. Accepted: https/http/scp-ssh/ssh:// github.com forms with exactly owner/name and optional .git. The repo is a separate argv element after --repo, so a value such as o/--repo or -o/r (allowed by the character set) is the flag value and cannot add arguments. Unresolvable origin (git non-zero, null status, non-GitHub URL, credentialed URL): row k-blocker-issues FAIL with a fixed message that does not echo the URL; a token in the URL (probe used SECRETTOKEN) never reaches output. GH_REPO is ignored because --repo is explicit. git remote get-url is allow-listed by assertReadOnly; spawn is spawnSync with an argv array and a 180 s timeout.
Residual (LOW): the pin trusts origin; there is no expected-repo constant, so a changed origin yields PASS for another repo k-blocker label. Mitigations: .git/ is protected in the main clone, and the PASS detail prints repo owner/name for the human. A linked worktree .git file is the disclosed #442 gap.

### 3. #452 discovery executes binaries from unprotected home locations (code-traced + demonstrated)
- Good: execFileSync(binary, ["--version"], { timeout: 10000, encoding, windowsHide }), no shell option anywhere in the file (grep), argv array, 10 s bound. PATH is split on the platform delimiter and each entry stat-ed (firstFile); no shell, no which; empty entries skipped. The live PATH had 0 relative entries.
- Gap: the executed set is THOTH_CLAUDE_BIN, ~/.local/bin, newest ~/.local/share/claude/versions/x.y.z, newest ~/.vscode, ~/.vscode-insiders and ~/.cursor extension dirs, and every PATH dir. None of those home directories is in the protected list (the ~/ entries are .claude/*, shell rc files, gitconfig and powershell profile dirs only). Newest is chosen by a version parsed from the directory NAME, which the writer controls. Demonstrated with a throwaway fake HOME holding two extension dirs (2.1.289 and a planted 99.0.0, both copies of node.exe): the version provider was invoked for exactly the planted claude-code-99.0.0 binary and not the legitimate one (the planted one also hides it). Before this delta nothing executed the binary (git show 79f0b44: has no execFileSync), so the execution is new.
- Attack sketch: a session that can write under the home directory plants a higher-numbered extension dir with an executable claude.exe; the human next qa:k-readiness runs it as the human.
- Exposure: ~0% of runs today, basis: assumption (needs a session write to the home directory, not measured). Basis assumption caps this at LOW; the permitted recommendation is "measure it". Cheap fix if the human wants it closed: add ~/.local/bin/, ~/.local/share/claude/, ~/.vscode/extensions/, ~/.vscode-insiders/extensions/, ~/.cursor/extensions/ to namedPaths (the generator regenerates the rules), or execute only the first two trusted dirs.
- Also LOW: a relative entry in PATH (for example a dot) would resolve claude.exe in the cwd (the session-writable repo root). Skip non-absolute PATH entries.

### 4. Secrets/PII in the final line: CLEAN with note (code-traced)
The CC-extraction-covers-judged line prints each binary full path (so the OS username), version and counts; no secret, no env values; failure text is the version call e.message only. It goes to the human terminal. Usernames already appear in earlier committed review reports, so this is not a new class. This report quotes no home path.

## Other observations
- LOW (code-traced): the one mixed-case protected path, docs/plans/s308-K-proposed-entry-2026-10-05.json, is emitted lower-case (Edit(/docs/plans/s308-k-...), fixture line 180). On a case-sensitive filesystem the lower-case Edit glob may not match the real file name; Windows and macOS are case-insensitive. The kernel rule is fine (normalizer lower-cases). Cure: rename the file lower-case, or measure Edit-rule case sensitivity in probe P-K4.
- Tests: six delta test files, 88 tests, 87 pass, 1 fail, 0 skipped. The failure is CC-extraction-covers-judged/installed-live (installed extension binary 2.1.289, judgment 2.1.267): the intended red, tracked as #463, not a regression. qa:k3 and qa:k5 print their expected not-yet-wired FAIL lines.

## Blockers vs hardening
Blockers: none. Hardening: the four LOW items.

## Findings to failing tests (all LOW, no Issue filed)
1. discoverClaudeBinaries does not execute a binary under an unprotected home dir (or: the five ~/ dirs are in namedPaths).
2. PATH="." is skipped.
3. blockerRow fails when origin differs from the expected owner/name.
4. Edit entry case equals the on-disk file name.

## Editorial
None.

## Single next action
Manager: record APPROVE-WITH-CONDITIONS; the human decides whether to add the five home directories to the protected list before the readiness run is trusted (same generator).

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][LOW][demonstrated] claude-code-write-deny-extract.ts discoverClaudeBinaries runs --version on binaries from ~/.local, ~/.vscode*/extensions, ~/.cursor (newest chosen by dir name), none in protected list; planted 99.0.0 chosen in probe; Exposure ~0% basis assumption; protect those dirs
2. [ISSUE][LOW][code-traced] discoverClaudeBinaries PATH loop accepts a relative PATH entry (cwd claude.exe); skip non-absolute entries
3. [SUSPICION][LOW][code-traced] k-readiness resolveRepo trusts origin with no expected-repo constant; mitigated by protected .git/ and repo printed in PASS detail
4. [ISSUE][LOW][code-traced] only mixed-case protected path s308-K-proposed-entry-2026-10-05.json is emitted lower-case in Edit(...) (fixture line 180); may not match on a case-sensitive FS
5. [CLEAN][demonstrated] #456: six certifier paths in protectedPaths (117), unmatchedPaths [], each denied on all 6 verbs via shipped decide; no over-match; qa:protected-path-list PASS
6. [CLEAN][demonstrated] gh --repo pin: 29 crafted origins, creds/host-spoof/extra-path/injection rejected, fail-closed row, URL not echoed, GH_REPO ignored, argv-array spawn
7. [CLEAN][code-traced] execFileSync argv array, no shell, 10 s timeout; PATH resolution by stat, shell-free
8. [CLEAN][code-traced] final line prints binary paths (username) to local terminal only; no secrets
counts: issues=3 suspicions=1 clean=4
evidence: demonstrated=3 code-traced=5 derived=0
checks=87/1/0 (88 tests in 6 delta files; the 1 fail is the intended installed-live red, #463)
adr=HIT(38)
HEAD: 9767b05
report=docs/reviews/s308-K0-452-app-security-round2-2026-10-05.md
