# #308 story D: AP-13 launcher, Phase 1 plan (2026-10-02)

Phase 1 only. Nothing built, nothing committed. Inputs: `docs/plans/s308-activation-phase0-2026-10-02.md` (D1 to D6), `docs/plans/s308-activation-phase1-2026-09-30.md` (AP-13, X-8, X-21, S10), `docs/qa/s308-live-spikes/B4.txt` and `B2.txt`, the "Build deviations" section of `docs/plans/s308-B-live-spikes-plan-2026-10-02.md`, `src/qa/gate-fail-open-probe.ts` and its test.

ADR cache: `📊 ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog — ≈18800 tokens saved this pass (fp d37bef7) [CACHE=HIT]`

## 1. ADR review

| ADR | Verdict | Rule this story honors |
|---|---|---|
| SE ADR-0005 (locked tests replaced as an explicit recorded act) | APPLICABLE | The five probe rows and the locked tests that assert them (`gate-fail-open-probe.test.ts`: the `expectedProceeds` list in the SUR-10 test and test A5) are replaced in their own commit with a `docs/decisions.md` row. Yes: flipping the rows is a recorded act, not a silent edit. |
| THOTH-ADR-0001 and draft THOTH-ADR-0003 | NOT-APPLICABLE | The launcher adds no allowlist and touches no fixture. |
| SE ADR-0021 | NOT-APPLICABLE | No normalizer or class change. |
| Infra ADRs (adr/devops) | NOT-APPLICABLE | No infra. |
No ADR is UNCLEAR for this story.

## 2. Restatement

Make the first process the runtime starts for the gate hook one that an attacker-controlled environment cannot make fail before our code runs, and make every launch failure after that exit 2.

## 3. Tier proposal

CRITICAL, agree with Phase 0. Justification: the launcher sits in front of the session gate (a named sensitive area, "Policy enforcement / session gates"), it is the only control against five demonstrated fail-open paths, and B4b showed a project settings `env` block can trigger one of them in a live session. Reviewers: `red-team` plus `app-security-reviewer` (env handling, exit mapping), and `cross-domain-reviewer` (every tier above TRIVIAL). `code-reviewer` is optional (the cap is two beyond cross-domain; the Manager picks).

## 4. Design decision, with evidence

### What the evidence rules out

- **Node first stage is ruled out.** B4b (live, CC 2.1.267, Node 24.15, Windows 11): a project settings `env` block with `NODE_OPTIONS` set to an unknown flag reached a node hook. Node exited 9 at startup, before any script code, and the runtime ran the Bash call (`hook_response exit_code 9, outcome error`, then `tool_result is_error false`). Local confirmation, run today: `NODE_OPTIONS=--bogus node --disable-warning=x -e 1` exits 9 with the same message, so an argv flag does not get ahead of the env parse. `node --help` on 24.15 lists no switch that ignores `NODE_OPTIONS` (`grep -i options` over the help text found none; the `--env-file` flags are the opposite direction). No code in a node first stage ever runs, so it cannot scrub anything.
- **A bare `node <script>` command is therefore not a launcher.** The probe rows record the same for an interpreter not on PATH (shell exit 127) and for SYSTEMROOT nonexistent on Node 24.

### Choice: a POSIX `sh` shim (Option A), run as `sh "<shim>" "<gate>"`

Why `sh` and not `.cmd` or PowerShell:

1. Local evidence on this machine: the runtime default shell is Git Bash (`CLAUDE_CODE_GIT_BASH_PATH` is set in this session; the 2026-09-07 debug report cites the hooks doc for "defaults to Git Bash on Windows when installed"). `sh.exe` and `bash.exe` resolve under Git for Windows here.
2. The command string `sh "<path>" "<path>"` starts with a bare word, so it is valid in Git Bash and in PowerShell. A command starting with a quoted path would be a no-op string expression in PowerShell and exit 0 (a silent PROCEEDS), so the first token must stay a bare word.
3. The same shim file is runnable on Linux/macOS CI, so the unit test (D2) needs no Windows-only harness.
4. A `.cmd` first stage has awkward quoting and cannot be exec'd without a shell by Node's `spawn` (post-2024 hardening), which would make the D2 test and the probe depend on `shell: true`.

