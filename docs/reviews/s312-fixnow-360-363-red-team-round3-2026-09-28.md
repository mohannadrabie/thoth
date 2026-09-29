# Red Team (Sutekh) — ROUND 3 re-confirm — PR #365 / `fix/360-363-strip-comments-guard-hardening` (Issues #360, #361, #362, #363)

- **Date:** 2026-09-28
- **Round:** 3 (re-confirm of my own round-2 report, `docs/reviews/s312-kernel-hook-sanitize-red-team-round2-2026-09-28.md`, against the 4 residuals this PR claims to close)
- **Scope:** `fix/360-363-strip-comments-guard-hardening` vs `master`. Tier: CRITICAL. `.github/workflows/ci.yml` is touched, a CLAUDE.md-named sensitive area — this report is part of what discharges that prerequisite.
- **HEAD:** `4ae8942 docs(s312-fixnow): record PR #365 in STATE.md resume point`
- **ADR cache:** `ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp 13c1476) [CACHE=HIT]`
- **Worktree:** the main tree. Every mutation below was reverted immediately; `git status --porcelain` at close shows only `docs/.maat-state.json` (written by `adr-cache --ensure`), `docs/REVIEW_LOG.md`, and the two sibling reviewers' untracked reports. `HEAD` unmoved at `4ae8942`.
- **Verdict:** **go.** No HIGH. 5 of the 6 named proof-tests I asked for in round 2 are delivered and independently confirmed working by re-running the original attacks. 5 MED and 1 LOW are open — all are guard-coverage or guard-precision gaps, none is a defect in shipped sanitization behaviour. Issues #360, #361, #362, #363 are each **partially** resolved and all four stay open.

## Baseline

```
$ git rev-parse HEAD                  4ae89422065b35011d8519c8a14052290fa0be51
$ npm run build                       rc=0     # tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.hooks.json
$ npx eslint src hooks                rc=0
$ node --test                          rc=0
  tests 1525 / suites 0 / pass 1525 / fail 0 / cancelled 0 / skipped 0 / todo 0
$ npm run qa:kernel-purity             PASS rc=0   (4 production .ts files under src/policy/kernel/)
$ npm run qa:normalizer-registry-purity PASS rc=0
$ npm run qa:gate-manifest             PASS rc=0
$ npm run qa:gate-matcher-drift        PASS rc=0
$ npm run qa:gate-command-path         PASS rc=0
$ npm run qa:completeness-claims       PASS rc=0
$ npm run qa:hook-typecheck-coverage   PASS rc=0
  - hooks/pretooluse-kernel-gate.mjs: 0 diagnostic(s), fully covered
  - hooks/sessionstart-tool-enum.mjs: 30 diagnostic(s) (pinned Issue #361 baseline: 30, pre-existing debt, not yet fixed)
  - hooks/userpromptsubmit-halt-relay.mjs: 22 diagnostic(s) (pinned Issue #361 baseline: 22, pre-existing debt, not yet fixed)
```

## One praised decision

**The builder shipped a regression pin that costs something.** `src/policy/gate/render-hook-output.ts:37` now carries a real, useful one-line block comment linking the documented `PreToolUse` contract — and it contains a URL, i.e. it is exactly the input that tripped round-2 R4. I verified it is a genuine pin rather than a decorative comment by resurrecting the deleted `lineFirstThenBlock` oracle verbatim from the diff and running it against the file as shipped:

```
has permanent URL block-comment fixture: true
stripComments len   : 2125
OLD oracle len      : 1489
OLD oracle WOULD HAVE FAILED G21: true
$ node --test src/policy/gate/gate-structure.test.ts
✔ G21: every gate source is fully visible to the structural scanner (stripComments agrees with the TypeScript-AST-derived oracle)
tests 6 / pass 6 / fail 0 / skipped 0
```

Second credit, separately: the self-caught template-substitution defect is real and the fix is load-bearing, not decorative. I reconstructed the pre-fix scanner loop (no `templateBraceStack`, no `reScanTemplateToken`) and it diverges on the real `kernel.ts` (4206 chars vs the shipped 2920), and I could not find a template shape that escapes the shipped bookkeeping across 32 constructed inputs including nested, tagged, `String.raw`, three-deep nesting, invalid escapes, and braces/regex/backticks inside substitutions.

## Scorecard

Ranked by exposure × irreversibility × silence.

| # | Attack | Status | Severity | Evidence |
|---|---|---|---|---|
| R1 | The new cross-lane differential's kernel and normalizer lane lists are hand-typed, so a NEW kernel file is unguarded — `process.env` walks into the kernel purity boundary with everything green | BREAKS | MED | demonstrated |
| R2 | `stripCommentsAstOracle` never calls `getTrailingCommentRanges`, so round-2 R4's false-positive class is relocated and widened from "URL in a same-line block comment" to "any same-line trailing comment" | BREAKS | MED | demonstrated |
| R3 | AC-7b's binding resolution is scope-blind: an inner-scope shadow of `sanitizeMod` satisfies it while the real spawned hook leaks raw ESC and NUL under one unlisted env var | BREAKS | MED | demonstrated |
| R4 | The pinned-baseline ratchet is gameable by offset: pay down 1 diagnostic, introduce 1 real arity bug, count stays at 30, everything green | BREAKS | MED | demonstrated |
| R5 | The disclosed scanner residual's CLASS is understated, and the consumer count with it: `stripComments` loses real code on 2 files in the tree today; the differential covers 8 files while one consumer scans 104 | BREAKS | MED | demonstrated |
| R6 | `npm test` is not green whenever ANY untracked file sits in the tree — including the review reports the review stage itself produces | BREAKS | LOW | demonstrated |
| K1 | Round-2 drill N2 (string-literal comment opener blinding the kernel scan) | SURVIVES (fix confirmed) | — | demonstrated |
| K2 | Round-2 drill N3 (URL in a block comment false-positiving G21) | SURVIVES (fix confirmed) | — | demonstrated |
| K3 | Round-2 drill N4 (env-gated object-literal port) | SURVIVES (fix confirmed) | — | demonstrated |
| K4 | Round-2 drill N5 (decoy `renderHookOutput` call) | SURVIVES (fix confirmed) | — | demonstrated |
| K5 | Round-2 drill N6 (dropped required argument in `sessionstart-tool-enum.mjs`) | SURVIVES (fix confirmed) | — | demonstrated |
| K6 | The self-caught template-substitution fix, stressed with 32 shapes | SURVIVES | — | demonstrated |
| K7 | `@ts-nocheck` gaming of the pinned baseline | SURVIVES | — | demonstrated |
| K8 | The AST oracle over-stripping (deleting real code) | SURVIVES | — | demonstrated |
| K9 | The "8 enforced-lane production files, zero regex literals" claim | SURVIVES | — | demonstrated |
| K10 | The coverage instrument's own fail-loud paths and `.mjs`-only enumeration | SURVIVES | — | code-traced |
| K11 | CI wiring of QA-18 (placement, cost, script) | SURVIVES | — | demonstrated |
| K12 | ADR compliance on this attack surface | SURVIVES | — | code-traced |
| K13 | `findAllRenderHookOutputCalls` evasion shapes beyond N5 | SURVIVES | — | code-traced |

---

## Part 1 — the round-2 drills are genuinely re-run, not read

### K1 — drill N2 CLOSED [demonstrated]

Round 2: a `KERNEL_GLOB = "src/policy/kernel/**"` string constant planted after the pinned imports, plus a real `node:fs` import and a live `readFileSync`, gave `qa:kernel-purity PASS rc=0` and 1511/1511 green. Re-run against this branch:

```
$ node mutate.mjs src/policy/kernel/kernel.ts ...   # identical payload to round 2's N2
MUTATED src/policy/kernel/kernel.ts
$ npm run qa:kernel-purity
[QA kernel-purity-check] FAIL: 1 kernel-purity violation(s) found across 4 file(s) under src/policy/kernel/.
  - src/policy/kernel/kernel.ts: [non-relative-import] import "node:fs" is non-relative (bare package or node: builtin) — forbidden inside the kernel purity boundary
rc=1
$ node --test src/qa/kernel-purity-check.test.ts
FAIL every scanned kernel file reports its real import count
FAIL checkKernelPurity: the REAL src/policy/kernel production code is itself pure (proof, not just self-test fixtures)
tests 58 / pass 56 / fail 2 / skipped 0
```

