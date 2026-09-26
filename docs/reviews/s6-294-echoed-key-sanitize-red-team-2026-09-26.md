# Red Team (Sutekh) — s6-294-echoed-key-sanitize (Issue #294)

- Date: 2026-09-26
- Scope: post-build CRITICAL-tier adversarial review of branch `fix/s6-294-echoed-key-sanitize`
- HEAD: 41ab7b4 (detached review worktree), base `master` at b345adc
- Tier: CRITICAL (ratified, `docs/.maat-state.json`); sensitive area: policy delivery / config surface
- Verdict: **go** (no HIGH; two MED issues filed, three residual suspicions, one LOW)
- ADR state: `HIT(37)` after `git submodule update --init` (see finding 1 — the first run in this worktree reported `HIT(2)`)
- Checks run: policy-config suite 206 pass / 0 fail / 0 skipped; full suite 1325 tests, 1324 pass / 1 fail / 0 skipped (the one failure is the QA-14 dogfood test, caused by the uninitialized ADR submodule in this worktree; 85/85 green in that file after init); 12 mutants applied to a scratch mirror; 15 hostile end-to-end runs through the real printer.

## What was attacked

Every implicit assumption the change rests on:

| Assumption | Attack | Result |
| --- | --- | --- |
| `\p{Cc}` covers every terminal-active byte | 8-bit CSI, 8-bit OSC, NEL, DEL, NUL, CR, LF, U+2028, U+2029 | SURVIVES |
| Only C-class characters matter | format characters (bidi, zero-width, tag characters) | residual, accepted (finding 4) |
| The render boundary is complete | source scan + enumerating walk + 12 mutants | SURVIVES for the printer, gap in the CLI (finding 3) |
| Clean output is unchanged | byte comparison against `master` on the real repo | SURVIVES |
| Fail-closed direction is unchanged | exit code and posture line on every hostile run | SURVIVES |
| The printer never throws | a non-`Error` value thrown from a port | BREAKS (finding 2) |
| Sanitizing cannot change a decision | loader/schema/pin/precedence untouched, raw text kept below the boundary | SURVIVES |
| The catalog every later agent reads is intact | the branch's own `docs/.maat-state.json` | BREAKS (finding 1) |

## Findings, ranked by blast radius

### 1. [ISSUE][MED][demonstrated] The branch deletes the compressed ADR catalog from the shared state file, and the rebuild can report a 2-ADR catalog as a cache HIT

- Exposure: ~100% of subsequent agent ADR reads in this repository, basis: measured.
- Scenario: `master` carries `adrCatalog` with 37 ADRs in `docs/.maat-state.json`; the committed file at this branch's head has no `adrCatalog` key at all (that is most of the 5935-line diff on that file). After merge the next agent's `--ensure` rebuilds. In a checkout whose `adr` submodule is not initialized — a fresh clone without `--recurse-submodules`, or any new worktree, which is exactly the state this review worktree started in — the rebuild finds zero files under both submodule roots and still prints a success line ending in `[CACHE=HIT]`.
- Raw evidence, first command run in this worktree:

```
📊 ADR cache BUILT: cataloged 2 ADR(s) [adr/devops:0, adr/software-engineering:0, docs/adr:2], catalog now current (fp 9b0b204) [CACHE=HIT]
```

  and after `git submodule update --init`:

```
📊 ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp 2095e13) [CACHE=HIT]
```

- Current defense, honestly assessed: none for the silent half. The per-root counts are printed, so the information is on screen, but the verdict word is `HIT` and the headline count is plausible; nothing fails, and the instruction every agent follows is "never hard-stop on a miss". This story's own `test-writer` recorded `adr=HIT(37)`, so the story's gates were not degraded — the loss is forward-looking.
- Named proof-test before merge: `adr-cache refuses to report HIT when a configured ADR root resolves to zero ADR files` (plus regenerate the catalog on this branch with the submodule initialized, so the merge does not drop it).

### 2. [ISSUE][MED][demonstrated] `printEffectivePolicy` now throws where `master` returned a fail-closed rejection

