# s308-K0 + s308-452 app-security, round 3 delta re-confirm (2026-10-05)

[app-security-reviewer] Horus. Worktree C:\playground\thoth-r3-as, HEAD 92c25c5. Delta 6797646..92c25c5. Round 2: docs/reviews/s308-K0-452-app-security-round2-2026-10-05.md.
📊 ADR cache BUILT: cataloged 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3], catalog now current (fp da6ef03) [CACHE=HIT]
No applicable ADR security standard violated by this delta.

## Verdict: APPROVE-WITH-CONDITIONS (no blocker; hardening only)

## Re-confirmed by execution
1. Five new protected dirs (round-2 LOW 1 closed for the home install dirs). Probe through the shipped kernel decide (shipped-defaults.json, structured action, 6 verbs write/create/modify/delete/move/rename): the 5 dirs plus 5 deep targets (incl. ~/.vscode/extensions/anthropic.claude-code-99.0.0-win32-x64/resources/native-binary/claude.exe, same for vscode-insiders and cursor, ~/.local/bin/claude.exe, ~/.local/share/claude/versions/9.9.9). Output: `denied-checks 60 notDenied 0`. Controls all allowed: ~/.vscode/settings.json, ~/.local/share/other/x, ~/.local/binx/a, ~/.local/share/claudex/a, ~/.vscode/extensionsfoo/a, ~/.vscode/extensions-x/a, ~/.cursor/settings.json, ~/.local/state/x, and the Desktop path ~/AppData/Roaming/Claude/claude-code/9.9.9/x/claude.exe. Rules are the dir and dir/ pair (prefix match on the slash form, exact on the bare form), so no sibling over-match.
   `npm run qa:protected-path-list`: `PASS, 122 protected paths, committed rules and proposal match the generator`; unmatchedPaths [] (122). K3 on docs/qa/k-proposed-merged-settings.fixture.txt: `PASS: all 122 protected paths have their Edit(...) deny entries`; fixture lines 289-300 hold the ten Edit entries (dir and dir/**, five dirs). (K3 on the unwired real .claude/settings.json fails by design, as before.)
2. Relative PATH skipped (round-2 LOW 2, relative half closed). Probe with cwd containing rel/claude.exe, PATH=".;rel;": discovery returned only the Desktop probe binary, no PATH entry. PATH=".;<abs dir>" returned the absolute entry only. Absolute PATH entries are still executed (residual, see finding 1).
3. Desktop execution path: see finding 1.
4. execFileSync: installedClaudeVersion is execFileSync(binary, ["--version"], {timeout:10000, windowsHide:true}); argv array, no shell option, bounded. Real machine discovery: 7 binaries (local-bin, 3 versions, vscode, 2 desktop), discovery 4 ms. Worst case sequential 7 x 10 s = 70 s only if every binary hangs; normal run measured 2.1 s for one 80 MB binary incl. byte read. Acceptable.
   Test run (4 files): 60 tests, 59 pass, 1 fail, 0 skipped. The failure is CC-extraction-covers-judged/installed-live, the known installed-live-red state noted in ece6f9d (a real older/other installed binary now checked); it is the instrument working, not a regression in this delta.

## Findings
1. LOW (demonstrated): Claude Desktop bundle dirs (%APPDATA%\Claude\claude-code, %LOCALAPPDATA%\Packages\Claude_*\...) and absolute PATH entries are session-writable and now EXECUTED (--version) by discovery in src/qa/claude-code-write-deny-extract.ts discoverClaudeBinaries (desktop block, PATH loop) via installedClaudeVersion. Probe: planted <APPDATA>/Claude/claude-code/9.9.9/x/claude.exe was discovered (source desktop) and executed (stdout "v24.15.0"). Attack sketch: a hostile governed session writes a binary there; the human later runs qa:k-readiness and the planted file runs with the human's privileges, and it can also print the judged version and carry the real anchor bytes to make the row PASS (a certifier lie). Honest rating: this is a real new code-exec-on-human path, but triggers only on a human-run readiness check, needs a session that can write the unprotected AppData dir (which, under the pre-K gate, can already write many other user-level places not on the list), and is disclosed in runbook section 7. Exposure: ~0% of runs, basis assumption (no hostile session measured) so capped LOW. Minimal fix (recommended): discovery should refuse to execute binaries from locations not on the protected list (desktop, absolute PATH entries); for those, read the bytes (extraction needs no execution), hash them, and report `UNVERIFIED-UNPROTECTED <path> sha256` as a FAIL or a loud flag that a human clears with an explicit opt-in (env THOTH_EXEC_UNPROTECTED=1). Failing test: discovery with a planted desktop binary must not call the version provider unless opt-in is set.
2. LOW (code-traced, carried): round-2 LOW 4, the mixed-case Edit entry for docs/plans/s308-K-proposed-entry-2026-10-05.json emitted lower-case; unchanged by this delta, still unmeasured on case-sensitive filesystems (low on Windows/macOS).
3. CLEAN (demonstrated): five install dirs protected, 122 paths, unmatched [], 60/60 denies, no over-match, fixture and K3 PASS.
4. CLEAN (demonstrated): relative PATH entries skipped.
5. CLEAN (code-traced): execFileSync argv array, no shell, 10 s timeout; K1/K4 cell rule (isHumanY) now exact `Y` or house form and rejects pre-approved/delegated (k-readiness.ts); no new input reaches a shell.

## Blockers vs hardening
Blockers: none. Hardening: findings 1 and 2. No Issue filed (no new HIGH/MED).

## Editorial
None.

## Next action
Manager: record APPROVE-WITH-CONDITIONS; file finding 1 as a chore/backlog item (or accept the runbook disclosure) before the K wiring commit; the human decides.

RECEIPT: verdict=APPROVE-WITH-CONDITIONS
findings:
1. [ISSUE][LOW][demonstrated] claude-code-write-deny-extract.ts discoverClaudeBinaries executes planted Desktop-bundle and absolute-PATH binaries (unprotected); probe ran a planted %APPDATA% claude.exe; hash/flag instead of exec, opt-in to execute
2. [ISSUE][LOW][code-traced] mixed-case protected path emitted lower-case Edit entry (carried round-2 LOW 4)
3. [CLEAN][demonstrated] five install dirs denied on 6 verbs incl. deep new files, 60/60, no sibling over-match, qa:protected-path-list PASS 122, K3 PASS on fixture
4. [CLEAN][demonstrated] relative PATH entries skipped
5. [CLEAN][code-traced] execFileSync argv array/no shell/10s timeout; K1/K4 cell rule exact Y
counts: issues=2 suspicions=0 clean=3
evidence: demonstrated=3 code-traced=2 derived=0
checks="59/1/0" (4 test files; the 1 fail is the known installed-live-red) plus qa:protected-path-list PASS 122, K3 fixture PASS
adr=HIT(38)
report=docs/reviews/s308-K0-452-app-security-round3-2026-10-05.md
HEAD: 92c25c5