Confirmed closed. The lexer rewrite closes it at the primitive, so both the count pin and the real-code pin fire.

### K2 — drill N3 CLOSED [demonstrated]

See "One praised decision" above. G21 6/6 green with the URL fixture permanently in a production file, and the deleted oracle would have failed on it.

### K3 — drill N4 CLOSED [demonstrated]

Round 2: 26/26 pass with the bypass live. The env-gated object-literal port planted at the real call site (`hooks/pretooluse-kernel-gate.mjs:198`):

```
$ node --test src/policy/config/sanitize.test.ts hooks/pretooluse-kernel-gate-sanitize.test.ts \
             src/policy/gate/render-hook-output.test.ts src/policy/gate/gate-structure.test.ts
FAIL AC-7/AC-7c: hooks/pretooluse-kernel-gate.mjs contains exactly ONE renderHookOutput call site, and its
  second argument unconditionally resolves to the real sanitizeForTerminal import (no conditional/ternary
  bypass, no port-object masquerade, no decoy call; a local-alias hoist is accepted)
tests 29 / pass 28 / fail 1 / skipped 0
```

Confirmed closed for the shape named in round 2's proof-test. See R3 for the shape that survives.

### K4 — drill N5 CLOSED [demonstrated]

Round 2: 7/7 pass with a decoy call ahead of a real call site passing raw identity.

```
$ node --test src/policy/config/sanitize.test.ts
FAIL AC-7/AC-7c: ... contains exactly ONE renderHookOutput call site ...
tests 10 / pass 9 / fail 1 / skipped 0
```

The `assert.equal(calls.length, 1)` is what kills it. Confirmed closed.

### K5 — drill N6 CLOSED [demonstrated]

Round 2: dropping `evaluateToolInventory`'s second argument gave `npm run build` rc=0 and was invisible to every gate.

```
$ node mutate.mjs hooks/sessionstart-tool-enum.mjs 'evaluateToolInventory(merged, sessionTools)' 'evaluateToolInventory(merged)'
$ npm run qa:hook-typecheck-coverage
[QA hook-typecheck-coverage-check] FAIL: 1 of 3 production hook(s) under hooks/ failed typecheck-coverage.
  - hooks/pretooluse-kernel-gate.mjs: 0 diagnostic(s), fully covered
  - hooks/sessionstart-tool-enum.mjs: 31 diagnostic(s) found, exceeds its pinned Issue #361 baseline of 30 — a NEW regression, not the known pre-existing debt
rc=1
$ npm run build                                    rc=0
```

Confirmed closed, by the new instrument rather than by the build gate (`npm run build` staying rc=0 is the declared, Manager-approved scope: the real gate still covers 1 of 3 hooks). The design resolution "excepted from the zero-diagnostics bar, not from coverage" does what it claims for the un-offset case. See R4 for the offset case.

### K6 — the self-caught template-substitution fix, stressed [demonstrated]

32 constructed shapes through `stripComments`, checking that a marker import placed after the poison survives:

```
nested template literal        keeps=true    tagged template               keeps=true
object literal in substitution keeps=true    template containing //        keeps=true
subst containing string with } keeps=true    subst with } inside a regex   keeps=true
subst with arrow returning obj keeps=true    subst with a class body       keeps=true
deeply nested 3x               keeps=true    backtick string in subst      keeps=true
escaped backtick in template   keeps=true    template literal type         keeps=true
tagged invalid unicode escape  keeps=true    tagged invalid hex escape     keeps=true
tagged invalid brace escape    keeps=true    String.raw                    keeps=true
tagged member expr             keeps=true    tagged nested tagged          keeps=true
...
blinded shapes: 0
```

The hardcoded `reScanTemplateToken(/* isTaggedTemplate */ false)` does not open an escape: tagged templates permit invalid escapes that untagged ones do not, and I tested three such shapes specifically — all clean. And the fix is load-bearing, not cosmetic:

```
PRE-FIX naive loop (no templateBraceStack, no reScanTemplateToken) on real src/policy/kernel/kernel.ts:
  4206 chars   (shipped: 2920)
```

**SURVIVES.** This is the strongest part of the PR.

### K7 — `@ts-nocheck` cannot game the pin [demonstrated]

The obvious ratchet attack: suppress the file wholesale so the count collapses under the pin.

```
$ (prepend a ts-nocheck pragma to hooks/sessionstart-tool-enum.mjs)
$ npm run qa:hook-typecheck-coverage
  - hooks/sessionstart-tool-enum.mjs: 2 diagnostic(s) (pinned Issue #361 baseline: 30, pre-existing debt, not yet fixed)
rc=0                                        <- the INSTRUMENT alone is fooled
$ node --test src/qa/hook-typecheck-coverage-check.test.ts
FAIL AC-13: dropping evaluateToolInventory's second argument ... is caught by the new instrument ...
tests 7 / pass 6 / fail 1 / skipped 0       <- the TEST catches it
```

The reason it works is a deliberate design choice worth naming: AC-13 derives its mutant from the **real file's current content at test-run time**, so any suppression added to the real file is inherited by the mutant, the mutant stops exceeding the pin, and the assertion fires. That is a genuinely well-built pin. Credited, and I found no way around it.

### K8 — the AST oracle never deletes real code [demonstrated]

Before treating any oracle disagreement as an oracle bug, I checked the oracle cannot be silently over-stripping (which would let a real `stripComments` blindness cancel out into agreement). I re-derived its ranges exactly as shipped and asserted every removed range's text actually opens a comment:

```
files scanned: 193
files where the ORACLE removes a range that is NOT a comment (deletes real code): 0
```

So the oracle is unsound only by **omission** (R2), never by over-reach. That matters: the differential is still a valid one-directional detector for the security-relevant direction, which is why R1 and R5 are MED rather than HIGH.

### K9 — the "8 enforced-lane production files, zero regex literals" claim is accurate [demonstrated]

`docs/decisions.md`'s new row asserts this as measured. It is:

```
enforced-lane production files on disk: 8
kernel files the DIFFERENTIAL hand-lists: 4 | kernel files on disk: 4
regex literals in enforced-lane production files: 0
```

The claim holds exactly as stated, and it is the reason R1 and R5 are latent rather than live today.

### K10 — the coverage instrument's fail-loud paths [code-traced]

