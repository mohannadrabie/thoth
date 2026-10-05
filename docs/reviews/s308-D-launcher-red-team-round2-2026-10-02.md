# Red-team review round 2 (delta): #308 story D (AP-13 launcher), scope s308-D

Date: 2026-10-02. Reviewer: red-team (Sutekh). Tier: CRITICAL. Delta: `git diff 911e518..561227b` (hooks/launch-gate.sh, src/qa/gate-launcher.test.ts, src/qa/gate-fail-open-probe.ts (+test), src/qa/gate-launcher-pin-check.ts, plan rows F1b/J6a/K5, spike S10, decisions row). The branch moved to bdae445 during review. That commit is docs-only (two plan rows, J8/J9) and is out of scope.
`📊 ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog — ≈18800 tokens saved this pass (fp 702b16a) [CACHE=HIT]`

Round 1 report: `docs/reviews/s308-D-launcher-red-team-2026-10-02.md`. Mutants were planted in a detached worktree at 561227b. It was removed with `git worktree remove --force` plus `git worktree prune`, and `git worktree list` shows only the main tree. The shared tree was untouched except this file and REVIEW_LOG.md. Platform: win32, Node v24.15.0, Git sh 5.3.

## Verdict: go

Both round-1 blockers are closed, and closed by behavior, not only by the pin. The #402 relaxation accepts exactly the two platform forms and still asserts direct=PROCEEDS and launcher exit 2. CI is green on 561227b. The #403 stub is now live: M17, M4 and M4c are killed by `D2-systemroot-bad`. The #397 cheap close holds for every parent shape I tried (unset, decoy in all four names, decoy in windir only, nonexistent, empty). Two LOW items remain. Neither gates.

## Baseline

```
$ node --test src/qa/gate-launcher.test.ts src/qa/gate-launcher-pin-check.test.ts src/qa/gate-fail-open-probe.test.ts   (worktree 561227b, win32)
tests 39  pass 39  fail 0  skipped 0
$ sha256sum hooks/launch-gate.sh
6c7525336c7ed11f2ce92840d5d81304bd4fc5fc554d8f4f0ec365744b01b5d5 *hooks/launch-gate.sh      (matches PINNED_SHA256; 0 CR bytes)
$ gh run view 37087817419   headSha 561227be..., conclusion success (ubuntu-latest)
# tests 1870  # pass 1867  # fail 0  # skipped 3
ok 1231 - memory-exhaustion-blocks-through-launcher ...
ok 1289 - D2-systemroot-from-runtime ... # SKIP
ok 1290 - D2-systemroot-bad ...
ok 1291 - D2-dash-target ...
ok 1292 - D2-env-absolute-path ...
```

## Mutant table (shim, run against src/qa/gate-launcher.test.ts, 22 tests; the pin is a separate file and is excluded)

