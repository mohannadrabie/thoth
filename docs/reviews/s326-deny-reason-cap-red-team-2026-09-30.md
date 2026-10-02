# Red-team review: s326-deny-reason-cap (Issue #326), 2026-09-30

[red-team] Sutekh. Tier CRITICAL (ratified). Diff 616a140^..569ac7f on s7/closeout (616a140 red tests, 61a87c9 kernel fix, 569ac7f CHANGELOG).
All probing, mutants and test runs happened in an isolated detached worktree (C:/playground/thoth-rt326 at 569ac7f, node_modules junctioned), removed at the end. The main tree was touched only to write this file and the REVIEW_LOG row.

ADR: `📊 ADR cache HIT: reused 37 ADR(s) [adr/devops:12, adr/software-engineering:23, docs/adr:2] from catalog — ≈18300 tokens saved this pass (fp 13c1476) [CACHE=HIT]`
ADRs read for the attack surface: SE ADR-0021 (kernel purity; POL-05 deny on non-empty unresolved; same kernel for all gates), SE ADR-0006 (blast radius, no scope widening), ADR-0016 (self-protection). No ADR names deny-reason or stdout size. Kernel purity holds (below).

## Verdict: GO

The cap works and holds on every reachable path I could build. No verdict changed across 40,000 differential decisions. The largest real deny stdout from normal (valid UTF-8) worst-case input is 3290 bytes. Two gaps, neither blocking:
1. (MED) The tests do not pin the 512 value and do not use the worst-case input, so a cap raised to 800 stays green.
2. (LOW) Lone-surrogate input takes deny stdout to 6252 bytes, above the pinned 4096 but under the runtime's documented 10,000-character limit.

## Attacks, ranked by exposure x irreversibility x silence

### 1. [ISSUE][MED][demonstrated] The regression guard does not guard the pinned property
**Scenario.** Someone later edits `UNRESOLVED_FRAGMENT_CAP` (for example, "harmonising" it with a different cap) or changes the slice. The suite is supposed to catch any drift that breaks the pinned 4096-byte stdout maximum.
**Current defense.** kernel.test.ts AC-326-4 asserts `reason.includes("y".repeat(512) + "[truncated, ...")`. Any cap above 512 still contains that substring. The only upper guard is `reason.length < 3*(512+60)+200`, which trips at about 830. The hook test AC-326-3 is labelled "maximal-expansion", but its payload (U+0001, U+0002, U+001F, quote, backslash, euro sign, newline) is 4 of 7 control characters, and the sanitizer strips those. So 512 raw characters render to about 220, and the 3-byte-per-unit two-entry worst case is never exercised.
**Evidence (mutants against both new test files, 33 tests):**
```
M1 remove cap:                     pass 28 fail 5 skipped 0   KILLED
M2b cap 511:                       pass 31 fail 2 skipped 0   KILLED
M2c cap 1024:                      pass 32 fail 1 skipped 0   KILLED (only by the length guard)
M3 drop marker:                    pass 31 fail 2 skipped 0   KILLED
M4 marker shows cap not length:    pass 32 fail 1 skipped 0   KILLED
M5 <= to <:                        pass 32 fail 1 skipped 0   KILLED
M6 cap only the first entry:       pass 31 fail 2 skipped 0   KILLED
M7 truncate ActionRecord in place: pass 32 fail 1 skipped 0   KILLED
M2a cap 513:                       pass 33 fail 0 skipped 0   SURVIVES
cap 600:                           pass 33 fail 0 skipped 0   SURVIVES
cap 700:                           pass 33 fail 0 skipped 0   SURVIVES
cap 750:                           pass 33 fail 0 skipped 0   SURVIVES
  real hook at cap 750, verb+resource 64K x U+20AC: stdoutB=4718  (> pinned 4096, suite green)
cap 800:                           pass 33 fail 0 skipped 0   SURVIVES
```
Exposure: 0% of current runs (the shipped value, 512, is correct). The risk is latent: a future cap drift in the range 513..~830 ships silently. Basis: measured (mutant runs above). Reversible, and silent.
**Named test to add:** `AC-326-3b: two-entry worst-case expansion (3-byte BMP verb + malformed resource, 64K each) stays under MAX_STDOUT`, plus a unit assertion `AC-326-4b: pol05Rule output never contains 513 consecutive original characters`. Both pass on HEAD and kill M2a..cap-800. Filed as #375.