What the shim does, in order, using shell builtins only until `env` runs:

1. Argument check: `$1` must be a regular file, else exit 2 with a stderr reason.
2. SYSTEMROOT guard: if `SYSTEMROOT` or `SystemRoot` is set and `$SYSTEMROOT/System32` is not a directory, exit 2 (fail closed). Rationale and a question below (Q2): validate-and-block, not repair. Measured today: with `SYSTEMROOT=C:/nonexist` the `sh` process itself survives and the node child aborts (exit 134, the CSPRNG assertion); `env -u SYSTEMROOT` under Git Bash re-injects `C:\WINDOWS` (MSYS runtime behavior), so unset is not a failure under Git Bash, a bad value is.
3. Run the child as `env -i` with an explicit allow-list: `PATH`, `SYSTEMROOT`, `windir`, `CLAUDE_PROJECT_DIR`, and nothing else. Deny-by-default is chosen over a `NODE_*` denylist because the node-startup-altering set is open (`NODE_OPTIONS`, `NODE_PATH`, `NODE_EXTRA_CA_CERTS`, `NODE_V8_COVERAGE`, `NODE_COMPILE_CACHE`, `OPENSSL_CONF`, `UV_THREADPOOL_SIZE`, and whatever Node 25 adds); a denylist is a hand-derived completeness claim. Measured today: the gate decides correctly (deny JSON, exit 0) under `env -i PATH=... SYSTEMROOT=... WINDIR=... CLAUDE_PROJECT_DIR=...`, under PATH alone, and with no env at all (absolute node). `grep process.env hooks/pretooluse-kernel-gate.mjs` finds no read; the module-graph reads are only SystemRoot and windir (AC-3j-4), which the allow-list preserves. Q3 asks whether the allow-list needs anything more (e.g. TEMP), settled by the D1 spike S6.
4. Run `node "$1"` with stdin inherited (the hook payload) and stdout/stderr inherited. Capture `$?`.
5. Map: `0` and `2` pass through; every other status prints one stderr line `launcher: child exit <n> mapped to 2` and exits 2. A `case` with no fall-through to 0.
6. If `node` cannot be found, `env` reports 127, which is mapped to 2. (Measured: `sh` running a missing target gives 127, mapped.)

### What the shim does not close (disclosed; D5 plus two more)

- D5, as the plan requires: a tampered module in the gate's import graph that exits 0 with no deny output is not closed (X-8). The shim sees only an exit status.
- The shim's own interpreter and the runtime's shell are the trust root. If the runtime falls back to PowerShell (Git Bash absent) and `sh` is not on PATH, `sh "..."` exits non-2 and the call proceeds. The interpreter-off-PATH probe row closes for node; it cannot close for `sh`. Mitigation, not closure: story G's pre-flight should assert Git Bash is present, and the launch spike S9 below measures which shell the runtime actually used for a `command` string.
- Exit-status truncation. Measured today under Git Bash: a node child that exits 256 or 512 is reported by the shell as 0, 257 as 1, 258 as 2. So "every exit other than 0 and 2 maps to 2" is true of the status the shell reports, not of the 32-bit Windows exit code. A natural fault with a low byte of 0 is not known (NTSTATUS crashes seen map to 5, 9, 58, 66), but "not known" is not "none". The test records this as a disclosed limit with a case for exit 256.
- A hang is not closed (runtime timeout, AP-5, row `hook-timeout-runtime-property`, unchanged). Optional: a `timeout` wrapper inside the shim shorter than the declared 60 s would turn a hang into exit 2. Out of scope for D unless the Manager rules otherwise (Q5).
- PATH hijack (an attacker-controlled PATH putting a fake `node` first) passes through the allow-list by design. Same class as the interpreter; it needs the settings or local settings write path closed (story F deny rules).
- Protection of the shim itself: the shim file, `.claude/settings.json`, `.claude/settings.local.json` and the gate script must be in story F's deny rules. D hands F one requirement: the F generated-list test must include `hooks/launch-gate.sh`. D does not edit F's artifacts.

