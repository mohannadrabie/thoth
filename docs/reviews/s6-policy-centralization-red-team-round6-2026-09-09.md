# Red Team (Sutekh) — S6 fix-now final re-confirm (Issues #122, #123)

- **Date:** 2026-09-09
- **Scope:** `s6` — S6 policy centralization, fix-now round closing Issue #122 and Issue #123 (both opened by my own round-5 report)
- **Tier:** CRITICAL (inherited; touches `src/policy/config/`, a `CLAUDE.md`-named *Policy delivery / config surface* sensitive area)
- **HEAD:** `943e31c`
- **Commit attacked:** `943e31c` (S6 fix-now round 5: Issues #122 + #123)
- **ADR cache:** ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from catalog — ~17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]
- **ADR slice read (attack surface — tests, quality gates, data integrity):** SE ADR-0005 (testing strategy), SE ADR-0010 (code-quality gates), SE ADR-0012 (data integrity), SE ADR-0021 (kernel purity, zero-diff check)
- **Prior report re-confirmed against:** `docs/reviews/s6-policy-centralization-red-team-round5-2026-09-08.md` (finding 1 -> Issue #122, finding 2 -> Issue #123)

---

## Headline

**Both assigned fixes are real, and I reconstructed both myself rather than taking the implementer's or test-writer's word.** I re-applied my own M3 mutant (framing reduced to plain concatenation) to the current `pin.ts` and watched both new `Issue #122` tests turn red — 46 tests, 44 pass, 2 fail — then green again on revert. I confirmed the new `printer-project-bom-pretty-malformed.json` fixture carries a real 3-byte `EF BB BF` BOM on a 10-line pretty-printed document and produces exactly the 3-line rejection my round-5 finding 2 demonstrated, at exit 1, naming the PROJECT layer, leaking nothing. The `#108 -> #110 -> #122 -> #123` arc closes on its own merits.

**Two things I did not expect, ranked by blast radius.**

1. **The CI job that is supposed to run these tests has not run once since 2026-09-01.** `.github/workflows/ci.yml:40` sets `submodules: recursive`; the `adr` submodule is a **private** repo, and `GITHUB_TOKEN` is repo-scoped. Every push/PR run dies at `actions/checkout` before the first `npm` step. **10 of 10 runs, instrument-verified.** Lint, typecheck, `npm test`, and all nine QA/OSS instruments — including the OSS-01 secret scan — have executed **zero** times in CI across S1 through S6. Issue **#27 (CLOSED)** predicted this exact failure, by name, *before* `ci.yml` was written. The two regression tests this round just landed are, today, enforced by nothing automated.
2. **Issue #123's relaxation went further than my finding asked, and I can demonstrate what it dropped.** Every one of the six rejection call sites passes `messagePattern = /./`. With the line count relaxed from `=== 2` to `>= 2`, *nothing* constrains the rejection message's content any more. A plausible "diagnostic aid" mutant that dumps the entire offending policy file into a fail-closed rejection's stdout — 14 lines, rule ids, effects and rationales all visible to the operator — is **caught by the pre-relaxation contract (10/11) and not caught at HEAD (46/46 green)**.

**Verdict: no-go**, on finding 1 alone. To be unambiguous: **the no-go is not against Issues #122 and #123** — both survive my re-attack and I am closing both. It is against the S6 merge-handoff Definition-of-Done line *"tests green in CI with real counts"*, which has been unmet, for every S6 round, in a way nobody has surfaced. The unlock is one line of YAML.

---

# Findings, ranked by blast radius

## 1. [ISSUE][HIGH][demonstrated] CI's only gating job has died at `actions/checkout` on 10 of 10 push runs since 2026-09-01 — no test, lint, typecheck or secret scan has run in CI across the entire S1-S6 build, and Issue #27 predicted this exact failure before the workflow was written

**Exposure: 100% of push/PR CI runs since 2026-09-01 (10 of 10), basis: measured.** Security-relevant (the OSS-01 secret-scan gate is among the steps that never execute), so exempt from PRINCIPLES rule 21's exposure cap regardless.

**Attack.** A regression test that no automated gate runs protects nothing against the next contributor. So before crediting `#122`/`#123`'s new tests as *regression protection*, I asked where they run. Answer: nowhere but a developer's laptop.

Root cause, code-traced then confirmed against live runs:

```
$ sed -n '34,41p' .github/workflows/ci.yml
      - name: Checkout
        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
        with:
          fetch-depth: 0
          submodules: recursive          <-- .github/workflows/ci.yml:40

$ cat .gitmodules
[submodule "adr"]
	path = adr
	url = https://github.com/mohannadrabie/adr.git

$ gh repo view mohannadrabie/adr --json name,visibility
{"name":"adr","visibility":"PRIVATE"}
```

`GITHUB_TOKEN` is scoped to `mohannadrabie/thoth`. It cannot clone a *different* private repo. Every push run therefore fails before the first `npm` step:

```
$ gh run view 34287186484 --log-failed | grep error
##[error]fatal: repository 'https://github.com/mohannadrabie/adr.git/' not found
##[error]fatal: clone of 'https://github.com/mohannadrabie/adr.git' into submodule path '/home/runner/work/thoth/thoth/adr' failed
##[error]The process '/usr/bin/git' failed with exit code 1
```

Not sampled — instrumented across every post-`ci.yml` run, per CLAUDE.md's no-hand-derived-completeness rule:

```
$ ids=$(gh run list --workflow "CI" --limit 100 --json databaseId,event,createdAt \
        --jq '.[] | select(.event != "schedule") | select(.createdAt > "2026-09-01") | .databaseId')
$ for id in $ids; do gh run view $id --log-failed | grep -c "into submodule path .../adr. failed"; done
run 34287186484  adr-submodule-checkout-failure=2
run 34243475131  adr-submodule-checkout-failure=2
run 34171572880  adr-submodule-checkout-failure=2
run 34010226418  adr-submodule-checkout-failure=2
run 33626325202  adr-submodule-checkout-failure=2
run 33584171065  adr-submodule-checkout-failure=2
run 33575497953  adr-submodule-checkout-failure=2
run 33572361167  adr-submodule-checkout-failure=2
run 33568384876  adr-submodule-checkout-failure=2
run 33567258532  adr-submodule-checkout-failure=2
INSTRUMENT RESULT: 10 of 10 push/PR CI runs since 2026-09-01 died at actions/checkout on the private adr submodule

$ gh run list --workflow CI --limit 100 --json conclusion,event,createdAt --jq ...
push/PR CI runs since ci.yml landed (2992bfb, 2026-09-01): 10 | failure=10 | success=0
```

What never ran, per `ci.yml`'s own step list: `npm run typecheck`, `npm run lint`, `npm test` (the whole `node:test` suite), and every QA/OSS instrument step the file's own header enumerates — QA-01, QA-02, QA-05, QA-06, QA-13, QA-14, QA-15, QA-16, **OSS-01** (the full-history secret scan). The one CI *success* on the list, `2026-09-07T10:54 schedule success`, is the `runtime-settings-drift` job, which has `if: github.event_name == 'schedule'` (`ci.yml:137`) and a checkout with **no** `submodules:` key (`ci.yml:140-141`) — it succeeds precisely because it is not the gating job.

**The trigger is not hypothetical, and it was called in advance.** Issue **#27**, `bug/severity:high/ci`, CLOSED, titled *"ci.yml: adding submodules:true to checkout will fail -- adr submodule repo is private, no credential exists"*, body: *"Adding the key alone trades one CI failure for an earlier, unconditional one at the checkout step."* Commit `2992bfb` ("S1: protect the baseline (CI-01, ...)") then created `.github/workflows/ci.yml` with `submodules: recursive` (`git log -S "submodules: recursive" -- .github/workflows/ci.yml` returns exactly that one commit, and the line has never been removed). Push runs were green through 2026-08-29 and have been red on every push since.

**Current defense, honestly assessed.** The failure is *visible* — GitHub shows a red run. It is not visible *as this*: three S6 reviewers, a Stage-4 verify and a Stage-5 audit all reported green counts from **local** runs, and nobody re-read the red CI run to see it never got past checkout. `ci.yml`'s own header asserts *"Every job step below is a real gate ... there is no continue-on-error anywhere in this file, so there is no permanently-pending state — a red step is a red job, full stop."* True, and beside the point: a job that dies before its first step has no red step to report. This is PRINCIPLES rule 13's exact scenario — a required gate that could not run, for 10 consecutive pushes, without anyone saying so plainly. `.github/workflows/ci.yml` is a `CLAUDE.md`-named sensitive area (*Secret scanning / CI gates*).

Irreversible: no. Silent: **partially** — loud in the Actions tab, silent in every receipt the loop actually reads.

**Verdict: BREAKS.**

**Proof-drill required (named, before merge):** *"CI-01 drill: one green `CI` run on the `ci` job at `943e31c`, with `npm test`'s real counts visible in the job log."* Minimal unlock, in order of preference: (a) drop `submodules: recursive` from `ci.yml:40` — nothing in `npm test`, `npm run lint`, `npm run typecheck` or any `qa:*` script reads `adr/` (the ADR catalog is served from `docs/.maat-state.json`); (b) make the submodule checkout non-fatal; (c) add a PAT with read access to `mohannadrabie/adr` as an Actions secret and pass it to `actions/checkout`. Option (a) is one deleted line and is what Issue #27's own report recommended.

**Issue handling:** Issue **#27 REOPENED** (per CLAUDE.md Issue Discipline rule 2 — a closed issue's problem recurring is reopened, never re-filed as a duplicate).

---

## 2. [ISSUE][MED][demonstrated] Issue #123's relaxation dropped a guard the old contract held: with `messagePattern = /./` at all six call sites, `>= 2` leaves the rejection message wholly unconstrained — a mutant that dumps the entire offending policy file into a fail-closed rejection is caught before the fix and not after

**Exposure: 6 of 6 fail-closed rejection assertions in `printer.test.ts` (100%), basis: counted-in-code.** 0% of runs today — `printer.ts` is unchanged and leaks nothing. Irreversible: no. Silent: **yes** (the suite stays 46/46).

**Attack.** My round-5 finding 2 asked for one thing: restate the line-count invariant as `>= 2` *so the pretty-printed shape stops failing a contract it should pass*, keeping the leak assertion. The amendment did that — and the message-content check went with it. Every call site passes a wildcard:

```
$ grep -n "buildExpectedRejectionStdout(" src/policy/config/printer.test.ts
378:function buildExpectedRejectionStdout(centralStatusLine, layer, reasonKind, messagePattern: RegExp)
453:  buildExpectedRejectionStdout(`...status=present channel=${CENTRAL_CHANNEL}`, "central", "json-parse-error", /./)(result.stdout);
461:  buildExpectedRejectionStdout(`...status=present channel=${CENTRAL_CHANNEL}`, "central", "schema-invalid",   /./)(result.stdout);
471:  buildExpectedRejectionStdout("central-channel status=read-error",  "central",          "read-error",       /./)(result.stdout);
485:  buildExpectedRejectionStdout("central-channel status=absent",      "project",          "json-parse-error", /./)(result.stdout);
496:  buildExpectedRejectionStdout("central-channel status=absent",      "shipped-defaults", "json-parse-error", /./)(result.stdout);
520:  buildExpectedRejectionStdout("central-channel status=absent",      "project",          "json-parse-error", /./)(result.stdout);
```

`/./` matches any string with one character. So after the relaxation the surviving guarantees on a fail-closed rejection are exactly three: line 1 is the status line; the rejoined tail *starts with* the `REJECTED: <layer> policy load failed (<kind>): ` prefix; and the full string does not match `/rule id=/`. The old `lines.length === 2` was, in practice, the only assertion bounding what could follow.

`/rule id=/` matches the printer's own **rendered** rule format (`src/policy/config/printer.ts:95`), not raw policy bytes. So a "helpful diagnostics" change — mutant **P2**, appending the offending file's content to the parse-failure message at `src/policy/config/loader.ts:211` — leaks the whole policy past it. Applied and run:

```
$ node --test src/policy/config/{pin,loader,printer}.test.ts
BASELINE (HEAD tests)                          tests=46 pass=46 fail=0 skipped=0
BASELINE (PRE-RELAX printer test, 8d4f0b1)     tests=11 pass=11 fail=0 skipped=0
P1 printer re-hardcodes central  [HEAD]        tests=46 pass=43 fail=3 skipped=0
      FAILED: ISSUE-108(a) / ISSUE-108(b) / ISSUE-108(c)
P2 raw project file dumped into stdout [HEAD]  tests=46 pass=46 fail=0 skipped=0     <-- SURVIVES
P2 raw project file dumped [PRE-RELAX test]    tests=11 pass=10 fail=1 skipped=0     <-- was CAUGHT
RESTORED                                       tests=46 pass=46 fail=0 skipped=0
```

What an operator sees under P2, unchallenged by any assertion at HEAD:

```
central-channel status=absent
REJECTED: project policy load failed (json-parse-error): ...printer-project-bom-pretty-malformed.json: Unexpected token, "{
  "vers"... is not valid JSON
--- offending file content (diagnostic aid) ---
{
  "version": "1.0.0-fixture-project-bom-pretty",
  "rules": [
    {
      "id": "project-bom-pretty-example",
      "effect": "allow",
      "rationale": "..."
    }
  ]
}
--- exit=1 lines=14 ruleIdLeak=false rawRuleIdEchoed=true
```

Fourteen lines. Every rule id, effect and rationale in the failing layer, printed on a load the system declared *rejected in its entirety*. `ruleIdLeak=false` is the assertion passing; `rawRuleIdEchoed=true` is the leak it does not see.

**Current defense, honestly assessed.** The layer-naming guard is genuinely intact and in fact **stronger** than before — P1 (round-5's M4 mutant, `printer.ts` re-hardcoding `"central"`) now fails 3 tests where it used to fail 2, because ISSUE-108(c) joined. The `^REJECTED: <layer> ... (<kind>): ` anchor is a real constraint, correctly anchored (no `m` flag, so `^` binds to string start). And `printer.ts:72` structurally joins exactly two elements, so extra lines can only ever come from `message` — which is precisely the surface now unconstrained. This is not a live defect; it is a demonstrated loss of detection capability introduced by the fix. ADR context, cited as calibration and not as a violation claim: SE ADR-0005's *"MUST NOT delete or weaken a failing test to make CI pass"* does **not** fire (the test was passing, and the amendment was escalated properly through `test-writer` and an Issue, exactly as the rule intends); SE ADR-0010's *"MUST leave touched code at least as clean as found"* is the one this sits awkwardly against.

**Verdict: BREAKS** (the contract's remaining detection power, not the shipped printer).

**Proof-test required (named, failing):** `src/policy/config/printer.test.ts` -> **"ISSUE-123(b): a fail-closed rejection's stdout contains the status line and the REJECTED message and NOTHING ELSE — no raw layer bytes may ride along in the message"**. Cheapest correct form: give `buildExpectedRejectionStdout` a real terminator instead of `/./` (e.g. `/is not valid JSON$/` for the parse-error cases) **or** add `assert.ok(!actual.includes(readFileSync(fixturePath, "utf8").trim()))`, so the tail is bounded by content rather than by line count. This is a `test-writer` amendment — it edits the locked answer key.

---

## 3. [SUSPICION][LOW][demonstrated] The new #122 tests kill M3 but not M5 — dropping only the byte-length, keeping the label, reintroduces a real digest collision while the suite stays 46/46 green

**Exposure: 0% of pin digests today, basis: demonstrated-unreachable** through the only real caller. Irreversible: no. Silent: yes.

**Attack.** `src/policy/config/pin.ts:74-78` frames each layer as `"<label>:<byteLength>:" + content`. My round-5 proof-test asked for the two adjacent boundaries, and that is exactly what landed. But the tests are two existence assertions on four fixed inputs, not an injectivity property — so they kill the mutant they were written against and nothing narrower. Three mutants, applied and reverted:

```
BASELINE                                   tests=46 pass=46 fail=0 skipped=0
M3 framing prefix removed (plain concat)   tests=46 pass=44 fail=2 skipped=0   <-- CAUGHT (finding 5)
M5 byte-LENGTH dropped, label kept         tests=46 pass=46 fail=0 skipped=0   <-- SURVIVES
M6 LABEL dropped, byte-length kept         tests=46 pass=46 fail=0 skipped=0   <-- survives, but is still injective
RESTORED                                   tests=46 pass=46 fail=0 skipped=0
```

M6 is harmless — a bare `<byteLength>:` prefix is still a netstring, still injective. M5 is not, and it collides for real:

```
=== SHIPPED pin.ts (label + byte-length framing) ===
A (shipped='a',           central='bccentral:')  digest=9465855e72949b60...
B (shipped='acentral:bc', central='')            digest=472f0ae768ea97ab...
COLLIDE? false
=== M5 MUTANT (byte-length dropped, label kept -- suite stays 46/46 green) ===
A (shipped='a',           central='bccentral:')  digest=a8c9ea8fad250d0e...
B (shipped='acentral:bc', central='')            digest=a8c9ea8fad250d0e...
COLLIDE? true
```

**Current defense, honestly assessed — better than I expected.** The parse gate blocks reachability structurally, not by convention: a pin is computed only after all three layers parse as valid JSON policy objects, and the colliding B-side texts cannot both be valid JSON. Measured, not argued:

```
$ node reach.mjs
B_shipped (concat)   -> REJECTED at JSON.parse: Unexpected non-whitespace character after JSON at position 3
B_central (empty)    -> REJECTED at JSON.parse: Unexpected end of JSON input
```

So M5 is a *test-coverage* residual with no reachable production trigger today — the same shape as round 5's central-sentinel aliasing class. It is also, precisely, the strengthening my round-5 report offered as optional (*"a small enumerated cross-product asserting digest-injectivity over an adversarial alphabet, so no future boundary is left unnamed"*) and that was not taken. LOW, not filed as an Issue.

**Verdict: UNPROVEN** — demonstrated mutant survival, no demonstrated production trigger.

**Proof-test, if taken:** `src/policy/config/pin.test.ts` -> **"Issue #122: computePin is injective over an adversarial alphabet containing its own frame labels"** — a small cross-product over `["", "a", "central:", "project:", "shipped-defaults:", "1:", ":", "ab"]` asserting distinct digests for distinct triples. It must fail against M3 **and** M5. Otherwise: one `docs/backlog.md` line, with this repro.

---

## 4. [SUSPICION][LOW][demonstrated] `ISSUE-108(c)`'s `lines.length > 2` rests on V8's undocumented `JSON.parse` error-snippet format, and has only ever been executed on Node 24.15.0 — never on CI's pinned 22.18.0

**Exposure: unknown until run, basis: assumption -> capped at LOW per PRINCIPLES rule 18/21; the only recommendation is to measure it.**

**Attack.** The new `ISSUE-108(c)` asserts, deliberately and explicitly, that this fixture's rejection spans **more** than 2 lines. That property is not produced by `printer.ts` — `printer.ts:72` joins exactly two elements. It is produced by V8 embedding a raw snippet of the source document (`"{\n  "vers"...`) inside `JSON.parse`'s thrown message. That snippet's length, truncation point, and whether it preserves the embedded newline are V8 internals, not documented Node API.

I ran it on Node **24.15.0**, where it holds. `package.json` floors at `>=22.18.0` and `.github/workflows/ci.yml:48` pins **22.18.0** — and per finding 1, `printer.test.ts` has never executed on CI at all. A V8 change in either direction turns this test red for a reason that is not a policy defect, or quietly true for the wrong reason.

**Current defense, honestly assessed.** The test's own failure message is explicit about what it means, so a red here would be diagnosable rather than mysterious. And the property it *guards* (the pretty-printed shape must not be wrongly rejected) does not depend on the exact line count — only this one belt-and-braces assertion does. Low stakes, real fragility.

**Verdict: UNPROVEN-pending-verification.**

**Command that settles it, and who runs it:** `nvm use 22.18.0 && node --test src/policy/config/printer.test.ts` — or simply the CI-01 drill from finding 1, which runs it on 22.18.0 by definition. Whoever fixes finding 1 settles this for free.

---

# What held up — re-attacked with my own mutants, and defended

## 5. [CLEAN][demonstrated] Issue #122 is genuinely closed: my own M3 mutant, re-applied to the current `pin.ts`, turns both new tests red — independently reconstructed, not taken on the implementer's word

The implementer claimed mutation-proof. I did not accept it; I rebuilt it. M3 is my round-5 mutant verbatim — the `hash.update(<label>:<byteLength>:, "utf8")` line at `src/policy/config/pin.ts:76` replaced with a no-op, reducing the framing to plain concatenation:

```
BASELINE                                   tests=46 pass=46 fail=0 skipped=0
M3 framing prefix removed (plain concat)   tests=46 pass=44 fail=2 skipped=0
      FAILED: Issue #122: neither ADJACENT frame boundary (shipped|central, central|project) a...
RESTORED                                   tests=46 pass=46 fail=0 skipped=0
```

Two failures, one in `pin.test.ts` and one in `loader.test.ts`, both the named `Issue #122` test. Round 5's M3 left the suite 43/43 green; at HEAD it is caught. The exact proof-test I named — "Issue #122: neither ADJACENT frame boundary (shipped|central, central|project) admits a collision", asserting `("ab","c","")` vs `("a","bc","")` and `("","c","ab")` vs `("","cab","")` — landed with those exact inputs. **Zero production code changed**, which is correct: the framing in `pin.ts` was already right, as round 5's 21,141-input brute force established.

## 6. [CLEAN][demonstrated] Issue #123's new fixture genuinely reproduces the shape I found — a real 3-byte BOM on a real pretty-printed file, producing a real 3-line rejection

Not inspected — measured:

```
printer-project-bom-malformed.json         bytes=  340 first3=ef bb bf BOM=true  lines=1
printer-project-bom-pretty-malformed.json  bytes=  597 first3=ef bb bf BOM=true  lines=10   <-- new
printer-project.json                       bytes=  537 first3=7b 0a 20 BOM=false lines=17

--- stdout for the NEW pretty BOM fixture ---
central-channel status=absent
REJECTED: project policy load failed (json-parse-error): docs/qa/s6-policy-loader-fixtures/printer-project-bom-pretty-malformed.json: Unexpected token, "{
  "vers"... is not valid JSON
--- exitCode=1 lineCount=3 namesProject=true ruleIdLeak=false pin=undefined
rawFileEchoed=false rationaleLeaked=false ruleIdStringLeaked=false
```

Identical byte prefix to the ISSUE-108(a) fixture (`ef bb bf`), 10 lines instead of 1, and the rejection is exactly the 3-line shape my round-5 finding 2 demonstrated against `printer-project.json`. This is the real PowerShell 5.1 Out-File -Encoding utf8 / Notepad "UTF-8 with BOM" shape, not a synthetic one. Exit 1, PROJECT named, no pin computed, nothing leaked. Answer to question (a): **yes, it reproduces.**

## 7. [CLEAN][demonstrated] The relaxed contract still catches the regression it was aimed at — and catches it harder than before

Answer to (b), the half that holds. Mutant P1 — `printer.ts` re-hardcoding `"central"` as `failedLayer`, round 5's M4 — against the relaxed contract:

```
P1 printer re-hardcodes central  [HEAD]  tests=46 pass=43 fail=3 skipped=0
      FAILED: ISSUE-108(a): ... the PROJECT layer ...
      FAILED: ISSUE-108(b): ... the SHIPPED-DEFAULTS layer ...
      FAILED: ISSUE-108(c): a UTF-8 BOM on a PRETTY-PRINTED (multi-line) project file ...
```

Three failures where round 5 recorded two. The layer-naming guarantee — the thing Issue #108 exists for — is not merely preserved by the relaxation, it now has one more case behind it, on the realistic fixture shape. What the relaxation lost is a different property, and that is finding 2.

---

## 8. [CLEAN][demonstrated] Zero production diff — instrument-listed, not eyeballed

```
$ git show 943e31c --name-only --format=""   (classified)
  DOCS          CHANGELOG.md
  DOCS/FIXTURE  docs/qa/s6-policy-loader-fixtures/printer-project-bom-pretty-malformed.json
  DOCS/FIXTURE  docs/reviews/s6-printer-test-writer-fixnow-2026-09-08.md
  TEST          src/policy/config/loader.test.ts
  TEST          src/policy/config/pin.test.ts
  TEST          src/policy/config/printer.test.ts

$ git diff 8d4f0b1..943e31c --name-only -- src/policy/kernel/ hooks/ scripts/ .github/ src/policy/config/pin.ts src/policy/config/loader.ts src/policy/config/printer.ts src/policy/config/central-source.ts
(empty)

$ npm run qa:kernel-purity
[QA kernel-purity-check] PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.  exit=0
```

Six files, no production `.ts` among them. SE ADR-0021's kernel boundary untouched; no `hooks/`, `scripts/` or `.github/` diff in this commit. The commit message's claim "No production code changed" is true.

## 9. [CLEAN][demonstrated] Nothing was skipped, disabled or weakened to get green — full suite, typecheck, lint and QA gates all match the receipts

```
$ npm test
tests 658 | pass 657 | fail 1 | skipped 0 | todo 0
X test at src\secret-scan\history-scan.test.ts:70:1
X OSS-01 (dogfood): the real repo, scanned with the real allowlist, is a clean (blocking) pass

$ npm run typecheck   -> exit 0
$ npm run lint        -> exit 0
```

658 total, **0 skipped, 0 todo** — exactly +3 against round 5's 655, which is exactly the three tests this commit adds. No test was quietly disabled to absorb the amendment. The one failure is Issue #113, confirmed pre-existing: its blocking findings are all at ancestor commit `b8cb88eb`, and the only `943e31c` rows in its output are ALLOWLISTED.

QA gates:

```
qa:kernel-purity             exit=0   PASS: 4 files, 0 violations
qa:recurring-findings        exit=0   PASS: 1 recurring finding class, structurally valid
qa:fixture-coverage          exit=0   VACUOUS-PASS (disclosed)
qa:fixture-isolation         exit=0   VACUOUS-PASS (disclosed)
qa:broken-instrument-gate    exit=0   VACUOUS-PASS (disclosed)
qa:completeness-claims       exit=1   <- pre-existing, Issue #120
qa:reference-resolver        exit=1   <- pre-existing, Issue #120
```

Both red gates are the known #120 pair and neither is worsened by this diff: every `qa:completeness-claims` violation is a `docs/STATE.md` or `docs/decisions.md` prose row, and `943e31c` touches neither file; and **all 57 of 57 `qa:reference-resolver` failures are `[unresolved-authority] Issue#N` rows** — the instrument's known no-issue-tracker-access limitation — with zero non-authority (missing path/anchor) failures. The count rose from round 5's 28/72 only because more Issue numbers are now cited in `docs/`, including my own round-5 report citing #122 and #123.

## 10. [CLEAN][code-traced] The second #122 test is a byte-identical duplicate of the first, not independent end-to-end coverage — harmless, but worth stating rather than counting twice

`src/policy/config/loader.test.ts:618-631` imports and calls `computePin` directly, exactly as `src/policy/config/pin.test.ts:39-54` does, with the same four inputs. It does not route through `loadEffectivePolicy`. So "two new tests" is one property asserted twice in two files, not two angles on it. That is materially fine — the property is covered, the mutant dies — and given finding 3's reachability result, a genuine through-the-loader version would have little to add. No action; recorded so the coverage claim is not read as broader than it is. The same is true of the pre-existing pair at `pin.test.ts:31` / `loader.test.ts:611`, which round 5 described as "the same split, end-to-end" — it was never end-to-end either.

---

# Editorial (verdict-neutral, plain edits, no re-review)

1. `docs/qa/s6-policy-loader-fixtures/printer-project-bom-pretty-malformed.json` has no trailing newline. Lint passes, so nothing enforces it, but it is now the second fixture in that directory shaped unlike its siblings — the mirror image of round 5's Editorial 3 about the minified sibling.
2. The INTERPRETATION CHOICE 7 / STDOUT GRAMMAR block introduces "The two properties that DO matter" and then lists three. The list is right; the lead-in is stale.
3. Round 5's Editorial 1 (CHANGELOG and commit message saying four `failedLayer` return sites where there are six) is not addressed by this commit and remains open as a plain edit.

---

# The single scariest unproven assumption

**That the tests we keep sharpening are run by anything but a human at a keyboard.** This round did exactly the right work on the answer key — my M3 mutant now dies, the realistic BOM shape is now a fixture, the layer-naming guard got a third case. And the gate meant to execute all of it has not started since 2026-09-01, because a workflow added a `submodules: recursive` line to reach a private repo that a repo-scoped token cannot clone — the precise failure a CLOSED Issue in this very tracker described in its title, before the workflow existed.

Round 5's scariest assumption was "that a test named for a property is testing that property." This is the same disease one layer out: **that a test that exists is a test that runs.** Both were settled the same way — by running something rather than reading something — and neither was catchable by review of the diff, because in both cases the diff was correct and the surrounding machinery was not. Six review rounds, a verify stage and an audit stage read `npm test` output pasted from a laptop, and none of them opened the red CI run to see it had died before `npm` was ever invoked.

# Go / no-go

**no-go**, on finding 1 alone — a `[HIGH]`, `demonstrated`, 100%-exposure gap in a `CLAUDE.md`-named sensitive area, covering a security control (the OSS-01 secret scan) among the steps that never execute.

**To be explicit about what this verdict does not say:** Issues #122 and #123 both **survive** my re-attack. #122's fix is verified by my own M3 reconstruction (44/2 red, restored 46/46); #123's fixture is verified to be a real BOM on a real pretty-printed file producing the real 3-line shape, with the layer-naming guard measurably stronger than before. I am closing both as `completed`, with independent-verification comments. This closes the `#108 -> #110 -> #122 -> #123` arc from my round-2 finding through today.

Finding 2 is a genuine `[MED]` regression in detection capability introduced by the #123 amendment, filed as its own Issue and convertible to one named `test-writer` test — not a reason to hold #123 open, and not a security or data-integrity finding.

Open findings: **4**. Named failing tests / drills: **4** — finding 1 -> the CI-01 drill (one green `ci` job at `943e31c`); finding 2 -> `ISSUE-123(b)`; finding 3 -> the `computePin` injectivity property test (or a backlog line, LOW); finding 4 -> settled for free by finding 1's drill. No gap between the two counts.

# Single next action

Delete `submodules: recursive` from `.github/workflows/ci.yml:40` and push, so that the `ci` job runs for the first time since 2026-09-01 — nothing in `npm test`, `npm run lint`, `npm run typecheck` or any `qa:*` script reads `adr/`. That one line simultaneously restores the gate, produces the real CI counts the S6 Definition of Done requires, and settles finding 4 on Node 22.18.0 at no extra cost.

---

RECEIPT: verdict=no-go
attacks (ALL of them, ranked by blast radius):
1. [ISSUE][HIGH][demonstrated] CI's gating `ci` job has died at actions/checkout on 10 of 10 push/PR runs since 2026-09-01 (instrument-verified over every run) -- .github/workflows/ci.yml:40 sets `submodules: recursive`, .gitmodules points at the PRIVATE mohannadrabie/adr, GITHUB_TOKEN is repo-scoped, so lint/typecheck/`npm test`/all 9 QA+OSS instruments incl. the OSS-01 secret scan have run ZERO times in CI across S1-S6, and the two regression tests landed this round are enforced by nothing automated. Issue #27 (CLOSED, severity:high, ci) predicted this exact failure by name before ci.yml was written (2992bfb). Defense: the run shows red, but dies before its first step, so ci.yml's own "a red step is a red job" guarantee never engages and every S6 receipt reported LOCAL counts instead. Exposure: 100% of push/PR CI runs since 2026-09-01 (10 of 10), basis measured; security-relevant so rule-21-exempt. Silent: partially. Issue #27 REOPENED.
2. [ISSUE][MED][demonstrated] Issue #123's relaxation went past its own finding: all 6 buildExpectedRejectionStdout call sites pass `messagePattern = /./`, so once the line count went from `=== 2` to `>= 2` nothing constrains the rejection message content -- a "diagnostic aid" mutant (P2) dumping the entire offending policy file into a fail-closed rejection's stdout (14 lines, rule ids/effects/rationales visible) is CAUGHT by the pre-relaxation contract (10/11) and NOT caught at HEAD (46/46 green); doesNotMatch(/rule id=/) only matches the printer's rendered format, not raw file bytes. Defense: layer-naming guard intact and stronger (P1 now fails 3 tests vs 2), printer.ts:72 structurally emits 2 elements so only `message` can carry extra content -- exactly the now-unconstrained surface. Exposure: 6 of 6 rejection assertions, basis counted-in-code; 0% of runs today. Silent: yes.
3. [SUSPICION][LOW][demonstrated] The new #122 tests kill M3 (whole framing prefix removed) but not M5 (byte-length dropped, label kept), which reintroduces a REAL collision -- (shipped='a', central='bccentral:') and (shipped='acentral:bc', central='') hash to the identical a8c9ea8f... under M5 while the suite stays 46/46 green. Defense: strong and structural -- reachability through the only caller is blocked by the parse gate (both colliding B-side texts fail JSON.parse, measured), the same unreachable-aliasing class round 5 found. Exposure 0% today. This is precisely the injectivity-property strengthening round 5 offered as optional and that was not taken. Not filed.
4. [SUSPICION][LOW][demonstrated] ISSUE-108(c)'s `assert.ok(lines.length > 2)` rests on V8's undocumented JSON.parse error-snippet embedding a newline, not on anything printer.ts does (printer.ts:72 joins exactly 2 elements); verified only on Node 24.15.0, while ci.yml:48 pins 22.18.0 -- and per finding 1 this file has never executed on CI at all. Verdict UNPROVEN-pending-verification; settled by `nvm use 22.18.0 && node --test src/policy/config/printer.test.ts`, or free with finding 1's drill. Exposure basis: assumption, caps at LOW.
5. [CLEAN][demonstrated] Issue #122 genuinely closed, independently reconstructed not taken on the implementer's word: my own round-5 M3 mutant re-applied to pin.ts:76 turns both new tests red (46 tests / 44 pass / 2 fail / 0 skipped), restored 46/46 -- round 5's M3 left the suite 43/43 green. The proof-test I named landed with the exact inputs I specified, and zero production code changed, which is correct.
6. [CLEAN][demonstrated] Issue #123's new fixture genuinely reproduces my round-5 shape, measured not inspected: real 3-byte ef bb bf BOM on a 10-line pretty-printed document (vs the 1-line minified sibling), producing exactly a 3-line rejection at exit 1 naming the PROJECT layer, pin=undefined, rule data not leaked on any probe (ruleIdLeak/rawFileEchoed/rationaleLeaked all false).
7. [CLEAN][demonstrated] The relaxed contract still catches the regression it was aimed at, harder than before: mutant P1 (printer.ts re-hardcodes "central", round 5's M4) fails 3 tests at HEAD -- ISSUE-108(a), (b) AND the new (c) -- where round 5 recorded 2; the `^REJECTED: <layer> ... (<kind>): ` anchor against the rejoined tail is correctly anchored (no /m flag) and fires.
8. [CLEAN][demonstrated] Zero production diff, instrument-classified not eyeballed: 6 files = 3 *.test.ts + 2 docs/fixture + CHANGELOG; git diff 8d4f0b1..943e31c over src/policy/kernel/, hooks/, scripts/, .github/ and all 4 src/policy/config production .ts files returns empty; qa:kernel-purity PASS (4 files, 0 violations). SE ADR-0021 untouched.
9. [CLEAN][demonstrated] Nothing skipped, disabled or weakened to get green: npm test 658 / 657 pass / 1 fail / 0 skipped / 0 todo -- exactly +3 on round 5's 655, exactly the 3 tests this commit adds; the 1 fail is Issue #113, pre-existing (blocking findings at ancestor b8cb88eb; every 943e31c row is ALLOWLISTED); typecheck exit 0, lint exit 0; 5 qa:* gates exit 0, the 2 red ones are the known #120 pair, neither worsened -- all 57/57 reference-resolver failures are unresolved-authority Issue#N, zero missing-path failures, and no completeness-claims violation is in a file this commit touches.
10. [CLEAN][code-traced] The second #122 test (loader.test.ts:618-631) is a byte-identical duplicate of pin.test.ts:39-54 -- it calls computePin directly, not through loadEffectivePolicy -- so "two new tests" is one property asserted twice, not two angles. Materially fine (the property is covered, the mutant dies, and finding 3 shows a through-the-loader version would add little); recorded so the coverage claim is not read as broader than it is.
counts (a CHECKSUM): issues=2 suspicions=2 clean=6
evidence (a CHECKSUM): demonstrated=9 code-traced=1 derived=0
checks=full suite 658 tests / 657 pass / 1 fail / 0 skipped / 0 todo (the 1 fail pre-existing, Issue #113); config suite 46/46 pass / 0 fail / 0 skipped at HEAD; pre-relaxation printer.test.ts (8d4f0b1) 11/11; typecheck exit 0; lint exit 0; 7 qa:* gates run, 5 exit 0 / 2 exit 1 (pre-existing, Issue #120); 5 mutants applied and reverted (M3 44/2 CAUGHT, M5 46/0 survives, M6 46/0 survives, P1 43/3 CAUGHT, P2 46/0 survives at HEAD but 10/11 CAUGHT pre-relaxation); fixture byte-level probe on 3 fixtures (BOM/line-count/size); real-printer stdout probe on the new fixture (3 lines, exit 1, 0 leaks); M5 collision demo (identical digest a8c9ea8f under mutant, distinct at HEAD); M5 reachability probe (both colliding texts rejected at JSON.parse); CI-run instrument over all 10 post-2026-09-01 push/PR runs (10/10 died at actions/checkout on the private adr submodule); working tree verified clean after every mutation
adr=HIT(35)
report=docs/reviews/s6-policy-centralization-red-team-round6-2026-09-09.md