- Exposure: ~0% of today's runs, basis: counted-in-code (the only shipped `CentralPolicySource` throws `Error` instances; no non-`Error` thrower exists in the tree today).
- Scenario: the last-resort backstop passes `(err as Error).message` into the sanitizer (`src/policy/config/printer.ts:157` into `:107`). When the thrown value is not an `Error` — a string thrown by a future or third-party port, or any property access that rejects with a non-`Error` — `message` is `undefined` and the sanitizer calls `.replace` on it. Before this change the same path interpolated the string `undefined` and returned `exitCode: 1`.
- Raw evidence (a central result whose `raw` accessor throws a non-`Error`):

```
TypeError: Cannot read properties of undefined (reading 'replace')
    at sanitizeForTerminal (.../src/policy/config/sanitize.ts:25:15)
    at renderRejection (.../src/policy/config/printer.ts:107:133)
    at printEffectivePolicy (.../src/policy/config/printer.ts:157:12)
```

  The same value thrown one level lower (from `read()` itself, caught by the loader) degrades instead to `REJECTED: central policy load failed (read-error): Cannot read properties of undefined (reading 'replace')` with `exitCode: 1` — fail-closed, but the diagnostic now names an internal type error instead of the real cause, and `central-channel status` reads `read-error` rather than the true status.
- Current defense: the printer's own outer `catch` covers the in-`try` case only; the backstop's own render is outside it. The module header states this function NEVER throws, and `print-cli.ts` has no `try`, so the CLI surfaces a stack trace with absolute paths on stderr — the same leak class the S7 fix-now removed from the hook — instead of the two-line rejection. Exit code stays 1, so the fail-closed direction holds.
- Fix (one line, consistent with the sibling site): the channel site already wraps with `String(...)`; do the same for the message, or resolve the backstop's value with `(err as Error)?.message ?? String(err)`.
- Named proof-test: `printEffectivePolicy returns a fail-closed rejection and never throws when a port throws a non-Error value`.

### 3. [ISSUE][LOW][demonstrated] The CLI's pin-channel echo is guarded only by a source scan a plausible refactor slips past

- Exposure: 0% of production runs today, basis: counted-in-code (the production channel is the constant descriptor in `src/policy/config/central-source.ts`); the risk is future regression, not present leakage.
- Scenario: mutant M2 rewrote the CLI pin line so the channel is interpolated as the sanitized value concatenated with the raw value. The interpolation scan's acceptance test is an anchored match on a call wrapper, and greedy matching accepts the concatenation; no behavioural test exercises the CLI's pin line at all (`print-cli.test.ts` asserts the posture line only).
- Raw evidence:

```
# M2 (scan-evading partial sanitize in the CLI pin line)
ℹ tests 206
ℹ pass 206
ℹ fail 0
ℹ skipped 0

# M1 (plain removal of the same wrapper) — killed by the scan
actual: [ 'result.pin.channel' ]
expected: []
```

- Current defense: the scan, honestly labelled a heuristic in the instrument's own header, with the enumerating walk named as the behavioural backstop. That backstop covers `printer.ts` only; the CLI is outside it.
- Named proof-test: `the CLI pin line is proven clean for a hostile channel descriptor` — cheapest route is the pattern this story already used for the inert-mandatory NOTE: move the pin line into a rendering function in `printer.ts` and assert it, rather than spawning the CLI.

### 4. [SUSPICION][MED][demonstrated] Format characters survive, including tag characters, and the output is read by an agent as well as a terminal

- Exposure: 0% of runs today (both policy layers in this repo carry zero rules, measured), any run once a policy file carries a crafted id, basis: measured.
- Scenario: a rule id containing a bidi override, a zero-width space, an isolate and two tag characters reaches stdout verbatim. Two rules whose ids differ only by a zero-width space render identically while resolving to opposite effects.
- Raw evidence (surviving code points reported by an independent checker, payload described rather than pasted):

```
A1 Cf-bidi-tag in central rule id | exit=0 | lines=3 | activeChars=0 | Cf=U+202e,U+200b,U+2066,U+feff,U+e0041,U+e0073,U+e007f
A11 id twins, zero-width (Cf survives) | exit=0 | lines=4 | activeChars=0 | Cf=U+200b
   ...rule id=deploy-prod effect=deny layer=central...
   ...rule id=deploy-<ZWSP>prod effect=allow layer=central...
```

