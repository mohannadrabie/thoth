# Red-team review: #308 story D (AP-13 launcher), scope s308-D

Date: 2026-10-02. Reviewer: red-team (Sutekh). Tier: CRITICAL. Diff: `git diff 6e5e35a..fd8714c` (hooks/launch-gate.sh, src/qa/gate-launcher.test.ts, src/qa/gate-launcher-pin-check.ts (+test), src/qa/gate-command-path-check.ts (+test), src/qa/gate-fail-open-probe.ts (+test), package.json, plan amendments, two evidence files, decisions row).
`📊 ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog — ≈18800 tokens saved this pass (fp 702b16a) [CACHE=HIT]`

Attacked inside the Manager's rulings (ambient/accidental scope; settings env blocks belong to F/K; #399 closed by compound command plus pin; Git Bash is a Windows precondition). Mutants were planted in a detached worktree at fd8714c (removed afterwards; shared tree untouched except this file and REVIEW_LOG.md).

## Verdict: no-go (one fix, then go)

The launcher holds up. 11 of 13 shim mutants are killed by behavior tests, not only by the pin. The truncation sweep finds 0 bad cuts. Under POSIX `sh`, BASH_FUNC overrides cannot reach anything the shim runs. The controls for the recorded act really do run the fault directly. **But the PR head is red in CI**: one assertion in the new memory-row test is Windows-only. That is the only blocker, and it is a one-line fix.

## Baseline

```
$ node --test src/qa/gate-launcher.test.ts src/qa/gate-launcher-pin-check.test.ts src/qa/gate-command-path-check.test.ts src/qa/gate-fail-open-probe.test.ts   (win32, Node v24.15.0, worktree fd8714c)
tests 51  pass 51  fail 0  cancelled 0  skipped 0
```

CI for PR #400 at fd8714c (run 37083940567, ubuntu-latest, Node 22.18.0), step "Test (full node:test suite)":
```
# tests 1867   # pass 1864   # fail 1   # cancelled 0   # skipped 2
not ok 1231 - memory-exhaustion-blocks-through-launcher: ...
  error: 'without the launcher the same fault is exit 134: exit=2 stdout="" stderr="<--- Last few GCs --->..." direct=PROCEEDS (exit=null) control=ok (... through the launcher: exit=0)'
ok 1280 - D4b-shim-hash-pinned: the committed launcher matches the pinned hash
ok 1281 - D4b-shim-hash-pinned: an empty launcher, a one-byte change and a trailing addition each fail the check
```

## Attacks, ranked by exposure x irreversibility x silence

### 1. BREAKS [HIGH][demonstrated]: the PR head fails CI. The memory row asserts a Windows-only exit code
- Scenario: `src/qa/gate-fail-open-probe.test.ts` (test memory-exhaustion-blocks-through-launcher, the `direct=PROCEEDS (exit=134)` match near line 169) requires direct exit 134. On Linux a V8 heap abort is SIGABRT, so `spawnSync` reports `status: null`, not 134. The assertion fails every time on the ubuntu runner. Through the launcher the row is still `exit=2` on Linux. On Linux the wrapper's `process.exit(r.status ?? 1)` turns the signal into 1, and the launcher maps that 1 to 2. So production behavior is correct, but the evidence differs by platform.
- Current defense: none. The cross-domain review left "Linux CI run not proven" as UNPROVEN. It is now proven red.
- Exposure: ~100% of ubuntu CI runs, basis: measured (1 of 1 runs at fd8714c; POSIX signal semantics make it deterministic). Fully reversible and loud, but it fails the DoD ("tests green in CI") and blocks merge.
- Claim mismatch: the row note and the decisions row (4) say "observed exit 134". That is true only on Windows.
- Failing test (exists, red in CI): `memory-exhaustion-blocks-through-launcher`. Fix: accept direct exit 134 or null (or assert `direct=PROCEEDS` alone), and say in the note that on Linux the abort is a signal and the launcher sees 1 from the wrapper. Proof: a green ubuntu CI run on the fix commit.

