# Phase 1 plan: #308 stories E (baseline rules), F (deny rules), J (outline)

Date: 2026-10-04. Author: story-implementer (Ptah). Branch `s308/activation-3`. Phase 1 only: nothing built.
`📊 ADR cache HIT: reused 38 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:3] from catalog (fp 702b16a) [CACHE=HIT]`
Criteria source: `docs/plans/s308-activation-phase0-2026-10-02.md` section 3 (E1-E7, F1-F7, J1-J9). Not repeated here; this file adds the plan, the spike result and the blockers.

## 0. Hold

- THOTH-ADR-0003 is `proposed`. E, F, J and K MUST NOT ship before the human accepts it (E7, F7, J7). No agent self-accepts.
- Work is built on the local branch only. Merge is held. Every commit message and the PR skeleton say "HELD: THOTH-ADR-0003 not accepted".
- K (real `.claude/settings.json` PreToolUse entry and `permissions.deny` lines) is out of scope.

## 1. ADR review

| ADR | Verdict | Rule this work must honor |
|---|---|---|
| THOTH-ADR-0003 (proposed) | APPLICABLE | Hold rule; fixture explicit in F's list, `F3-mutant-drop-fixture-deny` must fail; test code derives fixture names at run time; gate stays write-free; "MUST NOT state the gate's deny rules alone make the file unwritable" |
| THOTH-ADR-0001 | APPLICABLE (as amended) | rule 4 hardcode ban (E6 triage); no env var selects the fixture |
| SE ADR-0005 | APPLICABLE | Any locked test that flips (for example a test asserting `rules: []`) is replaced as a recorded act with a decisions row, own commit |
| SE ADR-0021 (POL-05, INT-07, POL-12) | APPLICABLE | Class markers are data; server name is not identity (INT-07 residual stays disclosed) |
| SE ADR-0001 | APPLICABLE | No self-acceptance |
| All others | NOT-APPLICABLE | No infra, API or data surface |

## 2. Spike result (PRINCIPLES 17/18): what the shipped gate does today

Measured 2026-10-04 with the real hook (`node hooks/pretooluse-kernel-gate.mjs`, stdin JSON) and `normalizeShellCall`. Probe script is throwaway (scratchpad).

| Bash command | Record | Gate result today |
|---|---|---|
| `ls -la`, `cat README.md`, `git status` | verbs `[]`, targets `[]`, `unresolved` non-empty | DENY, "POL-05 ... unresolved field(s)" |
| `rm`/`cp`/`mv`/`sed -i`/`tee`/`git checkout -- <path>` on a protected path | unresolved, no target | DENY via POL-05 |
| `echo x > .thoth/policy.json` | verbs `[write]`, targets `[".thoth/policy.json"]` | ALLOW (no rule) |
| `echo x > .\.THOTH\policy.json`, `>> ./a/../.thoth/policy.json` | target is the raw string, not canonicalized | ALLOW; an exact-match rule would not see these forms |

Meaning:
- The shell normalizer is kubectl-shaped (token 1 = tool, token 2 = verb). Ordinary reads are unresolved, and POL-05 runs BEFORE rules (`kernel.ts` `pol05Rule`, then rules, then default). A deny wins over an allow in rule matching, and no allow rule can rescue a POL-05 deny.
- So "read freely" cannot be delivered by E's rules. With the gate wired, `ls`, `cat`, `git status` are refused. Phase 0 section 5c ("a cleanly resolved action follows allow") is true only for the narrow resolved set (kubectl-shaped verbs, redirects).
- Conversely, F's path-deny rules can only ever fire on redirect writes (the one path-shaped record). Every other mutator on a protected path is already denied by POL-05 as unresolved. F is the redirect-write seal plus a pinned list, not a general path guard.

## 3. Blocking questions (real ones)