- Current defense: an accepted, recorded residual (decisions row 2026-09-26, item 5; the module header repeats it) matching the S5 precedent, and `sanitize.test.ts` pins the behaviour as deliberate. Not a defect against the ruling.
- What the ruling does not name: the recorded wording is "bidi overrides, zero-width". Tag characters (U+E0000 block) are the same class and are the standard carrier for invisible instruction text, and `policy:print` output lands in an agent transcript, not only in a human's terminal. That channel is worth one sentence in the residual line.
- Named documenting test if the Manager wants the residual bound rather than only recorded: `printed policy text may still carry format characters, and that is the accepted residual` (asserting the exact surviving class, so any future narrowing is a deliberate edit).

### 5. [SUSPICION][MED][demonstrated] Strip-not-escape leaves the resolved-rules listing ambiguous

- Exposure: 0% of runs today (zero rules ship, measured), basis: measured.
- Scenario: two rules whose ids differ only by an escaped NUL print as byte-identical lines with opposite effects; the duplicate-id check compares raw ids, so it does not fire. The surface that exists to answer "why is this blocked" cannot distinguish them.
- Raw evidence:

```
A12 id twins, NUL escaped | exit=0 | lines=4 | activeChars=0
   ...rule id=deploy-prod effect=deny layer=central origin=chan-ok line=1 mandatory=false
   ...rule id=deploy-prod effect=allow layer=central origin=chan-ok line=1 mandatory=false
```

- Current defense: recorded residual (same row, item 5) — worded for keys ("two different hostile keys can strip to identical printed text"), and here it is rule ids in the resolved listing. Strip-not-escape is a ratified ruling, so escaping is not the fix to propose.
- Honest calibration: not a regression. A NUL inside an id was invisible on a terminal before the change too; stripping makes the line legible without making it unambiguous.
- Named proof-test if the Manager wants it closed rather than recorded: `printing two rules whose rendered ids collide is reported, not silently duplicated`.

### 6. [SUSPICION][LOW][demonstrated] The amended locked oracle is self-referential for rejection-message text

- Exposure: test-integrity only, basis: measured.
- Scenario: the amended helper in the locked `printer.test.ts` computes its expected message by running the honest message through the implementation's own sanitizer, so a sanitizer that strips too much moves the expectation with it. Mutant M12 added a stray letter to the strip class: the locked file stayed green.
- Raw evidence:

```
# M12 (sanitizer also strips one ASCII letter)
printer.test.ts      → tests 20  pass 20  fail 0
sanitize.test.ts     → tests 6   pass 3   fail 3
echo-sanitize.test.ts→ tests 100 pass 51  fail 49

# M10 (sanitizer becomes the identity function)
printer.test.ts      → tests 20  pass 19  fail 1   (the amended ISSUE-108(c) two-line assertion)
```

- Current defense: adequate in aggregate. Independence lives in `sanitize.test.ts` (explicit code-point oracle) and `echo-sanitize.test.ts` (explicit terminal-active range list), both of which kill the mutant the locked file misses, and the amended two-line assertion catches a no-op sanitizer on its own. The success-path expectations in the locked file are still computed independently of the sanitizer.
- Residual-register line, no test required: the locked file alone is no longer sufficient to detect an over-stripping sanitizer.

## What survived the attack

### 7. [CLEAN][demonstrated] No terminal-active byte reaches stdout on any hostile input tried

15 end-to-end runs through the real printer and loader: escape-introduced CSI, an 8-bit CSI, an 8-bit OSC introducer, NEL, CR, LF, NUL, DEL, U+2028 and U+2029, in a rule id, an unknown key, a duplicate key, a malformed document, a channel descriptor, a non-existent file path, and a reader error message. An independent checker counted terminal-active code units in every result: zero in all 15, and the rejection shape stayed at two lines every time. No output line could be forged: the forged-marker text, when present, survives only mid-line.

### 8. [CLEAN][demonstrated] Fail-closed direction and exit codes are unchanged

