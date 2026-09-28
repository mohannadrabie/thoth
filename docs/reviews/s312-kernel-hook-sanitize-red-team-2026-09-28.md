# Red Team (Sutekh) — PR #358 / Issue #312 "sanitize kernel verdict reason and hook deny output"

- **Date:** 2026-09-28
- **Scope:** `story/312-kernel-hook-sanitize` vs `master` (PR #358). Tier: CRITICAL.
- **HEAD:** `0afe0ab docs: Issue #312 kernel/hook sanitize ship-loop artifacts (PR #358)`
- **Base:** `c2750a2`
- **Worktree:** `C:\playground\thoth\.claude\worktrees\agent-a63b7b47867d541b9` (isolated; every mutation below was reverted and the tree verified clean afterwards)
- **ADR cache:** `ADR cache BUILT: cataloged 2 ADR(s) [adr/devops:0, adr/software-engineering:0, docs/adr:2], catalog now current (fp 9b0b204) [CACHE=HIT]` — THOTH-ADR-0001 (central-classification fixture) and THOTH-ADR-0002 (secret-scan allowlist) read from `adrCatalog.adrs`; both `applicableTo: [security, architecture, code]`.
- **Verdict:** **no-go** — 2 `[HIGH]` `demonstrated` findings. The sanitization change itself is correct and proven end-to-end; the no-go is about the guard/instrument layer that the change own design rationale cites.

## One praised decision

Putting the `import("../src/policy/config/sanitize.ts")` inside the hook single `Promise.all` **within** the `try` is the right call, and I could not break it: a missing or renamed sanitizer module fails **closed** on every path, including the allow path (drill M14 below). The lazy alternative — importing it only when a deny needs rendering — would have made the allow path survive a broken sanitizer, turning a repair window into a silent-allow window on a runtime where silence means allow.

## Scorecard

| # | Attack | Status | Severity | Evidence |
|---|---|---|---|---|
| F1 | This PR own header comment silently disables G11/G11b/G15/G18 for the file it changed | BREAKS | HIGH | demonstrated |
| F2 | `stripComments` strips block comments before line comments, so the import-scanning purity instruments are blind repo-wide (`qa:kernel-purity` sees **zero** imports in 4 of 4 kernel files) | BREAKS | HIGH | demonstrated |
| F3 | The AC-7 structural guard is defeated by a conditional bypass, and false-positives on a benign hoist | BREAKS | MED | demonstrated |
| F4 | No test pins that a **long** reason is sanitized; a length-gated skip leaks raw ESC end-to-end with 22/22 green | BREAKS | MED | demonstrated |
| F5 | "Required parameter, fails loud" has no build-time force: `hooks/` is outside `tsconfig.include`, so all 3 production enforcement hooks are untypechecked | BREAKS | MED | demonstrated |
| F6 | No dated review report in `docs/reviews/` for this change at the time of review (CLAUDE.md hard rule) | BREAKS | LOW | code-traced |
| F7 | A zero-width-only rationale defeats the stated "never a blank `permissionDecisionReason`" invariant | BREAKS | LOW | demonstrated |
| F8 | Bidi RLO and other format characters survive into the operator-facing deny reason; residual accepted for `policy:print`, never re-assessed for this surface | BREAKS | LOW | demonstrated |
| F9 | Policy-authored `rationale` has no length cap at the render boundary, while `tool_name` has `REASON_NAME_CAP = 512` | BREAKS | LOW | code-traced |
| F10 | The PR new test file is outside G19 `STORY_TEST_FILES`, so its self-declared PC-11 compliance is unenforced | BREAKS | LOW | code-traced |
| C1 | "Construct or call `renderHookOutput` so it silently skips sanitization" — second export, barrel, legacy caller | SURVIVES | — | demonstrated |
| C2 | Partial apply: sanitize module missing or renamed at load time | SURVIVES | — | demonstrated |
| C3 | Dropping the `sanitize` argument entirely — fail-open or fail-closed? | SURVIVES | — | demonstrated |
| C4 | Does the sanitizer actually neutralize this hook threat classes? | SURVIVES | — | demonstrated |
| C5 | ReDoS and latency on a hostile oversized rationale | SURVIVES | — | demonstrated |
| C6 | Both deny legs (verdict-deny and pre-kernel refusal) funnel through one sanitized call site | SURVIVES | — | demonstrated |
| C7 | Polarity: does the allow path stay byte-silent and never invoke `sanitize`? | SURVIVES | — | demonstrated |
| C8 | ADR compliance on my attack surface (THOTH-ADR-0001, THOTH-ADR-0002) | SURVIVES | — | code-traced |

Ranked by **exposure x irreversibility x silence**, not by how alarming the failure sounds. F1 and F2 rank top because they are *silent* — nothing fails, nothing warns — and because they disable a named enforcement control rather than producing a wrong answer.

---

## F1 — [ISSUE][HIGH][demonstrated] This PR new header comment silently disables four structural guards for the file it changed

`Exposure: 1 of 3 production files in src/policy/gate/ (33%) and 4 of 5 gate-structure guards, basis: counted in code`
*(Security / control-integrity category — exempt from PRINCIPLES rule 21 exposure cap.)*

**Scenario.** A later story adds a filesystem write or a `node:` import to `src/policy/gate/render-hook-output.ts` — the exact two things G15 and G18 exist to forbid (R13: "this hook writes no file"; G15: "ports are gate-owned"). CI is green. Review sees the guards pass and reads that as a positive statement. Nothing warns.

**Root cause, path:line.** `src/qa/kernel-purity-check.ts:148`:

```ts
return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
```

Block comments are stripped **before** line comments. This PR added, at `src/policy/gate/render-hook-output.ts:21`, the glob `src/policy/gate/**` inside a `//` comment. The `/*` inside `gate/**` opens a fake block comment; the lazy match closes on the first `*/` after it — which is the `*/` of the other thing this PR added, the `sanitizedDenyJson` JSDoc at line 62.

```
$ node -e "locate the fake block in render-hook-output.ts"
fake block comment swallows lines 21 to 62 of 87
opens at:  "ol-call.ts to keep this pure and importless: src/policy/gate/**\n// m"
closes at: "y string — never emit a blank `permissionDecisionReason`. */"
```

Lines 21-62 contain the file **only** `import` statement, plus `isNonEmptyString`, `denyJson`, `failClosed` and `sanitizedDenyJson`. All are invisible to every `stripComments`-based scan.

**This is a regression this PR introduces.** On `master` the same file was fully visible:

```
$ node -e "extractImportSpecifiers on both revisions"
PR     HEAD imports: []
MASTER base imports: ["./decide-tool-call.ts"]
PR stripComments length:   1417 of 5196
BASE stripComments length: 1754 of 2633
```

**Current defense, honestly assessed.** `src/policy/gate/gate-structure.test.ts` G11/G11b/G15/G18 all call `stripComments(source)` before scanning (lines 24, 42, 62); G15 additionally calls `extractImportSpecifiers(source)` (line 50), which is also `stripComments`-based (`kernel-purity-check.ts:399`). All four are therefore blind for this file. AC-7 in `sanitize.test.ts` reads the **raw** hook source and is unaffected.

**Mutation drill M13 — planted a `node:fs` import AND a `writeFileSync` call inside the blinded region:**

```
$ node mutate.mjs src/policy/gate/render-hook-output.ts \
    "function isNonEmptyString" "import { writeFileSync } from \"node:fs\";\nfunction isNonEmptyString"
$ node mutate.mjs src/policy/gate/render-hook-output.ts \
    "function denyJson(reason: string): HookOutput {" "function denyJson(reason: string): HookOutput {\n  writeFileSync(\"C:/temp/leak.txt\", reason);"
MUTATED
MUTATED
$ node --test src/policy/gate/gate-structure.test.ts
OK G11: routing purity: the gate directory has no switch and no string literal Bash or mcp__ outside tool-routing.ts ... (2.0041ms)
OK G11b: no per-toolType conditional (PC-12) ... (0.6247ms)
OK G15: the gate directory has no node:* import and no import from src/policy/config/ (ports are gate-owned) (0.8924ms)
OK G18: no write path: neither the hook nor any gate file calls a filesystem-write API (R13) (0.792ms)
OK G19: no literal fixture entry name in this story new test files (PC-11) (3.9242ms)
i pass 5
i fail 0
```

With a write-safe temp path, the same mutant also clears typecheck, lint and the whole suite:

```
$ npm run -s build   # tsc --noEmit
build rc=0
$ npx eslint src/policy/gate/render-hook-output.ts
lint rc=0
$ node --test
i tests 1504
i pass 1502
i fail 2      # QA-14 dogfood (environmental, see Environment note) + R4 (flaky 37 s clone test, passed on the very next clean run)
i skipped 0
```

Clean baseline for comparison: `tests 1504 / pass 1503 / fail 1 / skipped 0`.

**Also falsified by this:** the PR own stated design rationale. `render-hook-output.ts:21-23`, `docs/decisions.md:85`, `docs/STATE.md:10` and `CHANGELOG.md:12` all assert that "`src/policy/gate/**` may import neither `node:*` nor anything under `config/` (G15, `gate-structure.test.ts`)". Drill M12 planted exactly that import and G15 passed 5 of 5. The constraint that justifies the awkward injected-port design is, for this file, unenforced.

**Verdict: BREAKS.**

**Named proof-test required before merge.**
`gate-structure.test.ts :: "G21: every gate source is fully visible to the structural scanner (no // comment opens an unterminated block comment)"` — for each `gateSources()` entry, assert `stripComments(source).length === lineCommentsFirst(source).length`, so a comment that eats code fails loud instead of silently widening the hole. Fixing the root cause (F2) satisfies this; rewording the comment alone does not, and will silently regress the next time anyone types a `/**` glob.

---

## F2 — [ISSUE][HIGH][demonstrated] `stripComments` blinds the import-scanning purity instruments repo-wide — `qa:kernel-purity` sees zero imports in 4 of 4 kernel files

`Exposure: 16 of 190 production+test sources lose code to the shipped stripComments; 4 of 4 src/policy/kernel production files and 1 of 3 src/policy/gate production files report zero visible imports, basis: measured`
*(Security / control-integrity category — exempt from PRINCIPLES rule 21 exposure cap. **Pre-existing on `master`, not introduced by this PR** — but F1 is a new instance of it, and this PR design rests on the instrument being real.)*

**Scenario.** Any future change re-imports `node:fs`, `node:child_process` or `src/policy/config/**` into the kernel — the single hardest invariant this project has ("No filesystem, network, process-spawning, timer, or vendor-SDK import MAY appear anywhere under the kernel own module boundary ... enforced by a lint rule or structural test", quoted at `src/policy/kernel/kernel.ts:8-11`). `npm run qa:kernel-purity` prints PASS. CI is green.

**Measured blast radius** — an instrument, not a hand count: a differential between the shipped `stripComments` and a line-comments-first strip, over every `.ts`/`.mjs`/`.js` under `src/`, `hooks/`, `scripts/`:

```
scanned files: 190
files where the shipped stripComments eats MORE than a correct strip: 16
  src\policy\config\printer.test.ts                        CODE-CHARS-LOST=2611
  src\qa\reference-resolver.ts                             CODE-CHARS-LOST=2363
  src\qa\normalizer-registry-purity-check.ts               CODE-CHARS-LOST=1803
  src\qa\kernel-purity-check.ts                            CODE-CHARS-LOST=1290
  src\qa\shell-detector-mutants.ts                         CODE-CHARS-LOST=1287
  src\policy\gate\render-hook-output.ts                    CODE-CHARS-LOST=706   <-- new in this PR
  src\policy\rule\schema.ts                                CODE-CHARS-LOST=539
  src\policy\rule\precedence.ts                            CODE-CHARS-LOST=412
  src\policy\normalizer\shell-scanner-work.test.ts         CODE-CHARS-LOST=315
  src\policy\kernel\kernel.ts                              CODE-CHARS-LOST=181
  src\policy\kernel\rule-types.ts                          CODE-CHARS-LOST=170
  src\policy\normalizer\registry.ts                        CODE-CHARS-LOST=105
  src\policy\tools\classification-builtin-override.test.ts CODE-CHARS-LOST=60
  src\policy\kernel\action-record.ts                       CODE-CHARS-LOST=38
  src\policy\normalizer\action-catalog.ts                  CODE-CHARS-LOST=3
  src\policy\config\echo-sanitize.test.ts                  CODE-CHARS-LOST=-138
```

The triggering text is always a glob in a `//` comment — `src/policy/kernel/**`, `src/policy/normalizer/**`, `../fixtures/**`. The documentation of the boundary being enforced is what disables its enforcement.

**What the instruments actually see:**

```
src/policy/gate production .ts files: 3 decide-tool-call.ts, render-hook-output.ts, tool-routing.ts
   decide-tool-call.ts   -> visible imports: ["../kernel/kernel.ts", ... 7 specifiers]
   render-hook-output.ts -> visible imports: []
   tool-routing.ts       -> visible imports: [...3 specifiers]
src/policy/kernel production .ts files: 4 action-record.ts, kernel.ts, rule-types.ts, verdict.ts
   action-record.ts -> visible imports: []
   kernel.ts        -> visible imports: []
   rule-types.ts    -> visible imports: []
   verdict.ts       -> visible imports: []
src/policy/normalizer production .ts files: 10
  BLIND: registry.ts visible=0 actual-import-lines=1
```

`kernel.ts` has three real `import type` lines at 20-22; the fake block opened at line 11 by `src/policy/kernel/**` swallows lines 11-31.

**Mutation drill M15 — planted `node:fs` and `src/policy/config/sanitize.ts` imports inside `kernel.ts`:**

```
$ node mutate.mjs src/policy/kernel/kernel.ts \
    "import type { ActionRecord } from \"./action-record.ts\";" \
    "import { readFileSync } from \"node:fs\";\nimport { sanitizeForTerminal } from \"../config/sanitize.ts\";\nimport type { ActionRecord } from \"./action-record.ts\";"
MUTATED
$ npm run -s qa:kernel-purity
[QA kernel-purity-check] PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.
rc=0
$ node --test src/qa/kernel-purity-check.test.ts src/policy/kernel/*.test.ts
i tests 95
i pass 95
i fail 0
$ node --test        # full suite, mutant in place
i tests 1504
i pass 1503
i fail 1      # identical to the clean baseline
i skipped 0
```

**Honest scope limit — the AST layer still works.** The `kernel-purity-check.ts` AST forbidden-globals layer does **not** go through `stripComments`, and it fires correctly inside the blinded region:

```
$ # planted: const LEAK = globalThis.process?.env?.SECRET;  inside kernel.ts lines 11-31
$ npm run -s qa:kernel-purity
[QA kernel-purity-check] FAIL: 1 kernel-purity violation(s) found across 4 file(s) under src/policy/kernel/.
  - src/policy/kernel/kernel.ts: [forbidden-global] forbidden global/pattern "globalThis" found (AST: property access ".process" on forbidden global "globalThis" (possibly via alias))
```

So the blindness is **import-scanning only** — which is precisely the layer enforcing "no `node:*`, no `config/`", and precisely the layer this PR design cites. A `node:fs` import used as `readFileSync(...)` is a local binding, not a forbidden root, so the AST layer does not back it up.

**Verdict: BREAKS.**

**Named proof-test required.**
`src/qa/kernel-purity-check.test.ts :: "stripComments: a // line comment containing a block-comment opener does not swallow the code below it"` — assert that a source of `// see src/policy/kernel/**` followed by `import x from "node:fs";` followed by a real JSDoc still yields the import line. Fix: strip line comments first, or use one left-to-right scanner. Then `src/qa/kernel-purity-check.test.ts :: "every scanned kernel file reports its real import count"` as the regression pin.

---

## F3 — [ISSUE][MED][demonstrated] The AC-7 structural guard is defeated by a conditional bypass, and false-positives on a benign hoist

`Exposure: 100% of future refactors of the one call site, basis: counted in code (one call site, hooks/pretooluse-kernel-gate.mjs:191)`

The guard is `src/policy/config/sanitize.test.ts:110-114`:

```ts
assert.match(hook, /renderHookOutput\([\s\S]*?\.sanitizeForTerminal\)/, ...)
```

`[\s\S]*?` is unbounded across the whole file, and the match only requires the literal text `.sanitizeForTerminal)` to appear *somewhere after* a `renderHookOutput(`.

**Drill M5 — a conditional bypass passes the guard and every other test.** `hooks/pretooluse-kernel-gate.mjs:191` becomes:

```js
const output = render.renderHookOutput(gate.decideToolCall(input, ports),
  process.env.THOTH_RAW_REASON ? ((s) => s) : sanitizeMod.sanitizeForTerminal);
```

```
$ node --test src/policy/gate/render-hook-output.test.ts src/policy/config/sanitize.test.ts hooks/pretooluse-kernel-gate-sanitize.test.ts
i tests 17   i pass 17   i fail 0   i skipped 0
$ node --test hooks/*.test.ts src/policy/gate/gate-structure.test.ts
i tests 120  i pass 120  i fail 0   i skipped 0
$ npm run -s qa:kernel-purity            -> PASS
$ npm run -s qa:gate-manifest            -> PASS
$ npm run -s qa:gate-matcher-drift       -> PASS
$ npm run -s qa:gate-command-path        -> PASS
```

And the bypass is live — run through the **real** hook in the pinned copy-tree sandbox with the env var set:

```
RUN: code=0 stdout="{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"\u001b[31m\nREJECTED-LOOKALIKE: forged\u0000[2J\"}}"
RAW-ESC-PRESENT: true RAW-NUL-PRESENT: true
```

**Drill M9 — and the guard false-positives on a plainly correct refactor** (hoisting the port into a local before the call):

```
X Issue #312: hooks/pretooluse-kernel-gate.mjs imports and wires sanitizeForTerminal from this module
i pass 8   i fail 1
```

That combination is the failure mode this repo already lived through in the R1-6 / R1-6b / R1-6d saga (Issue #332): a name-shaped guard that blocks the benign edit and waves the harmful one through, training the next author to loosen the regex rather than the invariant.

**What the guard does catch, credited honestly:** the two most likely accidental regressions both die. M1 (remove the `sanitize(...)` call in `render-hook-output.ts`) produces 5 failures across AC-1, AC-2, AC-4 and both AC-8 end-to-end tests. M2 (hook passes an identity function) produces 3 failures, including AC-7 itself.

**Verdict: BREAKS** (as a guard; the shipped code is correct).

**Named proof-test required.**
`hooks/pretooluse-kernel-gate-sanitize.test.ts :: "AC-9: the hook sanitizes regardless of environment — a hostile rationale is stripped with THOTH_* env vars set and unset"` — a behavioural pin over the real hook via `sb.mcp(name, "x", env)`, replacing the source-text regex as the load-bearing guard. Keep AC-7 as a cheap smoke check; stop treating it as the drift guard.

---

## F4 — [ISSUE][MED][demonstrated] No test pins that a long reason is sanitized; a length-gated skip leaks raw ESC end-to-end with every test green

`Exposure: any deny whose rule rationale exceeds the hypothetical bound; rationale has no length cap in the schema (src/policy/rule/schema.ts:195 checks type only), basis: counted in code`

Every hostile fixture in the PR three test files is short (`HOSTILE` is about 60 characters). Nothing pins the long case. A length guard is a *likely* refactor here, not a contrived one: the sibling file already has exactly one (`decide-tool-call.ts:57`, `REASON_NAME_CAP = 512`), so "bound the render cost" is the natural next edit.

**Drill M8 — `render-hook-output.ts:64` becomes `const cleaned = reason.length > 1000 ? reason : sanitize(reason);`:**

```
$ node --test src/policy/gate/render-hook-output.test.ts src/policy/config/sanitize.test.ts \
             hooks/pretooluse-kernel-gate-sanitize.test.ts src/policy/gate/gate-structure.test.ts
i tests 22   i pass 22   i fail 0   i skipped 0

$ # same mutant, real hook, 1632-character hostile rationale:
LEN: 1632 RAW-ESC: true RAW-NUL: true
```

**Verdict: BREAKS.**

**Named proof-test required.**
`src/policy/gate/render-hook-output.test.ts :: "AC-10: a hostile reason is sanitized at every length — 10, 1000 and 100000 characters"`, parameterised over lengths that straddle any plausible bound, plus the same assertion once end-to-end in `pretooluse-kernel-gate-sanitize.test.ts`.

---

## F5 — [ISSUE][MED][demonstrated] "Required parameter, fails loud" has no build-time force — `hooks/` is outside `tsconfig.include`

`Exposure: 3 of 3 production enforcement hooks (hooks/pretooluse-kernel-gate.mjs, hooks/sessionstart-tool-enum.mjs, hooks/userpromptsubmit-halt-relay.mjs), basis: counted in code`

`tsconfig.json` is `"include": ["src/**/*.ts"]`. The **only** production caller of `renderHookOutput` is `hooks/pretooluse-kernel-gate.mjs`, which TypeScript never sees. The "no default parameter, fail-loud" design (`render-hook-output.ts:26-28`, repeated in `decisions.md:85` and `STATE.md:10`) therefore gives the actual caller **zero** compile-time protection.

**Drill M11 — hook drops the second argument entirely:**

```
$ npm run -s build        # tsc --noEmit
build rc=0                 # silent
$ npx eslint hooks/pretooluse-kernel-gate.mjs
  151:57  error  "sanitizeMod" is assigned a value but never used  no-unused-vars
```

ESLint catches it only incidentally, because the import binding happened to become unused. A partial refactor that still used `sanitizeMod` elsewhere would slip through.

**Runtime behaviour, credited honestly — it fails CLOSED, never open:**

```
ALLOW-PATH: code=0 stdout="" stderr=""
DENY-PATH:  code=2 stdout="" stderr="pretooluse-kernel-gate.mjs: internal exception, fail-closed (exit 2). Unlock: retry the call; ... Error type: TypeError"
```

Two residuals in that: the defect is **invisible on every allow** (so a smoke test of a gate whose baseline is allow-everything finds nothing), and when it does fire it converts every deny into a generic `internal exception` that does not name the cause.

**Verdict: BREAKS** (the stated mechanism does not exist at build time; the security outcome is nonetheless safe).

**Named proof-test required.**
Add a `tsconfig.hooks.json`, or extend `include` to cover `hooks/` with `allowJs`/`checkJs`, and pin it: `src/qa/*.test.ts :: "every production hook under hooks/ is covered by a typecheck project"` — enumerate `hooks/*.mjs` from disk and assert each resolves inside a tsconfig file list, so the set is generated by an instrument rather than hand-listed (CLAUDE.md, "No hand-derived completeness claims").

---

## F6 — [ISSUE][LOW][code-traced] No dated review report existed in `docs/reviews/` for this change

```
$ ls docs/reviews | grep -i "312|kernel-hook"
(empty)
```

CLAUDE.md, Hard rules: "No changes to the sensitive areas above ... without a fresh dated review report in `docs/reviews/`." The literal sensitive-area clause is "any other `hooks/*` enforcement point **wired** to `PreToolUse` / `UserPromptSubmit`", and this hook is deliberately **not** wired (`.claude/settings.json` has no `PreToolUse` entry); `src/policy/guard/*` does not exist in this tree at all. **Manager call, not mine.** This report discharges the red-team half; a CRITICAL-tier run still needs its domain reviewer(s) plus `cross-domain-reviewer` per the CLAUDE.md tier table.

**Verdict: BREAKS** (process gate), non-gating on its own. No GitHub Issue filed (LOW severity).

---

## F7 — [ISSUE][LOW][demonstrated] A zero-width-only rationale defeats the "never a blank permissionDecisionReason" invariant

`Exposure: 0% of shipped rules today (no shipped rationale contains a format character), basis: counted in code`

`render-hook-output.ts:30-34` and `:61-62` state the invariant: a reason that strips to empty is fail-closed, "never emit a blank `permissionDecisionReason`". `isNonEmptyString` tests `length > 0`, and `sanitizeForTerminal` deliberately keeps `\p{Cf}` — so a rationale of only zero-width characters is non-empty by length and **blank on screen**. End-to-end, real hook stdout, via the pinned sandbox:

```
zero-width only   | survivesIdentical=true | visibleChars=0 | out="\u200b\u200b\u2060\ufeff"
```

The call is still denied, so this is a signal-quality defect, not a fail-open — but it lands squarely on PRINCIPLES rule 2: the operator gets a block that names no reason at all.

**Named proof-test:** `render-hook-output.test.ts :: "AC-11: a reason with no visible characters is fail-closed, same as an empty one"`.

---

## F8 — [ISSUE][LOW][demonstrated] Bidi and other format characters survive into the operator-facing deny reason

`Exposure: 0% of shipped rules today, basis: counted in code`

```
bidi RLO override | survivesIdentical=true | visibleChars=20 | out="<RLO>DEWOLLA si llac siht<PDF>"
```

That renders in a terminal as `this call is ALLOWED` — on a **deny**. `sanitize.ts:19-21` records this as an accepted residual, but the acceptance was written for `policy:print` (#294 / #278), where the text is a diagnostic. The Issue #312 surface is different: a deny reason a human reads while deciding whether to override. Same characters, different stakes; the residual was inherited, not re-assessed.

**Fix:** record the residual for *this* surface in `docs/decisions.md`, or extend the strip class to `\p{Cf}` for the deny-render boundary only. Either is fine; silently inheriting the #294 acceptance is not.

---

## F9 — [ISSUE][LOW][code-traced] Policy-authored `rationale` has no length cap at the render boundary

`Exposure: unbounded per deny; basis: counted in code (src/policy/rule/schema.ts:195 checks type only; no length assertion anywhere in schema.ts)`

`decide-tool-call.ts:55-59` bounds the untrusted `tool_name` to 512 characters with a visible truncation marker, explicitly because a prior red team found that "a 400 KB name produced a 400 KB deny". The policy-authored `rationale` — which this story has just established is *also* untrusted text — gets no such treatment. A 5 MB rationale yields a roughly 4 MB `permissionDecisionReason` written straight into model context.

Latency is **not** the risk (see C5): 5 MB sanitizes in 58 ms against a 2000 ms p99 budget. Context flooding is.

---

## F10 — [ISSUE][LOW][code-traced] The new test file is outside the G19 `STORY_TEST_FILES` list

`hooks/pretooluse-kernel-gate-sanitize.test.ts:11-13` asserts of itself that "no committed fixture entry name is typed anywhere in this file (PC-11)". `gate-structure.test.ts:68-86` does not list it:

```
forbidden names: 14 | literal hits in the new test file: 0 []
new file listed in G19 STORY_TEST_FILES: false
```

The claim is true today and unguarded tomorrow — a hand-asserted completeness claim with no instrument behind it (CLAUDE.md hard rule). The file header explains the omission as a story-boundary choice; that reasoning covers *which story owns the list*, not *whether the invariant is enforced*. One-line fix: add the path.

---

## SURVIVES

**C1 — "Construct or call renderHookOutput so it silently skips sanitization" [demonstrated].** There is no such surface. Exactly one production call site, one export, no barrel, no legacy caller:

```
$ grep -rn "renderHookOutput" --include=*.ts --include=*.mjs --include=*.js --include=*.md . | grep -v node_modules
# -> 1 production call site (hooks/pretooluse-kernel-gate.mjs:191), 1 export
#    (src/policy/gate/render-hook-output.ts:68); every other hit is a test or a doc.
$ grep -rn "export [*]" --include=*.ts src        # no barrel re-exporting it
```

**C2 — Partial apply: sanitize module missing or renamed [demonstrated].** Drill M14 pointed the dynamic import at a nonexistent file:

```
ALLOW-PATH: code=2 stderr="pretooluse-kernel-gate.mjs: internal exception, fail-closed (exit 2). ... Error type: Error"
BASH-PATH:  code=2 stderr="pretooluse-kernel-gate.mjs: internal exception, fail-closed (exit 2). ... Error type: Error"
```

Fail-closed on **every** path including allow, because the import sits in the one `Promise.all` inside the `try`. This is the praised decision above.

**C3 — Dropping the `sanitize` argument: fail-open or fail-closed? [demonstrated].** Fail-closed (exit 2, `TypeError`) — see the F5 runtime evidence. No path turns a missing sanitizer into silence-means-allow.

**C4 — Does the sanitizer actually neutralize the threat classes this hook cares about? [demonstrated].** Verified against constructed payloads, not taken from the tests:

```
$ node --test src/policy/config/sanitize.test.ts
OK sanitizeForTerminal strips exactly the C0, DEL, C1, U+2028 and U+2029 code points across the whole BMP (13.5881ms)
```

That test sweeps all 65536 BMP code units against an **independent** range oracle at `sanitize.test.ts:20-23`, not against the regex the implementation uses. End-to-end through the real hook I confirmed that ESC (U+001B), NUL (U+0000), 8-bit C1 CSI (U+009B), LF, CR, U+0085, U+2028 and U+2029 are all stripped; `ESC[31m` becomes `[31m`, and an LF-forged `REJECTED-LOOKALIKE:` line cannot start a new line. The line-forging and escape-emitting classes are genuinely closed. Format characters and homoglyphs survive — documented, and re-raised as F8.

**C5 — ReDoS and latency [demonstrated].** `/[\p{Cc}\p{Zl}\p{Zp}]/gu` is a flat character class; no backtracking structure exists to exploit:

```
len=9996     ms=0.2   outLen=8330
len=99996    ms=2.1   outLen=83330
len=999996   ms=9.6   outLen=833330
len=4999998  ms=58.0  outLen=4166665
```

Linear; 5 MB in 58 ms against a measured 2000 ms p99 gate budget. No timeout-to-silent-allow route here.

**C6 — Both deny legs funnel through one sanitized call site [demonstrated].** The verdict-deny leg (`:78`) and the pre-kernel refusal leg (`:83`) both route through `sanitizedDenyJson`. Drill M1 (remove the `sanitize(...)` call) is killed by 5 tests spanning both legs and both the unit and end-to-end levels; drill M2 (identity sanitizer at the hook) by 3. I could find no third route to `denyJson`, and no route from policy-derived text into the `failClosed` stderr text: those messages are fixed text plus `JSON.stringify` of the internal `kind` and `outcome` enums, neither of which is policy-authored.

**C7 — Polarity unchanged [demonstrated].** AC-3 spy-counts zero `sanitize` invocations on allow, and the real hook stays byte-silent on the allow path (`ALLOW-PATH: code=0 stdout="" stderr=""`, from the F5 drill). The silence-means-allow contract is untouched by this change.

**C8 — ADR compliance on my attack surface [code-traced].** THOTH-ADR-0001: no hook or `src/` file hardcodes an entry of `knownConnectors` or `centralLayer.tools` — the new test file derives its name from `firstCommittedEntryName()` (`pretooluse-kernel-gate-sanitize.test.ts:16, 47`), 0 literal hits measured; the fixture loader, its path resolution and halt-state recording are untouched. THOTH-ADR-0002 (status `proposed`): `docs/qa/secret-scan-allowlist.json` and `src/secret-scan/patterns.ts` are not in the diff, and no `docs/reviews/` exclusion is added. No violation on either.

---

## Hostile lens — compromised CI runner

The load-bearing guards for this change are all **tests** (AC-1 through AC-5, AC-7, AC-8, G15, G18, `qa:kernel-purity`). A runner that can edit the workflow or the test files removes them in one commit; that is this repo standing trust assumption and not new here. What *is* new and worth naming: F1 and F2 mean an attacker does not need that level of access. Typing a glob such as `src/policy/kernel/**` into a `//` comment is an ordinary, reviewable-looking documentation edit that silently disables the import-purity control for that file, and nothing anywhere goes red. That is a lower-privilege, higher-deniability path to the same outcome, and it is the weakest link in this chain.

## Environment note (reproducibility)

`docs/decisions.md:85` claims `npm test` at 1504/1504, 0 fail. In this fresh worktree the clean baseline is **1504 tests / 1503 pass / 1 fail / 0 skipped**; the single failure is `QA-14 (dogfood)` reporting `ADR-0021 ... no ADR with this id exists in the tree`, because the `adr/` submodule is uninitialised here (`git submodule status` shows `-cdb245d977fd67889bf69c9710a13b70a8b5045f adr`). Environmental, not attributable to the PR, and it affects the baseline and every mutant run identically — the mutation results above are all differentials against that same baseline. Verdict-neutral; recorded so the next reader is not surprised.

## Editorial (verdict-neutral, plain edits, no re-review)

- `render-hook-output.ts:21-23`, `decisions.md:85`, `STATE.md:10` and `CHANGELOG.md:12` assert that "G15 ... forbids it under `src/policy/gate/**`" as established fact. It is not, for this file (F1). Reword to state the intended constraint rather than the enforcement, or fix the enforcement.
- `sanitize.ts:16` says "ACCEPTED RESIDUALS (Manager to record in `docs/decisions.md`)" — the residual list is still only in the source comment; the #312 row does not carry it (F8).
- The comment at `pretooluse-kernel-gate.mjs:147-150` re-states the G15 / kernel-purity constraint a third time. One canonical statement plus cross-references would age better than three copies that have to be corrected together.

## Open findings vs failing tests

10 open findings; 8 have an executable form named above (F1 to G21, F2 to two `kernel-purity-check.test.ts` cases, F3 to AC-9, F4 to AC-10, F5 to a hook-typecheck-coverage pin, F7 to AC-11, F10 to a one-line `STORY_TEST_FILES` addition). Two have no executable form: **F6** is a process gate (an artifact must exist, not a behaviour), and **F8** resolves to a residual-register line in `docs/decisions.md` unless the Manager elects to extend the strip class, in which case it becomes a `sanitize.test.ts` oracle change.

## Scariest unproven assumption

**That a green `qa:kernel-purity`, `G15` or `G18` means the purity boundary holds.** It does not, and has not on `master` either: the import scan those controls rest on sees zero imports in every kernel file and in the gate file this PR touched, and I planted a `node:fs` import in `src/policy/kernel/kernel.ts` that the entire 1504-test suite plus the dedicated instrument waved through. Every design argument in this PR — and the reason `renderHookOutput` takes an injected port at all — is downstream of that assumption.

## Go / no-go

**no-go.** Two `[HIGH]` `demonstrated` findings, both in the security / control-integrity category. The *sanitization* this story set out to do is correct, complete across both deny legs, proven end-to-end against the real hook, and fails closed under every partial-failure drill I could construct — that part is genuinely good work and I tried hard to break it. What blocks is that the same commit silently switched off four structural guards on the file it changed, and that the instrument underneath them was already blind.

## Single next action

Fix `src/qa/kernel-purity-check.ts:148` to strip line comments **before** block comments, then re-run `npm run qa:kernel-purity` and `node --test src/policy/gate/gate-structure.test.ts` and triage whatever newly goes red. That one change closes F1 and F2 together and makes the rest of the design claims in this PR true.

---

```
RECEIPT: verdict=no-go
attacks (ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] This PR own new header comment (`src/policy/gate/render-hook-output.ts:21`, the glob `src/policy/gate/**` in a `//` comment) opens a fake block comment that closes on the new JSDoc `*/` at line 62, hiding lines 21-62 (the only import, denyJson, failClosed, sanitizedDenyJson) from every stripComments-based scan; defense assessed: G11/G11b/G15/G18 all strip first, so all four are blind — a planted `node:fs` import + `writeFileSync` passes gate-structure 5/5, tsc rc=0, eslint rc=0 and the full 1504-test suite. Exposure: 1 of 3 production files in src/policy/gate/ and 4 of 5 gate-structure guards, basis: counted in code. Regression vs master (master saw the import, HEAD sees none).
2. [ISSUE][HIGH][demonstrated] Root cause, pre-existing repo-wide: `src/qa/kernel-purity-check.ts:148` strips block comments BEFORE line comments, so any `//` comment containing a `/**` glob swallows code; `qa:kernel-purity` sees ZERO imports in 4 of 4 kernel files and PASSES with `node:fs` + `src/policy/config/sanitize.ts` planted in kernel.ts, full suite identical to baseline; 16 of 190 sources measurably lose code; defense assessed: the AST forbidden-globals layer still fires (it does not use stripComments), so the blindness is import-scanning only — exactly the layer this PR design cites. Exposure: 4/4 kernel + 1/3 gate + normalizer/registry.ts, basis: measured.
3. [ISSUE][MED][demonstrated] The AC-7 structural drift guard (`sanitize.test.ts:110-114`, `renderHookOutput\([\s\S]*?\.sanitizeForTerminal\)`) is defeated by a conditional bypass — an env-gated ternary ending in `sanitizeMod.sanitizeForTerminal)` passes 17/17 PR tests, 120/120 hook+gate tests and all 4 QA instruments while leaking raw ESC and NUL through the real hook stdout — and it false-positives on a benign hoist refactor; defense assessed: it does kill the two likeliest accidental regressions (M1, M2). Exposure: 100% of future refactors of the one call site, basis: counted in code.
4. [ISSUE][MED][demonstrated] No test pins that a LONG reason is sanitized; a length-gated skip (`reason.length > 1000 ? reason : sanitize(reason)`) passes 22/22 and leaks raw ESC end-to-end at 1632 chars; defense assessed: none — every hostile fixture is ~60 chars, and the sibling file already carries a cap (REASON_NAME_CAP=512), so a bound is a likely refactor. Exposure: any deny whose rationale exceeds the bound; schema has no rationale length cap, basis: counted in code.
5. [ISSUE][MED][demonstrated] The "required parameter, fails loud" design has no build-time force: `tsconfig.include` is `["src/**/*.ts"]`, so the only production caller (a .mjs hook) is never typechecked — dropping the argument gives `npm run build` rc=0; defense assessed: runtime fails CLOSED (exit 2, TypeError) so no fail-open, but the defect is invisible on every allow and reports only a generic "internal exception". Exposure: 3 of 3 production enforcement hooks, basis: counted in code.
6. [ISSUE][LOW][code-traced] No dated review report existed in `docs/reviews/` for this change at review time (CLAUDE.md hard rule); defense assessed: the hook is unwired, so the literal "wired to PreToolUse" sensitive-area clause may not bite — Manager call. This report discharges the red-team half only.
7. [ISSUE][LOW][demonstrated] A zero-width-only rationale (U+200B/U+2060/U+FEFF) is non-empty by `length` and blank on screen, defeating the stated "never a blank permissionDecisionReason" invariant; defense assessed: `isNonEmptyString` checks length, and the strip class deliberately keeps `\p{Cf}`. Still denies, so signal-quality not fail-open. Exposure: 0% of shipped rules today, basis: counted in code.
8. [ISSUE][LOW][demonstrated] Bidi RLO survives end-to-end into the operator-facing deny reason and renders as a reversed, allow-looking sentence; defense assessed: documented as an accepted residual for `policy:print` (#294/#278), never re-assessed for a deny-render surface a human reads while deciding to override. Exposure: 0% of shipped rules today, basis: counted in code.
9. [ISSUE][LOW][code-traced] Policy-authored `rationale` has no length cap at the render boundary while the untrusted `tool_name` has REASON_NAME_CAP=512 (`decide-tool-call.ts:55-59`); defense assessed: none; latency is fine (5 MB in 58 ms) so the risk is model-context flooding, not timeout. Exposure: unbounded per deny, basis: counted in code.
10. [ISSUE][LOW][code-traced] `hooks/pretooluse-kernel-gate-sanitize.test.ts` self-asserts PC-11 compliance but is absent from G19 `STORY_TEST_FILES`, so the claim is unenforced (0 literal hits today, measured); defense assessed: none — a hand-asserted completeness claim with no instrument.
11. [CLEAN][demonstrated] No way to construct or call `renderHookOutput` that silently skips sanitization: exactly one production call site, one export, no barrel, no legacy caller (grep over .ts/.mjs/.js/.md).
12. [CLEAN][demonstrated] Partial apply — sanitize module missing or renamed at load time fails CLOSED (exit 2) on every path including allow, because the import sits in the one `Promise.all` inside the `try`.
13. [CLEAN][demonstrated] Dropping the `sanitize` argument fails CLOSED (exit 2, TypeError), never fail-open; the silence-means-allow polarity is never reachable through a missing sanitizer.
14. [CLEAN][demonstrated] The sanitizer really does neutralize this threat model: C0/DEL/C1/U+2028/U+2029 stripped exactly, swept across all 65536 BMP code units against an independent oracle; ESC, NUL, 8-bit CSI and LF line-forging all confirmed stripped through the real hook stdout.
15. [CLEAN][demonstrated] No ReDoS or latency route: a flat character class, linear, 5 MB in 58 ms against a measured 2000 ms p99 gate budget.
16. [CLEAN][demonstrated] Both deny legs (verdict-deny `:78` and pre-kernel refusal `:83`) funnel through one `sanitizedDenyJson`; M1 killed by 5 tests, M2 by 3; no third route to `denyJson` and no policy-derived text reaches the `failClosed` stderr text.
17. [CLEAN][demonstrated] Polarity unchanged: the allow path never invokes `sanitize` (spy-counted) and the real hook stays byte-silent on allow.
18. [CLEAN][code-traced] ADR compliance on this attack surface: THOTH-ADR-0001 (no hardcoded fixture entry; loader/path/halt-state rules untouched) and THOTH-ADR-0002 (allowlist, patterns and the docs/reviews baseline guard untouched) — no violation.
counts (CHECKSUM): issues=10 suspicions=0 clean=8
evidence (CHECKSUM): demonstrated=14 code-traced=4 derived=0
checks=full suite clean baseline `node --test`: 1504 tests / 1503 pass / 1 fail / 0 skipped (the 1 fail is QA-14 dogfood, environmental: the adr/ submodule is uninitialised in this worktree); PR-scope `node --test src/policy/gate/render-hook-output.test.ts src/policy/config/sanitize.test.ts hooks/pretooluse-kernel-gate-sanitize.test.ts`: 17 tests / 17 pass / 0 fail / 0 skipped; `npm run build` rc=0; `npx eslint` rc=0; qa:kernel-purity PASS, qa:gate-manifest PASS, qa:gate-matcher-drift PASS, qa:gate-command-path PASS; 10 mutation drills executed and reverted (M1, M2, M5, M8, M9, M11, M12, M13, M14, M15) plus 3 constructed-payload probes through the real hook sandbox.
adr=HIT(2)
report=docs/reviews/s312-kernel-hook-sanitize-red-team-2026-09-28.md
```

---

## Addendum (same session, appended not edited): a QA-14 false-positive citation reworded

`node src/qa/reference-resolver.ts` (QA-14) flagged the standalone backtick span `` `../config/sanitize.ts` `` (at what was line 172 and line 475/RECEIPT-finding-2) as an `unresolved-authority` path citation — it reads a bare, path-shaped backtick span as a repo-relative citation, and this report's relative-from-`kernel.ts` form does not resolve from the repo root. Same class of false positive as the already-open Issue #341 (a hypothetical/relative example path in an adversarial review report's own prose). Both occurrences reworded, same session, to the unambiguous repo-root-relative form `` `src/policy/config/sanitize.ts` `` — the identical file, zero semantic change, not inside any fenced code block or quoted source snippet (those are untouched). This addendum discloses the edit per PRINCIPLES.md rule 11's spirit; the finding's substance, severity, and RECEIPT counts are unchanged.
