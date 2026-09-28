# Red Team (Sutekh) — ROUND 2 re-confirm — PR #358 / Issue #312 "sanitize kernel verdict reason and hook deny output"

- **Date:** 2026-09-28
- **Round:** 2 (re-confirm of the fix-now round against the round-1 report, `docs/reviews/s312-kernel-hook-sanitize-red-team-2026-09-28.md`)
- **Scope:** `story/312-kernel-hook-sanitize` vs `master` (PR #358). Tier: CRITICAL.
- **HEAD:** `d494d51 docs(s312): state scope transition (Issue #312, PR #358; resolves cross-domain-reviewer MED / #260)`
- **Round-1 HEAD:** `0afe0ab`. Fix delta reviewed: `0afe0ab..d494d51`.
- **Worktree:** `C:\playground\thoth\.claude\worktrees\agent-a8290b0a912a5c9ce` (isolated; every mutation below was reverted and the tree verified clean afterwards — `git status --porcelain` empty at close)
- **ADR cache:** `ADR cache BUILT: cataloged 2 ADR(s) [adr/devops:0, adr/software-engineering:0, docs/adr:2], catalog now current (fp 9b0b204) [CACHE=HIT]` — THOTH-ADR-0001, THOTH-ADR-0002, both `applicableTo: [security, architecture, code]`.
- **Verdict:** **go** — both round-1 `[HIGH]` findings are independently confirmed CLOSED. No HIGH remains. 5 MED and 4 LOW are open; all are guard-quality or carried-forward residuals, none is a defect in the shipped sanitization behaviour.

## Baseline honesty note (the build agent's "1 fail")

The build agent reported 1510/1511 with 1 fail attributed to stale worktree pollution. That is **not** what it was. The single failure is the QA-14 dogfood test, and it fails whenever the `adr/` submodule is uninitialised. In this fresh worktree I ran `git submodule update --init --depth 1` first, and the baseline is fully green:

```
$ npm run build          # tsc -p tsconfig.json && tsc -p tsconfig.hooks.json
build rc=0
$ npm run lint
lint rc=0
$ node --test
node --test rc=0
tests 1511 / suites 0 / pass 1511 / fail 0 / cancelled 0 / skipped 0 / todo 0
$ npm run qa:kernel-purity            PASS  rc=0
$ npm run qa:normalizer-registry-purity PASS rc=0
$ npm run qa:gate-manifest            PASS  rc=0
$ npm run qa:gate-matcher-drift       PASS  rc=0
$ npm run qa:gate-command-path        PASS  rc=0
$ npm run qa:completeness-claims      PASS  rc=0
```

Two measurement cautions for anyone reproducing this: `npm run -s build | tail` reports the exit code of `tail`, not of `npm` — the real code must be captured with a redirect. And `npm run lint` is `eslint .`, so any scratch file left in the tree is counted; lint on `src hooks` alone is the honest signal.

## One praised decision

The fix went to the root cause rather than the symptom. The trigger comment at `src/policy/gate/render-hook-output.ts:21` — the glob inside a line comment that caused round-1 F1 — was deliberately **left in place**, and `stripComments` was rewritten instead. Rewording the comment would have been cheaper and would have left the next author to step on the same mine. Both named proof-tests I asked for were delivered verbatim, and both are real regression pins against files on disk, not synthetic fixtures.

## Scorecard

| # | Attack | Status | Severity | Evidence |
|---|---|---|---|---|
| R1 | stripComments is still not lexer-aware: a string or regex literal containing a block-comment opener blinds the kernel import scan | BREAKS | MED | demonstrated |
| R2 | AC-7's AST check validates only the property NAME; combined with AC-9's fixed 5-case env list, an env-gated port object bypasses both | BREAKS | MED | demonstrated |
| R3 | AC-7 inspects only the FIRST renderHookOutput call; a decoy call ahead of the real one satisfies it | BREAKS | MED | demonstrated |
| R4 | G21 false-positives on a benign URL inside a block comment, with a message that misdescribes the cause | BREAKS | MED | demonstrated |
| R5 | Issue #361 covers 1 of 3 production hooks; the residual's claimed backlog entry does not exist | BREAKS | MED | demonstrated |
| R6 | F10 carried: the new test file self-asserts PC-11 but is still absent from G19 STORY_TEST_FILES | BREAKS | LOW | code-traced |
| R7 | F7 carried: a zero-width-only rationale still defeats the never-blank invariant | BREAKS | LOW | code-traced |
| R8 | F8 carried: the bidi residual is still not recorded for this surface | BREAKS | LOW | code-traced |
| R9 | F9 carried: policy-authored rationale still has no length cap at the render boundary | BREAKS | LOW | code-traced |
| K1 | Round-1 F1 (M13): node:fs import plus writeFileSync in render-hook-output.ts | SURVIVES (fix confirmed) | — | demonstrated |
| K2 | Round-1 F2 (M15): node:fs plus config import in kernel.ts | SURVIVES (fix confirmed) | — | demonstrated |
| K3 | Repo-wide differential: new stripComments versus the old two-pass, 190 files | SURVIVES | — | demonstrated |
| K4 | Round-1 F3 (M5): env-gated ternary bypass | SURVIVES (fix confirmed) | — | demonstrated |
| K5 | Round-1 M9: benign local-alias hoist no longer false-positives | SURVIVES (fix confirmed) | — | demonstrated |
| K6 | Round-1 F4 (M8): length-gated sanitize skip | SURVIVES (fix confirmed) | — | demonstrated |
| K7 | Round-1 F5 (M11): dropping the sanitize argument now fails the build | SURVIVES (fix confirmed) | — | demonstrated |
| K8 | Round-1 F6: no dated review report | SURVIVES (fix confirmed) | — | code-traced |
| K9 | C1: no second construction route to renderHookOutput | SURVIVES | — | demonstrated |
| K10 | C2 (M14): sanitize module missing at load time | SURVIVES | — | demonstrated |
| K11 | C3: dropping the argument at runtime | SURVIVES | — | demonstrated |
| K12 | C4/C5: the sanitizer itself, and ReDoS/latency | SURVIVES | — | code-traced |
| K13 | C6 (M1): both deny legs funnel through one sanitized call site | SURVIVES | — | demonstrated |
| K14 | C7: allow-path polarity unchanged | SURVIVES | — | code-traced |
| K15 | C8: ADR compliance on this attack surface | SURVIVES | — | code-traced |
| K16 | cross-domain-reviewer MED: state scope/tier transition | SURVIVES (fix confirmed) | — | code-traced |

Ranked by exposure x irreversibility x silence. R1 ranks top because it is the only finding that is silent, security-class, and defeats a named enforcement control; it is nonetheless MED, not HIGH, for the reason stated in its own section.

---

## Part 1 — the round-1 HIGH findings are genuinely closed

### K1 — F1/M13 CLOSED [demonstrated]

Re-ran the exact round-1 drill: a `node:fs` import plus a `writeFileSync` call planted inside what used to be the blinded region of `src/policy/gate/render-hook-output.ts`, with valid TypeScript this time (round 1's drill and this one agree).

```
$ node mutate.mjs src/policy/gate/render-hook-output.ts ...
MUTATED src/policy/gate/render-hook-output.ts   (x2)
$ node --test src/policy/gate/gate-structure.test.ts
OK   G11
OK   G11b
FAIL G15: the gate directory has no node:* import and no import from src/policy/config/
FAIL G18: no write path: neither the hook nor any gate file calls a filesystem-write API (R13)
OK   G21
OK   G19
tests 6 / pass 4 / fail 2 / skipped 0
$ npm run build
build rc=0
```

Round 1: 5 of 5 pass, nothing red. Now G15 and G18 both fire. Confirmed closed.

### K2 — F2/M15 CLOSED [demonstrated]

```
$ node mutate.mjs src/policy/kernel/kernel.ts  # plant node:fs + ../config/sanitize.ts
MUTATED src/policy/kernel/kernel.ts
$ npm run qa:kernel-purity
[QA kernel-purity-check] FAIL: 2 kernel-purity violation(s) found across 4 file(s) under src/policy/kernel/.
  - src/policy/kernel/kernel.ts: [non-relative-import] import "node:fs" is non-relative ... forbidden inside the kernel purity boundary
  - src/policy/kernel/kernel.ts: [out-of-directory-import] import "../config/sanitize.ts" resolves to "src/policy/config/sanitize.ts", outside src/policy/kernel/
rc=1
$ node --test src/qa/kernel-purity-check.test.ts
FAIL every scanned kernel file reports its real import count
FAIL checkKernelPurity: the REAL src/policy/kernel production code is itself pure
tests 56 / pass 54 / fail 2 / skipped 0
```

Round 1: `PASS rc=0`, full suite identical to baseline. Now rc=1 with both violations named. Confirmed closed.

### K3 — repo-wide differential: the rewrite is a strict improvement, 0 regressions [demonstrated]

I built two instruments rather than reasoning about the rewrite.

**Instrument A — new versus old, directly (no oracle involved), over every `.ts`/`.mjs`/`.js` under `src/` and `hooks/`:**

```
scanned files: 190
REGRESSION: NEW loses MORE code than OLD: 0
FIX: NEW recovers code OLD lost: 17
  src/policy/config/printer.test.ts                recovered=2207
  src/qa/reference-resolver.ts                     recovered=1909
  src/qa/normalizer-registry-purity-check.ts       recovered=1460
  src/qa/shell-detector-mutants.ts                 recovered=1139
  src/qa/kernel-purity-check.ts                    recovered=985
  src/policy/gate/render-hook-output.ts            recovered=567
  hooks/pretooluse-kernel-gate.mjs                 recovered=495
  src/policy/rule/schema.ts                        recovered=427
  src/policy/rule/precedence.ts                    recovered=347
  src/policy/normalizer/shell-scanner-work.test.ts recovered=268
  src/policy/config/echo-sanitize.test.ts          recovered=258
  src/policy/kernel/kernel.ts                      recovered=148
  src/policy/config/sanitize.test.ts               recovered=147
  src/policy/kernel/rule-types.ts                  recovered=129
  src/policy/normalizer/registry.ts                recovered=88
  src/qa/kernel-purity-check.test.ts               recovered=35
  src/policy/kernel/action-record.ts               recovered=28
```

Zero files are worse off. Every one of round 1's named blind files is on the recovered list, including `src/policy/normalizer/registry.ts` (round 1: `BLIND: visible=0 actual-import-lines=1`).

**Instrument B — the shipped import scan versus a TypeScript-AST ground truth, same 190 files:**

```
files scanned: 190
files where the shipped import scan MISSES a real AST import: 6
  src/qa/completeness-claim-checker.test.ts   missed ["node:fs/promises"]
  src/qa/gate-matcher-drift-check.test.ts     missed ["../policy/tools/builtin-tool-inventory.ts","node:fs/promises"]
  src/qa/gate-matcher-drift-check.ts          missed ["node:fs/promises"]
  src/qa/reference-resolver.test.ts           missed ["node:fs/promises","../lib/fs-walk.ts","node:fs"]
  src/secret-scan/history-scan.test.ts        missed ["../qa/completeness-claim-checker.ts"]
  hooks/pretooluse-kernel-gate.mjs            missed 6 specifiers
```

All six are `await import(...)` call sites, which `extractImportSpecifiers` never claimed to match (`FROM_IMPORT_RE` and `BARE_IMPORT_RE` only, `kernel-purity-check.ts:435-436`) — verified by reading two of them, e.g. `src/qa/gate-matcher-drift-check.test.ts:54-55`. None of the six is under `src/policy/kernel/`, `src/policy/normalizer/registry.ts`, or `src/policy/gate/` — the three enforced surfaces. Dynamic imports inside a kernel file are separately caught by the forbidden-globals pattern `dynamic import(`.

**Zero enforced-surface blindness on the tree as it stands today. That is a measured figure, not an estimate.**

### K4 to K7 — the three MED fixes, each re-drilled

**K4 — M5, the env-gated ternary bypass [demonstrated].** Round 1: 17 of 17 pass, bypass live. Now:

```
FAIL AC-9: the hook sanitizes a hostile rationale unconditionally, regardless of environment variables
FAIL AC-7: hooks/pretooluse-kernel-gate.mjs unconditionally wires sanitizeForTerminal as renderHookOutput's second argument
tests 11 / pass 9 / fail 2 / skipped 0
```

Killed twice over, by the source-level guard and the behavioural one. Confirmed closed.

**K5 — M9, the benign hoist [demonstrated].** Round 1 the guard false-positived on it (1 fail). Now:

```
$ # hook becomes: const sanitizePort = sanitizeMod.sanitizeForTerminal; render.renderHookOutput(..., sanitizePort);
tests 11 / pass 11 / fail 0 / skipped 0
```

The false positive is gone. That matters as much as the bypass fix: round 1's combination (blocks the benign edit, waves the harmful one through) is the shape this repo already lived through in the Issue #332 saga.

**K6 — M8, the length-gated skip [demonstrated].** Round 1: 22 of 22 pass, raw ESC at 1632 chars end-to-end. Now:

```
$ # render-hook-output.ts: const cleaned = reason.length > 1000 ? reason : sanitize(reason);
FAIL AC-10: a very long hostile rationale (over 1632 characters) is sanitized end-to-end through the real hook
FAIL AC-10: a hostile reason is sanitized at every length - 10, 1000 and 100000 characters
tests 27 / pass 25 / fail 2 / skipped 0
```

Both the unit pin and the real-hook pin fire. Confirmed closed.

**K7 — M11, dropping the sanitize argument [demonstrated].** Round 1: `npm run build` rc=0, silent.

```
$ npm run build
> tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.hooks.json
hooks/pretooluse-kernel-gate.mjs(198,27): error TS2554: Expected 2 arguments, but got 1.
npm run build rc=2
```

Confirmed closed **for `hooks/pretooluse-kernel-gate.mjs`**. See R5 for the two hooks still outside the project.

### K8 to K16 — round-1 CLEAN findings regression-checked, not assumed

- **K8 — F6 [code-traced].** Three dated reports now exist: `s312-kernel-hook-sanitize-{red-team,app-security,cross-domain}-2026-09-28.md`. Process gate discharged.
- **K9 — C1 [demonstrated].** A grep over `.ts`/`.mjs`/`.js` still finds exactly one production call site (`hooks/pretooluse-kernel-gate.mjs:198`) and one export (`render-hook-output.ts:68`); every other hit is a test or a comment. No barrel, no second route.
- **K10 — C2/M14 [demonstrated].** Dynamic import repointed at a nonexistent module, run through the real spawned hook in the pinned sandbox:
  ```
  RT DENY  code=2 stdout="" stderr="pretooluse-kernel-gate.mjs: internal exception, fail-closed (exit 2). ... Error type: Error"
  RT OTHER code=2 stdout="" stderr="... fail-closed (exit 2) ... Error type: Error"
  ```
  Fail-closed on every path. The praised decision from round 1 survives unchanged.
- **K11 — C3 [demonstrated].** Argument dropped at runtime: `code=2 ... Error type: TypeError` on both legs. Never fail-open.
- **K12 — C4/C5 [code-traced].** `src/policy/config/sanitize.ts` is byte-unchanged across the whole PR (`git diff --name-only c2750a2..d494d51` does not list it), so round 1's BMP sweep result and the linear-latency measurement carry unchanged; the sweep test itself is green in the 1511-pass run.
- **K13 — C6/M1 [demonstrated].** Removing the `sanitize(...)` call is now killed by **8** tests spanning both deny legs, unit and end-to-end (round 1: 5). `tests 20 / pass 12 / fail 8 / skipped 0`.
- **K14 — C7 [code-traced].** AC-3 spy-counts zero sanitize invocations on allow and is green in the full run; the early-return allow branch in `render-hook-output.ts:76` is unchanged in this delta. I could not construct a real allow through the sandbox (every payload I tried resolved to a refusal or a POL-05 deny), so this is downgraded from round 1's demonstrated to code-traced rather than overclaimed.
- **K15 — C8 [code-traced].** THOTH-ADR-0001: the fix delta touches no fixture loader, no path resolution, no halt-state code, and hardcodes no `knownConnectors` or `centralLayer.tools` entry — the new AC-9/AC-10 tests derive the server name from `firstCommittedEntryName()`. ADR-0001's clause that a PR changing the hooks that read the fixture still needs a fresh dated review report is now satisfied (K8). THOTH-ADR-0002: allowlist, patterns and the reviews baseline guard untouched. No violation on either.
- **K16 — cross-domain MED [code-traced].** `docs/.maat-state.json` now reads `scope=s312-kernel-hook-sanitize`, `tier=CRITICAL`, `reviewRoundsSinceClean=1`, `reviewRoundsTotal=1`, `humanRulingRequired=false`. Transition confirmed.

---

## Part 2 — new findings against the fix itself

## R1 — [ISSUE][MED][demonstrated] stripComments is still not lexer-aware: a string or regex literal containing a block-comment opener blinds the kernel import scan, silently

`Exposure: 0 of 190 scanned sources today (measured, instrument A/B above); latent on 4 of 4 kernel files and 1 normalizer file, which have no differential guard. Basis: measured.`
*(Security / control-integrity category.)*

**Why this is MED and not HIGH, stated plainly.** Round-1 F2 was HIGH because the control was **off right now**: 4 of 4 kernel files reported zero visible imports on the tree as it stood. That is fixed and verified (K2, K3). What remains is that the control can be silently switched **back** off by a future edit of a specific shape, with no guard covering the kernel or normalizer lanes. By my own round-1 calibration that is the same class as F3 ("the guard is defeated by a future refactor"), which I rated MED. Consistency requires MED here. I am naming this explicitly so the audit can check that I did not move the goalposts after the team delivered exactly the two proof-tests I asked for.

**Scenario.** A later story adds a path constant to a kernel file — `const KERNEL_GLOB = "src/policy/kernel/**"` — the same documentation-of-the-boundary reflex that caused F1, now in a string instead of a comment. Everything below it, up to the next `*/` in the file, becomes invisible to the import scan.

**Probe: the new scan versus the old, on ten constructed shapes** (`NEWkeeps` means the code after the poison line survives stripping):

```
A: url in a // line comment                           NEW=true  OLD=true
B: glob in a // line comment (the F1 shape)           NEW=true  OLD=false   <- the fix
C: url inside a block comment                         NEW=true  OLD=true
D: string literal with an unterminated block opener   NEW=false OLD=true    <- NEW is worse
E: string literal opener plus a later */ in a jsdoc   NEW=false OLD=false   <- both blind
F: template literal containing //                     NEW=true  OLD=true
G: regex literal containing //                        NEW=true  OLD=true
H: unterminated block comment at EOF                  NEW=false OLD=true    <- NEW is worse
I: nested-looking block opener                        NEW=true  OLD=true
J: // inside a block that closes on the same line     NEW=true  OLD=true
```

So the rewrite does trade slightly in two directions (D, H: an unterminated opener now consumes to EOF, where the old regex required a closer and left the code visible). Neither shape exists in the tree today — instrument A found 0 regressions across 190 files — so the trade costs nothing measurable right now. **Shape E is the exploitable one, and it is blind on both implementations: a surviving residual of the same root cause, not something this round introduced.**

**Drill N2 — full silent bypass of the production instrument.** Poison string placed *after* the three pinned imports, so the import-count pin's expected map is unchanged, then a real `node:fs` import and a real `readFileSync` call wired into an exported function:

```
src/policy/kernel/kernel.ts:
  import type { Verdict, VerdictOutcome } from "./verdict.ts";
  const KERNEL_GLOB = "src/policy/kernel/**";
  import { readFileSync } from "node:fs";
  import { sanitizeForTerminal } from "../config/sanitize.ts";
  ...
  function auditTrail(p) { return sanitizeForTerminal(readFileSync(p, "utf8") + KERNEL_GLOB); }
  export const AUDIT = auditTrail;
```

```
$ npm run qa:kernel-purity
[QA kernel-purity-check] PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.
rc=0
$ npm run build                      rc=0
$ npx eslint src hooks               rc=0
$ node --test src/qa/*.test.ts src/policy/kernel/*.test.ts src/policy/gate/*.test.ts
tests 516 / pass 516 / fail 0 / skipped 0
$ node --test
tests 1511 / pass 1511 / fail 0 / skipped 0
```

Byte-identical to the clean baseline, with a live filesystem read inside the policy kernel.

**Current defense, honestly assessed.**
- `G21` is a real differential guard, but it iterates `gateSources()` only — the **gate** lane. It does not cover `src/policy/kernel/**` or `src/policy/normalizer/registry.ts`, the other two `stripComments` consumers. Verified: G21 passed 6 of 6 throughout drill N2.
- The new `every scanned kernel file reports its real import count` pin is a genuine improvement and did catch my first attempt (N1, poison placed *before* the imports, which shifted `kernel.ts` from 3 to 1). It is a count pin, not a blindness detector, so moving the poison two lines down defeats it.
- The AST forbidden-globals layer does not use `stripComments` and still fires — but it catches forbidden *roots* (`globalThis`, `process`, `eval`, ...), not a local binding from a `node:fs` import. Same honest limit as round 1.

**Verdict: BREAKS.**

**Named proof-test required.**
`src/qa/kernel-purity-check.test.ts :: "stripComments agrees with a TypeScript-scanner strip on every scanned production source (kernel, normalizer registry, gate)"` — the differential G21 already does for the gate lane, extended to every lane the instrument enforces, and oracled against `ts.createScanner` rather than a second hand-written stripper. `kernel-purity-check.ts` already imports `typescript` (line 104) for its AST layer, so the fix is to derive `stripComments` from the scanner's own comment-trivia tokens and delete the hand-rolled scan entirely. That closes R1 and R4 together and makes the D/H trade moot.

---

## R2 — [ISSUE][MED][demonstrated] AC-7 validates only the property NAME, and AC-9's env matrix is a fixed allowlist: together they pass an env-gated bypass that leaks raw ESC and NUL through the real hook

`Exposure: 100% of future refactors of the one call site that introduce a port object; basis: counted in code (one call site, hooks/pretooluse-kernel-gate.mjs:198).`

Two independent gaps that compose:

1. `isSanitizeForTerminalAccess` (`src/policy/config/sanitize.test.ts:135-137`) returns true for **any** property access whose name is `sanitizeForTerminal`. It never checks that the object resolves to the `src/policy/config/sanitize.ts` import binding. A local object literal with that property name satisfies it.
2. AC-9 iterates a hard-coded list of five environment cases (`{}`, `THOTH_RAW_REASON` x2, `NODE_ENV`, `THOTH_DEBUG`). A bypass keyed on any other variable name is invisible to it. Its own header states the intent is "to prove sanitization does not depend on ambient environment state" — a fixed allowlist cannot prove a negative over an open set.

**Drill N4 — the composed bypass.** `hooks/pretooluse-kernel-gate.mjs:198` becomes:

```js
const sanitizePort = { sanitizeForTerminal: process.env.THOTH_PLAIN_REASON ? ((s) => s) : sanitizeMod.sanitizeForTerminal };
const output = render.renderHookOutput(gate.decideToolCall(input, ports), sanitizePort.sanitizeForTerminal);
```

```
$ node --test src/policy/config/sanitize.test.ts hooks/pretooluse-kernel-gate-sanitize.test.ts \
             src/policy/gate/render-hook-output.test.ts src/policy/gate/gate-structure.test.ts
tests 26 / pass 26 / fail 0 / skipped 0
```

And the bypass is live through the **real spawned hook** in the pinned copy-tree sandbox:

```
RT ENV={}                              rawESC=false rawNUL=false out="[31mREJECTED-LOOKALIKE: forged linesecondthirdfourth[2J"
RT ENV={"THOTH_PLAIN_REASON":"1"}      rawESC=true  rawNUL=true  out="ESC[31m<LF>REJECTED-LOOKALIKE: forged line secondthird<CR>fourth<NUL>[2J"
```

That is round-1 F3 reconstituted through a different shape: raw ESC, raw NUL and a forged line break reaching the operator-facing deny reason, with every guard green.

**Current defense, credited honestly.** AC-9 is a genuine improvement and is not decorative — it kills the *unconditional* bypasses outright (see R3's drill, where AC-8 x2, AC-9 and AC-10 all fire). The ternary shape I demonstrated in round 1 is dead. What survives is specifically the pairing of a name-only AST check with a finite env matrix.

**Verdict: BREAKS.**

**Named proof-test required.**
`src/policy/config/sanitize.test.ts :: "AC-7b: renderHookOutput's second argument resolves to the binding imported from src/policy/config/sanitize.ts, not merely to a property named sanitizeForTerminal"` — resolve the property-access object back to the dynamic-import destructuring, and reject an object-literal or any other origin.

---

## R3 — [ISSUE][MED][demonstrated] AC-7 inspects only the FIRST renderHookOutput call; a decoy call ahead of the real one satisfies it

`Exposure: 100% of future edits that add a second renderHookOutput call site; basis: counted in code (findRenderHookOutputSecondArg returns on first match, src/policy/config/sanitize.test.ts:139-148).`

**Drill N5.**

```js
if (process.env.THOTH_NEVER_SET) render.renderHookOutput(null, sanitizeMod.sanitizeForTerminal);
const output = render.renderHookOutput(gate.decideToolCall(input, ports), (s) => s);
```

```
$ node --test src/policy/config/sanitize.test.ts
tests 7 / pass 7 / fail 0 / skipped 0
```

AC-7 is fully satisfied while the real call site passes a raw identity function.

**Current defense, credited honestly.** AC-9 catches this one, because the identity is unconditional:

```
FAIL AC-8 (rationale)   FAIL AC-8 (id-fallback)   FAIL AC-9   FAIL AC-10
tests 5 / pass 1 / fail 4
```

So R3 alone is not exploitable end-to-end — but composed with R2's env gate it would be, and the finding stands as a defect in AC-7's own contract ("the real `renderHookOutput(...)` call", per its header comment; it finds *a* call, not *the* call).

**Verdict: BREAKS.**

**Named proof-test required.**
`src/policy/config/sanitize.test.ts :: "AC-7c: hooks/pretooluse-kernel-gate.mjs contains exactly one renderHookOutput call site, and it is the one AC-7 checks"` — assert the count, then check every call found, not the first.

---

## R4 — [ISSUE][MED][demonstrated] G21 false-positives on a benign URL inside a block comment, and its failure message misdescribes the cause

`Exposure: 100% of future gate-file edits that put a URL (or any //) inside a block comment that closes on the same line; basis: counted in code (G21 asserts strict length equality between two strippers that genuinely disagree on that input).`

G21's oracle, `lineFirstThenBlock`, strips `//` line comments first. For a single-line block comment containing `//`, the line-strip eats the block's own `*/` terminator, so the block regex can no longer match and the oracle keeps the whole comment. The two strippers then disagree by construction, on entirely correct code.

**Drill N3 — one added line, nothing wrong with it:**

```
src/policy/gate/render-hook-output.ts:
  /* See https://example.com/spec for the PreToolUse contract. */
  export interface HookOutput {
```

```
$ node --test src/policy/gate/gate-structure.test.ts
OK G11   OK G11b   OK G15   OK G18   OK G19
FAIL G21: every gate source is fully visible to the structural scanner
  AssertionError: render-hook-output.ts: stripComments (2124 chars) disagrees with an
  independently-ordered strip (1489 chars) - a // comment is opening a real block comment
  (or vice versa) and swallowing real code
tests 6 / pass 5 / fail 1 / skipped 0
```

Two problems, not one. The guard blocks a benign edit; and the message asserts that real code is being swallowed when the opposite happened — `stripComments` kept **635 characters more** than the oracle, which is the safe direction. An author hitting this is told to look for a bug that does not exist, in the file they just correctly documented.

This is the exact failure mode this repo already paid for in the Issue #332 / R1-6 saga and that I named in round-1 F3: a guard that blocks the benign edit trains the next author to loosen the guard rather than the invariant.

**Current defense, honestly assessed.** G21 does work for what it was built for: it is direction-blind but it would fire on a reverted `stripComments`, and it fired on none of my legitimate drills. The defect is precision, not absence.

**Verdict: BREAKS.**

**Named proof-test required.**
`src/policy/gate/gate-structure.test.ts :: "G21: stripComments agrees with a TypeScript-scanner comment strip on every gate source"` — replace the second hand-written stripper with `ts.createScanner` comment trivia (the same change R1 asks for), which is a correct oracle and has no disagreement to false-positive on. Add `/* see https://example.com */` as an inline fixture so the regression is pinned.

---

## R5 — [ISSUE][MED][demonstrated] Issue #361 is closed for 1 of the 3 hooks its own title names, and the residual's claimed backlog entry does not exist

`Exposure: 2 of 3 production enforcement hooks (hooks/sessionstart-tool-enum.mjs, hooks/userpromptsubmit-halt-relay.mjs); basis: counted in code (tsconfig.hooks.json include list is a single file).`

`tsconfig.hooks.json:38` is `"include": ["hooks/pretooluse-kernel-gate.mjs"]`. The narrowing is argued at length in that file's header and the argument is sound as far as it goes — I verified the claim rather than taking it:

```
$ # tsconfig.hooks.json include widened to all 3 hooks
$ npx tsc --noEmit -p tsconfig.hooks.json
rc=2, 54 errors
  30  hooks/sessionstart-tool-enum.mjs
  22  hooks/userpromptsubmit-halt-relay.mjs
  40x TS7006, 3x TS7031, 2x TS7053   (implicit-any, annotation noise)
   6x TS2339, 1x TS2322              (inference artifacts on un-annotated locals; I read all 7, none is a real defect)
```

So "~60 pre-existing errors, all unrelated" is honest (54, all noise-class), and deferring is a defensible call.

**What is not honest is where the residual was recorded.** `tsconfig.hooks.json:30-31` states: *"Widening this project to the other 2 hooks is left as a backlog candidate (docs/backlog.md), not silently expanded into this round."*

```
$ grep -n -i "tsconfig.hooks|361|typecheck" docs/backlog.md
(no matches)
$ git log --oneline -2 -- docs/backlog.md
f663d6b docs(s7b): ...          # docs/backlog.md untouched by this round
$ gh issue list --state all --search "tsconfig hooks typecheck"
[]
```

No backlog line, no Issue. The residual exists only as a source comment that points at a register where it was never written. CLAUDE.md's hard rule routes out-of-scope work to `docs/backlog.md` or an Issue; PRINCIPLES rule 13 forbids a silently-skipped gate. A comment claiming a register entry that does not exist is worse than no comment, because it reads as done.

**The gap is real, demonstrated on the uncovered hook (drill N6):**

```
$ # hooks/sessionstart-tool-enum.mjs: evaluateToolInventory(merged, sessionTools) -> evaluateToolInventory(merged)
$ npm run build
npm run build rc=0
$ npx eslint hooks/sessionstart-tool-enum.mjs
  472:9  error  'sessionTools' is assigned a value but never used  no-unused-vars
eslint rc=1
```

rc=0 from the build, exactly the M11 gap. ESLint catches it only incidentally, via the now-dead binding — the same incidental catch I flagged in round-1 F5.

**Current defense, credited honestly.** The runtime tests do catch this mutant loudly (`node --test hooks/sessionstart*.test.ts` produced 10+ failures), so this is a defence-in-depth gap rather than an unguarded hole. That is why it is MED, not HIGH.

**Verdict: BREAKS** (Issue #361 is 1/3 resolved, and its residual is unregistered).

**Named proof-test required.**
`src/qa/*.test.ts :: "every production hook under hooks/ is covered by a typecheck project"` — the instrument I asked for in round-1 F5, unchanged: enumerate `hooks/*.mjs` from disk and assert each resolves inside a tsconfig file list, so the set is generated rather than hand-listed (CLAUDE.md, "No hand-derived completeness claims"). Until the other two hooks are fixable, that test can carry an explicit, dated, named-exception list of two — which is a register that cannot silently rot, unlike a prose comment.

---

## R6 to R9 — carried forward from round 1, unchanged by this delta [all code-traced]

None of these was in the fix-now scope, and none is addressed by `0afe0ab..d494d51`. Re-stated so the register is complete, re-tagged `code-traced` (I verified the relevant code is byte-unchanged rather than re-running round 1's end-to-end probes).

- **R6 (F10) [LOW].** `hooks/pretooluse-kernel-gate-sanitize.test.ts` still self-asserts PC-11 compliance and is still absent from `gate-structure.test.ts`'s `STORY_TEST_FILES` (lines 70-86, re-read at HEAD). A hand-asserted completeness claim with no instrument. One-line fix.
- **R7 (F7) [LOW].** `isNonEmptyString` still tests `length > 0` and `sanitizeForTerminal` still keeps `\p{Cf}` (both files unchanged in the delta), so a rationale of only zero-width characters is non-empty by length and blank on screen. Still denies, so signal quality, not fail-open. `Exposure: 0% of shipped rules today; basis: counted in code.`
- **R8 (F8) [LOW].** The bidi/format-character residual is still recorded only in `sanitize.ts`'s source comment and inherited from the `policy:print` acceptance (#294/#278); `docs/decisions.md` carries no #312 row re-assessing it for a deny-render surface a human reads while deciding to override. `Exposure: 0% of shipped rules today; basis: counted in code.`
- **R9 (F9) [LOW].** Policy-authored `rationale` still has no length cap at the render boundary while the untrusted `tool_name` has `REASON_NAME_CAP = 512` (`decide-tool-call.ts:55-59`). Latency is not the risk; model-context flooding is. `Exposure: unbounded per deny; basis: counted in code.`

---

## Hostile lens — compromised CI runner

Round 1's lower-privilege path is closed: typing a glob into a `//` comment no longer disables anything, and the two proof-tests make a reversion of `stripComments` fail loud in the gate lane. The residual path is narrower but the same shape — an attacker with ordinary commit access writes a path constant as a **string** in a kernel file (R1), which reads as unremarkable documentation and silently reopens the import boundary for that file, with no guard in the kernel lane to notice. That, and the AC-7 port-object shape in R2, are the weakest links in this chain now. Both are ordinary-looking, reviewable-looking edits; neither needs workflow-editing privileges.

## Environment note (reproducibility)

`npm ci` plus `git submodule update --init --depth 1` gives a fully green baseline here (1511/1511, 0 skipped). Without the submodule init, QA-14 dogfood fails with `ADR-0021 ... no ADR with this id exists in the tree` — that is the "1 fail" earlier runs saw, and it is environmental, not worktree pollution. Every mutation drill above was measured as a differential against the green baseline and reverted; `git status --porcelain` is empty at close and HEAD is unmoved at `d494d51`.

## Editorial (verdict-neutral, plain edits, no re-review)

- `src/qa/kernel-purity-check.ts:167-168` claims the rewrite has the "Same net stripping behavior as before for every well-formed, non-interacting input". Shapes D and H above are counterexamples (an unterminated opener now consumes to EOF where the old regex left the code visible). Harmless today (0 files), but the sentence is stronger than the code.
- The same header calls the helper "Heuristic-only comment stripping (documented as such, not claimed exhaustive)" and then the fix narrative reads as though the heuristic is now sound. Naming the two known residual classes explicitly — string literals and regex literals — would keep the disclosure honest.
- `G21`'s assertion message names one cause ("a `//` comment is opening a real block comment") for a symptom that has two, including the benign direction (R4). Make the message report which side lost characters.
- `tsconfig.hooks.json:30-31` cites a `docs/backlog.md` entry that does not exist (R5). Either write the line or drop the citation.

## Open findings vs failing tests

9 open findings; 9 have an executable form named above (R1 to the scanner-oracled differential, R2 to AC-7b, R3 to AC-7c, R4 to the G21 oracle replacement plus its fixture, R5 to the hook-typecheck-coverage instrument, R6 to a one-line `STORY_TEST_FILES` addition, R7 to AC-11, R9 to a render-boundary cap test). R8 is the one that resolves to a register line rather than a test — a `docs/decisions.md` residual row for this surface — unless the Manager elects to extend the strip class to `\p{Cf}` at the deny-render boundary, in which case it becomes a `sanitize.test.ts` oracle change. So: 9 findings, 8 failing tests, 1 register line, stated rather than papered over.

## Scariest unproven assumption

**That `stripComments` is now correct, rather than correct for the one interaction that was demonstrated against it.** It is a hand-rolled character scan standing in for a lexer, in a file that already imports the TypeScript compiler two layers down. Round 1's door is shut and pinned; the string-literal and regex-literal doors are open, unguarded in the kernel and normalizer lanes, and I walked a live `readFileSync` through one of them with 1511 of 1511 green. Every purity claim this project makes still rests on that scan being right about a language it does not parse.

## Go / no-go

**go.** Both round-1 `[HIGH]` findings are independently confirmed closed by their own named proof-tests, and the tests delivered are the ones I asked for, not weaker substitutes. The repo-wide differential shows the rewrite is a strict improvement with zero regressions across 190 files. The shipped sanitization behaviour — the thing this story set out to do — remains correct, complete across both deny legs, proven end-to-end, and fails closed under every partial-failure drill, now backed by a genuinely behavioural guard (AC-9/AC-10) instead of a source-text regex.

What is open is guard quality, not shipped behaviour: five MED findings, all of which are "this guard would not catch a future edit of shape X", and four carried-forward LOWs. By PRINCIPLES rule 19 those become failing tests, not a numbered conditions list, and by rule 12 the ones outside this story's scope become Issues. Blocking a second time on a residual of a defect whose named remediation was delivered in full would be goalpost-moving, and would push an otherwise-healthy loop toward rule 16 ceremony for work that is better done as its own story.

**Conditions the Manager should carry (not gating):** R5 means Issue #361 must stay open, and its unregistered residual needs a `docs/backlog.md` line or an Issue before merge-handoff, because that is a CLAUDE.md hard rule rather than a quality preference. R2 means Issue #360 must stay open.

## Single next action

Derive `stripComments` from `ts.createScanner`'s comment-trivia tokens instead of the hand-rolled character scan — `src/qa/kernel-purity-check.ts` already imports `typescript` at line 104 for its AST layer — then re-point G21's oracle at the same scanner and extend the differential from `gateSources()` to every lane the instrument enforces. That one change closes R1 and R4 together, removes the D/H trade, and makes the purity claim true about the language it is checking.

---

```
RECEIPT: verdict=go
attacks (ranked by blast radius):
1. [ISSUE][MED][demonstrated] stripComments is still not lexer-aware: a string/regex literal holding a block-comment opener blinds the kernel import scan — drill N2 planted a KERNEL_GLOB string constant after the pinned imports plus a real node:fs import and a live readFileSync call, and qa:kernel-purity PASSED rc=0, build rc=0, eslint rc=0, full suite 1511/1511 identical to baseline; defense assessed: G21 covers the gate lane only (passed 6/6 throughout), the new import-count pin is a count pin not a blindness detector (it caught the poison placed BEFORE the imports, N1, and missed it two lines later), the AST forbidden-globals layer catches roots not local import bindings. MED not HIGH, stated explicitly: round-1 F2 was HIGH because the control was OFF on 4/4 kernel files that day; it is now ON and this is a latent future-edit trap, the same calibration as round-1 F3. Pre-existing on the old implementation too (probe shape E: NEW=false OLD=false), not introduced by this round. Exposure: 0 of 190 sources today, latent on 4/4 kernel + 1 normalizer file with no differential guard, basis: measured.
2. [ISSUE][MED][demonstrated] AC-7's AST check accepts ANY property access named sanitizeForTerminal (sanitize.test.ts:135-137 never resolves the object back to the sanitize-module import) and AC-9's env matrix is a fixed 5-case list — drill N4's env-gated port-object literal passes 26/26 scoped tests while the real spawned hook emits raw ESC, raw NUL and a forged line break under one unlisted env var; defense assessed: AC-9 is a real improvement and kills every UNCONDITIONAL bypass (round-1 M5 now dies twice over), so only the name-only-check plus finite-env-list pairing survives. Exposure: 100% of future refactors of the one call site that introduce a port object, basis: counted in code.
3. [ISSUE][MED][demonstrated] AC-7 inspects only the FIRST renderHookOutput call (findRenderHookOutputSecondArg returns on first match, sanitize.test.ts:139-148) — drill N5's decoy call ahead of a real call site passing raw identity passes AC-7 7/7; defense assessed: AC-9 DOES catch this one (4 fails including both AC-8s and AC-10) because the identity is unconditional, so it is exploitable only composed with finding 2 — but AC-7's own header claims it finds "the real call", and it finds a call. Exposure: 100% of future edits adding a second call site, basis: counted in code.
4. [ISSUE][MED][demonstrated] G21 false-positives on a benign URL inside a block comment and its message misdescribes the cause — drill N3 added a one-line block comment containing a URL to render-hook-output.ts and G21 failed claiming real code was being swallowed, when stripComments in fact kept 635 chars MORE than the oracle (2124 vs 1489, the safe direction); root cause: the lineFirstThenBlock oracle's line-strip eats the block's own terminator on a single-line block containing a line-comment marker; defense assessed: G21 is direction-blind but does work for reversion detection and fired on none of my legitimate drills — the defect is precision. This is the Issue #332 / R1-6 failure mode: blocks the benign edit, trains the next author to loosen the guard. Exposure: 100% of future gate-file edits putting a URL or any line-comment marker inside a same-line block comment, basis: counted in code.
5. [ISSUE][MED][demonstrated] Issue #361 is resolved for 1 of the 3 hooks its own title names, and the residual is registered nowhere — drill N6 dropped a required argument in hooks/sessionstart-tool-enum.mjs and npm run build returned rc=0 (eslint caught it only incidentally via the dead binding, exactly the round-1 F5 shape); the "~60 pre-existing errors" deferral claim verified honest (54 errors: 30 plus 22 across the two hooks, 45 implicit-any/noise, 7 inference artifacts I read individually, 0 real defects); BUT tsconfig.hooks.json:30-31 cites a docs/backlog.md entry that does not exist (grep empty, file untouched by this round) and no Issue was filed — CLAUDE.md hard rule plus PRINCIPLES rule 13; defense assessed: the runtime test suite DOES catch the N6 mutant loudly (10+ failures), so this is defence-in-depth, not an unguarded hole. Exposure: 2 of 3 production enforcement hooks, basis: counted in code.
6. [ISSUE][LOW][code-traced] F10 carried: hooks/pretooluse-kernel-gate-sanitize.test.ts still self-asserts PC-11 and is still absent from gate-structure.test.ts STORY_TEST_FILES (lines 70-86 re-read at HEAD); defense assessed: none — a hand-asserted completeness claim with no instrument.
7. [ISSUE][LOW][code-traced] F7 carried: isNonEmptyString still tests length greater than 0 and the strip class still keeps the format-character class (both files byte-unchanged in this delta), so a zero-width-only rationale is non-empty by length and blank on screen; defense assessed: still denies, so signal quality, not fail-open. Exposure: 0% of shipped rules today, basis: counted in code.
8. [ISSUE][LOW][code-traced] F8 carried: the bidi/format-character residual is still recorded only in sanitize.ts's source comment, inherited from the #294 policy:print acceptance, with no #312 row in docs/decisions.md re-assessing it for a deny-render surface a human reads while deciding to override. Exposure: 0% of shipped rules today, basis: counted in code.
9. [ISSUE][LOW][code-traced] F9 carried: policy-authored rationale still has no length cap at the render boundary while untrusted tool_name has REASON_NAME_CAP=512 (decide-tool-call.ts:55-59); defense assessed: none; the risk is model-context flooding, not latency. Exposure: unbounded per deny, basis: counted in code.
10. [CLEAN][demonstrated] Round-1 F1 CLOSED (drill M13): a node:fs import plus writeFileSync planted in render-hook-output.ts now fails G15 AND G18 (tests 6 / pass 4 / fail 2); round 1 was 5/5 green. The fix went to the root cause — the triggering comment at line 21 was deliberately left in place.
11. [CLEAN][demonstrated] Round-1 F2 CLOSED (drill M15): node:fs plus ../config/sanitize.ts planted in kernel.ts now gives qa:kernel-purity FAIL rc=1 naming both violations, plus 2 test failures; round 1 was PASS rc=0 with the full suite identical to baseline.
12. [CLEAN][demonstrated] Repo-wide differential over 190 sources, new stripComments vs the old two-pass, compared directly with no oracle: 0 files where NEW loses more code, 17 files recovered (printer.test.ts 2207, reference-resolver.ts 1909, normalizer-registry-purity-check.ts 1460, down to kernel.ts 148 and registry.ts 88). A second instrument against a TypeScript-AST ground truth finds 6 files whose imports the scan misses — all dynamic await-import call sites, a documented extractor-regex limit, none on an enforced surface. The rewrite is a strict improvement.
13. [CLEAN][demonstrated] Round-1 F3/M5 CLOSED: the env-gated ternary bypass now fails BOTH AC-7 and AC-9 (tests 11 / pass 9 / fail 2); round 1 was 17/17 green with the bypass live.
14. [CLEAN][demonstrated] Round-1 M9 CLOSED: the benign local-alias hoist now passes 11/11 — the round-1 false positive is gone, which matters as much as the bypass fix.
15. [CLEAN][demonstrated] Round-1 F4/M8 CLOSED: the length-gated skip now fails both AC-10s, the unit pin and the real-hook pin (tests 27 / pass 25 / fail 2); round 1 was 22/22 green leaking raw ESC at 1632 chars.
16. [CLEAN][demonstrated] Round-1 F5/M11 CLOSED for the covered hook: dropping the sanitize argument gives npm run build rc=2 with TS2554 Expected 2 arguments but got 1; round 1 was rc=0 and silent.
17. [CLEAN][code-traced] Round-1 F6 CLOSED: three dated s312 reports now exist in docs/reviews/ (red-team, app-security, cross-domain), satisfying the CLAUDE.md hard rule and THOTH-ADR-0001's clause that a PR changing the hooks that read the fixture still needs a fresh dated review report.
18. [CLEAN][demonstrated] C1 holds: still exactly one production call site (hooks/pretooluse-kernel-gate.mjs:198) and one export (render-hook-output.ts:68) across .ts/.mjs/.js; no barrel, no second construction route.
19. [CLEAN][demonstrated] C2/M14 holds: the sanitize module repointed at a nonexistent path still fails CLOSED (exit 2) on every path through the real spawned hook, because the import sits in the one Promise.all inside the try. The round-1 praised decision survives.
20. [CLEAN][demonstrated] C3 holds: dropping the argument at runtime fails CLOSED (exit 2, TypeError) on both legs; no path turns a missing sanitizer into silence-means-allow.
21. [CLEAN][code-traced] C4/C5 hold: src/policy/config/sanitize.ts is byte-unchanged across the whole PR (absent from the c2750a2..d494d51 name list), so round 1's all-BMP sweep against an independent oracle and the linear 5 MB in 58 ms latency result carry unchanged; the sweep test is green in the 1511-pass run.
22. [CLEAN][demonstrated] C6/M1 holds and is STRONGER: removing the sanitize call is now killed by 8 tests across both deny legs, unit and end-to-end (tests 20 / pass 12 / fail 8); round 1 was 5.
23. [CLEAN][code-traced] C7 holds: AC-3 spy-counts zero sanitize invocations on allow and is green in the full run, and the early-return allow branch (render-hook-output.ts:76) is unchanged in this delta. Downgraded from round 1's demonstrated because I could not construct a real allow through the sandbox (every payload resolved to a refusal or a POL-05 deny) — stated rather than overclaimed.
24. [CLEAN][code-traced] C8 holds: THOTH-ADR-0001 (no fixture loader, path resolution or halt-state code touched; no knownConnectors or centralLayer.tools entry hardcoded — the new AC-9/AC-10 derive the name from firstCommittedEntryName(); the fresh-review-report clause now satisfied) and THOTH-ADR-0002 (allowlist, patterns and the reviews baseline guard untouched). No violation on either.
25. [CLEAN][code-traced] cross-domain-reviewer's MED CLOSED: docs/.maat-state.json now reads scope=s312-kernel-hook-sanitize, tier=CRITICAL, reviewRoundsSinceClean=1, reviewRoundsTotal=1, humanRulingRequired=false.
counts (CHECKSUM): issues=9 suspicions=0 clean=16
evidence (CHECKSUM): demonstrated=16 code-traced=9 derived=0
checks=clean baseline on a fresh worktree after npm ci plus git submodule update --init: node --test rc=0, tests 1511 / suites 0 / pass 1511 / fail 0 / cancelled 0 / skipped 0 / todo 0; npm run build (BOTH tsc projects) rc=0; npm run lint rc=0; qa:kernel-purity PASS, qa:normalizer-registry-purity PASS, qa:gate-manifest PASS, qa:gate-matcher-drift PASS, qa:gate-command-path PASS, qa:completeness-claims PASS (all rc=0). The build agent's reported "1 fail" is the QA-14 dogfood test with an uninitialised adr/ submodule - environmental, not worktree pollution, and absent here. 11 mutation drills executed and reverted (M1, M5, M8, M9, M11, M13, M14, M15 plus new N1-N6), 2 repo-wide differential instruments over 190 sources, 1 ten-shape stripComments probe, and 3 real-spawned-hook sandbox runs. Tree clean and HEAD unmoved at d494d51 at close.
adr=HIT(2)
report=docs/reviews/s312-kernel-hook-sanitize-red-team-round2-2026-09-28.md
```

---

## Addendum (same session, appended not edited): a QA-14 false-positive citation reworded

`node src/qa/reference-resolver.ts` (QA-14) flagged the standalone backtick span `` `../src/policy/config/sanitize.ts` `` (at what was line 296) as an `unresolved-authority` path citation — it reads a bare, path-shaped backtick span as a repo-relative citation, and this report's relative-from-`hooks/` form does not resolve from the repo root. Same class of false positive as the already-open Issue #341 (a hypothetical/relative example path in an adversarial review report's own prose). Reworded, same session, to the unambiguous repo-root-relative form `` `src/policy/config/sanitize.ts` `` — the identical file, zero semantic change, not inside any fenced code block or quoted source snippet (those are untouched). This addendum discloses the edit per PRINCIPLES.md rule 11's spirit; the finding's substance, severity, and RECEIPT counts are unchanged.