### 2. BREAKS [MED][demonstrated]: `D2-systemroot-bad` is vacuous wherever Node can start. Its marker can never be written
- Scenario: the stub is written to `mark.mjs` with body `require("node:fs").writeFileSync(<marker>, "ran")`. `require` is not defined in ES module scope, so the stub always throws before it writes. The launcher maps the resulting exit 1 to 2, and the stack trace contains the marker path `...systemroot-marker`, which satisfies the `/SYSTEMROOT/i` stderr match. All three assertions pass whether or not the shim checks SYSTEMROOT, as long as Node starts.
```
$ node mark.mjs                 -> ReferenceError: require is not defined in ES module scope ; rc=1 ; marker absent
$ sh launch-gate.sh mark.mjs    (GOOD env) -> "launcher: child exit 1 mapped to 2" ; marker absent
```
- Mutant evidence: M17 deletes all four SYSTEMROOT/SystemRoot/WINDIR/windir lines and survives all 19 launcher tests and all 15 probe tests (killed only by the pin). M4 drops only the SYSTEMROOT `-d` check. It is killed locally only because Node 24 aborts on a bogus SYSTEMROOT and the abort text does not contain "systemroot". On the CI runner (Linux, Node 22.18) Node starts, so by the trace above M4 survives there and the check is guarded by the pin alone (the CI half is derived from the demonstrated stub crash).
- Production impact: none today. A Node 24 abort maps to 2, and on Node 22.18 the gate denies. The check is defense in depth. The defect is a test that claims proof ("marker file proves it") it cannot give, on an evidence surface.
- Exposure: ~100% of CI runs leave the SYSTEMROOT check behaviorally unguarded, basis: counted in code plus the M17 run.
- Failing test to write: `D2-systemroot-bad-marker-is-live`. Use a `.cjs` stub (or an `import`), first prove that the same stub with a GOOD env writes the marker, then assert stderr matches the launcher's own line `launcher: SYSTEMROOT does not name`, not any path.

### 3. BREAKS [MED][demonstrated]: the extended command-path check accepts fail-open command shapes J could wire, including `bash`, which reopens a function lever (owned by #401)
- Scenario: `extractScriptPaths` / `checkCommandPaths` (src/qa/gate-command-path-check.ts:66-70, 128-140) check only that both paths exist. Each of these returns `ok=true vacuous=false`:
```
sh "${CLAUDE_PROJECT_DIR}/hooks/launch-gate.sh" "${CLAUDE_PROJECT_DIR}/hooks/pretooluse-kernel-gate.mjs" || true
sh "${CLAUDE_PROJECT_DIR}/hooks/launch-gate.sh" "${CLAUDE_PROJECT_DIR}/hooks/pretooluse-kernel-gate.mjs"; exit 0
sh "${CLAUDE_PROJECT_DIR}/hooks/launch-gate.sh" "${CLAUDE_PROJECT_DIR}/hooks/pretooluse-kernel-gate.mjs" 2>/dev/null || exit 0
echo "${CLAUDE_PROJECT_DIR}/hooks/launch-gate.sh" "${CLAUDE_PROJECT_DIR}/hooks/pretooluse-kernel-gate.mjs"
node "${CLAUDE_PROJECT_DIR}/hooks/pretooluse-kernel-gate.mjs"
```
  The shim's BASH_FUNC defense depends on `sh` being POSIX mode, where special builtins win over functions. Run with `bash`, which the check also accepts, an imported `BASH_FUNC_exit%%` turns a failing child into exit 0:
```
sh.exe   + BASH_FUNC_exit%%   failing child -> rc=2
bash.exe + BASH_FUNC_exit%%   failing child -> rc=0
bash.exe + BASH_FUNC_set%% / unset%% / printf%%  -> rc=2
bash.exe, no lever            failing child -> rc=2
```
- Current defense: #401 (cross-domain MED) already records that nothing asserts the wired entry uses the launcher. App-security finding 3 (LOW) records existence-only. This adds the exact shapes, and shows that the interpreter word `sh` is load-bearing.
- Exposure: 0% today (the hooks object is empty until J, counted in `.claude/settings.json`). If J wires any shape above, it becomes ~100% of gate calls.
- Failing test (carried by #401 into J/K): `K-pretooluse-entry-uses-launcher`. Assert the command string equals the one pinned form byte for byte, and use the shapes above (including `bash` and `|| true`) as mutants. Commented on #401, not refiled.

### 4. BREAKS [LOW][demonstrated]: #397 is disclosed as unmeasured, yet the Git Bash path can close it cheaply
- Scenario: the shim forwards the parent's SYSTEMROOT/SystemRoot/WINDIR/windir after a `-d $X/System32` check (hooks/launch-gate.sh:10-13), so a populated decoy passes through to src/policy/config/central-source.ts:107-109 (the reg.exe path). With `env -i` and no passthrough, the MSYS/Cygwin runtime adds SYSTEMROOT and WINDIR itself when it spawns a native child, from the system value rather than the parent environment (Node parent spawning Git sh):
```
SHIPPED shim, decoy SYSTEMROOT (empty System32):  status 2 (Node 24 CSPRNG abort, 134 mapped)
NO-PASSTHROUGH variant, decoy SYSTEMROOT:          status 0, child SYSTEMROOT=C:\WINDOWS
NO-PASSTHROUGH variant, nonexistent SYSTEMROOT:    status 0, child SYSTEMROOT=C:\WINDOWS
all four unset in parent, shipped shim:            child SYSTEMROOT=C:\WINDOWS WINDIR=C:\WINDOWS
```
  Deleting four lines (M17) would take decoy steering off the launcher path and make the nonexistent row moot. The trade-off: it leans on MSYS runtime behavior, which the Git Bash precondition already accepts. It changes the pin and needs D2-systemroot-bad and D2-env-preserved reworded.
- Exposure: ambient-scope trigger implausible. Basis: assumption, so LOW. Commented on #397 with the measurement, no new Issue.
- Test to write if adopted: `D2-systemroot-from-runtime` (decoy and nonexistent parent values; the child sees the system directory).

### 5. BREAKS [LOW][demonstrated]: the absolute `/usr/bin/env` is guarded only by the pin
- M15 (`/usr/bin/env -i` changed to `env -i`) survives all 34 behavior tests. A PATH-planted `env` is in the same class as the disclosed PATH-node limit, and the pin catches the edit. A one-line static assertion that the source contains `/usr/bin/env -i ` would make the property explicit. Named test: `D2-env-absolute-path`. No Issue (LOW).

### 6. SURVIVES [demonstrated]: exit mapping, env scrub, compound-command shape, function unset, target check
Each shim mutant was killed by behavior tests, independent of the pin:

| Mutant | Behavior tests failed (launcher / probe) |
|---|---|
| M1 drop exit map (`exit "$rc"`) | 5 / 4 |
| M2 map 1 to 0 | 4 / 3 |
| M3 drop `env -i` | 3 / 0 (the probe NODE_OPTIONS row still BLOCKS through the exit map; D2-env-scrub and D2-env-shell-levers-block kill it) |
| M5 opener moved off line 1 | 2 (D2-shape, truncation sweep) / 0 |
| M5b no compound command | 2 / 0 |
| M7 drop `unset -f` | 2 (levers-block, static unset check) / 0 |
| M8 drop target check | 1 (D2-missing-target) / 0 |
| M13 child exit 2 to 0 | 2 / 0 |
| M16 drop `set +e +u +x +v` | 1 (levers-block, SHELLOPTS=errexit) / 0 |
| M4, M14 SYSTEMROOT checks | 1 / 0, on Node 24 only (see attack 2) |
| M15, M17 | 0 / 0 (attacks 5 and 4) |

All 13 also fail D4b (pin). Truncation sweep on the shipped shim: 0 bad cuts across every non-empty prefix (baseline green).

### 7. SURVIVES [demonstrated]: BASH_FUNC overrides of the commands the shim calls, and SYSTEMROOT edge values (under `sh`)
- Git sh (GNU bash 5.3.9, POSIX mode) does import `BASH_FUNC_printf%%` and `BASH_FUNC_test%%` (output `HIJACKED-printf`, `HIJACKED-test rc=0`), so `unset -f` is load-bearing and present. `exit`, `set` and `unset` are special builtins and cannot be overridden (rc=3, `after`, `after`). `BASH_FUNC_/usr/bin/env%%` is rejected at import ("error importing function definition"). Through the shim, exit/set/unset/printf levers all give rc=2.
- SYSTEMROOT empty: exit 2. All four unset: the runtime re-adds the real value. Bogus `windir` alone: exit 2.

### 8. SURVIVES [demonstrated]: the recorded-act probe flip is honest
`runProbe` on the worktree. Every control runs the fault directly (no launcher) and still proceeds:
```
interpreter-not-on-path => BLOCKS | exit=2 ... child exit 127 mapped ... direct=PROCEEDS (exit=null)
node-options-bad-flag   => BLOCKS | exit=0 stdout={"hookSpecificOutput":{..."permissionDecision":"deny"... direct=PROCEEDS (exit=9)
systemroot-nonexistent  => BLOCKS | exit=2 ... SYSTEMROOT does not name a Windows directory   direct=PROCEEDS (exit=134)
memory-exhaustion       => BLOCKS | exit=2 ... Last few GCs ... direct=PROCEEDS (exit=134) control=ok (exit=0)
hook-script-unparseable => BLOCKS | exit=2 ... direct=PROCEEDS (exit=1)
```
The NODE_OPTIONS row shows the gate actually ran and denied (exit 0 plus deny JSON), not only an exit-9 mapping.

### 9. SURVIVES [demonstrated]: the pin runs in CI, resists a weakened check, and a CRLF checkout cannot desync it
- `npm test` (`node --test`) runs D4b in CI (`ok 1280`, `ok 1281` above).
- Pin mutant `actual !== PINNED_SHA256 && false`: killed (1 fail). Removing the empty-file guard is an equivalent mutant (an empty file's hash still mismatches; 2 pass).
- `.gitattributes:10` `* text=auto eol=lf`; `git check-attr` reports `hooks/launch-gate.sh: eol: lf` with `core.autocrlf=true`.

## Scariest unproven assumption
That J will wire exactly `sh "<launcher>" "<gate>"`. The BASH_FUNC defense, the compound-command truncation property and every BLOCKS row assume that invocation, and today no check pins it (attack 3, #401). `bash` instead of `sh`, or a trailing `|| true`, silently undoes the whole story.

## Go / no-go
**no-go** until CI is green. Single next action: fix the memory-row assertion to accept the Linux signal outcome (attack 1, #402), fix the systemroot stub in the same commit (attack 2, #403), push, and confirm a green ubuntu run.

## Open findings to failing tests
Open findings 5 = named tests 5: `memory-exhaustion-blocks-through-launcher` (exists, red in CI), `D2-systemroot-bad-marker-is-live`, `K-pretooluse-entry-uses-launcher` (#401, J/K), `D2-systemroot-from-runtime` (only if #397's cheap close is adopted), `D2-env-absolute-path`.

Issues: filed #402 (HIGH, attack 1) and #403 (MED, attack 2). Commented (no refile): #401 (attack 3), #397 (attack 4), #399 (closure verified), #398 (sh vs bash), PR #400 (no-go and unlock).

## Editorial (verdict-neutral)
- `gate-launcher.test.ts` header D6 says "not user-level or local settings". Decisions row (6) says "project and local settings", and `docs/qa/s308-live-spikes/B4.txt:4` shows b4-local was run. The header understates; one of the two should change.
- Header line 12, "An empty (0-byte) or truncated launcher exits 0", contradicts the next sentence (truncation exits 2). The sentence is pinned verbatim by `D5-header-names-launcher`, so the locked phrase is the stale half.
- The decisions row (4) and the memory-row note say "observed exit 134" without saying it is Windows-only (see attack 1).

RECEIPT: verdict=no-go
attacks:
1. [ISSUE][HIGH][demonstrated] CI red at fd8714c: memory-exhaustion-blocks-through-launcher asserts direct exit=134; Linux V8 abort is a signal (status null); launcher still exit 2 (#402). Exposure: ~100% of ubuntu CI runs, basis: measured (1/1, deterministic)
2. [ISSUE][MED][demonstrated] D2-systemroot-bad vacuous: mark.mjs uses require in ESM so the marker is never written; stderr path matches /SYSTEMROOT/i; M17 survives all 34 behavior tests, M4 survives where Node starts (#403)
3. [ISSUE][MED][demonstrated] command-path check accepts `|| true`, `; exit 0`, echo, bare node and bash shapes; bash + BASH_FUNC_exit%% gives rc=0; 0% today (on #401, commented)
4. [ISSUE][LOW][demonstrated] #397 cheap close exists: env -i with no SYSTEMROOT passthrough makes the MSYS runtime supply C:\WINDOWS regardless of a decoy or nonexistent parent value (on #397, commented)
5. [ISSUE][LOW][demonstrated] absolute /usr/bin/env guarded only by the pin (M15 survives behavior tests); add a static assertion
6. [CLEAN][demonstrated] exit map, env -i, compound opener, unset -f, target check, 2->0, set reset: M1/M2/M3/M5/M5b/M7/M8/M13/M16 killed by behavior tests; sweep 0 bad cuts
7. [CLEAN][demonstrated] under sh, BASH_FUNC printf/test imported but unset; exit/set/unset not overridable; slash-named env import rejected; SYSTEMROOT empty/unset/bogus windir handled
8. [CLEAN][demonstrated] recorded-act flip honest: all five controls run directly and still PROCEED (null/9/134/134/1); NODE_OPTIONS row shows a real gate deny
9. [CLEAN][demonstrated] pin runs in CI (ok 1280/1281), weakened-pin mutant killed, empty-guard removal equivalent; .gitattributes forces LF on the .sh
counts: issues=5 suspicions=0 clean=4
evidence: demonstrated=9 code-traced=0 derived=0
checks=baseline 51 pass/0 fail/0 skip (win32 Node 24.15, 4 files); shim mutants 13: 11 killed by behavior tests, 2 survived (M15, M17), 13/13 killed by pin; pin mutants 2: 1 killed, 1 equivalent; CI run 37083940567 (ubuntu, Node 22.18): 1864 pass/1 fail/2 skip
adr=HIT(38)
report=docs/reviews/s308-D-launcher-red-team-2026-10-02.md