1. **Q1 (blocks the meaning of E; Manager, then human).** POL-05 denies unresolved Bash before any rule. Options: (A) accept: activation makes most Bash unusable (human must understand; contradicts "read freely"); (B) new story E0: teach the shell normalizer a closed read-only command set (`ls`, `cat`, `git status`, ...), resolved to verb `read`, refusing any redirect, substitution or chain; sensitive (S4 area, CRITICAL, red-team); (C) change POL-05 (kernel; worse). Recommendation: **B as a separate story ahead of E's allow content**; E still builds its rule data and PT tests now, which hold under any option. Under A or until E0 lands, E ships as written but the PR states the Bash consequence in its first line.
2. **Q2 (blocks F4).** Rule targets match the verbatim redirect string (exact, or prefix when the pattern ends in `/`). Case, `\`, `./`, `..` and cwd-relative forms bypass. Options: (A) canonicalize redirect targets in the shell normalizer (cwd-resolve, `\` to `/`, `..` collapse, case-fold on Windows), pure helper, targets then compared to project-relative paths; touches `shell.ts` and existing rule tests; (B) ship F with the gap disclosed and F4 asserted as a known-failing row. Recommendation: **A**, inside F, red-team reviewed. Needs the Manager's OK to touch `shell.ts`.
3. **Q3 (F scope, recommend; no block).** Deny verbs: `write, create, modify, delete, move, rename`; omit `execute` (read and run freely, protect writes). Add `.thoth/halt-state/` as a named path? Recommend yes (named sensitive area), one prefix rule.
4. **Q4 (F, recommend; no block).** Put the deny rules in `src/policy/config/shipped-defaults.json` with `mandatory: true` (so project cannot redefine the ids; project and shipped-defaults are peers otherwise). A test proves a project redefinition of each id fails load.

Recommended answers if no reply: Q1 B (separate story, not built tonight), Q2 A, Q3 as stated, Q4 as stated.

## 4. Tiers

| Story | Tier | One-line justification |
|---|---|---|
| E | CRITICAL | Ships the first real rule data to the enforcement point; policy delivery plus guard are named sensitive areas |
| F | CRITICAL | Self-protection of the gate; touches shipped-defaults and possibly `shell.ts` (Q2) |
| J | CRITICAL | Verification of the gate as it will wire; live runs |
Reviewers: E red-team + architecture + cross-domain; F red-team + app-security + cross-domain; fresh dated reports in `docs/reviews/` before ship.

## 5. Test-first dispatch check

New or changed UI flow or API surface? **No.** The hook's stdin/stdout contract is unchanged; this is rule data, tests and a QA script. `test-writer` is not dispatched. Ptah writes the named tests failing first (RED recorded in the commit message) before any rule data or code. If Q2-A is taken, that is an internal normalizer change, still no external surface; the Manager may overrule.

## 6. Story E plan

### Proposed allow list (for the Manager to ratify, E4)

| Rule id | effect | verbs | targets | Why it is safe |
|---|---|---|---|---|
| `baseline-allow-read-verbs` | allow | `read, list, describe, get` | none | Non-mutating catalog verbs; reachable only for commands the normalizer resolves (kubectl-shaped today) |
| `baseline-allow-class-read-only` | allow | `tool-class:read-only` | none | Marker-only allow (V4-clean); a shell verb token equal to a marker is unresolved (N9b), so Bash cannot forge it (PT-1) |

- Deliberately NOT allowed: `tool-class:workspace-mutating`, `tool-class:remote-mutating` (they follow the default outcome, no explicit authorization); any target-only or `mcp/` allow (V4 rejects); any `execute` verb.
- Built-in tools (Read, Grep, Glob): not rule matter. The gate routes only `Bash` and `mcp__*`; K's matcher decides what reaches it.
- Under default allow these two rules change no outcome; they pin the shape, are exercised under a forced `deny` posture by PT tests, and become load-bearing if the posture ever tightens. Stated plainly in the PR.
- `defaultOutcome`: leave undeclared (resolved `allow`, source `bootstrap`); E3 pins both (per Phase 0 5c).

### Criteria to checks

| # | Check (named; written failing first) |
|---|---|
| E1 | `PT-1` forged marker from Bash cannot yield allow; `PT-2` read verb does not authorize a different binary (verb resolution is tool-blind); `PT-12` shapes a, b, d schema-invalid on every layer, shape c and valid denies load. All three run against the real shipped `shipped-defaults.json` under forced deny posture. File `src/policy/config/baseline-rules.test.ts`. Red run recorded before the JSON edit |
| E2 | Existing N9, N9b, H11, H11b re-run against shipped rules (a test loads real shipped-defaults and calls the same helpers); no edit to those tests |
| E3 | `E3-default-outcome`: resolved `defaultOutcome` is `allow`, `source` is `bootstrap` with shipped rules loaded |
| E4 | Decisions row after the Manager ratifies the list above |
| E5 | `grep` doc check: #306, #329 cited, state closed (`gh issue view`, metadata only) |
| E6 | NEW `src/qa/fixture-name-triage.ts` (+ test): reads names from `docs/qa/s5-central-classification.json` at run time, scans every quoted literal under `hooks/` and `src/`, prints each hit with a verdict column; output pasted in the PR; hit set compared with the ADR-0003 triage table (a new hit fails the script until triaged) |
| E7 | Decisions row of acceptance; until then the PR is marked HELD |
| E-recorded | Any locked test asserting the placeholder (`rules: []`, version string) is replaced as a recorded act (SE ADR-0005), own commit, decisions row; manifest or pin hashes of shipped-defaults updated in the same commit |

Files: `src/policy/config/shipped-defaults.json`, `src/policy/config/baseline-rules.test.ts` (new), `src/qa/fixture-name-triage.ts` and `.test.ts` (new), `package.json` script `qa:fixture-name-triage`, any locked test found by running the suite after the edit, `docs/decisions.md` row (Manager), CHANGELOG.

## 7. Story F plan

Rule set (one rule per protected path; ids derived from path; all `effect: deny`, `mandatory: true`, verbs `write, create, modify, delete, move, rename`, targets = canonical path, directory entries end with `/`):

| Group | Paths | Source of the list |
|---|---|---|
| Gate code | every file in the hook's relative-import graph, plus `hooks/pretooluse-kernel-gate.mjs` | GENERATED by the same AST scan as `hook-import-pins.test.ts` (shared helper extracted, no copy) |
| Named, explicit | `docs/qa/s5-central-classification.json`, `src/policy/config/shipped-defaults.json`, `.thoth/policy.json`, `hooks/launch-gate.sh`, `src/qa/gate-launcher-pin-check.ts`, `.claude/settings.json`, `.claude/settings.local.json`, user settings file, `.thoth/halt-state/` (Q3) | A named constant in the test, each entry asserted to exist on disk (user settings: asserted as a rule target only) |

Rule data is produced by a generator `src/qa/protected-path-list.ts` (output committed into `shipped-defaults.json`); the test regenerates and compares, so a stale committed list fails. No list is hand-counted.

| # | Check (failing first) |
|---|---|
| F1, F1a, F1b | `activation-preconditions` in `src/policy/config/activation-preconditions.test.ts`: for the generated plus named list, a Bash redirect write to each path yields DENY with that rule's id (real hook path via `decideToolCall` with the real loaded rules) |
| F2 | The generated half is derived in-test from the AST, compared with the committed rules |
| F3 | Mutant `F3-mutant-drop-rule`: remove one rule, test fails. Mutant `F3-mutant-add-import`: a synthetic extra import in a temp copy of the graph input, test fails |
| F3a | `F3-mutant-drop-fixture-deny`: remove the fixture's rule, test fails (ADR-0003 compliance row) |
| F4 | Path-form cases per protected path: case, `\`, `./`, `..`, absolute, cwd-relative. Passes only if Q2-A is taken; under Q2-B the row is recorded as a known gap |
| F5 | `F5-ap10-paths-edit-deny`: asserts each path has an `Edit(...)` deny line in the PROPOSED settings text `docs/plans/s308-K-proposed-settings-2026-10-04.json` (generated from the same list; not the real settings file); seeded mutant drops one line and fails |
| F6 | Note in the PR only |
| F7 | Decisions row of acceptance; PR marked HELD |
| F-mandatory | Project layer redefining any F rule id is a load failure (Q4) |
| F-read-free | Reads of protected paths still follow the same outcome as an unprotected path (no read-verb deny) |

Disclosed limits to state in the F PR: gate rules alone do not make the fixture unwritable (ADR-0003); non-redirect mutators are stopped by POL-05 (unresolved), not by these rules; MCP writes cannot be path-matched (F6); #406 (NODE_OPTIONS env block) closes only when K ships the settings protection, so F alone does not close it.

Files: `shipped-defaults.json`, `src/qa/protected-path-list.ts` (+ test), shared AST helper extracted from `src/policy/config/hook-import-pins.test.ts` (that file is edited only to import the helper, as a recorded act), `activation-preconditions.test.ts`, `docs/plans/s308-K-proposed-settings-2026-10-04.json` (proposed text only), `package.json` script, optional `src/policy/normalizer/shell.ts` plus path helper (Q2-A), CHANGELOG.

## 8. Story J outline (no entry written; held behind E, F, ADR acceptance)

| Item | Work | Live `claude -p`? | Est. USD (B spent 0.68 for 28 calls, about 0.024 per call) |
|---|---|---|---|
| J1 | Record proposed entry text (matcher `Bash` + `mcp__.*`, timeout 60) in the plan | No | 0 |
| J2 | Four qa checks against a scratch settings copy | No | 0 |
| J3 / U-8 | Bash and MCP call through the real runtime, allow and deny each | Yes, about 6 calls | 0.15 |
| J4 | `npm test` real counts, `qa:*` set, fresh reports | No | 0 |
| J5 | Edit and Write refused on a scratch fixture copy, also under `bypassPermissions` | Yes, about 6 calls | 0.15 |
| J6, J6a | Re-time allow path, launcher form | Local timing only | 0 |
| J8 | Six env-block keys, each reach and block result | Yes, about 12 calls | 0.30 |
| J9 | Compare shell form with exec-form `args` | Yes, about 6 calls | 0.15 |
| J7 | Decisions row of acceptance | No | 0 |
| Total | about 30 live calls | | about 0.75; propose a hard cap of USD 1.50 and a ledger file as in B |

J needs the human's spend approval, E and F built, and Q1's outcome (U-8 under Q1-A will show most Bash denied). J also owns re-closing #401 (K5) only as test design; the K entry check itself ships with K.

## 9. Sequencing for tonight (local branch only)

1. Commit this plan. 2. Manager answers Q1-Q4. 3. E: red tests, then rule data, then E6 script. 4. F: generator, red tests, rule data, proposed settings text. 5. Reviews per tier. 6. Nothing pushed to master; PR marked HELD.

## 10. Verification and rollback

- Each criterion above maps to a named test or script; real counts reported, skipped is not passed.
- Rollback: revert the rule-data commits (shipped-defaults returns to `rules: []`); no wiring exists, so no runtime effect while K is unshipped.

RECEIPT: verdict=BLOCKED criteria="21 mapped/21 total (E1-E7, F1-F7 incl. F1a F1b F3a F5, plus 4 added checks)" checks="0/0/0 (plan only; spike probes run: 4 hook calls, 11 normalizer calls)" adr=HIT(38) pr=n/a
