# Red Team (Sutekh) — S6 fix-now re-confirm round (Issues #110, #108)

- **Date:** 2026-09-08
- **Scope:** `s6` — S6 policy centralization, fix-now round closing Issue #110 and Issue #108 (REOPENED)
- **Tier:** CRITICAL (inherited; touches `src/policy/config/`, a `CLAUDE.md`-named *Policy delivery / config surface* sensitive area)
- **HEAD:** `88002aa`
- **Commits attacked:** `8468ab4` (Issue #110 fix), `a7014ab` (Issue #108 fix + test-writer amendment), `88002aa` (lint-only comment fix)
- **ADR cache:** ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — ~17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]
- **Prior reports re-confirmed against:** `docs/reviews/s6-policy-centralization-red-team-round2-2026-09-08.md` (finding 3 → Issue #110), `docs/reviews/s6-policy-centralization-red-team-round4-2026-09-08.md` (finding 1 → Issue #108 REOPENED)

---

## Headline

**Both fixes are real, and I confirmed both independently rather than on the implementer's word.** My own round-2 repro for Issue #110 — two loads differing only in the project layer, one with the project layer voided by a mandatory-lock — no longer produces one shared digest. My own round-4 UTF-8 BOM repro for Issue #108 no longer misattributes a project-file fault to the central channel, on any of the four non-central failure branches, and the new try/catch wrapping introduced **zero** fail-open paths across six read/parse failure shapes. The locked answer key was genuinely honored: I reconstructed the RED state myself by running HEAD's `printer.test.ts` against pre-fix source and got exactly test-writer's claimed 9 pass / 2 fail.

**What I found is not in either fix — it is in the guards around them, and it is the same shape twice.** Both fixes shipped with a named regression test that does not test the property it is named for:

1. Issue #110's two "no concatenation-boundary collision" tests pick the one layer pair that **cannot** collide even with the framing entirely deleted. I removed the length-prefix framing from `pin.ts` and the 43-test config suite stayed **43/43 green**, while the two boundaries that actually matter genuinely collided.
2. Issue #108's locked "EXACTLY 2 lines on a fail-closed rejection" contract holds only because the BOM fixture is a **single-line minified** file. Against the repo's own pretty-printed `printer-project.json` with the identical 3-byte BOM — the exact PowerShell 5.1 / Notepad shape the test's own comment names — stdout is **3 lines**.

Neither is a live defect: the shipped `pin.ts` framing survived 21,141 adversarial inputs with zero genuine collisions, and every rejection still exits 1 with no rule data leaked. Both are the recurrence, at #7 and #8, of this codebase's own signature bug family that round 4 named: *a general-looking mechanism, correct in the place someone checked, untested in the place nobody did.* This time it landed in the tests rather than the code, which is the better half of the file to have it in — but it is the half this project's DoD treats as the answer key.

**Verdict: go.** Two MED findings, both `demonstrated`, neither gating, both filed as Issues and both convertible to a named failing test.

---

# Findings, ranked by blast radius

## 1. [ISSUE][MED][demonstrated] Issue #110's own "no concatenation-boundary collision" tests exercise the one layer pair that cannot collide — deleting the framing entirely leaves the suite 43/43 green

**Attack.** `src/policy/config/pin.ts:65-69` frames each layer as `"<label>:<byte-length>:" + <content>`, and both the commit message and the file header name this as the defense against boundary collisions: *"a naive hash.update(a); hash.update(b) would let two different (a, b) splits of the same total bytes collide."* Two tests are named for that property:

- `src/policy/config/pin.test.ts:31` — *"no concatenation-boundary collision between two different (shipped, project) splits of the same total bytes"*
- `src/policy/config/loader.test.ts:609` — the same split, end-to-end.

Both pick (shipped, project). In the shipped byte stream those two frames are **never adjacent** — the central frame always sits between them, and it is never empty (it is either `centralRaw` or a ~24-byte sentinel). So the assertion holds regardless of whether the framing exists at all.

I deleted the framing (mutant M3: replace the `hash.update(label:byteLength:)` line with a no-op) and ran the suite:

```
$ node --test src/policy/config/pin.test.ts src/policy/config/loader.test.ts src/policy/config/printer.test.ts
BASELINE:                        tests 43   pass 43   fail 0   skipped 0
M1 project-frame dropped:        tests 43   pass 41   fail 2   skipped 0
M2 shipped-frame dropped:        tests 43   pass 41   fail 2   skipped 0
M3 framing prefix removed:       tests 43   pass 43   fail 0   skipped 0     <-- SURVIVES
M4 printer re-hardcodes central: tests 43   pass 41   fail 2   skipped 0
RESTORED:                        tests 43   pass 43   fail 0   skipped 0
```

M1, M2 and M4 are each caught. M3 — the mutation that removes the mechanism the fix advertises as its core defense — is not. Here is what M3 actually breaks, and which of it the tests look at:

```
--- MUTANT M3 (framing prefix removed) ---
shipped-vs-project split ("ab","")  vs ("a","b"): distinct      <-- the ONLY split the tests check
shipped|central boundary ("ab","c") vs ("a","bc"): COLLIDES     <-- untested
central|project boundary ("c","ab") vs ("cab",""): COLLIDES     <-- untested
--- SHIPPED code (framing intact) ---
shipped-vs-project split ("ab","")  vs ("a","b"): distinct
shipped|central boundary ("ab","c") vs ("a","bc"): distinct
central|project boundary ("c","ab") vs ("cab",""): distinct
```

**Current defense, honestly assessed.** The shipped code is **correct** — proved separately, see finding 6. `shippedRaw`/`projectRaw` being required (non-optional) fields does structurally prevent the *omission* regression (M1/M2 both caught). What has no guard is the *framing* regression: a future refactor that simplifies `updateLabeledFrame` down to a bare `hash.update(content)` — a plausible "this prefix looks redundant" cleanup, since nothing in the suite argues for it — ships green and silently re-opens the collision class on the two adjacent boundaries. Central content is the attacker-influenced layer in this system's own threat model (`docs/REQUIREMENTS.md` section 0.4 property 2), and it sits on both of the untested boundaries.

**Exposure:** 0% of runs today (the shipped framing is correct and verified); 100% of future pin digests if the framing regresses undetected. Basis: **demonstrated** — mutation-verified, 2 of 2 named boundary tests are non-adjacent-split. Irreversible: no. Silent: **yes** — the suite stays green.

**Verdict: BREAKS** (the regression guard, not the fix).

**Proof-test required (named, failing):** `src/policy/config/pin.test.ts` -> **"Issue #110: neither ADJACENT frame boundary (shipped|central, central|project) admits a collision"**, asserting distinct digests for ("ab","c","") vs ("a","bc","") and ("","c","ab") vs ("","cab",""). It must fail against M3 and pass against HEAD. Optionally strengthen with the property form: a small enumerated cross-product asserting digest-injectivity over an adversarial alphabet, so no future boundary is left unnamed.

---

## 2. [ISSUE][MED][demonstrated] The locked "EXACTLY 2 lines on a fail-closed rejection" contract holds only for a single-line minified fixture — the real PowerShell/Notepad shape the test names produces 3

**Attack.** `src/policy/config/printer.test.ts`'s `buildExpectedRejectionStdout` asserts:

```js
assert.equal(lines.length, 2, "expected EXACTLY 2 lines on a fail-closed rejection (no rule lines may leak through)");
```

That invariant is carried by every rejection fixture in the file, including the two new `ISSUE-108(a)/(b)` cases. The `ISSUE-108(a)` fixture `docs/qa/s6-policy-loader-fixtures/printer-project-bom-malformed.json` is **one line** — a minified document, unlike every other fixture in that directory, which are pretty-printed. That single-line shape is what keeps the count at 2: `JSON.parse`'s error message embeds a snippet of the source document, and a pretty-printed document puts a newline inside that snippet.

Run the same real 3-byte EF BB BF BOM against the repo's own pretty-printed `printer-project.json` — the shape a PowerShell 5.1 `Out-File -Encoding utf8` save of a normal policy file actually has, which is the trigger the test's own comment names:

```
$ node lines.ts
shipped BOM fixture: lines in file = 1
--- stdout for a BOM on the repo's OWN pretty-printed project fixture ---
central-channel status=absent
REJECTED: project policy load failed (json-parse-error): C:\...\real-bom.json: Unexpected token ..., "...{
  "vers"... is not valid JSON
--- exitCode: 1 | stdout line count: 3 | contract says EXACTLY 2
rule data leaked (/rule id=/): false
raw policy content echoed into stdout: false
```

**Current defense, honestly assessed.** Genuinely strong on the part that matters: `exitCode` is 1, `assert.doesNotMatch(actual, /rule id=/)` is the assertion that actually guards the leak concern, and it holds — no rule data escapes on any shape I tried. The layer is still named correctly. What is wrong is only the *line-count* proxy for that concern: it is asserted against the one document shape that is not what real operators have, so the locked contract is silently untrue for ~100% of realistic BOM rejections. A future story that reads `printer.test.ts` as the specification will build to a two-line guarantee the printer does not offer.

**Exposure:** ~100% of fail-closed rejections whose failing file is pretty-printed (which is every fixture in `docs/qa/s6-policy-loader-fixtures/` except the one this test uses) — 0% of them covered by the contract as asserted. Basis: **demonstrated**. Irreversible: no. Silent: **yes**.

**Verdict: BREAKS** (the contract's fidelity to its own named production trigger, not the fix).

**Proof-test required (named, failing):** `src/policy/config/printer.test.ts` -> **"ISSUE-108(c): a BOM on a PRETTY-PRINTED project file still names the PROJECT layer, exits 1, and leaks no rule data"**, with the line-count invariant restated as `>= 2` plus the `doesNotMatch(/rule id=/)` leak assertion rather than a hard `=== 2`, and a multi-line BOM fixture added alongside the minified one. This is a `test-writer` amendment (it edits the locked answer key), not an implementer edit.

---

## 3. [SUSPICION][LOW][demonstrated] A `CentralPolicySource` returning a status outside the union degrades silently to "central contributes zero rules" at exit 0

**Attack.** `src/policy/config/loader.ts:154` branches on `centralResult.status === "present"`; everything else falls through to "contributes zero rules, not a rejection" (AC5a). There is no runtime `default` that rejects an unrecognized value. Bypassing the type system at runtime:

```
=== rogue central status values (runtime, type system bypassed) ===
  status="bogus"     -> exit=0 line1=central-channel status=bogus      rulesPrinted=true
  status=""          -> exit=0 line1=central-channel status=           rulesPrinted=true
  status=null        -> exit=0 line1=central-channel status=null       rulesPrinted=true
  status=undefined   -> exit=0 line1=central-channel status=read-error rulesPrinted=true
  status="Present"   -> exit=0 line1=central-channel status=Present    rulesPrinted=true
  status="PRESENT"   -> exit=0 line1=central-channel status=PRESENT    rulesPrinted=true
```

The `status=undefined` row is the ugly one: the operator reads `central-channel status=read-error` on line 1 and a full resolved-rule listing beneath it, at exit 0. `status="Present"` (capital P) silently drops the entire central layer while claiming it is present.

**Current defense, honestly assessed.** The type system, and it currently holds: `src/policy/config/central-source.ts:243, 264, 279` (plus the `unsupported` early return) are the **only** producers, and all four return closed-union string literals derived from exit codes, never from parsed external output. There is no path from reg.exe stdout to a status value. The sentinel path in `src/policy/config/pin.ts:66-73` would likewise stringify an unknown status rather than throw.

**Exposure:** 0% of runs today. Basis: **assumption** for any future exposure — which per PRINCIPLES rule 18/21 caps this at LOW, and the only permitted recommendation is to close it structurally or measure it. `CentralPolicySource` is an explicit pluggable interface, so a second implementation is a realistic future, not a hypothetical.

**Verdict: UNPROVEN** — demonstrated behavior, unproven production trigger. Not gating, not introduced by this diff.

**Proof-test required (named, failing):** `src/policy/config/loader.test.ts` -> **"an unrecognized CentralPolicyResult.status is rejected fail-closed, never treated as absent"** — plus a runtime `default:` arm in `loadEffectivePolicy` returning a `LoadFailure` with `failedLayer: "central"`. Alternatively route to `docs/backlog.md` with this repro attached; silence is the one option not available.

---

## 4. [SUSPICION][LOW][code-traced] POL-09 pin is produced and printed but compared to nothing — "a change under review cannot alter the policy that judges it" is detective-by-human-inspection, not preventive

**Attack.** Grepped every consumer of the pin in production code:

```
$ grep -rn "pin\.digest|\.pin\b|computePin" --include=*.ts --include=*.mjs --include=*.js src hooks scripts | grep -v "\.test\.ts"
src/policy/config/loader.ts:52     import { computePin, type PolicyPin } from "./pin.ts";
src/policy/config/loader.ts:230    const pin = computePin({
src/policy/config/pin.ts:85        export function computePin(...)
src/policy/config/print-cli.ts:26  if (result.pin) {
src/policy/config/print-cli.ts:27    process.stdout.write("pin: sha256:" + result.pin.digest + " ...");
src/policy/config/printer.ts:100   pin: result.pin,
```

One producer, one printer, **zero comparators**. Nothing stores a baseline digest, nothing diffs the current digest against a recorded one, no gate or CI step fails when the digest changes. POL-09 requirement text is *"A change under review cannot alter the policy that judges it"* — after this fix the digest finally *covers* all three layers, which is real and is what Issue #110 asked for, but the digest changing still causes nothing to happen. The "cannot" is still carried by a human noticing a hex string move.

**Current defense, honestly assessed.** Not this round job, and not a regression — Issue #111 ("computed then discarded") was closed by *surfacing* the pin, and this round closed the *scope* half. The remaining gap is the *comparison* half, which no Issue names. Worth stating plainly rather than letting "POL-09 pin: done" harden.

**Exposure:** 100% of pin values, basis **counted-in-code** (1 producer, 1 printer, 0 comparators). Irreversible: no. Silent: yes.

**Verdict: UNPROVEN** — a scope statement, not a break. Route to `docs/backlog.md` or a POL-09 residual line, not a blocker.

---

# What held up — re-attacked with my own repros, and defended

## 5. [CLEAN][demonstrated] Issue #110 original repro no longer reproduces — two materially different effective policies no longer share one digest

Round 2 exact scenario, rebuilt: central present with a `mandatory` rule; p1 project layer applies in full; p2 project layer redefines the mandatory id and is voided in its entirety.

```
$ node repro110b.ts
p1 rules: 3 voided: []
p2 rules: 2 voided: ["project"]
p1 digest: 1cc3797516b7cabed96629baa4669cc83c50fc42dd3aba27f31fb6138c990e5d
p2 digest: 58e239a2a4e258b4f712015d71e3e4e01ea87de6f4b3de5147785b391a45aedb
SHARE ONE DIGEST (original #110 defect)? false
channel carried: test-channel
```

Round 2 output was `4e81fba5...` twice with `materially different effective policies share ONE pin digest? true`. It is now `false`. Sensitivity confirmed in both other directions as well:

```
$ node repro110.ts
ORIGINAL-#110-DEFECT-STILL-PRESENT (materially different policies share ONE digest)? false
reproducible for identical bytes? true
shipped-layer edit changes digest? true
```

Determinism preserved (identical bytes produce an identical digest), and a shipped-defaults edit — previously invisible to the pin — now moves it.

---

## 6. [CLEAN][demonstrated] The new labeled length-prefixed framing has no fresh collision class — 21,141 adversarial inputs, 0 genuine framing collisions

I was asked to probe the new scheme for the ambiguity shape I have flagged elsewhere: can two layers (label, length, bytes) triples ever be reassembled ambiguously? Structurally, no — the labels are fixed constants, the order is fixed, and `Buffer.byteLength` emits a canonical no-leading-zero decimal terminated by a colon (digits cannot contain a colon), which is a netstring-style injective encoding. I did not want to ship that as reasoning, so I ran it against an alphabet built specifically to break it: label look-alikes ("central", "project:0:", "shipped-defaults:1:"), digit/colon boundary bait ("1:", ":1", "9:9:", "1:central:1:", "x:23:"), both status sentinels as content, multi-byte UTF-8, an emoji surrogate pair, and a lone surrogate.

```
$ node framing2.ts
inputs=21141 distinctDigests=19683 sentinelAliasPairs=1458 genuineFramingCollisions=0
```

Every collision found is the **pre-existing central-sentinel aliasing** class — `centralStatus: "present"` with `centralRaw` exactly equal to `__thoth-central-absent__` / `__thoth-central-unsupported__` — which predates this fix and which I confirmed is **unreachable through the only real call site**, because every spelling of it fails closed before a pin is ever computed:

```
$ node sentinel.ts
central raw = __thoth-central-absent__        -> ok=false reason=json-parse-error failedLayer=central
central raw = "__thoth-central-absent__"      -> ok=false reason=schema-invalid   failedLayer=central
central raw = __thoth-central-unsupported__   -> ok=false reason=json-parse-error failedLayer=central
central absent -> pin= 611f60beeaedee5c09f2677f50cdc23323bbc342e648793463033da7b24631c0
```

Residual, noted not filed: `computePin` is exported, so a hypothetical second caller that bypasses the `loadEffectivePolicy` parse gate could reach the aliasing. One call site exists today (`src/policy/config/loader.ts:230`); LOW, no action beyond this line.

## 7. [CLEAN][demonstrated] Issue #108 BOM repro no longer reproduces, on any non-central failure branch

My round-4 repro, re-run against the fixed code, plus the symmetric and read-error cases:

```
=== (1) UTF-8 BOM on .thoth/policy.json, central ABSENT ===
central-channel status=absent
REJECTED: project policy load failed (json-parse-error): ...project.json: Unexpected token ...
exitCode: 1 | MISATTRIBUTES-TO-CENTRAL? false

=== (2) BOM on the SHIPPED-DEFAULTS file ===
REJECTED: shipped-defaults policy load failed (json-parse-error): ...      exit 1 | misattributes? false

=== (3) MISSING project file (read-error, previously UNCAUGHT readFileSync) ===
REJECTED: project policy load failed (read-error): ...ENOENT...            exit 1 | misattributes? false

=== (4) MISSING shipped-defaults file ===
REJECTED: shipped-defaults policy load failed (read-error): ...ENOENT...   exit 1 | misattributes? false

=== (5) project path is a DIRECTORY (EISDIR read-error) ===
REJECTED: project policy load failed (read-error): ...EISDIR...            exit 1 | misattributes? false

=== (6) central channel itself throws (must STILL say central) ===
central-channel status=read-error
REJECTED: central policy load failed (read-error): subprocess timeout      exit 1

=== (7) central present + malformed (must say central, status preserved) ===
central-channel status=present channel=reg://HKLM/Thoth
REJECTED: central policy load failed (json-parse-error): reg://HKLM/Thoth: ...   exit 1
```

Round 4 finding was that line 1 said `status=absent` while line 2 said `central policy load failed`. That contradiction is gone. Cases (6) and (7) confirm the fix did not over-correct: when central genuinely is the offender it is still named, and its innocent status/channel is preserved on non-central failures.

I also pushed 15 hostile project-file shapes through the real printer (empty, whitespace-only, `null`, top-level array, `rules` not an array, rule elements that are strings or `null`, duplicate ids, a `__proto__` payload, a 5000-rule document, a lone surrogate in an id, an embedded NUL, a nested-`rules` decoy, a `mandatory` project declaration):

```
hostile project inputs: 15, misattributed-to-central: 0, backstop reached: 0
```

`src/policy/config/printer.ts:120` last-resort `catch` — the one place `failedLayer` is still hardcoded to "central" — was **not reachable** by any of them. That backstop is now honestly documented as a genuinely-unknown-origin fallback rather than the default path it used to be.

## 8. [CLEAN][demonstrated] The new try/catch wrapping introduced no fail-open path

The specific risk named in the brief — a read error silently defaulting to some layer success rather than failing closed. Six read/parse failure shapes:

```
=== (8) FAIL-OPEN PROBE: does any read/parse failure ever produce exitCode 0? ===
  project BOM:      exit=1 rulesPrinted=false pin=undefined lines=3
  shipped BOM:      exit=1 rulesPrinted=false pin=undefined lines=3
  project missing:  exit=1 rulesPrinted=false pin=undefined lines=2
  shipped missing:  exit=1 rulesPrinted=false pin=undefined lines=2
  project isdir:    exit=1 rulesPrinted=false pin=undefined lines=2
  shipped isdir:    exit=1 rulesPrinted=false pin=undefined lines=2
fail-open paths found: 0
```

Every `catch` arm in `src/policy/config/loader.ts:181-190` and `:199-208` returns a typed `LoadFailure`. Neither swallows the error into a default-empty ruleset, neither continues to the merge, and no pin is computed on a rejected load. (The `lines=3` rows are finding 2, not a leak — `rulesPrinted=false` on every one.)

## 9. [CLEAN][demonstrated] `failedLayer` completeness is instrument-verified, not eyeballed — 6 of 6 `LoadFailure` return statements set it

CLAUDE.md hard rule forbids hand-derived completeness claims, so I did not count these by reading:

```
$ node -e "match every `return { ... };` containing ok:false, check each for failedLayer:"
LoadFailure return statements: 6 | missing failedLayer: 0
```

Sites: `src/policy/config/loader.ts:146` (central read-throw), `:159-166` (central parse-failure), `:182-189` (shipped-defaults read-error), `:193` (shipped-defaults parse-failure), `:200-207` (project read-error), `:211` (project parse-failure). All six set it, none is left to be inferred by the caller. (The commit message and CHANGELOG enumerate *four* — see Editorial.)

## 10. [CLEAN][demonstrated] The locked answer key was genuinely honored, independently reconstructed — not taken on the implementer word

`a7014ab` bundles the test-writer amended `printer.test.ts` and the story-implementer `printer.ts` fix in **one** commit, so git history alone cannot show the test red before the fix. I reconstructed that state myself: a worktree at `8468ab4` (pre-#108-fix source), with HEAD `printer.test.ts` and the two new fixtures copied in.

```
$ node --test <worktree>/src/policy/config/printer.test.ts
X ISSUE-108(a): ... the rejection must name the PROJECT layer, NEVER claim "central policy load failed" ...
X ISSUE-108(b): ... the rejection must name the SHIPPED-DEFAULTS layer ...
tests 11
pass 9
fail 2
skipped 0
todo 0
```

Exactly the test-writer claimed red-run (`checks="2/11"`, 9 pre-existing pass unchanged, 2 new fail cleanly, 0 unexpectedly passing). Two things follow, both independently verified rather than assumed: the answer key was **not weakened to accommodate the implementation** (a weakened test would not have failed on the layer-naming assertion), and the 9 pre-existing exact-string assertions pass identically before and after. The assertions themselves are strong, not tautological — `buildExpectedRejectionStdout(..., "project", "json-parse-error", ...)` pins the layer *and* the reason kind by regex, and is followed by an explicit `assert.doesNotMatch(result.stdout, /REJECTED: central policy load failed/)`.

The `88002aa` edit to that file is confined to lines 194-200 of a comment block (a literal U+FEFF replaced with a textual description to clear `no-irregular-whitespace`); the binary fixture bytes are untouched, and the file assertions are byte-identical.

Process note, not a finding: Issue #111 — closed — was filed for exactly the "test never committed at RED, so the DoD UNMODIFIED clause is unverifiable" shape. Bundling the amendment with the fix in `a7014ab` reproduces that commit-ordering pattern. It did **not** reproduce the defect, because reconstruction settles it, and I ran that reconstruction rather than assuming it. Committing the amendment first would make future rounds cheaper to audit.

## 11. [CLEAN][demonstrated] The mutations that *should* be caught, are

Beyond M3 (finding 1), three source mutations, applied and reverted:

| Mutant | Change | Result |
|---|---|---|
| M1 | drop `updateLabeledFrame(hash, "project", ...)` | **41 pass / 2 fail** — caught |
| M2 | drop `updateLabeledFrame(hash, "shipped-defaults", ...)` | **41 pass / 2 fail** — caught |
| M4 | `printer.ts` re-hardcodes `REJECTED: central policy load failed` | **41 pass / 2 fail** — caught |

The core regressions each fix exists to prevent are genuinely guarded. Suite restored to 43/43 after each.

## 12. [CLEAN][demonstrated] The single-read invariant (design-challenger Attack F / AC2) is structurally intact — zero new reads

The #110 fix hashes three layers but must not read three times. Verified by instrument, not by reading the comment:

```
$ grep -c "readFileSync(" src/policy/config/loader.ts
2
$ grep -n "centralSource.read()" src/policy/config/loader.ts      # excluding comment lines
144:    centralResult = input.centralSource.read();
$ grep -n "node:fs|readFile|CentralPolicySource" src/policy/config/pin.ts
(none - single-read invariant structurally intact)
```

One `.read()`, two `readFileSync` calls, and `pin.ts` still has no filesystem or `CentralPolicySource` dependency at the type level. `src/policy/config/loader.ts:234-235` passes the already-in-hand `shippedText`/`projectText` — the exact bytes that fed the merge. No TOCTOU window opened: the pin cannot disagree with the merge, because there is no second read to disagree with.

## 13. [CLEAN][demonstrated] ADR-0021 zero-diff to the kernel and its siblings — checked, not assumed

```
$ git diff 4113cfb..HEAD --name-only -- src/policy/kernel/ hooks/ scripts/ .github/
(empty)
$ npm run qa:kernel-purity
[QA kernel-purity-check] PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.  EXIT=0
```

Zero diff to `src/policy/kernel/**`, and zero diff to the other CLAUDE.md-named sensitive surfaces adjacent to this change (`hooks/`, `scripts/`, `.github/`). The whole diff is 10 files: 5 under `src/policy/config/`, 2 fixtures, `CHANGELOG.md`, and 1 review report.

## 14. [CLEAN][demonstrated] Suite, type, lint and QA-gate state match the receipts — every red gate is pre-existing and already tracked

```
$ npm run typecheck                      -> exit 0
$ npm run lint                           -> exit 0
$ npm test
tests 655
suites 0
pass 654
fail 1
cancelled 0
skipped 0
todo 0
X failing tests:
test at src\secret-scan\history-scan.test.ts:70:1
X OSS-01 (dogfood): the real repo, scanned with the real allowlist, is a clean (blocking) pass
```

655 total, **0 skipped, 0 todo** — no test was quietly disabled to make this round green (up from round 4 count of 642 as the new regression cases landed). The one failure is Issue #113, the `internal-hostname` pattern false-positiving on settings.local-shaped strings; I confirmed it is pre-existing rather than caused by this diff — the finding list includes ancestor commits `b8cb88e`, `280f1c7`, `0ee4871`, `602be5c`, `541bca3`, `ce5d0b8`, `4113cfb`, all reachable from the baseline.

QA gates:

```
qa:kernel-purity             exit=0
qa:recurring-findings        exit=0
qa:fixture-coverage          exit=0
qa:broken-instrument-gate    exit=0
qa:completeness-claims       exit=1   <- pre-existing, Issue #120
qa:reference-resolver        exit=1   <- pre-existing, Issue #120
```

Both red gates were red at the baseline too (`4113cfb`: reference-resolver 28/72 unresolved, completeness-claims 2/3 files), and both are tracked by open Issue #120. Neither is made worse by this diff — every `qa:completeness-claims` violation at HEAD is in `docs/STATE.md` / `docs/decisions.md` rows, and all three `qa:reference-resolver` failures are the known stub-function/authority bug in that instrument (bare filenames with no path, quoted from a prior report).

---

# Editorial (verdict-neutral, plain edits, no re-review)

1. **`CHANGELOG.md` and the `a7014ab` commit message both enumerate four `failedLayer` return sites; there are six.** The parenthetical *"(central read-error, central parse-failure, shipped-defaults parse-failure, project parse-failure)"* omits the shipped-defaults and project **read-error** sites — which the very next bullet describes at length. The code is complete (finding 9: 6/6, instrument-verified); only the prose count is wrong. Worth flagging because the CLAUDE.md "no hand-derived completeness claims" rule exists for precisely this: the enumeration was hand-typed, and it is wrong.
2. **`docs/STATE.md:34` still lists Issue #110 as an open residual** with its original central-only description. The file is modified-uncommitted in the working tree, so this is presumably mid-update by the Manager — noting it so it does not survive the close.
3. **`docs/qa/s6-policy-loader-fixtures/printer-project-bom-malformed.json` is minified while every sibling fixture is pretty-printed.** Independently of finding 2, the inconsistency is worth a one-line comment in the fixture directory or the test explaining that the single-line shape is load-bearing for the current assertion.

---

# The single scariest unproven assumption

**That a test named for a property is testing that property.** Both of this round findings are the same defect wearing different clothes: `src/policy/config/pin.test.ts:31` is named *"no concatenation-boundary collision"* and does not detect the framing being deleted; `buildExpectedRejectionStdout` asserts *"EXACTLY 2 lines ... no rule lines may leak through"* and is satisfied only by a fixture shape that does not occur in the field. Nothing in this repo checks that a regression test constrains the mechanism its name claims — `qa:mutation-selftest` and `qa:mutation-shell` cover the shell detector, and nothing equivalent covers `src/policy/config/**`. Issue #118 conformance-matrix fix was the right antidote applied to one instrument; the habit it treats is now at its seventh and eighth recurrence in this codebase (#65/#66, #99, #114, #115, #119, plus these two), and every instance has been found by someone running a mutation rather than by someone reading the test.

Concretely: I would not, today, believe any claim of the form *"there is a regression test for that"* about `src/policy/config/**` without first watching a mutation turn it red.

# Go / no-go

**go.** Both assigned Issues are genuinely closed, confirmed against my own prior repros rather than the implementer word: the Issue #110 digest collision no longer reproduces and the new framing survived 21,141 adversarial inputs with zero genuine collisions; the Issue #108 BOM misattribution no longer reproduces on any of the four non-central branches, with zero fail-open paths introduced and the locked answer key independently reconstructed at RED. No `[HIGH]`. Two `[MED]` findings, both `demonstrated`, both about regression guards rather than shipped behavior, neither security, data-integrity, legal nor safety — they file as Issues and convert to named failing tests rather than gating this round. ADR-0021 zero-diff confirmed by instrument; the one red test and two red QA gates are all pre-existing and tracked (#113, #120).

Open findings: **4**. Named failing tests: **4** (findings 1, 2, 3 each map to one named test; finding 4 has no executable form — it is a scope statement about a mechanism that does not exist yet, and resolves to a `docs/backlog.md` residual line, not a test).

# Single next action

Route finding 2 to `test-writer` — it edits the locked `printer.test.ts` answer key, so it cannot be an implementer edit — and hand finding 1 straight to `story-implementer` as a two-assertion addition to `pin.test.ts` that must be shown failing against the framing-removed mutant before it is accepted.

---

RECEIPT: verdict=go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][MED][demonstrated] Issue #110 two named "no concatenation-boundary collision" tests (src/policy/config/pin.test.ts:31, src/policy/config/loader.test.ts:609) both pick the (shipped, project) split, which is NON-ADJACENT because the central frame always separates them - deleting the length-prefix framing entirely leaves the 43-test config suite 43/43 green (M1/M2/M4 all caught 41/2, M3 survives), while the two boundaries that matter (shipped|central, central|project) genuinely collide under the mutant. Defense: shipped code is CORRECT (21,141-input brute force, 0 genuine collisions) and required non-optional fields do block the omission regression - but nothing guards the framing itself. Exposure: 0% of runs today, 100% of future pin digests if the framing regresses undetected, basis demonstrated (mutation-verified). Silent: yes.
2. [ISSUE][MED][demonstrated] printer.test.ts locked buildExpectedRejectionStdout asserts EXACTLY 2 lines on a fail-closed rejection; that holds only because the ISSUE-108(a) BOM fixture is a single-line minified file, unlike every sibling fixture - the identical 3-byte BOM on the repo own pretty-printed printer-project.json (the exact PowerShell 5.1/Notepad shape the test comment names) produces 3 lines. Defense: strong on what matters - exit 1, correct layer named, doesNotMatch(/rule id=/) holds, no rule data leaks on any shape tried; only the line-count proxy is fixture-shaped. Exposure: ~100% of realistic BOM rejections uncovered by the contract as asserted, basis demonstrated. Silent: yes.
3. [SUSPICION][LOW][demonstrated] A CentralPolicySource returning a status outside the closed union degrades silently to "central contributes zero rules" at exit 0 - status=undefined prints "central-channel status=read-error" above a full successful rule listing, status="Present" drops the whole central layer while claiming it present; no runtime default arm at loader.ts:154. Defense: the type system, currently holding - all 4 producers in central-source.ts:243/264/279 return closed-union literals derived from exit codes, never from parsed external output. Exposure basis: assumption (caps at LOW). Not introduced by this diff.
4. [SUSPICION][LOW][code-traced] POL-09 pin is produced (loader.ts:230) and printed (print-cli.ts:27) but compared to nothing - 0 comparators in production code, so "a change under review cannot alter the policy that judges it" remains detective-by-human-inspection, not preventive. Defense: out of this round scope; #111 closed the discard half and #110 closed the scope half - the comparison half is named by no Issue. Exposure: 100% of pin values, basis counted-in-code.
5. [CLEAN][demonstrated] Issue #110 original round-2 repro no longer reproduces: 3-rule vs 2-rule policies with the project layer voided by a central mandatory-lock now yield 1cc37975... vs 58e239a2..., was one shared 4e81fba5... digest; determinism preserved and a shipped-defaults edit now moves the digest.
6. [CLEAN][demonstrated] The new labeled length-prefixed framing has no fresh collision class: 21,141 adversarial inputs (label look-alikes, digit/colon boundary bait, both sentinels as content, multi-byte UTF-8, emoji surrogate pair, lone surrogate) -> 19,683 distinct digests, 0 genuine framing collisions; the only aliasing is the pre-existing central-sentinel class, unreachable through the loader (all 3 spellings fail closed before a pin is computed).
7. [CLEAN][demonstrated] Issue #108 BOM repro no longer reproduces on any non-central branch: project BOM, shipped-defaults BOM, project ENOENT, shipped ENOENT, project EISDIR all name the true layer, exit 1, 0 misattributions; central-throws and central-malformed still correctly say central with status/channel preserved; 15 hostile project shapes -> 0 misattributed, printer.ts:120 hardcoded-central backstop 0 times reached.
8. [CLEAN][demonstrated] The new try/catch wrapping introduced no fail-open path: 6 read/parse failure shapes, all exit=1, rulesPrinted=false, pin=undefined, 0 fail-open.
9. [CLEAN][demonstrated] failedLayer completeness instrument-verified per the CLAUDE.md no-hand-derived-completeness rule: 6 LoadFailure return statements in loader.ts, 6/6 set failedLayer, 0 missing (CHANGELOG says four - Editorial).
10. [CLEAN][demonstrated] The locked answer key was genuinely honored, independently reconstructed rather than taken on the implementer word: HEAD printer.test.ts against pre-fix source (8468ab4 worktree) = 11 tests / 9 pass / 2 fail / 0 skipped, exactly the two ISSUE-108 tests and exactly the test-writer claimed red-run; assertions are strong not tautological; 88002aa edit is confined to comment lines 194-200.
11. [CLEAN][demonstrated] The mutations that should be caught are: M1 drop project frame 41/2, M2 drop shipped frame 41/2, M4 printer re-hardcodes central 41/2; suite restored 43/43 after each.
12. [CLEAN][demonstrated] Single-read invariant (Attack F/AC2) structurally intact, zero new reads: 2 readFileSync + 1 .read() in loader.ts, 0 fs/CentralPolicySource references in pin.ts, pin hashes the exact bytes that fed the merge - no TOCTOU window opened.
13. [CLEAN][demonstrated] ADR-0021 zero-diff confirmed not assumed: git diff 4113cfb..HEAD --name-only over src/policy/kernel/, hooks/, scripts/, .github/ returns empty; qa:kernel-purity PASS (4 files, 0 violations).
14. [CLEAN][demonstrated] Suite/type/lint/QA state matches the receipts with no quiet disabling: 655 tests / 654 pass / 1 fail / 0 skipped / 0 todo; the 1 fail (OSS-01 secret-scan dogfood) confirmed pre-existing via 7 ancestor commits in its own finding list, tracked as #113; typecheck and lint exit 0; qa:completeness-claims and qa:reference-resolver red at baseline too, tracked as #120, neither worsened.
counts (a CHECKSUM): issues=2 suspicions=2 clean=10
evidence (a CHECKSUM): demonstrated=13 code-traced=1 derived=0
checks=655 tests / 654 pass / 1 fail / 0 skipped / 0 todo (full suite; the 1 fail pre-existing at HEAD, Issue #113); config-suite 43/43 pass / 0 fail / 0 skipped; printer.test.ts 11/11 at HEAD and 9 pass / 2 fail against pre-fix source (RED-CONFIRMED reconstruction); typecheck exit 0; lint exit 0; 4 qa:* gates exit 0, 2 exit 1 (pre-existing, Issue #120); qa:kernel-purity PASS; 4 source mutations applied and reverted (M1 41/2, M2 41/2, M3 43/0 SURVIVES, M4 41/2); 21,141-input framing brute force 0 genuine collisions; 3-spelling sentinel reachability probe 0 reachable; 15-shape hostile-input probe 0 misattributions / 0 backstop hits; 6-shape fail-open probe 0 fail-open; 6/6 LoadFailure return-site instrument count; 3-boundary framing differential; original #110 and #108 repros both re-run against fixed code
adr=HIT(35)
report=docs/reviews/s6-policy-centralization-red-team-round5-2026-09-08.md
