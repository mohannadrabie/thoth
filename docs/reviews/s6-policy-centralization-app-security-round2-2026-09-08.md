# S6 "Policy Centralization" -- App-Security Re-Confirm, ROUND 2 (Stage 3)

**Scope:** delta from `280f1c7` (my last-reviewed baseline, verdict APPROVE, `docs/reviews/s6-policy-centralization-app-security-2026-09-08.md`) through `602be5c` (current HEAD) -- three fix-now rounds and one council-ratified trust-model redesign. **Tier:** CRITICAL. **Reviewer:** app-security-reviewer (Horus). **Date:** 2026-09-08.

**Files re-reviewed against the real diff:** central-source.ts (+test), precedence.ts (+test), mandatory-lock-conformance.test.ts (new), schema.ts (+test), position-parser.ts (+test), loader.ts/printer.ts/print-cli.ts (+test where applicable).

**Read first:** docs/decisions.md's 2026-09-08 rows from "S6 Stage-3 review round 1" through "S6 Stage-3 round-3 RE-CONFIRM"; docs/reviews/s6-policy-centralization-red-team-round3-2026-09-08.md (go, 2 new MED findings, both fixed same-turn in 602be5c); my own prior report (docs/reviews/s6-policy-centralization-app-security-2026-09-08.md, APPROVE against 280f1c7).

**Method:** this is not a re-read of the prior report. Every claim below was independently re-derived against the live tree at 602be5c -- code traced, or run, this session, including two source mutations I applied and reverted myself.

---

## ADR compliance (mandatory gate)

node docs/adr-cache.mjs --ensure returned CACHE HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] ... [CACHE=HIT].

