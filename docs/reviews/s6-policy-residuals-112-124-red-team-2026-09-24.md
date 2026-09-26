# Red Team (Sutekh) — s6-policy-residuals-112-124 (2026-09-24)

[red-team]
Attacking the `defaultOutcome` policy key (Issue #112) and the rejection-message contract (Issue #124) with failure scenarios.

| Field | Value |
|---|---|
| Scope | Issues #112, #124, #107 (ratified residual, no code) |
| Tier | CRITICAL (policy delivery / config surface, a CLAUDE.md named sensitive area) |
| HEAD reviewed | `8e65a2b` (detached), worktree `.claude/worktrees/agent-afd6c8237ad9fa1f9` |
| Production diff | `git diff 5ab5f06..8e65a2b -- src` (4 files, +80/-5) |
| Test diff | `git diff ae6b4f1..51bcefd` (4 files, +543/-9, test-writer) |
| Node measured | v24.15.0. CI pins 22.18.0 and was NOT measured here |
| ADR cache | `ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp 1f5bc09) [CACHE=HIT]` |
| Verdict | **go** |

## Headline

**The trust model holds. I could not relax central's posture through any path I could build.** I brute-forced the whole space rather than reasoning about it: 243 combinations of (shipped-defaults, central, project) declarations x central channel status x mandatory-collision voiding. Zero violations. I then ran 13 hostile-key attacks at the project layer against a central `deny` — unicode-escaped keys, duplicate keys, `__proto__` at both the rule-set and the rule level, case variants, whitespace variants, non-string values. Every one either rejected the whole load fail-closed or resolved to `deny/central`. `Object.prototype` was unpolluted afterwards.

**Two MED findings, neither of which is a live defect.**

1. Issue #124's new oracle catches a *whole-file* dump and not a *truncated* one. My mutant N1 appends the first 80 bytes of the offending policy file to the rejection message and passes the amended printer suite 13/13, leaking the policy version string and the head of the first rule id to stdout on a load declared rejected in its entirety. This is not the implementer's error: round 6's own prescription offered two forms, and the cheaper of the two is the one with the blind spot. **Already filed by `app-security-reviewer` as Issue #291** — I commented my independent reproduction rather than opening a duplicate.
2. The resolved posture is invisible on every operator surface, and the Issue that defers fixing that is not bound to the story that makes it live. Demonstrated: shipped-defaults declares `deny`, the session-writable `.thoth/policy.json` declares `allow`, the resolved posture is `allow/project`, and `policy print` says nothing at all. The deferral is ratified and tracked (Issue #288), but #288 carries no severity label, no milestone, and no "must be done before the hook consumes this" precondition — unlike Issue #107's decisions row, which binds its review-back to the rewiring story by name.

**Praised decision.** `resolveDefaultOutcome` never names a layer. It reads `TRUST_RANK` only, which is the one property that made my "is a 4th layer safe" line of attack a compile-time question instead of a runtime one.

## ADR compliance (attack-surface slice)

Read from `adrCatalog.adrs` in `docs/.maat-state.json` on a `[CACHE=HIT]`. Slice taken: the change's own domains (policy schema, layering) plus the security / state / concurrency / failure-mode tags this role owns. Cross-domain collisions are `cross-domain-reviewer`'s (PRINCIPLES rule 9).

| ADR | Rule attacked | Result |
|---|---|---|
| SE ADR-0021 (POL-11 kernel purity) | "The policy kernel MUST be pure: no filesystem, network, or process access" | PASS. `rule-types.ts` gains a type-only import of `src/policy/kernel/verdict.ts`, a sibling inside the scanned root. `qa:kernel-purity` PASS, 4 production files, zero import or forbidden-global violations |
| SE ADR-0021 (POL-05) | "MUST deny a mutating action whose Action record has source opaque or a non-empty unresolved array" | PASS, untouched. `kernel.ts` is byte-unchanged; POL-05 still fires before `defaultOutcome` is reached |
| SE ADR-0002 (layering) | `src/policy/rule/*` must not import `src/policy/config/*` | PASS. `resolveDefaultOutcome` returns `undefined` when nothing is declared; the bootstrap fallback is applied in `loader.ts` |
| SE ADR-0005 / ADR-0010 (testing, quality) | "MUST NOT delete or weaken a failing test" | PASS. The #124 amendment removes a wildcard; no test deleted. Finding 1 is that the replacement is narrower than the alternative form offered, not that anything was weakened relative to HEAD |
| SE ADR-0003 (YAGNI) | "SHOULD NOT over-abstract: no speculative interfaces" | PASS, and it is the reason D1 has no `defaultOutcomeMandatory` key. Test B5b asserts that key is rejected as unknown, so an admin cannot be led to believe a flag protects the posture |

---

# Findings, ranked by blast radius

## 1. [ISSUE][MED][demonstrated] Issue #124's oracle bounds only a WHOLE-file echo — a truncated dump of the offending policy passes 13/13

**Exposure: 0% of production runs today (the shipped loader leaks nothing); 100% of future edits to the 4 loader rejection return sites are unguarded against a partial leak. Basis: counted-in-code (4 return sites in `loader.ts`, 6 bound call sites in `printer.test.ts`).** Not irreversible. Silent: yes, the suite stays green.

**Attack.** Round 6's finding 2 named two acceptable forms for the bound: a terminator regex, or `assert.ok(!actual.includes(readFileSync(fixture).trim()))`. The amendment took the second. `String.prototype.includes` is all-or-nothing, so it only fires when the offending text appears complete and contiguous. A realistic "helpful diagnostics" change truncates.

Mutant N1, applied at `src/policy/config/loader.ts:232`:

```ts
return { ok: false, reasonKind: projectParsed.error, message: projectParsed.message + " | head: " + projectText.slice(0, 80), failedLayer: "project", ... };
```

```text
$ node --test src/policy/config/printer.test.ts
BASELINE (HEAD)                                     tests=13 pass=13 fail=0 skipped=0
P2  whole project file appended    [site :232]      tests=13 pass=10 fail=3 skipped=0   CAUGHT
P2  whole shipped file appended    [site :214]      tests=13 pass=11 fail=2 skipped=0   CAUGHT
P2  whole central raw appended     [site :183]      tests=13 pass=10 fail=3 skipped=0   CAUGHT
P2  text appended at read-error    [site :167]      tests=13 pass=11 fail=2 skipped=0   CAUGHT
N1  FIRST 80 BYTES appended        [site :232]      tests=13 pass=13 fail=0 skipped=0   SURVIVES
P1  printer.ts re-hardcodes central [printer.ts:72] tests=13 pass=10 fail=3 skipped=0   CAUGHT (3 of 3 ISSUE-108)
RESTORED                                            tests=13 pass=13 fail=0 skipped=0
```

What an operator sees under N1, unchallenged by any assertion:

```text
central-channel status=absent
REJECTED: project policy load failed (json-parse-error): docs/qa/s6-policy-loader-fixtures/printer-project-bom-pretty-malformed.json: Unexpected token, "{
  "vers"... is not valid JSON | head: {
  "version": "1.0.0-fixture-project-bom-pretty",
  "rules": [
    {
      "id
```

The existing `assert.doesNotMatch(actual, /rule id=/)` does not fire: that regex matches `printer.ts`'s rendered rule format, not the raw JSON `"id":` the file actually contains.

**Current defense, honestly assessed.** The amendment is a real improvement and kills every mutant the previous contract killed plus the whole-file class. The required `bound` parameter is a genuine completeness instrument: `npm run typecheck` fails on a 7th unbounded call site, because the tests are in `tsconfig` include. `assertRejectionBound` also guards against a vacuous check (`bound.raw.length` must be positive). None of that is in question. What is in question is that `includes(whole)` is the weaker of the two forms offered, and the stronger one costs the same.

**Verified fix.** The terminator form kills N1, measured on the same mutant and the same fixture:

```text
bound as SHIPPED (raw-bytes-absent) passes under mutant N1: true     (true  = mutant survives)
bound as ALTERNATIVE (terminator /is not valid JSON$/) passes: false (false = mutant killed)
```

**Verdict: BREAKS** the oracle's detection power, not the shipped printer.

**Named failing test required:** `src/policy/config/printer.test.ts`, test name `ISSUE-123(c): a fail-closed rejection's tail ENDS with the underlying parser or validator message, nothing may be appended after it`. Add `{ kind: "exact-suffix", suffix }` to `RejectionBound` and use it at the 5 parse and schema sites, keeping `raw-bytes-absent` as a second, independent assertion.

**Disposition.** Already filed by `app-security-reviewer` as **Issue #291** (bug, severity:med, pol, Milestone S6), 2026-09-24T04:10Z, with an all-but-one-char variant of the same mutant. I did not file a duplicate; I commented my independent reproduction and the terminator measurement on #291.

## 2. [ISSUE][MED][code-traced] The resolved posture is invisible on every operator surface, and Issue #288 (the deferral) carries no precondition binding it to the story that makes it live

**Exposure: 0% of enforcement decisions today (the hook never calls the loader) and 0% of shipped policy files (neither `shipped-defaults.json` nor `.thoth/policy.json` declares the key); 100% of `policy print` invocations cannot show the resolved posture. Basis: counted-in-code.** Irreversible: no. Silent: yes, by construction.

**Attack.** Shipped-defaults and project are peers at `TRUST_RANK` 0 (`src/policy/rule/precedence.ts:162-166`), so a project file overrides a shipped-defaults posture in either direction. `.thoth/policy.json` is the in-repo, session-writable file. I built the inversion and then asked what an operator would see.

```text
$ shipped-defaults.json declares defaultOutcome "deny"; .thoth/policy.json declares "allow"; central absent

=== everything an operator sees from the printer ===
central-channel status=absent
--- resolved rules (0) ---
disclosure: NOTE: this reflects S6's own resolved policy (loadEffectivePolicy) -- it is not necessarily
            what hooks/pretooluse-kernel-gate.mjs enforces live today ...
inertMandatoryDeclarations: []
PrinterResult keys: stdout, exitCode, pin, disclosure, inertMandatoryDeclarations

=== what the loader actually resolved ===
resolved posture: {"outcome":"allow","source":"project"}
stdout mentions the posture? false
```

The same blindness covers the three states a central admin most needs to distinguish: posture adopted from central, posture overridden by a peer, and posture fell back to bootstrap `allow` because central was absent. `centralStatus=absent` is printed, but nothing says the deny that was deployed is not in effect.

**Current defense, honestly assessed.** This is not an oversight. It is ruling D3, ratified in `docs/decisions.md`'s 2026-09-24 row, and the dropped sub-features are filed as Issue #288 with the printer/CLI surface and the ignored-relaxation disclosure both named. Nothing consumes the field today, so there is no live risk, and adding a `print-cli.ts` line would have needed a `PrinterResult` field that no test covers. The scope discipline is correct.

The gap is in the binding, not the deferral. Compare the two residuals this same story ratified:

| Residual | Tracking | Precondition on the story that makes it live |
|---|---|---|
| Issue #107 (locale-dependent absent detection) | decisions.md row, 2026-09-24 | Explicit: "that story's Phase 1 must, before the loader becomes a live path, either capture a verified non-English sample or replace the text match", plus a 2026-10-24 calendar backstop |
| Issue #288 (posture invisible) | decisions.md row, 2026-09-24, item 4 | None. #288 is labelled `chore` + `pol`, has no `severity:*` label and no Milestone, and its body says only "a small follow-up for whichever story rewires the kernel-gate hook" |

The three prior findings of exactly this shape in this same file family — Issue #109 (disclosure), Issue #111 (pin computed then discarded), Issue #114 (inert mandatory declarations) — were each closed by one line in `print-cli.ts`. Precedent says this one lands the same way; the risk is only that nothing forces it to land before the field goes live.

**Sub-case, folded in rather than filed separately: the tighten direction is an undisclosed availability lever.** D2 lets any lower-trust layer tighten `allow` to `deny`. Once the hook consumes this field, anything that can write `.thoth/policy.json` can deny every cleanly-resolved, non-mutating, non-matching action, and the operator gets no line saying why. The direction is fail-closed, so this is availability, not authorization, and R3 accepted it by ruling. It shares finding 2's fix exactly.

**Verdict: BREAKS** the residual-tracking chain, not the code.

**Named artifact required (no executable form):** this is a residual-register line, not a test. Either (a) a `docs/decisions.md` addendum binding the rewiring story's Phase 1 to surface the resolved posture and any ignored relaxing declaration before the field becomes live, in the same words Issue #107's row uses; or (b) `severity:med` + Milestone `S6 — Policy centralization` on Issue #288 plus a comment naming the precondition. Cheapest correct form is (b).

**Disposition.** No duplicate exists (`gh issue list --search` across open Issues created since 2026-09-23 returns #291, #288, #287, #284, #283, #280 — none covers the binding). Filed as a new bug Issue, and a comment posted on #288 pointing at it.

## 3. [CLEAN][demonstrated] Tighten-only: 243 combinations of declaration, central status and voiding — zero paths relax a central `deny`

**Attack.** Rather than reason about `resolveDefaultOutcome`'s three-clause condition, I enumerated the whole reachable space through the REAL `loadEffectivePolicy`, writing real files and a real injected central source: 3 shipped declarations x 3 central x 3 project x 3 central statuses x 3 collision shapes.

```text
combinations exercised: 243 loaded ok: 243
RELAX VIOLATIONS (central present+deny but result not deny): 0
```

Every one of the 27 `central=deny(present)` rows resolves to `deny/central`, including the 9 where the project layer explicitly declares `allow` and the 9 where the project layer is voided.

I also chased the one structural worry the tighten rule creates: a tighten rewrites `held.source` to the lower-trust layer, so a still-later peer could override it. It cannot produce a relax below central, because the source is only ever rewritten when the held outcome was `allow` — `deny` is already the tightest value and is never tightened over. A later peer can therefore only restore `allow`, which is what central itself declared. With today's three layers there is no such later peer at all, and the Part E matrix is derived from `TRUST_RANK` rather than hand-typed, so a 4th layer cannot leave a cell unchecked.

**Verdict: SURVIVES.**

## 4. [CLEAN][demonstrated] Relax-by-hostile-key: 13 attacks at the project layer against a central `deny` — every one rejected or resolved to `deny/central`, no prototype pollution

```text
escaped key u0064                  | OK posture=deny/central
proto pollution top                | REJECTED schema-invalid layer=project :: __proto__: unknown key "__proto__"
proto pollution in rule            | REJECTED schema-invalid layer=project :: rules[0].__proto__: unknown key "__proto__"
case variant DefaultOutcome        | REJECTED schema-invalid layer=project :: DefaultOutcome: unknown key "DefaultOutcome"
trailing space key                 | REJECTED schema-invalid layer=project :: defaultOutcome : unknown key "defaultOutcome "
dup key deny then allow            | REJECTED schema-invalid layer=project :: duplicate top-level key "defaultOutcome"
dup key escaped variant            | REJECTED schema-invalid layer=project :: duplicate top-level key "defaultOutcome"
escaped value u0061llow            | OK posture=deny/central
array value                        | REJECTED schema-invalid layer=project :: defaultOutcome must be "allow" or "deny"
object value                       | REJECTED schema-invalid layer=project :: defaultOutcome must be "allow" or "deny"
null value                         | REJECTED schema-invalid layer=project :: defaultOutcome must be "allow" or "deny"
nested defaultOutcome in a rule    | REJECTED schema-invalid layer=project :: rules[0].defaultOutcome: unknown key
BOM + key                          | REJECTED json-parse-error layer=project

Object.prototype.defaultOutcome after all attacks: undefined
```

Three pre-existing mechanisms carry this, and all three transfer to the new key for free because none of them is keyed to a key name: `findDuplicateTopLevelKeys` on the raw text, the tokenizer/parser agreement invariant (Issue #115), and the `RULE_SET_KEYS` unknown-key loop over `Object.keys`. `JSON.parse` creates `__proto__` as an own data property rather than setting a prototype, so the unknown-key loop sees it. The one thing worth naming for a future reader: `schema.ts:276` uses `"defaultOutcome" in input`, which walks the prototype chain — harmless today because nothing in this codebase pollutes `Object.prototype`, and I confirmed nothing did after 13 attacks.

**Verdict: SURVIVES.**

## 5. [CLEAN][demonstrated] Voided-layer bypass: a layer voided for a mandatory-id collision contributes no posture, and the check is load-bearing

`resolveDefaultOutcome` runs over `acceptedLayers`, not `layers` (`precedence.ts:333`). I did not take that on the comment's word. Mutant M2 swaps the argument:

```text
M2  resolveDefaultOutcome(layers) instead of (acceptedLayers)
    node --test mandatory-lock-conformance.test.ts loader.test.ts
    tests=67 pass=64 fail=3 skipped=0   CAUGHT
```

The exhaustive matrix confirms it end-to-end: in every `collide=project-vs-central` row, `voidedLayers` names the project layer and the project posture is absent from the result.

**Verdict: SURVIVES.**

## 6. [CLEAN][demonstrated] Central absent, present, malformed, schema-invalid and read-error all behave, and none of them lets a project `allow` slip past a broken central

Project declares `allow` in every row below:

```text
central malformed JSON      | REJECTED json-parse-error layer=central
central schema-invalid      | REJECTED schema-invalid layer=central
central bad defaultOutcome  | REJECTED schema-invalid layer=central
central read throws         | REJECTED read-error layer=central
central absent              | OK posture=allow/project
central unsupported         | OK posture=allow/project
```

The four broken-central states reject the whole load fail-closed and never fall through to a project posture. The two `absent`/`unsupported` rows are the intended AC5a semantics: no central admin, therefore no central posture. That direction is fail-open for the posture specifically (unlike rules, where absent central simply means fewer rules and POL-05 still denies ambiguity unconditionally), which is exactly why finding 2's disclosure matters at the rewiring story. Issue #107's own locale path lands in the `read-error` row above, which is fail-closed, so #107 does not widen this.

**Verdict: SURVIVES.**

## 7. [CLEAN][demonstrated] POL-09's pin does change when `defaultOutcome` changes, in all three layers, and the absent sentinel is distinct

The plan asserts this comes free because the pin hashes raw bytes. Proved rather than assumed:

```text
baseline pin  = ba3f78459733bfd833b469037185438ffdde82cf9fc4a798b8d541e6be4cd10c
shipped deny  = fd881ab4bd773eb01a203515d330176bc5f1545ccc17d5c630633b2d342712fe  differs=true  posture=deny/shipped-defaults
central deny  = 14afac014bca3b83ff8012441bca8071fd8c1b4c2ac72478836535d1a57dfcb9  differs=true  posture=deny/central
project deny  = 12d6e576fc07f7d771f17d4f0de58311dd1ec317af43ed4b332a3035d37f739a  differs=true  posture=deny/project
central absent= 611f60beeaedee5c09f2677f50cdc23323bbc342e648793463033da7b24631c0  differs=true  posture=allow/bootstrap
```

The project row is what test B14 asserts; the shipped-defaults and central rows are mine and are not covered by any test, but they are structurally guaranteed by `computePin` requiring all three raw strings. Note the fourth row: a central channel that disappears changes the pin, so the pin does record the posture change even though no surface names it.

**Verdict: SURVIVES.**

## 8. [CLEAN][demonstrated] Kernel purity boundary: the type-only import in `rule-types.ts` is inside the scanned root and the gate proves it

```text
$ npm run qa:kernel-purity
[QA kernel-purity-check] PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.
```

`rule-types.ts` imports `type { VerdictOutcome }` from its sibling module `src/policy/kernel/verdict.ts` — a relative specifier that resolves inside `src/policy/kernel/`, which is exactly what the check permits (a non-relative specifier, or a relative one resolving out of the root, is what it forbids). `kernel.ts` is byte-unchanged and still reads only `WorldFacts.defaultOutcome`, so POL-05's unconditional deny still runs ahead of any posture.

**Verdict: SURVIVES.**

## 9. [CLEAN][demonstrated] The #112 proof-test suite is load-bearing: five independent mutants on the shipped logic, all killed

I did not accept the build report's mutation claims. Re-run independently against `mandatory-lock-conformance.test.ts` + `loader.test.ts` (67 tests) and `schema.test.ts` + `loader.test.ts` (69 tests):

```text
BASELINE (6 policy test files)                              tests=151 pass=151 fail=0 skipped=0
M1  tightens := true (lower-trust layer always wins)        tests=67  pass=59  fail=8  CAUGHT
M2  resolveDefaultOutcome(layers) not (acceptedLayers)      tests=67  pass=64  fail=3  CAUGHT
M3  lowerTrust comparison "<" widened to "<="               tests=67  pass=63  fail=4  CAUGHT
M7  tighten keeps the holder's source instead of the layer  tests=67  pass=64  fail=3  CAUGHT
M11 defaultOutcome enum validation disabled in schema.ts    tests=69  pass=67  fail=2  CAUGHT
RESTORED                                                    tests=151 pass=151 fail=0 skipped=0
```

The Part E matrix being derived from `TRUST_RANK` rather than hand-typed is what makes M3 catchable at all, and B5b's assertion that `defaultOutcomeMandatory` is an unknown key is the right answer to D1: an admin cannot write a flag that silently does nothing.

**Verdict: SURVIVES.**

## 10. [SUSPICION][LOW][demonstrated] The raw-bytes bound is measured on Node 24.15.0 only; CI runs 22.18.0 — UNPROVEN-pending-verification, with a 7x margin measured

Plan risk R7 flags that the `raw-bytes-absent` bound depends on V8's `JSON.parse` error not echoing the whole source. I measured the threshold instead of assuming it:

```text
srcLen=   9 wholeTrimmedEchoed=true   msg="Unexpected token ..., "{ "ab" }" is not valid JSON"
srcLen=  17 wholeTrimmedEchoed=true   msg="Unexpected token ..., "{ "abcdefghij" }" is not valid JSON"
srcLen=  21 wholeTrimmedEchoed=false  msg="Unexpected token ..., "{ "abcdef"... is not valid JSON"
srcLen=  86 wholeTrimmedEchoed=false  msg="Unexpected token ..., "{ "abcdef"... is not valid JSON"
node v24.15.0
```

V8 stops echoing the whole source somewhere between 17 and 21 characters. The three file fixtures are 126, 337 and 594 trimmed bytes:

```text
printer-project-bom-malformed.json         trimmed bytes= 337   V8 msg len= 55
printer-shipped-defaults-malformed.json    trimmed bytes= 126   V8 msg len= 82
printer-project-bom-pretty-malformed.json  trimmed bytes= 594   V8 msg len= 55
```

The smallest fixture has roughly a 7x margin, and the shipped-defaults fixture does not even take the snippet path (its error is a position-form message with no source echo). The `is not valid JSON` message shape has been V8's since Node 19, so 22.18.0 and 24.15.0 share it.

**I could not run Node 22.18.0 here** — only v24.15.0 is installed in this worktree. **Settling command:** the PR's own CI run, `.github/workflows/ci.yml` (node-version 22.18.0), `npm test`. Who: whoever opens the PR. If a site does false-fail there, the fix is the terminator form — which is also finding 1's fix, so both are closed by one amendment.

**Verdict: UNPROVEN-pending-verification.** Not a gate.

---

## Attacks that found nothing worth a finding

- **Partial failure / orphan state.** There is none to have. The new path is read-only, in-memory, no apply, no resource creation. Re-running `loadEffectivePolicy` is idempotent.
- **Concurrency / TOCTOU.** The bytes merged and the bytes pinned are the same in-memory strings, captured once each (`centralResult.raw`, `shippedText`, `projectText`). A concurrent writer can change a file after the read, but the pin then records what was actually used, which is the design intent. `centralSource.read()` is still called exactly once, and `pin.ts` still has no way to read anything.
- **Hostile lens, compromised CI runner.** Its credentials reach `.thoth/policy.json` and `src/policy/config/shipped-defaults.json` (both in-repo, git-tracked). They do not reach the HKLM central channel, which needs administrator privileges (REQUIREMENTS.md:225). So the runner can tighten the posture (self-denial, fail-closed), and can flip a shipped-defaults posture because the two are peers — but it cannot relax central. **Weakest link named: whether central is deployed at all.** With no central channel, `.thoth/policy.json` is the sole authority over the posture, and today that is the default state of every install.
- **Duplicate event delivery / console drift.** Not applicable: no events, no console, no infrastructure.

## Editorial (verdict-neutral, fix as plain edits, no re-review)

1. `loader.ts:151` calls the conditional spread an `exactOptionalPropertyTypes` requirement. It is, but the comment reads as if the alternative would be a type error at the call site; it is a type error at the object literal. One-word clarification at most.
2. The Phase 1 plan's section 0 cites the P2 mutant site as `loader.ts:211` and the four sites as `:211/:193/:162/:146`. Those were HEAD-at-plan-time line numbers; at `8e65a2b` they are `:232/:214/:183/:167`. A reader following the plan will land in the wrong place.
3. `precedence.ts:243` declares `defaultOutcome?: ResolvedDefaultOutcome | undefined` — the `?` and the explicit `| undefined` are redundant together under this tsconfig.

## Checks run (raw)

```text
$ node --version
v24.15.0

$ node docs/adr-cache.mjs --ensure
ADR cache BUILT: cataloged 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2], catalog now current (fp 1f5bc09) [CACHE=HIT]

$ node --test src/policy/config/{loader,printer,pin}.test.ts src/policy/rule/{schema,precedence,mandatory-lock-conformance}.test.ts
tests 151  pass 151  fail 0  cancelled 0  skipped 0  todo 0

$ node --test "src/policy/**/*.test.ts"
tests 475  pass 475  fail 0  cancelled 0  skipped 0  todo 0

$ node --test "hooks/**/*.test.mjs" "hooks/**/*.test.ts"
tests 80  pass 80  fail 0  cancelled 0  skipped 0  todo 0

$ npm test
tests 1130  pass 1129  fail 1  cancelled 0  skipped 0  todo 0
  the 1 failure: src/secret-scan/pre-commit-scan.test.ts:201 "R4: a fresh LOCAL clone ..."
  [Error: EBUSY: resource busy or locked, rmdir 'C:\Users\...\Temp\thoth-fresh-clone-lBiwGN']
  Environmental (a Windows temp-directory lock on a fresh-clone teardown), in a file this story
  does not touch. Stated plainly rather than filtered out, per PRINCIPLES rule 13. Not a finding
  against this diff. The gate-manifest-check condition the dispatch excluded did not appear.

$ npm run typecheck
(exit 0, no output)

$ npm run lint
(exit 0, no output)

$ npm run qa:kernel-purity
[QA kernel-purity-check] PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.
```

Mutants applied and reverted: 6 on `loader.ts`/`printer.ts` (P2 x4, N1, P1), 4 on `precedence.ts` (M1, M2, M3, M7), 1 on `schema.ts` (M11). Adversarial harnesses run: 3 (243-combination exhaustive matrix, 13-attack hostile-key battery, V8 truncation-threshold probe). Tree verified clean after every revert; `git status --short` empty before the report commit.

## Findings to failing tests

| Finding | Executable form | Named artifact |
|---|---|---|
| 1 | Yes | `printer.test.ts` -> `ISSUE-123(c): a fail-closed rejection's tail ENDS with the underlying parser or validator message, nothing may be appended after it` |
| 2 | No | Residual-register line: `severity:med` + Milestone S6 on Issue #288 plus a precondition comment, or the equivalent `docs/decisions.md` addendum. A missing precondition on a future story has no executable form today |
| 10 | Deferred to CI | `npm test` on Node 22.18.0, the PR's own CI run |

Open findings: 2. Named failing tests: 1. The gap is finding 2, explained above.

## Verdict: go

The production diff does what it claims, resists everything I could build against it, and ships with a proof suite that five independent mutants could not slip past. Neither MED finding touches shipped behavior: one narrows a test oracle, one binds a residual. PRINCIPLES rule 19 gates on `demonstrated`/`code-traced` HIGH findings; there are none.

**The single scariest unproven assumption.** That the story which rewires `hooks/pretooluse-kernel-gate.mjs` will remember, unprompted, to surface the posture before the field goes live. Every property that makes this story safe today — zero exposure, nothing consumes the field, no shipped policy file declares it — expires in that story, and the only residual with a written precondition attached is #107, not #288.

**Single next action.** Add `severity:med` and Milestone `S6 — Policy centralization` to Issue #288, and comment the precondition on it, so the rewiring story cannot start without reading it.

---

```text
RECEIPT: verdict=go
attacks (ALL, ranked by blast radius):
1. [ISSUE][MED][demonstrated] Issue #124 oracle bounds only a WHOLE-file echo: mutant N1 (first 80 bytes of the offending policy appended at loader.ts:232) passes printer.test.ts 13/13 and leaks the version string plus the head of rule[0].id to stdout on a rejected load; the four whole-file P2 mutants and P1 are all caught, so the defense is real but narrower than round 6's alternative terminator form, which I measured kills N1. Filed by app-security-reviewer as Issue #291; I commented my independent repro rather than duplicating.
2. [ISSUE][MED][code-traced] The resolved posture is invisible on every operator surface (no printer stdout, no PrinterResult field, no print-cli line) and Issue #288, which defers fixing it, carries no severity label, no Milestone and no before-it-goes-live precondition, unlike Issue #107's decisions row; demonstrated with shipped-defaults deny overridden to allow/project by the session-writable .thoth/policy.json while policy print says nothing. Filed as Issue #292. Folds in the undisclosed tighten-to-deny availability lever.
3. [CLEAN][demonstrated] Tighten-only relax resistance: 243 combinations of declaration x central status x collision through the real loader, 0 relax violations; all 27 central=deny(present) rows resolve deny/central, including the 9 where project declares allow.
4. [CLEAN][demonstrated] Relax-by-hostile-key: 13 attacks (unicode-escaped key, duplicate key literal and escaped, __proto__ at rule-set and rule level, case and whitespace variants, array/object/null values, BOM) all rejected fail-closed or resolved deny/central; Object.prototype unpolluted.
5. [CLEAN][demonstrated] Voided-layer bypass: resolveDefaultOutcome runs over acceptedLayers; mutant M2 (pass layers instead) caught, 3 of 67 red; matrix confirms a voided project contributes no posture.
6. [CLEAN][demonstrated] Central absent/present/malformed/schema-invalid/read-error: the four broken states reject the whole load fail-closed and never fall through to a project posture; absent/unsupported means no central posture, by AC5a design.
7. [CLEAN][demonstrated] POL-09 pin changes on a defaultOutcome change in all three layers and for the absent sentinel; four distinct digests measured, not assumed from the raw-bytes claim.
8. [CLEAN][demonstrated] Kernel purity: type-only sibling import in rule-types.ts; qa:kernel-purity PASS, 4 files, zero violations; kernel.ts byte-unchanged so POL-05 still precedes any posture.
9. [CLEAN][demonstrated] The #112 proof suite is load-bearing: five independent mutants (M1 tightens:=true, M2 voided layers, M3 "<" to "<=", M7 source retained on tighten, M11 enum validation disabled) all killed, 2 to 8 tests red each.
10. [SUSPICION][LOW][demonstrated] Raw-bytes bound measured on Node 24.15.0 only; V8 stops echoing whole sources between 17 and 21 chars while the smallest fixture is 126 trimmed bytes (7x margin), but CI's Node 22.18.0 is unrun here. UNPROVEN-pending-verification; settles on the PR's own CI run of npm test.
counts (CHECKSUM): issues=2 suspicions=1 clean=7
evidence (CHECKSUM): demonstrated=9 code-traced=1 derived=0
checks=policy suite 151 pass 0 fail 0 skipped; src/policy 475 pass 0 fail 0 skipped; hooks 80 pass 0 fail 0 skipped; npm test 1130 tests 1129 pass 1 fail 0 skipped (the 1 is an environmental Windows EBUSY rmdir in src/secret-scan/pre-commit-scan.test.ts:201, a file this story does not touch); typecheck exit 0; lint exit 0; qa:kernel-purity PASS; 11 mutants applied and reverted; 3 adversarial harnesses; tree clean
adr=HIT(37)
report=docs/reviews/s6-policy-residuals-112-124-red-team-2026-09-24.md
```