| Mutant | Edit | Result (win32) | Killed by |
|---|---|---|---|
| M17 | delete all four root-variable checks (lines 10-13) | 21 pass / 1 fail | D2-systemroot-bad |
| M4 | delete the SYSTEMROOT check only (line 10) | 21 / 1 | D2-systemroot-bad |
| M4c | delete the WINDIR check only (line 12) | 21 / 1 | D2-systemroot-bad |
| M4b | delete the SystemRoot check only (line 11) | 22 / 0 | equivalent on win32 (see attack 3); killed on Linux CI |
| M4d | delete the windir check only (line 13) | 22 / 0 | equivalent on win32; killed on Linux CI |
| M15 | `/usr/bin/env -i` changed to `env -i` | 21 / 1 | D2-env-absolute-path |
| MDASH | `node -- "$target"` changed to `node "$target"` | 20 / 2 | D2-dash-target, D2-env-absolute-path |
| MDASHC | MDASH plus a comment line containing `node -- "$target"` (fools the static check) | 21 / 1 | D2-dash-target (behavior) |
| MFWD | re-add forwarding of SYSTEMROOT (reverts #397) | 21 / 1 | D2-systemroot-from-runtime |
| MFWDALL | re-add forwarding of all four | 21 / 1 | D2-systemroot-from-runtime |
| MFWDW | re-add forwarding of lowercase windir only | 22 / 0 | equivalent on win32 (MSYS has no lowercase `windir`); the test is skipped on Linux |

Fold probe (Node parent, all four names removed case-insensitively, then the overrides set; `sh -c` printing env lines matching systemroot or windir, case-insensitive):
```
all-four-decoy  => SYSTEMROOT=C:decoy WINDIR=C:decoy
SystemRoot-only => SYSTEMROOT=C:decoy WINDIR=C:\WINDOWS
windir-only     => SYSTEMROOT=C:\WINDOWS WINDIR=C:decoy
none            => SYSTEMROOT=C:\WINDOWS WINDIR=C:\WINDOWS
```

## Attacks, ranked by exposure x irreversibility x silence

### 1. SURVIVES [demonstrated]: #402. The relaxed memory-row assertion weakens nothing that matters
- Assumption attacked: accepting `exit=null signal=SIGABRT` could let a wrong outcome through.
- Evidence: the regex is `/direct=PROCEEDS \((exit=134|exit=null signal=SIGABRT)\)/`. It rejects a timeout kill (SIGTERM), an OOM-killer SIGKILL, a direct exit 2 (the gate blocking by itself) and a direct exit 1 (wrapper or hook breakage). `/^exit=2 /` and `outcome === "BLOCKS"` are unchanged. `run()` now carries `signal` from `spawnSync`, and the detail string appends it only when it is non-null, so the Windows form `(exit=134)` is byte-identical to round 1. CI run 37087817419 on 561227b: test 1231 ok, 1870/1867/0/3. The 3 skips are the win32-only tests (1289, 1298, 1300).
- The ADR-0005 rule "MUST NOT delete or weaken a failing test to make CI pass" is not breached. The expectation was wrong for Linux and is now platform-correct. The semantic claim (direct proceeds, launcher blocks) is still asserted on both platforms, and the change is recorded in the decisions row, item (2).

### 2. BREAKS [LOW][demonstrated]: the memory row's control is vacuous. A heap cap that aborts every run still reports `control=ok`
- Scenario: the control is meant to show the abort is input-driven ("the control run ... must decide normally, else the abort is not input-driven"). `controlOk` is `classifyOutcome(control.status, ...) === "BLOCKS"` (src/qa/gate-fail-open-probe.ts:220). `classifyOutcome` accepts exit 2, and an abort through the launcher is exit 2. So a control that aborts is indistinguishable from one that decides.
- Mutant: the wrapper cap is changed from `--max-old-space-size=40` to `=1` (line 216, so the control aborts as well):
```
BLOCKS exit=2 stdout="" stderr=... direct=PROCEEDS (exit=134) control=ok (small denied payload, same heap cap, through the launcher: exit=2)
ok memory-exhaustion-blocks-through-launcher ...      tests 2  pass 2  fail 0
```
- Production impact: none. The launcher maps any abort to 2 either way, and D2-exit-map covers the mapping with a stub. The defect is a control that claims proof it cannot give. It predates this delta: round 1 observed `control=ok (exit=0)` and called the controls honest without checking that exit 0 was asserted. This corrects round 1's attack 8. It matters slightly more after #402, because on Linux the detail string never shows up in a green run.
- Exposure: ~100% of probe runs, but only on the evidence surface. Basis: counted in code plus the mutant. No production effect, so LOW.
- Failing test to write: `memory-exhaustion-control-decides-normally`. Require the control's status to be 0 with deny JSON (for example, set controlOk from `control.status === 0 && classifyOutcome(...) === "BLOCKS"`), and keep the cap=1 mutant as the kill check. Commented on #402. No new Issue (LOW).

### 3. SURVIVES [demonstrated]: #403. `D2-systemroot-bad` is live and kills the root-check mutants
- The stub now uses `import { writeFileSync }`. The good-path control writes the marker (status 0), each of the four names is tried, and stderr must equal the launcher's own fixed line. M17, M4 and M4c each fail exactly this test.
- M4b and M4d survive on win32. That is equivalent, not a gap: the fold probe above shows MSYS sh imports `SystemRoot` as `SYSTEMROOT` and `windir` as `WINDIR`, so lines 11 and 13 can never fire on Windows. On Linux the per-name regex is exact (`^launcher: SystemRoot does not name ...$`). The green CI run of `D2-systemroot-bad` on 561227b shows each of the four lines fires on Linux, and deleting line 11 or 13 removes the only source of that exact stderr line, so the test fails there. That half is code-traced from the CI pass, since I have no Linux runner (the Docker daemon is not running here).

### 4. SURVIVES [demonstrated]: #397 cheap close and its regressions (parent unset, decoy, nonexistent, Linux, AC-3j-4)
Shipped shim, Node parent, dump child (`{sr, wd, keys}`):
```
parent-unset           => status 0 {"sr":"C:\WINDOWS","wd":"C:\WINDOWS","keys":["MSYSTEM","PATH","SYSTEMROOT","WINDIR"]}
decoy-all-four         => status 0 {"sr":"C:\WINDOWS","wd":"C:\WINDOWS",...}
decoy-windir-only      => status 0 {"sr":"C:\WINDOWS","wd":"C:\WINDOWS",...}
nonexistent-SystemRoot => status 2  launcher: SYSTEMROOT does not name a Windows directory
empty-SYSTEMROOT       => status 2  launcher: SYSTEMROOT does not name a Windows directory
```
- AC-3j-4: `resolveSystemRegExePath` (src/policy/config/central-source.ts:107-110) reads `env.SystemRoot || env.windir || "C:\Windows"`. Node's `process.env` is case-insensitive on Windows, so the runtime-supplied `SYSTEMROOT` satisfies `env.SystemRoot`, and the decoy can no longer steer reg.exe on the launcher path. If the runtime ever stopped supplying it, the code falls back to the hardcoded default (and Node 24 aborts first, which maps to 2). Both failure modes fail closed or benign.
- Linux: the child env is PATH plus CLAUDE_PROJECT_DIR, as before, and CI is green. `node --` is honored by Node 22.18 (test 1291 ok in CI).
- MFWD and MFWDALL (re-forwarding) are killed by `D2-systemroot-from-runtime`.

### 5. UNPROVEN [LOW][demonstrated]: the #397 property has no CI runner. It holds on the developer's Windows box only
- Scenario: `D2-systemroot-from-runtime` is `# SKIP` on the only CI runner (ubuntu, test 1289). In CI, the MFWD mutant is caught by the pin alone. The property also depends on external MSYS runtime behavior. A Git for Windows upgrade that began forwarding the parent's value would silently reopen #397, and CI would stay green. Only a local Windows `npm test` would notice.
- Current defense: the pin catches any shim edit in CI. The developer runs the suite on Windows. Drift toward not supplying a value fails closed (attack 4).
- Exposure: unknown, basis: assumption, so LOW, and the only recommendation is to measure it. Both round-2 peer reviews flag the same residual. Proof that would settle it: run `D2-systemroot-from-runtime` on a `windows-latest` job (backlog item, not this story). Commented on #397.

### 6. SURVIVES [demonstrated]: locked header edit, re-pin, truncation property
- The new locked sentence, "An empty (0-byte) launcher exits 0 (caught by the pin); any non-empty truncation exits 2", is what `D2-shim-truncation-sweep` proves (every byte-length cut except 0, against a child that exits 1, gives status 2). It passed in the baseline on the new shim. Every cut before the closing `}` on line 21 leaves the line-1 compound unterminated. `D5-header-names-launcher` pins the new phrase. The old self-contradiction is gone.
- The re-pin matches the committed bytes. `D2-env-preserved` lost its win32 SystemRoot-equality assertion, but `D2-systemroot-from-runtime` supersedes it with a stronger check (it uses a decoy). No net weakening.

### 7. SURVIVES [demonstrated]: `node -- "$target"` and `D2-env-absolute-path`
- MDASH is killed by behavior and static tests. MDASHC plants the literal string in a comment, which fools the static `includes`, and is still killed by `D2-dash-target`. M15 is killed. The static regex strips only the first `/usr/bin/env -i` before searching for a bare `env -i`, so a comment decoy plus a bare real call still fails. An absolute `/bin/env` would pass, but it is the same binary under MSYS mounts and is still absolute, so it is not a PATH lever.

### 8. SURVIVES [code-traced]: the new decisions row
- docs/decisions.md (last row). Item (1) narrows #397 to the Git Bash path and keeps the Issue open for any other shell, which matches the shim (hooks/launch-gate.sh:5, 10-16) and S10. Item (2) matches the probe note (src/qa/gate-fail-open-probe.ts:86). Item (3) records the locked-sentence edit as an SE ADR-0005 recorded act. It does not edit the prior row.

## Scariest unproven assumption
That the MSYS runtime keeps supplying the system value, not the parent's value, for SYSTEMROOT/WINDIR to native children across Git for Windows upgrades. Nothing in CI would notice if it changed (attack 5). If it did, the failure would reopen #397, not fail open on the exit-status axis.

## Go / no-go
**go.** Single next action: tighten `controlOk` to require status 0 plus deny JSON (`memory-exhaustion-control-decides-normally`). Do it now or in J, at the Manager's discretion. It is LOW and non-gating.

## Open findings to failing tests
Open findings 2, named tests 2: `memory-exhaustion-control-decides-normally` (attack 2, executable now), and `D2-systemroot-from-runtime` on a windows-latest runner (attack 5; the test exists, but it has no CI runner, so it needs a residual-register line or backlog item rather than a new test file).

Issues: no new Issue (both LOW). Commented on #402 (closure verified, plus the LOW control finding), #403 (closure verified), #397 (cheap close verified, plus the residual), and PR #400 (go).

## Editorial (verdict-neutral)
- The test title `memory-exhaustion-blocks-through-launcher: an allocation failure (exit 134) ...` and the probe comment at src/qa/gate-fail-open-probe.ts:214 ("exit 134 directly") are still Windows-only wording.
- The `D2-systemroot-bad` comment says the sh environment "folds the four names to one". Measured, it folds them to two: SystemRoot becomes SYSTEMROOT and windir becomes WINDIR. Lines 11 and 13 of the shim are therefore dead on Windows and live on Linux. Worth one sentence in the shim header or the test.

RECEIPT: verdict=go
attacks:
1. [CLEAN][demonstrated] #402 relaxed memory assertion: regex admits only exit=134 or null+SIGABRT, still asserts direct=PROCEEDS and launcher exit=2; CI 37087817419 on 561227b 1870/1867/0/3; no ADR-0005 weakening
2. [ISSUE][LOW][demonstrated] memory-row control vacuous: controlOk accepts exit 2, so a cap that aborts every run (mutant cap=1) yields control=ok exit=2 and the test stays green; pre-existing, corrects round-1 attack 8; no prod effect (comment on #402)
3. [CLEAN][demonstrated] #403 D2-systemroot-bad live: M17/M4/M4c killed; M4b/M4d equivalent on win32 (MSYS folds SystemRoot->SYSTEMROOT, windir->WINDIR, measured) and killed on Linux by the exact-name regex (green in CI)
4. [CLEAN][demonstrated] #397 cheap close: parent unset / decoy x4 / decoy windir -> child C:\WINDOWS status 0; nonexistent/empty -> exit 2 backstop; MFWD/MFWDALL killed; central-source SystemRoot||windir resolves; Linux green
5. [SUSPICION][LOW][demonstrated] #397 property has no CI runner: D2-systemroot-from-runtime # SKIP on ubuntu, MFWD pin-only in CI, MSYS drift unseen; exposure assumption -> measure on windows-latest (comment on #397)
6. [CLEAN][demonstrated] locked header edit plus re-pin: sha 6c7525...b5d5 matches, 0 CR, truncation sweep green on new shim, new sentence equals what the sweep proves; D2-env-preserved removal superseded by a stronger test
7. [CLEAN][demonstrated] node -- and D2-env-absolute-path: M15, MDASH killed; comment-decoy MDASHC still killed by D2-dash-target behavior test
8. [CLEAN][code-traced] new decisions row matches code (launch-gate.sh:5,10-16; probe.ts:86), narrows #397 to the Git Bash path, does not edit the prior row
counts: issues=1 suspicions=1 clean=6
evidence: demonstrated=7 code-traced=1 derived=0
checks=baseline 39 pass/0 fail/0 skip (win32); 11 shim mutants x 22 tests: 8 killed by behavior tests, 3 equivalent on win32 (M4b, M4d, MFWDW); probe control mutant 2 pass/0 fail (survived = finding 2); CI 37087817419 1867 pass/0 fail/3 skip
adr=HIT(38)
report=docs/reviews/s308-D-launcher-red-team-round2-2026-10-02.md