Every rejection kept `exitCode: 1` and the unresolved posture line; every valid load kept `exitCode: 0`. Sanitizing never converted a rejection into a load (the enumerating walk asserts this per position and re-ran green here).

### 9. [CLEAN][demonstrated] Clean output is byte-identical to `master`

`master`'s two print modules were installed into a scratch mirror of this tree and the CLI was run against the same real inputs, then the branch's modules were run the same way. The only difference is the pin timestamp:

```
diff <(mask computedAt < master-out) <(mask computedAt < head-out)  → IDENTICAL
exit=0 on both runs; 5 stdout lines on both
```

### 10. [CLEAN][code-traced] The strip is render-only, and nothing below it changed

The diff touches `printer.ts`, `print-cli.ts`, `sanitize.ts` and two test files; `loader.ts`, `rule/schema.ts`, `rule/precedence.ts`, `pin.ts` and every `hooks/*` file are untouched. Rule-id lookups and the duplicate-id and mandatory-lock comparisons still run on raw text, the pin digest is computed from raw layer text, and `PrinterResult.inertMandatoryDeclarations` deliberately carries the raw id with the rendering done at the boundary. The only importers of the printer are the CLI and its tests, so there is no second echo path out of this module.

### 11. [CLEAN][demonstrated] The behavioural backstop bites for the printer, including echoes the scan cannot see

Mutants applied to a scratch mirror (baseline 206 pass / 0 fail / 0 skipped):

```
M1  CLI pin channel, wrapper removed            → killed (interpolation scan)
M3  rejection message, wrapper removed          → killed, 47 fail
M4  resolved rule id, wrapper removed           → killed,  7 fail
M5  strip class narrowed to Cc only             → killed, 53 fail
M6  central channel in the status line           → killed,  3 fail
M7  inert-mandatory note rule id                → killed,  4 fail
M9  NEW raw echo added by string concatenation   → killed,  6 fail  (invisible to the scan, caught by the walk)
M2  scan-evading partial sanitize in the CLI     → SURVIVED (finding 3)
```

### 12. [CLEAN][demonstrated] No amplification or denial of service on large input

A 1 MiB hostile rule id rendered in 90 ms, on one line, with no escape byte surviving and a 750 KB result — linear, as the character-class replace implies.

### 13. [CLEAN][code-traced] The un-sanitized sibling echo path is out of scope and properly bound