- A hook absent from the coverage project's resolved file list fails with `does not resolve inside tsconfig.hooks-coverage.json's file list` (`hook-typecheck-coverage-check.ts:101-104`) — narrowing the include list cannot silently drop coverage.
- A hook not on the exception list must be exactly zero (`:108-114`), and the test proves that branch is live by running it against an excepted hook with an empty exception map.
- `listProductionHooks` is `readdirSync`-generated (`:43-48`), so a newly added `hooks/*.mjs` is picked up and then fails loud against the hand-typed include list.
- The `.mjs`-only filter is pinned by `assert.deepEqual(hooks, [three exact names])`, so any addition or removal fails loud. A future hook written as `hooks/*.js` would slip the enumeration, but `gate-command-path-check` covers the settings side, and that is a LOW-value hypothetical I am not filing.
- `exitCodeFor` returns 0 for a vacuous pass, but `printInstrumentResult` tags it `VACUOUS-PASS` with an explicit disclosure note — this repo's established convention, not a silent pass.

**SURVIVES.**

### K11 — CI wiring is real [demonstrated]

```
.github/workflows/ci.yml:254-255
      - name: QA-18 hook-typecheck-coverage-check (Issue #361 fix-now round, red-team round 2 finding R5)
        run: node src/qa/hook-typecheck-coverage-check.ts
```

Placed in the same job as the other structural gates, after the existing S2/S3 purity steps. `package.json` gains `qa:hook-typecheck-coverage`. Cost measured: `real 0m2.583s` — negligible, and it builds a real `ts.Program`, so it is not a cheap textual approximation. **SURVIVES.**

### K12 — ADR compliance on this attack surface [code-traced]

- **SE ADR-0021 POL-11** ("the kernel MUST be pure: no filesystem, network, or process access" / "the layer boundary is enforced by a lint rule or structural test, not by convention alone") — this PR makes the structural test strictly more precise, not looser. R1 and R5 are gaps **in** that test, not new violations introduced here; POL-11 is the clause they land against.
- **SE ADR-0021 POL-12** (normalizer registry) — enforcement unchanged in kind, extended by the differential.
- **SE ADR-0010** ("MUST NOT delete or weaken a failing test to make CI pass"; "MUST NOT lower coverage thresholds, delete tests") — **not violated.** `lineFirstThenBlock` was a defective *oracle* replaced in place inside the same named G21 test; the test still exists, still runs over every gate source, and is strictly stronger on the shape it was built for. The pinned baseline is a new floor where there was none, not a lowered threshold.
- **SE ADR-0005** (testing) — 12 new tests, 0 removed, 0 skipped.
- **THOTH-ADR-0001** — no fixture loader, path resolution, or halt-state code touched; no `knownConnectors`/`centralLayer.tools` entry hardcoded. Its clause that a PR changing the hooks that read the fixture still needs a fresh dated review report is satisfied by this report plus the two sibling reports in `docs/reviews/`.
- **THOTH-ADR-0002** — allowlist, patterns and the reviews baseline guard untouched.

No violation on any. **SURVIVES.**

### K13 — `findAllRenderHookOutputCalls` evasion shapes beyond N5 [code-traced]

The matcher keys on a `PropertyAccessExpression` named `renderHookOutput`, then asserts the count is exactly 1. Every evasion shape I traced fails loud in the safe direction: a destructured bare call and an element-access call both yield `calls.length === 0`, and an extra decoy on any object yields 2 — all three trip `assert.equal(calls.length, 1)`. Tagged `code-traced` rather than `demonstrated`: I read the matcher and reasoned the counts, I did not plant all three. **SURVIVES.**

---

## Part 2 — new findings against the fix itself

## R1 — [ISSUE][MED][demonstrated] the differential's kernel and normalizer lane lists are hand-typed, so the guard does not extend with the enforced surface — `process.env` walks into the kernel with everything green

`Exposure: 0 of 8 enforced-lane production files today (measured, K9); latent on every future file added under src/policy/kernel/ or to the normalizer lane, which checkKernelPurity walks but the differential does not. Basis: measured.`
*(Security / control-integrity category — ADR-0021 POL-11.)*

**Why MED and not HIGH, stated plainly.** Round 2's R1 was MED on exactly this reasoning: the control is ON today, and what remains is that a future edit of a specific shape can switch it back off. Zero regex literals exist in the 8 enforced-lane files right now (measured, K9). Rating this HIGH now would be moving the goalposts after the team delivered the proof-test I named. It stays MED, and I am saying so explicitly so the audit can check I did not move them.

**The gap.** `src/qa/kernel-purity-check.test.ts`'s `enforcedLaneSources()` builds its lanes as:

```ts
{ dir: "src/policy/kernel", files: ["action-record.ts", "kernel.ts", "rule-types.ts", "verdict.ts"] },
{ dir: "src/policy/normalizer", files: ["registry.ts"] },
{ dir: "src/policy/gate", files: readdirSync(...).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts")) },
```

The gate lane is generated. The kernel lane is four hand-typed strings, against a directory `checkKernelPurity` enumerates by walking it. The two sets are equal today (4 and 4, measured) and there is nothing that keeps them equal. That is precisely the shape CLAUDE.md's "No hand-derived completeness claims" hard rule exists for — a set spanning multiple files, asserted in prose rather than generated by an instrument. The accompanying `assert.ok(sources.length >= 7)` is a floor, not a coverage check: it cannot notice an addition.

**Drill N7b — a new kernel file, everything green, `process.env` live inside the purity boundary.** `src/policy/kernel/path-shape.ts`, written the way an ordinary contributor would write it:

```ts
// Pure path-shape helpers for the kernel: no filesystem access, string inspection only.
import type { ActionRecord } from "./action-record.ts";

/** True when the record's target looks like an absolute POSIX path. */
export function isAbsoluteTarget(record: ActionRecord): boolean {
  const t = String((record as unknown as { target?: string }).target ?? "");
  if (/(^|\/)config\//.test(t)) return process.env.THOTH_ALLOW_CONFIG === "1";
  return t.startsWith("/");
}
```

```
$ npm run qa:kernel-purity
[QA kernel-purity-check] PASS: 5 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.
rc=0
$ npm run build                 rc=0
$ npx eslint src hooks          rc=0
$ node --test                   tests 1525 / pass 1524 / fail 1 / skipped 0
$ all 7 QA instruments          rc=0 rc=0 rc=0 rc=0 rc=0 rc=0 rc=0
```

The single failure is `R4: a fresh LOCAL clone ...` in `src/secret-scan/pre-commit-scan.test.ts`, which is **not** a detection of this bypass. I isolated it: replacing the mutation with a one-line innocuous untracked file (`export const HARMLESS = 1;`) reproduces it exactly, `tests 26 / pass 25 / fail 1`. It is untracked-file sensitivity, filed separately as R6.

**Why the regex blinds it.** `/(^|\/)config\//` ends in `\/` immediately before the closing delimiter, producing the byte sequence `\//`. The raw scanner resolves the leading `/` as `SlashToken` (division) because no parser calls `reScanSlashToken()` at a regex-valid grammar position, and then reads `//` as a line comment and consumes to end of line. Everything after it on that line — here the `process.env` read — is invisible to `scanForbiddenGlobals`.

**Current defense, honestly assessed.**
- The differential **does** fire on a **listed** file. Planting the same construct at the end of `src/policy/kernel/rule-types.ts`:
  ```
  $ npm run qa:kernel-purity
  [QA kernel-purity-check] PASS: 4 production .ts file(s) ... zero violations.   rc=0     <- the production instrument is STILL blind
  $ node --test src/qa/kernel-purity-check.test.ts
  FAIL stripComments agrees with a TypeScript-scanner-derived oracle on every scanned production source (kernel, normalizer registry, gate)
  tests 58 / pass 57 / fail 1 / skipped 0                                                  <- the differential catches it
  ```
  So the defence-in-depth layer works where it reaches. This is a lane-enumeration gap, not an absent guard — and the production CI instrument itself stays blind either way, which is why the differential's reach is the whole defense.
- The AST forbidden-globals layer is no backstop here: `FORBIDDEN_ROOTS` (`kernel-purity-check.ts:273-283`) is `globalThis, global, Reflect, eval, Function, fetch, setTimeout, setInterval, require` — **`process` is not in it.** Process access is caught only by the `stripComments`-dependent regex layer, so blinding the strip blinds it completely.

**Verdict: BREAKS.**

**Named proof-test required.**
`src/qa/kernel-purity-check.test.ts :: "the differential's lane list is GENERATED from the same directory walk checkKernelPurity and checkNormalizerRegistryPurity enforce, so a newly added kernel file is covered the day it lands"` — replace the two hand-typed arrays with the same walk the instruments use, and drop the `>= 7` floor in favour of asserting the differential's file set equals the instruments' enforced set. Add `process` to `FORBIDDEN_ROOTS` in the same change so the AST layer is a real backstop for the one forbidden global that currently has none.

---

## R2 — [ISSUE][MED][demonstrated] round-2 R4's false-positive class is relocated and WIDENED: the new oracle misses every same-line trailing comment, so an ordinary comment edit to any gate/kernel/normalizer file fails two guards

`Exposure: 100% of future gate/kernel/normalizer production edits that add a comment sharing a line with code; 44 of 193 sources in this repo (22.8%) already carry the shape, and the 3 enforced lanes are clean only by coincidence. Basis: measured.`

**The defect, code-traced first.** `stripCommentsAstOracle`'s own doc comment at `src/qa/kernel-purity-check.ts:221-222` states it extracts comments "via `ts.getLeadingCommentRanges` / `ts.getTrailingCommentRanges` at each token's own boundaries". `collectAt` (`:231-239`) calls only `getLeadingCommentRanges`. The `getTrailingCommentRanges` call was never written — a grep over the file finds the identifier twice in prose and zero times in code.

That matters because TypeScript's `getLeadingCommentRanges` only reports comments preceded by a line break (or at position 0). Confirmed directly:

```
source: const n = 1; /* c */ <newline> const m = 2;
leading  at 12: undefined
trailing at 12: [{"kind":3,"pos":13,"end":20,"hasTrailingNewLine":false}]
```

So the oracle is blind to **every** comment that shares a line with preceding code. 14 of 14 ordinary shapes disagree:

```
1  block comment in template subst    DISAGREE    8  block comment in arrow body template  DISAGREE
2  line comment in template subst     DISAGREE    9  block comment inside type args        DISAGREE
3  block comment between divisions    DISAGREE   10  block comment in nested template      DISAGREE
4  block comment mid-expression       DISAGREE   11  comment between export and const      DISAGREE
5  block comment before close paren   DISAGREE   12  comment in a default parameter        DISAGREE
6  block comment after the last token DISAGREE   13  comment in template, no spaces        DISAGREE
7  block comment inside an array      DISAGREE   14  jsdoc in a template substitution      DISAGREE
```

In every one, `stripComments` is **correct** and the oracle is wrong. Example: for `const n = a + /* c */ b;` the shipped `stripComments` returns `const n = a +  b;` and the oracle returns the source unchanged.

**Drill N8 — one benign comment, two guards down.** Added to `src/policy/gate/render-hook-output.ts`:

```ts
export interface HookOutput { // the PreToolUse payload shape
```

```
$ node --test src/policy/gate/gate-structure.test.ts src/qa/kernel-purity-check.test.ts
FAIL G21: every gate source is fully visible to the structural scanner (stripComments agrees with the TypeScript-AST-derived oracle)
FAIL stripComments agrees with a TypeScript-scanner-derived oracle on every scanned production source (kernel, normalizer registry, gate)
tests 64 / pass 62 / fail 2 / skipped 0
  AssertionError: render-hook-output.ts: stripComments disagrees with the AST-derived oracle — real code or
  a real comment is being handled differently by the two
```

**How much wider the trigger is now.** Round-2 R4's trigger was "a URL, or any line-comment marker, inside a block comment that closes on the same line" — narrow. The new trigger is "any comment sharing a line with preceding code" — and I measured the base rate:

```
files scanned: 193
files where stripComments DISAGREES with stripCommentsAstOracle: 44  (22.8%)
```

None of the 44 is in an enforced lane, which is why the baseline is green. That is coincidence, not design: the guard's correctness depends on the 8 enforced-lane files never gaining a trailing comment, in a codebase where 22.8% of files already have one.

**Current defense, credited honestly.** This fails **loud**, in the safe direction — it blocks a benign edit rather than passing a harmful one, and the shipped fix does genuinely kill the specific R4 shape (K2). The new message is also better than the old one: it no longer asserts a direction. But it still does not say which side lost what, which was half of round-2 R4's complaint, so an author hitting this is told two strippers disagree and left to work out that the oracle is the wrong one. This is the Issue #332 / R4 failure mode restated: a guard that blocks the benign edit trains the next author to loosen the guard rather than fix it.

**Verdict: BREAKS.**

**Named proof-test required.**
`src/qa/kernel-purity-check.test.ts :: "stripCommentsAstOracle removes a trailing same-line comment, and agrees with stripComments on all 14 interior and trailing comment positions"` — add the one missing `getTrailingCommentRanges(source, node.getEnd())` call the doc comment already claims, then pin the 14 shapes above as an inline table. Make the assertion message report which side retained more characters.

---

## R3 — [ISSUE][MED][demonstrated] AC-7b's binding resolution is scope-blind: an inner-scope shadow satisfies it while the real hook leaks raw ESC and NUL

`Exposure: 100% of future refactors of the one call site that introduce a nested-scope binding of the same name; basis: counted in code (findBindingDeclaration short-circuits on the first same-named declaration in tree order, src/policy/config/sanitize.test.ts).`
*(Security / control-integrity category.)*

**The gap.** `findBindingDeclaration(name, sourceFile)` walks the whole source file and returns the **first** `VariableDeclaration` binding that name (`if (found) return;`). It has no scope model. So when two declarations share a name, the checker resolves the outer one while the runtime uses the inner one.

**Drill N9 — against the real hook.** `hooks/pretooluse-kernel-gate.mjs`:

```js
const realS = sanitizeMod.sanitizeForTerminal;
let output;
{
  const sanitizeMod = { sanitizeForTerminal: process.env.THOTH_PLAIN_REASON ? ((s) => s) : realS };
  output = render.renderHookOutput(gate.decideToolCall(input, ports), sanitizeMod.sanitizeForTerminal);
}
```

Every guard green:

```
$ node --test src/policy/config/sanitize.test.ts hooks/pretooluse-kernel-gate-sanitize.test.ts \
             src/policy/gate/render-hook-output.test.ts src/policy/gate/gate-structure.test.ts
tests 29 / pass 29 / fail 0 / skipped 0
```

And live through the **real spawned hook** in the pinned copy-tree sandbox:

```
RT env={}                              policyDenied=true rawESC=false rawNUL=false
RT env={"THOTH_PLAIN_REASON":"1"}      policyDenied=true rawESC=true  rawNUL=true
```

Raw ESC and raw NUL reaching the operator-facing deny reason — round-2 R2 reconstituted through one token of scope.

**The second half of round-2 R2 was not addressed at all.** R2 named two composing gaps: the name-only AST check *and* AC-9's finite env matrix. The AST check was fixed (K3). AC-9 is byte-unchanged — still five hard-coded cases (`{}`, `THOTH_RAW_REASON` twice, `NODE_ENV`, `THOTH_DEBUG`), still attempting to prove a negative over an open set, and `THOTH_PLAIN_REASON` is still not among them. That is why N9 is invisible behaviourally as well as structurally.

**Current defense, credited honestly.** The AC-7b fix is a real improvement and faithfully implements the proof-test I named in round 2 ("resolve the property-access object back to the dynamic-import destructuring, and reject an object-literal or any other origin") — it does exactly that, and the object-literal, unrelated-module and renamed-binding shapes are all dead. Shadowing is a narrower shape I did not name. The `assert.equal(calls.length, 1)` also means an attacker must reuse the one call site rather than add one, which is a real constraint.

**Verdict: BREAKS.** Issue #360 is **partially** resolved and stays open.

**Named proof-test required.**
`src/policy/config/sanitize.test.ts :: "AC-7d: the sanitizeMod binding the call site resolves to is the one in the call site's own scope chain — an inner-scope shadow is rejected"` — resolve from the call site outward (nearest enclosing block first) instead of first-in-tree-order. Pair it with a structural assertion that no `process.env` read occurs between the sanitize import and the call, which closes the whole open set AC-9's finite list cannot.

---

## R4 — [ISSUE][MED][demonstrated] the pinned-baseline ratchet is gameable by offset: pay down one diagnostic, introduce one real bug, the count stays at 30 and every gate is green

`Exposure: 2 of 3 production hooks, and every future edit to either that nets at least one diagnostic of headroom; basis: counted in code (the comparison is count > baseline, src/qa/hook-typecheck-coverage-check.ts:115).`

**The mechanism.** The check is `if (count > baseline)`. A count **below** the pin passes silently and never tightens it. The file header (`:19-22`) says the opposite: *"A baseline DECREASE (someone paying down the debt) simply lowers the pin at that time."* Nothing lowers the pin; `PINNED_BASELINES` is a hand-edited constant. Every diagnostic anyone pays down becomes permanent, unguarded headroom for a real defect.

**Drill C2 — one benign annotation, one real arity bug, net zero.** Two edits to `hooks/sessionstart-tool-enum.mjs`:

```js
/** @param {string} id */                           // -1 diagnostic (kills one TS7006)
function isValidSessionId(id) {

} else if (wasReasonActive(initialHaltState)) {     // +1 diagnostic: drops the required reasonKey
```

`wasReasonActive(initialHaltState, reasonKey)` is declared with two required parameters (`hooks/sessionstart-tool-enum.mjs:291`). This is the exact AC-13 defect class, on a different call site so it does not trip AC-13's own anchor precondition.

```
$ npm run qa:hook-typecheck-coverage
[QA hook-typecheck-coverage-check] PASS: 3 production hook(s) under hooks/, each resolves inside a tsconfig project and stays within its coverage bar.
  - hooks/pretooluse-kernel-gate.mjs: 0 diagnostic(s), fully covered
  - hooks/sessionstart-tool-enum.mjs: 30 diagnostic(s) (pinned Issue #361 baseline: 30, pre-existing debt, not yet fixed)
  - hooks/userpromptsubmit-halt-relay.mjs: 22 diagnostic(s) (pinned Issue #361 baseline: 22, pre-existing debt, not yet fixed)
rc=0
$ node --test src/qa/hook-typecheck-coverage-check.test.ts    tests 7 / pass 7 / fail 0 / skipped 0
$ npm run build                                              rc=0
$ npx eslint hooks                                           rc=0
```

Green everywhere, with the instrument printing the reassuring "30 diagnostic(s) ... pre-existing debt, not yet fixed" line over a brand-new bug.

**Current defense, credited honestly.**
- `@ts-nocheck` wholesale suppression **is** caught, by AC-13's derive-from-the-real-file design (K7). That is the harder attack and it is closed.
- The hook's own runtime tests caught **this** mutant loudly: `node --test hooks/sessionstart-tool-enum.test.ts hooks/sessionstart-tool-enum-fixnow.test.ts` gave `tests 17 / pass 14 / fail 3`, three AC5 reconciliation tests. So this is a defence-in-depth gap, not an unguarded hole — which is why MED, not HIGH.
- But the gap is exactly the layer Issue #361 exists to add: a type-only defect with no behavioural coverage (a widened union, a nullable narrowing, an arity change on a path no test exercises) is invisible in the offset case, and typechecking was the answer for those.
- A strict-equality pin also makes the header's claim true rather than aspirational, and turns "someone paid down debt" into a one-line commit that lowers the constant — visible in review instead of silently banked.

**Verdict: BREAKS.** Issue #361 is **partially** resolved and stays open.

**Named proof-test required.**
`src/qa/hook-typecheck-coverage-check.test.ts :: "a pinned hook's diagnostic count must EQUAL its baseline, not merely not exceed it — paying down debt requires lowering the pin in the same commit"` — change `count > baseline` to `count !== baseline` with a message that names both directions, and pin drill C2 above (one annotation plus one arity drop) as the regression fixture.

---

## R5 — [ISSUE][MED][demonstrated] the disclosed residual's class is understated, and so is the consumer count: `stripComments` loses real code on 2 files in the tree today, and one consumer scans 104 production files with no differential behind it

`Exposure: 2 of 193 sources are lossy today, 0 of them inside any production scan set (both are .test.ts, excluded by every consumer's walk); 104 production files are scanned through stripComments by a consumer the differential does not cover. Basis: measured.`

**The residual is disclosed too narrowly.** `kernel-purity-check.ts:167-181` names one exploitable shape: *"a regex character class containing an UNESCAPED, adjacent `//`"*. I measured two more, both broader and both already present in this repo:

```
F  regex with unescaped // in a class       /[//]/            keepsImport=true   agreesWithOracle=false
G  regex containing an escaped block opener /a\/\*b/          keepsImport=FALSE  agreesWithOracle=false  <- swallows to EOF
   regex ending in an escaped slash         /(^|\/)config\//  (drill N7b: blinds the rest of the line)
```

Shape G is the worst: the escaped star after the escaped slash reads as a block-comment opener and consumes to the next closer, across lines. And a regex that matches a path separator or a comment opener is not exotic — it is what a code-scanning tool writes. This project already has two.

**Measured against a correct reference.** I built the stripper the oracle's doc describes (full parse, every token, **both** leading and trailing ranges) and compared `stripComments` against it over all 193 sources:

```
files scanned: 193
DANGEROUS: stripComments output SHORTER than the correct reference (real code lost): 2
   src/policy/gate/gate-structure.test.ts   lost=55
   src/qa/marker-corpus-probe.test.ts       lost=75
BENIGN-direction: stripComments LONGER than reference (a region copied through verbatim): 5
   src/policy/tools/classification-builtin-override.test.ts  extra=5570
   hooks/pretooluse-kernel-gate-launch.test.ts               extra=755
   src/qa/reference-resolver.ts                              extra=688
   src/qa/runtime-settings-drift-check.ts                    extra=503
   src/secret-scan/history-scan.test.ts                      extra=335
```

The two lossy sites are exactly the shape above — `/(^|\/)config\//` in `gate-structure.test.ts` (55 chars after it on that line vanish) and `/zz-nested\//` in `marker-corpus-probe.test.ts` (75 chars vanish). Both are `.test.ts`, and every consumer's walk excludes `*.test.*` (`classification-builtin-override.test.ts:325`), so **live exposure today is zero** — measured, not assumed. That is the only reason this is MED.

**The consumer count is understated.** The differential's own comment says it covers "every lane this file's own consumers enforce ... all three in one place so a future 4th consumer only needs to be added to this list". There are already eight importers of `stripComments`:

```
src/qa/normalizer-registry-purity-check.ts                  (production instrument)
src/policy/gate/gate-structure.test.ts                      (G-series)
src/qa/kernel-purity-check.test.ts                          (the differential itself)
src/policy/tools/classification-builtin-override.test.ts    <- R1-6 single-merge-site scan
src/policy/tools/classification-catalog.test.ts
src/policy/config/rule-reachability.test.ts
src/qa/redirect-scan-differential.test.ts
hooks/pretooluse-kernel-gate-launch.test.ts
```

`classification-builtin-override.test.ts`'s R1-6 single-merge-site test is the Issue #332 bypass detector, and it runs `stripComments` over the full production tree:

```
production (non-test) .ts/.mjs/.js files under src/ + hooks/: 104
```

So the primitive's blast radius is 104 files; the differential's is 8. A path-separator-matching regex added to any of the other 96 silently narrows what the #332 funnel detector can see, and nothing notices.

**Current defense, honestly assessed.** The disclosure convention itself is good — this file documents its residuals rather than claiming exhaustiveness, and the decisions row backs its claim with a real measurement (K9). The defect is that the residual's stated class is narrower than the code's actual behaviour, and the guard's stated reach is narrower than the primitive's actual reach. Both are one-line-ish fixes.

**Verdict: BREAKS.**

**Named proof-test required.**
`src/qa/kernel-purity-check.test.ts :: "stripComments agrees with a full-parse reference stripper on EVERY .ts/.mjs/.js under src/ and hooks/, not only the 8 enforced-lane files"` — the instrument in this section, committed. It finds 2 files today, so it lands red and converts both into real fixes (or an explicit, dated exception list). Widen the header's disclosed-residual paragraph to name the escaped-slash and escaped-block-opener classes alongside the character-class one.

---

## R6 — [ISSUE][LOW][demonstrated] `npm test` is not green whenever any untracked file sits in the tree, including the review reports the review stage itself produces

`Exposure: 100% of review-stage verification runs performed before the reports are committed; basis: measured.`

Pre-existing, not in this diff — reported because it bit this review directly and it collides with the Definition of Done ("tests green in CI with real counts").

```
$ echo 'export const HARMLESS = 1;' > src/policy/kernel/innocuous.ts
$ node --test src/secret-scan/pre-commit-scan.test.ts
FAIL R4: a fresh LOCAL clone of the real project repo, with core.hooksPath set exactly as `npm run prepare`
     sets it, blocks a real commit containing a secret -- no manual `git config` beyond that
tests 26 / pass 25 / fail 1 / skipped 0
```

And at close of this review, with only the two sibling reviewers' untracked reports in `docs/reviews/` and nothing else:

```
$ node --test
tests 1525 / suites 0 / pass 1524 / fail 1 / cancelled 0 / skipped 0 / todo 0
FAIL R4: a fresh LOCAL clone of the real project repo ...
```

The practical effect: a CRITICAL-tier story with three parallel reviewers cannot get a clean `npm test` while any reviewer's report is still uncommitted, and the failure names secret scanning rather than the real cause — so it reads as a security gate failing.

**Verdict: BREAKS.** LOW: it fails loud and is a test-harness scoping bug, not a production defect.

**Named proof-test required.**
`src/secret-scan/pre-commit-scan.test.ts :: "R4 clones only tracked content, so an untracked file in the working tree does not fail the fresh-clone drill"` — clone from HEAD (or stage/stash-exclude untracked paths) rather than the working tree.

---

## Partial failure, concurrency, drift

This PR adds no apply path and no shared mutable state, so the classic partial-apply questions are mostly N/A. What I did check:

- **Partial application of the fix itself.** The new instrument, the new project file, the CI step and the `package.json` script land in one commit. If the CI step landed without `tsconfig.hooks-coverage.json`, `ts.readConfigFile` errors and the instrument throws with a named message (`failed to read tsconfig.hooks-coverage.json: ...`) — loud, not a silent skip (`resolveProjectAndDiagnostics:64-67`).
- **Drift between the two tsconfig projects.** `tsconfig.hooks-coverage.json` extends `./tsconfig.json`, so a compiler-option change in the root project propagates into the coverage measurement and can move the pinned counts. A root-tsconfig tightening (enabling a new strict flag) will raise the counts past 30/22 and fail the new CI step in a change that has nothing to do with hooks. That fails loud and is arguably correct ratchet behaviour, but it is a coupling the header does not mention. Not filed — verdict-neutral, noted for the Manager.
- **Concurrency.** The AC-13 test writes a `.qa-tmp-ac13-<pid>-<timestamp>` directory at the repo root and removes it in a `finally`. PID plus timestamp makes a collision between concurrent runs implausible, and the sibling placement is deliberate so relative imports resolve. But a killed run (between `mkdirSync` and `finally`) leaves the directory in the tree — which, per R6, then fails `npm test` on the next run with a message about secret scanning. Two independently-benign designs composing into a confusing failure. Noted, not filed.
- **Console/plan drift, quota exhaustion, provider throttling, AZ degradation:** not applicable to this change.

## Hostile lens — compromised CI runner

Round 2's weakest link was "type a glob into a string constant in a kernel file". That is closed for strings and templates. The remaining low-privilege paths, all requiring only ordinary commit access and none needing workflow-editing rights:

1. **Add a new file under `src/policy/kernel/`** containing a path-matching regex and a `process.env` read on the same line (R1). It reads as unremarkable pure-helper code, the production CI instrument passes, and the differential does not cover the file because its lane list is hand-typed. I walked this one end to end.
2. **Refactor the one hook call site into a nested block** with a same-named binding (R3). The diff reads as a scoping tidy-up; the leak is gated on an env var the behavioural matrix does not enumerate.
3. **Pay down two implicit-anys in an excepted hook while introducing an arity bug** (R4). The diff reads as debt paydown, which reviewers wave through, and the instrument prints "pre-existing debt, not yet fixed" over the new bug.

All three are reviewable-looking edits. Path 1 ranks first: it is the only one where the control that is supposed to stop it (`qa:kernel-purity`, a CI gate against an ADR-0021 MUST) reports PASS.

## Editorial (verdict-neutral, plain edits, no re-review)

- `src/qa/kernel-purity-check.ts:221-222` claims the oracle uses `ts.getTrailingCommentRanges`; it does not (R2). Either add the call or delete the claim.
- `src/qa/kernel-purity-check.ts:167-181` names the character-class shape as "the one narrow exploitable shape". There are at least three (R5). Name the escaped-slash and escaped-block-opener classes too.
- `src/qa/hook-typecheck-coverage-check.ts:19-22` says a baseline decrease "simply lowers the pin at that time". The comparison at `:115` is `count > baseline`; nothing lowers anything (R4).
- `src/qa/kernel-purity-check.test.ts`'s differential comment says "a future 4th consumer only needs to be added to this list". There are already eight consumers (R5).
- `G21`'s new assertion message still does not say which side retained more characters — half of round-2 R4's complaint, carried (R2).

## Open findings vs failing tests

6 open findings, 6 named failing tests — equal, no gap to explain:

| Finding | Failing test |
|---|---|
| R1 | `kernel-purity-check.test.ts` — the differential's lane list is GENERATED from the same directory walk the instruments enforce |
| R2 | `kernel-purity-check.test.ts` — stripCommentsAstOracle removes a trailing same-line comment, and agrees on all 14 positions |
| R3 | `sanitize.test.ts` — AC-7d: the binding resolves in the call site's own scope chain; an inner-scope shadow is rejected |
| R4 | `hook-typecheck-coverage-check.test.ts` — a pinned hook's count must EQUAL its baseline, not merely not exceed it |
| R5 | `kernel-purity-check.test.ts` — stripComments agrees with a full-parse reference on EVERY source under src/ and hooks/ |
| R6 | `pre-commit-scan.test.ts` — R4 clones only tracked content, so an untracked working-tree file does not fail the drill |

## Per-issue closeability, stated explicitly

- **#360 — PARTIALLY RESOLVED, stays OPEN.** AC-7b's object-resolution and AC-7c's exactly-one-call-site are both delivered and independently confirmed (K3, K4): the object-literal port and the decoy call are dead. Two things survive: AC-7b is scope-blind (R3, demonstrated end-to-end with raw ESC and NUL through the real hook), and AC-9's fixed 5-case env matrix — the other half of round-2 R2 — is byte-unchanged.
- **#361 — PARTIALLY RESOLVED, stays OPEN.** The dangling `docs/backlog.md` citation is genuinely fixed, the instrument exists, is CI-wired, is `readdirSync`-generated, and closes drill N6 (K5). Two things survive: the ratchet is gameable by offset (R4), and the real build gate (`tsconfig.hooks.json`) still covers 1 of 3 hooks — the declared, Manager-approved scope, not a defect, but it is the Issue's own title.
- **#362 — PARTIALLY RESOLVED, stays OPEN.** The comment-versus-string/template class is closed at the primitive, with a real self-test fixture and a cross-lane differential (K1, K6). The regex-literal class is narrowed but demonstrably open, broader than disclosed, and lossy on 2 files today (R5); and the guard that was supposed to cover the kernel and normalizer lanes enumerates them by hand (R1).
- **#363 — PARTIALLY RESOLVED, stays OPEN.** The named URL shape is fixed and permanently pinned in a production file (K2, and a praised decision). The false-positive **class** is larger than before, because the replacement oracle is blind to every same-line trailing comment (R2), and the message still does not name the direction.

## Scariest unproven assumption

**That a hand-typed list of lane files is an acceptable stand-in for the directory walk the control itself performs — that the guard's coverage set and the control's coverage set are the same thing.** They are not, and the gap is not hypothetical: I added one ordinary-looking pure helper to `src/policy/kernel/`, with a path regex and a `process.env` read on the same line, and `qa:kernel-purity` reported `PASS: 5 production .ts file(s) ... zero import or forbidden-global violations`, with `npm run build` rc=0, `eslint` rc=0, all seven QA instruments rc=0, and 1524 of 1525 tests green. Round 2's lesson was that the purity claim rests on a scan being right about a language it does not parse. Round 3's is narrower and more fixable: the claim now rests on a guard being pointed at every file the claim covers, and it is pointed at four names typed into a test.

## Go / no-go

**go.** Five of the six named proof-tests I asked for in round 2 are delivered, and I confirmed each by re-running the original attack rather than by reading the diff: drills N2, N3, N4, N5 and N6 all now fail loud where they passed silently before. The `stripComments` rewrite is a genuine root-cause fix at the primitive, the self-caught template-substitution defect is real and its fix survived 32 constructed shapes, the URL regression pin is a real production comment that would have failed the old oracle, and the AC-13 pin's derive-from-the-real-file design defeats the wholesale-suppression attack I expected to work. No HIGH. The shipped sanitization behaviour — the thing story #312 set out to do — is unchanged and still correct.

What is open is guard coverage and guard precision, not shipped behaviour: five MED and one LOW, every one of them "this guard does not reach far enough" or "this guard fires on the wrong input", all six with a named failing test. Live exposure is measured at zero on every enforced surface today. Blocking a third time on residuals of residuals, when the named remediations were delivered in full and verified, would be goalpost-moving and would push a healthy loop toward rule-16 ceremony for work better done as its own story.

**Conditions the Manager should carry (not gating):**
1. R2 is the one with near-term operational cost: the next ordinary trailing comment added to any of the 8 enforced-lane production files breaks the build, and 22.8% of this repo's sources already carry that shape. The one-line `getTrailingCommentRanges` fix should be scheduled, not backlogged.
2. All four Issues (#360, #361, #362, #363) stay open, each with a comment stating what closed and what did not.
3. R6 is pre-existing and out of this PR's scope, but it means "tests green" cannot be honestly asserted at review time until reports are committed — record the real count with that caveat rather than treating 1524/1525 as a regression.

## Single next action

Replace the two hand-typed lane arrays in `enforcedLaneSources()` with the same directory walks `checkKernelPurity` and `checkNormalizerRegistryPurity` already perform, and add the missing `ts.getTrailingCommentRanges(source, node.getEnd())` call to `stripCommentsAstOracle`. Those two edits close R1, R2 and R5 together, make the differential's coverage track the control's, and make the oracle's own doc comment true.

---

```
RECEIPT: verdict=go
attacks (ranked by blast radius):
1. [ISSUE][MED][demonstrated] The cross-lane differential's kernel/normalizer lane lists are HAND-TYPED (kernel-purity-check.test.ts enforcedLaneSources: 4 literal filenames vs the directory checkKernelPurity walks; only the gate lane is readdirSync-generated) — drill N7b added an ordinary-looking pure helper src/policy/kernel/path-shape.ts whose path-matching regex ending in an escaped slash blinds the rest of that line, hiding a live process.env read, and qa:kernel-purity reported PASS rc=0 on 5 files, build rc=0, eslint rc=0, all 7 QA instruments rc=0, 1524/1525 tests (the 1 fail isolated and proven to be R6 untracked-file sensitivity, reproduced with a one-line innocuous file). ADR-0021 POL-11 plus CLAUDE.md no-hand-derived-completeness-claims. Defense assessed: on a LISTED kernel file the differential DOES fire (demonstrated on rule-types.ts, 58/57/1) but the production CI instrument stays PASS rc=0 even then, so the differential's reach is the whole defense; and `process` is absent from FORBIDDEN_ROOTS (kernel-purity-check.ts:273-283) so the AST layer is no backstop. MED not HIGH, stated explicitly for consistency with my own round-2 R1 calibration (latent future-edit trap, control ON today). Exposure: 0 of 8 enforced-lane files today (measured: 0 regex literals), latent on every future kernel/normalizer file addition, basis: measured.
2. [ISSUE][MED][demonstrated] Round-2 R4's false-positive class is RELOCATED AND WIDENED, not fixed: stripCommentsAstOracle's doc (kernel-purity-check.ts:221-222) claims getTrailingCommentRanges; collectAt (:231-239) only ever calls getLeadingCommentRanges, which TypeScript only reports for comments preceded by a line break (confirmed directly: leading at pos 12 = undefined, trailing at 12 = the range) — so every same-line trailing comment is missed, 14 of 14 ordinary comment positions disagree, and drill N8 (adding a trailing line comment after `export interface HookOutput {` in a gate file) fails BOTH G21 and the new cross-lane differential, 64/62/2. Trigger widened from "URL in a same-line block comment" to "any comment sharing a line with code"; measured base rate 44 of 193 repo sources (22.8%) already carry it, the 3 enforced lanes clean only by coincidence. Defense credited: fails LOUD in the safe direction and the specific R4 shape IS dead (K2), but the message still does not say which side lost characters — half of R4's original complaint, carried. This is the Issue #332 shape: blocks the benign edit, trains the author to loosen the guard. Exposure: 100% of future gate/kernel/normalizer edits adding a trailing comment, basis: measured.
3. [ISSUE][MED][demonstrated] AC-7b's binding resolution is SCOPE-BLIND: findBindingDeclaration returns the first same-named VariableDeclaration in tree order with no scope model — drill N9 wrapped the real hook's call site in a block with an env-gated same-named object-literal shadow and all 29 guard tests passed 29/29, while the real spawned hook in the pinned sandbox emitted rawESC=true rawNUL=true under THOTH_PLAIN_REASON=1 (env={} clean). AC-9's fixed 5-case env matrix — the OTHER half of round-2 R2 — is byte-unchanged and does not include that name. Defense credited honestly: the AC-7b fix faithfully implements the proof-test I named (object-literal, unrelated-module and renamed-binding origins are all dead, K3) and the exactly-one-call-site assertion forces reuse of the one site; shadowing is a narrower shape I did not name. Issue #360 PARTIALLY resolved. Exposure: 100% of future refactors of the one call site that introduce a nested-scope binding, basis: counted in code.
4. [ISSUE][MED][demonstrated] The pinned-baseline ratchet is gameable by OFFSET: the comparison is `count > baseline` (hook-typecheck-coverage-check.ts:115) so a decrease passes silently and never tightens the pin, contradicting the header's own claim (:19-22) that a decrease "simply lowers the pin at that time" — drill C2 added one benign JSDoc param annotation (-1 TS7006) plus one real dropped-required-argument bug at wasReasonActive (+1 TS2554), the count stayed at exactly 30, and qa:hook-typecheck-coverage PASS rc=0 printing "30 diagnostic(s) (pinned Issue #361 baseline: 30, pre-existing debt, not yet fixed)" over the new bug, AC-13 7/7 pass, build rc=0, eslint hooks rc=0. Defense credited: wholesale ts-nocheck suppression IS caught by AC-13's derive-from-the-real-file design (K7, demonstrated: count 30 to 2 but the test fires), and this hook's runtime tests caught THIS mutant loudly (17/14/3, three AC5 failures) — so defence-in-depth, not an unguarded hole; the gap is a type-only defect with no behavioural coverage, exactly the layer #361 exists to add. Issue #361 PARTIALLY resolved. Exposure: 2 of 3 production hooks and every future edit netting at least 1 diagnostic of headroom, basis: counted in code.
5. [ISSUE][MED][demonstrated] The disclosed scanner residual's CLASS is understated and so is the consumer count: the header (:167-181) names only an unescaped adjacent pair inside a regex character class as "the one narrow exploitable shape", but a regex ending in an escaped slash blinds the rest of the line (drill N7b) and one containing an escaped block-comment opener swallows to EOF — and against a correct full-parse reference stripper I built (both leading AND trailing ranges, the thing the shipped oracle's doc claims) over all 193 sources, stripComments LOSES real code on 2 files today: src/policy/gate/gate-structure.test.ts (55 chars) and src/qa/marker-corpus-probe.test.ts (75 chars), plus 5 files where a region is copied through verbatim (up to 5570 chars). Both lossy files are .test.ts and every consumer's walk excludes tests (classification-builtin-override.test.ts:325), so live exposure is zero — measured, the only reason this is MED. Separately, the differential's own comment says a "future 4th consumer" only needs adding to its list: there are already 8 importers of stripComments, and classification-builtin-override.test.ts's R1-6 single-merge-site scan (the Issue #332 bypass detector) runs it over 104 production files with no differential behind them. Exposure: 2 of 193 sources lossy today / 0 in any production scan set / 104 production files scanned by an uncovered consumer, basis: measured.
6. [ISSUE][LOW][demonstrated] npm test is not green whenever ANY untracked file sits in the tree: pre-commit-scan.test.ts's R4 fresh-clone drill clones the working tree, so a single one-line innocuous untracked file gives 26/25/1, and at close of this review the two sibling reviewers' untracked reports alone gave 1525/1524/1. Pre-existing, not in this diff — reported because it collides with the DoD's "tests green with real counts" during exactly the review stage that creates those files, and the failure names secret scanning rather than the real cause. Exposure: 100% of review-stage verification runs before reports are committed, basis: measured.
7. [CLEAN][demonstrated] Round-2 drill N2 CLOSED: the KERNEL_GLOB string-literal comment-opener plus a real node:fs import and live readFileSync planted in kernel.ts now gives qa:kernel-purity FAIL rc=1 naming the non-relative import, plus 2 test failures (58/56/2); round 2 was PASS rc=0 with 1511/1511 identical to baseline.
8. [CLEAN][demonstrated] Round-2 drill N3 CLOSED, and the pin costs something: a real, useful one-line URL-bearing block comment is permanently in src/policy/gate/render-hook-output.ts:37, G21 passes 6/6, and resurrecting the deleted lineFirstThenBlock oracle verbatim confirms it WOULD have failed on it (stripComments 2125 chars vs old oracle 1489) — a genuine regression pin on a production file, not a synthetic fixture.
9. [CLEAN][demonstrated] Round-2 drill N4 CLOSED: the env-gated object-literal port planted at the real call site now fails AC-7/AC-7c (29/28/1); round 2 was 26/26 green with the bypass live end-to-end.
10. [CLEAN][demonstrated] Round-2 drill N5 CLOSED: a decoy renderHookOutput call ahead of a real call site passing raw identity now fails AC-7/AC-7c via the exactly-one-call-site assertion (10/9/1); round 2 was 7/7 green.
11. [CLEAN][demonstrated] Round-2 drill N6 CLOSED: dropping evaluateToolInventory's second argument now gives qa:hook-typecheck-coverage FAIL rc=1 with "31 diagnostic(s) found, exceeds its pinned Issue #361 baseline of 30 — a NEW regression"; round 2 was npm run build rc=0 and invisible everywhere. npm run build is still rc=0, which is the declared Manager-approved scope (the real gate still covers 1 of 3 hooks), not a defect.
12. [CLEAN][demonstrated] The self-caught template-substitution fix is real and load-bearing: 32 constructed shapes (nested, tagged, String.raw, tagged member expr, 3-deep nesting, object literals/arrows/class bodies/regex/backticks/escaped backticks inside substitutions, template literal types, and three invalid-escape shapes legal only in tagged templates — probing the hardcoded isTaggedTemplate:false) all keep a marker import placed after the poison, 0 blinded; and the reconstructed PRE-FIX naive loop diverges on the real kernel.ts (4206 chars vs the shipped 2920).
13. [CLEAN][demonstrated] Wholesale ts-nocheck suppression cannot game the pin: prepending it to hooks/sessionstart-tool-enum.mjs collapses the count from 30 to 2 and the instrument alone passes rc=0, but the AC-13 test FAILS (7/6/1) because it derives its mutant from the real file's CURRENT content at test-run time, so any suppression is inherited by the mutant and the assertion fires. A genuinely well-built pin; I found no way around it.
14. [CLEAN][demonstrated] The AST oracle never deletes real code: re-deriving its ranges exactly as shipped and asserting every removed range's text opens a comment gives 0 of 193 files removing a non-comment range. So the oracle is unsound by omission only, never by over-reach — which is why the differential remains a valid one-directional detector for the security-relevant direction and findings 1/5 stay MED.
15. [CLEAN][demonstrated] The decisions row's claim "zero regex literals exist today in any of the 8 enforced-lane production files" is accurate as stated: enforced-lane production files on disk = 8, kernel files the differential hand-lists = 4 vs 4 on disk, regex literals in enforced-lane production files = 0.
16. [CLEAN][code-traced] The coverage instrument's fail-loud paths hold: a hook absent from the resolved project file list fails naming the gap (:101-104); a non-excepted hook with any diagnostic fails (:108-114, proven live by a test that runs an excepted hook against an empty exception map); listProductionHooks is readdirSync-generated (:43-48) so a new hooks/*.mjs is picked up and then fails against the hand-typed include list; the .mjs-only filter is pinned by an exact 3-name deepEqual that fails loud on any addition or removal; a vacuous pass is tagged VACUOUS-PASS with an explicit disclosure note, this repo's established convention.
17. [CLEAN][demonstrated] CI wiring is real, not nominal: the "QA-18 hook-typecheck-coverage-check" step sits in the same job as the other structural gates (ci.yml:254-255, after the S2/S3 purity steps), package.json gains qa:hook-typecheck-coverage, the instrument builds a real ts.Program rather than approximating textually, and it costs real 0m2.583s.
18. [CLEAN][code-traced] ADR compliance on this attack surface: SE ADR-0021 POL-11/POL-12 enforcement made strictly more precise, not looser (findings 1/5 are gaps IN that structural test, the clause they land against, not new violations); SE ADR-0010's "MUST NOT delete or weaken a test / lower a threshold" NOT violated — G21's defective lineFirstThenBlock oracle was replaced in place inside the same named test, which still runs over every gate source and is stronger on its own shape, and the pinned baseline is a new floor where there was none; SE ADR-0005 satisfied (12 new tests, 0 removed, 0 skipped); THOTH-ADR-0001 untouched except its fresh-dated-review-report clause, which this report plus the two sibling reports discharge; THOTH-ADR-0002 untouched.
19. [CLEAN][code-traced] findAllRenderHookOutputCalls is conservative in the right direction on the evasion shapes beyond N5: it matches a PropertyAccessExpression named renderHookOutput and then asserts the count is exactly 1, so a destructured bare call and an element-access call both yield 0 and any extra decoy yields 2 — all three trip the assertion. Tagged code-traced, not demonstrated: I read the matcher and reasoned the counts rather than planting all three.
counts (CHECKSUM): issues=6 suspicions=0 clean=13
evidence (CHECKSUM): demonstrated=16 code-traced=3 derived=0
checks=baseline on the branch at 4ae8942: npm run build (BOTH tsc projects) rc=0; npx eslint src hooks rc=0; node --test rc=0, tests 1525 / suites 0 / pass 1525 / fail 0 / cancelled 0 / skipped 0 / todo 0; qa:kernel-purity, qa:normalizer-registry-purity, qa:gate-manifest, qa:gate-matcher-drift, qa:gate-command-path, qa:completeness-claims, qa:hook-typecheck-coverage all PASS rc=0. Closing re-run identical for build/lint/all 7 instruments; node --test at close 1525 tests / 1524 pass / 1 fail / 0 skipped, the single failure isolated and proven to be finding 6 (untracked-file sensitivity in pre-commit-scan.test.ts's R4 fresh-clone drill, reproduced with a one-line innocuous untracked file), not a regression. 10 mutation drills executed and reverted (round-2 N2/N3/N4/N5/N6 re-run, plus new N7b/N8/N9/C1/C2), 4 purpose-built instruments (a 193-file stripComments-vs-shipped-oracle differential, a 193-file stripComments-vs-correct-full-parse-reference differential, an oracle over-strip auditor, an enforced-lane regex-literal counter), 3 shape batteries (20 general + 12 template-family + 14 comment-position = 46 constructed inputs), and 1 real-spawned-hook sandbox run across 2 env cases. Tree clean of my own artifacts and HEAD unmoved at 4ae8942 at close.
adr=HIT(37)
report=docs/reviews/s312-fixnow-360-363-red-team-round3-2026-09-28.md
```

---

## Addendum (same session, appended not edited): reconciliation with the sibling reviewers

Read after this report's own findings were fixed and its receipt written; appended rather than folded in, per PRINCIPLES rule 11. Nothing above is changed, and no count in the receipt moves — none of this is my own demonstrated finding.

`app-security-reviewer` returned **REWORK** on the same PR with 2 `[HIGH][demonstrated]` findings (`docs/reviews/s312-fixnow-360-363-app-security-2026-09-28.md`). Both intersect my surface, and I am recording the relationship rather than leaving the Manager to infer it:

1. **Their HIGH 1 (`isSanitizeModuleImportCall` matches by `endsWith`, so any import path ending `/config/sanitize.ts` passes) is the same root-cause class as my R3.** Confirmed code-traced: `src/policy/config/sanitize.test.ts` computes `arg0.text.endsWith(SANITIZE_MODULE_SUFFIX)`, a suffix test, not a resolved-path comparison. My R3 attacks the same "the binding resolution is too loose" defect through scope shadowing; theirs attacks it through path spelling. **One fix closes both** — resolve the import specifier to a real path and compare it exactly, and resolve the binding from the call site's own scope chain. I did not test their vector and am not claiming it.
2. **Their HIGH 2 is my R4, at a different severity.** Same defect (the ratchet compares a raw count), a different route to it (`@ts-ignore` on a new bug rather than paying down an unrelated diagnostic). I rated it MED because the mutant I planted was caught loudly by the hook's own runtime tests (17/14/3), so the gap is defence-in-depth rather than an unguarded hole; they rated it HIGH. I am not re-litigating that — the calibration call is the Manager's (PRINCIPLES rule 21). My MED reasoning applies to their route as well: a behaviourally-observable defect still trips the runtime suite; what is genuinely unguarded in both routes is a type-only defect on an untested path.

**What this means for the verdict.** My `go` is a red-team verdict on the attack surface I was asked to re-confirm: the four round-2 residuals, the new scanner, and the new instrument. It is not a ship decision. With an open `[HIGH][demonstrated]` from `app-security-reviewer`, this PR does not merge — and I agree it should not, on their evidence. The correct read of the two reports together is: **the round-2 residuals are genuinely closed, and the new guards introduced to close them carry two fresh looseness defects, one of which is HIGH.** My R1/R2/R3/R4/R5 should be carried into the same fix-now round as their two HIGHs, because R2 and R3 in particular are one-line changes in the same two files.