### D6 claim boundary

Allowed claim, quoting B4: on CC 2.1.267 with project settings loaded, an `env` block's ordinary variable (`SPIKE_ENV_PROBE`) and a `NODE_OPTIONS` value both reached the hook process; the hook log showed `CLAUDE_PROJECT_DIR`, `SYSTEMROOT` and `windir` present. Not claimed: user-level or `settings.local.json` env blocks, managed settings, whether an `env` block can override `SYSTEMROOT` or `PATH` (only the first two keys were tried), later versions, non-Windows. The header comment of the new files carries only this wording.

## 5. Criteria mapped to named checks (tests written failing first)

New test file `src/qa/gate-launcher.test.ts` (tests below are failing before `hooks/launch-gate.sh` exists). Stub children are tiny `.mjs` files written to a temp dir by the test and passed as `$1`; the shim never needs the real gate for D2.

| # | Criterion | Named check |
|---|---|---|
| D1 | Spike output recorded before any launcher code | Spike run S1 to S9 below, raw output pasted into `docs/qa/s308-launcher-spike-2026-10-02.txt` (evidence, not a report file). The builder does not start code until S1 to S6 are in. |
| D2 | Every status other than 0 and 2 maps to 2 | `D2-exit-map`: stub exits 0 (stdin echo, status 0), 2 (stderr reason kept, status 2), 1, 3, 9, 127, 134, 255, and a self-killed stub (SIGKILL on POSIX, exit 1 on Windows per the spike): each yields shim status 2 and the stderr line. `D2-stdin-passthrough`: the stub echoes stdin bytes, shim passes them and exit 0 and stdout unchanged. `D2-missing-target`: `$1` absent or a directory gives 2. `D2-no-node`: PATH containing only a dir with no `node` gives 2 (needs `env` on that PATH: spike S6 settles how). `D2-disclosed-limit-256`: stub exits 256, test asserts the shell-reported status and is named a disclosed limit (documents, does not hide). |
| D2b (derived, marked) | Env is scrubbed | `D2-env-scrub`: a stub prints `Object.keys(process.env)`; with `NODE_OPTIONS`, `NODE_PATH`, `FOO` set in the shim's env, only the allow-list names appear (no `NODE_OPTIONS`, no `FOO`). `D2-env-preserved`: `CLAUDE_PROJECT_DIR`, `SystemRoot`/`SYSTEMROOT`, `windir` reach the child with the same values. `D2-systemroot-bad`: bad SYSTEMROOT gives 2 before the child runs (stub proves it did not run via a marker file). |
| D2c (derived) | Shim bytes are LF only and carry a `#!/bin/sh` line | `D2-lf-only`: no `\r` byte in the file (`.gitattributes` `eol=lf` already covers git; the test covers a stray CRLF that would break `sh` on Windows). |
| D3 | Five probe rows flip PROCEEDS to BLOCKS | `node --test src/qa/gate-fail-open-probe.test.ts` after the rows are edited as the recorded act (section 6). The probe runs the five launcher-owned faults through `sh hooks/launch-gate.sh <gate>`: interpreter-off-PATH (PATH without node), node-options-bad-flag (env `NODE_OPTIONS=--no-such-flag-s7`), systemroot-nonexistent (win32), hook-script-unparseable (the broken copy), memory-exhaustion (the hook under the heap cap: argv flags are not env, so the cap must be injected another way; see S7). Each row observed BLOCKS. A new test `D3-rows-block-through-launcher` asserts the five rows are `expect: "BLOCKS"` with no `ap`. The existing SUR-10 invariant ("a BLOCKS path closes no AP") then holds for them. |
| D3b | The control still holds | `D3-direct-launch-still-proceeds` (derived): the same five faults run WITHOUT the shim still PROCEED, so the BLOCKS is attributable to the launcher and not to a probe change. Kept as an in-test control, not a recorded row. |
| D4 | Launcher path resolves | `npm run qa:gate-command-path` stays PASS. On the real settings it is a vacuous pass today (the hooks object is empty until story J wires it), so D4 is proved by unit tests in `gate-command-path-check.test.ts` on the exact command string J will wire (`sh "${CLAUDE_PROJECT_DIR}/hooks/launch-gate.sh" "${CLAUDE_PROJECT_DIR}/hooks/pretooluse-kernel-gate.mjs"`): `D4-extracts-sh-and-mjs` (both tokens extracted), `D4-missing-shim-fails` (shim absent gives a dangling entry), `D4-missing-gate-arg-fails`. Today `extractScriptPath` only returns a `.mjs` token, so a shim command with no `.mjs` argument would report "could not extract"; the change makes it extract every `.sh`/`.mjs` token and check each. Real-run PASS with the live settings is re-asserted by J. |
| D5 | Disclosed limit | `D5-header-disclosure`: the launcher test's header comment (and the shim's header) contains the X-8 sentence (tampered in-graph module exiting 0 is not closed) plus the three added limits above; the test greps its own file so the disclosure cannot be deleted silently. Reviewer check. |
| D6 | No claim beyond B4 | Reviewer check against `B4.txt`. Mechanical aid: `D6-claim-boundary`: the header text names only "project settings", "CC 2.1.267" and the two keys B4 tried. |
| Latency (derived, marked) | AP-5 is not made worse unnoticed | S8 below measures shim overhead; `npm run qa:gate-latency-budget` is rerun by J. D does not claim a number until S8 runs. |