Same applicable ADR as my last pass: SE ADR-0021 (kernel purity, POL-11 -- no filesystem/network/process-spawning import inside src/policy/kernel/**). Re-ran the live scanner against the current tree (not cited from memory):

node src/qa/kernel-purity-check.ts -> PASS: 4 production .ts file(s) under src/policy/kernel/, zero import or forbidden-global violations.

None of this round's changes (precedence.ts, schema.ts, position-parser.ts, central-source.ts, loader.ts, printer.ts, print-cli.ts, the new mandatory-lock-conformance.test.ts) touch src/policy/kernel/** -- confirmed by the commit stats (git log 280f1c7..602be5c --stat), none of which list a kernel-directory file. No BLOCKER from ADR non-compliance.

---

## Findings

### 1. [CLEAN][demonstrated] Issue #106's reg.exe absolute-path fix is real, and still holds at HEAD

central-source.ts:107-113: resolveSystemRegExePath() builds SystemRoot + "\System32\reg.exe" (falling back to windir, then a hardcoded "C:\Windows"), reading the env vars via process.env by default -- and read() (central-source.ts:248) calls runner(resolveSystemRegExePath(), [...]), never a bare "reg.exe" string. No PATH lookup occurs for an absolute path on Windows. This is unchanged in shape since my last pass but I re-verified it is still true at current HEAD (not stale): re-read the file in full, re-ran central-source.test.ts's AC7(i) argv-capture assertion.

### 2. [CLEAN][demonstrated] stdio ["ignore","pipe","pipe"] still present, unconditional

central-source.ts:205-215,248-254 -- same as my last pass, re-confirmed against current bytes, not carried forward on trust.

### 3. [CLEAN][demonstrated] The TRUST_RANK mechanism is a real, structurally-sound security control -- I reproduced the Issue #114 exploit myself and watched it fail

This is the new trust-boundary concept the review brief asked me to judge on its own merits, not something my last pass ever saw. I did not trust red-team's repro output -- I wrote and ran my own JS probe directly against mergeLayersWithMandatoryLock at HEAD: a 3-layer call where shipped-defaults declares an allow rule with id "central-deny-prod-exec", central declares a deny rule with the SAME id and mandatory:true, project is empty (the round-2 exploit shape: a git-tracked shipped-defaults edit attempting to void the entire central layer).

Result: central rule survives as deny, sourceLayer=central. central voided? false. voidedLayers: [].

The central deny rule survives untouched, sourced from central, never voided. This confirms the fix at precedence.ts:263 (TRUST_RANK[declaringLayer] > TRUST_RANK[layer.name], never a layer-name literal) closes the exact HIGH red-team demonstrated against the pre-Path-B code.

### 4. [CLEAN][demonstrated] Central's un-voidability is structural, not observed-only -- confirmed both by code trace and by a compiler-enforced property I tested myself

precedence.ts:161-165: TRUST_RANK = { "shipped-defaults": 0, central: 1, project: 0 }. Central holds the maximum rank in the table, so no layer can ever satisfy TRUST_RANK[declaringLayer] greater than TRUST_RANK["central"] (greater than 1 is impossible with today's values) -- central cannot appear in voidedLayers for any input, by construction of the table's own values, not merely because no test happens to exercise a voiding case.

I independently tested the compile-time half of this claim (a claim central-source's own header makes: "a future 4th layer is a COMPILE ERROR here until this table is updated"). I mutated LayerName to add a 4th "enterprise" member WITHOUT touching TRUST_RANK, and ran typecheck:

  added "enterprise" to LayerName only, not TRUST_RANK
  npm run typecheck ->
  src/policy/rule/precedence.ts(161,14): error TS2741: Property enterprise is missing in type
  shipped-defaults/central/project record but required in type Record LayerName number.

Reverted (git checkout -- src/policy/rule/precedence.ts; git status --short confirmed clean). This is a real, compiler-enforced invariant, not documentation: a future layer added to the type without an accompanying trust-rank decision cannot ship.

### 5. [CLEAN][demonstrated] Issue #118's fix (mandatory-lock-conformance.test.ts's enumeration domain) is genuinely load-bearing -- I ran red-team's own attack myself, independently, and got the corrected (failing) result

Round 3's red-team report demonstrated that, against the pre-#118-fix code, adding a 4th trust layer left the conformance matrix's own self-check green while covering only half the matrix. I did not take the claim that this is now fixed on the strength of the commit message -- I reproduced the attack against the CURRENT, fixed file myself: added "enterprise" (rank 2) to BOTH LayerName and TRUST_RANK in precedence.ts.

npm run typecheck -> exit 0 (the Record LayerName property is satisfied, as before).

node --test src/policy/rule/mandatory-lock-conformance.test.ts ->
  FAILING: mandatory-lock conformance (self-check): PRECEDENCE_ORDER's domain equals TRUST_RANK's own key set, and the forward-pair count is n(n-1)/2 ... -- never a hard-coded 3
  AssertionError: PRECEDENCE_ORDER must enumerate EXACTLY the layers TRUST_RANK knows about
    actual:   Set(4) { shipped-defaults, central, project, enterprise }
    expected: Set(3) { shipped-defaults, central, project }

This is the opposite of red-team's round-3 result against the pre-fix file (which stayed 12/12 green under the identical mutation). The fix (mandatory-lock-conformance.test.ts:83-96, deriving PRECEDENCE_ORDER's expected domain and forward-pair count from Object.keys(TRUST_RANK) rather than a hand-typed list) genuinely closes the gap red-team named. Reverted the mutation (git checkout), confirmed git status --short empty and the file back to 12/12 pass.

From a security-reviewer's lens, not just a correctness lens: this instrument is exactly what CLAUDE.md's "no hand-derived completeness claims" rule requires of a trust-boundary assertion -- the claim "every layer-pair combination is exercised" is now generated by a running instrument (this test's own self-check) rather than asserted in prose, and I confirmed the instrument actually enforces that, not merely states it.

### 6. [CLEAN][code-traced] Issue #119's fix (position-parser.ts) closes the third-view parser-differential gap by sharing one decoder, not adding a second

position-parser.ts:48,218: imports unescapeJsonStringLiteral from ../rule/schema.ts and uses it in the top-level "rules" key comparison: unescapeJsonStringLiteral(unquoteSimple(prevKey.raw)) === "rules". This is the same decoder schema.ts's findTopLevelKeys (the function findDuplicateTopLevelKeys and the tokenizer/parser-agreement invariant both depend on) already uses -- one authoritative notion of "what does this key token actually say" shared across both files, rather than a second hand-rolled unescaper that could independently drift. This closes the exact gap red-team demonstrated: a single (non-duplicated) unicode-escaped "rules" key no longer silently degrades every rule's origin line to -1, because the module that decides "is this the rules key" now agrees with the module that decides "is this key duplicated" and with JSON.parse itself.

I traced (did not re-derive from scratch) that this import direction -- position-parser.ts (in src/policy/config/) importing from schema.ts (in src/policy/rule/) -- matches the codebase's own established layering (config consumes rule validation), per schema.ts's own header comment, so this is not a new layering violation.

### 7. [CLEAN][demonstrated] Full regression suite and gates, re-run myself at HEAD 602be5c

git log --oneline -1 -> 602be5c S6 Stage-3 round-3 re-confirm fix-now: Issue #118 (MED) + Issue #119 (MED)
git status --short -> (empty)

node --test --test-reporter=tap -> tests 642 / pass 641 / fail 1 / skipped 0.
The 1 failure: "OSS-01 (dogfood): the real repo, scanned with the real allowlist, is a clean (blocking) pass" -- confirmed via grep of the tap output: this IS the disclosed pre-existing Issue #113 case, unrelated to this diff and unchanged across all three fix-now rounds.

npm run typecheck -> exit 0, no output.
npm run lint -> exit 0, no output.
node src/qa/kernel-purity-check.ts -> PASS.

node --test src/policy/config/*.test.ts src/policy/rule/precedence.test.ts src/policy/rule/schema.test.ts src/policy/rule/mandatory-lock-conformance.test.ts -> tests 122 / pass 122 / fail 0 / skipped 0.

Matches docs/decisions.md's own claimed 642/641/1 exactly -- verified, not trusted.

### 8. [CLEAN][demonstrated] printer.test.ts (test-writer's locked answer key) is still genuinely untouched across the full round-3 span

git diff --stat 280f1c7..602be5c -- src/policy/config/printer.test.ts -> (empty).
node --test src/policy/config/printer.test.ts -> tests 9 / pass 9 / fail 0 / skipped 0.

The field-not-stdout threading pattern (inertMandatoryDeclarations added to PrinterResult/LoadSuccess, never to the tested stdout string) is what preserves this -- traced through loader.ts:71-77,188 -> printer.ts:47-49,70,92-98 -> print-cli.ts:33-41, confirmed the stdout-producing code paths (renderSuccess/renderRejection's lines.join logic) are byte-for-byte unchanged; only the return object gained a new field.

### 9. [CLEAN][code-traced] Loud-disclosure mechanism is real, reaches the actual CLI, and discloses only non-sensitive data

Ran the real CLI against this machine's actual (absent) registry state via npm run policy:print: printed central-channel status=absent, zero resolved rules, a pin line, and the existing ENFORCEMENT_DISCLOSURE NOTE. No inertMandatoryDeclarations line printed because both real in-repo layers (shipped-defaults.json, .thoth/policy.json) are still empty rule sets -- confirmed directly (cat both files, both version "0.0.0-s6-placeholder", rules []), matching red-team's C14 "today's live blast radius is zero, measured" finding, still true at HEAD. When it does fire (per code trace of print-cli.ts:33-40), the disclosed content is only a rule id and a layer name -- no rationale text, no file paths, no secrets.

### 10. [CLEAN][code-traced] No new dependency, no secrets introduced this round

git log 280f1c7..602be5c --stat shows only the already-itemized source/test/doc files across both commits -- no package.json change in this delta at all (the one dependency-relevant line from my last pass, the policy:print script, predates this round). Grepped the new/changed source for credential-shaped strings: none found beyond the already-reviewed benign registry-value fixtures.

### 11. [SUSPICION][LOW][derived] central-source.ts's absolute-path construction still trusts an ambient process.env.SystemRoot/windir -- not currently exploitable, but worth naming for the eventual hook-wiring story

central-source.ts:107-110: resolveSystemRegExePath() reads env.SystemRoot, falling back to env.windir, falling back to a hardcoded "C:\Windows", from process.env by default. This closes Issue #106's demonstrated attack (a PATH-resolvable bare name) completely -- the resulting path is absolute, so Node's execFileSync performs no PATH search at all. What it does not independently defend against: if a future caller's process environment had SystemRoot itself overridden (a stronger precondition than Issue #106's PATH-ordering trick -- it requires control of an OS-level environment variable, not just a writable location earlier in PATH), the resolved "absolute" path would point wherever that value says, and a file placed there would run in reg.exe's place.

This is not a new pattern this codebase invented -- it mirrors the CLAUDE_PROJECT_DIR ambient-trust shape already present in hooks/sessionstart-tool-enum.mjs:125 and hooks/userpromptsubmit-halt-relay.mjs:137, which red-team's own S5 round-3 report named as its "single scariest unproven assumption" and which remains an open, disclosed residual in this codebase, not something S6 introduces fresh. I checked for a live exploit path and found none: no hook currently consumes central-source.ts's reader at all -- docs/decisions.md's S6 plan-ratification row explicitly ruled hooks/pretooluse-kernel-gate.mjs is NOT rewired to this loader in S6, confirmed by git log 280f1c7..602be5c --stat showing zero changes to any hooks/*.mjs file this round. The only current callers are print-cli.ts (a dev-invoked CLI) and the test suite.

Exposure: 0% of runs today (measured -- grep-confirmed zero hook consumers of this reader), unmeasured for a future hook-wiring story, basis: assumption. Capped LOW, non-blocking. Recommendation: when a future story wires this reader into a live PreToolUse hook (the same trigger that made S5's CLAUDE_PROJECT_DIR question worth asking), that story's own review should ask whether the hook's env is session-influenceable before trusting SystemRoot for a security-relevant subprocess path -- a five-minute check at that time, not a redesign now.

---

## Editorial (verdict-neutral, carried from red-team's round-3 report, confirmed still present -- not re-litigated)

- precedence.ts:148-153 still states shipped-defaults' claim on project "was never real force to begin with" -- inaccurate as history (it WAS force under the pre-Path-B code); red-team named this, it is unfixed, correctly so (editorial, not gating).
- print-cli.ts:39 still hardcodes "only the central layer's mandatory declarations are authoritative" rather than deriving the layer name(s) from TRUST_RANK -- would go stale silently the moment a second trusted tier ships. Same status: named, unfixed, non-blocking.

## Trust-boundary correctness -- explicit answer to the review brief

Yes: the TRUST_RANK mechanism, as shipped at 602be5c, genuinely prevents an in-repo, session-writable file (shipped-defaults.json or .thoth/policy.json) from defeating a central-authored mandatory rule. I found no bypass the three red-team re-confirm rounds missed -- my own independent repro of the original exploit failed to reproduce (finding 3), the structural un-voidability claim held under a compiler-enforced test I ran myself (finding 4), and the standing conformance instrument itself is verified load-bearing against the specific "future layer" bypass class by my own reverted mutation (finding 5), not merely cited from red-team's report. The one residual I did find (finding 11) is an ambient-environment-trust question with zero current exposure, structurally identical in shape to an already-disclosed, already-accepted residual elsewhere in this codebase, not a defeat of the trust-rank mechanism itself.

## Findings vs. failing tests

All findings this round are CLEAN or LOW-severity SUSPICION (derived, non-blocking, no live exploit path). No open finding requires a new failing test. Open findings: 0. This matches "findings become tests" -- nothing here converts.

## Verdict

APPROVE. The three fix-now rounds and the council-ratified Path B trust-model redesign genuinely close what my last pass could not have seen: Issue #106's reg.exe path fix still holds; the TRUST_RANK mechanism is a real, structurally-sound trust boundary that I independently attacked and could not defeat, and whose "central can never be voided" property is enforced by the type system, not merely tested; Issue #118's conformance-matrix completeness gap and Issue #119's parser-differential gap are both genuinely fixed, verified by my own reverted source mutations rather than taken on trust from red-team's or the implementer's own claims. The full regression suite, typecheck, lint, and kernel-purity gates all pass at HEAD, re-run by me. No BLOCKER found. One LOW, non-blocking hardening observation noted for whichever future story wires this reader into a live enforcement hook.

## Single next action

None required to ship S6 from an app-security standpoint. Issues #118/#119 remain OPEN on GitHub pending red-team's own procedural re-confirm (per this project's "reviewer's own re-confirm, not the implementer's word" convention for closure) -- my own independent verification above corroborates both fixes are genuine from the app-security domain's lens, but closure itself stays red-team's call, unchanged from the existing convention. If finding 11 is to be tracked, add one docs/backlog.md line for the future hook-wiring story to check ambient-env trust before wiring central-source.ts into a live hook.

---

RECEIPT: verdict=APPROVE
findings (ALL of them, one terse line each, ranked by exploitability x impact):
1. [CLEAN][demonstrated] central-source.ts:107-113,248 -- Issue #106's absolute SystemRoot\System32\reg.exe path fix re-confirmed real at HEAD, no PATH lookup, re-verified against current bytes and AC7(i)'s argv-capture test
2. [CLEAN][demonstrated] central-source.ts:205-215,248-254 -- stdio ["ignore","pipe","pipe"] still present, unconditional, re-confirmed against current bytes
3. [CLEAN][demonstrated] precedence.ts:263 TRUST_RANK check -- reproduced Issue #114's exploit myself (shipped-defaults declares mandatory:true on a central id): central rule survives as deny/sourceLayer=central, voidedLayers=[], not taken on red-team's word
4. [CLEAN][demonstrated] precedence.ts:161-165 TRUST_RANK table -- central's un-voidability is structural (max rank in table) AND compiler-enforced: I mutated LayerName to add a 4th member without updating TRUST_RANK and got a real tsc TS2741 error, reverted cleanly
5. [CLEAN][demonstrated] mandatory-lock-conformance.test.ts:83-96 (Issue #118 fix) -- ran red-team's own 4th-layer mutation myself against the FIXED file: self-check correctly fails now (Set(4) vs Set(3) mismatch), opposite of round-3's result against the pre-fix file; reverted, git status clean after
6. [CLEAN][code-traced] position-parser.ts:48,218 (Issue #119 fix) -- imports and reuses schema.ts's unescapeJsonStringLiteral for the "rules"-key comparison instead of a second raw-text unescaper, closing the third-view parser-differential gap red-team demonstrated; import direction matches established config-consumes-rule layering
7. [CLEAN][demonstrated] Full suite/gates re-run at 602be5c: 642 tests/641 pass/1 fail (pre-existing OSS-01, Issue #113, grep-confirmed)/0 skipped; typecheck clean; lint clean; kernel-purity PASS; 122/122 on the specifically-touched test files
8. [CLEAN][demonstrated] printer.test.ts (test-writer's locked answer key) empty git diff 280f1c7..602be5c, still 9/9 passing, stdout-producing code paths traced unchanged
9. [CLEAN][code-traced] Loud-disclosure (InertMandatoryDeclaration) reaches the real CLI via npm run policy:print, field-not-stdout pattern preserves printer.test.ts, discloses only rule id + layer name (no secrets/rationale/paths)
10. [CLEAN][code-traced] No new dependency and no secrets introduced this round -- git log --stat shows only already-itemized source/test/doc files, no package.json change
11. [SUSPICION][LOW][derived] central-source.ts:107-110 resolveSystemRegExePath() trusts ambient process.env.SystemRoot/windir to build the absolute reg.exe path -- not currently exploitable (zero hook consumers of this reader, confirmed via git log --stat showing no hooks/*.mjs changes this round), mirrors this codebase's own already-disclosed CLAUDE_PROJECT_DIR ambient-env-trust residual (S5); hardening note for the future hook-wiring story, not a defeat of the fix
counts (a CHECKSUM -- MUST equal the lines listed above; never truncated): issues=0 suspicions=1 clean=10
evidence (a CHECKSUM over the tags above -- MUST equal them, and MUST total the counts line): demonstrated=8 code-traced=3 derived=1
checks="642/1/0 full suite (1 pre-existing, unrelated) | 122/122 touched-file suite | typecheck clean | lint clean | kernel-purity PASS | 2 source mutations applied+reverted by me (4th LayerName member alone -> TS2741; 4th LayerName+TRUST_RANK member -> conformance self-check correctly fails) | printer.test.ts diff empty, 9/9 pass"
adr=HIT(35)
report=docs/reviews/s6-policy-centralization-app-security-round2-2026-09-08.md