### 2. [ISSUE][LOW][demonstrated] Lone UTF-16 surrogates break the stated 4096-byte pin (6 bytes per unit, not 3)
**Scenario.** A prompt-injected model writes tool_use JSON whose `command` holds lone-surrogate escapes (backslash-u-d800). The escapes survive every JSON hop as lone surrogates. `sanitizeForTerminal` strips only `\p{Cc}\p{Zl}\p{Zp}`, so surrogates (category Cs) pass through. The cap counts UTF-16 units, and `JSON.stringify` (well-formed) re-escapes each lone surrogate as a 6-byte escape. The derivation comment in the test ("worst JSON expansion left is a 3-byte BMP character (3x)") is wrong for this input class.
**Evidence (real hook via gate-sandbox; probe file hooks/rt326-probe.test.ts in the worktree, not committed):**
```
one-entry lone-surrogate: code 0 denied true stdout bytes 3275 escapes 498
two-entry lone-surrogate: code 0 denied true stdout bytes 6252 escapes 988
two-entry quote/backslash: code 0 denied true stdout bytes 2300
two-entry 3-byte BMP: code 0 denied true stdout bytes 3288
x RT-A ... AssertionError: two-entry lone-surrogate stdout 6252 must be < 4096
tests 2  pass 1  fail 1  skipped 0
```
**Current defense, honestly assessed.** The output is still a valid, parseable deny (exit 0, decision "deny"), and it is bounded by a constant: at most 2 attacker-sized entries x (512 x 6 + marker) + framing, about 6.3 KB. Claude Code's hook docs say plain stdout and each JSON output field are capped at 10,000 characters (https://code.claude.com/docs/en/hooks), so the ceiling sits below the documented runtime limit. The fail-open this story defends against (truncated deny read as allow) is not reached. Only our own pin is breached.
Exposure: unknown share of calls, basis: assumption (it needs deliberate lone-surrogate escapes in model output). LOW, and "measure it" is the only recommendation.
**Named failing test:** `AC-326-3c: lone-surrogate two-entry stdout stays under MAX_STDOUT` (fails on HEAD at 6252). Resolve by either (a) raising MAX_STDOUT to about 6.5 KB, with a corrected derivation citing the 10,000-character documented cap, or (b) capping on rendered bytes. Option (a) is the simpler one. Can ride with #375; no separate Issue (LOW).

### 3. [CLEAN][demonstrated] Other reflection paths: none unbounded (instrument, not eye)
Static instrument: `rg` over non-test `src/policy` + `hooks/*.mjs` for interpolated `reason:|refuse(|unresolved.push(|unresolvedRecord(|opaque(|unresolved: [` found **18 sites** (shell.ts 7, tool-class.ts 3, decide-tool-call.ts 3, kernel.ts 3, registry.ts 1, structured-cluster.ts 1). They route as follows:
- Every `unresolved` site ends up in pol05Rule and is capped.
- The tool-class `opaque(...)` causes never reach the reason, because `source: "opaque"` returns the fixed opaque string first (kernel.ts pol05Rule, opaque branch).
- decide-tool-call.ts tool_name reflections use `bounded()`.
- policy-load-failure prints only the layer name and kind.
- `rationale`/`id` are policy-authored (attack 4).