## 6. Probe rows: a recorded act

Yes. The five rows are locked by tests (`expectedProceeds` in the SUR-10 test, and A5 which asserts they "stay PROCEEDS"). Under SE ADR-0005 they are replaced explicitly: a separate commit ("recorded act") that edits `RECORDED_DECISIONS` rows to `expect: "BLOCKS"` with `ap` removed, rewrites the notes (the rows' residual wording says "owned by the launcher"), updates the SUR-10 `expectedProceeds` list and A5, and carries a `docs/decisions.md` row proposed by the builder for the Manager to enter. The row names: the five ids, the old and new outcome, the reason (launcher form, evidence S-run and B4b), and the disclosed limits. The `systemroot-nonexistent` row currently has `alsoAccepts: ["BLOCKS"]` (hook denies on Node 22, fails open on 24); under the launcher it is BLOCKS on both, so `alsoAccepts` is dropped. The probe module `gate-fail-open-probe.ts` is itself a sensitive-area instrument (evidence trail); the diff to it is reviewed, and the harness tests in `gate-fail-open-probe.test.ts` that are not about these five rows are left unmodified.

## 7. Files to touch

New:
- `hooks/launch-gate.sh` (the shim; LF, `#!/bin/sh`).
- `src/qa/gate-launcher.test.ts` (tests above; stubs generated in a temp dir).
- `docs/qa/s308-launcher-spike-2026-10-02.txt` (D1 evidence, raw output).

Edited:
- `src/qa/gate-fail-open-probe.ts` (five rows, probe runs them via the shim, notes, header comment).
- `src/qa/gate-fail-open-probe.test.ts` (locked tests replaced as the recorded act, own commit).
- `src/qa/gate-command-path-check.ts` and `src/qa/gate-command-path-check.test.ts` (D4; the existing tests for `.mjs` extraction stay and must remain green).
- Check for incidental failure, not edit unless red: `src/qa/gate-manifest-check.ts` and `src/qa/hook-typecheck-coverage-check.ts` (whether they enumerate files under `hooks/`), `qa:kernel-purity`, ESLint over a `.sh` (none expected).

Not edited in D: `.claude/settings.json` (J wires), F's deny rules, `docs/STATE.md`, `CHANGELOG.md`, `docs/decisions.md` (builder proposes lines).

## 8. D1 local spike commands to run before code

Run in Git Bash from `C:\playground\thoth`; paste raw output into the evidence file. Each states its expected result, and a different result changes the design.

| # | Command (shape) | Question | If different |
|---|---|---|---|
| S1 | `NODE_OPTIONS=--bogus node -e 1; echo $?` and the same with `node --disable-warning=x`; `node --help \| grep -i -e "node-options" -e "ignore-env"` | Is there any node switch or order that beats a bad `NODE_OPTIONS`? Done once today (exit 9, no switch found); rerun to record. | A switch exists: Option B (node first stage) becomes viable; revisit. |
| S2 | `printf '%s' "$P" \| SYSTEMROOT=C:/nonexist node hooks/pretooluse-kernel-gate.mjs; echo $?` with `P` a payload the gate denies | D1 itself: exit code and stdout with SYSTEMROOT nonexistent on Node 24. Seen today: exit 134, no stdout. | Exit 0 or 2: the row is not a fail-open on this build; the guard stays as defence. |
| S3 | `SYSTEMROOT=C:/nonexist sh -c 'echo ok'` and `env -u SYSTEMROOT -u SystemRoot sh -c 'echo $SYSTEMROOT'` | Does `sh` start with a bad or missing SYSTEMROOT, and what does MSYS re-inject? Seen today: starts; unset re-injects `C:\WINDOWS`. | `sh` itself dies: the shim cannot guard SYSTEMROOT; the hook has to. |
| S4 | The same S2 through a draft shim, plus `NODE_OPTIONS=--bogus`, plus the five D3 faults, run from PowerShell (`powershell -NoProfile -Command 'sh "<shim>" "<gate>"'`) and from Git Bash | Does the shim return 2 for each, from both shells the runtime may use? | PowerShell cannot find `sh` (likely when Git `usr\bin` is not on the Windows PATH): record, escalate Q1. |
| S5 | Exit-status table: `node -e "process.exit(N)"` for N in 1 2 3 127 134 255 256 257 258 512, plus SIGKILL and `process.abort()`, through the shim | Truncation behavior. Seen today without the shim: 256 and 512 become 0. | If the shim can see the real code another way, use it. |
| S6 | `env -i` allow-list variants: minimal four vars; PATH only; absolute node, no env | Is the allow-list sufficient for the real gate (policy load, HKLM read via `reg.exe` under SystemRoot, `.thoth` paths)? Run the real gate on an allowed and a denied Bash payload and compare stdout byte-for-byte with the direct run. Today only an MCP-tool deny was compared. | Gate needs more env (e.g. TEMP, USERPROFILE): add to allow-list, one line each, with the reason. |
| S7 | Memory-exhaustion injection through the shim: `NODE_OPTIONS=--max-old-space-size=40` is stripped by the shim, so the probe cannot inject the cap via env. Options: probe runs the stub shim with a variant `$1` that is a tiny wrapper script that spawns the gate under the cap; or the probe calls the shim's child command through a documented test-only env (rejected: a test-only env is an attack surface). Run the wrapper-script variant and confirm exit 134 maps to 2. | How the probe gets a memory-exhaustion fault through a shim that deletes env. | If not feasible without a test hook, the row stays PROCEEDS through env and is demonstrated via the stub exit 134 case (D2) only; the row's flip is then a smaller claim and Q4 asks. |
| S8 | Overhead: 20 runs each of `node gate` direct and `sh shim gate`, median and max, on the denied payload | Added latency. No budget claim before this. | Large increase (over the AP-5 margin): report to the Manager before build. |
| S9 | (Live, 1 to 2 haiku calls, harness from story B) a hook command `sh "<shim>" "<stub-that-exits-1>"` under `--setting-sources project`, with and without `NODE_OPTIONS=--spike-unknown-flag` in the settings `env` block | Which shell the runtime uses for the command string; whether the shim run is blocked (exit 2 observed, Bash call refused) in a real session. | Not run: D6 stays limited to B4; the shim claim stays "tested under Git Bash and PowerShell locally, runtime shell not measured". |

S9 is the only paid step; it is optional for D to build but required before J claims activation readiness, so it is flagged now.

## 9. Test-first dispatch check

Does the plan identify a new or changed UI flow or API surface? Recommendation: No. The launcher is an internal command wrapper with no UI and no HTTP or tool-schema contract; its observable behavior (exit mapping) is covered black-box by `gate-launcher.test.ts` and the probe, which story-implementer writes failing first as the plan says. `test-writer` is not dispatched. One caveat the Manager may weigh: if the launcher's exit-2 stderr text becomes a contract the user sees (the unlock wording of story H), that is the H surface, not a D surface; D's stderr line is diagnostic only and has no wording ruling. If the Manager rules the launcher an API surface anyway, dispatch `test-writer` now for `D2-exit-map` and `D3-rows-block-through-launcher`, and Phase 2 waits for `RED-CONFIRMED`.

## 10. Rollout and rollback

D ships a file and tests; nothing is wired until J. Rollback is `git revert` of the shim and the probe commits; the five rows would return to PROCEEDS with their AP-13 note. Wiring risk (J): a typo in the command string or a missing `sh` makes the gate exit non-2, i.e. fail open; J's U-8 run and the qa checks are the guard. Human-only actions: none in D.

## 11. Blocking questions (ranked by build impact)

1. Is Git Bash a hard requirement for the gate on Windows (a documented install precondition in the G pre-flight), with the PowerShell-fallback / `sh`-not-on-PATH case accepted as a disclosed residual? The alternative is a `.cmd` or PowerShell shim with its own quoting risk (a quoted-first-token no-op). Recommendation: yes, `sh` shim, residual disclosed. Does the Manager accept that the "interpreter off PATH" row closes for node but not for `sh`?
2. SYSTEMROOT policy: validate-and-block (recommended: the gate resolves `reg.exe` under SystemRoot, so a launcher that silently repaired the value would be choosing a trust anchor; blocking is simple and fail-closed) or repair to `windir`/`C:\Windows`? Recommendation: block.
3. Env allow-list contents (PATH, SYSTEMROOT, windir, CLAUDE_PROJECT_DIR): confirmed or extended by S6; any gate-side env read added later by another story must also extend it (a risk for AC-3j-4, which already pins the module-graph reads).
4. Memory-exhaustion flip (S7): if the probe cannot inject the heap cap through a shim that scrubs env without a test-only hook, accept flipping that row on the D2 stub-134 evidence plus S7's wrapper, and say so in the decisions row?
5. Timeout inside the shim (optional `timeout` wrapper below 60 s turning a hang into exit 2): in scope for D, or left to AP-5/J? Recommendation: leave to J; D stays minimal (rule: no gold-plating).
6. Running S9 (live, 1 to 2 paid haiku calls) now or at J? Recommendation: at J, with J's spikes, unless the Manager wants the runtime-shell fact before D builds.

RECEIPT: verdict=BLOCKED criteria="6 mapped/6 total" checks="0/0/0" adr=HIT(1) pr=n/a

## Phase 2 amendments (Manager rulings, design challenge #398 and #399)

- Scope narrowed: the launcher closes ambient or accidental launch faults. NODE_OPTIONS means an ambient inherited value, never a settings env block (a settings write can remove the hook entry; that is stories F and K).
- Shim body is one compound command opened on line 1 (no shebang, no comment before it), so any truncation is a syntax error and exits 2; the 0-byte file is caught by a pinned SHA-256 (src/qa/gate-launcher-pin-check.ts, run under npm test). Tests: D2-shim-truncation-sweep, D2-shape, D4b-shim-hash-pinned, D5-header-names-launcher.
- The shim unsets imported shell functions for the utilities it uses (env, printf, test, [, command), uses /usr/bin/env by absolute path, and resets errexit/nounset/xtrace. Levers it cannot close are pinned by name in the test header (D2-env-shell-levers-disclosure).
- Rulings: Git Bash hard precondition (story G pre-flight); bad SYSTEMROOT blocks; hangs and S9 and challenger U1 are story J; memory-exhaustion row flips on the wrapper variant (S7) plus stub exit 134, disclosed.
- Spike evidence: docs/qa/s308-launcher-spike-2026-10-02.txt. Red run before the shim existed: docs/qa/s308-launcher-red-run-2026-10-02.txt.