The kernel verdict reason carries policy-derived text (`src/policy/kernel/kernel.ts:177` uses a rule's rationale, or its id in the fallback wording) and reaches the hook's deny output. That is site 10 in the plan, deferred by ruling to Issue #312 — verified open, labelled `bug` + `severity:low` + `sur`, milestoned S7. The hook is not wired into settings (no PreToolUse entry), its load-failure path passes layer and kind only, never the raw loader message, and its internal-exception path prints a fixed message plus an error name. Nothing in this diff widened that path.

### 14. [CLEAN][demonstrated] Suite health

```
node --test "src/policy/config/*.test.ts"
ℹ tests 206  ℹ pass 206  ℹ fail 0  ℹ skipped 0

node --test   (whole repository, ADR submodule not yet initialized)
ℹ tests 1325 ℹ pass 1324 ℹ fail 1  ℹ skipped 0
   the one failure: QA-14 dogfood reference resolver, cause "no ADR with this id exists in the tree"

git submodule update --init && node --test src/qa/reference-resolver.test.ts
ℹ tests 85   ℹ pass 85   ℹ fail 0  ℹ skipped 0
```

Typecheck and lint were NOT run here: this worktree has no `node_modules`. Verdict `UNPROVEN-pending-verification` for those two gates — settled by `npm ci && npm run typecheck && npm run lint`, runnable by whoever holds an installed tree (and by CI on the PR).

## Editorial (verdict-neutral)

- `docs/STATE.md` is not updated on this branch; the commit whose message mentions scope state changed `docs/.maat-state.json` only. The Definition of Done asks for both.
- The module header's residual list says "Manager to record in docs/decisions.md"; the row exists, so that sentence is stale and can lose the parenthetical.

## Scariest unproven assumption

That the compressed ADR catalog every later agent reads is intact after this merge. It is the one defect here that is silent, affects every subsequent review rather than any runtime path, and reports itself as a cache HIT while carrying 2 ADRs instead of 37.

## Verdict and next action

**go.** No HIGH finding; the two MEDs are cheap and neither gates by PRINCIPLES rule 21. Single next action: regenerate `docs/.maat-state.json`'s ADR catalog on this branch with the `adr` submodule initialized, and commit it with the one-line non-Error fix at the printer backstop.

## RECEIPT

```
RECEIPT: verdict=go
attacks (ranked by blast radius):
1. [ISSUE][MED][demonstrated] branch drops the 37-ADR catalog from docs/.maat-state.json; a submodule-less rebuild prints "cataloged 2 ADR(s) ... [CACHE=HIT]" — no gate fails, every later agent reads a 2-ADR slice. Exposure: ~100% of subsequent agent ADR reads, basis: measured
2. [ISSUE][MED][demonstrated] printEffectivePolicy THROWS (TypeError in the sanitizer) where master returned a fail-closed rejection, when a port throws a non-Error; backstop passes undefined into the strip; CLI emits a stack trace with absolute paths. Exposure: ~0% of runs today, basis: counted-in-code
3. [ISSUE][LOW][demonstrated] CLI pin-channel echo guarded only by the source scan; a scan-evading partial-sanitize mutant survived all 206 tests; no behavioural test covers that line. Exposure: 0% today (constant channel in production), basis: counted-in-code
4. [SUSPICION][MED][demonstrated] format characters survive, tag characters included; two ids differing by a zero-width space render identically with opposite effects — accepted residual, but the recorded wording names only bidi/zero-width and not the agent-transcript channel
5. [SUSPICION][MED][demonstrated] strip-not-escape: two rules whose ids differ by an escaped control character print as byte-identical lines with opposite effects and no duplicate-id error; not a regression, residual wording covers keys not rule ids
6. [SUSPICION][LOW][demonstrated] amended locked oracle is self-referential for rejection text (over-stripping mutant keeps printer.test.ts 20/20); independence preserved by sanitize/echo-sanitize oracles and the new two-line assertion
7. [CLEAN][demonstrated] zero terminal-active code units on 15 hostile end-to-end runs (escape CSI, 8-bit CSI/OSC, NEL, CR, LF, NUL, DEL, U+2028/9) across id, key, duplicate key, malformed doc, channel, path, reader message; no forged line
8. [CLEAN][demonstrated] fail-closed direction intact: exit 1 on every rejection with the unresolved posture line, exit 0 on every valid load; sanitizing never turned a rejection into a load
9. [CLEAN][demonstrated] clean output byte-identical to master on the real repo (pin timestamp masked), exit 0 both, 5 stdout lines both
10. [CLEAN][code-traced] render-only: loader, schema, precedence, pin and hooks untouched; comparisons and the pin digest use raw text; printer's only importers are the CLI and its tests
11. [CLEAN][demonstrated] 7 of 8 mutants killed, including a concatenated raw echo the scan cannot see (walk caught it): 47/7/53/3/4/6 failures respectively
12. [CLEAN][demonstrated] 1 MiB hostile id: 90 ms, one line, no escape byte, no amplification
13. [CLEAN][code-traced] the sibling unsanitized echo (kernel verdict reason to hook deny output) is out of scope and bound: Issue #312 open, labelled, milestoned S7, hook unwired, load-failure path carries layer and kind only
14. [CLEAN][demonstrated] suites: policy-config 206/206/0 skipped; whole repo 1325 tests 1324 pass 1 fail 0 skipped, the single failure environmental (uninitialised ADR submodule) and green after init
counts (CHECKSUM): issues=3 suspicions=3 clean=8
evidence (CHECKSUM): demonstrated=12 code-traced=2 derived=0
checks=policy-config 206 pass/0 fail/0 skipped; full suite 1325 tests 1324 pass/1 fail/0 skipped (environmental, green after submodule init: 85/85); 8 mutants applied, 7 killed; 15 hostile end-to-end runs; typecheck+lint UNPROVEN-pending-verification (no node_modules in this worktree)
adr=HIT(37)
report=docs/reviews/s6-294-echoed-key-sanitize-red-team-2026-09-26.md
```