Dynamic instrument: 21 shapes x 64 KB worst-case (3-byte BMP / quote+backslash) through the real hook. Shapes covered: verb, resource, verb+resource, 4000 resource tokens, --context, bash -c inner, nested wrappers, command substitution, chain, separator, unterminated quote, heredoc, 2-target redirect, -C, unroutable tool_name, mcp names, non-string tool_name, non-string command, huge session_id. Results:
```
verb-eur                     code=0 kind=deny   stdoutB=1782 stderrB=0
resource-eur                 code=0 kind=deny   stdoutB=1743 stderrB=0
verb+resource-eur            code=0 kind=deny   stdoutB=3290 stderrB=0
verb+resource-quote          code=0 kind=deny   stdoutB=2302 stderrB=0
many-resource-tokens         code=0 kind=deny   stdoutB=763 stderrB=0
context-flag-eur             code=0 kind=allow  stdoutB=0 stderrB=0
bash-c-inner-eur             code=0 kind=deny   stdoutB=3290 stderrB=0
nested-wrappers              code=0 kind=deny   stdoutB=1782 stderrB=0
subst-eur                    code=0 kind=deny   stdoutB=234 stderrB=0
chain-eur                    code=0 kind=deny   stdoutB=235 stderrB=0
separator-eur                code=0 kind=deny   stdoutB=234 stderrB=0
unterminated-quote           code=0 kind=deny   stdoutB=264 stderrB=0
heredoc-eur                  code=0 kind=allow  stdoutB=0 stderrB=0
redirect-2targets-eur        code=0 kind=deny   stdoutB=283 stderrB=0
dir-flag-eur                 code=0 kind=deny   stdoutB=232 stderrB=0
tool_name-unroutable-eur     code=0 kind=deny   stdoutB=1750 stderrB=0
tool_name-mcp-eur            code=0 kind=deny   stdoutB=182 stderrB=0
tool_name-mcp-unsplit-eur    code=0 kind=deny   stdoutB=182 stderrB=0
tool_name-nonstring-bigobj   code=0 kind=deny   stdoutB=1740 stderrB=0
bash-command-nonstring       code=0 kind=deny   stdoutB=186 stderrB=0
session_id-eur               code=0 kind=deny   stdoutB=1782 stderrB=0
MAX stdout+stderr bytes over all shapes: 3290
tests 1  pass 1  fail 0  skipped 0
```
Allow paths emit nothing (the two allows come from the sandbox's empty rule set and default outcome, and are unchanged by this diff). Stderr was 0 bytes on every shape. At most 2 attacker-sized entries can co-occur: the syntax-path entries carry only operators and markers (shell-scanner returns `op`/`marker`), and wrappers return a single inner record.

### 4. [CLEAN][code-traced] Rule `rationale`/`id` are unbounded, but outside the attacker's trust boundary
src/policy/rule/schema.ts:195 only type-checks `rationale` and has no length cap, so a deny rule's rationale reaches stdout whole (kernel.ts decide, deny branch). The party that writes it already controls the verdict it would "defeat". mergeLayersById (src/policy/rule/precedence.ts:46-60) orders ids first-seen: shipped-defaults, then central, then project. shipped-defaults.json has `rules: []`. So a project-layer deny with a giant rationale cannot sort ahead of a matching central deny, and the first deny found stays the central one. Nobody gains anything they did not already have. The plan excluded a whole-reason cap on purpose; I agree.

### 5. [CLEAN][demonstrated] Surrogate pair split at slice(0, 512)
A U+1F600 emoji straddling unit 512 leaves a lone high surrogate. Well-formed JSON.stringify emits it as an escape, so stdout stays valid JSON and the result is still a deny: `split: code 0 denied true bytes 789`, with the 6-character escape of D83D immediately before the marker. The cost is cosmetic: one half-character in a model-visible diagnostic.

### 6. [CLEAN][demonstrated] The cap changed no verdict
Differential test: old kernel (616a140^) vs new, on the same normalized records. Inputs were 20,000 seeded random shell commands built from verbs, resources, operators, and 511/512/513/600-char, U+20AC and lone-surrogate pieces, each under defaultOutcome allow and deny, with a deny rule and an allow rule:
```
{"decisions":40000,"outcomeDiffs":0,"ruleIdDiffs":0,"reasonDiffs":2902,"reasonDiffsAllCapped":true}
```
Every reason difference carries the marker. Mutant M7 (truncating the ActionRecord in place) is killed by AC-326-5, so the full-text record is guarded.

### 7. [CLEAN][demonstrated] Tests not edited after the fix; failing-first confirmed
`git diff --stat 616a140..569ac7f` restricted to test files (pathspec: all .test.ts) shows no output: 61a87c9 touches only kernel.ts and 569ac7f only CHANGELOG.md. The same two test files run against the pre-fix kernel give `pass 28 fail 5 skipped 0` (AC-326-1, -2, -3, -4 hook, -4 unit red), and at HEAD `pass 33 fail 0 skipped 0`. The #312 guards are unmodified and green: pretooluse-kernel-gate-sanitize, render-hook-output, gate-structure, sanitize, pretooluse-kernel-gate suites `tests 146 pass 146 fail 0 skipped 0`. `qa:kernel-purity` PASS (4 production files, zero violations).

## Findings to tests
Open findings: 2. Failing tests: 2.
- #1 is `AC-326-3b` / `AC-326-4b`. They pass on HEAD by design, because the defect is the missing guard. They fail against the cap-513..800 mutants, which is how they prove themselves.
- #2 is `AC-326-3c`, which fails on HEAD today (6252 > 4096).

## Scariest unproven assumption
That Claude Code hands a deny stdout of up to about 6.3 KB to its decision parser intact. The vendor docs put the cap at 10,000 characters, which covers it, but it has not been measured in a live session because the hook is not wired (#308).

## Next action
Add AC-326-3b/4b/3c, fix the MAX_STDOUT derivation (or raise it to about 6.5 KB citing the documented cap) on this same branch as #375. Not a merge blocker.

## Editorial
- hooks/pretooluse-kernel-gate-reason-cap.test.ts header: "the worst JSON expansion left is a 3-byte BMP character (3x)" is wrong for lone surrogates (6x via the backslash-u escape). "Maximal-expansion" overstates what the AC-326-3 payload does, since 4 of its 7 characters are stripped.
- Plan's "worst-case JSON escape is 6 bytes per char (u00XX)": control characters are stripped before JSON, so the 6-byte case actually comes from lone surrogates, not control-character escapes.

RECEIPT: verdict=go
attacks:
1. [ISSUE][MED][demonstrated] Cap tests do not pin 512 or use worst-case input: caps 513..800 pass all 33 tests; at 750 real stdout is 4718 B > pinned 4096, suite green (#375)
2. [ISSUE][LOW][demonstrated] Lone-surrogate two-entry input gives 6252 B deny stdout > pinned 4096 (6 B/unit escape); still a valid deny, bounded about 6.3 KB, under the documented 10,000-char runtime cap
3. [CLEAN][demonstrated] Other reflection paths: 18 interpolation sites (rg instrument) all capped, bounded, fixed or policy-authored; 21-shape x 64K real-hook sweep max 3290 B, allow silent, stderr 0
4. [CLEAN][code-traced] Unbounded rule rationale/id is policy-authored; merge order (central before project, shipped-defaults empty) stops a project deny front-running a central deny
5. [CLEAN][demonstrated] Surrogate split at slice(0,512) emits an escape; JSON valid, deny, 789 B
6. [CLEAN][demonstrated] No verdict change: 40,000 old-vs-new decisions, 0 outcome/ruleId diffs, all 2902 reason diffs carry the marker
7. [CLEAN][demonstrated] Tests untouched after the fix; red at pre-fix (28/5/0), green at HEAD (33/0/0); 8 of 9 targeted mutants killed; #312 guards 146/0/0; kernel purity PASS
counts: issues=2 suspicions=0 clean=5
evidence: demonstrated=6 code-traced=1 derived=0
checks=new tests HEAD 33/0/0; pre-fix 28/5/0; #312 guards 146/0/0; kernel-purity PASS; mutants 8 killed / 5 survived (cap 513,600,700,750,800); probe RT-A 0/1/0 (fails, finding 2), RT-B 1/0/0; sweep 1/0/0; differential 40000 decisions 0 verdict diffs
adr=HIT(37)
report=docs/reviews/s326-deny-reason-cap-red-team-2026-09-30.md
